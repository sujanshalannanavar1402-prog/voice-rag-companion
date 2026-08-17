import React from "react";
import { Sparkles, Radio } from "lucide-react";

export function HeroSection() {
  return (
    <section className="text-center pt-8 pb-6 px-4">
      {/* Small Badge */}
      <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-secondary/50 px-3.5 py-1 text-xs text-muted-foreground backdrop-blur-md shadow-xs mb-4">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-60"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
        </span>
        <span className="font-medium text-foreground/90">AI voice assistant · Ready</span>
      </div>

      {/* Main Headline */}
      <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-foreground max-w-2xl mx-auto leading-[1.15]">
        Ask anything. <br />
        <span className="bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
          Get grounded answers.
        </span>
      </h1>

      {/* Subheadline */}
      <p className="mt-3 text-sm sm:text-base text-muted-foreground max-w-xl mx-auto leading-relaxed">
        Speak naturally. Voice RAG retrieves relevant context and answers using your knowledge base.
      </p>
    </section>
  );
}
