import React, { useEffect } from "react";
import { Mic, Square, Loader2, Sparkles, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface VoiceInteractionCardProps {
  recording: boolean;
  busy: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  disabled?: boolean;
}

export function VoiceInteractionCard({
  recording,
  busy,
  onStartRecording,
  onStopRecording,
  disabled = false,
}: VoiceInteractionCardProps) {
  // Spacebar toggle handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if user is inside an input, textarea, or contentEditable element
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }

      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        if (busy || disabled) return;
        if (recording) {
          onStopRecording();
        } else {
          onStartRecording();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [recording, busy, disabled, onStartRecording, onStopRecording]);

  const handleMicClick = () => {
    if (busy || disabled) return;
    if (recording) {
      onStopRecording();
    } else {
      onStartRecording();
    }
  };

  return (
    <div className="relative w-full max-w-xl mx-auto">
      {/* Background ambient gradient glow */}
      <div
        className={cn(
          "absolute -inset-1 rounded-3xl opacity-30 blur-2xl transition-all duration-700 pointer-events-none",
          recording
            ? "bg-gradient-to-r from-rose-500/40 via-red-500/30 to-amber-500/40 opacity-70"
            : busy
              ? "bg-gradient-to-r from-indigo-500/30 via-purple-500/30 to-cyan-500/30 opacity-60"
              : "bg-gradient-to-r from-indigo-500/20 via-zinc-500/10 to-cyan-500/20 opacity-30",
        )}
      />

      {/* Main Container Card */}
      <div className="relative rounded-2xl border border-border/80 bg-card/60 p-8 sm:p-10 backdrop-blur-xl shadow-2xl transition-all">
        {/* Card Header */}
        <div className="text-center mb-8">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            {recording ? "Listening to you…" : busy ? "Synthesizing answer…" : "Ask your question"}
          </h2>
          <p className="mt-1.5 text-xs sm:text-sm text-muted-foreground">
            {recording
              ? "Speak your question clearly. Tap the button when finished."
              : busy
                ? "Transcribing voice and searching relevant knowledge chunks…"
                : "Press the microphone and start speaking"}
          </p>
        </div>

        {/* Center Microphone Button */}
        <div className="flex flex-col items-center justify-center my-4">
          <div className="relative flex items-center justify-center">
            {/* Concentric ripple rings for recording state */}
            {recording && (
              <>
                <span className="absolute h-36 w-36 rounded-full border border-rose-500/40 bg-rose-500/10 animate-pulse-ring pointer-events-none" />
                <span className="absolute h-36 w-36 rounded-full border border-rose-500/30 bg-rose-500/5 animate-pulse-ring-delayed pointer-events-none" />
              </>
            )}

            {/* Spinner ring for busy state */}
            {busy && (
              <div className="absolute -inset-3 rounded-full border-2 border-dashed border-indigo-400/50 animate-spin pointer-events-none" />
            )}

            {/* Main Interactive Mic Button */}
            <button
              onClick={handleMicClick}
              disabled={busy || disabled}
              aria-label={
                recording
                  ? "Stop recording"
                  : busy
                    ? "Processing speech and RAG"
                    : "Start recording"
              }
              className={cn(
                "relative flex h-24 w-24 sm:h-28 sm:w-28 items-center justify-center rounded-full transition-all duration-300 cursor-pointer shadow-lg outline-none focus-visible:ring-4 focus-visible:ring-ring/50",
                recording
                  ? "bg-rose-600 text-white shadow-rose-600/40 hover:bg-rose-500 hover:scale-105 active:scale-95 ring-4 ring-rose-500/30"
                  : busy
                    ? "bg-secondary text-muted-foreground cursor-not-allowed opacity-80"
                    : "bg-gradient-to-b from-zinc-100 to-zinc-300 text-zinc-950 shadow-white/10 hover:shadow-indigo-500/20 hover:scale-105 active:scale-95 ring-1 ring-white/20",
              )}
            >
              {recording ? (
                <Square className="h-8 w-8 fill-current text-white transition-transform" />
              ) : busy ? (
                <Loader2 className="h-9 w-9 animate-spin text-indigo-400" />
              ) : (
                <Mic className="h-9 w-9 text-zinc-900 transition-transform group-hover:scale-110" />
              )}
            </button>
          </div>

          {/* State Text beneath mic */}
          <div className="mt-5 text-center">
            <span
              className={cn(
                "text-xs sm:text-sm font-medium transition-colors",
                recording
                  ? "text-rose-400 font-semibold"
                  : busy
                    ? "text-indigo-400"
                    : "text-muted-foreground",
              )}
            >
              {recording ? "Listening… Tap to stop" : busy ? "Thinking…" : "Tap to speak"}
            </span>
          </div>
        </div>

        {/* Keyboard shortcut hint */}
        <div className="mt-6 flex items-center justify-center gap-1.5 pt-4 border-t border-border/40 text-[11px] text-muted-foreground/80">
          <span>Press</span>
          <kbd className="inline-flex h-5 items-center rounded border border-border bg-muted/60 px-1.5 font-mono text-[10px] font-medium text-foreground">
            Space
          </kbd>
          <span>to {recording ? "finish" : "speak"}</span>
        </div>
      </div>
    </div>
  );
}
