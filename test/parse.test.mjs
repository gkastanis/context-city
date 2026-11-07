import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createParser, parseText } from '../src/parse.js';

const fixture = await readFile(new URL('./fixtures/session.jsonl', import.meta.url), 'utf8');
const encode = records => records.map(r => JSON.stringify(r)).join('\n');
const shape = { type: 'api-request-shape', shapeHash: 's', shape: { system: [{ type: 'text', text: 'Synthetic prefix' }], tools: [] } };
const req = (id, tail, keep = 0, extra = {}) => ({ type: 'api-request', id, querySource: 'repl_main_thread', shapeHash: 's', keep, tail, ...extra });
const blob = (hash, content, role = 'user') => ({ type: 'api-request-blob', hash, message: { role, content } });
const response = (requestRef, content, extra = {}) => ({ type: 'assistant', requestRef, message: { role: 'assistant', content }, ...extra });

test('streaming and parseText agree; metadata, keep/tail, prefix and dedup follow contract', () => {
  const parser = createParser({ sourceName: '/private/folder/synthetic.jsonl' });
  for (const line of fixture.split('\n')) parser.push(line);
  const s = parser.finish();
  const direct = parseText(fixture);
  direct.meta.sourceName = 'synthetic.jsonl';
  assert.deepEqual(s, direct);
  assert.equal(parser.finish(), s);
  assert.throws(() => parser.push('{}'), /finished/);
  assert.equal(s.meta.sourceName, 'synthetic.jsonl');
  assert.equal(s.meta.sessionId, 'synthetic-session');
  assert.equal(s.meta.model, 'synthetic-model');
  assert.equal(s.meta.cliVersion, '0.0.synthetic');
  assert.equal(s.meta.skippedLines, 1);
  assert.equal(s.meta.ignoredRecords, 1);
  assert.equal(s.meta.sidechainRequests, 1);
  assert.equal(s.meta.window, 1000000);
  assert.equal(s.meta.autocompactAt, null);
  assert.equal(s.meta.sample, false);
  assert.equal(s.meta.startedAt, '2026-01-01T00:00:00Z');
  assert.equal(s.meta.endedAt, '2026-01-01T00:00:03Z');
  assert.equal(s.requests.length, 3);
  assert.deepEqual(s.requests.map(r => r.measuredTokens), [60, 85, null]);
  assert.equal(s.requests[0].usage.output, 6); // explicit late response still answers request a
  const blocks = r => r.blockIds.map(id => s.blocks[id]);
  assert.deepEqual(blocks(s.requests[0]).map(b => b.kind), ['tool_def', 'system', 'user_text', 'reminder']);
  assert.deepEqual(blocks(s.requests[1]).map(b => b.kind), ['tool_def', 'system', 'user_text', 'reminder', 'thinking', 'tool_use', 'tool_result', 'tool_def']);
  assert.deepEqual(blocks(s.requests[2]).map(b => b.kind), ['tool_def', 'system', 'user_text']);
  assert.deepEqual(s.requests[1].newBlockIds, s.requests[1].blockIds.slice(4));
  for (const r of s.requests) assert.equal(r.estTokens, blocks(r).reduce((n, b) => n + b.estTokens, 0));
  for (const b of Object.values(s.blocks)) {
    assert.equal(b.chars, b.text?.length ?? 0);
    assert.equal(b.estTokens, Math.ceil(b.chars / 4));
    if (b.provenance === 'reconstructed') assert.ok(b.note);
  }
});

