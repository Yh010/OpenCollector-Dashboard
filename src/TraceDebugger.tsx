import {useEffect, useMemo, useState} from 'react';
import {actionLabel, buildOperations, descendantIds, evidenceFor, explainAction, explainFlow, followingObservations, operationStatus, orderedEvents, pretty, readableFeedback, record, runtimeContent, runtimeFacts} from './traceEvidence';
import type {TraceEvent, TraceOperation} from './traceEvidence';
import './trace-debugger.css';

const duration = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;

function Text({value}: {value: unknown}) {
  const text = pretty(value);
  const [full, setFull] = useState(false);
  const long = text.length > 360;
  return <div className="story-text"><p>{long && !full ? `${text.slice(0, 360)}…` : text}</p>{long && <button className="story-text-toggle" type="button" aria-expanded={full} onClick={() => setFull(!full)}>{full ? 'Show less' : 'Show more'}</button>}</div>;
}
function Raw({label, value}: {label: string; value: unknown}) {
  const [open, setOpen] = useState(false);
  return <details className="story-disclosure" onToggle={event => setOpen(event.currentTarget.open)}><summary>{label}</summary>{open && <pre>{pretty(value)}</pre>}</details>;
}
function Note({children}: {children: React.ReactNode}) { return <p className="story-note">{children}</p>; }

export function TraceStory({events, onCopy}: {events: TraceEvent[]; onCopy: () => Promise<void>}) {
  const ordered = useMemo(() => orderedEvents(events), [events]);
  const operations = useMemo(() => buildOperations(events), [events]);
  const [openId, setOpenId] = useState<string>();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [copyState, setCopyState] = useState('Copy trace');
  const roots = ordered.filter(event => event.type === 'run');
  const question = ordered.map(event => runtimeContent(event,'originalRequest') ?? evidenceFor(event).payload.request ?? evidenceFor(event).context.originalRequest ?? record(event.metadata).userRequest).find(value => typeof value === 'string' && value.trim());
  const finalEvent = [...roots].sort((a,b) => b.endedAt.localeCompare(a.endedAt)).find(event => typeof record(event.metadata).finalOutput === 'string' && String(record(event.metadata).finalOutput).trim());
  const final = finalEvent ? record(finalEvent.metadata).finalOutput : undefined;
  const start = ordered.length ? Math.min(...ordered.map(event => Date.parse(event.startedAt))) : 0;
  const end = ordered.length ? Math.max(...ordered.map(event => Date.parse(event.endedAt))) : 0;
  const total = Math.max(1, end - start);
  const byId = new Map(operations.map(operation => [operation.event.spanId, operation]));
  const ancestry = (operation: TraceOperation) => {
    const parents: string[] = [], seen = new Set([operation.event.spanId]);
    let id = operation.parentId;
    while (id && !seen.has(id)) { seen.add(id); parents.push(id); id = byId.get(id)?.parentId; }
    return parents;
  };
  const visible = operations.filter(operation => !ancestry(operation).some(id => collapsed.has(id)));
  const toggleBranch = (operation: TraceOperation) => {
    const id = operation.event.spanId;
    if (collapsed.has(id)) setCollapsed(previous => {const next = new Set(previous); next.delete(id); return next;});
    else {
      const children = descendantIds(id, operations);
      setCollapsed(previous => new Set([...previous, id, ...children]));
      setOpenId(previous => previous === id || children.has(previous ?? '') ? undefined : previous);
    }
  };
  useEffect(() => {
    const reveal = () => setCollapsed(new Set());
    window.addEventListener('trace-analysis-reveal', reveal);
    return () => window.removeEventListener('trace-analysis-reveal', reveal);
  }, []);
  const copy = async () => {setCopyState('Copying…');try {await onCopy();setCopyState('Copied');} catch {setCopyState('Copy failed — retry');}};
  return <section className="trace-story" aria-label="Execution story">
      {roots.map(event => <span key={event.eventId} id={`trace-span-${event.spanId}`} tabIndex={-1} className="story-span-anchor" aria-label="Run summary"/>)}
    <div className="story-summary">
      <div><h3>Original question</h3>{question !== undefined ? <Text value={question}/> : <Note>Original question not recorded.</Note>}</div>
      <div><h3>Recorded final answer</h3>{final !== undefined ? <Text value={final}/> : <Note>Final answer not recorded.</Note>}</div>
    </div>
    <div className="story-toolbar"><div><h2>Execution</h2><span>{operations.length} {operations.length === 1 ? 'step' : 'steps'} · {ordered.length ? duration(end - start) : 'No duration recorded'}</span></div><button className="secondary" type="button" disabled={copyState === 'Copying…'} onClick={() => void copy()}>{copyState}</button></div>
    {!operations.length && <Note>No individual operations were recorded.</Note>}
    {operations.length > 0 && <div className="story-waterfall"><div className="story-grid"><div className="story-axis"><span>Agent / recorded action</span><span>Duration</span><div>{[0,.5,1].map(fraction => <span key={fraction}>{duration(Math.round(total * fraction))}</span>)}</div></div>
      {visible.map(operation => {
        const event = operation.event, depth = Math.min(ancestry(operation).length, 5);
        const children = operations.filter(item => item.parentId === event.spanId);
        const offset = Math.max(0, Math.min(100, (Date.parse(event.startedAt) - start) / total * 100));
        const width = Math.min(100 - offset, Math.max(.8, event.durationMs / total * 100));
        const flow = explainFlow(operation, operations, ordered);
        const status = flow.rejectedAnswer ? 'Answer not accepted' : operationStatus(operation, ordered), open = openId === event.spanId;
        const label = `${operation.agent} · ${operation.action}`;
        return <div key={event.eventId} className="story-operation" data-open={open}>
          <div className="story-row" id={`trace-span-${event.spanId}`} tabIndex={-1}>
            <div className="story-step-cell" style={{paddingLeft: depth * 18}}>
              {children.length > 0 && <button className="story-branch" type="button" aria-label={`${collapsed.has(event.spanId) ? 'Expand' : 'Collapse'} children of step ${operation.number}`} aria-expanded={!collapsed.has(event.spanId)} onClick={() => toggleBranch(operation)}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d={collapsed.has(event.spanId) ? 'M4 2l4 4-4 4' : 'M2 4l4 4 4-4'} fill="none" stroke="currentColor" strokeWidth="1.4"/></svg></button>}
              <button type="button" className="story-step" aria-expanded={open} aria-controls={`step-detail-${event.eventId}`} onClick={() => setOpenId(open ? undefined : event.spanId)}>
                <span className="story-step-number">{operation.number}</span><span><b>{operation.agent}</b><span className="story-step-action">{operation.action}</span>{status !== 'Returned' && <span className="story-step-status">{status}</span>}</span><span className="story-step-disclosure" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 12 12"><path d={open ? 'M2 6h8' : 'M2 6h8M6 2v8'} fill="none" stroke="currentColor" strokeWidth="1.4"/></svg></span>
              </button>
            </div>
            <span className="story-duration">{duration(event.durationMs)}</span>
            <div className="story-bar-track" role="img" aria-label={`Step ${operation.number}: starts ${duration(Math.max(0,Date.parse(event.startedAt)-start))} into the run, duration ${duration(event.durationMs)}`}><i className={status === 'Returned' ? '' : 'has-issue'} style={{left:`${offset}%`,width:`${width}%`}}/></div>
          </div>
          {open && <div className="story-detail" id={`step-detail-${event.eventId}`}><h3>Step {operation.number} · {label}</h3><OperationDetails operation={operation} operations={operations} events={ordered}/></div>}
          {operation.calls.map(call => call.spanId !== event.spanId && <span key={call.eventId} id={`trace-span-${call.spanId}`} tabIndex={-1} className="story-span-anchor" aria-label={`Model call belonging to step ${operation.number}`}/>)}
        </div>;
      })}
    </div></div>}
    <Raw label={`Technical details · ${events.length} recorded events`} value={events}/>
  </section>;
}

