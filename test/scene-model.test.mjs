import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { eventLayout, overviewRange, createQualityMonitor } from '../src/scene/model.js';
import { layoutRequest } from '../src/layout.js';

test('sample request 10 tool load targets its own new buildings', async () => {
  const s = JSON.parse(await readFile(new URL('../sample/fresh-session.json', import.meta.url)));
  const event = s.events.find(e => e.type === 'tool_loaded' && e.requestIdx === 10);
  const own = eventLayout(s, event), previous = new Set(s.requests[9].blockIds);
  assert.equal(own.targets.length, 7);
  assert.ok(own.targets.every(it => s.requests[10].blockIds.includes(it.blockId) && !previous.has(it.blockId)));
  assert.ok(own.targets.filter(it => it.kind === 'tool_def').length > 0);
  assert.deepEqual(own.items, layoutRequest(s, 10).items);
  const range = overviewRange(layoutRequest(s, 17));
  assert.ok(range.z0 > 0); assert.equal(range.z1 - range.z0, range.high * 8);
  assert.equal(overviewRange(own, true).z0, 0);
});

test('quality ignores background gaps, recovers automatically, and honors explicit low', () => {
  const changes = [], q = createQualityMonitor(level => changes.push(level));
  for (const gap of [60, 120, 600]) { q.sample(gap); for (let i=0;i<120;i++) q.sample(1/60); }
  assert.deepEqual(changes, []);
  for (let i=0;i<120;i++) q.sample(.05);
  assert.deepEqual(changes, ['low']);
  for (let i=0;i<601;i++) q.sample(1/60);
  assert.deepEqual(changes, ['low','high']);
  q.set('low', true);
  for (let i=0;i<1200;i++) q.sample(1/60);
  assert.deepEqual(changes, ['low','high','low']);
});
