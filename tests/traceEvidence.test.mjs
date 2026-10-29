import {test} from 'node:test';
import assert from 'node:assert/strict';
import {actionLabel, buildOperations, descendantIds, evidenceFor, explainAction, explainFlow, followingObservations, modelCallsFor, operationStatus, parseRecorded, readableFeedback, runtimeContent, traceRows} from '../src/traceEvidence.ts';

const base = {runId:'run',eventId:'e',spanId:'s',type:'generation',name:'llm.planner',startedAt:'2026-10-29T01:00:00Z',endedAt:'2026-10-29T01:00:01Z',durationMs:1000,status:'ok'};
test('extracts structured task, context and tool request without inferring execution', () => {
  const e={...base,metadata:{llm:{inputMessages:[{role:'user',content:JSON.stringify({task:'explain file',feedback:'retry',context:{sourceFiles:{},discoveredFiles:[]}})}],output:JSON.stringify({type:'tool_call',toolName:'ReadFileTool',fileToRead:'test.ts'})}}};
  const result=evidenceFor(e);
  assert.equal(result.payload.task,'explain file'); assert.equal(result.alerts.length,2);
  assert.equal(result.toolRequest.toolName,'ReadFileTool'); assert.deepEqual(followingObservations(e,[e]),[]);
});
test('preserves truncated JSON as text and reports capture flags', () => {
  const e={...base,metadata:{llm:{inputMessages:[{role:'user',content:'{"task":"hello…[truncated]'}],inputTruncated:true,output:'{"type":',outputTruncated:true}}};
  const result=evidenceFor(e);assert.equal(result.messages.length,1); assert.deepEqual(result.context,{});assert.equal(result.alerts.length,2);assert.equal(result.output,'{"type":');
});
test('links only matching tool observations from the next generation', () => {
  const e={...base,metadata:{llm:{output:'{"type":"tool_call","toolName":"ReadFileTool"}'}}};
  const next={...base,eventId:'next',spanId:'next',startedAt:'2026-10-29T01:00:02Z',metadata:{llm:{inputMessages:[{role:'user',content:JSON.stringify({feedback:'ReadFileTool observation:\n{"ok":false,"code":"UNAPPROVED_FILE"}'})}]}}};
  assert.equal(followingObservations(e,[e,next]).length,1);
  assert.equal(followingObservations(e,[e,next])[0].result.code,'UNAPPROVED_FILE');
  assert.equal(followingObservations(e,[e,{...next,metadata:{llm:{inputMessages:[{role:'user',content:'GrepTool observation: unrelated'}]}}}]).length,0);
});
test('does not assign a sibling or distant model call to an agent', () => {
  const agent={...base,eventId:'agent',spanId:'agent',type:'agent_step'};
  const child={...base,parentSpanId:'agent'};
  assert.deepEqual(modelCallsFor(agent,[agent,child,{...base,eventId:'other',spanId:'other',parentSpanId:'elsewhere'}]),[child]);
});
test('handles missing metadata, orphan spans and cycles without crashing', () => {
  assert.equal(evidenceFor(base).rawOutput,undefined);
  assert.equal(parseRecorded('<script>alert(1)</script>'),'<script>alert(1)</script>');
  const rows=traceRows([{...base,parentSpanId:'b'},{...base,eventId:'b',spanId:'b',parentSpanId:'s'}]);
  assert.equal(rows.length,2);
});
test('failed file-read regression exposes missing evidence and rejection without marking the span failed', () => {
  const plannerRead={...base,metadata:{llm:{inputTruncated:true,inputMessages:[{role:'user',content:JSON.stringify({task:'Explain ChatStore.test.ts',context:{sourceFiles:{},discoveredFiles:[]}})}],output:JSON.stringify({type:'tool_call',toolName:'ReadFileTool',fileToRead:'ChatStore.test.ts'})}}};
  const next={...base,eventId:'next',spanId:'next',startedAt:'2026-10-29T01:00:02Z',metadata:{llm:{inputMessages:[{role:'user',content:JSON.stringify({feedback:'ReadFileTool observation:\n{"ok":false,"code":"UNAPPROVED_FILE"}'})}],output:JSON.stringify({type:'needs_context',questions:['Which part?']})}}};
  assert.ok(evidenceFor(plannerRead).alerts.some(s=>s.includes('No source file')));
  assert.ok(followingObservations(plannerRead,[plannerRead,next]).some(o=>o.text.includes('UNAPPROVED_FILE')));
  assert.equal(plannerRead.status,'ok');
});
test('does not present repeated historical observations as a new result', () => {
  const content='Observation from ReadFileTool:\n{"ok":true,"output":"old"}';
  const e={...base,metadata:{llm:{inputMessages:[{role:'user',content}],output:'{"type":"tool_call","toolName":"ReadFileTool"}'}}};
  const next={...base,eventId:'next',spanId:'next',startedAt:'2026-10-29T01:00:02Z',metadata:{llm:{inputMessages:[{role:'user',content}]}}};
  assert.deepEqual(followingObservations(e,[e,next]),[]);
});

