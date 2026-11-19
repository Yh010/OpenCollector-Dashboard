import { memo, useCallback, createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import { animate } from "motion";
import "@fontsource-variable/inter/opsz.css";
import { DashboardSelect, TimeRangePicker, TraceInspector } from "./DashboardControls";
import "./styles.css";
import { TraceAnalysis } from "./TraceAnalysis";
import { TraceStory } from "./TraceDebugger";
import { AuthGate, AccountMenu, authenticatedFetch } from "./AuthGate";

const optimizationsEnabled = new URLSearchParams(location.search).get("optimizations") !== "off";
const api = import.meta.env.VITE_OPENCOLLECTOR_URL ?? "http://127.0.0.1:3000";
type Run = { runId: string; startedAt: string; endedAt: string; durationMs: number; status: "ok" | "error"; spanCount: number };
type Overview = { runCount: number; successCount: number; errorCount: number; spanCount: number; p50DurationMs: number; p95DurationMs: number };
type TraceEvent = { eventId: string; runId: string; spanId: string; parentSpanId?: string; type: string; name: string; startedAt: string; endedAt: string; durationMs: number; status: string; metadata?: unknown; llm?: Record<string, unknown> };
type TracePage = { items: Run[]; total: number; limit: number; nextCursor: string | null; cursor: string | null };
type Section = "overview" | "traces" | "spans" | "llm" | "series";
type SectionStatus = "idle" | "loading" | "success" | "error";
const initialSectionStates: Record<Section, SectionStatus> = { overview: "idle", traces: "idle", spans: "idle", llm: "idle", series: "idle" };

function query(filters: Record<string, string>) { const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)); return params.size ? `?${params}` : ""; }
async function read<T>(path: string): Promise<T> { const url = new URL(`${api}${path}`); if (!optimizationsEnabled) url.searchParams.set("optimizations", "off"); const response = await authenticatedFetch(url); if (!response.ok) throw new Error(await response.text()); return response.json() as Promise<T>; }
const duration = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${value}ms`;
const formatJson = (value: unknown) => JSON.stringify(value, null, 2) ?? "undefined";

const MotionPreference = createContext(false);
const spring = { type: "spring" as const, duration: 0.28, bounce: 0 };
const navigation = [
  { id: "dashboard", icon: "overview", label: "Overview" },
  { id: "traces", icon: "traces", label: "Traces" },
  { id: "run-volume", icon: "activity", label: "Run volume" },
  { id: "slow-spans", icon: "latency", label: "Span latency" },
  { id: "llm-usage", icon: "spark", label: "LLM usage" },
];

const viewOptions = [{ value: "all", label: "All traces" }, { value: "health", label: "Run health" }, { value: "daily", label: "Daily run health" }, { value: "workers", label: "Worker latency" }, { value: "successful", label: "Successful runs" }, { value: "failed", label: "Failed runs" }, { value: "trace", label: "Trace detail by run ID" }];
const statusOptions = [{ value: "", label: "All statuses" }, { value: "ok", label: "Successful" }, { value: "error", label: "Failed" }];
const emptyFilters = { status: "", type: "", name: "", runId: "", from: "", to: "" };
const rangeOptions = [{ value: "all", label: "All time" }, { value: "day", label: "Last 24 hours" }, { value: "week", label: "Last 7 days" }, { value: "month", label: "Last 30 days" }, { value: "custom", label: "Custom range" }];

type Filters = { status: string; type: string; name: string; runId: string; from: string; to: string };
function resolveFilters(draft: Filters, range: string): Filters {
  if (range === "custom") return { ...draft, from: draft.from ? new Date(`${draft.from}T00:00:00`).toISOString() : "", to: draft.to ? new Date(`${draft.to}T23:59:59.999`).toISOString() : "" };
  const days = range === "day" ? 1 : range === "week" ? 7 : 30;
  return { ...draft, from: range === "all" ? "" : new Date(Date.now() - days * 86_400_000).toISOString(), to: "" };
}


function App() {
  const reducedMotion = useReducedMotion();
  const [keyboard, setKeyboard] = useState(false);
  const quietMotion = Boolean(reducedMotion || keyboard);
  const [activeSection, setActiveSection] = useState(location.hash.slice(1) || "dashboard");
  const navigationRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = navigationRef.current;
    const indicator = nav?.querySelector<HTMLElement>(".nav-selection");
    if (!nav || !indicator) return;
    const positionIndicator = () => {
      const selected = nav.querySelector<HTMLElement>("a[aria-current]");
      indicator.hidden = !selected;
      if (!selected) return;
      // Offsets stay in the nav's coordinate space, including when it scrolls horizontally.
      indicator.style.width = `${selected.offsetWidth}px`;
      indicator.style.height = `${selected.offsetHeight}px`;
      indicator.style.transform = `translate(${selected.offsetLeft}px, ${selected.offsetTop}px)`;
    };
    positionIndicator();
    const observer = new ResizeObserver(positionIndicator);
    observer.observe(nav);
    nav.querySelectorAll("a").forEach(link => observer.observe(link));
    return () => observer.disconnect();
  }, [activeSection]);
  useEffect(() => {
    const nav = navigationRef.current;
    const indicator = nav?.querySelector<HTMLElement>(".nav-hover");
    if (!nav || !indicator) return;
    const hoverMedia = matchMedia("(hover: hover) and (pointer: fine)");
    let hovered: HTMLAnchorElement | null = null;
    const position = () => {
      if (!hovered) return;
      indicator.style.width = `${hovered.offsetWidth}px`;
      indicator.style.height = `${hovered.offsetHeight}px`;
      indicator.style.transform = `translate(${hovered.offsetLeft}px, ${hovered.offsetTop}px)`;
      indicator.dataset.visible = hovered.hasAttribute("aria-current") ? "false" : "true";
    };
    const clear = () => { hovered = null; indicator.dataset.visible = "false"; };
    const move = (event: PointerEvent) => {
      if (!hoverMedia.matches || event.pointerType === "touch") return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a") : null;
      if (!link || !nav.contains(link) || hovered === link) return;
      if (document.documentElement.dataset.input !== "pointer") {
        document.documentElement.dataset.input = "pointer";
        setKeyboard(false);
      }
      hovered = link;
      position();
    };
    const resize = new ResizeObserver(position);
    resize.observe(nav);
    nav.querySelectorAll("a").forEach(link => resize.observe(link));
    const selection = new MutationObserver(position);
    selection.observe(nav, { subtree: true, attributes: true, attributeFilter: ["aria-current"] });
    nav.addEventListener("pointerover", move);
    nav.addEventListener("pointermove", move);
    nav.addEventListener("pointerleave", clear);
    window.addEventListener("keydown", clear);
    hoverMedia.addEventListener("change", clear);
    return () => {
      resize.disconnect(); selection.disconnect();
      nav.removeEventListener("pointerover", move);
      nav.removeEventListener("pointermove", move);
      nav.removeEventListener("pointerleave", clear);
      window.removeEventListener("keydown", clear);
      hoverMedia.removeEventListener("change", clear);
    };
  }, []);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [loadedSections, setLoadedSections] = useState<Section[]>([]);
  const traceRequest = useRef(0);
  const scrollAnimation = useRef<ReturnType<typeof animate> | null>(null);
  useEffect(() => {
    const stopScroll = () => { scrollAnimation.current?.stop(); scrollAnimation.current = null; };
    const onPointer = () => { stopScroll(); if (document.documentElement.dataset.input !== "pointer") { document.documentElement.dataset.input = "pointer"; setKeyboard(false); } };
    const onKey = () => { stopScroll(); if (document.documentElement.dataset.input !== "keyboard") { document.documentElement.dataset.input = "keyboard"; setKeyboard(true); } };
    const onHash = () => setActiveSection(location.hash.slice(1) || "dashboard");
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    window.addEventListener("wheel", stopScroll, { passive: true });
    window.addEventListener("touchstart", stopScroll, { passive: true });
    return () => { window.removeEventListener("pointerdown", onPointer, true); window.removeEventListener("keydown", onKey, true); window.removeEventListener("hashchange", onHash); window.removeEventListener("popstate", onHash); window.removeEventListener("wheel", stopScroll); window.removeEventListener("touchstart", stopScroll); stopScroll(); };
  }, []);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (scrollAnimation.current) return;
      const threshold = 145;
      const sections = navigation.map(item => ({ id: item.id, top: document.getElementById(item.id)?.getBoundingClientRect().top ?? Infinity }));
      const reached = sections.filter(section => section.top <= threshold);
      const lastTop = reached.length ? Math.max(...reached.map(section => section.top)) : -Infinity;
      const candidates = reached.filter(section => Math.abs(section.top - lastTop) < 2);
      const atEnd = scrollY > 0 && scrollY + innerHeight >= document.documentElement.scrollHeight - 3;
      setActiveSection(current => atEnd ? "llm-usage" : candidates.some(section => section.id === current) ? current : candidates[0]?.id ?? "dashboard");
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); };
  }, []);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [range, setRange] = useState("all");
  const [appliedFilters, setAppliedFilters] = useState<Filters>(emptyFilters);
  const [appliedDraft, setAppliedDraft] = useState<Filters>(emptyFilters);
  const [appliedRange, setAppliedRange] = useState("all");
  const [appliedView, setAppliedView] = useState("all");
  const loadLock = useRef(false);
  const [traceError, setTraceError] = useState("");
  const [inspectorRunId, setInspectorRunId] = useState("");
  const [view, setView] = useState("all");
  const [overview, setOverview] = useState<Overview>();
  const [runs, setRuns] = useState<Run[]>([]);
  const [traceTotal, setTraceTotal] = useState(0);
  const [tracePageSize, setTracePageSize] = useState(50);
  const [traceCursors, setTraceCursors] = useState<Record<number, string | null>>({ 1: null });
  const [tracePageNumber, setTracePageNumber] = useState(1);
  const [jumpPage, setJumpPage] = useState("1");
  const [nextTraceCursor, setNextTraceCursor] = useState<string | null>(null);
  const [pageError, setPageError] = useState("");
  const [spans, setSpans] = useState<Array<{ key: string; count: number; errorCount: number; p95DurationMs: number }>>([]);
  const [llm, setLlm] = useState<Array<{ key: string; count: number; inputTokens: number; outputTokens: number; averageDurationMs: number }>>([]);
  const [series, setSeries] = useState<Array<{ timestamp: string; runCount: number; errorCount: number }>>([]);
  const [selected, setSelected] = useState<{ runId: string; events: TraceEvent[] }>();
  const [error, setError] = useState("");
  const [sectionStates, setSectionStates] = useState(initialSectionStates);
  const pendingSections = Object.values(sectionStates).filter(status => status === "loading").length;
  const failedSections = Object.values(sectionStates).filter(status => status === "error").length;
  const loading = pendingSections > 0;
  const [openingTrace, setOpeningTrace] = useState(false);
  const [openingRunId, setOpeningRunId] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>();
  const filterQuery = useMemo(() => query(appliedFilters), [appliedFilters]);
  const filtersDirty = query(filters) !== query(appliedDraft) || range !== appliedRange || view !== appliedView;
  const exportHref = `${api}/v1/telemetry/export.xlsx${filterQuery}`;
  const refresh = async (snapshot?: Filters, resetResults = false) => {
    if (loadLock.current) return;
    loadLock.current = true;
    const nextFilters = snapshot ?? resolveFilters(appliedDraft, appliedRange);
    if (!snapshot) setAppliedFilters(nextFilters);
    const filterQuery = query(nextFilters);
    const tracePath = `/v1/telemetry/traces${query({ ...nextFilters, limit: String(tracePageSize) })}`;
    setError(""); setPageError("");
    // Keep the current results in place during refresh; new filters start clean.
    if (resetResults) {
      setOverview(undefined); setRuns([]); setTraceTotal(0); setTraceCursors({ 1: null }); setTracePageNumber(1); setJumpPage("1"); setNextTraceCursor(null);
      setSpans([]); setLlm([]); setSeries([]); setLoadedSections([]);
      setInspectorOpen(false); setOpeningTrace(false); setOpeningRunId(undefined); traceRequest.current++;
    }
    setSectionStates({ overview: "loading", traces: "loading", spans: "loading", llm: "loading", series: "loading" });

    const loadSection = async <T,>(section: Section, path: string, update: (value: T) => void) => {
      try {
        const value = await read<T>(path);
        update(value);
        setLoadedSections(current => current.includes(section) ? current : [...current, section]);
        setSectionStates(current => ({ ...current, [section]: "success" }));
      } catch {
        setSectionStates(current => ({ ...current, [section]: "error" }));
      }
    };

    // Each request updates its section immediately; this wait only tracks completion.
    await Promise.all([
      loadSection<Overview>("overview", `/v1/telemetry/analytics/overview${filterQuery}`, setOverview),
      loadSection<TracePage>("traces", tracePath, result => { setRuns(result.items); setTraceTotal(result.total); setTraceCursors({ 1: null }); setTracePageNumber(1); setJumpPage("1"); setNextTraceCursor(result.nextCursor ?? null); }),
      loadSection<typeof spans>("spans", `/v1/telemetry/analytics/spans${filterQuery}`, setSpans),
      loadSection<typeof llm>("llm", `/v1/telemetry/analytics/llm${filterQuery}`, setLlm),
      loadSection<typeof series>("series", `/v1/telemetry/analytics/timeseries${filterQuery}`, setSeries),
    ]);
    setLastUpdated(new Date().toLocaleTimeString());
    loadLock.current = false;
  };
  const changeTracePage = async (page: number, pageSize = tracePageSize) => {
    if (loadLock.current) return;
    loadLock.current = true;
    setPageError(""); setSectionStates(current => ({ ...current, traces: "loading" }));
    try {
      const sizeChanged = pageSize !== tracePageSize;
      const cursor = sizeChanged ? null : page === tracePageNumber + 1 ? nextTraceCursor : traceCursors[page];
      const position: Record<string, string> = cursor ? { cursor } : page === 1 ? {} : { page: String(page) };
      const result = await read<TracePage>(`/v1/telemetry/traces${query({ ...appliedFilters, limit: String(pageSize), ...position })}`);
      setRuns(result.items); setTraceTotal(result.total); setTracePageSize(pageSize); setTracePageNumber(page); setJumpPage(String(page));
      setTraceCursors(current => ({ ...(sizeChanged ? {} : current), [page]: result.cursor, ...(result.nextCursor ? { [page + 1]: result.nextCursor } : {}) }));
      setNextTraceCursor(result.nextCursor);
      traceRequest.current++; setInspectorOpen(false); setOpeningTrace(false); setOpeningRunId(undefined);
      document.querySelector<HTMLElement>("#traces .panel-scroll")?.scrollTo({ top: 0 });
    } catch { setPageError("This page could not be loaded. Your current page is still shown. Try again."); }
    finally { setSectionStates(current => ({ ...current, traces: "success" })); loadLock.current = false; }
  };
  const applyFilters = () => {
    if (loadLock.current) return;
    const snapshot = resolveFilters(filters, range);
    setAppliedFilters(snapshot); setAppliedDraft({ ...filters }); setAppliedRange(range); setAppliedView(view);
    void refresh(snapshot, filtersDirty);
  };
  const resetDraft = () => { setFilters({ ...appliedDraft }); setRange(appliedRange); setView(appliedView); };
  useEffect(() => { void refresh(); }, []);
  const openTrace = useCallback(async (runId: string) => {
    const request = ++traceRequest.current;
    try {
      setError(""); setTraceError(""); setInspectorRunId(runId); setInspectorOpen(true); setOpeningTrace(true); setOpeningRunId(runId);
      const result = await read<{ runId: string; events: TraceEvent[] }>(`/v1/telemetry/traces/${encodeURIComponent(runId)}`);
      if (request === traceRequest.current) { setSelected(result); setInspectorOpen(true); }
    } catch { if (request === traceRequest.current) setTraceError("Trace could not be loaded. Select the run again to retry."); }
    finally { if (request === traceRequest.current) { setOpeningTrace(false); setOpeningRunId(undefined); } }
  }, []);
  const closeTrace = () => { document.querySelector<HTMLButtonElement>('.run-link[aria-pressed="true"]')?.focus({ preventScroll: true }); traceRequest.current++; setInspectorOpen(false); setOpeningTrace(false); setOpeningRunId(undefined); };
  const downloadExcel = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (exporting) return;
    setExporting(true); setError("");
    try {
      const response = await authenticatedFetch(exportHref);
      if (!response.ok) throw new Error("Export failed");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = "OpenCollector-telemetry.xlsx";
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError("Excel export could not be downloaded. Try Download Excel again."); }
    finally { setExporting(false); }
  };
  const navigateToSection = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const section = document.getElementById(id);
    if (!section) return;
    event.preventDefault();
    // Begin scrolling before state updates; these anchors never request data.
    scrollAnimation.current?.stop();
    const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    const margin = parseFloat(getComputedStyle(section).scrollMarginTop) || 0;
    const target = id === "dashboard" ? 0 : Math.max(0, Math.min(document.documentElement.scrollHeight - innerHeight, scrollY + section.getBoundingClientRect().top - padding - margin));
    if (reducedMotion || event.detail === 0 || Math.abs(target - scrollY) < 1) window.scrollTo({ top: target, behavior: "instant" });
    else scrollAnimation.current = animate(scrollY, target, { duration: 0.28, ease: [0.23, 1, 0.32, 1], onUpdate: top => window.scrollTo({ top, behavior: "instant" }), onComplete: () => { scrollAnimation.current = null; } });
    if (event.detail === 0) section.focus({ preventScroll: true });
    if (location.hash !== `#${id}`) history.pushState(null, "", `#${id}`);
    setActiveSection(id);
  };
  const selectView = useCallback((nextView: string) => {
    setView(nextView);
    setRange(nextView === "all" || nextView === "trace" ? "all" : "month");
    setFilters(nextView === "successful" ? { status: "ok", type: "run", name: "openKode-run", runId: "", from: "", to: "" }
      : nextView === "failed" ? { status: "error", type: "run", name: "openKode-run", runId: "", from: "", to: "" }
      : nextView === "workers" ? { status: "", type: "agent_step", name: "", runId: "", from: "", to: "" }
      : nextView === "trace" ? { status: "", type: "", name: "", runId: "", from: "", to: "" }
      : nextView === "health" || nextView === "daily" ? { status: "", type: "run", name: "openKode-run", runId: "", from: "", to: "" }
      : { status: "", type: "", name: "", runId: "", from: "", to: "" });
  }, []);
  const selectStatus = useCallback((status: string) => setFilters(current => ({ ...current, status })), []);
  return <MotionPreference.Provider value={quietMotion}><MotionConfig reducedMotion={quietMotion ? "always" : "never"} transition={quietMotion ? { duration: 0 } : spring}><div className="workspace">
    <a className="skip-link" href="#dashboard">Skip to dashboard</a>
    <aside className="sidebar" aria-label="Workspace">
      <a className="brand" href="#dashboard"><span className="brand-mark"><Icon name="layers"/></span><span>OpenCollector<small>Telemetry workspace</small></span></a>
      <div className="workspace-label">WORKSPACE</div>
      <nav ref={navigationRef} aria-label="Dashboard sections"><span className="nav-hover" aria-hidden="true"/><span className="nav-selection" aria-hidden="true"/>{navigation.map(item => <a key={item.id} href={`#${item.id}`} aria-current={activeSection === item.id ? "location" : undefined} onClick={event => navigateToSection(event, item.id)}><Icon name={item.icon}/><span>{item.label}</span>{item.id === "traces" && traceTotal > 0 && <small className="nav-count">{traceTotal.toLocaleString()}</small>}</a>)}</nav>
      <div className="sidebar-bottom"><span className={`connection-dot ${failedSections ? "offline" : loading ? "pending" : ""}`}/><div><b>{loading ? "Connecting to collector" : failedSections ? "Connection needs attention" : "Collector connected"}</b><span className="api-address" title={api}>{api}</span></div></div>
    </aside>
    <div className="workspace-content">
    <div className="topbar"><span><Icon name="layers"/>Workspace<span className="breadcrumb-divider">/</span><b>{navigation.find(item => item.id === activeSection)?.label ?? "Overview"}</b></span><span className="topbar-caption"><AccountMenu/></span></div>
    <main id="dashboard" tabIndex={-1}>
    <header className="page-header"><div className="page-title"><h1>Trace dashboard</h1><p>A clear view of every run, span, and model call.</p></div><div className="header-actions"><TimeRangePicker value={range} options={rangeOptions} onChange={setRange} from={filters.from} to={filters.to} onDatesChange={(from, to) => setFilters(current => ({ ...current, from, to }))}/><a className="button secondary" href={exportHref} onClick={event => void downloadExcel(event)} aria-disabled={exporting} aria-label={exporting ? "Preparing Excel download" : "Download Excel"}>{exporting ? <span className="mini-spinner"/> : <Icon name="download"/>}<ButtonLabel value={exporting ? "Preparing…" : "Download Excel"}/></a><label className="optimization-toggle" title="Compare file scanning and all traces with SQLite, indexed lookups, and pagination"><span>Optimizations</span><input type="checkbox" role="switch" checked={optimizationsEnabled} onChange={event => { const url = new URL(location.href); if (event.target.checked) url.searchParams.delete("optimizations"); else url.searchParams.set("optimizations", "off"); location.assign(url.href); }}/><span className="optimization-track" aria-hidden="true"/></label><button className="secondary refresh-button" aria-label={loading ? "Refreshing telemetry" : "Refresh telemetry"} disabled={loading} onClick={() => void refresh()}><span className={loading ? "refresh-icon spinning" : "refresh-icon"}><Icon name="refresh"/></span><ButtonLabel value={loading ? "Refreshing" : "Refresh"}/></button></div></header>
    {!optimizationsEnabled && <p className="baseline-note" role="status">Optimizations off: scanning telemetry files and loading all matching traces. This can take a while.</p>}
    <form className="filters" onSubmit={event => { event.preventDefault(); applyFilters(); }}>
      <DashboardSelect className="view-filter" label="View" value={view} onChange={selectView} options={viewOptions}/>
      <label>Run ID<input placeholder="Filter by run ID" value={filters.runId} onChange={e => setFilters({ ...filters, runId: e.target.value })}/></label>
      <DashboardSelect label="Status" value={filters.status} onChange={selectStatus} options={statusOptions}/>
      <label>Span name<input placeholder="Filter by span name" value={filters.name} onChange={e => setFilters({ ...filters, name: e.target.value })}/></label>
      <button className="apply-button" type="submit" disabled={loading} aria-label={loading ? "Applying filters" : "Apply filters"}>{loading ? <span className="mini-spinner"/> : <Icon name="filter"/>}<ButtonLabel value={loading ? "Applying…" : "Apply filters"}/>{!loading && <Icon name="arrow"/>}</button>
      <div className="filter-pending" data-visible={filtersDirty} aria-hidden={!filtersDirty} inert={!filtersDirty} role="status"><span><i/>Changes not applied</span><button type="button" className="text-button" onClick={resetDraft}>Reset</button></div>
      <AdvancedFilters filters={filters} onChange={setFilters}/>
    </form>
    <p role="status" aria-live="polite" className={`request-state ${loading || openingTrace || exporting ? "busy" : ""} ${error || failedSections ? "failed" : loading || openingTrace ? "loading" : "success"}`}>{(loading || openingTrace || exporting) && <span className="mini-spinner" aria-hidden="true"/>}{error ? error : loading ? `Loading ${pendingSections} of 5 sections…${failedSections ? ` ${failedSections} failed. Other sections continue loading.` : " Available results appear immediately."}` : failedSections ? `${failedSections} of 5 sections could not be updated. Use Refresh to retry. Last available results are shown below.` : openingTrace ? "Loading trace details…" : exporting ? "Preparing Excel download…" : lastUpdated ? `Updated at ${lastUpdated}. ${rangeOptions.find(option => option.value === appliedRange)?.label ?? "Custom range"}.` : "Ready to fetch traces."}</p>
    <section className="metrics" aria-label="Telemetry overview" aria-busy={sectionStates.overview === "loading"}>
      <Metric loading={!overview && sectionStates.overview === "loading"} label="Total runs" value={overview?.runCount.toLocaleString() ?? "—"} detail="Across matching traces"/>
      <Metric loading={!overview && sectionStates.overview === "loading"} label="Success rate" value={overview?.runCount ? `${Math.round(overview.successCount / overview.runCount * 100)}%` : "—"} detail={overview ? `${overview.successCount.toLocaleString()} successful runs` : "Awaiting telemetry"} tone="positive"/>
      <Metric loading={!overview && sectionStates.overview === "loading"} label="Failed runs" value={overview?.errorCount.toLocaleString() ?? "—"} detail="Runs with errors" tone={overview?.errorCount ? "negative" : undefined}/>
      <Metric loading={!overview && sectionStates.overview === "loading"} label="P50 duration" value={overview ? duration(overview.p50DurationMs) : "—"} detail="Median run duration"/>
      <Metric loading={!overview && sectionStates.overview === "loading"} label="P95 duration" value={overview ? duration(overview.p95DurationMs) : "—"} detail="95th percentile"/>
      <Metric loading={!overview && sectionStates.overview === "loading"} label="Total spans" value={overview?.spanCount.toLocaleString() ?? "—"} detail="Collected events"/>
    </section>
    <Panel title="Traces" status={sectionStates.traces} ready={loadedSections.includes("traces")} note={traceTotal ? `${traceTotal.toLocaleString()} matching traces` : "Run history"}>
      <TraceTable runs={runs} selectedRunId={inspectorOpen ? inspectorRunId : undefined} onOpenTrace={openTrace} openingRunId={openingRunId}/>
      {pageError && <p className="pagination-error" role="alert">{pageError}</p>}
      {optimizationsEnabled && loadedSections.includes("traces") && <nav className="trace-pagination" aria-label="Trace pages">
        <p role="status" aria-live="polite">{runs.length ? `Showing ${((tracePageNumber - 1) * tracePageSize + 1).toLocaleString()}–${((tracePageNumber - 1) * tracePageSize + runs.length).toLocaleString()} of ${traceTotal.toLocaleString()} traces` : "No traces on this page"}<span>Page {tracePageNumber} of {Math.max(1, Math.ceil(traceTotal / tracePageSize))}</span></p>
        <label className="page-size" htmlFor="trace-page-size">Traces per page
          <select id="trace-page-size" value={tracePageSize} disabled={loading} onChange={event => void changeTracePage(1, Number(event.target.value))}>
            {[25, 50, 100, 200].map(size => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <div><button type="button" className="secondary" disabled={loading || tracePageNumber === 1} onClick={() => void changeTracePage(tracePageNumber - 1)}>Previous</button>
        <button type="button" className="secondary" disabled={loading || !nextTraceCursor} onClick={() => nextTraceCursor && void changeTracePage(tracePageNumber + 1)}>Next</button></div>
        <form className="page-jump" onSubmit={event => { event.preventDefault(); const page = Number(jumpPage); if (Number.isSafeInteger(page) && page >= 1 && page <= Math.max(1, Math.ceil(traceTotal / tracePageSize))) void changeTracePage(page); }}>
          <label htmlFor="trace-page-number">Go to page</label>
          <input id="trace-page-number" type="number" inputMode="numeric" min={1} max={Math.max(1, Math.ceil(traceTotal / tracePageSize))} step={1} required value={jumpPage} disabled={loading} onChange={event => setJumpPage(event.target.value)}/>
          <button type="submit" className="secondary" disabled={loading}>Go</button>
        </form>
      </nav>}
    </Panel>
    <TraceInspector open={inspectorOpen} onClose={closeTrace} title={inspectorRunId || "Trace details"} loading={openingTrace} error={traceError}
      onPrevious={() => { const index = runs.findIndex(run => run.runId === inspectorRunId); if (index > 0) void openTrace(runs[index - 1].runId); }}
      onNext={() => { const index = runs.findIndex(run => run.runId === inspectorRunId); if (index >= 0 && index < runs.length - 1) void openTrace(runs[index + 1].runId); }}
      hasPrevious={!openingTrace && runs.findIndex(run => run.runId === inspectorRunId) > 0}
      hasNext={!openingTrace && runs.some((run, index) => run.runId === inspectorRunId && index < runs.length - 1)}>
      {selected && <div key={selected.runId}><TraceStory events={selected.events} onCopy={() => copyText(formatJson({ runId: selected.runId, events: selected.events }))}/><details className="story-ai"><summary>AI analysis</summary><TraceAnalysis api={api} runId={selected.runId} events={selected.events}/></details></div>}
    </TraceInspector>
    <section className="analytics-grid">
      <Panel title="Run volume" status={sectionStates.series} ready={loadedSections.includes("series")} note="Runs over time"><div className="panel-scroll">{series.length ? <div className="volume-chart"><div className="chart-legend"><span><i/>Total runs</span><span><i/>Failed runs</span></div><div className="chart-columns">{series.map(row => <div className="chart-column" key={row.timestamp} title={`${row.timestamp}: ${row.runCount} runs, ${row.errorCount} failed`}><span className="chart-count">{row.runCount}</span><div className="chart-track"><div className="chart-total" style={{ height: `${Math.max(0, row.runCount / Math.max(1, ...series.map(value => value.runCount)) * 100)}%` }}><div className="chart-errors" style={{ height: `${row.runCount ? Math.min(100, row.errorCount / row.runCount * 100) : 0}%` }}/></div></div><span className="chart-date">{new Date(row.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span><span className="chart-failed">{row.errorCount} failed</span></div>)}</div></div> : <EmptyState title="No run volume data" detail="Run counts will appear for the selected filters."/>}</div></Panel>
      <Panel title="Slow spans" status={sectionStates.spans} ready={loadedSections.includes("spans")} note="P95 duration"><div className="panel-scroll">{spans.length ? spans.map(row => <div className="bar" key={row.key}><div className="bar-label"><span>{row.key}</span><b>{duration(row.p95DurationMs)}</b></div><span className="span-meta">{row.count.toLocaleString()} spans · {row.errorCount.toLocaleString()} errors</span><div className="bar-track"><i style={{ width: `${Math.min(100, row.p95DurationMs / Math.max(1, ...spans.map(value => value.p95DurationMs)) * 100)}%` }}/></div></div>) : <EmptyState title="No span data" detail="Span latency will appear when telemetry is available."/>}</div></Panel>
    </section>
    <Panel title="LLM usage" status={sectionStates.llm} ready={loadedSections.includes("llm")}>{llm.length ? llm.map(row => <div className="llm" key={row.key}><b>{row.key}</b><span>{row.count} calls · {row.inputTokens.toLocaleString()} input · {row.outputTokens.toLocaleString()} output · {duration(row.averageDurationMs)}</span></div>) : <EmptyState title="No LLM usage data yet." detail="Token usage will appear when LLM events are collected."/>}</Panel>
    <footer className="page-footer"><span>OpenCollector</span><span>Telemetry, without the noise.</span></footer>
  </main></div></div></MotionConfig></MotionPreference.Provider>;
}
const AdvancedFilters = memo(function AdvancedFilters({ filters, onChange }: { filters: Filters; onChange: (filters: Filters) => void }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  return <div className="advanced-filters"><button type="button" className="disclosure-trigger" aria-expanded={advancedOpen} aria-controls="advanced-fields" onClick={() => setAdvancedOpen(!advancedOpen)}><Icon name="chevron"/><span>Event type</span><span className="filter-summary">{filters.type || "All event types"}</span></button><Collapse open={advancedOpen} id="advanced-fields"><div className="advanced-fields"><label>Event type<input placeholder="All event types" value={filters.type} onChange={e => onChange({ ...filters, type: e.target.value })}/></label></div></Collapse></div>;
});

const TraceTable = memo(function TraceTable({ runs, selectedRunId, onOpenTrace, openingRunId }: { runs: Run[]; selectedRunId?: string; onOpenTrace: (runId: string) => Promise<void>; openingRunId?: string }) {
  return <div className="panel-scroll">
        <table><thead><tr><th scope="col">Status</th><th scope="col">Run</th><th scope="col">Started</th><th scope="col" className="numeric">Duration</th><th scope="col" className="numeric">Spans</th></tr></thead><tbody>{runs.map(run => <tr key={run.runId} onClick={() => void onOpenTrace(run.runId)} className={selectedRunId === run.runId ? "selected" : undefined}><td><span className={`pill ${run.status}`}>{run.status === "ok" ? "Successful" : "Failed"}</span></td><td><button className="run-link" aria-busy={openingRunId === run.runId} title={run.runId} aria-label={`${openingRunId === run.runId ? "Loading" : "Open"} trace ${run.runId}`} aria-pressed={selectedRunId === run.runId} onClick={event => { event.stopPropagation(); void onOpenTrace(run.runId); }}>{openingRunId === run.runId && <span className="mini-spinner" aria-hidden="true"/>}{run.runId.length > 28 ? `${run.runId.slice(0, 15)}…${run.runId.slice(-10)}` : run.runId}</button><CopyRunId value={run.runId}/></td><td className="timestamp" title={new Date(run.startedAt).toLocaleString()}><time dateTime={run.startedAt} tabIndex={0} aria-label={new Date(run.startedAt).toLocaleString(undefined, { timeZoneName: "short" })}>{new Date(run.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}<span className="timestamp-time">{new Date(run.startedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span><span className="timestamp-tooltip" role="tooltip">{new Date(run.startedAt).toLocaleString(undefined, { timeZoneName: "short" })}</span></time></td><td className="numeric">{duration(run.durationMs)}</td><td className="numeric">{run.spanCount}</td></tr>)}</tbody></table>
        {!runs.length && <EmptyState title="No traces found" detail="Traces will appear here when runs match your filters."/>}
      </div>;
});

function CopyRunId({ value }: { value: string }) {
  const [state, setState] = useState("idle");
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timeout.current), []);
  return <button type="button" className="copy-run-id" aria-label={state === "copied" ? "Run ID copied" : state === "failed" ? "Copy failed. Retry copying run ID" : "Copy run ID"} title={state === "copied" ? "Copied" : "Copy run ID"} onClick={async event => { event.stopPropagation(); try { await copyText(value); setState("copied"); } catch { setState("failed"); } clearTimeout(timeout.current); timeout.current = setTimeout(() => setState("idle"), 1800); }}><span className="copy-id-icons" aria-hidden="true">{["idle", "copied", "failed"].map(iconState => <span key={iconState} className="copy-id-glyph" data-visible={state === iconState}><Icon name={iconState === "copied" ? "check" : iconState === "failed" ? "close" : "copy"}/></span>)}</span></button>;
}

function Metric({ label, value, detail, tone, loading }: { label: string; value: string | number; detail: string; tone?: string; loading?: boolean }) { return <article className={`metric ${tone ?? ""}`}><span>{label}</span><strong>{loading ? <span className="metric-skeleton" aria-label={`Loading ${label.toLowerCase()}`}/> : value}</strong><small>{detail}</small></article>; }
function Panel({ title, children, note, action, status, ready = false }: { title: string; children: React.ReactNode; note?: string; action?: React.ReactNode; status?: SectionStatus; ready?: boolean }) {
  return <section id={title.toLowerCase().replace(/[^a-z0-9]+/g, "-")} className="panel" tabIndex={-1} aria-busy={status === "loading"}>
    <div className="panel-heading"><h2>{title}</h2><div className="panel-accessory">{ready && status === "loading" && <span className="updating"><span className="mini-spinner"/>Updating</span>}{note && <span className="panel-note">{note}</span>}{action}</div></div>
    {status === "error" && <div role="alert" className={ready ? "section-error" : undefined}><EmptyState title={`${title} unavailable`} detail={ready ? "Showing previous results. Refresh to retry." : "This section could not be loaded. Use Refresh to retry."}/></div>}
    {status === "loading" && !ready ? <div role="status" className="loading-content"><div className="skeleton-line"/><div className="skeleton-line"/><div className="skeleton-line"/><span className="sr-only">Loading {title.toLowerCase()}.</span></div> : status !== "error" || ready ? children : null}
  </section>;
}

function ButtonLabel({ value }: { value: string }) {
  const quiet = useContext(MotionPreference);
  return <span className="button-label" aria-hidden="true"><AnimatePresence initial={false} mode="popLayout"><motion.span key={value} initial={{ opacity: 0, transform: quiet ? "none" : "translateY(5px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }} exit={{ opacity: 0, transform: quiet ? "none" : "translateY(-5px)" }} transition={{ duration: quiet ? 0 : 0.16 }}>{value}</motion.span></AnimatePresence></span>;
}

function Collapse({ open, children, id, className = "" }: { open: boolean; children: React.ReactNode; id?: string; className?: string }) {
  const quiet = useContext(MotionPreference);
  const content = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const measure = () => setHeight(element.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div id={id} className={`collapse ${className}`} style={{ height: open ? height : 0, transitionDuration: quiet ? "0ms" : undefined }} inert={!open} aria-hidden={!open}><div ref={content}>{children}</div></div>;
}
function EmptyState({ title, detail }: { title: string; detail: string }) { return <div className="empty-state"><Icon name={title.startsWith("Loading") ? "refresh" : "traces"}/><p>{title}</p><span>{detail}</span></div>; }

function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
    overview: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    traces: <><path d="M4 6h16M4 12h10M4 18h6M17 15l3 3-3 3"/></>,
    activity: <path d="M3 12h4l3-8 4 16 3-8h4"/>,
    latency: <><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6M12 2v3"/></>,
    spark: <><path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z"/></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 3M18 18A8 8 0 0 1 5 15"/></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
    chevron: <path d="m9 5 7 7-7 7"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    filter: <><path d="M4 6h16M7 12h10M10 18h4"/></>,
  };
  return <svg className="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
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

createRoot(document.getElementById("root")!).render(<AuthGate><App /></AuthGate>);