function OperationDetails({operation, operations, events}: {operation: TraceOperation; operations: TraceOperation[]; events: TraceEvent[]}) {
  const calls = operation.calls.length ? operation.calls : [operation.event];
  const flow = explainFlow(operation,operations,events);
  return <><div className="story-call-origin"><span>Why this call ran</span><p>{flow.input}</p></div>{calls.map((call,index) => <section className="story-call" key={call.eventId}>{calls.length > 1 && <h4>Call {index + 1} <span>{duration(call.durationMs)}</span></h4>}<CallDetails source={call} owner={operation.event} operation={operation} events={events} useOwnerInput={index===0}/></section>)}<div className="story-call-next" data-failure={!!flow.failure}><span>{flow.failure ? 'Why the task stopped' : 'What OpenKode did next'}</span>{flow.failure && <p>{flow.failure}</p>}<p>{flow.after}</p></div></>;
}

function CallDetails({source, owner, operation, events, useOwnerInput}: {source: TraceEvent; owner: TraceEvent; operation: TraceOperation; events: TraceEvent[]; useOwnerInput: boolean}) {
  const sourceEvidence = evidenceFor(source), ownerEvidence = evidenceFor(owner);
  const evidence = {...sourceEvidence, payload:{...(useOwnerInput ? ownerEvidence.payload : {}),...sourceEvidence.payload},output:sourceEvidence.output ?? ownerEvidence.output};
  const context = sourceEvidence.context;
  const toolEvents = operation.runtimeEvents.filter(event => runtimeFacts(event).kind === 'tool_result');
  const recordedResults = toolEvents.map(event => ({result:record(runtimeContent(event,'toolResult') ?? {message:runtimeContent(event,'error') ?? record(event.metadata).error}),facts:runtimeFacts(event)}));
  const observations = toolEvents.length ? [] : followingObservations(source, events);
  const parsedDecision = record(evidence.output);
  const decision = typeof parsedDecision.type === 'string' ? parsedDecision : record(runtimeFacts(owner).modelDecision);
  const task = evidence.payload.task ?? evidence.payload.request ?? context.originalRequest ?? evidence.metadata.task ?? evidence.metadata.userRequest ?? (typeof evidence.metadata.input === 'string' ? evidence.metadata.input : undefined);
  const feedback = evidence.payload.feedback;
  const actionReason = explainAction(source, owner);
  const files = record(context.sourceFiles);
  const inputSummary = record(runtimeFacts(owner).inputSummary);
  const sourceFileCount = Object.hasOwn(context,'sourceFiles') ? Object.keys(files).length : typeof inputSummary.sourceFiles === 'number' ? inputSummary.sourceFiles : undefined;
  const discoveredFileCount = Array.isArray(context.discoveredFiles) ? context.discoveredFiles.length : typeof inputSummary.discoveredFiles === 'number' ? inputSummary.discoveredFiles : undefined;
  const history = context.conversation ?? evidence.payload.conversation;
  const historyCount = Array.isArray(history) ? history.length : typeof inputSummary.historyMessages === 'number' ? inputSummary.historyMessages : undefined;
  const tools = events.filter(event => event.type === 'tool' && event.parentSpanId === source.spanId);
  const tool = evidence.toolRequest ?? (decision.type === 'tool_call' ? decision : undefined);
  const overriddenRoute = operation.runtimeEvents.map(runtimeFacts).find(facts => facts.reasonCode === 'planner_route_override' && record(facts.effectiveDecision).type === 'delegate');
  const resultText = typeof evidence.output === 'string' ? evidence.output : decision.answer ?? (decision.type === 'plan' ? decision.summary : undefined) ?? decision.response;
  const questions = Array.isArray(decision.questions) ? decision.questions : [];
  const error = evidence.metadata.error ?? evidence.metadata.errorMessage;
  const args = Object.entries(tool ?? {}).filter(([key]) => !['type','toolName'].includes(key));
  const names: Record<string,string> = {fileToRead:'File',fileToWrite:'File',path:'Path',pattern:'Pattern',paths:'Paths',content:'Content',oldText:'Old text',newText:'New text',script:'Script'};
  return <>
    <section className="story-evidence-section"><h4>Input</h4>
      {task !== undefined ? <Text value={task}/> : <Note>Task not recoverable from captured input.</Note>}
      {(evidence.llm.inputTruncated === true || record(record(record(owner.metadata).runtimeContent).input).truncated === true) && <Note>Input truncated.</Note>}
      {typeof feedback === 'string' && feedback.trim() && <div className="story-feedback"><span>What OpenKode told {operation.agent} before this call</span><Text value={readableFeedback(feedback)}/><Note>This is a system instruction or a previous tool result, not a new user message.</Note></div>}
      <div className="story-context">
        {sourceFileCount !== undefined && <span>{sourceFileCount} source files supplied</span>}
        {discoveredFileCount !== undefined && <span>{discoveredFileCount} discovered files</span>}
        {historyCount !== undefined && <span>{historyCount} history messages</span>}
      </div>
      {Object.keys(context).length === 0 && <Note>Structured context not recorded or not recoverable.</Note>}
      {Object.entries(files).map(([file,content]) => <Raw key={file} label={`Source · ${file}`} value={content}/>)}
      {Array.isArray(context.discoveredFiles) && context.discoveredFiles.length > 0 && <Raw label="Discovered files" value={context.discoveredFiles}/>}
      {Array.isArray(history) && history.length > 0 && <Raw label="Chat history supplied to this call" value={history}/>}
    </section>
    <section className="story-evidence-section"><h4>Action</h4>
      <p className="story-action-label">{source.type === 'tool' ? 'Recorded tool execution' : actionLabel(decision)}</p>
      {actionReason && <div className="story-action-reason"><span>Why this action</span><p>{actionReason}</p></div>}
      {decision.type === 'research_result' && <Note>The model generated the answer below. This was not a file-read result.</Note>}
      {args.length > 0 && <dl className="story-arguments">{args.map(([key,value]) => <div key={key}><dt>{names[key] ?? key}</dt><dd><Text value={value}/></dd></div>)}</dl>}
      {decision.type === 'delegate' && <p>Requested worker: {pretty(decision.agent)}</p>}
      {decision.type === 'tool_call' && <Note>This is the model’s request. The runtime’s handling is shown below.</Note>}
    </section>
    <section className="story-evidence-section"><h4>Result</h4>
      {error !== undefined && <div className="story-result-error"><b>Recorded error</b><Text value={error}/></div>}
      {recordedResults.map(({result,facts},index) => <div key={index} className={facts.outcome !== 'ok' ? 'story-result-error' : 'story-tool-result'}><b>{String(facts.toolName)} &middot; {facts.toolInvoked === false ? 'Blocked before tool invocation' : facts.errorCode === 'NO_MATCHES' ? 'Search completed; no matching files' : facts.outcome === 'ok' ? 'Tool invoked successfully' : 'Tool ran; returned an error'}{facts.errorCode ? ` · ${String(facts.errorCode)}` : ''}</b><Text value={facts.validationRule === 'file_not_discovered' ? `The requested path was not in the discovered-file allowlist${discoveredFileCount !== undefined ? ` (${discoveredFileCount} paths)` : ''}. The runtime blocked the request before invoking the tool.` : result.message ?? result.output ?? (facts.toolInvoked === false ? 'The runtime rejected the request before invoking the tool. Detailed payload was not captured.' : 'Detailed tool result was not captured.')}/></div>)}
      {observations.map((observation,index) => <div key={index} className={observation.result.ok === false ? 'story-result-error' : 'story-tool-result'}>
        {observation.result.ok === false ? <><b>Tool request rejected · {pretty(observation.result.code ?? 'error')}</b><Text value={observation.result.code === 'UNAPPROVED_FILE' && typeof observation.result.message === 'string' && observation.result.message.startsWith('Planner may only read a file returned by GlobTool') ? `The file was not on the list of paths discovered by GlobTool${discoveredFileCount !== undefined ? ` (${discoveredFileCount} paths)` : ''}. The runtime rejected the request before ReadFileTool was invoked; no file contents were read.` : observation.result.message ?? observation.result}/></> : <><b>Recorded tool result</b><Text value={observation.result.output ?? observation.result.message ?? observation.text}/></>}
        <Note>Captured in the next model call.</Note>
      </div>)}
      {tools.map(event => <div key={event.eventId} className={event.status === 'error' ? 'story-result-error' : 'story-tool-result'}><b>Recorded tool span · {event.name}</b><Text value={record(event.metadata).toolOutput ?? record(event.metadata).output ?? record(event.metadata).result ?? record(event.metadata).error ?? `Execution status: ${event.status}. Result payload not recorded.`}/></div>)}
      {tool && !observations.length && !tools.length && !toolEvents.length && <Note>{overriddenRoute ? `OpenKode replaced this request with a handoff to ${String(record(overriddenRoute.effectiveDecision).agent)}. This model request was not executed.` : 'No execution result was captured for this model request.'}</Note>}
      {!tool && resultText !== undefined && <><Note>{decision.type === 'research_result' ? 'Model’s proposed answer' : 'Model response'}</Note><Text value={resultText}/></>}
      {!tool && questions.length > 0 && <ul className="story-questions">{questions.map((question,index) => <li key={index}><Text value={question}/></li>)}</ul>}
      {!tool && source.type === 'tool' && evidence.rawOutput !== undefined && <Text value={evidence.output}/>}
      {!tool && resultText === undefined && !questions.length && error === undefined && !(source.type === 'tool' && evidence.rawOutput !== undefined) && <Note>{evidence.rawOutput === undefined ? 'Result not recorded.' : 'Structured response is available in Technical details.'}</Note>}
      {Array.isArray(decision.sources) && decision.sources.length > 0 && <div className="story-citations"><span>Files cited by the model</span><Note>These paths came from the model’s answer. A citation alone does not prove a file was read.</Note>{decision.sources.slice(0,5).map((file,index) => <div key={index}><Text value={file}/>{sourceFileCount === 0 && <Note>Not supported by supplied file contents: this call received 0 source files.</Note>}</div>)}{decision.sources.length > 5 && <Raw label="All cited paths" value={decision.sources}/>}</div>}
      {(evidence.llm.outputTruncated === true || record(record(record(owner.metadata).runtimeContent).modelOutput).truncated === true) && <Note>Output truncated.</Note>}
    </section>
    <Raw label="Technical details" value={{event:owner,modelCall:source !== owner ? source : undefined,capturedMessages:evidence.messages,recordedContext:context,recordedOutput:evidence.output,relatedToolEvents:tools,runtimeEvents:operation.runtimeEvents}}/>
  </>;
}