function event(id, type, parent, second, output) {
  return {...base,eventId:id,spanId:id,type,parentSpanId:parent,name:type==='agent_step'?'planner-run':type==='generation'?'llm.planner':type,startedAt:`2026-10-29T01:00:${String(second).padStart(2,'0')}Z`,endedAt:`2026-10-29T01:00:${String(second+1).padStart(2,'0')}Z`,metadata:output===undefined?undefined:{llm:{output:JSON.stringify(output)}}};
}
test('nine events become four distinct agent operations without altering source events', () => {
  const events=[event('root','run',undefined,0),...Array.from({length:4},(_,i)=>[event(`a${i}`,'agent_step','root',i*3),event(`g${i}`,'generation',`a${i}`,i*3,{type:i===3?'needs_context':'research_result'})]).flat()];
  const before=JSON.stringify(events);const operations=buildOperations(events);
  assert.equal(operations.length,4);assert.equal(operations[0].calls[0].spanId,'g0');assert.equal(operations[3].action,'Asked for context');
  assert.deepEqual(operations.map(o=>o.number),[1,2,3,4]);assert.equal(JSON.stringify(events),before);
});
test('standalone calls, errors and tools remain visible; only direct agent generations fold', () => {
  const events=[event('root','run',undefined,0),event('a','agent_step','root',1),event('g','generation','a',2,{type:'final'}),event('tool','tool','g',3),event('standalone','generation','root',4),event('nested','generation','tool',5),event('err','error','root',6)];
  const operations=buildOperations(events);
  assert.equal(operations.length,5);assert.equal(operations.find(o=>o.event.spanId==='tool').parentId,'a');
  assert.equal(operations.find(o=>o.event.spanId==='nested').parentId,'tool');
  assert.deepEqual([...descendantIds('a',operations)],['tool','nested']);
});
test('multiple calls remain ordered within their agent and final decision supplies label', () => {
  const events=[event('a','agent_step',undefined,0),event('g2','generation','a',2,{type:'needs_context'}),event('g1','generation','a',1,{type:'tool_call',toolName:'ReadFileTool'})];
  const [operation]=buildOperations(events);assert.deepEqual(operation.calls.map(e=>e.spanId),['g1','g2']);assert.equal(operation.action,'Asked for context');
});
test('missing and truncated decisions never fabricate an action or task completion', () => {
  const [operation]=buildOperations([event('g','generation',undefined,0)]);
  assert.equal(operation.action,'Decision not recorded');assert.equal(operationStatus(operation,[operation.event]),'Returned');
  assert.equal(actionLabel('{"type":'),'Decision not recorded');assert.equal(actionLabel({type:'tool_call',toolName:'GlobTool'}),'Requested file discovery');
});
test('cyclic recorded parents cannot hide every operation or recurse forever', () => {
  const operations=buildOperations([event('a','agent_step','b',0),event('b','agent_step','a',1)]);
  assert.ok(operations.every(o=>o.parentId===undefined));assert.equal(descendantIds('a',operations).size,0);
});
test('runtime feedback is readable without exposing JSON in the main story', () => {
  assert.equal(readableFeedback('ReadFileTool observation:\n{"ok":false,"message":"Discover the file first."}'),'Discover the file first.');
  assert.equal(readableFeedback('Observation from ReadFileTool:\n{"ok":true,"output":"large payload"}'),'A tool result was supplied to this call.');
  assert.equal(readableFeedback('Create a plan.'),'Create a plan.');
  assert.equal(readableFeedback('ReadFileTool observation:\n{"ok":false'),'A tool observation was captured; see Technical details for its contents.');
});

