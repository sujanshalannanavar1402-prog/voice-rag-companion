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

export type PendingChunk = { text: string; source_doc_id: string };

/** Deterministic chunk list for the bundled corpus, so batches are stable across calls. */
export async function buildAllChunks(): Promise<PendingChunk[]> {
  const { MSMARCO_XI_CORPUS } = await import("@/lib/corpus");
  const all: PendingChunk[] = [];
  for (const row of MSMARCO_XI_CORPUS) {
    for (const piece of chunkWords(row.text)) {
      if (piece.trim()) all.push({ text: piece, source_doc_id: row.id });
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
