import test from 'node:test';
import assert from 'node:assert/strict';
import { parseText } from '../src/parse.js';
import { shape, request, user, assistant, blob, call, result } from './fixtures/t1c-cases.mjs';
import { parallelSiblings } from './fixtures/t1d-cases.mjs';
const run = records => parseText(records.map(r => JSON.stringify(r)).join('\n'));
const blocks = (s, idx = 0) => s.requests[idx].blockIds.map(id => s.blocks[id]);
const prompts = s => s.events.filter(e => e.type === 'user_prompt');

test('T1d: three sibling results reach the next request once and before its next prompt', () => {
  const s = run(parallelSiblings);
  assert.equal(s.requests.length, 2);
  assert.equal(blocks(s).filter(b => b.kind === 'tool_result').length, 0);
  const next = blocks(s, 1);
  assert.deepEqual(next.filter(b => b.kind === 'tool_result').map(b => JSON.parse(b.text).tool_use_id).sort(), ['t1', 't2', 't3']);
  assert.ok(next.filter(b => b.kind === 'tool_result').every(b => next.indexOf(b) < next.findIndex(b => b.text === 'Synthetic next prompt')));
});

test('T1d: identical human prompts in consecutive requests each produce an event', () => {
  const u = id => user(id, 'yes', { origin: { kind: 'human' } });
  const s = run([shape, u('u1'), blob('yes', u('u1').message), request('q0', ['yes']),
    assistant('a', 'm', [], 'u1'), u('u2'), request('q1', ['yes'], { keep: 1 })]);
  assert.deepEqual(prompts(s).map(e => e.requestIdx), [0, 1]);
});

test('T1d: each repeated inferred tail suppresses only one late record event', () => {
  const u = id => user(id, 'yes', { origin: { kind: 'human' } });
  const s = run([shape, blob('yes', u('x').message), request('q0', ['yes']), u('u1'),
    request('q1', ['yes'], { keep: 1 }), u('u2')]);
  assert.deepEqual(prompts(s).map(e => e.requestIdx), [0, 1]);
});

test('T1d: resumed results are recovered by call ids despite intervening assistant records', () => {
  const calls = { role: 'assistant', content: [call('t1'), call('t2')] };
  const s = run([shape, user('r1', [result('t1')]), assistant('a1', 'old1', [], 'r1'),
    user('r2', [result('t2')]), assistant('a2', 'old2', [], 'r2'),
    blob('calls', calls), request('q0', ['calls', 'f'.repeat(64)])]);
  assert.deepEqual(blocks(s).filter(b => b.kind === 'tool_result').map(b => JSON.parse(b.text).tool_use_id), ['t1', 't2']);
  assert.equal(blocks(s).filter(b => b.label === 'Unavailable message').length, 0);
});

test('T1d: image-only results retain linkage, layer and tool name without image bytes', () => {
  const image = { type: 'image', source: { data: 'synthetic-image' } };
  const s = run([shape, blob('call', { role: 'assistant', content: [call('t')] }),
    blob('result', { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: [image] }] }),
    request('q', ['call', 'result'])]);
  const b = blocks(s).at(-1);
  assert.equal(b.kind, 'attachment'); assert.equal(b.layer, 'results');
  assert.equal(b.toolUseId, 't'); assert.equal(b.toolName, 'SyntheticTool');
  assert.equal(b.text, null); assert.equal(b.chars, 0); assert.equal(b.estTokens, 1600);
});

test('T1d: all events consumed by pre-API fallback groups move to request zero once', () => {
  const s = run([shape, user('u1', 'Synthetic first', { origin: { kind: 'human' } }),
    assistant('a1', 'm1', [], 'u1'), user('u2', 'Synthetic second', { origin: { kind: 'human' } }),
    assistant('a2', 'm2', [], 'u2'), request('q0')]);
  assert.deepEqual(prompts(s).map(e => e.requestIdx), [0, 0]);
});
