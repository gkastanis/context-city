import { allAgentsLoaded, runLabel } from './agents.js';
import { formatTokens } from './math.js';
import { forEachRequestChange } from './compact.js';

const memo = new WeakMap();
const size = b => Number.isFinite(b?.estTokens) ? Math.max(0, b.estTokens) : 0;
const result = b => b?.kind === 'tool_result' || (b?.kind === 'attachment' && b.layer === 'results');
const scale = r => r.measuredTokens != null && r.estTokens > 0 ? r.measuredTokens / r.estTokens : 1;
const plural = (n, word) => `${formatTokens(n)} ${word}${n === 1 ? '' : 's'}`;
const serverName = name => /^mcp__(.+?)__/.exec(name ?? '')?.[1] ?? /^mcp:([^/]+)\//.exec(name ?? '')?.[1];
const tokens = n => plural(n, 'token');
const json = b => { try { return b?.text == null ? null : JSON.parse(b.text); } catch { return null; } };

// Compare request prefixes once, then update only changed suffix memberships.
// Only scalar per-block statistics and newly observed occurrences are retained.
export function findings(session) {
  if (memo.has(session)) return memo.get(session);
  const runs = session.agents ?? [];
  const sessions = [session, ...runs.map(a => a.session)];
  const used = new Set(sessions.flatMap(s => Object.values(s.blocks).filter(b => b.kind === 'tool_use').map(b => b.toolName)));
  const complete = allAgentsLoaded(session);
  const out = findingsFor(session, used, complete);
  for (const run of runs) for (const f of findingsFor(run.session, used, complete)) {
    out.push({ ...f, id: run.agentId + ':' + f.id, agentId: run.agentId, title: runLabel(run) + ': ' + f.title });
  }
  if (runs.length) {
    out.sort((a, b) => b.cost - a.cost);
    for (const summary of out.filter(f => f.kind === 'cache_rewrite' && f.cost === 0)) {
      out.splice(out.indexOf(summary), 1);
      const first = out.findIndex(f => f.kind === 'cache_rewrite' && f.agentId === summary.agentId);
      out.splice(first + 1, 0, summary);
    }
  }
  memo.set(session, out);
  return out;
}
function findingsFor(session, used, complete) {
  const { blocks, requests } = session;
  const out = [], stats = new Map(), maxima = new Map(), occurrences = [], tails = [], tops = [];
  const active = new Map();
  const heavyRequests = new Set(), heavyBlocks = new Set();
  const contextChanges = new Set((session.events ?? [])
    .filter(e => ['tool_loaded', 'deferred_tools', 'mcp_instructions'].includes(e.type)).map(e => e.requestIdx));
  let previousLength = 0;
  let top = [], defCount = 0, mostDefs = -1, defsIdx = 0;
  const topPush = (list, id) => {
    if (list.includes(id)) return;
    const n = size(blocks[id]);
    let at = 0; while (at < list.length && size(blocks[list[at]]) >= n) at++;
    if (at < 3) { list.splice(at, 0, id); if (list.length > 3) list.pop(); }
  };
  const add = (kind, key, title, detail, cost, requestIdx, blockId = null, amount = cost, basis = 'estimated') => {
    out.push({ id: `${kind}:${key}`, kind, title, detail, cost, requestIdx, blockId, tokens: amount, basis });
  };
  forEachRequestChange(session, (r, idx, ids, removed, keep, news) => {
    if (idx > 0 && (r.newFrom ?? keep) < previousLength) contextChanges.add(idx);
    previousLength = ids.length;
    let rebuildTop = false;
    for (const id of removed) {
      const b = blocks[id]; if (!b) continue;
      const count = active.get(id);
      if (b.kind === 'tool_def') defCount--;
      if (count > 1) active.set(id, count - 1);
      else {
        active.delete(id);
        const s = stats.get(id); s.count += idx - s.start; s.last = idx - 1;
        if (top.includes(id)) rebuildTop = true;
      }
    }
    for (let pos = keep; pos < ids.length; pos++) {
      const id = ids[pos], b = blocks[id]; if (!b) continue;
      const count = (active.get(id) ?? 0) + 1; active.set(id, count);
      if (b.kind === 'tool_def') defCount++;
      if (count === 1) {
        const s = stats.get(id) ?? { first: idx, last: idx, count: 0 };
        s.start = idx; stats.set(id, s);
        if (!rebuildTop) topPush(top, id);
      }
      if (count > (maxima.get(id) ?? 0)) {
        maxima.set(id, count);
        if (b.kind === 'tool_use' || result(b)) occurrences.push({ id, idx, b });
      }
    }
    if (rebuildTop) { top = []; for (const id of active.keys()) topPush(top, id); }
    if (defCount >= mostDefs) { mostDefs = defCount; defsIdx = idx; }
    const added = [], tailIds = new Set();
    if (Number.isInteger(r.newFrom)) {
      for (let pos = r.newFrom; pos < ids.length; pos++) {
        const id = ids[pos]; tailIds.add(id); topPush(added, id);
      }
    }
    for (const id of news) {
      if (!tailIds.has(id)) { topPush(added, id); tailIds.add(id); }
    }
    tails.push({ tokens: news.reduce((n, id) => n + size(blocks[id]), 0) * scale(r), top: added }); tops.push(top.slice());
  });
  for (const id of active.keys()) {
    const s = stats.get(id); s.count += requests.length - s.start; s.last = requests.length - 1;
  }
  const defs = mostDefs > 0 ? requests[defsIdx].blockIds.filter(id => blocks[id]?.kind === 'tool_def') : [];
  const compactions = (session.events ?? []).filter(e => e.type === 'compaction');
  const compactAt = new Map(compactions.map(e => [e.data?.afterLast ? e.requestIdx + 1 : e.requestIdx, e]));
  for (const [id, s] of stats) {
    const b = blocks[id], n = size(b), r = requests[s.first], share = r.estTokens > 0 ? n / r.estTokens * 100 : 0;
    const displayed = n * scale(r);
    if (!result(b) || !n || (share < 10 && n < 20000)) continue;
    heavyRequests.add(s.first); heavyBlocks.add(id);
    const compact = compactAt.get(s.last + 1);
    const end = compact ? `until the compaction ${compact.data?.afterLast ? 'after' : 'at'} request ${compact.requestIdx + 1}`
      : s.last === requests.length - 1 ? 'through the last request' : `through request ${s.last + 1}`;
    add('heavy_result', id, `${b.toolName || 'Tool'} result took ${Math.round(share)}% of the context`,
      `${tokens(displayed)} added at request ${s.first + 1}, ${Math.round(share)}% estimated share, carried for ${plural(s.count, 'request')} ${end}; about ${tokens(n * s.count)} of estimated input across the session.`,
      n * s.count, s.first, id, displayed);
  }
  const rewrites = [];
  for (let idx = 0; idx < requests.length; idx++) {
    const r = requests[idx], write = r.usage?.cacheWrite ?? 0, fresh = tails[idx].tokens;
    if (write < 50000 || write < fresh * 2) continue;
    const before = requests[idx - 1]?.ts, now = r.ts;
    const gap = before && now ? Date.parse(now) - Date.parse(before) : NaN;
    const cause = contextChanges.has(idx) ? ' after the context changed early (for example a tool was loaded)'
      : gap >= 300000 ? ` likely after the cache expired during a ${Math.floor(gap / 60000)} minute pause` : '';
    const cost = write - fresh; rewrites.push({ cost, idx });
    add('cache_rewrite', idx, `Prompt cache rebuilt at request ${idx + 1}`,
      `${tokens(write)} written to cache${cause}. Only ${tokens(fresh)} truly new context${r.measuredTokens != null ? ', scaled to measured input' : ' (estimated)'}; about ${tokens(cost)} extra input rewritten.`, cost, idx, null, cost, 'measured');
  }
  if (rewrites.length >= 3) {
    const cost = rewrites.reduce((n, r) => n + r.cost, 0);
    add('cache_rewrite', 'summary', `The prompt cache was rebuilt ${plural(rewrites.length, 'time')}, rewriting ${tokens(cost)}`,
      `${tokens(cost)} extra input rewritten across requests. Individual rebuilds are listed separately.`, 0, rewrites[0].idx, null, cost, 'measured');
  }

  const groups = new Map(), callsByLink = new Map(), pending = new Map();
  for (const occurrence of occurrences) {
    const { b } = occurrence;
    if (b.kind === 'tool_use') {
      const call = { ...occurrence, results: 0, paired: false };
      const link = b.toolUseId ?? json(b)?.id;
      if (link != null) callsByLink.set(link, call);
      const queue = pending.get(b.toolName) ?? { calls: [], next: 0 }; queue.calls.push(call); pending.set(b.toolName, queue);
      if (b.text == null) continue;
      const parsed = json(b);
      const input = parsed && Object.hasOwn(parsed, 'input') ? parsed.input : b.text;
      const key = JSON.stringify([b.toolName, input]), group = groups.get(key) ?? [];
      group.push(call); groups.set(key, group);
    } else {
      const link = b.toolUseId ?? json(b)?.tool_use_id;
      const queue = pending.get(b.toolName);
      while (queue && queue.next < queue.calls.length && queue.calls[queue.next].paired) queue.next++;
      const call = link != null ? callsByLink.get(link) : queue?.calls[queue.next];
      if (call) { call.results += size(b); call.paired = true; }
    }
  }
  let groupId = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const repeats = group.slice(1), firstRepeat = repeats[0];
    const fallback = repeats.some(c => !c.paired);
    const cost = repeats.reduce((n, c) => n + (c.paired ? c.results : size(c.b)), 0);
    add('repeated_call', groupId++, `${group[0].b.toolName || 'Tool'} called ${plural(group.length, 'time')} with the same input`,
      `${tokens(cost)} (estimated) from calls after the first.${fallback ? ' Where results could not be paired, tool call tokens are used instead.' : ' Paired result tokens are used.'}`,
      cost, firstRepeat.idx, firstRepeat.id);
  }
  const unused = [...new Set(defs)].filter(id => !used.has(blocks[id].toolName));
  const describe = ids => {
    const names = ids.map(id => blocks[id].toolName || blocks[id].label || 'Unnamed tool');
    return names.slice(0, 8).join(', ') + (names.length > 8 ? ` and ${names.length - 8} more` : '');
  };
  const carryCost = ids => ids.reduce((n, id) => n + size(blocks[id]) * stats.get(id).count, 0);
  const subagents = !complete && (session.meta?.sidechainRequests > 0 || Object.values(blocks).some(b => b.agentId)) ? (session.agents?.length ? ' Some subagent runs are not loaded, so some of these may have been used by subagents.' : ' Subagent calls are not counted, so some of these may have been used by subagents.') : '';
  if (unused.length) add('unused_tools', 'all', `${plural(unused.length, 'tool')} ${unused.length === 1 ? 'was' : 'were'} never called${complete ? '' : ' in the main thread'}`, `${describe(unused)}. ${tokens(carryCost(unused))} of estimated input across requests carried these definitions.${subagents}`, carryCost(unused), defsIdx, unused[0]);
  const servers = new Map();
  for (const id of unused) {
    const server = serverName(blocks[id].toolName);
    if (server) { const ids = servers.get(server) ?? []; ids.push(id); servers.set(server, ids); }
  }
  const usedServers = new Set([...used].map(serverName).filter(Boolean));
  for (const [server, ids] of servers) {
    if (usedServers.has(server)) continue;
    const n = ids.reduce((sum, id) => sum + size(blocks[id]), 0);
    add('unused_tools', server, `MCP server ${server}: ${plural(ids.length, 'tool')}, ${tokens(n)} per request, never called${complete ? '' : ' in the main thread'}`,
      `${describe(ids)}. Sizes and carry cost are estimated.${subagents}`, carryCost(ids), defsIdx, ids[0], n);
  }
  for (const [i, e] of compactions.entries()) {
    const idx = e.data?.afterLast ? e.requestIdx : e.requestIdx - 1;
    if (idx < 0 || idx >= requests.length) continue;
    const ids = tops[idx], n = ids.reduce((sum, id) => sum + size(blocks[id]), 0);
    const parts = ids.map(id => `${blocks[id].toolName ? `${blocks[id].toolName}${result(blocks[id]) ? ' result' : ''}` : blocks[id].label || blocks[id].kind} ${formatTokens(size(blocks[id]))} (${requests[idx].estTokens ? Math.round(size(blocks[id]) / requests[idx].estTokens * 100) : 0}%)`);
    add('compaction_pressure', i, 'What filled the context before compaction',
      `Before the compaction ${e.data?.afterLast ? 'after' : 'at'} request ${e.requestIdx + 1} the biggest blocks were: ${parts.join(', ')}. Sizes and shares are estimated.`, n, idx, ids[0] ?? null);
  }
  const jumps = [];
  for (let idx = 1; idx < requests.length; idx++) {
    if (heavyRequests.has(idx)) continue;
    const a = requests[idx - 1], b = requests[idx];
    const measured = a.measuredTokens != null && b.measuredTokens != null;
    const delta = measured ? b.measuredTokens - a.measuredTokens : (b.estTokens ?? 0) - (a.estTokens ?? 0);
    const ids = tails[idx].top.filter(id => !heavyBlocks.has(id));
    if (delta > 0 && ids.length) jumps.push({ idx, delta, measured, ids });
  }
  jumps.sort((a, b) => b.delta - a.delta);
  for (const { idx, delta, measured, ids } of jumps.slice(0, 3)) {
    add('big_jump', idx, `Context grew by ${formatTokens(delta)} tokens at request ${idx + 1}`,
      `${measured ? 'Measured' : 'Estimated'} increase. Largest new blocks (estimated): ${ids.map(id => `${blocks[id].label || blocks[id].kind} ${tokens(size(blocks[id]))}`).join(', ')}.`, delta, idx, ids[0], delta, measured ? 'measured' : 'estimated');
  }
  out.sort((a, b) => b.cost - a.cost);
  const summaryIdx = out.findIndex(f => f.id === 'cache_rewrite:summary');
  if (summaryIdx >= 0) {
    const [summary] = out.splice(summaryIdx, 1);
    out.splice(out.findIndex(f => f.kind === 'cache_rewrite') + 1, 0, summary);
  }
  return out;
}
