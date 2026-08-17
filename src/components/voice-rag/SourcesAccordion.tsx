import React, { useState } from "react";
import { ChevronDown, BookOpen, ExternalLink, FileText } from "lucide-react";
import { RagDebug } from "@/lib/rag.functions";
import { cn } from "@/lib/utils";

interface SourcesAccordionProps {
  sources: string[];
  ragDebug: RagDebug | null;
}

export function SourcesAccordion({ sources, ragDebug }: SourcesAccordionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (!sources || sources.length === 0) return null;

  return (
    <div className="w-full max-w-xl mx-auto rounded-xl border border-border/70 bg-card/40 backdrop-blur-md transition-all overflow-hidden">
      {/* Header Button Toggle */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between p-4 text-left transition-colors hover:bg-secondary/40 cursor-pointer"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-secondary text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5 text-indigo-400" />
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Retrieved Sources ({sources.length})
          </span>
        </div>

        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-180 text-foreground",
          )}
        />
      </button>

      {/* Collapsible Content */}
      {isOpen && (
        <div className="p-4 pt-0 space-y-3 border-t border-border/40 divide-y divide-border/30">
          {sources.map((text, i) => {
            const meta = ragDebug?.retrieved?.[i];
            const similarity = meta?.similarity;
            const docId = meta?.source_doc_id;
            const isItemExpanded = expandedIndex === i;

            return (
              <div key={i} className="pt-3 first:pt-3">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-4 w-4 items-center justify-center rounded bg-secondary text-[10px] font-mono font-semibold text-muted-foreground">
                      #{i + 1}
                    </span>
                    {docId && (
                      <span className="text-[11px] font-mono text-muted-foreground truncate max-w-[200px]">
                        {docId}
                      </span>
                    )}
                  </div>

                  {similarity !== undefined && similarity !== null && (
                    <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-mono font-medium text-indigo-400 border border-indigo-500/20">
                      {(similarity * 100).toFixed(1)}% match
                    </span>
                  )}
                </div>

                <div className="rounded-lg bg-secondary/30 p-3 text-xs text-muted-foreground/90 leading-relaxed font-sans">
                  <p className={cn(!isItemExpanded && text.length > 200 && "line-clamp-3")}>
                    {text}
                  </p>
                  {text.length > 200 && (
                    <button
                      onClick={() => setExpandedIndex(isItemExpanded ? null : i)}
                      className="mt-2 text-[11px] font-medium text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
                    >
                      {isItemExpanded ? "Show less" : "Read full chunk"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