function failureTrace() {
  const task='Explain C:/project/example.ts';
  const messages=(feedback)=>[{role:'user',content:JSON.stringify({task,feedback,context:{originalRequest:task,sourceFiles:{},discoveredFiles:[],conversation:[]}})}];
  const gen=(id,parent,second,output,feedback)=>({...event(id,'generation',parent,second,output),metadata:{llm:{output:JSON.stringify(output),inputMessages:messages(feedback),inputTruncated:true}}});
  const root={...event('root','run',undefined,0),metadata:{finalOutput:'I need more context before continuing:\n- Which part?'}};
  const orchestrator={...event('o','agent_step','root',1),name:'orchestrator-run'};
  return [root,orchestrator,{...gen('go','o',2,{type:'tool_call',toolName:'ReadFileTool',fileToRead:'C:/project/example.ts'},undefined),name:'llm.orchestrator'},event('p1','agent_step','root',4),gen('gp1','p1',5,{type:'research_result',answer:'A generic project description',sources:['C:/project/example.ts']},'First discover the requested file.'),event('p2','agent_step','root',7),gen('gp2','p2',8,{type:'tool_call',toolName:'ReadFileTool',fileToRead:'C:/project/example.ts'},'A research_result requires at least one source path whose contents are present in context.sourceFiles. Use GlobTool and ReadFileTool before answering.'),event('p3','agent_step','root',10),gen('gp3','p3',11,{type:'needs_context',questions:['Which part?']},'ReadFileTool observation:\n'+JSON.stringify({ok:false,code:'UNAPPROVED_FILE',message:'Planner may only read a file returned by GlobTool: example.ts.'}))];
}
test('historical trace states the routing gap rather than inventing an orchestrator delegation', () => {
  const events=failureTrace(),operations=buildOperations(events);
  const flow=explainFlow(operations[0],operations,events);
  assert.ok(flow.after.includes('did not capture'));assert.ok(flow.after.includes('Planner'));assert.ok(!flow.after.includes('selected planner'));
});
test('unsupported model findings and the next validation correction explain the planner retry', () => {
  const events=failureTrace(),operations=buildOperations(events);
  assert.equal(operations[1].action,'Proposed findings');
  assert.equal(explainFlow(operations[1],operations,events).rejectedAnswer,true);
  assert.match(explainFlow(operations[1],operations,events).after,/did not accept.*step 3/);
  assert.match(explainFlow(operations[2],operations,events).input,/retry.*step 2.*original task was reused/);
});
test('blocked read explains non-invocation and why the fourth call received the rejection', () => {
  const events=failureTrace(),operations=buildOperations(events);
  assert.match(explainFlow(operations[2],operations,events).after,/blocked.*before invoking.*step 4/);
  const last=explainFlow(operations[3],operations,events);
  assert.equal(last.fromStep,3);assert.match(last.after,/clarification.*final answer/);
  assert.equal(evidenceFor(operations[2].calls[0]).context.discoveredFiles.length,0);
});
test('new runtime records attach to owners without becoming fake extra agent operations', () => {
  const events=failureTrace();
  for(const [id,key,from] of [['o','so',undefined],['p1','sp1','so'],['p2','sp2','sp1'],['p3','sp3','sp2']]) {
    const owner=events.find(e=>e.spanId===id);owner.metadata={runtime:{version:1,kind:'agent_call',stepId:key,fromStepId:from,agent:id==='o'?'orchestrator':'planner',inputSummary:{sourceFiles:0,discoveredFiles:0}}};
  }
  const runtime=(id,owner,facts)=>({...event(id,'agent_step','root',3),name:'runtime.decision',metadata:{runtime:{version:1,ownerStepId:owner,...facts}}});
  events.push(runtime('route','so',{kind:'transition',reasonCode:'planner_route_override',overridden:true,effectiveDecision:{type:'delegate',agent:'planner'},routingRule:'direct_file_request_not_recognized'}),runtime('reject','sp1',{kind:'transition',reasonCode:'answer_without_evidence'}),runtime('block','sp2',{kind:'tool_result',toolInvoked:false,outcome:'blocked',errorCode:'UNAPPROVED_FILE'}));
  const operations=buildOperations(events);assert.equal(operations.length,4);assert.equal(operations[0].runtimeEvents.length,1);
  const flow=explainFlow(operations[0],operations,events);assert.match(flow.after,/replaced.*selected planner/);assert.match(flow.after,/classifier did not recognize/);assert.equal(flow.basis,'runtime');
  assert.match(explainFlow(operations[2],operations,events).input,/retry.*step 2/);
  assert.equal(operationStatus(operations[2],events),'Tool blocked');
  assert.equal(events.length,12,'raw runtime events are retained');
});
test('unknown runtime owners remain visible; capture-off decisions still have honest action labels', () => {
  const agent={...event('a','agent_step',undefined,0),metadata:{runtime:{version:1,kind:'agent_call',stepId:'sa',modelDecision:{type:'tool_call',toolName:'ReadFileTool'}}}};
  const orphan={...event('orphan','tool',undefined,2),metadata:{runtime:{version:1,kind:'tool_result',ownerStepId:'missing'}}};
  const operations=buildOperations([agent,orphan]);assert.equal(operations.length,2);assert.equal(operations[0].action,'Requested file read');assert.equal(evidenceFor(agent).rawOutput,undefined);
});
test('bounded runtime capture is decoded without pretending truncated JSON is complete', () => {
  const e={...base,metadata:{runtimeContent:{input:{value:JSON.stringify({task:'Original task',feedback:'Discover a file'}),truncated:false},modelOutput:{value:'{"type":',truncated:true}}}};
  assert.equal(evidenceFor(e).payload.task,'Original task');assert.equal(runtimeContent(e,'modelOutput'),'{"type":');
});

