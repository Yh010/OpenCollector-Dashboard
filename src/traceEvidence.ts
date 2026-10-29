export type TraceEvent = { eventId: string; runId: string; spanId: string; parentSpanId?: string; type: string; name: string; startedAt: string; endedAt: string; durationMs: number; status: string; metadata?: unknown; llm?: Record<string, unknown> };
export type RecordValue = Record<string, unknown>;
export const record = (value: unknown): RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
export function parseRecorded(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const fenced = value.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  try { return JSON.parse(fenced?.[1] ?? value); } catch { return value; }
}
export const pretty = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? 'Not recorded';
export function runtimeFacts(event: TraceEvent): RecordValue { return record(record(event.metadata).runtime); }
export function runtimeContent(event: TraceEvent, key: string): unknown {
  const item = record(record(record(event.metadata).runtimeContent)[key]);
  return parseRecorded(item.value);
}
export function orderedEvents(events: TraceEvent[]) {
  return [...events].sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.eventId.localeCompare(b.eventId));
}
export function traceRows(events: TraceEvent[]): {event: TraceEvent; depth: number}[] {
  const ordered = orderedEvents(events), ids = new Set(ordered.map(event => event.spanId));
  const children = new Map<string, TraceEvent[]>();
  for (const event of ordered) {
    const key = event.parentSpanId && ids.has(event.parentSpanId) ? event.parentSpanId : '';
    children.set(key, [...(children.get(key) ?? []), event]);
  }
  const rows: {event: TraceEvent; depth: number}[] = [], visited = new Set<string>();
  const visit = (event: TraceEvent, depth: number) => {
    if (visited.has(event.spanId)) return;
    visited.add(event.spanId); rows.push({event, depth});
    for (const child of children.get(event.spanId) ?? []) visit(child, depth + 1);
  };
  for (const event of children.get('') ?? []) visit(event, 0);
  for (const event of ordered) if (!visited.has(event.spanId)) visit(event, 0);
  return rows;
}
export function modelCallsFor(event: TraceEvent, events: TraceEvent[]) {
  if (event.type === 'generation') return [event];
  // A worker owns its direct generation children. The run overview owns no inferred calls.
  return orderedEvents(events.filter(child => child.parentSpanId === event.spanId && child.type === 'generation'));
}
export function evidenceFor(event: TraceEvent) {
  const metadata = record(event.metadata), llm = record(metadata.llm);
  const input = parseRecorded(llm.inputMessages ?? metadata.inputMessages ?? metadata.messages);
  const messages = Array.isArray(input) ? input.map(record).filter(message => typeof message.content === 'string').map(message => ({role: String(message.role ?? 'unknown'), content: String(message.content)})) : [];
  const payloads = messages.filter(message => message.role === 'user').map(message => record(parseRecorded(message.content)));
  const capturedTask = runtimeContent(event, 'task'), capturedFeedback = runtimeContent(event, 'systemMessage');
  const runtimeInput = {...record(runtimeContent(event, 'input')), ...(typeof capturedTask === 'string' ? {task:capturedTask} : {}), ...(typeof capturedFeedback === 'string' ? {feedback:capturedFeedback} : {})};
  const payload: RecordValue = {...runtimeInput, ...([...payloads].reverse().find(value => value.context !== undefined || value.request !== undefined || value.task !== undefined || value.feedback !== undefined) ?? {})};
  const context = record(payload.context ?? metadata.context);
  const rawOutput = llm.output ?? metadata.output ?? metadata.toolOutput ?? metadata.response ?? metadata.result ?? metadata.finalOutput ?? runtimeContent(event, 'modelOutput');
  const output = parseRecorded(rawOutput);
  const decision = record(output);
  const toolRequest = decision.type === 'tool_call' ? decision : undefined;
  const alerts: string[] = [];
  if (llm.inputTruncated === true) alerts.push('Input capture is truncated. Some instructions or context may be missing.');
  if (llm.outputTruncated === true) alerts.push('Output capture is truncated. The recorded answer may be incomplete.');
  if (Object.hasOwn(context, 'sourceFiles') && Object.keys(record(context.sourceFiles)).length === 0) alerts.push('No source file contents were supplied in this recorded context.');
  if (Object.hasOwn(context, 'discoveredFiles') && Array.isArray(context.discoveredFiles) && context.discoveredFiles.length === 0) alerts.push('No discovered files were supplied in this recorded context.');
  return {metadata, llm, messages, payload, context, output, rawOutput, toolRequest, alerts};
}
export function followingObservations(event: TraceEvent, events: TraceEvent[]) {
  const generations = orderedEvents(events.filter(item => item.type === 'generation'));
  const index = generations.findIndex(item => item.eventId === event.eventId);
  const next = index >= 0 ? generations[index + 1] : undefined;
  if (!next) return [];
  const requestedTool = evidenceFor(event).toolRequest?.toolName;
  if (typeof requestedTool !== 'string') return [];
  const evidence = evidenceFor(next);
  const candidates = [...evidence.messages.filter(message => message.role === 'user').map(message => message.content), evidence.payload.feedback];
  const prior = evidenceFor(event);
  const alreadyPresent = new Set([...prior.messages.map(message => message.content), prior.payload.feedback]);
  return candidates.filter((value): value is string => typeof value === 'string')
    .filter(value => !alreadyPresent.has(value))
    .filter(value => value.startsWith(`Observation from ${requestedTool}:`) || value.startsWith(`${requestedTool} observation:`))
    .map(text => ({text, source: next, result: record(parseRecorded(text.replace(/^[^:]+:\s*/, '')))}));
}

