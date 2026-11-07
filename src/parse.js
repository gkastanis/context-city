import { splitText } from './classify.js';

const serialize = value => typeof value === 'string' ? value : JSON.stringify(value ?? null);
const basename = value => String(value ?? '').split(/[\\/]/).pop();
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `${(h >>> 0).toString(16)}-${text.length}`;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

// The wire message hash is SHA-256 of sorted JSON, verified against recorded
// blobs. A synchronous implementation keeps push/finish pure and Worker-safe.
function messageHash(message) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(message)));
  const size = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(size);
  data.set(bytes); data[bytes.length] = 128;
  const view = new DataView(data.buffer);
  view.setUint32(size - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(size - 4, bytes.length * 8 >>> 0);
  const primes = [], initial = [], constants = [];
  for (let n = 2; constants.length < 64; n++) {
    if (primes.some(p => n % p === 0)) continue;
    primes.push(n);
    if (initial.length < 8) initial.push(Math.sqrt(n) * 0x100000000 | 0);
    constants.push(Math.cbrt(n) * 0x100000000 | 0);
  }
  const state = initial, words = new Int32Array(64);
  const rotate = (x, n) => x >>> n | x << (32 - n);
  for (let offset = 0; offset < size; offset += 64) {
    for (let i = 0; i < 64; i++) {
      if (i < 16) words[i] = view.getInt32(offset + i * 4);
      else {
        const x = words[i - 15], y = words[i - 2];
        words[i] = words[i - 16] + (rotate(x, 7) ^ rotate(x, 18) ^ x >>> 3)
          + words[i - 7] + (rotate(y, 17) ^ rotate(y, 19) ^ y >>> 10) | 0;
      }
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i++) {
      const t = h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + (e & f ^ ~e & g) + constants[i] + words[i] | 0;
      const u = (rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + (a & b ^ a & c ^ b & c) | 0;
      h = g; g = f; f = e; e = d + t | 0; d = c; c = b; b = a; a = t + u | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { state[i] = state[i] + v | 0; });
  }
  return state.map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

// Decode only a bounded header, never retain base64 in block text.
function imageSize(part) {
  try {
    const raw = atob((part.source?.data ?? '').slice(0, 16384));
    const b = Uint8Array.from(raw, c => c.charCodeAt(0));
    const v = new DataView(b.buffer);
    const tag = (start, n) => raw.slice(start, start + n);
    if (tag(0, 8) === '\x89PNG\r\n\x1a\n' && tag(12, 4) === 'IHDR') return [v.getUint32(16), v.getUint32(20)];
    if (/^GIF8[79]a/.test(raw)) return [v.getUint16(6, true), v.getUint16(8, true)];
    if (tag(0, 4) === 'RIFF' && tag(8, 4) === 'WEBP') {
      if (tag(12, 4) === 'VP8X') return [1 + b[24] + (b[25] << 8) + (b[26] << 16), 1 + b[27] + (b[28] << 8) + (b[29] << 16)];
      if (tag(12, 4) === 'VP8L' && b[20] === 0x2f) return [1 + b[21] + ((b[22] & 63) << 8), 1 + (b[22] >> 6) + (b[23] << 2) + ((b[24] & 15) << 10)];
      if (tag(12, 4) === 'VP8 ' && tag(23, 3) === '\x9d\x01\x2a') return [v.getUint16(26, true) & 16383, v.getUint16(28, true) & 16383];
    }
    if (b[0] === 255 && b[1] === 216) {
      for (let i = 2; i + 8 < b.length;) {
        if (b[i++] !== 255) break;
        while (b[i] === 255) i++;
        const marker = b[i++];
        if (marker === 0xd8 || marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
        if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) return [v.getUint16(i + 5), v.getUint16(i + 3)];
        const length = v.getUint16(i); if (length < 2) break; i += length;
      }
    }
  } catch { /* Missing or unsupported header uses the documented fallback. */ }
  return null;
}
const isPrompt = r => {
  if (r.isMeta || r.isCompactSummary || (r.origin && r.origin.kind !== 'human')) return false;
  const content = r.message?.content;
  const texts = typeof content === 'string' ? [content] : (content ?? []).filter(p => p.type === 'text').map(p => p.text ?? '');
  if (texts.some(t => /<(?:command-|local-command|task-notification\b)/i.test(t))) return false;
  return texts.some(t => splitText(t).some(p => p.kind === 'user_text' && p.text.trim()));
};
const usageOf = (u, previous = {}) => u ? {
  input: u.input_tokens ?? previous.input ?? 0,
  cacheRead: u.cache_read_input_tokens ?? previous.cacheRead ?? 0,
  cacheWrite: u.cache_creation_input_tokens ?? previous.cacheWrite ?? 0,
  output: u.output_tokens ?? previous.output ?? 0,
} : null;
const measured = u => u ? u.input + u.cacheRead + u.cacheWrite : null;

export function createParser(options = {}) {
  const session = {
    meta: { sessionId: null, sourceName: basename(options.sourceName), model: null, cliVersion: null,
      startedAt: null, endedAt: null, window: 1000000, autocompactAt: null,
      sample: false, skippedLines: 0, ignoredRecords: 0, sidechainRequests: 0, source: 'empty', emptyReason: null },
    blocks: {}, requests: [], events: [],
  };
  const shapes = new Map(), blobs = new Map(), requestById = new Map();
  const records = [], groups = new Map(), responseOrder = [], toolNames = new Map(), exactMessages = new Map();
  const dirtyGroups = new Set();
  const resultRecords = new Map();
  const resultTools = new Map(), nodes = new Map(), fallbackGroups = new Map(), promptEligibility = new Map(), promptTexts = new Map();
  let recentUsers = [], lastNode = null, sawApi = false, hasOrigins = false;
  const knownIgnored = new Set(['file-history-snapshot', 'summary', 'progress', 'queue-operation', 'system']);
  let pending = [], current = null, finished = false;

  function block(fields) {
    const text = fields.text ?? null;
    const seed = `${fields.kind}:${hash(serialize([text, fields.identity, fields.role, fields.layer, text == null && fields.identity == null ? fields.note : null]))}`;
    let id = seed, collision = 0;
    while (session.blocks[id] && session.blocks[id].text !== text) id = `${seed}:${++collision}`;
    const { identity, ...stored } = fields;
    if (!session.blocks[id]) session.blocks[id] = {
      id, role: null, toolName: null, text, chars: text?.length ?? 0,
      estTokens: Math.ceil((text?.length ?? 0) / 4), provenance: 'verbatim', ...stored,
    };
    else if (fields.provenance === 'verbatim' && session.blocks[id].provenance === 'reconstructed') {
      session.blocks[id].provenance = 'verbatim';
      if (fields.note) session.blocks[id].note = fields.note;
      else delete session.blocks[id].note;
    }
    return id;
  }
  function tool(definition, provenance = 'verbatim', note) {
    const schema = definition.input_schema ?? {};
    return block({ kind: 'tool_def', layer: definition.name?.startsWith('mcp__') ? 'mcp' : 'tools',
      label: definition.name ?? 'Tool', toolName: definition.name ?? null, role: 'system',
      text: serialize(definition), provenance, ...(note ? { note } : {}),
      params: Object.entries(schema.properties ?? {}).map(([name, value]) => ({ name,
        required: (schema.required ?? []).includes(name), type: value.type ?? null, description: value.description ?? '' })),
      split: { descTokens: Math.ceil((definition.description?.length ?? 0) / 4),
        schemaTokens: Math.ceil(serialize(schema).length / 4) } });
  }
  function image(part, common) {
    const size = imageSize(part);
    const valid = size?.every(n => Number.isFinite(n) && n > 0);
    return block({ ...common, kind: 'attachment', layer: 'message', label: 'Image', text: null,
      identity: [hash(part.source?.data ?? serialize(part)), common.toolUseId ?? null], chars: 0,
      ...(common.toolUseId ? { layer: 'results' } : {}),
      estTokens: valid ? Math.ceil(size[0] * size[1] / 750) : 1600,
      note: `${common.note ? common.note + '; ' : ''}${valid ? `Image header: ${size[0]}×${size[1]}; ceil(w*h/750)` : 'Image header unavailable; fallback 1600 tokens'}` });
  }
  function parts(message, provenance = 'verbatim', note) {
    const role = message.role ?? 'user';
    const content = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content ?? [];
    return content.flatMap(part => {
      const common = { role, provenance, ...(note ? { note } : {}) };
      if (part.type === 'text') return splitText(part.text ?? '', role).map(piece => block({ ...piece, ...common }));
      if (part.type === 'tool_addition') {
        const definition = part.tool?.definition;
        if (definition) return [tool(definition, provenance, note)];
      }
      if (part.type === 'tool_use') {
        toolNames.set(part.id, part.name);
        return [block({ ...common, kind: 'tool_use', layer: 'tool_call', label: part.name ?? 'Tool call',
          toolName: part.name ?? null, text: serialize(part) })];
      }
      if (part.type === 'image') return [image(part, common)];
      if (part.type === 'tool_result') {
        if (Array.isArray(part.content) && part.content.some(p => p.type === 'image')) {
          // Keep result sub-parts in wire order while excluding image bytes.
          return part.content.flatMap(p => {
            if (p.type !== 'image') return parts({ role, content: [{ ...part, content: [p] }] }, provenance, note);
            const id = image(p, { ...common, toolUseId: part.tool_use_id });
            resultTools.set(id, part.tool_use_id);
            return [id];
          });
        }
        const id = block({ ...common, kind: 'tool_result', layer: 'results', label: 'Tool result',
          toolName: toolNames.get(part.tool_use_id) ?? null, text: serialize(part) });
        resultTools.set(id, part.tool_use_id);
        return [id];
      }
      if (part.type === 'thinking') return [block({ ...common, kind: 'thinking', layer: 'assistant', label: 'Thinking', text: part.thinking ?? '', identity: part.signature ?? '', ...(!part.thinking ? { provenance: 'unavailable', estTokens: 0, note: 'thinking omitted from transcript (signature only)' } : {}) })];
      // Preserve other structured content without inventing an interpretation.
      return [block({ ...common, kind: 'attachment', layer: 'message', label: part.type === 'image' ? 'Image' : 'Content part', text: serialize(part) })];
    });
  }
  function event(type, record, data = {}) {
    pending.push({ type, ts: record.timestamp ?? null, label: {
      user_prompt: 'User prompt', deferred_tools: 'Deferred tools', mcp_instructions: 'MCP instructions',
      skill_listing: 'Skills', compaction: 'Compaction',
    }[type], data });
  }
  function push(line) {
    if (finished) throw new Error('Parser already finished');
    if (!line.trim()) return;
    let r;
    try { r = JSON.parse(line); } catch { session.meta.skippedLines++; return; }
    if (!r || typeof r !== 'object' || Array.isArray(r)) { session.meta.skippedLines++; return; }
    const meta = session.meta;
    meta.sessionId ??= r.sessionId ?? null;
    meta.cliVersion ??= r.version ?? null;
    if (typeof r.timestamp === 'string') {
      if (!meta.startedAt || r.timestamp < meta.startedAt) meta.startedAt = r.timestamp;
      if (!meta.endedAt || r.timestamp > meta.endedAt) meta.endedAt = r.timestamp;
    }
    // Attachment and harness records participate in parentUuid ancestry even
    // when they contribute no context block. Compaction starts a fresh chain.
    if (!r.isSidechain && r.uuid && r.type !== 'user' && r.type !== 'assistant') {
      nodes.set(r.uuid, { ids: [], parent: r.subtype === 'compact_boundary' ? null : r.parentUuid !== undefined ? r.parentUuid : lastNode });
      lastNode = r.uuid;
    }
    if (r.type === 'api-request') {
      flushWire();
      sawApi = true;
      if (r.isSidechain === true || !(r.querySource?.startsWith('repl_main_thread') || r.querySource === 'sdk')) {
        meta.sidechainRequests++; current = null; return;
      }
      meta.model ??= r.params?.model ?? null;
      current = { id: r.id, base: r.base, querySource: r.querySource, users: recentUsers, shapeHash: r.shapeHash, keep: r.keep ?? 0, tail: r.tail ?? [],
        ts: r.timestamp ?? null, idx: records.length, usage: null, groups: [], events: pending };
      pending = []; recentUsers = [];
      records.push(current);
      requestById.set(r.id, current);
      return;
    }
    if (r.type === 'api-request-shape') {
      // The API renders tool definitions before the system prompt.
      shapes.set(r.shapeHash, [
        ...(r.shape?.tools ?? []).map(definition => tool(definition)),
        ...(r.shape?.system ?? []).flatMap(part => typeof part === 'string'
          ? parts({ role: 'system', content: part }) : parts({ role: 'system', content: [part] })),
      ]);
      return;
    }
    if (r.type === 'api-request-blob') { blobs.set(r.hash, parts(r.message ?? {})); return; }
    if (r.isSidechain === true) return;
    if (r.type === 'assistant') {
      const message = r.message ?? {};
      if (message.model === '<synthetic>') {
        if (r.uuid) { nodes.set(r.uuid, { ids: [], parent: r.parentUuid !== undefined ? r.parentUuid : lastNode }); lastNode = r.uuid; }
        return;
      }
      recentUsers = []; // Only the user tail after the last assistant is eligible for reconstruction.
      meta.model ??= message.model ?? null;
      const nodeIds = parts(message, 'reconstructed', 'Recovered from assistant response records');
      const nodeKey = r.uuid ?? `node:${nodes.size}`;
      const parent = r.parentUuid !== undefined ? r.parentUuid : lastNode;
      nodes.set(nodeKey, { ids: nodeIds, parent }); lastNode = nodeKey;
      if (message.id) {
        let g = fallbackGroups.get(message.id);
        if (!g) {
          g = { parent, preApi: !sawApi, cutoff: nodes.size - 1, ts: r.timestamp ?? null, events: pending, usage: null, parts: new Map() };
          fallbackGroups.set(message.id, g);
          if (!sawApi) pending = [];
        }
        const index = r.apiBlockIndex ?? r.uuid ?? g.parts.size;
        g.parts.set(index, nodeIds);
        // Keep record ancestry intact; only repeated snapshots of one part deduplicate.
        nodes.get(nodeKey).slot = `${message.id}:${index}`;
        if (message.usage) g.usage = usageOf(message.usage, g.usage ?? {});
      }
      // Local files link assistant.requestRef to api-request.id. requestId is
      // the provider's id and normally differs. Prefer either explicit match;
      // ordering is used only for older records without requestRef.
      const answered = requestById.get(r.requestRef) ?? requestById.get(r.requestId)
        ?? (r.requestRef == null ? current : null);
      if (!answered && sawApi) return;
      // Resumed history can precede the first recorded API request. Hash these
      // records exactly, but never use them as adjacent response candidates.
      const key = answered ? `${answered.idx}:${message.id ?? r.requestId ?? 'response'}`
        : `pre:${message.id ?? r.requestId ?? nodeKey}`;
      let group = groups.get(key);
      if (!group) {
        group = { parts: new Map(), wireParts: new Map(), owner: answered?.idx ?? -1 };
        groups.set(key, group);
        if (answered) { responseOrder.push(group); answered.groups.push(group); }
      }
      const ids = nodeIds;
      // Streaming records carry individual apiBlockIndex values; repeated
      // snapshots replace that index rather than duplicating the response.
      const partIndex = r.apiBlockIndex ?? r.uuid ?? group.parts.size;
      group.parts.set(partIndex, ids);
      group.wireParts.set(partIndex, message.content ?? []);
      dirtyGroups.add(group);
      if (answered && message.usage) answered.usage = usageOf(message.usage, answered.usage ?? {});
      return;
    }
    if (r.type === 'attachment') {
      const a = r.attachment ?? {};
      if (a.type === 'deferred_tools_delta' || a.type === 'deferred_tools_record') {
        const names = [...new Set([...(a.addedNames ?? []), ...(a.surfacedNames ?? []), ...(a.entries ?? []).map(e => typeof e === 'string' ? e : e.name ?? e.toolName).filter(Boolean)])];
        const removed = [...new Set(a.removedNames ?? [])];
        if (names.length || removed.length) event('deferred_tools', r, { names, ...(removed.length ? { removed } : {}) });
      }
      if (a.type === 'mcp_instructions_delta') event('mcp_instructions', r, { names: a.addedNames ?? [] });
      if (a.type === 'skill_listing') event('skill_listing', r, { names: a.names ?? [] });
      // Attachments describe rendered context; the API blobs already contain
      // its actual text. Adding it again would double-count the prefix.
      return;
    }
    if (r.type === 'user') {
      if (r.message) {
        const ids = parts(r.message, 'reconstructed', 'Recovered from user record; wire text may differ');
        const hash = messageHash(r.message);
        exactMessages.set(hash, ids);
        promptEligibility.set(hash, isPrompt(r));
        hasOrigins ||= !!r.origin;
        for (const id of ids) {
          const b = session.blocks[id];
          if (b.kind === 'user_text' && b.text?.trim()) promptTexts.set(b.text.trim(), isPrompt(r));
        }
        recentUsers.push({ ids, hash });
        // Replace repeated record snapshots as a unit, retaining image/text order.
        for (const callId of new Set(ids.map(id => resultTools.get(id)).filter(Boolean))) {
          resultRecords.set(callId, ids);
        }
        const key = r.uuid ?? `node:${nodes.size}`;
        nodes.set(key, { ids, parent: r.parentUuid !== undefined ? r.parentUuid : lastNode }); lastNode = key;
      }
      if (isPrompt(r)) { event('user_prompt', r); pending.at(-1).messageHash = messageHash(r.message);
        pending.at(-1).promptKeys = (exactMessages.get(messageHash(r.message)) ?? []).map(id => session.blocks[id]).filter(b => b.kind === 'user_text' && b.text?.trim()).map(b => b.text.trim()); }
      return;
    }
    if (r.type === 'system' && r.subtype === 'compact_boundary') {
      const c = r.compactMetadata ?? {};
      event('compaction', r, { trigger: c.trigger ?? null, preTokens: c.preTokens ?? null, postTokens: c.postTokens ?? null });
      return;
    }
    if (knownIgnored.has(r.type) || typeof r.type === 'string') meta.ignoredRecords++;
    else meta.skippedLines++;
  }
  function flushWire() {
    const ordered = map => [...map.entries()].sort(([a], [b]) => typeof a === 'number' && typeof b === 'number' ? a - b : 0);
    for (const group of dirtyGroups) {
      const content = ordered(group.wireParts).flatMap(([, content]) => typeof content === 'string' ? [{ type: 'text', text: content }] : content);
      const message = { role: 'assistant', content };
      exactMessages.set(messageHash(message), ordered(group.parts).flatMap(([, ids]) => ids));
      // The API sometimes drops thinking from past assistant messages.
      if (content.some(p => p.type === 'thinking')) {
        const stripped = { role: 'assistant', content: content.filter(p => p.type !== 'thinking') };
        exactMessages.set(messageHash(stripped), parts(stripped, 'reconstructed', 'Recovered from assistant records by exact message hash (thinking omitted)'));
      }
      group.wireParts.clear();
    }
    dirtyGroups.clear();
  }
  function finish() {
    if (finished) return session;
    finished = true;
    let previousMessages = [], previousBlocks = new Set();
    const hasRepl = records.some(r => r.querySource.startsWith('repl_main_thread'));
    const mainRecords = records.filter(r => !hasRepl || r.querySource !== 'sdk');
    session.meta.sidechainRequests += records.length - mainRecords.length;
    // SDK eligibility depends on the entire file. Return state consumed by an
    // ineligible SDK request to the next main request (or the after-last queue).
    if (hasRepl) {
      let carriedEvents = [], carriedUsers = [];
      for (const record of records) {
        if (record.querySource === 'sdk') {
          carriedEvents.push(...record.events); carriedUsers.push(...record.users);
        } else {
          record.events = [...carriedEvents, ...record.events];
          record.users = [...carriedUsers, ...record.users];
          carriedEvents = []; carriedUsers = [];
        }
      }
      pending = [...carriedEvents, ...pending];
    }
    const messageChains = new Map();
    const mainOwners = new Set(mainRecords.map(r => r.idx));
    function addRequest(record, blockIds, newFrom) {
      const idx = session.requests.length;
      session.requests.push({ idx, ts: record.ts, blockIds, newFrom,
        newBlockIds: [...new Set(blockIds.filter(id => !previousBlocks.has(id)))], usage: record.usage,
        measuredTokens: measured(record.usage),
        estTokens: blockIds.reduce((sum, id) => sum + session.blocks[id].estTokens, 0) });
      let prompted = false;
      for (const { messageHash: _, promptKeys: __, ...e } of record.events) {
        if (e.type === 'user_prompt' && !(idx === 0 && earlyEvents.length)) {
          if (prompted) continue;
          prompted = true;
        }
        session.events.push({ ...e, requestIdx: idx });
      }
      previousBlocks = new Set(blockIds);
    }
    const recovered = new Map(), usedGroups = new Set(), seenMessages = new Set(), loaded = new Set();
    // Each inferred tail occurrence can account for exactly one late user record.
    const promptCredits = new Map();
    const consumePrompt = keys => {
      const key = keys?.find(key => (promptCredits.get(key) ?? 0) > 0);
      if (key == null) return false;
      promptCredits.set(key, promptCredits.get(key) - 1);
      return true;
    };
    const earlyEvents = [...fallbackGroups.values()].filter(g => g.preApi).flatMap(g => g.events);
    if (mainRecords.length) {
      mainRecords[0].events = [...new Set([...earlyEvents, ...mainRecords[0].events])];
    }
    let previousToolNames = null;
    // Records-only sessions have no wire hashes to resolve. Their history is
    // reconstructed below; hashing every pre-API group would be wasted work.
    if (sawApi) flushWire();
    else dirtyGroups.clear();
    for (const record of mainRecords) {
      const baseMessages = record.base != null ? messageChains.get(record.base) ?? previousMessages : previousMessages;
      const messages = baseMessages.slice(0, Math.max(0, record.keep));
      const missing = record.tail.filter(h => !blobs.has(h) && !recovered.has(h));
      // Missing assistant hashes have no invertible id. Prefer responses to the
      // preceding request; for a rebuilt history use unused responses in order.
      let candidates = responseOrder.filter(g => mainOwners.has(g.owner) && g.owner < record.idx && !usedGroups.has(g));
      if (missing.length === 1) {
        const recent = candidates.filter(g => g.owner === record.idx - 1);
        if (recent.length === 1) candidates = recent;
      }
      record.events = record.events.filter(e => e.type !== 'user_prompt' || !consumePrompt(e.promptKeys));
      const represented = new Set([...messages.flat(), ...record.tail.flatMap(h => blobs.get(h) ?? recovered.get(h) ?? exactMessages.get(h) ?? [])]);
      // Reconstructed result text may differ from wire text (e.g. clipping).
      // The tool-use id still identifies the same result message.
      const representedResults = new Set([...represented].map(id => resultTools.get(id)).filter(Boolean));
      const userCandidates = record.users.filter(u => !seenMessages.has(u.hash)
        && !u.ids.some(id => represented.has(id) || representedResults.has(resultTools.get(id))));
      for (const h of record.tail) {
        let ids = blobs.get(h) ?? recovered.get(h) ?? exactMessages.get(h);
        if (ids) {
          // A recorded assistant blob can omit thinking. Matching a surviving
          // content part still identifies the response already represented.
          for (const group of candidates) {
            if ([...group.parts.values()].some(parts => parts.some(id => ids.includes(id)))) usedGroups.add(group);
          }
          candidates = candidates.filter(g => !usedGroups.has(g));
        }
        if (ids && ids.some(id => session.blocks[id].role === 'user')) {
          const matched = userCandidates.findIndex(u => u.ids.some(id => ids.includes(id)));
          if (matched >= 0) userCandidates.splice(matched, 1);
        }
        if (!ids) {
          let previous;
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].some(id => session.blocks[id].role !== 'system')) { previous = messages[i]; break; }
          }
          const last = previous?.map(id => session.blocks[id]).reverse().find(b => b.role !== 'system');
          const expectedRole = last?.role === 'user' ? 'assistant' : 'user';
          const callIds = (previous ?? []).filter(id => session.blocks[id].kind === 'tool_use')
            .map(id => JSON.parse(session.blocks[id].text).id);
          // A record can hold multiple results and accompanying text/images.
          // Keep its parts together and include that record only once.
          const matchingResults = [...new Set(callIds.map(id => resultRecords.get(id)).filter(Boolean))].flat();
          const user = expectedRole === 'user'
            ? matchingResults.length ? matchingResults : userCandidates.splice(0).flatMap(u => u.ids) : null;
          // Never substitute a merely adjacent response for a real wire hash.
          // Ordering fallback supports older opaque/non-SHA transcript hashes.
          const group = user?.length || /^[a-f0-9]{64}$/i.test(h) ? null : candidates.shift();
          if (user?.length) {
            ids = user;
            for (let i = userCandidates.length - 1; i >= 0; i--) {
              if (userCandidates[i].ids.some(id => ids.includes(id))) userCandidates.splice(i, 1);
            }
          } else if (group) {
            usedGroups.add(group);
            ids = [...group.parts.entries()].sort(([a], [b]) => typeof a === 'number' && typeof b === 'number' ? a - b : 0).flatMap(([, ids]) => ids);
            // Ordering is an inference: the transcript does not expose a link
            // from an omitted tail hash to an assistant UUID.
          } else ids = [block({ kind: expectedRole === 'assistant' ? 'assistant_text' : last?.kind === 'tool_use' ? 'tool_result' : 'user_text',
            layer: expectedRole === 'assistant' ? 'assistant' : last?.kind === 'tool_use' ? 'results' : 'message', label: 'Unavailable message',
            role: expectedRole, text: null, provenance: 'unavailable', note: `No matching message for tail hash ${h}` })];
          recovered.set(h, ids);
        }
        messages.push(ids);
        if (!seenMessages.has(h)) {
          seenMessages.add(h);
          const names = ids.filter(id => session.blocks[id].kind === 'tool_def' && !loaded.has(id)).map(id => {
            loaded.add(id); return session.blocks[id].toolName;
          });
          if (names.length) record.events.push({ type: 'tool_loaded', ts: record.ts, label: 'Tools loaded', data: { names } });
        }
      }
      const prefix = shapes.get(record.shapeHash) ?? [block({ kind: 'system', layer: 'system', label: 'Unavailable system prefix',
        text: null, provenance: 'unavailable', note: `Missing request shape ${record.shapeHash}` })];
      const toolSet = new Set(prefix.map(id => session.blocks[id]).filter(b => b.kind === 'tool_def').map(b => b.toolName));
      if (previousToolNames) {
        const names = [...toolSet].filter(name => !previousToolNames.has(name));
        const removed = [...previousToolNames].filter(name => !toolSet.has(name));
        if (names.length || removed.length) {
          const existing = record.events.find(e => e.type === 'tool_loaded');
          if (existing) {
            existing.data.names = [...new Set([...existing.data.names, ...names])];
            if (removed.length) existing.data.removed = removed;
          } else record.events.push({ type: 'tool_loaded', ts: record.ts, label: 'Tools loaded', data: { names, ...(removed.length ? { removed } : {}) } });
        }
      }
      previousToolNames = toolSet;
      const blockIds = [...prefix, ...messages.flat()];
      let newFrom = 0;
      const previousIds = session.requests.at(-1)?.blockIds ?? [];
      while (newFrom < blockIds.length && newFrom < previousIds.length && blockIds[newFrom] === previousIds[newFrom]) newFrom++;
      newFrom = Math.min(newFrom, prefix.length + baseMessages.slice(0, Math.max(0, record.keep)).flat().length);
      const unmatchedEvents = record.events.filter(e => e.type === 'user_prompt');
      const promptKeys = ids => ids.map(id => session.blocks[id]).filter(b => b.kind === 'user_text' && b.text?.trim()
        && promptTexts.get(b.text.trim()) !== false && (!hasOrigins || promptTexts.get(b.text.trim()) === true)
        && !/<(?:command-|local-command|task-notification\b)/i.test(b.text)).map(b => b.text.trim());
      // Prefix changes can move newFrom ahead of retained human history. A
      // prompt is new only when its occurrence count grows in the messages.
      const remaining = new Map();
      for (const ids of previousMessages) for (const key of promptKeys(ids)) remaining.set(key, (remaining.get(key) ?? 0) + 1);
      for (const ids of messages) {
        const keys = promptKeys(ids).filter(key => {
          const count = remaining.get(key) ?? 0;
          if (!count) return true;
          remaining.set(key, count - 1);
          return false;
        });
        if (!keys.length) continue;
        const matched = unmatchedEvents.findIndex(e => e.promptKeys?.some(key => keys.includes(key)));
        if (matched >= 0) unmatchedEvents.splice(matched, 1);
        else if (!record.events.some(e => e.type === 'user_prompt')
          && (!record.users.length || record.users.some(u => promptEligibility.get(u.hash) === true))) {
          record.events.push({ type: 'user_prompt', ts: record.ts, label: 'User prompt', data: {} });
          const key = keys[0];
          promptCredits.set(key, (promptCredits.get(key) ?? 0) + 1);
        }
      }
      addRequest(record, blockIds, newFrom);
      previousMessages = messages;
      messageChains.set(record.id, messages);
    }
    if (!sawApi && fallbackGroups.size) {
      const children = new Map(), order = new Map();
      let position = 0;
      for (const [key, node] of nodes) {
        order.set(key, position++);
        if (!children.has(node.parent)) children.set(node.parent, []);
        children.get(node.parent).push(key);
      }
      const info = new Map(), owners = new Map();
      // Cache node facts once instead of rebuilding/parsing them for every
      // request's ancestry. Owners let membership checks use the visited path.
      for (const [key, node] of nodes) {
        info.set(key, {
          user: node.ids.some(id => session.blocks[id].role === 'user'),
          calls: new Set(node.ids.filter(id => session.blocks[id].kind === 'tool_use')
            .map(id => JSON.parse(session.blocks[id].text).id)),
        });
        for (const id of node.ids) {
          const call = resultTools.get(id);
          if (!call) continue;
          if (!owners.has(call)) owners.set(call, []);
          owners.get(call).push(key);
        }
      }
      const chainIds = g => {
        const chain = [], visited = new Set(), slots = new Set(), superseded = new Set();
        for (let key = g.parent; key != null && nodes.has(key) && !visited.has(key);) {
          visited.add(key); const node = nodes.get(key);
          if (!node.slot || !slots.has(node.slot)) chain.push([key, node]);
          // A superseded streaming snapshot is visited but contributes no
          // results to the retained chain.
          else superseded.add(key);
          if (node.slot) slots.add(node.slot);
          key = node.parent;
        }
        const ids = [], pendingResults = [];
        for (const [key, node] of chain.reverse()) {
          if (info.get(key).user) ids.push(...pendingResults.splice(0));
          ids.push(...node.ids);
          const calls = info.get(key).calls;
          if (!calls.size) continue;
          for (const child of children.get(key) ?? []) {
            if (visited.has(child) || order.get(child) >= g.cutoff) continue;
            const results = nodes.get(child).ids.filter(id => calls.has(resultTools.get(id))
              && !(owners.get(resultTools.get(id)) ?? []).some(owner => visited.has(owner) && !superseded.has(owner)));
            pendingResults.push(...results);
          }
        }
        return [...ids, ...pendingResults];
      };
      const firstMeasured = [...fallbackGroups.values()].find(g => g.usage);
      const recordedEstimate = firstMeasured ? chainIds(firstMeasured).reduce((n, id) => n + session.blocks[id].estTokens, 0) : 0;
      const tokens = Math.max(0, (measured(firstMeasured?.usage) ?? 0) - recordedEstimate);
      const prefix = block({ kind: 'system', layer: 'system', label: 'System prompt and tools (not recorded)',
        text: null, chars: 0, estTokens: tokens, provenance: 'unavailable', note: 'Prefix not recorded; size includes first-turn reminders and is inferred from first measured input minus reconstructed messages' });
      for (const g of fallbackGroups.values()) {
        const ids = chainIds(g);
        const blockIds = [prefix, ...ids];
        const prev = session.requests.at(-1)?.blockIds ?? [];
        let newFrom = 0;
        while (newFrom < prev.length && newFrom < blockIds.length && prev[newFrom] === blockIds[newFrom]) newFrom++;
        addRequest(g, blockIds, newFrom);
      }
      session.meta.source = 'records';
    } else if (session.requests.length) session.meta.source = 'requests';
    if (!session.requests.length) session.meta.emptyReason = sawApi ? 'No eligible main-thread requests' : 'No usable API requests or assistant message records';
    const lastIdx = session.requests.length - 1;
    if (lastIdx >= 0) {
      for (const { messageHash: promptHash, promptKeys, ...e } of pending) {
        if (e.type === 'user_prompt' && consumePrompt(promptKeys)) continue;
        session.events.push({ ...e, requestIdx: lastIdx, data: { ...e.data, afterLast: true } });
      }
    }
    // Records not used in main-thread context (including unreferenced blobs)
    // should not leave orphan blocks or inflate provenance counts.
    const used = new Set();
    for (const r of session.requests) for (const id of r.blockIds) used.add(id);
    for (const id of Object.keys(session.blocks)) if (!used.has(id)) delete session.blocks[id];
    for (const [id, callId] of resultTools) {
      const result = session.blocks[id];
      if (result) {
        result.toolName = toolNames.get(callId) ?? null;
        result.label = result.toolName ? `${result.toolName} result` : 'Tool result';
      }
    }
    nodes.clear(); fallbackGroups.clear(); recentUsers = [];
    shapes.clear(); blobs.clear(); groups.clear(); exactMessages.clear(); requestById.clear(); records.length = 0; responseOrder.length = 0;
    toolNames.clear(); resultTools.clear(); resultRecords.clear(); promptEligibility.clear(); promptTexts.clear(); pending = []; current = null;
    return session;
  }
  return { push, finish };
}

export function parseText(text, options = {}) {
  const parser = createParser(options);
  for (const line of text.split(/\r?\n/)) parser.push(line);
  return parser.finish();
}
