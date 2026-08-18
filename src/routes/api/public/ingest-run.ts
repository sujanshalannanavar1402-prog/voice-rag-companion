import { createFileRoute } from "@tanstack/react-router";
import { EMBED_BATCH_SIZE, buildAllChunks, embed } from "@/lib/rag.server";

/** Internal maintenance endpoint: runs a slice of ingestion batches server-side (resumable). */
export const Route = createFileRoute("/api/public/ingest-run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const from = Number(url.searchParams.get("from") ?? "0");
        const count = Number(url.searchParams.get("count") ?? "5");
        const embedKey = process.env["EMBEDDING_API_KEY"];
        if (!embedKey) return Response.json({ error: "EMBEDDING_API_KEY missing" }, { status: 500 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const all = await buildAllChunks();
        const totalBatches = Math.ceil(all.length / EMBED_BATCH_SIZE);
        const results: { batch: number; inserted: number; skipped: boolean; error: string | null }[] = [];
        for (let b = from; b < Math.min(from + count, totalBatches); b++) {
          const batch = all.slice(b * EMBED_BATCH_SIZE, (b + 1) * EMBED_BATCH_SIZE);
          if (batch.length === 0) break;
          const probe = await supabaseAdmin
            .from("chunks")
            .select("id")
            .eq("text", batch[0]!.text)
            .eq("source_doc_id", `${batch[0]!.source_doc_id}::${batch[0]!.chunk_strategy}`)
            .limit(1);
          if ((probe.data?.length ?? 0) > 0) {
            results.push({ batch: b, inserted: 0, skipped: true, error: null });
            continue;
          }
          try {
            const vectors = await embed(batch.map((c) => c.text), embedKey);
            const { error } = await supabaseAdmin.from("chunks").insert(
              batch.map((c, j) => ({
                text: c.text,
                embedding: JSON.stringify(vectors[j]) as unknown as string,
                source_doc_id: `${c.source_doc_id}::${c.chunk_strategy}`,
                chunk_strategy: c.chunk_strategy,
                parent_text: c.parent_text,
              })),
            );
            results.push({ batch: b, inserted: error ? 0 : batch.length, skipped: false, error: error?.message ?? null });
          } catch (e) {
            results.push({ batch: b, inserted: 0, skipped: false, error: String(e) });
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
        const { count: inTable } = await supabaseAdmin.from("chunks").select("*", { count: "exact", head: true });
        return Response.json({ total_batches: totalBatches, total_chunks_in_table: inTable ?? 0, results });
      },
    },
  },
});
