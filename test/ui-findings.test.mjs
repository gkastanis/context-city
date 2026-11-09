import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { findings } from '../src/ui/findings.js';
import { createFindingsPanel } from '../src/ui/findings-panel.js';
import { parseText } from '../src/parse.js';
import { expandSession, compactSession } from '../src/ui/compact.js';

const block = (id, kind, estTokens, extra = {}) => ({ id, kind, estTokens, label: id, text: null, ...extra });
function session(blocks, rows, events = []) {
  const table = Object.fromEntries(blocks.map(b => [b.id, b]));
  let prev = [];
  const requests = rows.map((row, idx) => {
    const blockIds = Array.isArray(row) ? row : row.blockIds;
    let newFrom = 0;
    while (newFrom < prev.length && prev[newFrom] === blockIds[newFrom]) newFrom++;
    const r = { idx, blockIds, newBlockIds: blockIds.filter(id => !prev.includes(id)), newFrom,
      estTokens: blockIds.reduce((n, id) => n + table[id].estTokens, 0), ...(Array.isArray(row) ? {} : row) };
    prev = blockIds; return r;
  });
  return { meta: { source: 'records' }, blocks: table, requests, events };
}
const kind = (s, name) => findings(s).filter(f => f.kind === name);

test('parser-shaped calls group by input despite unique serialized IDs', () => {
  const bs = [1, 2, 3].flatMap(i => [
    block(`c${i}`, 'tool_use', 30, { toolName: 'Read', text: JSON.stringify({ type: 'tool_use', id: `toolu_${i}`, name: 'Read', input: { file_path: '/x' } }) }),
    block(`r${i}`, 'tool_result', 5000, { toolName: 'Read', toolUseId: `toolu_${i}` }),
  ]);
  const all = kind(session(bs, [bs.map(b => b.id)]), 'repeated_call');
  assert.equal(all.length, 1); assert.equal(all[0].cost, 10000);
  const records = [{ type: 'api-request-shape', shapeHash: 's', shape: { system: [], tools: [] } }];
  const tail = [];
  for (let i = 1; i <= 3; i++) {
    const call = JSON.parse(bs[(i - 1) * 2].text);
    const result = { type: 'tool_result', tool_use_id: call.id, content: 'x'.repeat(20000) };
    records.push({ type: 'api-request-blob', hash: `c${i}`, message: { role: 'assistant', content: [call] } },
      { type: 'api-request-blob', hash: `r${i}`, message: { role: 'user', content: [result] } });
    tail.push(`c${i}`, `r${i}`);
  }
  records.push({ type: 'api-request', id: 'a', querySource: 'repl_main_thread', shapeHash: 's', keep: 0, tail });
  const parsed = parseText(records.map(r => JSON.stringify(r)).join('\n'));
  const repeated = kind(parsed, 'repeated_call');
  assert.equal(repeated.length, 1);
  const results = Object.values(parsed.blocks).filter(b => b.kind === 'tool_result');
  assert.equal(results.length, 3);
  assert.equal(repeated[0].cost, results.slice(1).reduce((n, b) => n + b.estTokens, 0));
});

test('cache rebuild uses truly new tokens in measured units and prioritizes context changes', () => {
  const s = session([block('a', 'system', 90000), block('b', 'system', 90000), block('n', 'user_text', 1000)], [
    { blockIds: ['a'], ts: '2026-01-01T00:00:00Z' },
    { blockIds: ['b', 'a', 'n'], newBlockIds: ['n'], measuredTokens: 362000, ts: '2026-01-01T00:14:00Z', usage: { cacheWrite: 100000 } },
  ]);
  const [f] = kind(s, 'cache_rewrite');
  assert.equal(f.cost, 98000); assert.equal(f.basis, 'measured');
  assert.match(f.detail, /after the context changed early \(for example a tool was loaded\)/);
  assert.ok(!f.detail.includes('expired'));
  const event = { ...s, requests: s.requests.map((r, i) => ({ ...r, newFrom: i ? 1 : 0 })), events: [{ type: 'tool_loaded', requestIdx: 1 }] };
  assert.match(kind(event, 'cache_rewrite')[0].detail, /context changed early/);
  for (const type of ['deferred_tools', 'mcp_instructions']) {
    assert.match(kind({ ...event, events: [{ type, requestIdx: 1 }] }, 'cache_rewrite')[0].detail, /context changed early/);
  }
});