test('tool anatomy and events attach to first affected request, without repeated loads', () => {
  const s = parseText(fixture);
  const read = Object.values(s.blocks).find(b => b.toolName === 'Read' && b.kind === 'tool_def');
  assert.deepEqual(read.params, [
    { name: 'item', required: true, type: 'string', description: 'Pretend item name.' },
    { name: 'limit', required: false, type: 'integer', description: '' },
  ]);
  const def = JSON.parse(read.text);
  assert.equal(read.split.descTokens, Math.ceil(def.description.length / 4));
  assert.equal(read.split.schemaTokens, Math.ceil(JSON.stringify(def.input_schema).length / 4));
  const loaded = s.events.filter(e => e.type === 'tool_loaded');
  assert.deepEqual(loaded.map(e => [e.requestIdx, e.data.names]), [[1, ['mcp__demo__lookup']]]);
  assert.equal(Object.values(s.blocks).find(b => b.toolName === 'mcp__demo__lookup').layer, 'mcp');
  assert.equal(Object.values(s.blocks).find(b => b.kind === 'tool_result').toolName, 'Read');
  for (const type of ['deferred_tools', 'mcp_instructions', 'skill_listing', 'user_prompt']) assert.equal(s.events.find(e => e.type === type).requestIdx, 0);
  assert.deepEqual(s.events.find(e => e.type === 'compaction').data, { trigger: 'auto', preTokens: 85, postTokens: 20 });
  assert.equal(s.events.find(e => e.type === 'compaction').requestIdx, 2);
});

test('missing shape and tail are unavailable, never fabricated; unknown and malformed lines count', () => {
  const s = parseText(encode([req('a', ['absent']), { type: 'new-kind' }, null, [], { type: 'synthetic-metadata' }]) + '\n{bad\n');
  assert.equal(s.meta.skippedLines, 3);
  assert.equal(s.meta.ignoredRecords, 2);
  assert.equal(s.requests[0].usage, null);
  assert.equal(s.requests[0].measuredTokens, null);
  assert.equal(Object.values(s.blocks).length, 2);
  assert.ok(Object.values(s.blocks).every(b => b.provenance === 'unavailable' && b.text === null && b.chars === 0 && b.note));
});

test('generic and unknown non-message records count without retaining their names', () => {
  const types = ['file-history-snapshot', 'summary', 'progress', 'queue-operation', 'system', 'synthetic-future-record'];
  const s = parseText(encode([...types.map(type => ({ type })), {}, { type: 5 }]));
  assert.equal(s.meta.ignoredRecords, types.length);
  assert.equal(s.meta.skippedLines, 2);
  assert.deepEqual(s.blocks, {});
  for (const type of types) assert.ok(!JSON.stringify(s).includes(type));
});

test('sidechains and non-main query sources never alter keep state or usage', () => {
  const s = parseText(encode([shape, blob('u', 'Pretend user'), req('a', ['u']),
    req('side', [], 0, { isSidechain: true }), req('title', [], 0, { querySource: 'query_page_title' }),
    response('side', [{ type: 'text', text: 'Side answer' }], { isSidechain: true }),
    response('title', [{ type: 'text', text: 'Title answer' }]),
    { type: 'assistant', message: { role: 'assistant', content: [], usage: { input_tokens: 999 } } },
    req('b', [], 1)]));
  assert.equal(s.meta.sidechainRequests, 2);
  assert.equal(s.requests.length, 2);
  assert.deepEqual(s.requests[1].blockIds, s.requests[0].blockIds);
  assert.equal(s.requests[0].usage, null);
});

test('late blobs, prefix changes, identical text and repeated message occurrences', () => {
  const s = parseText(encode([req('a', ['u']), blob('u', [{ type: 'text', text: 'Same synthetic text' }]), shape,
    { ...shape, shapeHash: 's2', shape: { system: [{ type: 'text', text: 'New prefix' }], tools: [] } },
    req('b', ['u'], 1, { shapeHash: 's2' })]));
  assert.equal(s.requests[1].blockIds.length, 3);
  assert.equal(s.requests[1].blockIds[1], s.requests[1].blockIds[2]);
  assert.equal(s.requests[1].newBlockIds.length, 1);
  assert.equal(s.requests[1].estTokens, s.blocks[s.requests[1].blockIds[0]].estTokens + 2 * s.blocks[s.requests[1].blockIds[1]].estTokens);
});

