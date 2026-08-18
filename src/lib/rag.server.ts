/** Server-only helpers for the RAG pipeline. */

export const EMBED_BATCH_SIZE = 25;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return await fn();
  }
}

export function chunkWords(text: string, size = 200, overlap = 30): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= size) return [words.join(" ")];
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += size - overlap) {
    chunks.push(words.slice(i, i + size).join(" "));
    if (i + size >= words.length) break;
  }
  return chunks;
}

export type ChunkStrategy = "fixed_overlap" | "semantic" | "parent_child";

export type PendingChunk = {
  text: string;
  source_doc_id: string;
  chunk_strategy: ChunkStrategy;
  parent_text: string | null;
};

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function bagOfWords(text: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[a-z0-9']+/g) ?? []) {
    map.set(w, (map.get(w) ?? 0) + 1);
  }
  return map;
}

/** Lexical cosine similarity between two sentences (no embedding API cost). */
export function lexicalSimilarity(a: string, b: string): number {
  const va = bagOfWords(a);
  const vb = bagOfWords(b);
  let dot = 0;
  for (const [k, v] of va) dot += v * (vb.get(k) ?? 0);
  const na = Math.sqrt([...va.values()].reduce((s, v) => s + v * v, 0));
  const nb = Math.sqrt([...vb.values()].reduce((s, v) => s + v * v, 0));
  return na && nb ? dot / (na * nb) : 0;
}

/**
 * Semantic chunking: keep appending sentences while they stay similar to the
 * running chunk; start a new chunk once similarity drops below the threshold.
 */
export function chunkSemantic(text: string, threshold = 0.75, maxWords = 220): string[] {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];
  const chunks: string[] = [];
  let current = sentences[0]!;
  for (let i = 1; i < sentences.length; i++) {
    const sentence = sentences[i]!;
    const sim = lexicalSimilarity(current, sentence);
    const wouldOverflow = (current + " " + sentence).split(/\s+/).length > maxWords;
    if (sim >= threshold && !wouldOverflow) {
      current += " " + sentence;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }
  chunks.push(current);
  return chunks.filter((c) => c.trim());
}

/** Parent/child chunking: small child chunks that carry the full passage as parent_text. */
export function chunkParentChild(text: string, childSize = 60, overlap = 10): string[] {
  return chunkWords(text, childSize, overlap);
}

/** Only the first N passages get the three-strategy treatment, to keep ingestion tractable. */
export const INGEST_PASSAGE_LIMIT = 400;

/** Deterministic chunk list for the bundled corpus, so batches are stable across calls. */
export async function buildAllChunks(): Promise<PendingChunk[]> {
  const { MSMARCO_XI_CORPUS } = await import("@/lib/corpus");
  const all: PendingChunk[] = [];
  for (const row of MSMARCO_XI_CORPUS.slice(0, INGEST_PASSAGE_LIMIT)) {
    for (const piece of chunkWords(row.text)) {
      if (piece.trim())
        all.push({ text: piece, source_doc_id: row.id, chunk_strategy: "fixed_overlap", parent_text: null });
    }
    for (const piece of chunkSemantic(row.text)) {
      if (piece.trim())
        all.push({ text: piece, source_doc_id: row.id, chunk_strategy: "semantic", parent_text: null });
    }
    for (const piece of chunkParentChild(row.text)) {
      if (piece.trim())
        all.push({
          text: piece,
          source_doc_id: row.id,
          chunk_strategy: "parent_child",
          parent_text: row.text,
        });
    }
  }
  return all;
}


class RateLimitError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message);
  }
}

/** Parses Google's `retryDelay` (e.g. "31s") out of a 429 body. */
function parseRetryDelayMs(body: string): number {
  const match = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (match) return Math.ceil(Number(match[1]) * 1000);
  return 5000;
}

