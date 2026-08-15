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

  const { MSMARCO_XI_CORPUS } = await import("@/lib/corpus");
  const rows = MSMARCO_XI_CORPUS.slice(0, 300);
  console.log("[ingest-corpus] dataset: ai4bharat/MSMARCO-XI (bundled passages)");
  console.log("[ingest-corpus] rows available:", MSMARCO_XI_CORPUS.length, "| using:", rows.length);
  console.log("[ingest-corpus] first row:", JSON.stringify(rows[0]).slice(0, 500));

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Fresh load each time so the table always reflects this dataset.
  const { error: delError } = await supabaseAdmin
    .from("chunks")
    .delete()
    .not("id", "is", null);
  if (delError) {
    console.error("[ingest-corpus] delete error:", JSON.stringify(delError));
    errors.push(`delete: ${delError.message}`);
  }

  let chunksCreated = 0;
  let sampleChunkText = "";

  // Build all chunks first, then embed/insert in batches.
  const allChunks: { text: string; source_doc_id: string }[] = [];
  for (const row of rows) {
    for (const piece of chunkWords(row.text)) {
      if (piece.trim()) allChunks.push({ text: piece, source_doc_id: row.id });
    }
  }
  console.log("[ingest-corpus] chunks to embed:", allChunks.length);

  const BATCH = 20;
  for (let i = 0; i < allChunks.length; i += BATCH) {
    const batch = allChunks.slice(i, i + BATCH);
    try {
      const vectors = await withRetry(() => embed(batch.map((c) => c.text), embedKey));
      const { error } = await supabaseAdmin.from("chunks").insert(
        batch.map((c, j) => ({
          text: c.text,
          embedding: JSON.stringify(vectors[j]) as unknown as string,
          source_doc_id: c.source_doc_id,
        })),
      );
      if (error) {
        console.error("[ingest-corpus] supabase insert error:", JSON.stringify(error));
        errors.push(`insert: ${error.message}`);
      } else {
        chunksCreated += batch.length;
        if (!sampleChunkText) sampleChunkText = batch[0]!.text.slice(0, 400);
      }
    } catch (e) {
      console.error("[ingest-corpus] embedding/insert exception at batch", i, e);
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

export type RagDebug = {
  refused: boolean;
  refusal_reason: "off_topic" | "unsafe" | null;
  centroid_similarity: number | null;
  guardrail_ran: boolean;
  groundedness_ran: boolean;
  groundedness_result: "YES" | "NO" | null;
  retrieved: { similarity: number | null; source_doc_id: string | null; preview: string }[];
  notes: string[];
};

export const corpusStats = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count, error: countError } = await supabaseAdmin
      .from("chunks")
      .select("*", { count: "exact", head: true });
    if (countError) throw new Error(countError.message);
    const total = count ?? 0;
    const offset = total > 5 ? Math.floor(Math.random() * (total - 5)) : 0;
    const { data: rows, error } = await supabaseAdmin
      .from("chunks")
      .select("id, text, source_doc_id")
      .range(offset, offset + 4);
    if (error) throw new Error(error.message);
    return {
      total_chunks: total,
      samples: (rows ?? []).map((r) => ({
        id: r.id as string,
        source_doc_id: (r.source_doc_id as string | null) ?? null,
        preview: String(r.text ?? "").slice(0, 100),
      })),
      error: null as string | null,
    };
  } catch (e) {
    return { total_chunks: 0, samples: [], error: String(e) };
  }
});

export const ragAnswer = createServerFn({ method: "POST" })
  .inputValidator((input: { query: string; sttMs?: number }) => input)
  .handler(async ({ data }) => {
    const started = Date.now();
    const debug: RagDebug = {
      refused: false,
      refusal_reason: null,
      centroid_similarity: null,
      guardrail_ran: false,
      groundedness_ran: false,
      groundedness_result: null,
      retrieved: [],
      notes: [
        "No off-topic/unsafe guardrail is implemented in this pipeline, so refused is always false.",
        "No groundedness (YES/NO) check is implemented, so it never runs.",
      ],
    };
    const embedKey = process.env["EMBEDDING_API_KEY"];
    const lovableKey = process.env["LOVABLE_API_KEY"];
    if (!embedKey || !lovableKey) {
      return { answer: "", sources: [], latency: null, debug, error: "Missing API keys" };
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
      const rows = (matches ?? []) as {
        text: string;
        similarity: number;
        source_doc_id: string | null;
      }[];
      const sources = rows.map((m) => m.text);
      debug.retrieved = rows.map((m) => ({
        similarity: m.similarity ?? null,
        source_doc_id: m.source_doc_id ?? null,
        preview: String(m.text ?? "").slice(0, 100),
      }));
      if (rows.length === 0) debug.notes.push("Retrieval returned 0 chunks — the chunks table may be empty.");
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

      return { answer, sources, latency, debug };
    } catch (e) {
      debug.notes.push(`Pipeline threw: ${String(e)}`);
      return { answer: "", sources: [], latency: null, debug, error: String(e) };
    }
  });

