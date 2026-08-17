import { createServerFn } from "@tanstack/react-start";
import {
  EMBED_BATCH_SIZE,
  OFF_TOPIC_THRESHOLD,
  buildAllChunks,
  checkGroundedness,
  cosineSimilarity,
  embed,
  getCorpusCentroid,
  matchUnsafe,
  withRetry,
} from "@/lib/rag.server";

export const ingestPrepare = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const allChunks = await buildAllChunks();
  const { error } = await supabaseAdmin.from("chunks").delete().not("id", "is", null);
  if (error) console.error("[ingest] clear error:", JSON.stringify(error));
  console.log("[ingest] cleared table; chunks to embed:", allChunks.length);
  return {
    total_rows: (await import("@/lib/corpus")).MSMARCO_XI_CORPUS.length,
    total_chunks: allChunks.length,
    batch_size: EMBED_BATCH_SIZE,
    total_batches: Math.ceil(allChunks.length / EMBED_BATCH_SIZE),
    error: error ? error.message : null,
  };
});

export const ingestBatch = createServerFn({ method: "POST" })
  .inputValidator((input: { batchIndex: number }) => input)
  .handler(async ({ data }) => {
    const embedKey = process.env["EMBEDDING_API_KEY"];
    if (!embedKey) return { inserted: 0, attempted: 0, sample: "", error: "EMBEDDING_API_KEY is not set" };
    const allChunks = await buildAllChunks();
    const start = data.batchIndex * EMBED_BATCH_SIZE;
    const batch = allChunks.slice(start, start + EMBED_BATCH_SIZE);
    if (batch.length === 0) return { inserted: 0, attempted: 0, sample: "", error: null as string | null };
    try {
      const vectors = await embed(batch.map((c) => c.text), embedKey);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin.from("chunks").insert(
        batch.map((c, j) => ({
          text: c.text,
          embedding: JSON.stringify(vectors[j]) as unknown as string,
          source_doc_id: c.source_doc_id,
        })),
      );
      if (error) {
        console.error("[ingest] insert error:", JSON.stringify(error));
        return { inserted: 0, attempted: batch.length, sample: "", error: `insert: ${error.message}` };
      }
      console.log(`[ingest] batch ${data.batchIndex + 1}: inserted ${batch.length}`);
      return {
        inserted: batch.length,
        attempted: batch.length,
        sample: batch[0]!.text.slice(0, 400),
        error: null as string | null,
      };
    } catch (e) {
      console.error("[ingest] batch failed:", data.batchIndex, e);
      return { inserted: 0, attempted: batch.length, sample: "", error: `embed: ${String(e)}` };
    }
  });

export const chunkCount = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count, error } = await supabaseAdmin.from("chunks").select("*", { count: "exact", head: true });
  return { total_chunks_in_table: count ?? 0, error: error ? error.message : null };
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
  grounded: boolean | null;
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
      grounded: null,
      retrieved: [],
      notes: [],
    };
    const embedKey = process.env["EMBEDDING_API_KEY"];
    const lovableKey = process.env["LOVABLE_API_KEY"];
    if (!embedKey || !lovableKey) {
      return { answer: "", sources: [], latency: null, debug, error: "Missing API keys" };
    }

    const logRun = async (
      latency: { stt_ms: number; retrieval_ms: number; generation_ms: number; total_ms: number },
    ) => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("latency_logs").insert({
        query_text: data.query,
        ...latency,
        refused: debug.refused,
        refusal_reason: debug.refusal_reason,
        grounded: debug.grounded,
      });
    };

    try {
      debug.guardrail_ran = true;

      // Guardrail 1: unsafe keyword list.
      const unsafeHit = matchUnsafe(data.query);
      if (unsafeHit) {
        debug.refused = true;
        debug.refusal_reason = "unsafe";
        debug.notes.push(`Blocked by unsafe keyword list (matched "${unsafeHit}").`);
        const total_ms = Date.now() - started + (data.sttMs ?? 0);
        const latency = { stt_ms: data.sttMs ?? 0, retrieval_ms: 0, generation_ms: 0, total_ms };
        await logRun(latency);
        return {
          answer: "I can't help with that request.",
          sources: [],
          latency,
          debug,
        };
      }

      const retrievalStart = Date.now();
      const [queryVector] = await withRetry(() => embed([data.query], embedKey));

      // Guardrail 2: off-topic check against the corpus centroid.
      const centroid = await getCorpusCentroid();
      if (centroid && queryVector) {
        const sim = cosineSimilarity(queryVector, centroid);
        debug.centroid_similarity = sim;
        if (sim < OFF_TOPIC_THRESHOLD) {
          debug.refused = true;
          debug.refusal_reason = "off_topic";
          debug.notes.push(
            `Centroid similarity ${sim.toFixed(3)} is below the ${OFF_TOPIC_THRESHOLD} off-topic threshold.`,
          );
          const total_ms = Date.now() - started + (data.sttMs ?? 0);
          const latency = {
            stt_ms: data.sttMs ?? 0,
            retrieval_ms: Date.now() - retrievalStart,
            generation_ms: 0,
            total_ms,
          };
          await logRun(latency);
          return {
            answer: "That question looks outside the topics covered by the loaded corpus.",
            sources: [],
            latency,
            debug,
          };
        }
        debug.notes.push(`Centroid similarity ${sim.toFixed(3)} passed the off-topic threshold.`);
      } else {
        debug.notes.push("Corpus centroid unavailable (no embeddings loaded) — off-topic check skipped.");
      }

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
      const context = sources.join("\n---\n");
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
                  "Answer the question using only the information in the provided context. The context may describe a more specific case of the topic asked about — if so, use it to answer as best you can, noting the specific scope if relevant. Only say 'I don't have enough information to answer that' if the context is genuinely unrelated to the question, not merely more specific or narrowly scoped than the question.",
              },
              { role: "user", content: `Context:\n${context}\n\nQuestion: ${data.query}` },
            ],
          }),
        });
        if (!r.ok) throw new Error(`LLM failed: ${r.status} ${await r.text()}`);
        return r;
      });
      const json = (await completion.json()) as { choices?: { message?: { content?: string } }[] };
      let answer = json.choices?.[0]?.message?.content ?? "";

      // Guardrail 3: groundedness check on the generated answer.
      if (answer.trim() && sources.length > 0) {
        try {
          const verdict = await checkGroundedness(answer, context, lovableKey);
          debug.groundedness_ran = true;
          debug.groundedness_result = verdict;
          debug.grounded = verdict === "YES";
          if (verdict === "NO") {
            answer = "I don't have enough information to answer that.";
            debug.notes.push("Groundedness check returned NO — answer overridden.");
          } else {
            debug.notes.push("Groundedness check returned YES.");
          }
        } catch (e) {
          debug.notes.push(`Groundedness check failed: ${String(e)}`);
        }
      } else {
        debug.notes.push("Groundedness check skipped (empty answer or no retrieved context).");
      }

      const generation_ms = Date.now() - generationStart;
      const total_ms = Date.now() - started + (data.sttMs ?? 0);

      const latency = { stt_ms: data.sttMs ?? 0, retrieval_ms, generation_ms, total_ms };
      await logRun(latency);

      return { answer, sources, latency, debug };

    } catch (e) {
      debug.notes.push(`Pipeline threw: ${String(e)}`);
      return { answer: "", sources: [], latency: null, debug, error: String(e) };
    }
  });

