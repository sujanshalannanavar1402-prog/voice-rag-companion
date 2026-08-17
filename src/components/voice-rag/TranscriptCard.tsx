import React from "react";
import { User, Quote } from "lucide-react";

interface TranscriptCardProps {
  transcript: string;
}

export function TranscriptCard({ transcript }: TranscriptCardProps) {
  if (!transcript) return null;

  return (
    <div className="w-full max-w-xl mx-auto rounded-xl border border-border/70 bg-card/40 p-5 backdrop-blur-md transition-all animate-in fade-in-50 duration-300">
      <div className="flex items-center gap-2 mb-2.5">
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <User className="h-3 w-3" />
        </div>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          You said
        </span>
      </div>
      <p className="text-base sm:text-lg font-medium text-foreground leading-relaxed pl-1">
        “{transcript}”
      </p>
    </div>
  );
}
