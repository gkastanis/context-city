import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseText } from '../src/parse.js';
import { shape, request, user, assistant, blob, call, result, interleaved } from './fixtures/t1c-cases.mjs';
const run = records => parseText(records.map(r => JSON.stringify(r)).join('\n'));
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
const hash = message => createHash('sha256').update(JSON.stringify(canonical(message))).digest('hex');
const blocks = (s, idx) => s.requests[idx].blockIds.map(id => s.blocks[id]);

test('H1/M1: user logged after its own request is neither rebuilt nor prompted twice', () => {
  const u = user('late', 'Synthetic late prompt', { origin: { kind: 'human' } });
  const h = hash(u.message);
  const s = run([shape, blob(h, u.message), request('q0', [h]), u, request('q1', ['missing'], { keep: 1 })]);
  assert.equal(blocks(s, 1).filter(b => b.text === u.message.content).length, 1);
  assert.equal(s.events.filter(e => e.type === 'user_prompt').length, 1);
});

test('H1: resumed history before first request is not substituted for a missing user tail', () => {
  const old = user('old', [result('old-tool')]);
  const fresh = user('fresh', 'Synthetic resumed prompt');
  const h = hash(old.message);
  const s = run([shape, old, assistant('a', 'history', [call('another-tool')], 'old'), fresh,
    blob(h, old.message), request('q', ['missing-user', h])]);
  assert.equal(blocks(s, 0).filter(b => b.kind === 'tool_result').length, 1);
  assert.equal(blocks(s, 0).filter(b => b.text === fresh.message.content).length, 1);
});

test('H2: SyntheticSearch shape additions and removals produce named tool_loaded deltas', () => {
  const def = name => ({ name, input_schema: { type: 'object' } });
  const s = run([{ ...shape, shape: { tools: [def('SyntheticSearch'), def('OldTool')] } }, request('q0'),
    assistant('a', 'm', [{ ...call('search'), name: 'SyntheticSearch' }], null),
    { ...shape, shapeHash: 's2', shape: { tools: [def('SyntheticSearch'), def('mcp__synthetic__draw')] } },
    request('q1', [], { shapeHash: 's2' })]);
  assert.deepEqual(s.events.filter(e => e.type === 'tool_loaded').map(e => [e.requestIdx, e.data]),
    [[1, { names: ['mcp__synthetic__draw'], removed: ['OldTool'] }]]);
});

test('H3: records fallback preserves interleaved results in multi-record assistant ancestry', () => {
  const s = run(interleaved);
  assert.equal(s.meta.source, 'records');
  assert.equal(s.requests.length, 2);
  assert.deepEqual(blocks(s, 1).filter(b => ['tool_use', 'tool_result'].includes(b.kind)).map(b => b.kind),
    ['tool_use', 'tool_result', 'tool_use', 'tool_result']);
});

for (const [label, extra, content, expected] of [
  ['task notification wrapper', {}, '<task-notification>Synthetic task complete</task-notification>', 0],
  ['human origin', { origin: { kind: 'human' } }, 'Synthetic human prompt', 1],
  ['other origin', { origin: { kind: 'task-notification' } }, 'Synthetic task complete', 0],
]) test(`M1: ${label} prompt eligibility applies to records and wire inference`, () => {
  const u = user('u', content, extra), h = hash(u.message);
  const s = run([shape, u, blob(h, u.message), request('q', [h])]);
  assert.equal(s.events.filter(e => e.type === 'user_prompt').length, expected);
});

test('L1: records prefix has no invented chars and documents first-turn reminders', () => {
  const a = assistant('a', 'm', [], 'u'); a.message.usage = { input_tokens: 500 };
  const s = run([user('u', 'Synthetic prompt'), a]);
  const prefix = blocks(s, 0)[0];
  assert.equal(prefix.chars, 0);
  assert.match(prefix.note, /first-turn reminders/);
  assert.ok(prefix.estTokens > 0);
});

test('L1: synthetic assistant messages create no records requests or content', () => {
  const a = assistant('fake', 'fake-message', [{ type: 'text', text: 'Synthetic excluded answer' }], 'u');
  a.message.model = '<synthetic>';
  const s = run([user('u', 'Synthetic prompt'), a, assistant('a', 'm', [], 'fake')]);
  assert.equal(s.requests.length, 1);
  assert.ok(!blocks(s, 0).some(b => b.text === 'Synthetic excluded answer'));
});

test('L2: empty deferred records are silent, removals survive', () => {
  const a = attachment => ({ type: 'attachment', attachment });
  const s = run([shape, a({ type: 'deferred_tools_record', entries: [] }),
    a({ type: 'deferred_tools_delta', removedNames: ['SyntheticOld'] }), request('q')]);
  assert.deepEqual(s.events.filter(e => e.type === 'deferred_tools').map(e => e.data),
    [{ names: [], removed: ['SyntheticOld'] }]);
});

test('L3: filtered SDK requests preserve pending events and user reconstruction', () => {
  const s = run([shape, user('u', 'Synthetic pending prompt'),
    { type: 'attachment', attachment: { type: 'skill_listing', names: ['SyntheticSkill'] } },
    request('sdk', [], { querySource: 'sdk' }), request('main', ['missing-user'])]);
  assert.equal(s.requests.length, 1);
  assert.equal(s.meta.sidechainRequests, 1);
  assert.ok(blocks(s, 0).some(b => b.text === 'Synthetic pending prompt'));
  assert.deepEqual(s.events.map(e => [e.type, e.requestIdx]), [['user_prompt', 0], ['skill_listing', 0]]);
});

test('H1: clipped user result is not rebuilt beside a wire result with the same tool-use id', () => {
  const clipped = user('u', [result('shared')]);
  const wire = { role: 'user', content: [{ ...result('shared'), content: 'Synthetic longer wire result' }] };
  const h = hash(wire);
  const s = run([shape, clipped, blob(h, wire), request('q', ['missing-user', h])]);
  assert.equal(blocks(s, 0).filter(b => b.kind === 'tool_result').length, 1);
});

test('M1: late human record matches earlier wire text with harness reminders', () => {
  const u = user('late', 'Synthetic wrapped prompt', { origin: { kind: 'human' } });
  const wire = { role: 'user', content: 'Synthetic wrapped prompt\n<system-reminder>Synthetic context</system-reminder>' };
  const h = hash(wire);
  const s = run([shape, blob(h, wire), request('q0', [h]), u, request('q1', [], { keep: 1 })]);
  assert.deepEqual(s.events.filter(e => e.type === 'user_prompt').map(e => e.requestIdx), [0]);
});

test('M1: wire inference respects a nonhuman origin with added harness reminders', () => {
  const u = user('peer', 'Synthetic peer message', { origin: { kind: 'peer' } });
  const wire = { role: 'user', content: 'Synthetic peer message\n<system-reminder>Synthetic context</system-reminder>' };
  const h = hash(wire);
  const s = run([shape, blob(h, wire), request('q0', [h]), u]);
  assert.equal(s.events.filter(e => e.type === 'user_prompt').length, 0);
});
