import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compactSession, expandSession } from '../src/ui/compact.js';
import { parseText } from '../src/parse.js';
import { layoutRequest } from '../src/layout.js';

function roundTrip(session) {
  const compact = compactSession(session);
  assert.ok(compact.tape instanceof Int32Array);
  assert.ok(compact.requests.every(r => !('blockIds' in r) && !('newBlockIds' in r)));
  const wire = structuredClone(compact, { transfer: [compact.tape.buffer, compact.offsets.buffer] });
  assert.equal(compact.tape.byteLength, 0);
  const restored = expandSession(wire);
  for (const i of [...session.requests.keys()].reverse()) {
    assert.deepEqual(restored.requests[i], session.requests[i]);
    assert.deepEqual(layoutRequest(restored, i), layoutRequest(session, i));
  }
  return { restored, wire };
}

test('compact transfer round trip preserves fixture blockIds, newBlockIds and newFrom exactly', async () => {
  roundTrip(parseText(await readFile(new URL('./fixtures/session.jsonl', import.meta.url), 'utf8')));
});

test('compact synthetic prefixes, replacements, repeated ids and cache eviction', () => {
  const blocks = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [String(i), { id: String(i), layer: 'message', kind: 'user_text', label: 'Synthetic', text: 'x', estTokens: 1 }]));
  const requests = Array.from({ length: 300 }, (_, i) => {
    const blockIds = Array.from({ length: i + 1 }, (_, j) => String(j));
    if (i % 13 === 0) blockIds.push('0');
    if (i % 17 === 0) blockIds.splice(0, 3);
    return { idx: i, ts: null, blockIds, newBlockIds: i % 2 ? [String(i)] : [], newFrom: Math.max(0, i - 3), measuredTokens: null, estTokens: blockIds.length };
  });
  const session = { meta: { window: 1e6 }, events: [], blocks, requests };
  const { restored, wire } = roundTrip(session);
  assert.ok(wire.tape.byteLength < JSON.stringify(requests).length / 4);
  const first = restored.requests[0].blockIds;
  for (let i = 1; i <= 9; i++) void restored.requests[i].blockIds;
  assert.notEqual(first, restored.requests[0].blockIds);
  assert.equal(restored.requests[0].blockIds, restored.requests[0].blockIds);
});
