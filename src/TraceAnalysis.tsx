import { useEffect, useRef, useState } from "react";
import { authenticatedFetch } from "./AuthGate";

type Event = { metadata?: unknown; spanId: string; name: string; durationMs: number };
type Result = { evidenceOnly: boolean; model: string; summary: string; findings: { kind: string; text: string; spanIds: string[] }[];
  nextSteps: string[]; limitations: string[]; context: { totalEvents: number; includedEvents: number; omittedEvents: number; synthetic: boolean; detailsIncluded: number; truncatedFields: number; redactedFields: number; omittedFields: number; notes: string[] } };

export function TraceAnalysis({ api, runId, events }: { api: string; runId: string; events: Event[] }) {
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!loading) return;
    const start = Date.now(); setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [loading]);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const analyze = async () => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError("");
    try {
      const response = await authenticatedFetch(`${api}/v1/telemetry/traces/${encodeURIComponent(runId)}/analyze`, { method: "POST", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Analysis failed. Try again.");
      if (!controller.signal.aborted) setResult(body as Result);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Analysis failed. Try again."); }
    finally { if (request.current === controller) { request.current = null; setLoading(false); } }
  };
  const cancel = () => { request.current?.abort(); request.current = null; setLoading(false); setError(""); };
  const reveal = (spanId: string) => {
    window.dispatchEvent(new CustomEvent("trace-analysis-reveal"));
    setTimeout(() => { const span = document.getElementById(`trace-span-${spanId}`); span?.scrollIntoView({ block: "center" }); span?.focus({ preventScroll: true }); }, 0);
  };
  return <section className="trace-analysis" aria-label="AI trace analysis">
    <div className="analysis-toolbar"><button type="button" className="secondary" disabled={loading} onClick={() => void analyze()}>{loading ? "Analyzing…" : result ? "Analyze again" : "Analyze with AI"}</button>{loading && <button type="button" className="text-button" onClick={cancel}>Cancel</button>}</div>
    {events.some(event => event.metadata && typeof event.metadata === "object" && (event.metadata as Record<string, unknown>).synthetic === true) && <p className="analysis-caption">Synthetic test trace: these events simulate activity.</p>}
    <p className="analysis-caption">Uses local Ollama on the collector server. Includes recorded prompts, responses, tool details and code excerpts where available. Common credential patterns are redacted.</p>
    {loading && <p role="status" className="analysis-caption">Analyzing locally… {elapsed}s elapsed. You can cancel while the model is working.</p>}
    {error && <p role="alert" className="analysis-error">{error}</p>}
    {result && <div className="analysis-result" aria-live="polite"><p>{result.summary}</p>
      {result.findings.map((finding, i) => <div className="analysis-finding" key={i}><b>{finding.kind === "possible_cause" ? "Possible cause · unconfirmed" : "Observation"}</b><p>{finding.text}</p><div className="analysis-evidence">{finding.spanIds.map(id => { const span = events.find(event => event.spanId === id); return <button type="button" className="text-button" key={id} title={`Span ${id}`} onClick={() => reveal(id)}>{span?.name ?? id}{span ? ` · ${span.durationMs.toLocaleString()} ms` : ""} ↗</button>; })}</div></div>)}
      {result.nextSteps.length > 0 && <><h3>What to check next</h3><ul>{result.nextSteps.map((step, i) => <li key={i}>{step}</li>)}</ul></>}
      {result.limitations.length > 0 && <><h3>Missing evidence</h3><ul>{result.limitations.map((limit, i) => <li key={i}>{limit}</li>)}</ul></>}
      <p className="analysis-caption">{result.evidenceOnly ? "Evidence-only summary; unsupported cause suggestions omitted." : "AI-generated explanation."} Model: {result.model}. Check findings against the trace. {result.context.omittedEvents > 0 ? `${result.context.includedEvents} of ${result.context.totalEvents} events included; failures, their parents and nearby steps were prioritized.` : `${result.context.includedEvents} events included.`}</p>
      <details className="analysis-context"><summary>Context sent to AI</summary><p className="analysis-caption">{result.context.detailsIncluded} detail fields included · {result.context.truncatedFields} shortened · {result.context.redactedFields} redacted · {result.context.omittedFields} omitted.</p><ul>{result.context.notes.map((note, i) => <li key={i}>{note}</li>)}</ul><p className="analysis-caption">Only content already recorded in the trace is available. Prompts and model responses require OpenKode’s OPENKODE_TELEMETRY_CAPTURE_LLM_CONTENT=true setting for future runs. Redaction is best-effort; avoid recording secrets.</p></details>
    </div>}
  </section>;
}
