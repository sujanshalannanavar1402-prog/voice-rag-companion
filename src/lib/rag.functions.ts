import { createServerFn } from "@tanstack/react-start";

const HF_PRIMARY =
  "https://datasets-server.huggingface.co/rows?dataset=ai4bharat/MSMARCO-XI&config=default&split=train&offset=0&length=500";
const HF_FALLBACK =
  "https://datasets-server.huggingface.co/rows?dataset=microsoft/ms_marco&config=v1.1&split=train&offset=0&length=500";

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return await fn();
  }
}

function collectText(value: unknown, out: string[]) {
  if (typeof value === "string") {
    if (value.trim().split(/\s+/).length >= 20) out.push(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectText(v, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/passage|text|content|body|answer|context/i.test(k) || Array.isArray(v) || typeof v === "object") {
        collectText(v, out);
      }
    }
  }
}

function chunkWords(text: string, size = 200, overlap = 30): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= size) return [words.join(" ")];
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += size - overlap) {
    chunks.push(words.slice(i, i + size).join(" "));
    if (i + size >= words.length) break;
  }
  return chunks;
}

async function embed(texts: string[], apiKey: string): Promise<number[][]> {
  // OpenAI-style keys start with "sk-"; anything else is treated as a Google
  // Generative Language API key (Gemini embeddings, 1536 dims).
  if (apiKey.startsWith("sk-")) {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: texts }),
    });
    if (!res.ok) throw new Error(`Embedding failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding);
  }

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents",
    {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: texts.map((t) => ({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: t }] },
          outputDimensionality: 1536,
        })),
      }),
    },
  );
  if (!res.ok) throw new Error(`Embedding failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { embeddings: { values: number[] }[] };
  return json.embeddings.map((e) => {
    // Gemini embeddings are not normalized when a custom dimensionality is used.
    const norm = Math.sqrt(e.values.reduce((s, v) => s + v * v, 0)) || 1;
    return e.values.map((v) => v / norm);
  });
}


function extractPassages(row: unknown): { field: string; texts: string[] } {
  const r = row as Record<string, unknown> | undefined;
  // MS MARCO shape: { passages: { passage_text: string[] , ... }, query, answers }
  const passages = r?.["passages"] as Record<string, unknown> | undefined;
  const pt = passages?.["passage_text"];
  if (Array.isArray(pt) && pt.length) {
    return { field: "passages.passage_text", texts: pt.filter((t): t is string => typeof t === "string") };
  }
  const generic: string[] = [];
  collectText(row, generic);
  return { field: "heuristic-scan", texts: generic };
}

export const ingestCorpus = createServerFn({ method: "POST" }).handler(async () => {
  const errors: string[] = [];
  const embedKey = process.env["EMBEDDING_API_KEY"];
  if (!embedKey)
    return {
      rows_fetched: 0,
      chunks_created: 0,
      sample_chunk_text: "",
      total_chunks_in_table: 0,
      errors: ["EMBEDDING_API_KEY is not set"],
    };

  let rows: { row_idx?: number; row?: unknown }[] = [];
  let datasetUsed = "";
  try {
    const result = await withRetry(async () => {
      for (const url of [HF_PRIMARY, HF_FALLBACK]) {
        const res = await fetch(url);
        if (!res.ok) {
          console.error("[ingest-corpus] HF fetch not ok", url, res.status, (await res.text()).slice(0, 300));
          continue;
        }
        const json = (await res.json()) as {
          rows?: { row_idx?: number; row?: unknown }[];
          error?: string;
        };
        if (json.error) console.error("[ingest-corpus] HF error field:", json.error);
        if (json.rows?.length) return { rows: json.rows, url };
        console.error("[ingest-corpus] HF returned no rows for", url);
      }
      throw new Error("No rows returned from Hugging Face");
    });
    rows = result.rows;
    datasetUsed = result.url;
  } catch (e) {
    console.error("[ingest-corpus] HF fetch failed entirely:", e);
    return {
      rows_fetched: 0,
      chunks_created: 0,
      sample_chunk_text: "",
      total_chunks_in_table: 0,
      errors: [String(e)],
    };
  }

  console.log("[ingest-corpus] dataset used:", datasetUsed);
  console.log("[ingest-corpus] rows fetched:", rows.length);
  const firstRow = rows[0]?.row as Record<string, unknown> | undefined;
  console.log("[ingest-corpus] first row keys:", firstRow ? Object.keys(firstRow) : "none");
  console.log("[ingest-corpus] first row full content:", JSON.stringify(firstRow).slice(0, 4000));

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let chunksCreated = 0;
  let sampleChunkText = "";
  let loggedField = false;

  for (const r of rows.slice(0, 50)) {
    const { field, texts } = extractPassages(r.row);
    if (!loggedField) {
      console.log("[ingest-corpus] passage text field used:", field, "| passages in first row:", texts.length);
      loggedField = true;
    }
    const passage = texts.slice(0, 3).join("\n\n");
    if (!passage) {
      console.warn("[ingest-corpus] no passage text for row", r.row_idx);
      continue;
    }
    const sourceDocId = String(r.row_idx ?? chunksCreated);
    const pieces = chunkWords(passage);
    try {
      const vectors = await withRetry(() => embed(pieces, embedKey));
      const { error } = await supabaseAdmin.from("chunks").insert(
        pieces.map((text, i) => ({
          text,
          embedding: JSON.stringify(vectors[i]) as unknown as string,
          source_doc_id: sourceDocId,
        })),
      );
      if (error) {
        console.error("[ingest-corpus] supabase insert error:", JSON.stringify(error));
        errors.push(`insert: ${error.message}`);
      } else {
        chunksCreated += pieces.length;
        if (!sampleChunkText) sampleChunkText = pieces[0]!.slice(0, 400);
      }
    } catch (e) {
      console.error("[ingest-corpus] embedding/insert exception for row", r.row_idx, e);
      errors.push(`embed: ${String(e)}`);
    }
  }

  const { count, error: countError } = await supabaseAdmin
    .from("chunks")
    .select("*", { count: "exact", head: true });
  if (countError) {
    console.error("[ingest-corpus] count query error:", JSON.stringify(countError));
    errors.push(`count: ${countError.message}`);
  }

  console.log("[ingest-corpus] chunks created this run:", chunksCreated, "| total in table:", count);

  return {
    rows_fetched: rows.length,
    chunks_created: chunksCreated,
    sample_chunk_text: sampleChunkText,
    total_chunks_in_table: count ?? 0,
    errors,
  };
});