export type TraceOperation = {event: TraceEvent; calls: TraceEvent[]; runtimeEvents: TraceEvent[]; number: number; parentId?: string; agent: string; action: string};
export function actionLabel(output: unknown): string {
  const decision = record(output);
  if (decision.type === 'tool_call') {
    const names: Record<string, string> = {ReadFileTool:'Requested file read', GlobTool:'Requested file discovery', GrepTool:'Requested code search', WriteFileTool:'Requested file write', EditFileTool:'Requested edit', RunCommandTool:'Requested verification'};
    return names[String(decision.toolName)] ?? 'Requested tool';
  }
  const names: Record<string, string> = {research_result:'Proposed findings', needs_context:'Asked for context', final:'Returned answer', plan:'Returned plan', delegate:'Requested delegation'};
  return names[String(decision.type)] ?? 'Decision not recorded';
}
export function readableFeedback(value: string): string {
  const prefix = /^(?:Observation from [^:\n]+|[^:\n]+ observation):\s*/;
  if (!prefix.test(value)) return value;
  const parsed = parseRecorded(value.replace(prefix, ''));
  const observation = record(parsed);
  if (observation.ok === false) return typeof observation.message === 'string' ? observation.message : `Tool rejected the request${typeof observation.code === 'string' ? ` (${observation.code})` : ''}.`;
  if (observation.ok === true) return 'A tool result was supplied to this call.';
  return 'A tool observation was captured; see Technical details for its contents.';
}
export function buildOperations(events: TraceEvent[]): TraceOperation[] {
  const ordered = orderedEvents(events), byId = new Map(ordered.map(event => [event.spanId, event]));
  const stepIds = new Set(ordered.filter(event => runtimeFacts(event).version === 1 && runtimeFacts(event).kind === 'agent_call' && typeof runtimeFacts(event).stepId === 'string').map(event => runtimeFacts(event).stepId));
  const isOwnedRuntimeEvent = (event: TraceEvent) => { const facts = runtimeFacts(event);return facts.version === 1 && ['transition','tool_result'].includes(String(facts.kind)) && stepIds.has(facts.ownerStepId); };
  const visible = ordered.filter(event => event.type !== 'run' && !isOwnedRuntimeEvent(event) && !(event.type === 'generation' && byId.get(event.parentSpanId ?? '')?.type === 'agent_step'));
  const visibleIds = new Set(visible.map(event => event.spanId));
  return visible.map((event, index) => {
    const calls = modelCallsFor(event, ordered);
    let parentId = event.parentSpanId;
    const seen = new Set([event.spanId]);
    while (parentId) {
      if (seen.has(parentId)) { parentId = undefined; break; }
      seen.add(parentId);
      if (visibleIds.has(parentId)) {
        // Reject cyclic recorded ancestry rather than making the UI untraversable.
        let ancestor = byId.get(parentId)?.parentSpanId;
        const ancestors = new Set([parentId]);
        while (ancestor && !ancestors.has(ancestor) && ancestor !== event.spanId) { ancestors.add(ancestor); ancestor = byId.get(ancestor)?.parentSpanId; }
        if (ancestor === event.spanId || ancestor && ancestors.has(ancestor)) parentId = undefined;
        break;
      }
      parentId = byId.get(parentId)?.parentSpanId;
    }
    const role = event.name.replace(/^llm\./, '').replace(/-run$/, '');
    const agent = event.type === 'tool' ? 'Tool' : /^(planner|coder|orchestrator)$/i.test(role) ? role[0].toUpperCase() + role.slice(1) : event.type === 'generation' ? 'Model' : event.type === 'agent_step' ? 'Agent' : event.type === 'error' ? 'Error' : 'Operation';
    const source = calls.at(-1) ?? event;
    const sourceDecision = record(evidenceFor(source).output), ownerDecision = record(evidenceFor(event).output);
    const action = event.type === 'tool' ? 'Recorded tool execution' : event.type === 'error' ? 'Recorded error' : actionLabel(typeof sourceDecision.type === 'string' ? sourceDecision : typeof ownerDecision.type === 'string' ? ownerDecision : runtimeFacts(event).modelDecision);
    const runtimeEvents = ordered.filter(item => isOwnedRuntimeEvent(item) && runtimeFacts(item).ownerStepId === runtimeFacts(event).stepId);
    return {event, calls, runtimeEvents, number:index + 1, parentId, agent, action};
  });
}
export function descendantIds(id: string, operations: TraceOperation[]): Set<string> {
  const result = new Set<string>();
  const visit = (parent: string) => {
    for (const item of operations) if (item.parentId === parent && item.event.spanId !== id && !result.has(item.event.spanId)) {
      result.add(item.event.spanId); visit(item.event.spanId);
    }
  };
  visit(id); return result;
}
export function operationStatus(operation: TraceOperation, events: TraceEvent[]) {
  if (operation.runtimeEvents.some(event => runtimeFacts(event).outcome === 'blocked')) return 'Tool blocked';
  if (operation.runtimeEvents.some(event => runtimeFacts(event).reasonCode === 'answer_without_evidence')) return 'Answer not accepted';
  if (operation.runtimeEvents.some(event => runtimeFacts(event).reasonCode === 'planner_route_override')) return 'Runtime selected Planner';
  if (operation.runtimeEvents.some(event => runtimeFacts(event).reasonCode === 'tool_threw')) return 'Tool execution error';
  if (operation.runtimeEvents.some(event => runtimeFacts(event).kind === 'tool_result' && runtimeFacts(event).errorCode === 'NO_MATCHES')) return 'No matching files';
  if (operation.runtimeEvents.some(event => runtimeFacts(event).kind === 'tool_result' && runtimeFacts(event).outcome === 'error')) return 'Tool returned an error';
  if (operation.calls.some(call => followingObservations(call, events).some(observation => observation.result.ok === false))) return 'Tool rejected';
  if (operation.event.status === 'error' || operation.calls.some(call => call.status === 'error')) return 'Execution error';
  return operation.event.status === 'ok' ? 'Returned' : 'Status not recorded';
}

