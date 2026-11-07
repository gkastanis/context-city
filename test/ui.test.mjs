import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createLineSplitter, consumeFile } from '../src/worker.js';
import { parseText } from '../src/parse.js';
import { gauge, markerPercent, eventLabel, sparkPoints } from '../src/ui/math.js';

test('stream line splitting preserves boundaries, CRLF, blank lines and final text', () => {
  const lines = [], splitter = createLineSplitter(line => lines.push(line));
  for (const part of ['first\r', '\nsec', 'ond\n', '\nthi', 'rd\r']) splitter.write(part);
  splitter.finish();
  assert.deepEqual(lines, ['first', 'second', '', 'third']);
  const large = 'x'.repeat(5 * 1024 * 1024), result = [];
  const big = createLineSplitter(line => result.push(line));
  for (let i = 0; i < large.length; i += 8191) big.write(large.slice(i, i + 8191));
  big.write('\r'); big.write('\nlast'); big.finish();
  assert.deepEqual(result, [large, 'last']);
});

test('file stream path matches parser, with tiny byte chunks and multibyte text', async () => {
  const fixture = await readFile(new URL('./fixtures/session.jsonl', import.meta.url), 'utf8');
  const text = fixture.replaceAll('\n', '\r\n') + '\r\n' + JSON.stringify({ type: 'user', message: { role: 'user', content: 'café 日本語' } });
  const bytes = new TextEncoder().encode(text), progress = [];
  const file = { name: 'synthetic.jsonl', size: bytes.length, stream() {
    let i = 0;
    return new ReadableStream({ pull(controller) {
      if (i >= bytes.length) controller.close();
      else { controller.enqueue(bytes.slice(i, i + 17)); i += 17; }
    } });
  } };
  const session = await consumeFile(file, { yieldWork: true, progress: (bytes, size) => progress.push([bytes, size, performance.now()]) });
  assert.deepEqual(session, parseText(text, { sourceName: file.name }));
  assert.ok(progress.every(([read, size]) => read <= size && size === file.size));
  assert.ok(progress.slice(1).every((p, i) => p[2] - progress[i][2] >= 95));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(consumeFile(file, { signal: controller.signal }), { name: 'AbortError' });
});

test('gauge uses measured zero, estimates, capacity and compaction threshold', () => {
  const meta = { window: 1e6, autocompactAt: 400000 };
  assert.deepEqual(gauge({ measuredTokens: 182400, estTokens: 8 }, meta), { total: 182400, measured: true, percent: 18.240000000000002, compactPercent: 40 });
  assert.equal(gauge({ measuredTokens: 0, estTokens: 99 }, meta).total, 0);
  assert.equal(gauge({ measuredTokens: null, estTokens: 99 }, meta).measured, false);
  assert.equal(gauge({ measuredTokens: 2e6 }, meta).percent, 100);
  assert.equal(markerPercent(0, 1), 0);
  assert.equal(markerPercent(0, 5), 0);
  assert.equal(markerPercent(2, 5), 50);
  assert.equal(markerPercent(4, 5), 100);
  assert.match(eventLabel({ type: 'tool_loaded', data: { names: ['Read', 'mcp__demo__lookup'] } }), /Read, mcp__demo__lookup/);
  assert.match(eventLabel({ type: 'deferred_tools', data: { names: [], removed: ['OldTool'] } }), /removed: OldTool/);
  assert.match(eventLabel({ type: 'compaction', data: { preTokens: 400000, postTokens: 100000 } }), /400K before, 100K after/);
  assert.match(eventLabel({ type: 'compaction', label: 'Summary', data: { preTokens: 359300, postTokens: 20400 } }), /^Compaction:/);
  assert.equal(sparkPoints([{ measuredTokens: 400000 }, { measuredTokens: 100000 }], 1e6), '0,24 600,36');
});

test('UI uses text nodes and no unsafe HTML, storage or content network APIs', async () => {
  const names = ['src/app.js', ...(await readdir(new URL('../src/ui/', import.meta.url))).filter(n => n.endsWith('.js')).map(n => `src/ui/${n}`)];
  for (const name of names) {
    const source = await readFile(new URL('../' + name, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML|document\.write|localStorage|sessionStorage|indexedDB|XMLHttpRequest|sendBeacon|WebSocket/);
    assert.doesNotMatch(source, /\u2014|[\u2190-\u21ff]|\b(?:alert|confirm|prompt)\s*\(/);
    if (name !== 'src/app.js') assert.doesNotMatch(source, /\bfetch\(/);
  }
});