async function embedOnce(texts: string[], apiKey: string): Promise<number[][]> {
  // OpenAI-style keys start with "sk-"; anything else is treated as a Google
  // Generative Language API key (Gemini embeddings, 1536 dims).
  if (apiKey.startsWith("sk-")) {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: texts }),
    });
    if (res.status === 429) {
      const body = await res.text();
      throw new RateLimitError(`429 ${body.slice(0, 300)}`, parseRetryDelayMs(body));
    }
    if (!res.ok) throw new Error(`Embedding failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding);
  }

  // Batch endpoint: all texts of a batch go out in a SINGLE HTTP request.
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
  if (res.status === 429) {
    const body = await res.text();
    throw new RateLimitError(`429 ${body.slice(0, 300)}`, parseRetryDelayMs(body));
  }
  if (!res.ok) throw new Error(`Embedding failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { embeddings: { values: number[] }[] };
  return json.embeddings.map((e) => {
    // Gemini embeddings are not normalized when a custom dimensionality is used.
    const norm = Math.sqrt(e.values.reduce((s, v) => s + v * v, 0)) || 1;
    return e.values.map((v) => v / norm);
  });
}

/** Embeds a batch in one request, honouring 429 `retryDelay` (+1s buffer), up to 3 retries. */
export async function embed(texts: string[], apiKey: string, maxRetries = 3): Promise<number[][]> {
  let attempt = 0;
  for (;;) {
    try {
      return await embedOnce(texts, apiKey);
    } catch (e) {
      attempt++;
      if (attempt > maxRetries) throw e;
      if (e instanceof RateLimitError) {
        const wait = e.retryAfterMs + 1000;
        console.warn(`[embed] rate limited, waiting ${wait}ms before retry ${attempt}/${maxRetries}`);
        await sleep(wait);
      } else {
        console.warn(`[embed] error, retry ${attempt}/${maxRetries}:`, String(e));
        await sleep(2000);
      }
    }
  }
}

/* ---------- Guardrails ---------- */

export const UNSAFE_KEYWORDS = [
  "bomb",
  "explosive",
  "make a gun",
  "kill someone",
  "how to kill",
  "suicide",
  "self-harm",
  "child porn",
  "meth",
  "poison someone",
  "hack into",
  "credit card dump",
];

export function matchUnsafe(query: string): string | null {
  const q = query.toLowerCase();
  return UNSAFE_KEYWORDS.find((k) => q.includes(k)) ?? null;
}

export const OFF_TOPIC_THRESHOLD = 0.3;

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

let centroidCache: { vector: number[]; at: number } | null = null;
const CENTROID_TTL_MS = 10 * 60 * 1000;

/** Mean of a sample of stored chunk embeddings, cached in-process. */
export async function getCorpusCentroid(): Promise<number[] | null> {
  if (centroidCache && Date.now() - centroidCache.at < CENTROID_TTL_MS) return centroidCache.vector;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("chunks").select("embedding").limit(200);
  if (error) {
    console.error("[guardrail] centroid load failed:", error.message);
    return null;
  }
  const vectors: number[][] = [];
  for (const row of data ?? []) {
    const raw = row.embedding;
    if (!raw) continue;
    try {
      const parsed = typeof raw === "string" ? (JSON.parse(raw) as number[]) : (raw as unknown as number[]);
      if (Array.isArray(parsed) && parsed.length) vectors.push(parsed);
    } catch {
      /* skip unparsable rows */
    }
  }
  if (vectors.length === 0) return null;
  const dims = vectors[0]!.length;
  const sum = new Array<number>(dims).fill(0);
  for (const v of vectors) for (let i = 0; i < dims; i++) sum[i]! += v[i] ?? 0;
  const centroid = sum.map((s) => s / vectors.length);
  centroidCache = { vector: centroid, at: Date.now() };
  return centroid;
}

/** Asks the LLM whether the answer is fully supported by the context. Returns "YES" | "NO". */
export async function checkGroundedness(
  answer: string,
  context: string,
  lovableKey: string,
): Promise<"YES" | "NO"> {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3.5-flash",
      messages: [
        {
          role: "system",
          content:
            "You verify groundedness. Reply with exactly one word: YES if every factual claim in the ANSWER is supported by the CONTEXT, otherwise NO.",
        },
        { role: "user", content: `CONTEXT:\n${context}\n\nANSWER:\n${answer}` },
      ],
    }),
  });
  if (!r.ok) throw new Error(`Groundedness check failed: ${r.status} ${await r.text()}`);
  const json = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  const out = (json.choices?.[0]?.message?.content ?? "").trim().toUpperCase();
  return out.startsWith("NO") ? "NO" : "YES";
}
