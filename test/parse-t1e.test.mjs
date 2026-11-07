import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseText } from '../src/parse.js';
import { shape, request, user, assistant, blob, call, result } from './fixtures/t1c-cases.mjs';

const run = records => parseText(records.map(r => JSON.stringify(r)).join('\n'));
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object'
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
const hash = message => createHash('sha256').update(JSON.stringify(canonical(message))).digest('hex');
const blocks = (s, idx = 0) => s.requests[idx].blockIds.map(id => s.blocks[id]);
const promptIndices = s => s.events.filter(e => e.type === 'user_prompt').map(e => e.requestIdx);

test('T1e: adding a tool prefix does not prompt again for retained history', () => {
  const u = user('u', 'Synthetic retained prompt', { origin: { kind: 'human' } });
  const changed = { ...shape, shapeHash: 's2', shape: { ...shape.shape,
    tools: [{ name: 'SyntheticNewTool', input_schema: { type: 'object' } }] } };
  const s = run([shape, u, blob('u', u.message), request('q0', ['u']), changed,
    request('q1', [], { keep: 1, shapeHash: 's2' })]);
  assert.deepEqual(promptIndices(s), [0]);
  assert.deepEqual(s.events.filter(e => e.type === 'tool_loaded').map(e => e.data.names), [['SyntheticNewTool']]);
});

test('T1e: repeated inferred prompt occurrence survives a prefix change', () => {
  const u = user('late', 'yes', { origin: { kind: 'human' } });
  const changed = { ...shape, shapeHash: 's2', shape: { system: ['Synthetic changed prefix'], tools: [] } };
  const s = run([shape, blob('u', u.message), request('q0', ['u']), u, changed,
    request('q1', ['u'], { keep: 1, shapeHash: 's2' }), { ...u, uuid: 'later' }]);
  assert.deepEqual(promptIndices(s), [0, 1]);
});

test('T1e: resumed pre-API split assistant records resolve full and thinking-stripped wire hashes', () => {
  const thought = { type: 'thinking', thinking: 'Synthetic thought', signature: 'synthetic' };
  const tool = call('resumed');
  const full = { role: 'assistant', content: [thought, tool] };
  const stripped = { role: 'assistant', content: [tool] };
  const s = run([shape,
    assistant('a0', 'resumed-message', [thought], null, { apiBlockIndex: 0 }),
    assistant('a1', 'resumed-message', [tool], 'a0', { apiBlockIndex: 1 }),
    user('r', [result('resumed')]),
    request('q0', [hash(full), hash({ role: 'user', content: [result('resumed')] })]),
    request('q1', [hash(stripped)])]);
  assert.deepEqual(blocks(s).slice(1).map(b => b.kind), ['thinking', 'tool_use', 'tool_result']);
  assert.deepEqual(blocks(s, 1).slice(1).map(b => b.kind), ['tool_use']);
  assert.ok(Object.values(s.blocks).every(b => b.label !== 'Unavailable message'));
});

test('T1e: pre-API records never become ordering candidates for unrelated hashes', () => {
  const s = run([shape, assistant('old', 'old-message', [call('old')], null),
    request('q0', ['unrelated'])]);
  assert.equal(blocks(s).at(-1).provenance, 'unavailable');
  assert.equal(blocks(s).filter(b => b.kind === 'tool_use').length, 0);
});

for (const role of ['user', 'assistant']) test(`T1e: placeholder looks past system-only messages after ${role}`, () => {
  const s = run([shape, blob('previous', { role, content: 'Synthetic previous' }),
    blob('sys1', { role: 'system', content: 'Synthetic wire system' }),
    blob('sys2', { role: 'system', content: 'Synthetic second wire system' }),
    request('q0', ['previous', 'sys1', 'sys2', 'e'.repeat(64)])]);
  const b = blocks(s).at(-1);
  assert.equal(b.label, 'Unavailable message');
  assert.equal(b.role, role === 'user' ? 'assistant' : 'user');
});

test('T1e: call-id reconstruction retains all record parts once, including multiple results', () => {
  const content = [result('one'), { type: 'text', text: 'Synthetic accompanying text' }, result('two')];
  const s = run([shape, user('r', content), assistant('bridge', 'bridge-message', [], 'r'),
    blob('calls', { role: 'assistant', content: [call('one'), call('two')] }),
    request('q0', ['calls', 'f'.repeat(64)])]);
  const tail = blocks(s).slice(-3);
  assert.deepEqual(tail.map(b => b.kind), ['tool_result', 'user_text', 'tool_result']);
  assert.equal(tail[1].text, content[1].text);
  assert.equal(blocks(s).filter(b => b.kind === 'tool_result').length, 2);
});

test('T1e: call-id reconstruction consumes the matching interval candidate', () => {
  const s = run([shape, request('q0'),
    user('r', [result('one'), { type: 'text', text: 'Synthetic accompanying text' }]),
    blob('calls', { role: 'assistant', content: [call('one')] }),
    request('q1', ['calls', 'f'.repeat(64), 'e'.repeat(64)])]);
  assert.equal(blocks(s, 1).filter(b => b.kind === 'tool_result').length, 1);
  assert.equal(blocks(s, 1).filter(b => b.text === 'Synthetic accompanying text').length, 1);
});

test('T1e: pre-API snapshots replace parts without seeding request usage', () => {
  const tool = call('replacement');
  const a = content => assistant('a', 'resumed', content, null, { apiBlockIndex: 0 });
  const latest = a([tool]); latest.message.usage = { input_tokens: 999 };
  const s = run([shape, a([{ type: 'text', text: 'Synthetic stale snapshot' }]), latest,
    request('q0', [hash({ role: 'assistant', content: [tool] })])]);
  assert.deepEqual(blocks(s).slice(1).map(b => b.kind), ['tool_use']);
  assert.equal(s.requests[0].usage, null);
  assert.ok(Object.values(s.blocks).every(b => b.text !== 'Synthetic stale snapshot'));
});

test('T1e: call-id recovery looks past intervening system wire messages', () => {
  const s = run([shape, user('r', [result('one')]), assistant('bridge', 'bridge', [], 'r'),
    blob('calls', { role: 'assistant', content: [call('one')] }),
    blob('sys', { role: 'system', content: 'Synthetic wire system' }),
    request('q0', ['calls', 'sys', 'f'.repeat(64)])]);
  assert.equal(blocks(s).at(-1).kind, 'tool_result');
  assert.equal(blocks(s).at(-1).provenance, 'reconstructed');
});