function creationSearchTrace() {
  const task='Create a new file example.ts in the root and write hello in it';
  const feedback='The original request explicitly names "example.ts". First call GlobTool with the exact pattern "**/example.ts".';
  const root={...event('root','run',undefined,0),metadata:{finalOutput:'I couldn\'t find "example.ts" in this project.'}};
  const orchestrator={...event('o','agent_step','root',1,{type:'delegate',agent:'planner'}),name:'orchestrator-run',metadata:{runtime:{version:1,kind:'agent_call',stepId:'so',agent:'orchestrator'}}};
  const planner={...event('p','agent_step','root',3),metadata:{runtime:{version:1,kind:'agent_call',stepId:'sp',fromStepId:'so',agent:'planner'},runtimeContent:{task:{value:JSON.stringify(task)},systemMessage:{value:JSON.stringify(feedback)}}}};
  const gen={...event('g','generation','p',4,{type:'tool_call',toolName:'GlobTool',pattern:'**/example.ts'}),metadata:{llm:{inputMessages:[{role:'user',content:JSON.stringify({task,feedback,context:{requestedNewFiles:['example.ts'],sourceFiles:{},discoveredFiles:[]}})}],output:JSON.stringify({type:'tool_call',toolName:'GlobTool',pattern:'**/example.ts'})}}};
  const tool={...event('tool','tool','root',5),metadata:{runtime:{version:1,kind:'tool_result',ownerStepId:'sp',toolName:'GlobTool',toolInvoked:true,outcome:'error',errorCode:'NO_MATCHES'},runtimeContent:{toolInput:{value:JSON.stringify({pattern:'**/example.ts'})},toolResult:{value:JSON.stringify({ok:false,code:'NO_MATCHES',message:'No files matched pattern "**/example.ts".'})}}}};
  return [root,orchestrator,planner,gen,tool];
}

