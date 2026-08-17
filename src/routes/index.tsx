import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import {
  corpusStats,
  debugRetrieval,
  ingestPrepare,
  ingestBatch,
  chunkCount,
  ragAnswer,
  speechToText,
  RagDebug,
} from "@/lib/rag.functions";
import { Navbar } from "@/components/voice-rag/Navbar";
import { HeroSection } from "@/components/voice-rag/HeroSection";
import { VoiceInteractionCard } from "@/components/voice-rag/VoiceInteractionCard";
import { TranscriptCard } from "@/components/voice-rag/TranscriptCard";
import { AnswerCard } from "@/components/voice-rag/AnswerCard";
import { SourcesAccordion } from "@/components/voice-rag/SourcesAccordion";
import { KnowledgeBaseDialog } from "@/components/voice-rag/KnowledgeBaseDialog";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Voice RAG Companion — Speak Naturally, Get Grounded Answers" },
      {
        name: "description",
        content:
          "A modern voice-enabled retrieval augmented generation companion: speak naturally, retrieve verified knowledge, and receive grounded answers with sub-second latency.",
      },
      { property: "og:title", content: "Voice RAG Companion" },
      {
        property: "og:description",
        content:
          "Speak naturally, retrieve verified knowledge, and receive grounded answers with sub-second latency.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const data = new Float32Array(length);
  let offset = 0;
  for (const c of chunks) {
    data.set(c, offset);
    offset += c.length;
  }
  const buffer = new ArrayBuffer(44 + data.length * 2);
  const view = new DataView(buffer);
  const writeStr = (pos: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(pos + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + data.length * 2, true);
  writeStr(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function Index() {
  const prepareFn = useServerFn(ingestPrepare);
  const batchFn = useServerFn(ingestBatch);
  const countFn = useServerFn(chunkCount);
  const stt = useServerFn(speechToText);
  const answerFn = useServerFn(ragAnswer);
  const debugFn = useServerFn(debugRetrieval);
  const statsFn = useServerFn(corpusStats);

  const [loadStatus, setLoadStatus] = useState("");
  const [loadResult, setLoadResult] = useState<{
    total_chunks_in_table: number;
    errors: string[];
  } | null>(null);
  const [cachedChunkCount, setCachedChunkCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [kbDialogOpen, setKbDialogOpen] = useState(false);

  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [latency, setLatency] = useState<{
    stt_ms: number;
    retrieval_ms: number;
    generation_ms: number;
    total_ms: number;
  } | null>(null);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const [ragDebug, setRagDebug] = useState<RagDebug | null>(null);

  const [debugBusy, setDebugBusy] = useState(false);
  const [debugResult, setDebugResult] = useState<Awaited<ReturnType<typeof debugRetrieval>> | null>(
    null,
  );
  const [stats, setStats] = useState<Awaited<ReturnType<typeof corpusStats>> | null>(null);
  const [statsBusy, setStatsBusy] = useState(false);

  const recorder = useRef<{ stop: () => Promise<Blob> } | null>(null);

  // Fetch initial chunk count on mount
  useEffect(() => {
    let isMounted = true;
    countFn()
      .then((res) => {
        if (isMounted && !res.error) {
          setCachedChunkCount(res.total_chunks_in_table);
        }
      })
      .catch((e) => {
        console.warn("Could not retrieve initial chunk count:", e);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  async function handleStats() {
    setStatsBusy(true);
    try {
      const res = await statsFn();
      setStats(res);
      if (res && typeof res.total_chunks === "number") {
        setCachedChunkCount(res.total_chunks);
      }
    } catch (e) {
      setStats({ total_chunks: 0, samples: [], error: String(e) });
    }
    setStatsBusy(false);
  }

  async function handleLoad() {
    setLoading(true);
    setLoadResult(null);
    const allErrors: string[] = [];
    try {
      setLoadStatus("Preparing ingestion…");
      const prep = await prepareFn();
      if (prep.error) allErrors.push(`Prepare: ${prep.error}`);
      const totalBatches = prep.total_batches;

      if (totalBatches > 0) {
        const CONCURRENCY = 4;
        let completedBatches = 0;
        const queue = Array.from({ length: totalBatches }, (_, i) => i);

        const worker = async () => {
          while (queue.length > 0) {
            const batchIndex = queue.shift();
            if (batchIndex === undefined) break;

            try {
              const res = await batchFn({ data: { batchIndex } });
              if (res.error) allErrors.push(`Batch ${batchIndex + 1}: ${res.error}`);
            } catch (e) {
              allErrors.push(`Batch ${batchIndex + 1} threw: ${String(e)}`);
            }

            completedBatches++;
            setLoadStatus(`Embedding batch ${completedBatches} of ${totalBatches}…`);
          }
        };

        const workers = Array.from({ length: Math.min(CONCURRENCY, totalBatches) }, () => worker());
        await Promise.all(workers);
      }

      setLoadStatus("Finalizing…");
      const countRes = await countFn();
      if (countRes.error) allErrors.push(`Count: ${countRes.error}`);

      setLoadResult({ total_chunks_in_table: countRes.total_chunks_in_table, errors: allErrors });
      setCachedChunkCount(countRes.total_chunks_in_table);
      setLoadStatus("");
    } catch (e) {
      setLoadStatus(`Failed: ${String(e)}`);
    }
    setLoading(false);
  }

  async function handleDebugRetrieval(query?: string) {
    setDebugBusy(true);
    setDebugResult(null);
    const q = query || "What is the boiling point of water?";
    try {
      setDebugResult(await debugFn({ data: { query: q } }));
    } catch (e) {
      setDebugResult({ query: q, matches: [], error: String(e) });
    }
    setDebugBusy(false);
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      node.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      source.connect(node);
      node.connect(ctx.destination);
      recorder.current = {
        stop: async () => {
          stream.getTracks().forEach((t) => t.stop());
          node.disconnect();
          source.disconnect();
          const blob = encodeWav(chunks, ctx.sampleRate);
          await ctx.close();
          return blob;
        },
      };
      setRecording(true);
    } catch (e) {
      console.error("Microphone access failed:", e);
      setTranscript(
        "Microphone access was denied or is unavailable. Please check browser permissions.",
      );
    }
  }

  async function stopRecording() {
    setRecording(false);
    const blob = await recorder.current?.stop();
    recorder.current = null;
    if (!blob || blob.size < 2048) {
      setTranscript("That recording was empty — please try again.");
      return;
    }
    setBusy(true);
    setTranscript("Transcribing voice…");
    setAnswer("");
    setSources([]);
    setLatency(null);
    setTotalMs(null);
    setRagDebug(null);
    try {
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.readAsDataURL(blob);
      });
      const sttStart = performance.now();
      const sttRes = await stt({ data: { audioBase64: base64, mimeType: "audio/wav" } });
      const sttMs = Math.round(performance.now() - sttStart);
      if (!sttRes.transcript) {
        setTranscript(
          sttRes.error ? `Speech-to-text failed: ${sttRes.error}` : "No speech detected.",
        );
        setBusy(false);
        return;
      }
      setTranscript(sttRes.transcript);
      const res = await answerFn({ data: { query: sttRes.transcript, sttMs } });
      setAnswer(res.error ? `Error: ${res.error}` : res.answer);
      setSources(res.sources ?? []);
      setLatency(res.latency ?? null);
      setTotalMs(res.latency?.total_ms ?? null);
      setRagDebug(res.debug ?? null);
    } catch (e) {
      setAnswer(`Error: ${String(e)}`);
    }
    setBusy(false);
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground flex flex-col selection:bg-indigo-500/20 selection:text-indigo-200">
      {/* Top Navbar */}
      <Navbar
        isRecording={recording}
        isBusy={busy}
        chunkCount={cachedChunkCount}
        onOpenKnowledgeBase={() => setKbDialogOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col items-center gap-8 sm:gap-10">
        {/* Hero Section */}
        <HeroSection />

        {/* Centerpiece Voice Interaction Card */}
        <VoiceInteractionCard
          recording={recording}
          busy={busy}
          onStartRecording={startRecording}
          onStopRecording={stopRecording}
        />

        {/* Results Stream (Transcript, Answer, Sources) */}
        {(transcript || answer || (sources && sources.length > 0)) && (
          <div className="w-full space-y-5 sm:space-y-6">
            {/* Transcript Card */}
            {transcript && <TranscriptCard transcript={transcript} />}

            {/* Answer Card */}
            {answer && (
              <AnswerCard
                answer={answer}
                latency={latency}
                totalMs={totalMs}
                ragDebug={ragDebug}
                sourcesCount={sources.length}
              />
            )}

            {/* Sources Accordion */}
            {sources.length > 0 && <SourcesAccordion sources={sources} ragDebug={ragDebug} />}
          </div>
        )}
      </main>

      {/* Knowledge Base Modal / Sheet */}
      <KnowledgeBaseDialog
        open={kbDialogOpen}
        onOpenChange={setKbDialogOpen}
        loading={loading}
        loadStatus={loadStatus}
        loadResult={loadResult}
        onLoad={handleLoad}
        stats={stats}
        statsBusy={statsBusy}
        onFetchStats={handleStats}
        debugResult={debugResult}
        debugBusy={debugBusy}
        onDebugRetrieval={handleDebugRetrieval}
      />

      {/* Footer */}
      <footer className="w-full border-t border-border/30 py-6 text-center text-xs text-muted-foreground/70">
        <p>Voice RAG Companion · MS MARCO Knowledge Retrieval · Sub-second Latency</p>
      </footer>
    </div>
  );
}
