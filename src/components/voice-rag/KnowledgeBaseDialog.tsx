import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Database,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Search,
  Layers,
  ChevronRight,
} from "lucide-react";
import { corpusStats, debugRetrieval } from "@/lib/rag.functions";
import { cn } from "@/lib/utils";

interface KnowledgeBaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  loadStatus: string;
  loadResult: { total_chunks_in_table: number; errors: string[] } | null;
  onLoad: () => Promise<void>;
  stats: Awaited<ReturnType<typeof corpusStats>> | null;
  statsBusy: boolean;
  onFetchStats: () => Promise<void>;
  debugResult: Awaited<ReturnType<typeof debugRetrieval>> | null;
  debugBusy: boolean;
  onDebugRetrieval: (query?: string) => Promise<void>;
}

export function KnowledgeBaseDialog({
  open,
  onOpenChange,
  loading,
  loadStatus,
  loadResult,
  onLoad,
  stats,
  statsBusy,
  onFetchStats,
  debugResult,
  debugBusy,
  onDebugRetrieval,
}: KnowledgeBaseDialogProps) {
  const [testQuery, setTestQuery] = useState("What is the boiling point of water?");

  const handleRunTest = () => {
    onDebugRetrieval(testQuery);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto border-border/80 bg-background/95 backdrop-blur-2xl p-6 sm:p-7 shadow-2xl">
        <DialogHeader className="mb-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-primary">
              <Database className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold text-foreground">
                Knowledge Base & Ingestion
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Manage your MS MARCO vector index, corpus embeddings, and verify RAG retrieval.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Ingestion Action Card */}
          <div className="rounded-xl border border-border/70 bg-card/60 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-foreground">Corpus Embedding Pipeline</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Embeds and synchronizes knowledge chunks to Supabase pgvector.
                </p>
              </div>

              <Button
                onClick={onLoad}
                disabled={loading}
                className="shrink-0 h-9 gap-2 font-medium cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Loading…</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Load corpus</span>
                  </>
                )}
              </Button>
            </div>

            {/* Ingestion Status / Progress */}
            {loadStatus && (
              <div className="flex items-center gap-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 p-3 text-xs text-indigo-400">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                <span className="font-mono">{loadStatus}</span>
              </div>
            )}

            {/* Load Result Output */}
            {loadResult && (
              <div className="rounded-lg bg-secondary/50 border border-border/50 p-4 space-y-2 text-xs">
                <div className="flex items-center gap-2 text-emerald-400 font-medium">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{loadResult.total_chunks_in_table} chunks loaded & indexed</span>
                </div>
                {loadResult.errors.length > 0 && (
                  <div className="pt-2 border-t border-border/40 text-rose-400 space-y-1">
                    <p className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Ingestion notices:
                    </p>
                    <p className="font-mono text-[11px] whitespace-pre-wrap">
                      {loadResult.errors.join("\n")}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Corpus Statistics */}
          <div className="rounded-xl border border-border/70 bg-card/60 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-foreground">Indexed Vector Chunks</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Inspect random samples stored in pgvector.
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={onFetchStats}
                disabled={statsBusy}
                className="h-8 text-xs cursor-pointer"
              >
                {statsBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh Stats"}
              </Button>
            </div>

            {stats && (
              <div className="rounded-lg bg-secondary/40 border border-border/40 p-4 space-y-3 text-xs">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Total chunks in database:</span>
                  <span className="font-mono font-semibold text-foreground">
                    {stats.total_chunks}
                  </span>
                </div>

                {stats.samples.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-border/40">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      Sample Chunks:
                    </p>
                    {stats.samples.map((s, idx) => (
                      <div
                        key={s.id || idx}
                        className="rounded bg-background/60 p-2.5 text-[11px] text-muted-foreground font-mono space-y-1 border border-border/30"
                      >
                        <div className="text-indigo-400 font-semibold">
                          #{idx + 1} · {s.source_doc_id ?? "unknown doc"}
                        </div>
                        <div className="text-foreground/90 whitespace-pre-wrap line-clamp-2">
                          {s.preview}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Debug Retrieval Tester */}
          <div className="rounded-xl border border-border/70 bg-card/60 p-5 space-y-4">
            <div>
              <h4 className="text-sm font-semibold text-foreground">
                Debug: Vector Similarity Test
              </h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Simulate semantic retrieval against current vector store.
              </p>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={testQuery}
                onChange={(e) => setTestQuery(e.target.value)}
                placeholder="Enter a test question…"
                className="flex-1 rounded-lg border border-border/80 bg-secondary/50 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <Button
                size="sm"
                onClick={handleRunTest}
                disabled={debugBusy}
                className="h-8.5 text-xs cursor-pointer"
              >
                {debugBusy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>

            {debugResult && (
              <div className="rounded-lg bg-secondary/40 border border-border/40 p-4 space-y-2 text-xs">
                <p className="text-muted-foreground font-medium">
                  Query: <span className="text-foreground font-mono">"{debugResult.query}"</span>
                </p>
                {debugResult.error && (
                  <p className="text-rose-400 font-mono text-[11px]">{debugResult.error}</p>
                )}
                {debugResult.matches.length === 0 && !debugResult.error && (
                  <p className="text-muted-foreground">No matches found in vector table.</p>
                )}
                {debugResult.matches.map((m, idx) => (
                  <div key={idx} className="border-t border-border/30 pt-2 space-y-1 text-[11px]">
                    <div className="flex items-center justify-between text-muted-foreground font-mono">
                      <span>
                        #{idx + 1} · {m.source_doc_id ?? "—"}
                      </span>
                      <span className="text-indigo-400 font-semibold">
                        sim: {m.similarity?.toFixed(4)}
                      </span>
                    </div>
                    <p className="text-foreground/90 whitespace-pre-wrap font-sans">{m.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