test('heavy result share stays estimated and its displayed tokens scale like the reader', () => {
  const s = session([block('a', 'system', 900), block('b', 'tool_result', 100)], [{ blockIds: ['a', 'b'], measuredTokens: 2000 }]);
  const [f] = kind(s, 'heavy_result');
  assert.equal(f.title, 'Tool result took 10% of the context');
  assert.equal(f.tokens, 200); assert.match(f.detail, /200 tokens.*estimated share/);
});

test('unused tool wording covers main thread, subagents, singular and redacted servers', () => {
  const s = session([block('t', 'tool_def', 100, { toolName: 'mcp:server-2/tool-1' })], [['t']]);
  s.meta.sidechainRequests = 2;
  const all = kind(s, 'unused_tools');
  assert.equal(all.length, 2);
  assert.equal(all[0].title, '1 tool was never called in the main thread');
  assert.match(all[1].title, /MCP server server-2: 1 tool.*never called in the main thread/);
  for (const f of all) assert.match(f.detail, /Subagent calls are not counted, so some of these may have been used by subagents\./);
  assert.ok(!all[0].detail.includes('1 requests'));
  const heavy = session([block('r', 'tool_result', 20000)], [['r']]);
  assert.match(kind(heavy, 'heavy_result')[0].detail, /carried for 1 request /);
});

test('cache summary has no ranking cost and follows the first rebuild', () => {
  const s = session([block('a', 'system', 1000)], Array.from({ length: 3 }, () => ({ blockIds: ['a'], usage: { cacheWrite: 60000 } })));
  const all = findings(s), summary = all.find(f => f.id === 'cache_rewrite:summary');
  assert.equal(summary.cost, 0); assert.equal(summary.tokens, 179000);
  assert.equal(summary.basis, 'measured'); assert.match(summary.detail, /179K tokens/);
  assert.equal(all.at(-1), summary);
});

test('panel excludes the summary from the badge and labels measured and estimated chips', () => {
  class Node {
    children = []; attrs = {}; hidden = false;
    setAttribute(k, v) { this.attrs[k] = v; if (k === 'hidden') this.hidden = true; }
    addEventListener() {}
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
  }
  const original = globalThis.document;
  globalThis.document = { createElement: () => new Node() };
  try {
    const s = session([block('t', 'tool_def', 1000)], Array.from({ length: 3 }, () => ({ blockIds: ['t'], usage: { cacheWrite: 60000 } })));
    const panel = createFindingsPanel({ navigate() {}, onOpen() {}, onClose() {} });
    panel.setSession(s);
    assert.equal(panel.toggle.children.at(-1).textContent, '4');
    const list = panel.root.children.at(-1), rows = list.children;
    assert.equal(rows.length, 5);
    assert.equal(rows.at(-1).attrs['data-finding-id'], 'cache_rewrite:summary');
    const chips = rows.map(row => row.children.at(-1));
    assert.ok(chips[0].children[0].endsWith('tokens (measured)'));
    assert.ok(chips.at(-2).children[0].endsWith('tokens (estimated)'));
    assert.ok(chips.at(-1).children[0].startsWith('179K'));
  } finally { globalThis.document = original; }
});

test('heavy results use first landing, estimated share and actual carry requests', () => {
  const s = session([block('s', 'system', 70000), block('b', 'tool_result', 30000, { toolName: 'Bash' })],
    [['s'], { blockIds: ['s', 'b'], measuredTokens: 120000 }, ['s', 'b'], ['s']], [{ type: 'compaction', requestIdx: 3 }]);
  const [f] = kind(s, 'heavy_result');
  assert.equal(f.title, 'Bash result took 30% of the context');
  assert.equal(f.requestIdx, 1); assert.equal(f.blockId, 'b'); assert.equal(f.cost, 60000);
  assert.match(f.detail, /carried for 2 requests until the compaction at request 4/);
  assert.equal(kind(s, 'big_jump').length, 0);
});

test('heavy thresholds, result images and blocks absent then reintroduced', () => {
  const s = session([block('s', 'system', 1000000), block('small', 'tool_result', 19999),
    block('img', 'attachment', 20000, { layer: 'results', toolName: 'Read' }), block('plain', 'attachment', 30000)],
  [['s', 'small', 'img', 'plain'], ['s'], ['s', 'img']]);
  assert.deepEqual(kind(s, 'heavy_result').map(f => f.blockId), ['img']);
  assert.equal(kind(s, 'heavy_result')[0].cost, 40000);
  const ratio = session([block('b', 'tool_result', 10), block('s', 'system', 90)], [['s', 'b']]);
  assert.equal(kind(ratio, 'heavy_result').length, 1);
  ratio.requests[0].measuredTokens = 200;
  assert.equal(kind({ ...ratio }, 'heavy_result').length, 1);
});

