import { createReadStream } from 'node:fs';
import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createParser } from '../src/parse.js';

const kinds = ['system', 'tool_def', 'user_text', 'reminder', 'assistant_text', 'thinking', 'tool_use', 'tool_result', 'attachment'];
const layers = ['system', 'tools', 'user_instructions', 'memory', 'menus', 'harness', 'message', 'assistant', 'tool_call', 'results', 'mcp'];
const types = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'];
const eventLabels = { user_prompt: 'Your prompt', tool_loaded: 'Tool definition', mcp_instructions: 'MCP instructions', deferred_tools: 'Deferred tools', compaction: 'Summary', skill_listing: 'Skills list' };
const choose = (value, allowed, fallback = null) => allowed.includes(value) ? value : fallback;
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const hashPattern = /[a-f0-9]{64}/i;

// Never use a parsed label: even a short label can contain private text.
function label(block) {
  if (block.kind === 'tool_def') return 'Tool definition';
  if (['system', 'reminder'].includes(block.kind)) return {
    system: 'System prompt', user_instructions: 'CLAUDE.md', memory: 'Memory index',
    menus: 'Skills list', harness: 'Reminder', mcp: 'MCP instructions',
  }[block.layer] ?? 'Reminder';
  return { user_text: 'Your prompt', assistant_text: 'Assistant reply', thinking: 'Thinking',
    tool_use: 'Tool call', tool_result: 'Tool result', attachment: 'Image' }[block.kind] ?? 'Summary';
}

function toolMapper(config) {
  const publicTools = new Set(config.publicTools ?? []);
  const aliases = Array.isArray(config.aliases) ? config.aliases
    : Object.entries(config.aliases ?? {}).map(([name, alias]) => ({ name, alias }));
  if ([...publicTools, ...aliases.flatMap(a => [a.alias])].some(s => typeof s !== 'string' || hashPattern.test(s))) {
    throw new Error('Invalid public tool or alias configuration');
  }
  if (aliases.some(a => typeof (a.prefix ?? a.name) !== 'string' || !(a.prefix ?? a.name).length)) {
    throw new Error('Invalid alias rule');
  }
  const mapped = new Map(), servers = new Map();
  let nextTool = 0;
  const map = name => {
    if (typeof name !== 'string' || !name) return null;
    if (mapped.has(name)) return mapped.get(name);
    let result;
    if (publicTools.has(name)) result = name;
    else {
      const exact = aliases.find(a => a.name === name);
      if (exact) result = exact.alias;
      else {
        const prefix = aliases.find(a => a.prefix && name.startsWith(a.prefix)
          && /^[a-z0-9_]{1,60}$/.test(name.slice(a.prefix.length)));
        if (prefix) result = prefix.alias + name.slice(prefix.prefix.length);
      }
    }
    if (result == null) {
      const mcp = /^mcp__(.*?)__/.exec(name);
      if (mcp) {
        if (!servers.has(mcp[1])) servers.set(mcp[1], servers.size + 1);
        result = `mcp:server-${servers.get(mcp[1])}/tool-${++nextTool}`;
      } else result = `tool-${++nextTool}`;
    }
    mapped.set(name, result);
    return result;
  };
  return { map, publicTools };
}

