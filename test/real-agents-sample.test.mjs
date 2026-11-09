import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { agentBranches, allAgentsLoaded } from '../src/ui/agents.js';
import { compactSession, expandSession } from '../src/ui/compact.js';
import { toolReport } from '../src/ui/tools.js';

const text = await readFile(new URL('../sample/real-agents-session.json', import.meta.url), 'utf8');
const sample = JSON.parse(text);
test('every sample timestamp is in the fixed shifted session window, including text and child runs', () => {
  const start = Date.parse('2026-01-01T00:00:00Z'), end = start + 5 * 60 * 1000;
  const times = [];
  function visit(value, key) {
    if (value && typeof value === 'object') for (const [k,v] of Object.entries(value)) visit(v,k);
    else if (typeof value === 'number' && ['time','timestamp','ts'].includes(key)) times.push(value);
    else if (typeof value === 'string') for (const m of value.matchAll(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g)) times.push(Date.parse(m[0]));
  }
  visit(sample);
  assert.ok(times.length > 200);
  assert.equal(Math.min(...times),start);
  assert.ok(times.every(t => t >= start && t <= end));
  for (const date of text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) assert.equal(date[0], '2026-01-01');
  assert.equal(toolReport(sample).tools.filter(t => t.latency.median != null).length,4);
});

test('recorded sample has four linked runs and starts at earliest maximum concurrency', () => {
  assert.equal(sample.requests.length, 21);
  assert.equal(sample.agents.length, 4);
  assert.equal(allAgentsLoaded(sample), true);
  assert.deepEqual(sample.agents.map(a => a.agentType).sort(), ['Explore', 'Explore', 'general-purpose', 'general-purpose']);
  const branches = agentBranches(sample);
  assert.equal(branches.length, 4);
  assert.equal(branches.filter(b => b.async).length, 3);
  assert.ok(branches.every(b => b.forkBlockId && b.mergeBlockId && !b.open));
  const parallel = sample.requests.map((_, idx) => branches.filter(b => idx >= b.fork && (b.open || idx < b.merge)).length);
  assert.equal(sample.meta.startRequest, parallel.indexOf(Math.max(...parallel)));
  assert.ok(Math.max(...parallel) >= 2);
});

test('recorded sample passes publication leak gate', () => {
  const emails = text.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi) ?? [];
  assert.ok(emails.every(email => email === 'demo@example.com'));
  const home = '/' + 'home/';
  for (const match of text.matchAll(new RegExp(home + '([^/\\s"\\\\]+)', 'g'))) assert.equal(match[1], 'demo');
  assert.ok(!text.includes('/' + 'Users/'));
  assert.ok(!text.includes('.claude/projects/' + '-home'));
  assert.doesNotMatch(text, /\b100\.\d+\.\d+\.\d+\b/);
});

test('shared wire strings preserve all recorded text and metadata under 500 KB', () => {
  const wire = JSON.stringify(compactSession(sample), (_, value) => value instanceof Int32Array ? Array.from(value) : value);
  assert.ok(Buffer.byteLength(wire) < 500000);
  assert.deepEqual(expandSession(JSON.parse(wire)), sample);
  assert.deepEqual(agentBranches(expandSession(JSON.parse(wire))), agentBranches(sample));
});
