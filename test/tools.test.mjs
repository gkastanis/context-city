import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseText } from '../src/parse.js';
import { compactSession, expandSession } from '../src/ui/compact.js';
import { toolReport, failures, filterFailures, stepFailure, errorCategory, errorRules, issueMarkdown, toolIdentity, failureScope, resultText } from '../src/ui/tools.js';
import { createToolsPanel } from '../src/ui/tools-panel.js';
import { runLabel } from '../src/ui/agents.js';

const fixture = parseText(await readFile(new URL('./fixtures/tools-demo.jsonl', import.meta.url),'utf8'));
function session(blocks, rows) {
  return {meta:{}, events:[], blocks:Object.fromEntries(blocks.map(b=>[b.id,b])),requests:rows.map((ids,idx)=>({idx,blockIds:ids,newBlockIds:ids,newFrom:0,time:1000+idx*100}))};
}
const b=(id,kind,toolName,extra={})=>({id,kind,toolName,estTokens:10,...extra});
const call=(id,tool='Bash',input={x:1},extra={})=>b(id,'tool_use',tool,{toolUseId:id,text:JSON.stringify({id,input}),...extra});
const result=(id,tool='Bash',extra={})=>b('r'+id,'tool_result',tool,{toolUseId:id,text:JSON.stringify({content:'exit code 2'}),...extra});
test('readable run labels include type and truncated task, IDs only disambiguate collisions',()=>{
  const a={agentId:'abcdef123456',agentType:'Explore',description:'Inspect navigation',session:session([],[])};
  const b={...a,agentId:'123456abcdef',description:'Inspect accessibility'};
  assert.equal(runLabel(a,[a,b]),'Explore: Inspect navigation');
  const c={...b,description:a.description};
  assert.equal(runLabel(a,[a,c]),'Explore: Inspect navigation (abcdef)');
  assert.ok(runLabel({...a,description:'x'.repeat(100)}).length<80);
  assert.equal(runLabel({...a,description:''}),'Explore');
});

