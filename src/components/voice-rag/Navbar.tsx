import React from "react";
import { Mic, Database, Sparkles, CheckCircle2, Radio, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface NavbarProps {
  isRecording: boolean;
  isBusy: boolean;
  chunkCount: number | null;
  onOpenKnowledgeBase: () => void;
}

export function Navbar({ isRecording, isBusy, chunkCount, onOpenKnowledgeBase }: NavbarProps) {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl transition-all">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 via-primary/10 to-transparent border border-white/10 shadow-inner">
            <Mic className="h-4 w-4 text-primary" />
            <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight text-foreground">Voice RAG</span>
            <span className="rounded-full bg-secondary/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground border border-border/50">
              Companion
            </span>
          </div>
        </div>

        {/* Status & Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Live Status indicator */}
          <div className="hidden sm:flex items-center gap-2 rounded-full bg-secondary/60 px-3 py-1 text-xs text-muted-foreground border border-border/40 backdrop-blur-sm">
            {isRecording ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                </span>
                <span className="text-rose-400 font-medium">Recording audio</span>
              </>
            ) : isBusy ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-indigo-400" />
                <span className="text-indigo-400 font-medium">Processing RAG</span>
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-emerald-500/80 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
                <span>System Ready</span>
              </>
            )}
          </div>

          {/* Knowledge Base Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenKnowledgeBase}
            className="h-8 gap-2 rounded-lg border-border/60 bg-secondary/40 text-xs font-medium text-foreground hover:bg-secondary/90 hover:border-border transition-all cursor-pointer"
          >
            <Database className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Knowledge Base</span>
            {chunkCount !== null && chunkCount > 0 && (
              <span className="rounded-md bg-primary/10 px-1.5 py-0.2 text-[10px] font-semibold text-primary">
                {chunkCount}
              </span>
            )}
          </Button>
        </div>
      </div>
    </header>
  );
}