test('creation failure connects the runtime instruction, existing-file search and terminal result', () => {
  const events=creationSearchTrace(),operations=buildOperations(events),planner=operations[1];
  assert.equal(operations.length,2);
  assert.match(explainAction(planner.calls[0],planner.event),/OpenKode's instruction.*required.*\*\*\/example.ts.*first/);
  assert.match(explainAction(planner.calls[0],planner.event),/does not create files/);
  assert.equal(operationStatus(planner,events),'No matching files');
  assert.equal(planner.event.status,'ok');
  const flow=explainFlow(planner,operations,events);
  assert.match(flow.failure,/create a new file.*absence.*reason to stop/);
  assert.match(flow.after,/completed its search.*no Coder call or file write was recorded/);
});

test('search explanation does not invent a model reason without a matching recorded instruction', () => {
  const events=creationSearchTrace();
  const owner={...events[2],metadata:{}};
  const gen={...events[3],metadata:{llm:{output:JSON.stringify({type:'tool_call',toolName:'GlobTool',pattern:'**/different.ts'}),inputMessages:[{role:'user',content:JSON.stringify({feedback:'First call GlobTool with **/example.ts'})}]}}};
  assert.match(explainAction(gen,owner),/reason.*not explicitly recorded/);
});

test('a search followed by another operation is not incorrectly described as a terminal failure', () => {
  const events=creationSearchTrace();events.push(event('retry','agent_step','root',7,{type:'plan'}));
  const operations=buildOperations(events);
  assert.equal(explainFlow(operations[1],operations,events).failure,undefined);
  assert.match(explainFlow(operations[1],operations,events).after,/supplied.*step 3/);
});

test('an unrelated final response is not attributed to the missing-file search', () => {
  const events=creationSearchTrace();events[0].metadata.finalOutput='I couldn\'t find "different.ts" in this project.';
  const operations=buildOperations(events);
  assert.equal(explainFlow(operations[1],operations,events).failure,undefined);
});

test('explicit runtime stop rules remain usable when payload capture is disabled', () => {
  const events=creationSearchTrace();delete events[2].metadata.runtimeContent;events.splice(3,1);
  delete events[3].metadata.runtimeContent;
  events.push({...event('stop','agent_step','root',6),metadata:{runtime:{version:1,kind:'transition',ownerStepId:'sp',reasonCode:'named_file_search_stopped_run',stopRule:'named_file_search_requires_match',nextAgent:'user'}}});
  const operations=buildOperations(events),flow=explainFlow(operations[1],operations,events);
  assert.equal(operations.length,2);assert.equal(flow.basis,'runtime');
  assert.match(flow.failure,/stopped.*NO_MATCHES/);
});

test('independent runtime task and instruction survive truncated full-input capture', () => {
  const event={...base,metadata:{runtimeContent:{input:{value:'{"task":',truncated:true},task:{value:JSON.stringify('Create a new file example.ts')},systemMessage:{value:JSON.stringify('First call GlobTool with **/example.ts')}}}};
  assert.equal(evidenceFor(event).payload.task,'Create a new file example.ts');
  assert.match(evidenceFor(event).payload.feedback,/First call GlobTool/);
});