test('recovery excludes already recorded assistant responses and respects part order', () => {
  const call = { type: 'tool_use', name: 'Pretend', id: 'call-1', input: {} };
  const s = parseText(encode([shape, req('a', []), response('a', [call]), blob('known', [call], 'assistant'),
    req('b', ['known']), response('b', [{ type: 'text', text: 'Last part' }], { apiBlockIndex: 1 }),
    response('b', [{ type: 'thinking', thinking: 'First part' }], { apiBlockIndex: 0 }),
    req('c', ['missing'], 1)]));
  assert.deepEqual(s.requests[2].blockIds.map(id => s.blocks[id].kind), ['system', 'tool_use', 'thinking', 'assistant_text']);
  assert.ok(s.requests[2].blockIds.slice(2).every(id => s.blocks[id].provenance === 'reconstructed'));
  assert.equal(s.blocks[s.requests[1].blockIds[1]].provenance, 'verbatim');
});

test('structured parts and empty sessions work with CRLF, unicode and Windows source names', () => {
  assert.equal(parseText('').requests.length, 0);
  const p = createParser({ sourceName: 'C:\\private\\synthetic.jsonl' });
  for (const r of [shape, blob('u', [{ type: 'image', source: { type: 'base64', data: 'c3ludGhldGlj' } }, { type: 'text', text: '□' }]), req('a', ['u'])]) p.push(JSON.stringify(r) + '\r');
  const s = p.finish();
  assert.equal(s.meta.sourceName, 'synthetic.jsonl');
  assert.ok(Object.values(s.blocks).some(b => b.kind === 'attachment' && b.provenance === 'verbatim'));
  assert.ok(Object.values(s.blocks).some(b => b.text === '□' && b.estTokens === 1));
});

test('real SHA-256 tail hashes recover split assistant parts and user turns exactly', () => {
  const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sorted(value[k])])) : value;
  const wireHash = message => createHash('sha256').update(JSON.stringify(sorted(message))).digest('hex');
  for (const text of ['', '□', 'Pretend '.repeat(130)]) {
    const thinking = { type: 'thinking', thinking: 'Synthetic reasoning', signature: 'synthetic-signature' };
    const answer = { type: 'text', text };
    const user = { role: 'user', content: [{ type: 'text', text: `Synthetic user ${text}` }] };
    const full = { role: 'assistant', content: [thinking, answer] };
    const stripped = { role: 'assistant', content: [answer] };
    const s = parseText(encode([shape, req('a', []),
      response('a', [thinking], { apiBlockIndex: 0 }), response('a', [answer], { apiBlockIndex: 1 }),
      { type: 'user', message: user },
      req('b', [wireHash(full), wireHash(stripped), wireHash(user), '0'.repeat(64)])]));
    const blocks = s.requests[1].blockIds.map(id => s.blocks[id]);
    assert.deepEqual(blocks.map(b => b.kind), ['system', 'thinking', 'assistant_text', 'assistant_text', 'user_text', 'assistant_text']);
    assert.equal(blocks[2].text, text);
    assert.equal(blocks[4].text, `Synthetic user ${text}`);
    assert.ok(blocks.slice(1, 5).every(b => b.provenance === 'reconstructed' && b.note));
    assert.equal(blocks.at(-1).provenance, 'unavailable');
  }
});


const cases = await import('./fixtures/review-cases.mjs');
const run = records => parseText(encode(records));
const requestBlocks = (s, idx) => s.requests[idx].blockIds.map(id => s.blocks[id]);

test('custom output style is main; sdk is main only without repl requests; base selects its own chain', () => {
  assert.equal(run(cases.custom).requests.length, 1);
  const headless = run(cases.sdk);
  assert.equal(headless.meta.source, 'requests');
  assert.equal(headless.requests[0].measuredTokens, 330);
  const mixed = run([...cases.sdk, ...cases.custom]);
  assert.equal(mixed.requests.length, 1);
  assert.equal(mixed.meta.sidechainRequests, 1);
  const s = run([shape, blob('one', 'Synthetic one'), blob('two', 'Synthetic two'), blob('three', 'Synthetic three'),
    req('a', ['one']), req('b', ['two']), req('c', ['three'], 1, { base: 'a' })]);
  assert.deepEqual(requestBlocks(s, 2).map(b => b.text), ['Synthetic prefix', 'Synthetic one', 'Synthetic three']);
});