export function explainAction(source: TraceEvent, owner: TraceEvent): string {
  const evidence = evidenceFor(source), ownerEvidence = evidenceFor(owner);
  const decision = record(evidence.output ?? ownerEvidence.output);
  const feedback = evidence.payload.feedback ?? ownerEvidence.payload.feedback;
  if (decision.type === 'tool_call' && decision.toolName === 'GlobTool') {
    if (typeof feedback === 'string' && typeof decision.pattern === 'string' && feedback.includes('GlobTool')
        && feedback.includes(decision.pattern) && /\b(first|next|must|required)\b/i.test(feedback)
        && !/^(?:GlobTool observation|Observation from GlobTool):/.test(feedback)) {
      return `OpenKode's instruction to Planner required searching for "${decision.pattern}" first. Planner's recorded request follows that instruction. GlobTool searches existing file paths; it does not create files.`;
    }
    return 'The model requested a search of existing file paths. Its reason for choosing this search was not explicitly recorded.';
  }
  return '';
}

export type FlowExplanation = {input: string; after: string; basis: 'runtime' | 'captured_input' | 'gap'; fromStep?: number; nextStep?: number; rejectedAnswer?: boolean; failure?: string};
/** Explains only explicit runtime facts or matching recorded next inputs. It never invents a historical handoff. */
export function explainFlow(operation: TraceOperation, operations: TraceOperation[], events: TraceEvent[]): FlowExplanation {
  const index = operations.findIndex(item => item.event.spanId === operation.event.spanId);
  const previous = operations[index - 1], next = operations[index + 1];
  const facts = runtimeFacts(operation.event);
  const linkedPrevious = typeof facts.fromStepId === 'string' ? operations.find(item => runtimeFacts(item.event).stepId === facts.fromStepId) : undefined;
  const source = operation.calls.at(-1) ?? operation.event;
  const first = operation.calls[0] ?? operation.event;
  const evidence = evidenceFor(source), firstEvidence = evidenceFor(first), ownerEvidence = evidenceFor(operation.event);
  const nextEvidence = next ? evidenceFor(next.calls[0] ?? next.event) : undefined;
  const previousEvidence = previous ? evidenceFor(previous.calls.at(-1) ?? previous.event) : undefined;
  const task = firstEvidence.payload.task ?? firstEvidence.payload.request ?? ownerEvidence.payload.task;
  const previousTask = previousEvidence?.payload.task ?? previousEvidence?.payload.request;
  const sameTask = typeof task === 'string' && task === previousTask;
  const feedback = firstEvidence.payload.feedback ?? ownerEvidence.payload.feedback;
  const nextFeedback = nextEvidence?.payload.feedback ?? (next ? evidenceFor(next.event).payload.feedback : undefined);
  const transitions = operation.runtimeEvents.map(runtimeFacts);
  const route = transitions.find(item => item.reasonCode === 'planner_route_override' || item.reasonCode === 'model_route_accepted');
  let basis: FlowExplanation['basis'] = facts.kind === 'agent_call' ? 'runtime' : index === 0 ? 'captured_input' : 'gap';
  let input = index === 0 ? operation.agent === 'Orchestrator' ? 'The orchestrator received the original user request.' : 'This is the first recorded operation.' : 'The reason this call started was not explicitly recorded.';
  if (linkedPrevious) input = `OpenKode started this call after step ${linkedPrevious.number}${facts.agent === runtimeFacts(linkedPrevious.event).agent ? ', reusing the original task and supplying a new system message.' : ', supplying the task and context shown below.'}`;
  else if (previous && sameTask && typeof feedback === 'string' && feedback.trim()) {
    basis = 'captured_input';
    input = `The next recorded ${operation.agent} call after step ${previous.number} received the same task and a new message from OpenKode.`;
    if (previous.agent !== operation.agent) input += ' The routing decision itself was not captured.';
  }
  const preceding = linkedPrevious ?? previous;
  if (preceding && (linkedPrevious || sameTask)) {
    const priorFacts = preceding.runtimeEvents.map(runtimeFacts);
    const priorSource = preceding.calls.at(-1) ?? preceding.event;
    const priorDecision = record(evidenceFor(priorSource).output ?? runtimeFacts(preceding.event).modelDecision);
    if (priorFacts.some(item => item.reasonCode === 'answer_without_evidence') || priorDecision.type === 'research_result' && typeof feedback === 'string' && feedback.startsWith('A research_result requires')) {
      input = `OpenKode asked ${operation.agent} to retry the answer from step ${preceding.number} with actual file evidence. The original task was reused.`;
    } else if (priorFacts.some(item => item.kind === 'tool_result' && item.outcome === 'blocked') || followingObservations(priorSource,events).some(item => item.result.ok === false)) {
      input = `OpenKode called ${operation.agent} again with the tool rejection from step ${preceding.number} as its system message. The original task was reused.`;
    } else if (linkedPrevious && facts.taskSource === 'approved_plan_step') {
      input = `OpenKode built this ${operation.agent} call from the approved plan step, after step ${preceding.number}.`;
    }
  }
  const sourceDecision = record(evidence.output), ownerDecision = record(ownerEvidence.output);
  const output = typeof sourceDecision.type === 'string' ? sourceDecision : typeof ownerDecision.type === 'string' ? ownerDecision : record(facts.modelDecision);
  let after = 'What OpenKode did after this response was not explicitly recorded.';
  let rejectedAnswer = false;
  if (route) {
    const effective = record(route.effectiveDecision);
    after = effective.type === 'delegate' ? `OpenKode ${route.overridden === true ? 'replaced the model proposal and selected' : 'accepted the handoff to'} ${String(effective.agent)}.` : effective.type === 'tool_call' ? `OpenKode accepted the request for ${String(effective.toolName)}. See the tool result below.` : 'OpenKode accepted the model decision.';
    if (route.routingRule === 'direct_file_request_not_recognized') after += ' Its request classifier did not recognize this as a direct file-content request.';
  } else if (operation.agent === 'Orchestrator' && output.type === 'tool_call' && next?.agent === 'Planner') {
    after = `The model proposed a tool call, but Planner is the next recorded agent (step ${next.number}). This older trace did not capture whether the runtime overrode the proposal or how it routed the request.`;
  }
  if (transitions.some(item => item.reasonCode === 'answer_without_evidence') || output.type === 'research_result' && next?.agent === operation.agent && typeof nextFeedback === 'string' && nextFeedback.startsWith('A research_result requires')) {
    rejectedAnswer = true;
    after = `OpenKode did not accept the proposed answer without file evidence${next ? ` and called ${next.agent} again in step ${next.number}` : ''}. ${next && !transitions.length ? 'This correction is recorded in the next call’s input.' : ''}`.trim();
  }
  const observations = followingObservations(source, events);
  const blocked = observations.find(item => item.result.code === 'UNAPPROVED_FILE' && typeof item.result.message === 'string' && item.result.message.startsWith('Planner may only read a file returned by GlobTool'));
  const runtimeBlocked = transitions.find(item => item.kind === 'tool_result' && item.toolInvoked === false);
  if (blocked || runtimeBlocked) after = `OpenKode blocked the tool request before invoking the tool${next ? `, then supplied the rejection to ${next.agent} in step ${next.number}` : ''}.`;
  else if (output.type === 'tool_call' && (observations.length || transitions.some(item => item.kind === 'tool_result')) && next) after = `The recorded tool result was supplied to ${next.agent} in step ${next.number}.`;
  const questions = Array.isArray(output.questions) ? output.questions.filter((item): item is string => typeof item === 'string') : [];
  const rootFinal = events.filter(item => item.type === 'run').map(item => record(item.metadata).finalOutput).filter((item): item is string => typeof item === 'string');
  if (transitions.some(item => item.reasonCode === 'clarification_returned') || questions.length > 0 && !next && rootFinal.some(final => questions.every(question => final.includes(question)))) after = 'OpenKode returned this clarification to the user as the final answer. The run ended with a question rather than a completed answer.';
  if (transitions.some(item => item.reasonCode === 'research_answer_accepted')) after = 'OpenKode accepted the answer after checking its cited paths against the supplied file contents, and returned it to the user.';
  let failure: string | undefined;
  const stop = transitions.find(item => item.reasonCode === 'named_file_search_stopped_run');
  const failedSearch = operation.runtimeEvents.find(item => runtimeFacts(item).kind === 'tool_result' && runtimeFacts(item).toolName === 'GlobTool' && runtimeFacts(item).toolInvoked === true && runtimeFacts(item).outcome === 'error');
  const searchInput = failedSearch ? record(runtimeContent(failedSearch, 'toolInput')) : {};
  const pattern = searchInput.pattern ?? output.pattern;
  const namedFile = typeof pattern === 'string' && pattern.startsWith('**/') ? pattern.slice(3) : undefined;
  const matchingFinal = namedFile && rootFinal.some(final => final === `I couldn't find "${namedFile}" in this project.`);
  if (!next && failedSearch && (stop || matchingFinal)) {
    const code = String(runtimeFacts(failedSearch).errorCode ?? 'an error');
    const currentTask = task ?? ownerEvidence.payload.task;
    const isCreation = typeof currentTask === 'string' && /\b(?:create|add)\s+(?:a\s+)?(?:new\s+)?file\b/i.test(currentTask);
    failure = isCreation && code === 'NO_MATCHES'
      ? 'The task asked to create a new file, but the run stopped after searching existing files. The absence of the new file was treated as a reason to stop.'
      : `OpenKode stopped after the named-file search returned ${code}.`;
    const writes = events.some(item => runtimeFacts(item).kind === 'tool_result' && ['WriteFileTool','EditFileTool'].includes(String(runtimeFacts(item).toolName)) && runtimeFacts(item).toolInvoked === true);
    const coder = operations.some(item => item.agent === 'Coder');
    after = `GlobTool ${code === 'NO_MATCHES' ? 'completed its search but found no matching paths' : `ran and returned ${code}`}. OpenKode returned the recorded file-not-found answer${!coder && !writes ? '; no Coder call or file write was recorded' : ''}.`;
    if (stop) basis = 'runtime';
  }
  return {input,after,basis,...(linkedPrevious || previous ? {fromStep:(linkedPrevious ?? previous)!.number} : {}),...(next ? {nextStep:next.number} : {}),...(rejectedAnswer ? {rejectedAnswer:true} : {}),...(failure ? {failure} : {})};
}
