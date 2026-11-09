import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, mkdir, writeFile, stat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseText } from '../src/parse.js';
import { redactSession, makeReport, redactFolder, redactTranscript } from '../scripts/redact.mjs';

const fixturePath = new URL('./fixtures/redact-secrets.jsonl', import.meta.url);
const original = parseText(await readFile(fixturePath, 'utf8'));
const config = { publicTools: ['Read'], aliases: [{ prefix: 'mcp__public__', alias: 'mcp:site/' }], keepPrompts: [] };
const secrets = ['sk_FAKE_PLANTED_7z', 'owner@secret.invalid', 'private.secret.invalid', '203.0.113.77', '/home/secret-owner', 'ClientOrchid'];

test('targeted replacements cover paths, encoded directories, emails and owner/group words', () => {
  const input = 'owner@secret.invalid /home/secret-owner/code /Users/secret-owner/code '
    + '~/.claude/projects/-home-secret-owner-code/out /tmp/cc-demo-123ab/code '
    + '-rw-r--r-- 1 secret-owner secret-owner 100 file secret-owner unrelated';
  const result = redactTranscript(input, 'secret-owner');
  assert.ok(!result.includes('secret-owner'));
  assert.ok(!result.includes('-home'));
  assert.match(result, /demo@example.com/);
  assert.match(result, /\/home\/demo\/code/);
  assert.match(result, /demo-project\/out/);
  assert.match(result, /\/tmp\/demo\/code/);
  assert.match(result, /1 demo demo 100 file demo unrelated/);
  assert.equal(redactTranscript('ClientOrchid api_key', 'secret-owner', ['ClientOrchid', 'api_key']), 'demo demo');
});