test('unmatched user hashes recover prompts and tool results from interval user records', () => {
  const s = run(cases.unmatched);
  const result = requestBlocks(s, 1).at(-1), prompt = requestBlocks(s, 2).at(-1);
  assert.equal(result.kind, 'tool_result');
  assert.equal(result.toolName, 'SyntheticTool');
  assert.equal(prompt.kind, 'user_text');
  for (const b of [result, prompt]) { assert.equal(b.role, 'user'); assert.equal(b.provenance, 'reconstructed'); assert.match(b.note, /wire text may differ/); }
  const unknown = run([shape, blob('call', [{ type: 'tool_use', id: 'z', name: 'Synthetic', input: {} }], 'assistant'), req('a', ['call', '3'.repeat(64)])]);
  assert.equal(requestBlocks(unknown, 0).at(-1).kind, 'tool_result');
  assert.equal(requestBlocks(unknown, 0).at(-1).provenance, 'unavailable');
});

test('signature-only thinking remains distinct with zero unavailable tokens', () => {
  const s = run([shape, blob('think', [{ type: 'thinking', signature: 'synthetic-one' }, { type: 'thinking', thinking: '', signature: 'synthetic-two' }], 'assistant'), req('a', ['think'])]);
  const thinking = requestBlocks(s, 0).slice(1);
  assert.notEqual(thinking[0].id, thinking[1].id);
  for (const b of thinking) { assert.equal(b.estTokens, 0); assert.equal(b.chars, 0); assert.equal(b.provenance, 'unavailable'); assert.match(b.note, /signature only/); }
});

test('tool result images decode PNG dimensions without base64 in text or chars', () => {
  const s = run([shape, blob('r', [{ type: 'tool_result', tool_use_id: 'c', content: [
    { type: 'text', text: 'Synthetic before' }, cases.image, { type: 'text', text: 'Synthetic after' },
  ] }]), req('a', ['r'])]);
  const blocks = requestBlocks(s, 0).slice(1);
  assert.deepEqual(blocks.map(b => b.kind), ['tool_result', 'attachment', 'tool_result']);
  assert.equal(blocks[1].estTokens, 2);
  assert.equal(blocks[1].chars, 0);
  assert.match(blocks[1].note, /30×50/);
  assert.ok(!blocks.some(b => b.text?.includes(cases.image.source.data)));
  const fallback = run([shape, blob('image', [{ type: 'image', source: { data: 'invalid' } }]), req('a', ['image'])]);
  assert.equal(requestBlocks(fallback, 0).at(-1).estTokens, 1600);
  assert.match(requestBlocks(fallback, 0).at(-1).note, /fallback/);
});

test('command, meta and summary records do not generate prompts; events after last are retained', () => {
  const s = run(cases.wrappers);
  assert.deepEqual(s.events.filter(e => e.type === 'user_prompt').map(e => e.requestIdx), [1]);
  const deferred = s.events.filter(e => e.type === 'deferred_tools');
  assert.deepEqual(deferred.map(e => e.data.names), [['A', 'B'], ['C', 'D']]);
  assert.ok(deferred.every(e => e.requestIdx === 1 && e.data.afterLast === true));
});

test('records fallback uses distinct assistant ids, measured usage, parent chains and compaction', () => {
  const linked = [...cases.recordsOnly];
  linked.splice(1, 0, { type: 'attachment', uuid: 'bridge', parentUuid: 'u1', attachment: { type: 'synthetic' } });
  linked[2] = { ...linked[2], parentUuid: 'bridge' };
  const s = run(linked);
  assert.equal(s.meta.source, 'records'); assert.equal(s.meta.emptyReason, null);
  assert.equal(s.requests.length, 3);
  assert.deepEqual(s.requests.map(r => r.measuredTokens), [330, 330, 330]);
  assert.deepEqual(requestBlocks(s, 1).slice(1).map(b => b.text), ['Synthetic first prompt', 'Synthetic answer', 'Synthetic thought', 'Synthetic second prompt']);
  assert.deepEqual(requestBlocks(s, 2).slice(1).map(b => b.text), ['Synthetic compacted context']);
  const prefix = requestBlocks(s, 0)[0];
  assert.equal(prefix.label, 'System prompt and tools (not recorded)');
  assert.equal(prefix.provenance, 'unavailable');
  assert.equal(s.requests[0].estTokens, 330);
  assert.ok(Object.values(s.blocks).filter(b => b !== prefix).every(b => b.provenance === 'reconstructed'));
  assert.equal(s.events.find(e => e.type === 'compaction').requestIdx, 2);
  assert.equal(s.events.find(e => e.type === 'skill_listing').data.afterLast, true);
});

