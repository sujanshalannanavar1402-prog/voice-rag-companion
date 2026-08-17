import React, { useState } from "react";
import {
  Sparkles,
  Zap,
  CheckCircle2,
  ShieldAlert,
  Copy,
  Check,
  BookOpen,
  Layers,
} from "lucide-react";
import { RagDebug } from "@/lib/rag.functions";
import { cn } from "@/lib/utils";

interface LatencyData {
  stt_ms: number;
  retrieval_ms: number;
  generation_ms: number;
  total_ms: number;
}

interface AnswerCardProps {
  answer: string;
  latency: LatencyData | null;
  totalMs: number | null;
  ragDebug: RagDebug | null;
  sourcesCount?: number;
}

export function AnswerCard({
  answer,
  latency,
  totalMs,
  ragDebug,
  sourcesCount = 0,
}: AnswerCardProps) {
  const [copied, setCopied] = useState(false);

  if (!answer) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy text:", e);
    }
  };

  const isGrounded = ragDebug?.grounded === true;
  const isRefused = ragDebug?.refused === true;

  // Use actual total_ms from latency or fallback to totalMs state
  const actualTotalMs = latency?.total_ms ?? totalMs;

  return (
    <div className="w-full max-w-xl mx-auto rounded-2xl border border-border/80 bg-card/80 p-6 sm:p-7 backdrop-blur-xl shadow-xl transition-all animate-in fade-in-50 duration-400">
      {/* Top Header Row */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 shadow-inner">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-foreground">Answer</span>

          {/* Groundedness / Guardrail status badge */}
          {isGrounded ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400 border border-emerald-500/20">
              <CheckCircle2 className="h-3 w-3" />
              Grounded response
            </span>
          ) : isRefused ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-400 border border-amber-500/20">
              <ShieldAlert className="h-3 w-3" />
              {ragDebug?.refusal_reason === "off_topic" ? "Off-topic" : "Guardrail"}
            </span>
          ) : null}
        </div>

        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-secondary/40 text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors cursor-pointer"
          title="Copy answer"
          aria-label="Copy answer to clipboard"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Answer content */}
      <div className="text-foreground text-sm sm:text-base leading-relaxed whitespace-pre-wrap font-normal">
        {answer}
      </div>

      {/* Bottom Metadata & Latency Bar */}
      <div className="mt-6 pt-4 border-t border-border/50 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        {/* Latency Chips */}
        <div className="flex flex-wrap items-center gap-2">
          {actualTotalMs !== null && (
            <span className="inline-flex items-center gap-1 rounded-md bg-secondary/80 px-2.5 py-1 font-mono font-medium text-foreground border border-border/60">
              <Zap className="h-3 w-3 text-amber-400 fill-amber-400" />
              <span>{actualTotalMs} ms</span>
            </span>
          )}

          {latency && (
            <div className="hidden sm:flex items-center gap-2 text-[11px] font-mono text-muted-foreground/80">
              {latency.stt_ms > 0 && <span>stt: {latency.stt_ms}ms</span>}
              {latency.retrieval_ms > 0 && <span>retrieval: {latency.retrieval_ms}ms</span>}
              {latency.generation_ms > 0 && <span>llm: {latency.generation_ms}ms</span>}
            </div>
          )}
        </div>

        {/* Sources retrieved count if present */}
        {sourcesCount > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5 text-indigo-400" />
            <span>{sourcesCount} sources retrieved</span>
          </div>
        )}
      </div>
    </div>
  );
}
