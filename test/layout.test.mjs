import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { layoutRequest } from '../src/layout.js';

const sample = JSON.parse(await readFile(new URL('../sample/fresh-session.json', import.meta.url)));
test('fictional sample: contiguous monotonic offsets, token-scaled heights, stable data', () => {
  const before = JSON.stringify(sample), result = layoutRequest(sample, 0);
  assert.equal(result.totalTokens, sample.requests[0].measuredTokens); assert.equal(result.measured, true);
  assert.equal(result.items[0].z0, 0); assert.equal(result.items.at(-1).z1, sample.requests[0].measuredTokens * 0.01);
  result.items.forEach((it, i) => {
    assert.ok(it.z1 >= it.z0);
    if (i) assert.equal(it.z0, result.items[i - 1].z1);
  });
  const tools = result.items.filter(it => it.kind === 'tool_def');
  assert.ok(new Set(tools.map(it => it.height)).size > 1);
  assert.equal(JSON.stringify(sample), before);
});
test('measured totals scale every block and increase heights', () => {
  const session = structuredClone(sample), original = layoutRequest(session, 0);
  session.requests[0].measuredTokens = original.totalTokens * 2;
  const result = layoutRequest(session, 0);
  assert.equal(result.measured, true); assert.equal(result.totalTokens, original.totalTokens * 2);
  result.items.forEach((it, i) => {
    assert.equal(it.z0, original.items[i].z0 * 2);
    assert.equal(it.z1, original.items[i].z1 * 2); assert.ok(it.height >= original.items[i].height);
  });
  session.requests[0].measuredTokens = 0;
  assert.equal(layoutRequest(session, 0).totalTokens, 0);
});
test('isNew comes from the selected request, including backwards navigation', () => {
  const session = structuredClone(sample), ids = session.requests[0].blockIds;
  session.requests = [session.requests[0]];
  session.requests.push({ ...session.requests[0], idx: 1, newBlockIds: [ids[2]] });
  assert.ok(layoutRequest(session, 0).items.every(it => !it.isNew));
  assert.deepEqual(layoutRequest(session, 1).items.filter(it => it.isNew).map(it => it.blockId), [ids[2]]);
});
test('districts group consecutive prefix layers, then whole conversation turns', () => {
  const kinds = ['system', 'tool_def', 'tool_def', 'reminder', 'user_text', 'assistant_text', 'tool_result', 'user_text'];
  const layers = ['system', 'tools', 'tools', 'user_instructions', 'message', 'assistant', 'results', 'message'];
  const blocks = Object.fromEntries(kinds.map((kind, i) => [String(i), {
    id: String(i), kind, layer: layers[i], estTokens: 10, label: String(i), role: kind === 'user_text' ? 'user' : 'system',
  }]));
  const session = { blocks, requests: [{ blockIds: Object.keys(blocks), newBlockIds: [], measuredTokens: null }] };
  const { districts } = layoutRequest(session, 0);
  assert.deepEqual(districts.map(d => d.blockIds), [['0'], ['1', '2'], ['3'], ['4', '5', '6'], ['7']]);
  assert.deepEqual(districts.map(d => d.label), ['System prompt', 'Tool definitions', 'CLAUDE.md', 'Turn 1', 'Turn 2']);
  districts.forEach((d, i) => { if (i) assert.equal(d.z0, districts[i - 1].z1); });
});
test('empty requests and missing blocks', () => {
  const session = { blocks: {}, requests: [{ blockIds: [], newBlockIds: [], measuredTokens: null }] };
  assert.deepEqual(layoutRequest(session, 0), { items: [], districts: [], totalTokens: 0, measured: false });
  assert.throws(() => layoutRequest(session, 1), RangeError);
  session.requests[0].blockIds = ['missing']; assert.throws(() => layoutRequest(session, 0), /Missing block/);
});