export const debugRetrieval = createServerFn({ method: "POST" })
  .inputValidator((input: { query?: string }) => input ?? {})
  .handler(async ({ data }) => {
    const query = data.query || "What is the boiling point of water?";
    const embedKey = process.env["EMBEDDING_API_KEY"];
    if (!embedKey) return { query, matches: [], error: "EMBEDDING_API_KEY is not set" };
    try {
      const [queryVector] = await withRetry(() => embed([query], embedKey));
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: matches, error } = await supabaseAdmin.rpc("match_chunks", {
        query_embedding: JSON.stringify(queryVector) as unknown as string,
        match_count: 5,
      });
      if (error) throw new Error(error.message);
      return {
        query,
        matches: (matches ?? []).map((m: { text: string; similarity: number; source_doc_id: string | null }) => ({
          text: m.text,
          similarity: m.similarity,
          source_doc_id: m.source_doc_id,
        })),
      };
    } catch (e) {
      console.error("[debug-retrieval] failed:", e);
      return { query, matches: [], error: String(e) };
    }
  });

export const speechToText = createServerFn({ method: "POST" })
  .inputValidator((input: { audioBase64: string; mimeType?: string }) => input)
  .handler(async ({ data }) => {
    const key = process.env["SARVAM_API_KEY"];
    if (!key) return { transcript: "", error: "SARVAM_API_KEY is not set" };
    try {
      const bytes = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0));
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: data.mimeType ?? "audio/wav" }), "recording.wav");
      form.append("model", "saarika:v2.5");
      const res = await withRetry(async () => {
        const r = await fetch("https://api.sarvam.ai/speech-to-text", {
          method: "POST",
          headers: { "api-subscription-key": key },
          body: form,
        });
        if (!r.ok) throw new Error(`Sarvam STT failed: ${r.status} ${await r.text()}`);
        return r;
      });
      const json = (await res.json()) as { transcript?: string };
      return { transcript: json.transcript ?? "" };
    } catch (e) {
      return { transcript: "", error: String(e) };
    }
  });

export const ragAnswer = createServerFn({ method: "POST" })
  .inputValidator((input: { query: string; sttMs?: number }) => input)
  .handler(async ({ data }) => {
    const started = Date.now();
    const embedKey = process.env["EMBEDDING_API_KEY"];
    const lovableKey = process.env["LOVABLE_API_KEY"];
    if (!embedKey || !lovableKey) {
      return { answer: "", sources: [], latency: null, error: "Missing API keys" };
    }

    try {
      const retrievalStart = Date.now();
      const [queryVector] = await withRetry(() => embed([data.query], embedKey));
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: matches, error } = await supabaseAdmin.rpc("match_chunks", {
        query_embedding: JSON.stringify(queryVector) as unknown as string,
        match_count: 5,
      });
      if (error) throw new Error(error.message);
      const sources = (matches ?? []).map((m: { text: string }) => m.text);
      const retrieval_ms = Date.now() - retrievalStart;

      const generationStart = Date.now();
      const completion = await withRetry(async () => {
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-3.5-flash",
            messages: [
              {
                role: "system",
                content:
                  "Answer only using the provided context. If the answer isn't in the context, say 'I don't have enough information to answer that.'",
              },
              { role: "user", content: `Context:\n${sources.join("\n---\n")}\n\nQuestion: ${data.query}` },
            ],
          }),
        });
        if (!r.ok) throw new Error(`LLM failed: ${r.status} ${await r.text()}`);
        return r;
      });
      const json = (await completion.json()) as { choices?: { message?: { content?: string } }[] };
      const answer = json.choices?.[0]?.message?.content ?? "";
      const generation_ms = Date.now() - generationStart;
      const total_ms = Date.now() - started + (data.sttMs ?? 0);

      const latency = { stt_ms: data.sttMs ?? 0, retrieval_ms, generation_ms, total_ms };
      await supabaseAdmin.from("latency_logs").insert({ query_text: data.query, ...latency });

      return { answer, sources, latency };
    } catch (e) {
      return { answer: "", sources: [], latency: null, error: String(e) };
    }
  });
