import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const api = import.meta.env.VITE_OPENCOLLECTOR_URL ?? "http://127.0.0.1:3000";
type Run = { runId: string; startedAt: string; endedAt: string; durationMs: number; status: "ok" | "error"; spanCount: number };
type Overview = { runCount: number; successCount: number; errorCount: number; spanCount: number; p50DurationMs: number; p95DurationMs: number };
type TraceEvent = { eventId: string; runId: string; spanId: string; parentSpanId?: string; type: string; name: string; startedAt: string; endedAt: string; durationMs: number; status: string; metadata?: unknown; llm?: Record<string, unknown> };
type TraceNode = { event: TraceEvent; children: TraceNode[] };

function query(filters: Record<string, string>) { const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)); return params.size ? `?${params}` : ""; }
async function read<T>(path: string): Promise<T> { const response = await fetch(`${api}${path}`); if (!response.ok) throw new Error(await response.text()); return response.json() as Promise<T>; }
const duration = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${value}ms`;
const formatJson = (value: unknown) => JSON.stringify(value, null, 2) ?? "undefined";
const last30Days = () => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

function App() {
  const [filters, setFilters] = useState({ status: "", type: "", name: "", runId: "", from: "", to: "" });
  const [view, setView] = useState("all");
  const [overview, setOverview] = useState<Overview>();
  const [runs, setRuns] = useState<Run[]>([]);
  const [tracePage, setTracePage] = useState(1);
  const [traceTotal, setTraceTotal] = useState(0);
  const [loadingMoreTraces, setLoadingMoreTraces] = useState(false);
  const [spans, setSpans] = useState<Array<{ key: string; count: number; errorCount: number; p95DurationMs: number }>>([]);
  const [llm, setLlm] = useState<Array<{ key: string; count: number; inputTokens: number; outputTokens: number; averageDurationMs: number }>>([]);
  const [series, setSeries] = useState<Array<{ timestamp: string; runCount: number; errorCount: number }>>([]);
  const [selected, setSelected] = useState<{ runId: string; events: TraceEvent[] }>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>();
  const filterQuery = useMemo(() => query(filters), [filters]);
  const exportHref = `${api}/v1/telemetry/export.xlsx${filterQuery}`;
  const tracePath = (page: number) => `/v1/telemetry/traces${filterQuery}${filterQuery ? "&" : "?"}page=${page}&limit=50`;
  const refresh = async () => { try { setLoading(true); setError(""); const [summary, traceResult, spanRows, llmRows, timeRows] = await Promise.all([read<Overview>(`/v1/telemetry/analytics/overview${filterQuery}`), read<{ items: Run[]; total: number }>(tracePath(1)), read<typeof spans>(`/v1/telemetry/analytics/spans${filterQuery}`), read<typeof llm>(`/v1/telemetry/analytics/llm${filterQuery}`), read<typeof series>(`/v1/telemetry/analytics/timeseries${filterQuery}`)]); setOverview(summary); setRuns(traceResult.items); setTracePage(1); setTraceTotal(traceResult.total); setSpans(spanRows); setLlm(llmRows); setSeries(timeRows); setLastUpdated(new Date().toLocaleTimeString()); } catch { setError("OpenCollector is unavailable or has no readable telemetry yet."); } finally { setLoading(false); } };
  useEffect(() => { void refresh(); }, []);
  const openTrace = async (runId: string) => { try { setSelected(await read<{ runId: string; events: TraceEvent[] }>(`/v1/telemetry/traces/${encodeURIComponent(runId)}`)); } catch { setError("Trace could not be loaded."); } };
  const loadMoreTraces = async () => { if (loadingMoreTraces || runs.length >= traceTotal) return; try { setLoadingMoreTraces(true); const nextPage = tracePage + 1; const result = await read<{ items: Run[] }>(tracePath(nextPage)); setRuns(current => [...current, ...result.items]); setTracePage(nextPage); } finally { setLoadingMoreTraces(false); } };
  const selectView = (nextView: string) => {
    setView(nextView);
    const thirtyDays = last30Days();
    setFilters(nextView === "successful" ? { status: "ok", type: "run", name: "openKode-run", runId: "", from: thirtyDays, to: "" }
      : nextView === "failed" ? { status: "error", type: "run", name: "openKode-run", runId: "", from: thirtyDays, to: "" }
      : nextView === "workers" ? { status: "", type: "agent_step", name: "", runId: "", from: thirtyDays, to: "" }
      : nextView === "trace" ? { status: "", type: "", name: "", runId: "", from: "", to: "" }
      : nextView === "health" || nextView === "daily" ? { status: "", type: "run", name: "openKode-run", runId: "", from: thirtyDays, to: "" }
      : { status: "", type: "", name: "", runId: "", from: "", to: "" });
  };
  return <main><header><div><p className="eyebrow">OPEN COLLECTOR</p><h1>Trace dashboard</h1></div><a href={exportHref}>Download Excel</a><button disabled={loading} onClick={() => void refresh()}>{loading ? "Fetching traces…" : "Refresh"}</button></header>
    <section className="filters"><select value={view} onChange={e => selectView(e.target.value)}><option value="all">All traces</option><option value="health">Run health — last 30 days</option><option value="daily">Daily run health — last 30 days</option><option value="workers">Worker latency — last 30 days</option><option value="successful">Successful runs — last 30 days</option><option value="failed">Failed runs — last 30 days</option><option value="trace">Trace detail by run ID</option></select><input placeholder="Run ID" value={filters.runId} onChange={e => setFilters({ ...filters, runId: e.target.value })}/><select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}><option value="">All statuses</option><option value="ok">Successful</option><option value="error">Failed</option></select><input placeholder="Span name" value={filters.name} onChange={e => setFilters({ ...filters, name: e.target.value })}/><button onClick={() => void refresh()}>Apply filters</button></section>
    <p className={`request-state ${error ? "failed" : loading ? "loading" : "success"}`}>{error ? "Fetch failed — OpenCollector could not be reached." : loading ? "Fetching traces and analytics…" : lastUpdated ? `Traces loaded successfully at ${lastUpdated}.` : "Ready to fetch traces."}</p>
    {overview && <section className="metrics"><Metric label="Runs" value={overview.runCount}/><Metric label="Success rate" value={overview.runCount ? `${Math.round(overview.successCount / overview.runCount * 100)}%` : "—"}/><Metric label="Failures" value={overview.errorCount}/><Metric label="P50 duration" value={duration(overview.p50DurationMs)}/><Metric label="P95 duration" value={duration(overview.p95DurationMs)}/><Metric label="Spans" value={overview.spanCount}/></section>}
    <section className="grid"><Panel title="Recent traces"><div className="panel-scroll" onScroll={event => { const element = event.currentTarget; if (element.scrollTop + element.clientHeight >= element.scrollHeight - 40) void loadMoreTraces(); }}><table><thead><tr><th>Status</th><th>Run</th><th>Started</th><th>Duration</th><th>Spans</th></tr></thead><tbody>{runs.map(run => <tr key={run.runId} onClick={() => void openTrace(run.runId)}><td><span className={`pill ${run.status}`}>{run.status}</span></td><td>{run.runId.slice(0, 16)}…</td><td>{new Date(run.startedAt).toLocaleString()}</td><td>{duration(run.durationMs)}</td><td>{run.spanCount}</td></tr>)}</tbody></table>{loadingMoreTraces && <p className="load-more">Loading more traces…</p>}{runs.length < traceTotal && !loadingMoreTraces && <p className="load-more">Scroll for more traces</p>}</div></Panel><Panel title="Run volume"><div className="panel-scroll">{series.map(row => <div className="bar" key={row.timestamp}><span>{row.timestamp}</span><b>{row.runCount} runs · {row.errorCount} failed</b><i style={{ width: `${Math.min(100, row.runCount / Math.max(1, ...series.map(value => value.runCount)) * 100)}%` }}/></div>)}</div></Panel><Panel title="Slow spans"><div className="panel-scroll">{spans.map(row => <div className="bar" key={row.key}><span>{row.key}</span><b>{duration(row.p95DurationMs)}</b><i style={{ width: `${Math.min(100, row.p95DurationMs / Math.max(1, spans[0]?.p95DurationMs ?? 1) * 100)}%` }}/></div>)}</div></Panel></section>
    <section className="grid"><Panel title="LLM usage">{llm.length ? llm.map(row => <div className="llm" key={row.key}><b>{row.key}</b><span>{row.count} calls · {row.inputTokens.toLocaleString()} input · {row.outputTokens.toLocaleString()} output · {duration(row.averageDurationMs)}</span></div>) : <p>No LLM usage data yet.</p>}</Panel>{selected && <Panel title={`Trace ${selected.runId}`}><TraceWaterfall events={selected.events}/></Panel>}</section>
  </main>;
}
function Metric({ label, value }: { label: string; value: string | number }) { return <article className="metric"><span>{label}</span><strong>{value}</strong></article>; }
function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="panel"><h2>{title}</h2>{children}</section>; }

function TraceWaterfall({ events }: { events: TraceEvent[] }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const runMetadata = events.find(event => event.type === "run")?.metadata;
  const finalOutput = typeof runMetadata === "object" && runMetadata !== null && typeof (runMetadata as Record<string, unknown>).finalOutput === "string" ? (runMetadata as Record<string, string>).finalOutput : undefined;
  const start = Math.min(...events.map(event => Date.parse(event.startedAt)));
  const end = Math.max(...events.map(event => Date.parse(event.endedAt)));
  const total = Math.max(1, end - start);
  const copyTrace = async () => {
    try {
      await copyText(formatTraceForClipboard(events));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };
  return <div className="waterfall"><div className="trace-toolbar"><span>{events.length} events</span><button className="copy-trace" onClick={() => void copyTrace()}>{copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy nested trace"}</button></div>{finalOutput && <section className="trace-result"><span>Final output</span><p>{finalOutput}</p></section>}<div className="waterfall-head"><span>Span</span><span>Duration</span><span>Timeline</span></div><TraceRows nodes={traceTree(events)} depth={0} start={start} total={total}/></div>;
}

function TraceRows({ nodes, depth, start, total }: { nodes: TraceNode[]; depth: number; start: number; total: number }) {
  return <>{nodes.map(node => { const offset = Math.max(0, (Date.parse(node.event.startedAt) - start) / total * 100); const width = Math.max(1.5, node.event.durationMs / total * 100); return <div key={node.event.eventId}><article className="trace-row"><div className="trace-name" style={{ paddingLeft: `${depth * 24}px` }}><span className={`type-badge ${node.event.type}`}>{node.event.type}</span><span className={`pill ${node.event.status}`}>{node.event.status}</span><b>{node.event.name}</b></div><span>{duration(node.event.durationMs)}</span><div className="trace-timeline"><i className={`trace-bar ${node.event.type}`} style={{ left: `${offset}%`, width: `${width}%` }}/></div></article>{(Boolean(node.event.metadata) || Boolean(node.event.llm)) && <details className="trace-details"><summary>Event details</summary>{Boolean(node.event.metadata) && <pre>{formatJson(node.event.metadata)}</pre>}{Boolean(node.event.llm) && <pre>{formatJson(node.event.llm)}</pre>}</details>}<TraceRows nodes={node.children} depth={depth + 1} start={start} total={total}/></div>; })}</>;
}

function traceTree(events: TraceEvent[]): TraceNode[] {
  const nodes = new Map(events.map(event => [event.spanId, { event, children: [] as TraceNode[] }]));
  const roots: TraceNode[] = [];
  for (const node of nodes.values()) { const parent = node.event.parentSpanId ? nodes.get(node.event.parentSpanId) : undefined; if (parent) parent.children.push(node); else roots.push(node); }
  return roots;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Clipboard copy was unavailable");
}

function formatTraceForClipboard(events: TraceEvent[]) {
  const indent = (value: string, prefix: string) => value.split("\n").map(line => `${prefix}${line}`).join("\n");
  const render = (nodes: TraceNode[], prefix = ""): string[] => nodes.flatMap((node, index) => {
    const isLast = index === nodes.length - 1;
    const branch = `${prefix}${isLast ? "└─" : "├─"}`;
    const childPrefix = `${prefix}${isLast ? "  " : "│ "}`;
    const event = node.event;
    const lines = [`${branch} [${event.type} · ${event.status} · ${duration(event.durationMs)}] ${event.name}`, `${childPrefix}started: ${event.startedAt}`];
    if (event.metadata !== undefined) lines.push(`${childPrefix}metadata:\n${indent(formatJson(event.metadata), `${childPrefix}  `)}`);
    if (event.llm !== undefined) lines.push(`${childPrefix}llm:\n${indent(formatJson(event.llm), `${childPrefix}  `)}`);
    return [...lines, ...render(node.children, childPrefix)];
  });
  return [`Trace ${events[0]?.runId ?? ""}`, ...render(traceTree(events))].join("\n");
}
createRoot(document.getElementById("root")!).render(<App />);