export function redactSession(session, config = {}) {
  const { map: mapTool, publicTools } = toolMapper(config);
  const ids = new Map();
  // First occurrence in API context, not parser insertion order (blobs may arrive late).
  for (const r of session.requests) for (const id of r.blockIds) if (!ids.has(id)) ids.set(id, `b${ids.size + 1}`);
  const keep = new Set(config.keepPrompts ?? []);
  for (const id of keep) {
    const original = [...ids].find(([, value]) => value === id)?.[0];
    if (!original || session.blocks[original].kind !== 'user_text' || typeof session.blocks[original].text !== 'string') {
      throw new Error('keepPrompts must refer to available user_text blocks from the report');
    }
  }
  const base = Date.parse(session.meta.startedAt);
  const epoch = Date.parse('2000-01-01T00:00:00Z');
  const date = value => {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return null;
    if (config.keepDates === true) return new Date(time).toISOString();
    if (!Number.isFinite(base)) return null;
    return time === base ? '2000-01-01T00:00:00Z' : new Date(epoch + time - base).toISOString();
  };
  const m = session.meta;
  const output = { meta: {
    sessionId: 'redacted', sourceName: 'real-session-redacted.json',
    model: typeof m.model === 'string' ? m.model : null,
    cliVersion: typeof m.cliVersion === 'string' ? m.cliVersion : null,
    startedAt: date(m.startedAt), endedAt: date(m.endedAt),
    window: number(m.window), autocompactAt: number(m.autocompactAt), sample: true, redacted: true,
    skippedLines: number(m.skippedLines), ignoredRecords: number(m.ignoredRecords), sidechainRequests: number(m.sidechainRequests),
    source: choose(m.source, ['requests', 'records', 'empty'], 'empty'),
    emptyReason: m.source === 'empty' ? 'No usable requests' : null,
  }, blocks: {}, requests: [], events: [] };
  for (const [original, id] of ids) {
    const b = session.blocks[original];
    const kept = keep.has(id);
    const block = { id, kind: choose(b.kind, kinds, 'attachment'), layer: choose(b.layer, layers, 'message'),
      label: label(b), text: kept ? b.text : null, provenance: kept ? 'verbatim' : 'unavailable',
      note: `Redacted before publishing. Original length ${number(b.chars) ?? 0} characters.`,
      role: choose(b.role, ['system', 'user', 'assistant']), chars: number(b.chars), estTokens: number(b.estTokens),
      toolName: mapTool(b.toolName) };
    if (b.isError === true) block.isError = true;
    if (b.kind === 'tool_def') {
      block.params = (b.params ?? []).map((p, i) => ({
        name: publicTools.has(b.toolName) ? p.name : `param-${i + 1}`,
        required: p.required === true,
        type: Array.isArray(p.type) ? p.type.map(t => choose(t, types)).filter(Boolean) : choose(p.type, types),
      }));
      if (b.split) block.split = { descTokens: number(b.split.descTokens), schemaTokens: number(b.split.schemaTokens) };
    }
    output.blocks[id] = block;
  }
  for (const r of session.requests) output.requests.push({ idx: r.idx, ts: date(r.ts),
    blockIds: r.blockIds.map(id => ids.get(id)), newBlockIds: r.newBlockIds.map(id => ids.get(id)), newFrom: r.newFrom,
    usage: r.usage ? Object.fromEntries(['input', 'cacheRead', 'cacheWrite', 'output'].map(key => [key, number(r.usage[key])])) : null,
    measuredTokens: number(r.measuredTokens), estTokens: number(r.estTokens) });
  for (const e of session.events) {
    if (!Object.hasOwn(eventLabels, e.type)) continue;
    const data = {};
    if (['tool_loaded', 'deferred_tools'].includes(e.type)) {
      data.names = (e.data?.names ?? []).map(mapTool).filter(v => v != null);
      if (e.data?.removed) data.removed = e.data.removed.map(mapTool).filter(v => v != null);
    }
    if (e.type === 'compaction') for (const [key, value] of Object.entries(e.data ?? {})) {
      if (['preTokens', 'postTokens'].includes(key) && number(value) != null) data[key] = value;
    }
    output.events.push({ type: e.type, label: eventLabels[e.type], requestIdx: e.requestIdx, ts: date(e.ts), data });
  }
  // Explicit exceptions still cannot accidentally publish a content hash.
  if (hashPattern.test(JSON.stringify(output))) throw new Error('Output contains a prohibited 64-hex string');
  return output;
}

