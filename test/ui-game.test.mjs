import test from 'node:test';
import assert from 'node:assert/strict';
import { gameFacts, crossedEvents } from '../src/ui/game-model.js';

test('quests hide absent discoveries and summary handles measured zero', () => {
  const facts = gameFacts({ blocks: {}, requests: [{ blockIds: [], measuredTokens: 0, estTokens: 12 }], events: [], meta: { window: 100 } });
  assert.deepEqual(facts.quests, []);
  assert.equal(facts.peak, 0); assert.equal(facts.windowShare, 0);
});

test('summary excludes after-last compactions and tool loads', () => {
  const facts = gameFacts({ blocks: {}, requests: [{blockIds: [], estTokens: 0}], meta: {window: 100}, events: [
    {type: 'compaction', requestIdx: 0, data: {afterLast: true}},
    {type: 'tool_loaded', requestIdx: 0, data: {afterLast: true, names: ['Late']}}
  ] });
  assert.equal(facts.compactions, 0); assert.equal(facts.toolsLoaded, 0);
});
test('discoveries use session content and never materialize cumulative histories', () => {
  let reads = 0;
  const block = (id, kind, layer, estTokens) => ({ id, kind, layer, estTokens });
  const blocks = { s: block('s', 'system', 'system', 20), t: block('t', 'tool_def', 'tools', 70), u: block('u', 'user_text', 'message', 10) };
  blocks.t.toolName = 'Read';
  const requests = Array.from({ length: 4000 }, (_, idx) => ({ idx, measuredTokens: 100 + idx, estTokens: 100,
    get blockIds() { reads++; return ['s', 't', 'u']; } }));
  const events = [{ type: 'compaction', requestIdx: 1 }, { type: 'tool_loaded', requestIdx: 2, data: { names: ['Read'] } }];
  const facts = gameFacts({ blocks, requests, events, meta: { window: 10000 } });
  assert.equal(reads, 2); assert.equal(facts.toolShare, 70); assert.equal(facts.peak, 4099);
  assert.equal(facts.biggest.id, 't'); assert.equal(facts.compactions, 1); assert.equal(facts.toolsLoaded, 1);
  assert.deepEqual(facts.quests.map(q => q.id), ['system', 'schema', 'prompt', 'loaded', 'compact', 'biggest', 'walk']);
});
test('crossing events includes the destination once in either direction and excludes after-last notices', () => {
  const events = [{ type: 'user_prompt', requestIdx: 0 }, { type: 'compaction', requestIdx: 2 }, { type: 'tool_loaded', requestIdx: 3 }, { type: 'compaction', requestIdx: 3, data: { afterLast: true } }];
  assert.deepEqual(crossedEvents(events, 0, 3), events.slice(1, 3));
  assert.deepEqual(crossedEvents(events, 3, 0), events.slice(0, 2));
  assert.deepEqual(crossedEvents(events, 2, 2), []);
});

test('quest navigation searches transferred deltas without opening cumulative histories', async () => {
  const { compactSession, expandSession, findBlockRequest } = await import('../src/ui/compact.js');
  const blocks = Object.fromEntries(['a', 'b', 'c'].map(id => [id, { id }]));
  const source = { meta: {}, blocks, events: [], requests: [['a'], ['a', 'b'], ['c']].map((blockIds, idx) => ({ idx, blockIds, newBlockIds: blockIds, newFrom: 0 })) };
  const session = expandSession(compactSession(source));
  session.requests = new Proxy(session.requests, { get() { throw new Error('History expanded'); } });
  assert.equal(findBlockRequest(session, 'a'), 0); assert.equal(findBlockRequest(session, 'b'), 1);
  assert.equal(findBlockRequest(session, 'c'), 2); assert.equal(findBlockRequest(session, 'missing'), -1);
  assert.equal(findBlockRequest(source, 'b'), 1);
});

test('request stories follow prompt text, additions and compaction instead of marker focus', async () => {
  const { requestStories, fuelState } = await import('../src/ui/math.js');
  const session = { blocks: {
    u: {kind:'user_text',text:'<b>A new prompt</b>',label:'Prompt',estTokens:10},
    r: {kind:'tool_result',text:'result',label:'run_command result',estTokens:200},
    s: {kind:'user_text',text:'A summary',label:'Compacted summary',estTokens:20},
  }, requests: [
    {newBlockIds:['u'],estTokens:10,measuredTokens:20},
    {newBlockIds:['r'],estTokens:210,measuredTokens:420},
    {newBlockIds:['s'],estTokens:20,measuredTokens:38},
  ],events:[{type:'user_prompt',requestIdx:0,label:'Stale marker'}, {type:'compaction',requestIdx:2,data:{preTokens:402000,postTokens:38000}}] };
  const stories=requestStories(session);
  assert.match(stories[1].caption,/Request 2\. <b>A new prompt<\/b>\. \+1 blocks, 400 tokens: run_command result/);
  assert.match(stories[2].caption,/Request 3\. <b>A new prompt<\/b>\. Compaction: 402K to 38K/);
  assert.equal(fuelState(38000,400000,stories[2].compacted).status,'Compacted');
  assert.equal(fuelState(340000,400000).status,'Nearly full');
  assert.equal(fuelState(200000,400000).status,'Filling up');
  assert.equal(fuelState(10000,400000).status,'Plenty of room');
  assert.equal(fuelState(500000,400000).fill,1);
});