test('positive measured total with zero estimates distributes evenly without NaN', () => {
  const session = structuredClone(sample);
  Object.values(session.blocks).forEach(b => { b.estTokens = 0; });
  session.requests[0].measuredTokens = 1000;
  const result = layoutRequest(session, 0);
  assert.equal(result.totalTokens, 1000);
  assert.equal(result.items.at(-1).z1, 10);
  result.items.forEach(it => { assert.ok(Number.isFinite(it.z0)); assert.ok(it.z1 >= it.z0); });
});
test('sample follows tool definitions, system blocks, messages and includes contract metadata', async () => {
  const rank = b => b.kind === 'tool_def' ? 0 : b.kind === 'system' ? 1 : 2;
  const ranks = sample.requests[0].blockIds.map(id => rank(sample.blocks[id]));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  assert.equal(sample.requests[0].newFrom, 0);
  assert.equal(sample.meta.ignoredRecords, 0);
  assert.equal(sample.meta.source, 'requests');
  assert.equal(sample.meta.emptyReason, null);
  assert.equal(sample.meta.sample, true);
  assert.ok(!sample.meta.sourceName.includes('/'));
  for (const [id, b] of Object.entries(sample.blocks)) {
    assert.equal(b.id, id); assert.equal(typeof b.text, 'string');
    assert.equal(b.chars, b.text.length); assert.equal(b.provenance, 'reconstructed');
    assert.match(b.note, /invented example text/i);
    assert.ok(Number.isFinite(b.estTokens) && b.estTokens >= 0);
    assert.ok(['system', 'user', 'assistant', null].includes(b.role));
    if (b.kind === 'tool_def') {
      assert.equal(typeof b.toolName, 'string'); assert.ok(Array.isArray(b.params));
      for (const param of b.params) for (const field of ['name', 'type', 'description']) assert.equal(typeof param[field], 'string');
      assert.equal(b.split.descTokens + b.split.schemaTokens, b.estTokens);
    }
  }
  assert.equal(sample.requests[0].estTokens, sample.requests[0].blockIds.reduce((n, id) => n + sample.blocks[id].estTokens, 0));
  const text = JSON.stringify(sample) + await readFile(new URL('../scripts/sample-data.mjs', import.meta.url), 'utf8')
    + await readFile(new URL('../scripts/make-sample.mjs', import.meta.url), 'utf8');
  for (const forbidden of ['localhost',
    'Claude', 'Codex', 'Anthropic', 'OpenAI', 'ChatGPT', 'GitHub', 'GitLab']) {
    assert.equal(containsForbidden(text, forbidden), false, forbidden);
  }
});

function containsForbidden(text, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = /^[a-z0-9]+$/i.test(token) ? `\\b${escaped}\\b` : escaped;
  return new RegExp(pattern, 'i').test(text);
}