test('cache rewrites subtract new-tail tokens, report known gaps and summarize three', () => {
  const s = session([block('s', 'system', 100000), block('a', 'user_text', 1000)], [
    { blockIds: ['s'], ts: '2026-01-01T00:00:00Z' },
    { blockIds: ['s', 'a'], ts: '2026-01-01T00:14:00Z', usage: { cacheWrite: 100000 } },
    { blockIds: ['s', 'a', 'a'], usage: { cacheWrite: 80000 } },
    { blockIds: ['s', 'a', 'a'], usage: { cacheWrite: 50000 } },
  ]);
  const all = kind(s, 'cache_rewrite'), first = all.find(f => f.requestIdx === 1 && f.id !== 'cache_rewrite:summary');
  assert.equal(all.length, 4); assert.equal(first.cost, 99000);
  assert.match(first.detail, /likely after the cache expired during a 14 minute pause/);
  assert.equal(all.find(f => f.requestIdx === 2).cost, 80000);
  assert.equal(all.find(f => f.id === 'cache_rewrite:summary').cost, 0);
  assert.equal(all.find(f => f.id === 'cache_rewrite:summary').tokens, 229000);
  assert.ok(!all.find(f => f.requestIdx === 2).detail.includes('expired'));
});

test('a reintroduced heavy block does not get another big jump finding', () => {
  const s = session([block('s', 'system', 1000), block('b', 'tool_result', 20000)],
    [['s', 'b'], ['s'], ['s', 'b']]);
  assert.equal(kind(s, 'heavy_result').length, 1);
  assert.equal(kind(s, 'big_jump').length, 0);
  const [f] = kind({ ...s, events: [{ type: 'compaction', requestIdx: 2, data: { afterLast: true } }] }, 'heavy_result');
  assert.match(f.detail, /compaction after request 3/);
});

test('cache thresholds reject normal new writes, small writes and short pauses imply no cause', () => {
  const s = session([block('a', 'system', 30000)], [
    { blockIds: [], ts: '2026-01-01T00:00:00Z' },
    { blockIds: ['a'], ts: '2026-01-01T00:01:00Z', usage: { cacheWrite: 50000 } },
    { blockIds: ['a'], usage: { cacheWrite: 49999 } },
  ]);
  assert.equal(kind(s, 'cache_rewrite').length, 0);
  s.requests[1].usage.cacheWrite = 60000;
  const f = kind({ ...s }, 'cache_rewrite')[0];
  assert.equal(f.cost, 30000); assert.ok(!f.detail.includes('pause')); assert.ok(!f.detail.includes('expired'));
});

test('identical calls pair results by toolUseId, including multipart images', () => {
  const s = session([
    block('c1', 'tool_use', 10, { toolName: 'Read', text: '{"file":"x"}', toolUseId: '1' }),
    block('c2', 'tool_use', 10, { toolName: 'Read', text: '{"file":"x"}', toolUseId: '2' }),
    block('r1', 'tool_result', 100, { toolName: 'Read', toolUseId: '1' }),
    block('r2', 'tool_result', 200, { toolName: 'Read', toolUseId: '2' }),
    block('img', 'attachment', 50, { layer: 'results', toolName: 'Read', toolUseId: '2' }),
  ], [['c1', 'r1'], ['c1', 'r1', 'c2', 'r2', 'img'], ['c1', 'r1', 'c2', 'r2', 'img']]);
  const [f] = kind(s, 'repeated_call');
  assert.equal(f.title, 'Read called 2 times with the same input'); assert.equal(f.cost, 250);
  assert.equal(f.requestIdx, 1); assert.equal(f.blockId, 'c2'); assert.match(f.detail, /Paired result/);
});

test('call pairing uses serialized IDs or order, with explicit fallback for unavailable results', () => {
  const s = session([
    block('c', 'tool_use', 10, { toolName: 'Read', text: '{"id":"call"}' }),
    block('r', 'tool_result', 100, { toolName: 'Read', text: '{"tool_use_id":"call"}' }),
  ], [['c', 'r'], ['c', 'r', 'c', 'r']]);
  assert.equal(kind(s, 'repeated_call')[0].cost, 100);
  const order = session([block('c', 'tool_use', 10, { toolName: 'Read', text: 'same' }),
    block('r', 'tool_result', 100, { toolName: 'Read' })], [['c', 'r', 'c', 'r']]);
  assert.equal(kind(order, 'repeated_call')[0].cost, 100);
  const fallback = session([block('c', 'tool_use', 10, { toolName: 'Read', text: 'same' })], [['c'], ['c', 'c']]);
  assert.equal(kind(fallback, 'repeated_call')[0].cost, 10);
  assert.match(kind(fallback, 'repeated_call')[0].detail, /could not be paired/);
});