test('folder mode retains hash-verified foreground calls, shared IDs and metadata deterministically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'redact-folder-test-'));
  try {
    const input = join(directory, 'raw');
    await mkdir(join(input, 'session/subagents'), { recursive: true });
    await mkdir(join(input, 'session/tool-results'));
    await writeFile(join(input, 'session/tool-results/ignored.txt'), 'Never bundled');
    const callId = 'a'.repeat(64);
    const prompt = { role: 'user', content: 'owner@secret.invalid secret-owner' };
    const call = { role: 'assistant', content: [{ type: 'tool_use', id: callId, name: 'Agent', input: { description: 'Inspect secret-owner', subagent_type: 'Explore' } }] };
    const result = { role: 'user', content: [{ type: 'tool_result', tool_use_id: callId, content: 'Finished secret-owner' }] };
    const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
    const hash = m => createHash('sha256').update(JSON.stringify(canonical(m))).digest('hex');
    const records = [
      { type: 'api-request-shape', shapeHash: 'shape', shape: { system: ['Public system'], tools: [] } },
      { type: 'user', message: prompt },
      { type: 'api-request', id: 'r0', querySource: 'repl_main_thread', shapeHash: 'shape', keep: 0, tail: [hash(prompt)] },
      { type: 'assistant', requestRef: 'r0', message: { ...call, id: 'answer0', model: 'demo-model' } },
      { type: 'user', message: result, toolUseResult: { agentId: 'helper' } },
      { type: 'api-request', id: 'r1', querySource: 'repl_main_thread', shapeHash: 'shape', keep: 1, tail: [hash(call), hash(result)] },
    ];
    await writeFile(join(input, 'session.jsonl'), records.map(r => JSON.stringify(r)).join('\n'));
    await writeFile(join(input, 'session/subagents/agent-helper.jsonl'), records.map(r => JSON.stringify(r)).join('\n'));
    await writeFile(join(input, 'session/subagents/agent-helper.meta.json'), JSON.stringify({ toolUseId: callId, description: 'secret-owner', agentType: 'Explore' }, null, 2));
    const out = join(directory, 'out'), again = join(directory, 'again');
    const first = await redactFolder(input, out, 'secret-owner');
    assert.deepEqual(await redactFolder(input, again, 'secret-owner'), first);
    const text = await readFile(join(out, first.main), 'utf8');
    assert.equal(text, await readFile(join(again, first.main), 'utf8'));
    const parsed = parseText(text);
    const agentCall = Object.values(parsed.blocks).find(b => b.toolName === 'Agent' && b.kind === 'tool_use');
    assert.ok(agentCall);
    const metadata = JSON.parse(await readFile(join(out, 'session/subagents/agent-helper.meta.json'), 'utf8'));
    assert.equal(metadata.toolUseId, agentCall.toolUseId);
    assert.equal(metadata.description, 'demo');
    assert.ok(!text.includes('secret-owner'));
    assert.ok(!text.includes('owner@secret.invalid'));
    assert.equal((await stat(join(out, first.main))).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(join(out, 'session')), ['subagents']);
    await assert.rejects(redactFolder(input, out, 'secret-owner'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
function values(value) {
  if (typeof value === 'string') return [value];
  return value && typeof value === 'object' ? Object.values(value).flatMap(values) : [];
}

test('default deny removes planted secrets everywhere, hashes and unapproved strings', () => {
  const output = redactSession(original, config);
  const json = JSON.stringify(output);
  for (const secret of secrets) assert.ok(!json.toLowerCase().includes(secret.toLowerCase()), secret);
  assert.doesNotMatch(json, /[a-f0-9]{64}/i);
  const vocabulary = new Set(['redacted', 'real-session-redacted.json', 'claude-synthetic', '2.0.synthetic', 'requests',
    'system', 'tool_def', 'user_text', 'reminder', 'assistant_text', 'thinking', 'tool_use', 'tool_result', 'attachment',
    'tools', 'user_instructions', 'memory', 'menus', 'harness', 'message', 'assistant', 'tool_call', 'results', 'mcp', 'user',
    'System prompt', 'Tool definition', 'CLAUDE.md', 'Memory index', 'Skills list', 'Agent list', 'Deferred tools',
    'Environment', 'Date', 'MCP instructions', 'Reminder', 'Your prompt', 'Assistant reply', 'Thinking', 'Tool call',
    'Tool result', 'Image', 'Summary', 'unavailable', 'string', 'integer', 'boolean', 'Read', 'file_path', 'mcp:site/lookup',
    'deferred_tools', 'mcp_instructions', 'skill_listing', 'user_prompt', 'compaction', 'tool_loaded']);
  for (const value of values(output)) assert.ok(vocabulary.has(value)
    || /^(?:b\d+|param-\d+|tool-\d+|mcp:server-\d+\/tool-\d+)$/.test(value)
    || /^2000-01-01T00:00:\d\d(?:\.000)?Z$/.test(value)
    || /^Redacted before publishing\. Original length \d+ characters\.$/.test(value), value);
  assert.equal(output.meta.startedAt, '2000-01-01T00:00:00Z');
  assert.equal(Date.parse(output.meta.endedAt) - Date.parse(output.meta.startedAt), 8000);
  assert.equal(output.requests[0].ts, '2000-01-01T00:00:01.000Z');
  assert.ok(Object.values(output.blocks).every(b => b.text === null && b.provenance === 'unavailable'));
  assert.ok(Object.values(output.blocks).some(b => b.toolName === 'mcp:site/lookup'));
  const deferred = output.events.find(e => e.type === 'deferred_tools');
  const privateTool = Object.values(output.blocks).find(b => b.kind === 'tool_def' && b.toolName?.startsWith('tool-'));
  assert.equal(deferred.data.names[0], privateTool.toolName);
  const loaded = output.events.find(e => e.type === 'tool_loaded');
  assert.ok(loaded.data.names.every(name => Object.values(output.blocks).some(b => b.toolName === name)));
  assert.deepEqual(output.events.find(e => e.type === 'compaction').data, { preTokens: 999, postTokens: 30 });
  const { report, stats } = makeReport(original, output);
  assert.equal(stats.outputBytes, Buffer.byteLength(JSON.stringify(output, null, 2) + '\n'));
  for (const value of new Set(values(output))) assert.ok(report.includes(JSON.stringify(value)));
  assert.ok(report.includes('b') && report.includes('request 0') && report.includes('length '));
  assert.ok(report.includes('sk_FAKE_PLANTED_7z')); // Local-only prompt preview.
});

test('keepPrompts preserves exactly the selected user_text block, including repeated occurrences', () => {
  const base = redactSession(original, config);
  const id = Object.values(base.blocks).find(b => b.kind === 'user_text').id;
  const output = redactSession(original, { ...config, keepPrompts: [id] });
  assert.deepEqual(Object.values(output.blocks).filter(b => b.text !== null).map(b => b.id), [id]);
  const index = base.requests[0].blockIds.indexOf(id);
  assert.equal(output.blocks[id].text, original.blocks[original.requests[0].blockIds[index]].text);
  assert.equal(output.blocks[id].provenance, 'verbatim');
  assert.equal(base.blocks[id].text, null);
  assert.throws(() => redactSession(original, { keepPrompts: ['b999'] }));
  assert.throws(() => redactSession(original, { keepPrompts: ['b1'] }));
});

test('contract shape, request order, new tail, usage and estimates survive remapping', () => {
  const output = JSON.parse(JSON.stringify(redactSession(original, config)));
  assert.deepEqual(Object.keys(output), ['meta', 'blocks', 'requests', 'events']);
  assert.equal(output.meta.sample, true);
  assert.equal(output.meta.redacted, true);
  let previous = new Set();
  const seen = new Set();
  for (const [i, r] of output.requests.entries()) {
    const raw = original.requests[i];
    assert.equal(r.idx, i);
    assert.deepEqual(r.usage, raw.usage);
    assert.equal(r.measuredTokens, raw.measuredTokens);
    assert.equal(r.estTokens, raw.estTokens);
    assert.equal(r.newFrom, raw.newFrom);
    assert.deepEqual(r.newBlockIds, [...new Set(r.blockIds.filter(id => !previous.has(id)))]);
    assert.equal(r.estTokens, r.blockIds.reduce((n, id) => n + output.blocks[id].estTokens, 0));
    assert.deepEqual(r.blockIds.map(id => output.blocks[id].kind), raw.blockIds.map(id => original.blocks[id].kind));
    assert.deepEqual(r.blockIds.slice(0, 5).map(id => output.blocks[id].kind), ['tool_def', 'tool_def', 'tool_def', 'tool_def', 'system']);
    for (const id of r.blockIds) {
      if (!seen.has(id)) { seen.add(id); assert.equal(id, `b${seen.size}`); }
      assert.equal(output.blocks[id].id, id);
    }
    previous = new Set(r.blockIds);
  }
  for (const [i, r] of output.requests.entries()) assert.deepEqual(r.blockIds.slice(r.newFrom).map(id => output.blocks[id].kind),
    original.requests[i].blockIds.slice(r.newFrom).map(id => original.blocks[id].kind));
});

test('dates opt-in, exact aliases, unknown schema types and hashes fail closed', () => {
  assert.equal(Date.parse(redactSession(original, { ...config, keepDates: true }).meta.startedAt), Date.parse(original.meta.startedAt));
  const copy = structuredClone(original);
  const b = Object.values(copy.blocks).find(b => b.kind === 'tool_def');
  b.label = 'private-label';
  b.note = 'private-note';
  b.toolUseId = 'f'.repeat(64);
  b.params[0].type = 'private-schema-type';
  const output = redactSession(copy, { aliases: { [b.toolName]: 'safe-alias' } });
  assert.equal(output.blocks.b1.toolName, 'safe-alias');
  assert.equal(output.blocks.b1.params[0].type, null);
  assert.ok(!JSON.stringify(output).includes('private-label'));
  assert.ok(!JSON.stringify(output).includes('private-note'));
  assert.doesNotMatch(JSON.stringify(output), /[a-f0-9]{64}/i);
  copy.meta.model = 'a'.repeat(64);
  assert.throws(() => redactSession(copy));
});

test('CLI prints only statistics and creates a local report separately', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'redact-test-'));
  try {
    const out = join(directory, 'redacted.json'), report = join(directory, 'report.txt');
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['scripts/redact.mjs', fixturePath.pathname, '--config',
      'scripts/redact-config.example.json', '--out', out, '--report', report], { encoding: 'utf8', env });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.trim(), 'CLI must print statistics');
    const stats = JSON.parse(result.stdout);
    assert.equal(stats.requests, 3);
    for (const secret of secrets) assert.ok(!result.stdout.includes(secret));
    assert.equal(stats.outputBytes, Buffer.byteLength(await readFile(out)));
    assert.ok((await readFile(report, 'utf8')).startsWith('LOCAL ONLY'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