export function makeReport(original, output, serialized = JSON.stringify(output, null, 2) + '\n') {
  const strings = new Map();
  function visit(value) {
    if (typeof value === 'string') strings.set(value, (strings.get(value) ?? 0) + 1);
    else if (value && typeof value === 'object') for (const item of Object.values(value)) visit(item);
  }
  visit(output);
  const lines = ['LOCAL ONLY — do not publish this report.', 'Surviving string values (JSON-escaped; keys excluded):'];
  for (const [value, count] of [...strings].sort(([a], [b]) => a.localeCompare(b))) lines.push(`${count}\t${JSON.stringify(value)}`);
  lines.push('', 'User prompts (request index is zero-based; one row per distinct block):');
  const seen = new Set();
  for (const r of original.requests) for (let i = 0; i < r.blockIds.length; i++) {
    const b = original.blocks[r.blockIds[i]], id = output.requests[r.idx].blockIds[i];
    if (b.kind !== 'user_text' || seen.has(id)) continue;
    seen.add(id);
    lines.push(`${id}\trequest ${r.idx}\tlength ${b.chars}\t${JSON.stringify((b.text ?? '').slice(0, 40))}`);
  }
  const stats = { requests: output.requests.length, blocks: Object.keys(output.blocks).length,
    events: output.events.length, eventsByType: {}, outputBytes: Buffer.byteLength(serialized), distinctSurvivingStrings: strings.size };
  for (const e of output.events) stats.eventsByType[e.type] = (stats.eventsByType[e.type] ?? 0) + 1;
  lines.push('', 'Stats:', JSON.stringify(stats, null, 2));
  return { report: lines.join('\n') + '\n', stats };
}

// Targeted publication mode for an isolated session on a public repository.
// IDs are deliberately preserved: main-thread calls and agent metadata share them.
export function redactTranscript(text, user, privateWords = [], ids = new Map()) {
  if (!user || !/^[\w.-]+$/.test(user)) throw new Error('A local username is required');
  const escaped = user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const word of privateWords) {
    const literal = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(/^[a-z0-9]+$/i.test(word) ? `\\b${literal}\\b` : literal, 'gi'), 'demo');
  }
  return text
    .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi, 'demo@example.com')
    .replace(/(?:\/(?:home|Users)\/[^/\s"\\]+|~)\/\.claude\/projects\/[^/\s"\\]+/g, '/home/demo/.claude/projects/demo-project')
    .replace(/\/(?:home|Users)\/[^/\s"\\]+/g, '/home/demo')
    .replace(/\/tmp\/cc-demo-[a-z0-9]+/gi, '/tmp/demo')
    .replace(new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'g'), 'demo')
    .replace(/\b(?:[a-f0-9]{64}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})\b/gi, value => {
      if (!ids.has(value)) ids.set(value, `demo-id-${ids.size + 1}`);
      return ids.get(value);
    });
}

