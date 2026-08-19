import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { corpusStats, debugRetrieval, ingestPrepare, ingestProgress, ingestBatch, chunkCount, ragAnswer, speechToText } from "@/lib/rag.functions";


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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function Index() {
  const prepareFn = useServerFn(ingestPrepare);
  const progressFn = useServerFn(ingestProgress);
  const batchFn = useServerFn(ingestBatch);
  const countFn = useServerFn(chunkCount);
  const stt = useServerFn(speechToText);
  const answerFn = useServerFn(ragAnswer);
  const debugFn = useServerFn(debugRetrieval);
  const statsFn = useServerFn(corpusStats);

  const [loadStatus, setLoadStatus] = useState("");
  const [loadResult, setLoadResult] = useState<{ total_chunks_in_table: number; errors: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [answer, setAnswer] = useState("");
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const [debugBusy, setDebugBusy] = useState(false);
  const [debugResult, setDebugResult] = useState<Awaited<ReturnType<typeof debugRetrieval>> | null>(null);
  const [ragDebug, setRagDebug] = useState<Awaited<ReturnType<typeof ragAnswer>>["debug"] | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof corpusStats>> | null>(null);
  const [statsBusy, setStatsBusy] = useState(false);

  const recorder = useRef<{ stop: () => Promise<Blob> } | null>(null);

  async function handleStats() {
    setStatsBusy(true);
    try {
      setStats(await statsFn());
    } catch (e) {
      setStats({ total_chunks: 0, samples: [], error: String(e) });
    }
    setStatsBusy(false);
  }

  async function handleLoad(fresh = false) {
    setLoading(true);
    setLoadResult(null);
    const allErrors: string[] = [];
    try {
      let totalBatches: number;
      let startBatch = 0;
      if (fresh) {
        setLoadStatus("Clearing table and preparing ingestion…");
        const prep = await prepareFn({ data: { clear: true } });
        if (prep.error) allErrors.push(`Prepare: ${prep.error}`);
        totalBatches = prep.total_batches;
      } else {
        setLoadStatus("Checking progress…");
        const prog = await progressFn();
        if (prog.error) allErrors.push(`Progress: ${prog.error}`);
        totalBatches = prog.total_batches;
        startBatch = prog.next_batch_index;
        if (startBatch > 0) setLoadStatus(`Resuming at batch ${startBatch + 1} of ${totalBatches}…`);
      }

      for (let batchIndex = startBatch; batchIndex < totalBatches; batchIndex++) {
        setLoadStatus(`Embedding batch ${batchIndex + 1} of ${totalBatches}…`);
        try {
          const res = await batchFn({ data: { batchIndex } });
          if (res.error) allErrors.push(`Batch ${batchIndex + 1}: ${res.error}`);
        } catch (e) {
          allErrors.push(`Batch ${batchIndex + 1} threw: ${String(e)}`);
        }
        if (batchIndex < totalBatches - 1) {
          await sleep(2000);
        }
      }

      setLoadStatus("Finalizing…");
      const countRes = await countFn();
      if (countRes.error) allErrors.push(`Count: ${countRes.error}`);

      setLoadResult({ total_chunks_in_table: countRes.total_chunks_in_table, errors: allErrors });
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
        setTranscript(sttRes.error ? `Speech-to-text failed: ${sttRes.error}` : "No speech detected.");
        setBusy(false);
        return;
      }
      setTranscript(sttRes.transcript);
      const res = await answerFn({ data: { query: sttRes.transcript, sttMs } });
      setAnswer(res.error ? `Error: ${res.error}` : res.answer);
      setTotalMs(res.latency?.total_ms ?? null);
      setRagDebug(res.debug ?? null);
    } catch (e) {
      setAnswer(`Error: ${String(e)}`);
    }
    setBusy(false);
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-14">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Voice RAG MVP</h1>
        <Link to="/analytics" className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground">
          Analytics →
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Load a corpus, then ask a question with your voice.
      </p>

      <section className="mt-8 rounded-xl border border-border p-5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleLoad(false)}
            disabled={loading}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load Data (resumes)"}
          </button>
          <button
            onClick={() => handleLoad(true)}
            disabled={loading}
            className="rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            Clear &amp; reload from scratch
          </button>
        </div>
        {loadStatus && <p className="mt-3 text-sm text-muted-foreground">{loadStatus}</p>}
        {loadResult && (
          <div className="mt-4 space-y-1 rounded-lg bg-muted p-4 text-sm text-foreground">
            <p>Total chunks in table: {loadResult.total_chunks_in_table}</p>
            {loadResult.errors.length > 0 && (
              <p className="text-xs text-destructive">Errors: {loadResult.errors.join(" | ")}</p>
            )}
          </div>
        )}

        <button
          onClick={handleDebugRetrieval}
          disabled={debugBusy}
          className="mt-4 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          {debugBusy ? "Testing…" : "Debug: Test Retrieval"}
        </button>
        {debugResult && (
          <div className="mt-3 space-y-2 rounded-lg bg-muted p-4 text-xs">
            <p className="text-muted-foreground">Query: {debugResult.query}</p>
            {debugResult.error && <p className="text-destructive">{debugResult.error}</p>}
            {debugResult.matches.length === 0 && !debugResult.error && <p>No matches returned.</p>}
            {debugResult.matches.map((m, i) => (
              <div key={i} className="border-t border-border pt-2">
                <p className="text-muted-foreground">
                  #{i + 1} · similarity {m.similarity?.toFixed(4)} · doc {m.source_doc_id ?? "—"}
                </p>
                <p className="whitespace-pre-wrap text-foreground">{m.text}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-border p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">Corpus Stats</h2>
          <button
            onClick={handleStats}
            disabled={statsBusy}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {statsBusy ? "Checking…" : "Refresh Stats"}
          </button>
        </div>
        {stats && (
          <div className="mt-3 space-y-2 text-xs">
            <p className="text-foreground">Total chunks in table: {stats.total_chunks}</p>
            {stats.error && <p className="text-destructive">{stats.error}</p>}
            {stats.samples.length > 0 && (
              <div className="mt-2 space-y-2 rounded-lg bg-muted p-3">
                {stats.samples.map((s) => (
                  <div key={s.id} className="border-t border-border pt-2 first:border-t-0 first:pt-0">
                    <p className="text-muted-foreground">doc {s.source_doc_id ?? "—"}</p>
                    <p className="whitespace-pre-wrap text-foreground">{s.preview}…</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-border p-5">
        <h2 className="text-sm font-medium text-foreground">Ask by voice</h2>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={recording ? stopRecording : startRecording}
            disabled={busy}
            className={`rounded-full px-5 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
              recording
                ? "bg-destructive text-destructive-foreground hover:opacity-90"
                : "bg-primary text-primary-foreground hover:opacity-90"
            }`}
          >
            {recording ? "Stop" : busy ? "Working…" : "Start Recording"}
          </button>
          {totalMs !== null && (
            <span className="text-xs text-muted-foreground">Total latency: {totalMs} ms</span>
          )}
        </div>

        {transcript && (
          <div className="mt-4 rounded-lg bg-muted p-4 text-sm">
            <p className="text-xs font-medium text-muted-foreground">Transcript</p>
            <p className="mt-1 text-foreground">{transcript}</p>
          </div>
        )}

        {answer && (
          <div className="mt-3 rounded-lg bg-muted p-4 text-sm">
            <p className="text-xs font-medium text-muted-foreground">Answer</p>
            <p className="mt-1 whitespace-pre-wrap text-foreground">{answer}</p>
          </div>
        )}

        {ragDebug && (
          <div className="mt-3">
            <button
              onClick={() => setShowDebug((v) => !v)}
              className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              {showDebug ? "Hide debug info" : "Show debug info"}
            </button>
            {showDebug && (
              <div className="mt-2 space-y-1 rounded-lg bg-muted p-4 text-xs text-foreground">
                <p>Refused: {String(ragDebug.refused)}</p>
                <p>Groundedness check ran: {String(ragDebug.groundedness_ran)}</p>
                <p>Grounded: {String(ragDebug.grounded)}</p>
                {ragDebug.notes.length > 0 && (
                  <ul className="list-disc pl-4">
                    {ragDebug.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