test('newFrom preserves repeated tails and parseText accepts metadata options and empty reasons', () => {
  const s = run([shape, blob('u', 'Repeated synthetic prompt'), req('a', ['u']), req('b', ['u'], 1)]);
  assert.equal(s.requests[1].newFrom, 2);
  const replacement = run([shape, blob('u', 'Repeated synthetic prompt'), req('a', ['u']), req('b', ['u'])]);
  assert.equal(replacement.requests[1].newFrom, 1);
  assert.deepEqual(s.requests[1].newBlockIds, []);
  assert.equal(parseText('', { sourceName: '/synthetic/test.jsonl' }).meta.sourceName, 'test.jsonl');
  assert.equal(parseText('').meta.source, 'empty');
  assert.ok(parseText('').meta.emptyReason);
});

test('metadata user blobs cannot recreate suppressed prompt events', () => {
  const s = run([shape, cases.user('meta', 'Synthetic meta', { isMeta: true }),
    blob('meta-wire', 'Synthetic meta\n<system-reminder>Synthetic harness addition</system-reminder>'), req('a', ['meta-wire'])]);
  assert.equal(s.events.filter(e => e.type === 'user_prompt').length, 0);
});

test('records prefix sizing uses first available measurement and repeated stream indices replace snapshots', () => {
  const first = cases.assistant('a', 'm1', [{ type: 'text', text: 'Synthetic first answer' }], 'u');
  delete first.message.usage;
  const s = run([cases.user('u', 'Synthetic prompt', { parentUuid: null }), first,
    cases.assistant('b', 'm2', [{ type: 'text', text: 'Synthetic stale' }], 'a', { apiBlockIndex: 0 }),
    cases.assistant('c', 'm2', [{ type: 'text', text: 'Synthetic replacement' }], 'b', { apiBlockIndex: 0 }),
    cases.user('v', 'Synthetic next prompt', { parentUuid: 'c' }),
    cases.assistant('d', 'm3', [], 'v')]);
  assert.equal(s.requests.length, 3);
  assert.equal(s.requests[0].measuredTokens, null);
  assert.equal(s.requests[1].estTokens, 330);
  assert.ok(!requestBlocks(s, 2).some(b => b.text === 'Synthetic stale'));
  assert.equal(requestBlocks(s, 2).filter(b => b.text === 'Synthetic replacement').length, 1);
});

test('GIF, JPEG and WebP header variants decode image dimensions', () => {
  const gif = Buffer.alloc(10); gif.write('GIF89a'); gif.writeUInt16LE(30, 6); gif.writeUInt16LE(50, 8);
  const jpeg = Buffer.from([255,216,255,192,0,17,8,0,50,0,30,3,1,0,0,0,0,0,0,0,0,0,0]);
  const webps = ['VP8X', 'VP8L', 'VP8 '].map(tag => {
    const b = Buffer.alloc(32); b.write('RIFF'); b.write('WEBP', 8); b.write(tag, 12);
    if (tag === 'VP8X') { b[24] = 29; b[27] = 49; }
    if (tag === 'VP8L') { b[20] = 0x2f; b[21] = 29; b[22] = 64; b[23] = 12; }
    if (tag === 'VP8 ') { b.set([157,1,42], 23); b.writeUInt16LE(30, 26); b.writeUInt16LE(50, 28); }
    return b;
  });
  for (const bytes of [gif, jpeg, ...webps]) {
    const s = run([shape, blob('image', [{ type: 'image', source: { type: 'base64', data: bytes.toString('base64') } }]), req('a', ['image'])]);
    const image = requestBlocks(s, 0).at(-1);
    assert.equal(image.estTokens, 2); assert.match(image.note, /30×50/);
  }
});