const root = new URL('../', import.meta.url);
const privatePaths = new RegExp('/(?:' + ['home', 'srv', 'mnt', 'Users'].join('|') + ')\\b', 'i');
function genericPrivacyHits(text) {
  const hits = [];
  if (privatePaths.test(text)) hits.push('local path');
  for (const match of text.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
    const octets = match[0].split('.').map(Number);
    if (octets.some(n => n > 255)) continue;
    const [a, b, c, d] = octets;
    if (a === 127 && b === 0 && c === 0 && d === 1) continue;
    if (a === 192 && b === 0 && c === 2 || a === 198 && b === 51 && c === 100 || a === 203 && b === 0 && c === 113) continue;
    hits.push('IPv4 address');
  }
  for (const match of text.matchAll(/\b[A-Z0-9._%+-]+@([A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,})\b/gi)) {
    if (!match[1].toLowerCase().endsWith('.invalid')) hits.push('email address');
  }
  if (/\b[a-f0-9]{64}\b/i.test(text)) hits.push('64-hex string');
  if (/\b[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\b/i.test(text)) hits.push('UUID');
  return hits;
}

test('every tracked text file passes publication privacy checks', async t => {
  const excluded = new Set(['test/fixtures/redact-secrets.jsonl', 'test/redact.test.mjs']);
  // Paths listed in .publishignore stay in the private repo and are never published.
  let unpublished = [];
  try { unpublished = (await readFile(new URL('../.publishignore', import.meta.url), 'utf8')).split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')); } catch {}
  const isUnpublished = f => unpublished.some(p => p.endsWith('/') ? f.startsWith(p) : f === p);
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(f => f && !excluded.has(f) && !isUnpublished(f));
  let local = [];
  try {
    local = (await readFile(new URL('./private-words.local.txt', import.meta.url), 'utf8')).split(/\r?\n/).map(w => w.trim()).filter(Boolean);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const license = await readFile(new URL('LICENSE', root), 'utf8');
  const owner = license.match(/Copyright \(c\) \d{4} (.+)/)?.[1] ?? '';
  let count = 0;
  const hits = [];
  for (const file of files) {
    const bytes = await readFile(new URL(file, root));
    if (bytes.includes(0)) continue;
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { continue; }
    count++;
    for (const category of genericPrivacyHits(text)) hits.push(`${file}: ${category}`);
    for (const [index, word] of local.entries()) {
      if (['LICENSE', 'README.md'].includes(file) && containsForbidden(owner, word)) continue;
      // Report the list position, never echo a private token into a public log.
      if (containsForbidden(text, word)) hits.push(`${file}: local word ${index + 1}`);
    }
  }
  t.diagnostic(`Privacy scan: ${count} tracked text files; ${hits.length} hits; local word list ${local.length ? 'present' : 'empty or absent'}`);
  assert.deepEqual(hits, []);
});

test('generic privacy detectors catch identifiers and allow documentation examples', () => {
  for (const name of ['home', 'srv', 'mnt', 'Users']) assert.deepEqual(genericPrivacyHits('/' + name + '/synthetic'), ['local path']);
  const address = parts => parts.join('.');
  for (const parts of [[10, 2, 3, 4], [100, 64, 0, 1]]) assert.deepEqual(genericPrivacyHits(address(parts)), ['IPv4 address']);
  for (const parts of [[127, 0, 0, 1], [192, 0, 2, 1], [198, 51, 100, 1], [203, 0, 113, 1]]) assert.deepEqual(genericPrivacyHits(address(parts)), []);
  assert.deepEqual(genericPrivacyHits('person@' + 'example.invalid'), []);
  assert.deepEqual(genericPrivacyHits('person@' + 'example.com'), ['email address']);
  assert.deepEqual(genericPrivacyHits('a'.repeat(64)), ['64-hex string']);
  assert.deepEqual(genericPrivacyHits([8, 4, 4, 4, 12].map(n => 'a'.repeat(n)).join('-')), ['UUID']);
});
test('privacy checks distinguish whole words from innocent substrings', () => {
  assert.equal(containsForbidden('engine challenging', 'gin'), false);
  assert.equal(containsForbidden('generates', 'rate'), false);
  for (const word of ['GIN', 'rate', 'Codex', 'localhost']) {
    assert.equal(containsForbidden(`before (${word}) after`, word), true);
  }
});

test('fictional tools have typed schemas and text-derived footprints', async () => {
  const { TOOLS } = await import('../scripts/sample-data.mjs');
  const expected = ['read_file', 'write_file', 'edit_file', 'run_command', 'search_files',
    'list_directory', 'fetch_url', 'ask_user', 'todo_update', 'notes_search', 'notes_create',
    'issues_list', 'issues_comment'];
  const tools = Object.values(sample.blocks).filter(b => b.kind === 'tool_def');
  assert.deepEqual(tools.map(b => b.toolName), expected);
  assert.deepEqual(TOOLS.map(t => t.name), expected);
  const total = tools.reduce((n, b) => n + b.estTokens, 0);
  assert.ok(total >= 8000 && total <= 15000, `tools: ${total}`);
  for (const b of tools) {
    const source = TOOLS.find(t => t.name === b.toolName);
    const schemaText = b.text.slice(source.description.length);
    assert.equal(b.text.slice(0, source.description.length), source.description);
    assert.equal(b.split.descTokens, Math.ceil(source.description.length / 4));
    assert.equal(b.split.schemaTokens, Math.ceil(schemaText.length / 4));
    assert.deepEqual(JSON.parse(schemaText).parameters, b.params);
    assert.ok(b.params.length >= 1 && b.params.length <= 5);
    assert.ok(b.params.some(p => p.required));
    for (const p of b.params) {
      assert.ok(['string', 'integer', 'boolean', 'array'].includes(p.type));
      assert.equal(typeof p.required, 'boolean');
      assert.ok(p.description.length > 0);
    }
  }
  assert.equal(TOOLS.find(t => t.name === 'notes_search').server, 'notes');
  assert.equal(TOOLS.find(t => t.name === 'issues_comment').server, 'issues');
  const menus = Object.values(sample.blocks).filter(b => b.layer === 'menus');
  assert.ok(menus.some(b => b.label === 'search'));
  assert.ok(menus.some(b => b.label === 'code-check'));
  assert.ok(!menus.some(b => ['lookup', 'reviewer'].includes(b.label)));
});


test('sample requests have honest growth, ordered blocks, and exact new-block bookkeeping', () => {
  assert.ok(sample.requests.length >= 24 && sample.requests.length <= 30);
  const rank = b => b.kind === 'tool_def' ? 0 : b.kind === 'system' ? 1 : 2;
  for (const [idx, r] of sample.requests.entries()) {
    assert.equal(r.idx, idx);
    assert.equal(new Set(r.blockIds).size, r.blockIds.length);
    const previous = sample.requests[idx - 1]?.blockIds ?? [];
    assert.deepEqual(r.newBlockIds, r.blockIds.filter(id => !previous.includes(id)));
    let boundary = 0;
    while (boundary < previous.length && previous[boundary] === r.blockIds[boundary]) boundary++;
    assert.equal(r.newFrom, boundary);
    const ranks = r.blockIds.map(id => rank(sample.blocks[id]));
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
    assert.equal(r.estTokens, r.blockIds.reduce((sum, id) => sum + sample.blocks[id].estTokens, 0));
    assert.equal(r.measuredTokens, r.usage.input + r.usage.cacheRead + r.usage.cacheWrite);
    assert.ok(r.measuredTokens / r.estTokens >= 0.5 && r.measuredTokens / r.estTokens <= 2, `request ${idx}`);
    const outstanding = new Map();
    for (const id of r.blockIds) {
      const b = sample.blocks[id];
      if (b.kind === 'tool_use') outstanding.set(b.toolUseId, b.toolName);
      if (b.kind === 'tool_result') {
        assert.equal(outstanding.get(b.toolUseId), b.toolName);
        outstanding.delete(b.toolUseId);
      }
    }
    assert.equal(outstanding.size, 0);
  }
  const compact = sample.events.filter(e => e.type === 'compaction');
  assert.equal(compact.length, 1);
  const cut = compact[0].requestIdx;
  assert.deepEqual(compact[0].data, { trigger: 'auto', preTokens: 402000, postTokens: 38000 });
  assert.equal(sample.requests[cut - 1].measuredTokens, 402000);
  assert.equal(sample.requests[cut].measuredTokens, 38000);
  assert.ok(sample.requests[cut].blockIds.length < sample.requests[cut - 1].blockIds.length);
  assert.ok(sample.requests[cut].blockIds.some(id => sample.blocks[id].label === 'Compacted session summary'));
  for (let i = 1; i < cut; i++) assert.ok(sample.requests[i].measuredTokens >= sample.requests[i - 1].measuredTokens);
  for (const type of ['user_prompt', 'tool_loaded', 'mcp_instructions', 'deferred_tools', 'skill_listing']) {
    assert.ok(sample.events.some(e => e.type === type), type);
  }
  const loaded = sample.events.find(e => e.type === 'tool_loaded');
  for (const r of sample.requests) for (const name of loaded.data.names) {
    assert.equal(r.blockIds.some(id => sample.blocks[id].toolName === name && sample.blocks[id].kind === 'tool_def'), r.idx >= loaded.requestIdx);
  }
  const large = Object.values(sample.blocks).filter(b => b.kind === 'tool_result' && b.chars > 20000);
  assert.ok(large.length >= 3);
  assert.ok(large.every(b => b.chars <= 60000));
  assert.ok(Buffer.byteLength(JSON.stringify(sample, null, 2) + '\n') < 1200000);
  const last = sample.blocks[sample.requests.at(-1).blockIds.at(-1)];
  assert.equal(last.kind, 'assistant_text');
  assert.match(last.text, /All 12 focused checks passed/);
});

test('height distinguishes kiosks and towers, bounded with per-kind minimums', () => {
  const blocks = Object.fromEntries([0,70,50000,1e9].map((n,i)=>[String(i),{id:String(i),kind:'tool_result',layer:'results',estTokens:n}]));
  const s={blocks,requests:[{blockIds:Object.keys(blocks),newBlockIds:[]}]};
  const {items}=layoutRequest(s,0);
  assert.equal(items[0].height,42); assert.ok(items[1].height>42 && items[1].height<50);
  assert.ok(items[2].height>180); assert.equal(items[3].height,220);
  for(const it of items)assert.ok(Math.abs((it.z1-it.z0)-blocks[it.blockId].estTokens*.01)<1e-6);
});