export async function redactFolder(input, output, user, privateWords = []) {
  const names = (await readdir(input)).filter(n => n.endsWith('.jsonl')).sort();
  if (names.length !== 1 || resolve(input) === resolve(output)) throw new Error('Expected one main transcript');
  const main = names[0], id = main.slice(0, -6);
  const childDir = join(input, id, 'subagents');
  const children = (await readdir(childDir)).filter(n => /^agent-.+\.(jsonl|meta\.json)$/.test(n)).sort();
  const paths = [main, ...children.map(n => join(id, 'subagents', n))];
  const sources = await Promise.all(paths.map(name => readFile(join(input, name), 'utf8')));
  const times = sources.flatMap((raw, i) => paths[i].endsWith('.jsonl') ? raw.split('\n').filter(s => s.trim()).map(line => {
    const value = JSON.parse(line).timestamp;
    return typeof value === 'number' ? value : Date.parse(value);
  }).filter(Number.isFinite) : []);
  const base = times.reduce((minimum, time) => Math.min(minimum, time), Infinity);
  const epoch = Date.parse('2026-01-01T00:00:00Z');
  const shift = text => text.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\b/g, value => {
    const instant = Date.parse(value);
    return Number.isFinite(base) && Number.isFinite(instant) ? new Date(epoch + instant - base).toISOString().replace('.000Z', 'Z') : 'date-unavailable';
  }).replace(/\b\d{4}-\d{2}-\d{2}\b(?!T)/g, '2026-01-01')
    .replace(/("(?:timestamp|time|ts|startedAt|endedAt)"\s*:\s*)(\d{13})(?!\d)/g,
    (_, key, value) => key + (Number.isFinite(base) ? epoch + Number(value) - base : 'null'));
  // Read and transform before creating output. Never write an unredacted byte.
  const ids = new Map();
  const files = [];
  for (const [index, name] of paths.entries()) {
    const raw = sources[index];
    if (name.endsWith('.meta.json')) {
      const content = shift(redactTranscript(raw, user, privateWords, ids));
      JSON.parse(content);
      files.push([name, content]);
      continue;
    }
    const records = raw.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
    const canonical = value => Array.isArray(value) ? value.map(canonical)
      : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    const hash = message => createHash('sha256').update(JSON.stringify(canonical(message))).digest('hex');
    const wanted = new Set(records.flatMap(r => r.type === 'api-request' ? r.tail ?? [] : []));
    const recovered = new Map();
    const remember = message => {
      const key = hash(message);
      if (wanted.has(key)) recovered.set(key, message);
    };
    // Redaction changes message digests. Materialize only hash-verified messages
    // before replacing text/IDs so the real parser retains exact relationships.
    let groups = new Map();
    const flush = () => {
      for (const parts of groups.values()) {
        const content = [...parts].sort(([a], [b]) => typeof a === 'number' && typeof b === 'number' ? a - b : 0).flatMap(([, v]) => typeof v === 'string' ? [{ type: 'text', text: v }] : v);
        remember({ role: 'assistant', content });
        remember({ role: 'assistant', content: content.filter(p => p.type !== 'thinking') });
      }
      groups = new Map();
    };
    for (const record of records) {
      if (record.type === 'api-request') flush();
      if (record.type === 'user' && record.message) remember(record.message);
      if (record.type === 'assistant' && record.message && record.message.model !== '<synthetic>') {
        const key = record.message.id ?? record.requestId;
        if (!groups.has(key)) groups.set(key, new Map());
        const parts = groups.get(key);
        parts.set(record.apiBlockIndex ?? record.uuid ?? parts.size, record.message.content ?? []);
      }
    }
    flush();
    const blobs = [...recovered].map(([hash, message]) => JSON.stringify({ type: 'api-request-blob', hash, message }));
    const content = shift(redactTranscript([...blobs, raw].join('\n'), user, privateWords, ids));
    for (const line of content.split('\n').filter(line => line.trim())) JSON.parse(line);
    files.push([name, content]);
  }
  await mkdir(output, { mode: 0o700 });
  await mkdir(join(output, id, 'subagents'), { recursive: true, mode: 0o700 });
  for (const [name, content] of files) await writeFile(join(output, name), content, { mode: 0o600, flag: 'wx' });
  return { main, children, sessionId: id };
}

async function main(args) {
  if (args.length === 5 && args[1] === '--user' && args[3] === '--out' && (await stat(args[0])).isDirectory()) {
    const result = await redactFolder(args[0], args[4], args[2]);
    process.stdout.write(JSON.stringify({ files: 1 + result.children.length }) + '\n');
    return;
  }
  if (args.length !== 7 || args[1] !== '--config' || args[3] !== '--out' || args[5] !== '--report') {
    throw new Error('Usage: node scripts/redact.mjs <session.jsonl> --config <config.json> --out <session.redacted.json> --report <report.txt>');
  }
  const [input, , configPath, , outPath, , reportPath] = args;
  if (new Set([input, configPath, outPath, reportPath].map(p => resolve(p))).size !== 4) throw new Error('All paths must be distinct');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const parser = createParser();
  const stream = createReadStream(input);
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of reader) parser.push(line);
  const original = parser.finish();
  const output = redactSession(original, config);
  const serialized = JSON.stringify(output, null, 2) + '\n';
  const { report, stats } = makeReport(original, output, serialized);
  // Exclusive creation avoids overwriting the source via symlinks or hard links.
  await writeFile(reportPath, report, { mode: 0o600, flag: 'wx' });
  await writeFile(outPath, serialized, { mode: 0o600, flag: 'wx' });
  process.stdout.write(JSON.stringify(stats) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => {
    // Parse and filesystem errors can embed private values; never echo them.
    console.error('Redaction failed. Check arguments, config, input and unused output paths locally.');
    process.exitCode = 1;
  });
}
