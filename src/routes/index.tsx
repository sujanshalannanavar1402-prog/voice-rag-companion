import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { debugRetrieval, ingestCorpus, ragAnswer, speechToText } from "@/lib/rag.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Voice RAG MVP — Ask questions by voice" },
      {
        name: "description",
        content:
          "A minimal voice-enabled retrieval augmented generation demo: load a corpus, speak a question, get a grounded answer with latency.",
      },
      { property: "og:title", content: "Voice RAG MVP — Ask questions by voice" },
      {
        property: "og:description",
        content: "Load a corpus, speak a question, get a grounded answer with latency timings.",
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

function Index() {
  const ingest = useServerFn(ingestCorpus);
  const stt = useServerFn(speechToText);
  const answerFn = useServerFn(ragAnswer);
  const debugFn = useServerFn(debugRetrieval);

  const [loadStatus, setLoadStatus] = useState("");
  const [loadResult, setLoadResult] = useState<Awaited<ReturnType<typeof ingestCorpus>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [answer, setAnswer] = useState("");
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const [debugBusy, setDebugBusy] = useState(false);
  const [debugResult, setDebugResult] = useState<Awaited<ReturnType<typeof debugRetrieval>> | null>(null);

  const recorder = useRef<{ stop: () => Promise<Blob> } | null>(null);

  async function handleLoad() {
    setLoading(true);
    setLoadStatus("Loading data…");
    setLoadResult(null);
    try {
      const res = await ingest();
      setLoadResult(res);
      setLoadStatus("");
    } catch (e) {
      setLoadStatus(`Failed: ${String(e)}`);
    }
    setLoading(false);
  }

  async function handleDebugRetrieval() {
    setDebugBusy(true);
    setDebugResult(null);
    try {
      setDebugResult(await debugFn({ data: { query: "What is the boiling point of water?" } }));
    } catch (e) {
      setDebugResult({ query: "What is the boiling point of water?", matches: [], error: String(e) });
    }
    setDebugBusy(false);
  }

  async function startRecording() {
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
    setTranscript("Transcribing…");
    setAnswer("");
    setTotalMs(null);
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
        setTranscript(sttRes.error ? `Speech-to-text failed: ${sttRes.error}` : "No speech detected.");
        setBusy(false);
        return;
      }
      setTranscript(sttRes.transcript);
      const res = await answerFn({ data: { query: sttRes.transcript, sttMs } });
      setAnswer(res.error ? `Error: ${res.error}` : res.answer);
      setTotalMs(res.latency?.total_ms ?? null);
    } catch (e) {
      setAnswer(`Error: ${String(e)}`);
    }
    setBusy(false);
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-14">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Voice RAG MVP</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Load a corpus, then ask a question with your voice.
      </p>

      <section className="mt-8 rounded-xl border border-border p-5">
        <button
          onClick={handleLoad}
          disabled={loading}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load Data"}
        </button>
        {loadStatus && <p className="mt-3 text-sm text-muted-foreground">{loadStatus}</p>}
      </section>

      <section className="mt-6 rounded-xl border border-border p-5">
        <button
          onClick={recording ? stopRecording : startRecording}
          disabled={busy}
          className={`flex h-16 w-16 items-center justify-center rounded-full text-2xl transition-colors disabled:opacity-50 ${
            recording ? "bg-destructive text-destructive-foreground" : "bg-secondary text-secondary-foreground"
          }`}
          aria-label={recording ? "Stop recording" : "Start recording"}
        >
          {recording ? "■" : "🎤"}
        </button>
        <p className="mt-3 text-xs text-muted-foreground">
          {recording ? "Recording — tap to stop" : busy ? "Thinking…" : "Tap the mic and ask a question"}
        </p>

        {transcript && (
          <p className="mt-5 text-sm text-foreground">
            <span className="text-muted-foreground">You said: </span>
            {transcript}
          </p>
        )}

        {answer && (
          <div className="mt-4 rounded-lg bg-muted p-4">
            <p className="whitespace-pre-wrap text-sm text-foreground">{answer}</p>
            {totalMs !== null && (
              <p className="mt-2 text-xs text-muted-foreground">{totalMs} ms total</p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
