import test from 'node:test';
import assert from 'node:assert/strict';
import { parseText } from '../src/parse.js';
import { compactSession, expandSession } from '../src/ui/compact.js';
import { resultText } from '../src/ui/tools.js';
import { findings, failedToolCalls } from '../src/ui/findings.js';
import { failedRequestIndices, failureTickPositions, branchFailureTickPositions } from '../src/ui/timeline.js';
import { consumeFile } from '../src/worker.js';

function transcript(content, sidechain = false) {
  const record = (type, message) => ({ type, isSidechain: sidechain, message });
  return [record('assistant', { id: 'a', role: 'assistant', content: [{ type: 'tool_use', id: 'call', name: 'Bash', input: {} }] }),
    record('user', { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call', ...content }] }),
    record('assistant', { id: 'b', role: 'assistant', content: [{ type: 'text', text: 'Done' }] })].map(JSON.stringify).join('\n');
}
for (const agent of [false, true]) test(`strict tool error flag, agent=${agent}`, () => {
  for (const flag of [true, false, undefined, 'true', 1]) {
    const s = parseText(transcript({ content: 'Denied', is_error: flag }, agent));
    const b = Object.values(s.blocks).find(b => b.kind === 'tool_result');
    assert.ok(b); assert.equal(b.isError, flag === true ? true : undefined);
    assert.equal(Object.hasOwn(b, 'isError'), flag === true);
    assert.equal(b.toolName, 'Bash');
  }
});
test('split image result carries flag on every sub-block and counts one call', () => {
  const s = parseText(transcript({ is_error: true, content: [{ type: 'text', text: 'Denied' }, { type: 'image', source: { type: 'base64', data: '' } }, { type: 'text', text: 'Try again' }] }));
  const blocks = Object.values(s.blocks).filter(b => b.layer === 'results');
  assert.equal(blocks.length, 3); assert.ok(blocks.every(b => b.isError === true));
  const calls = failedToolCalls(s); assert.equal(calls.length, 1);
  assert.equal(calls[0].tokens, blocks.filter(b => b.kind === 'tool_result').reduce((n,b) => n+Math.ceil(resultText(b).length/4),0));
});
test('compact round trip preserves failure flags in root and subagent', () => {
  const s = parseText(transcript({ is_error: true, content: 'Denied' }));
  s.agents = [{ agentId: 'child', session: parseText(transcript({ is_error: true, content: 'Denied' }, true)) }];
  const decoded = expandSession(structuredClone(compactSession(s)));
  assert.deepEqual(decoded, s);
});
test('worker file consumption and compact transfer preserve failure', async () => {
  const file = new File([transcript({ is_error: true, content: 'Denied' })], 'test.jsonl');
  const s = expandSession(compactSession(await consumeFile(file)));
  assert.equal(failedToolCalls(s).length, 1);
});
test('failed detector only appears with failures and breaks down tools and runs', () => {
  assert.equal(findings(parseText(transcript({ content: 'OK' }))).some(f => f.kind === 'failed_tools'), false);
  const s = parseText(transcript({ is_error: true, content: 'Denied' }));
  s.agents = [{ agentId: 'child', agentType: 'Explore', session: parseText(transcript({ is_error: true, content: 'Denied' }, true)) }];
  const f = findings(s).find(f => f.kind === 'failed_tools');
  assert.equal(f.count, 2); assert.equal(f.targets.length, 2);
  assert.match(f.detail, /Main: Bash: 1/); assert.match(f.detail, /Explore: Bash: 1/);
  assert.equal(f.blockId, failedToolCalls(s)[0].blockId);
  assert.ok(f.cost > 0);
});
test('timeline tick positions mark the request where a failure first appears, with zoom and branch projection', () => {
  const s = { blocks: { ok: {}, bad: { isError: true } }, requests: [
    { blockIds: ['ok'], newBlockIds: ['ok'] }, { blockIds: ['ok','bad'], newBlockIds: ['bad'] },
    { blockIds: ['ok','bad'], newBlockIds: [] }, { blockIds: ['ok'], newBlockIds: [] }], events: [], meta: {} };
  assert.deepEqual(failedRequestIndices(s), [1]);
  assert.deepEqual(failureTickPositions(s, i => i*100), [{idx:1,x:100}]);
  assert.deepEqual(failureTickPositions(s, i => (i-1)*400), [{idx:1,x:0}]);
  assert.deepEqual(failureTickPositions(s, i => 20+i/3*60), [{idx:1,x:40}]);
  assert.deepEqual(failedRequestIndices(expandSession(compactSession(s))), [1]);
});

test('branch error ticks use child timestamps in time mode, interpolation for request and async branches', () => {
  const session = { blocks: { bad: { isError: true } }, requests: [0,1,2].map((i) => ({time:1000+i*100,blockIds:i===1?['bad']:[],newBlockIds:i===1?['bad']:[]})) };
  const options = {axis:'request',async:false,start:10,end:90,width:400,timeX:t=>(t-1000)/2};
  assert.deepEqual(branchFailureTickPositions(session,options),[{idx:1,x:50}]);
  assert.deepEqual(branchFailureTickPositions(session,{...options,axis:'time'}),[{idx:1,x:200}]);
  assert.deepEqual(branchFailureTickPositions(session,{...options,axis:'time',async:true}),[{idx:1,x:50}]);
  assert.deepEqual(branchFailureTickPositions(session,{...options,start:20,end:20}),[{idx:1,x:20}]);
});

test('no-subagent findings rank expensive output above a cheap failure',()=>{
  const s={meta:{},events:[],blocks:{cheap:{id:'cheap',kind:'tool_result',toolName:'Read',text:JSON.stringify({tool_use_id:'synthetic',content:'Oops'}),estTokens:100,isError:true},heavy:{id:'heavy',kind:'tool_result',toolName:'Read',text:'invented',estTokens:30000}},requests:[{idx:0,blockIds:['cheap','heavy'],newBlockIds:['cheap','heavy'],estTokens:30100}]};
  const ranked=findings(s), failed=ranked.find(f=>f.kind==='failed_tools');
  assert.equal(ranked[0].kind,'heavy_result');assert.equal(ranked[0].blockId,'heavy');
  assert.equal(failed.cost,1);assert.equal(failedToolCalls(s)[0].tokens,1);
  assert.ok(ranked.every((f,i)=>!i || ranked[i-1].cost>=f.cost));
});