test('retained history, differing inputs and null text are not repeated calls', () => {
  const s = session([block('c', 'tool_use', 10, { toolName: 'Read', text: 'one' }),
    block('d', 'tool_use', 10, { toolName: 'Read', text: 'two' }), block('redacted', 'tool_use', 20, { toolName: 'Read' })],
  [['c'], ['c', 'd', 'redacted'], ['c', 'd', 'redacted', 'redacted'], ['c']]);
  assert.equal(kind(s, 'repeated_call').length, 0);
});

test('unused definitions aggregate carry costs, cap names, and group whole MCP servers', () => {
  const defs = Array.from({ length: 10 }, (_, i) => block('t' + i, 'tool_def', 100, { toolName: 'mcp__notes__tool' + i }));
  defs.push(block('read', 'tool_def', 20, { toolName: 'Read' }), block('call', 'tool_use', 2, { toolName: 'Read' }));
  const ids = defs.filter(b => b.kind === 'tool_def').map(b => b.id);
  const s = session(defs, [ids, [...ids, 'call']]);
  const all = kind(s, 'unused_tools'); assert.equal(all.length, 2);
  assert.equal(all[0].cost, 2000); assert.match(all[0].detail, /and 2 more/);
  assert.ok(all.some(f => f.title === 'MCP server notes: 10 tools, 1K tokens per request, never called in the main thread'));
  const called = block('m', 'tool_use', 1, { toolName: 'mcp__notes__tool0' });
  const used = session([...defs, called], [[...ids, 'm', 'call']]);
  assert.equal(kind(used, 'unused_tools').length, 1);
  assert.equal(kind(used, 'unused_tools')[0].title, '9 tools were never called in the main thread');
});

test('unused tools can use the request with most definitions, even if later removed', () => {
  const s = session([block('t', 'tool_def', 12, { toolName: 'Read' })], [['t'], []]);
  assert.equal(kind(s, 'unused_tools')[0].requestIdx, 0); assert.equal(kind(s, 'unused_tools')[0].cost, 12);
  const withTrailingCall = { ...s, blocks: { ...s.blocks, c: block('c', 'tool_use', 2, { toolName: 'Read' }) } };
  assert.equal(kind(withTrailingCall, 'unused_tools').length, 0);
});

test('compaction pressure selects the preceding request and handles after-last notices', () => {
  const s = session([block('a', 'system', 40), block('b', 'user_text', 30), block('c', 'thinking', 20), block('d', 'assistant_text', 10)],
    [['a', 'b', 'c', 'd'], ['d']], [{ type: 'compaction', requestIdx: 1 }, { type: 'compaction', requestIdx: 1, data: { afterLast: true } }]);
  const all = kind(s, 'compaction_pressure'); assert.equal(all.length, 2);
  assert.equal(all[0].cost, 90); assert.equal(all[0].requestIdx, 0); assert.equal(all[0].blockId, 'a');
  assert.match(all[0].detail, /a 40 \(40%\), b 30 \(30%\), c 20 \(20%\)/);
  assert.equal(all[1].requestIdx, 1); assert.match(all[1].detail, /after request 2/);
  assert.equal(kind({ ...s, events: [{ type: 'compaction', requestIdx: 0 }] }, 'compaction_pressure').length, 0);
});

test('big jumps take the top three increases and only use measured totals when both exist', () => {
  const bs = Array.from({ length: 6 }, (_, i) => block('b' + i, 'user_text', (i + 1) * 100));
  const ids = bs.map(b => b.id);
  const s = session(bs, ids.map((_, i) => ({ blockIds: ids.slice(0, i + 1), ...(i < 2 ? { measuredTokens: i ? 800 : 400 } : {}) })));
  const all = kind(s, 'big_jump'); assert.equal(all.length, 3);
  assert.ok(all.filter(f => f.requestIdx !== 1).every(f => f.basis === 'estimated'));
  assert.equal(all.find(f => f.requestIdx === 1).basis, 'measured');
  assert.deepEqual(all.map(f => f.cost), [600, 500, 400]);
  assert.equal(all.find(f => f.requestIdx === 1)?.cost, 400);
  const measured = session(bs, [{ blockIds: ['b0'], measuredTokens: 1 }, { blockIds: ['b0', 'b1'], measuredTokens: 1000 }]);
  assert.equal(kind(measured, 'big_jump')[0].cost, 999); assert.match(kind(measured, 'big_jump')[0].detail, /Measured/);
});