test('MCP identities and built-in names',()=>{
  assert.deepEqual(toolIdentity('mcp__server-one__do__work'),{tool:'mcp__server-one__do__work',server:'server-one',shortName:'do__work'});
  assert.equal(toolIdentity('Bash').server,null);
  assert.equal(toolIdentity('mcp:legacy/find').shortName,'find');
});
test('report counts calls once across snapshots; medians, maxima, failure fractions and definition carrying',()=>{
  const blocks=[b('def','tool_def','Bash',{estTokens:60}),call('a'),result('a','Bash',{estTokens:100,isError:true}),call('b'),result('b','Bash',{estTokens:200}),call('c'),result('c','Bash',{estTokens:900})];
  const s=session(blocks,[['def','a','ra'],['def','a','ra','b','rb'],['def','a','ra','b','rb','c','rc']]);
  const t=toolReport(s).tools[0];
  assert.equal(t.calls,3);assert.equal(t.failures,1);assert.equal(t.failureRate,1/3);
  assert.deepEqual(t.resultTokens,{total:1200,median:200,max:900});
  assert.equal(t.definitionTokens,60);assert.equal(t.definitionRequests,3);assert.equal(t.definitionCost,180);
  assert.equal(t.retries,1);assert.equal(t.identicalInputs,2);
  assert.equal(t.latency.median,null);assert.equal(t.latency.max,null);
  assert.equal(failures(s)[0].retried,true);
  assert.deepEqual(toolReport(expandSession(compactSession(s))),toolReport(s));
});
test('latency requires own block times, never interpolated request times; even median',()=>{
  const s=session([call('a','Read',{}, {time:1000}),result('a','Read',{time:1200}),call('b','Read',{}, {time:2000}),result('b','Read',{time:2600}),call('c','Read'),result('c','Read')],[['a','ra','b','rb','c','rc']]);
  assert.deepEqual(toolReport(s).tools[0].latency,{total:800,median:400,max:600});
  const reversed=session([call('a','Read',{}, {time:1000}),result('a','Read',{time:900})],[['a','ra']]);
  assert.equal(toolReport(reversed).tools[0].latency.median,null);
});
test('parser own timestamps survive worker-shaped compaction and absent times stay absent',()=>{
  const make=(type,timestamp,message)=>JSON.stringify({type,timestamp,message});
  const lines=[make('assistant','2026-01-01T00:00:00Z',{id:'a',role:'assistant',content:[{type:'tool_use',id:'a',name:'Read',input:{}}]}),make('user','2026-01-01T00:00:02Z',{role:'user',content:[{type:'tool_result',tool_use_id:'a',content:'ok'}]}),make('assistant',null,{id:'b',role:'assistant',content:[{type:'text',text:'Invented done.'}]})];
  const s=parseText(lines.join('\n'));
  const t=toolReport(expandSession(compactSession(s))).tools[0];assert.equal(t.latency.median,2000);
  const noTime=parseText(lines.map(l=>{const x=JSON.parse(l);delete x.timestamp;return JSON.stringify(x);}).join('\n'));
  assert.equal(toolReport(noTime).tools[0].latency.median,null);
  assert.ok(Object.values(noTime.blocks).every(b=>b.time==null));
});
test('retry is immediately next call in same run; repeat keys include tool and exclude call IDs',()=>{
  const s=session([call('a'),result('a','Bash',{isError:true}),call('x','Read'),call('b'),call('c','Bash',{x:2})],[['a','ra','x','b','c']]);
  const t=toolReport(s).tools.find(t=>t.tool==='Bash');assert.equal(t.retries,0);assert.equal(t.identicalInputs,1);
});
test('small ordered category rules and precedence',()=>{
  const cases=[['user rejected this call','Read','Permission / rejected'],['Permission denied','Read','Permission / rejected'],['InputValidationError','Read','Input validation'],['schema validation failed','Read','Input validation'],['no such file','Read','Not found'],['command not found','Bash','Not found'],['request timed out','mcp__a__b','Timeout'],['deadline exceeded','Read','Timeout'],['Process exited with code 2','Bash','Non-zero exit'],['non-zero exit status','Bash','Non-zero exit'],['MCP connection closed','mcp__a__b','MCP / server'],['Internal server error','Read','MCP / server'],['unexpected failure','Read','Other'],['exit code 2','Read','Other'],['Permission denied: schema timeout','Read','Permission / rejected']];
  for(const [text,tool,category] of cases)assert.equal(errorCategory(text,tool),category);
  assert.equal(errorRules.length,6);
});
test('unused definitions include total cost, not called subagent tools; per-run stats',()=>{
  const s=session([b('def','tool_def','Unused',{estTokens:30}),b('used','tool_def','Read',{estTokens:20}),call('a','Bash'),result('a','Bash',{isError:true})],[['def','used','a','ra'],['def','used','a','ra']]);
  s.agents=[{agentId:'child',agentType:'Reviewer',session:session([call('a','Read'),result('a','Read',{isError:true})],[['a','ra']])}];
  const r=toolReport(s);assert.equal(r.unused.length,1);assert.equal(r.unusedTokens,30);assert.equal(r.unusedCost,60);
  assert.deepEqual(r.tools.find(t=>t.tool==='Read').runs,[{agentId:'child',run:'Reviewer',calls:1,failures:1}]);
  assert.equal(r.failures.length,2);assert.equal(r.failures[1].agentId,'child');
});
test('split image results count once, sum output size, exclude image from error text cost',()=>{
  const s=session([call('a','Read'),result('a','Read',{isError:true,estTokens:12}),b('image','attachment','Read',{toolUseId:'a',layer:'results',isError:true,estTokens:1600})],[['a','ra','image'],['a','ra','image']]);
  const r=toolReport(s);assert.equal(r.failures.length,1);assert.equal(r.failures[0].tokens,1612);assert.equal(r.failures[0].errorTokens,Math.ceil('exit code 2'.length/4));assert.equal(r.tools[0].resultTokens.max,1612);
  assert.equal(r.failures[0].callBlockId,'a');assert.equal(r.failures[0].input,'{\n  "x": 1\n}');
});
test('failures ordered by own timestamps, including cross-run results and unmatched results',()=>{
  const s=session([call('a'),result('a','Bash',{isError:true,time:3000}),call('b'),result('b','Bash',{isError:true,time:1000})],[['a','ra','b','rb']]);
  s.agents=[{agentId:'child',session:session([result('orphan','Read',{isError:true,time:2000})],[['rorphan']])}];
  assert.deepEqual(failures(s).map(f=>f.time),[1000,2000,3000]);assert.equal(failures(s)[1].callBlockId,null);
});
test('AND filters, main/built-in null, wraparound in filtered order, and empty stepping',()=>{
  const items=failures(fixture);assert.equal(items.length,10);
  const filtered=filterFailures(items,{server:'atlas',category:'Input validation'});assert.equal(filtered.length,1);
  assert.ok(filterFailures(items,{server:null}).every(f=>f.server===null));
  assert.equal(filterFailures(items,{agentId:null}).length,10);
  assert.equal(stepFailure(items,items.at(-1),1),items[0]);assert.equal(stepFailure(items,items[0],-1),items.at(-1));
  assert.equal(stepFailure(filtered,null,-1),filtered[0]);assert.equal(stepFailure([],null,1),null);
});
test('fixture has two MCP servers, all categories, timed calls and unused definitions',()=>{
  const r=toolReport(fixture);assert.equal(new Set(r.tools.map(t=>t.server).filter(Boolean)).size,2);
  assert.equal(new Set(r.failures.map(f=>f.category)).size,7);assert.equal(r.calls.length,13);
  assert.ok(r.tools.filter(t=>t.calls).every(t=>t.latency.median>0));assert.equal(r.unused.length,1);
});
test('copy as issue Markdown contains JSON input and plain error with safe code fences',()=>{
  const f={tool:'mcp__atlas__search',server:'atlas',category:'Timeout',input:'{\n  "query": "paper"\n}',errorText:'Synthetic timeout'};
  assert.equal(issueMarkdown(f),'## Failed tool call: mcp__atlas__search\n\nServer: atlas\nCategory: Timeout\n\n### Input\n\n```json\n{\n  "query": "paper"\n}\n```\n\n### Error\n\n```\nSynthetic timeout\n```\n');
  assert.match(issueMarkdown({...f,errorText:'```danger'}),/````\n```danger\n````/);
  assert.match(issueMarkdown({...f,server:null}),/Server: Built-in/);
});
// Minimal DOM exercises the real panel event handlers; browser probe covers layout/focus.
class Node {
  children=[];attrs={};listeners={};hidden=false;style={setProperty(){}};
  constructor(tag){this.tag=tag;}
  setAttribute(k,v){this.attrs[k]=v;if(k==='hidden')this.hidden=true;}
  addEventListener(k,f){this.listeners[k]=f;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  focus(){} querySelector(){return null;} closest(){return null;}
}
test('tool summaries are compact with readable run details in tooltips and failure rows',()=>{
  const original=globalThis.document;
  globalThis.document={createElement:tag=>new Node(tag),addEventListener(){}};
  try {
    const s=session([call('a'),result('a','Bash',{isError:true})],[['a','ra']]);
    s.agents=['Inspect navigation','Inspect accessibility'].map((description,i)=>({agentId:'private-id-'+i,agentType:'Explore',description,
      session:session([call('a'),result('a','Bash',{isError:true})],[['a','ra']])}));
    const p=createToolsPanel({navigate(){}});p.setSession(s);
    const walk=n=>n && typeof n==='object'?[n,...n.children.flatMap(walk)]:[];
    const nodes=walk(p.root), summary=nodes.find(n=>n.children.join('')==='Main 1 · 2 subagents 2');
    assert.ok(summary);
    assert.match(summary.attrs.title,/Explore: Inspect navigation: 1 calls/);
    assert.doesNotMatch(summary.attrs.title,/private-id/);
    const meta=nodes.filter(n=>n.className==='failure-meta').map(n=>n.children.join('')).join('\n');
    assert.match(meta,/Explore: Inspect accessibility/);
    assert.doesNotMatch(meta,/private-id/);
  } finally {globalThis.document=original;}
});
test('button badge is hidden at zero; keyboard wrap follows filters and ignores inputs; session reset',()=>{
  const original=globalThis.document, events={};globalThis.document={createElement:tag=>new Node(tag),querySelector:()=>null,addEventListener:(k,f)=>events[k]=f};
  try{
    const visited=[];const p=createToolsPanel({navigate:f=>visited.push(f)});
    p.setSession(session([],[]));const badge=p.toggle.children.at(-1);assert.equal(badge.hidden,true);
    p.setSession(fixture);assert.equal(badge.hidden,false);assert.equal(badge.textContent,'10');
    p.open('failures');
    const descendants=n=>n && typeof n==='object'?[n,...n.children.flatMap(descendants)]:[];
    const nodes=descendants(p.root);
    assert.ok(nodes.some(n=>n.textContent==='10 failures'));
    assert.ok(!nodes.some(n=>n.textContent==='0 of 10'));
    const key=(key,input=false)=>events.keydown({key,target:{closest:()=>input},preventDefault(){}});
    key('ArrowDown');assert.equal(p.active,p.items[0]);key('k');assert.equal(p.active,p.items.at(-1));key('j');assert.equal(p.active,p.items[0]);
    key('ArrowDown',true);assert.equal(p.active,p.items[0]);key('Enter');assert.equal(visited.length,4);
    p.setSession(session([],[]));assert.equal(p.items.length,0);assert.equal(p.active,null);
  }finally{globalThis.document=original;}
});


test('parallel calls never retry a result first observed in that same request',()=>{
  const s=session([call('a'),call('b'),result('a','Bash',{isError:true}),result('b')],[['a','b','ra','rb']]);
  assert.equal(toolReport(s).tools[0].retries,0);
  assert.equal(failures(s)[0].retried,false);
});
test('error categories ignore schema and permissions in missing paths',()=>{
  for (const text of ['File does not exist: db/schema.sql','No such file: /app/permissions/config.json']) assert.equal(errorCategory(text),'Not found');
  for (const text of ['schema validation failed','invalid argument','validation error']) assert.equal(errorCategory(text),'Input validation');
  for (const text of ['permission to use Read','denied by user',"user doesn't want this",'EACCES']) assert.equal(errorCategory(text),'Permission / rejected');
  assert.equal(errorCategory('schema.sql permissions.json'),'Other');
});
test('error tokens measure extracted error text without JSON or image overhead',()=>{
  const text='Invented failure';
  const s=session([result('a','Read',{isError:true,estTokens:900,text:JSON.stringify({tool_use_id:'x'.repeat(1000),content:[{type:'text',text},{type:'image',source:{data:'synthetic'}}]})})],[['ra']]);
  assert.equal(resultText(s.blocks.ra),text);
  assert.equal(failures(s)[0].errorTokens,Math.ceil(text.length/4));
});
test('failure scope keeps counter and stepping consistent inside and outside filters',()=>{
  const all=failures(fixture), filtered=filterFailures(all,{server:'atlas'});
  const outside=all.find(f=>f.server!=='atlas');
  assert.equal(failureScope(filtered,outside,all),all);
  assert.equal(stepFailure(failureScope(filtered,outside,all),outside,1),all[(all.indexOf(outside)+1)%all.length]);
  assert.equal(failureScope(filtered,filtered[0],all),filtered);
  assert.equal(stepFailure(failureScope(filtered,filtered[0],all),filtered[0],1),filtered[1]);
});
test('Tools keyboard leaves modal focus and Reader arrows alone; Reader j/k still step',()=>{
  const original=globalThis.document, events={};let dialog=null;
  globalThis.document={createElement:tag=>new Node(tag),querySelector:()=>dialog,addEventListener:(k,f)=>events[k]=f};
  try {
    const p=createToolsPanel({navigate(){}});p.setSession(fixture);p.open('failures');p.step(1);
    const first=p.active, reader={id:'reader-panel'}, other={id:'index-panel'};
    const key=(key,owner)=>{let prevented=false;events.keydown({key,target:{closest:selector=>selector.includes('input')?null:selector==='#reader-panel'?(owner===reader?reader:null):owner},preventDefault(){prevented=true;}});return prevented;};
    dialog={};assert.equal(key('j',reader),false);assert.equal(p.active,first);dialog=null;
    assert.equal(key('j',other),false);assert.equal(p.active,first);
    assert.equal(key('ArrowDown',reader),false);assert.equal(key('ArrowUp',reader),false);assert.equal(p.active,first);
    assert.equal(key('j',reader),true);assert.equal(p.active,p.items[1]);
    assert.equal(key('k',reader),true);assert.equal(p.active,first);
  } finally {globalThis.document=original;}
});