test('findings are sorted, memoised, finite and valid with missing usage, ts and redacted text', () => {
  const s = session([block('t', 'tool_def', 12, { toolName: 'Never' }), block('r', 'tool_result', 20000)], [['t'], ['t', 'r']]);
  const all = findings(s); assert.equal(findings(s), all);
  for (let i = 0; i < all.length; i++) {
    assert.ok(Number.isFinite(all[i].cost)); assert.ok(all[i].title.length);
    assert.ok(all[i].requestIdx >= 0 && all[i].requestIdx < s.requests.length);
    if (i) assert.ok(all[i - 1].cost >= all[i].cost);
  }
  assert.equal(kind(s, 'cache_rewrite').length, 0); assert.equal(kind(s, 'repeated_call').length, 0);
  assert.deepEqual(findings(session([], [])), []);
  assert.deepEqual(findings(session([block('s', 'system', 12)], [['s'], ['s']])), []);
});

test('suffix transitions give identical findings for plain and compact sessions', () => {
  const s = session([
    block('t', 'tool_def', 100, { toolName: 'Unused' }),
    block('s', 'system', 100), block('r', 'tool_result', 20000),
    block('c', 'tool_use', 10, { toolName: 'Read', text: 'same' }),
  ], [['t', 's', 'c'], ['t', 's', 'c', 'r'], ['t', 's', 'c', 'r', 'c'], ['s'], ['s', 'c', 'r']],
  [{ type: 'compaction', requestIdx: 3 }]);
  assert.deepEqual(findings(expandSession(compactSession(s))), findings(s));
  assert.equal(kind(s, 'heavy_result')[0].cost, 60000);
  const withoutTailIndex = { ...s, requests: s.requests.map(({ newFrom, ...r }) => r) };
  assert.equal(kind(withoutTailIndex, 'heavy_result')[0].cost, 60000);
});

for (const name of ['fresh-session', 'real-session-redacted']) test(`bundled ${name} returns valid findings through the build decoder`, async () => {
  const data = JSON.parse(await readFile(new URL(`../sample/${name}.json`, import.meta.url), 'utf8'));
  const s = expandSession(compactSession(data), 8), all = findings(s);
  assert.ok(all.length > 0); assert.equal(new Set(all.map(f => f.id)).size, all.length);
  for (const f of all) {
    assert.ok(Number.isFinite(f.cost) && f.cost >= 0); assert.ok(Number.isFinite(f.tokens));
    assert.ok(Number.isInteger(f.requestIdx) && f.requestIdx >= 0 && f.requestIdx < s.requests.length);
    assert.ok(f.title.trim()); if (f.blockId) assert.ok(s.requests[f.requestIdx].blockIds.includes(f.blockId));
  }
  if (name.includes('redacted')) {
    assert.equal(kind(s, 'repeated_call').length, 0);
    const rebuild = all.find(f => f.kind === 'cache_rewrite' && f.requestIdx === 9);
    assert.ok(rebuild);
    assert.equal(s.requests[9].usage.cacheWrite, 110594);
    assert.equal(s.requests[9].newBlockIds.reduce((n, id) => n + s.blocks[id].estTokens, 0), 3436);
    assert.ok(Math.abs(rebuild.cost - 104195.4) < 1);
  }
});

test('1000 requests and 10000 blocks stay below 200ms and scale with suffix changes', () => {
  const make = (count, compact = false) => {
    const blocks = Object.fromEntries(Array.from({ length: count * 10 }, (_, i) => ['b' + i, block('b' + i, 'user_text', 10)]));
    const ids = Object.keys(blocks), requests = Array.from({ length: count }, (_, idx) => ({ idx,
      blockIds: ids.slice(0, (idx + 1) * 10), newBlockIds: ids.slice(idx * 10, (idx + 1) * 10), newFrom: idx * 10, estTokens: (idx + 1) * 100 }));
    const s = { blocks, requests, events: [], meta: {} }; return compact ? expandSession(compactSession(s)) : s;
  };
  findings(make(20));
  const small = make(500), large = make(1000), compact = make(1000, true);
  const start = performance.now(); findings(small); const smallMs = performance.now() - start;
  const t = performance.now(); findings(large); const largeMs = performance.now() - t;
  assert.ok(largeMs < 200, `Large session took ${largeMs.toFixed(1)} ms`);
  assert.ok(largeMs < smallMs * 8 + 60, 'Growth should follow prefix comparisons and changed suffixes');
  const c = performance.now(); findings(compact);
  assert.ok(performance.now() - c < 200, 'Compact sessions must also stay under 200 ms');
});
