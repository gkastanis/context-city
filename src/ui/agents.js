import { findBlockRequest, sessionWithAgents, forEachRequestChange } from './compact.js';
import { formatTokens, sessionCache, timelineTimes } from './math.js';

const branchCache = new WeakMap();
// Inclusive endpoints: two branches meeting at a request still need separate rows.
export function packLanes(items, startKey, endKey) {
  const ends = [], packed = new Map();
  for (const item of [...items].sort((a, b) => a[startKey] - b[startKey] || a[endKey] - b[endKey])) {
    let lane = ends.findIndex(end => end < item[startKey]);
    if (lane < 0) lane = ends.length;
    ends[lane] = item[endKey]; packed.set(item, lane);
  }
  return items.map(item => ({ ...item, lane: packed.get(item) }));
}
export function agentBranches(session) {
  if (branchCache.has(session)) return branchCache.get(session);
  const first = new Map();
  forEachRequestChange(session, (r, idx, ids, removed, keep) => {
    for (let i = keep; i < ids.length; i++) if (!first.has(ids[i])) first.set(ids[i], idx);
  });
  const calls = new Map(), results = new Map(), notifications = new Map();
  const record = (map, key, value) => { if (key && (!map.has(key) || value.idx < map.get(key).idx)) map.set(key, value); };
  for (const b of Object.values(session.blocks)) {
    if (!first.has(b.id)) continue;
    const value = { idx: first.get(b.id), block: b };
    if (b.kind === 'tool_use' && ['Agent', 'Task'].includes(b.toolName)) record(calls, b.toolUseId, value);
    if (b.kind === 'tool_result') { record(results, b.toolUseId, value); record(results, b.agentId, value); }
    for (const id of b.notifies ?? []) record(notifications, id, value);
  }
  const branches = [];
  for (const run of session.agents ?? []) {
    if (run.parentRequestIdx == null) continue;
    const result = results.get(run.toolUseId) ?? results.get(run.agentId);
    const async = result?.block.async === true;
    const completion = async ? notifications.get(run.agentId) : result;
    const merge = completion?.idx ?? Math.max(0, session.requests.length - 1);
    const fork = calls.get(run.toolUseId)?.idx ?? result?.idx ?? merge;
    const times = run.session.requests.map(r => r.time).filter(Number.isFinite);
    const cache = sessionCache(run.session.requests);
    branches.push({ agentId: run.agentId, label: runLabel(run), description: run.description, async,
      fork, merge, forkTime: session.requests[fork]?.time ?? null, mergeTime: session.requests[merge]?.time ?? null,
      runStart: times.length ? times.reduce((a, b) => Math.min(a, b)) : null, runEnd: times.length ? times.reduce((a, b) => Math.max(a, b)) : null,
      open: !completion, requests: run.session.requests.length,
      peak: run.session.requests.reduce((n, r) => Math.max(n, r.measuredTokens ?? r.estTokens ?? 0), 0),
      inputTokens: cache?.total ?? null, hitRate: cache?.hitRate ?? null });
  }
  branches.sort((a, b) => a.fork - b.fork || a.merge - b.merge);
  const requestPacked = packLanes(branches, 'fork', 'merge');
  const times = timelineTimes(session.requests.map(r => r.time));
  const timePacked = packLanes(branches.map(b => ({ ...b, axisStart: !b.async && b.runStart != null ? b.runStart : times[b.fork], axisEnd: !b.async && b.runEnd != null ? b.runEnd : times[b.merge] })), 'axisStart', 'axisEnd');
  const packed = requestPacked.map((b, i) => ({ ...b, requestLane: b.lane, timeLane: timePacked[i].lane }));
  branchCache.set(session, packed);
  return packed;
}
export function maxParallel(branches) {
  const timed = branches.length && branches.every(b => Number.isFinite(b.forkTime) && Number.isFinite(b.mergeTime));
  const events = branches.flatMap(b => [[timed ? b.forkTime : b.fork, 1], [timed ? b.mergeTime : b.merge, -1]]);
  events.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let active = 0, peak = 0;
  for (const [, delta] of events) { active += delta; peak = Math.max(peak, active); }
  return peak;
}
export function runDuration(run) {
  return Number.isFinite(run.runStart) && Number.isFinite(run.runEnd) ? Math.max(0, run.runEnd - run.runStart) : null;
}
export function durationLabel(ms) { return ms < 60000 ? 'under 1 min' : Math.round(ms / 60000) + ' min'; }
export function agentColor(type) {
  let hash = 2166136261;
  for (const c of type || 'Subagent') hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  return ['#4fc3d9', '#a58cff', '#6fd3a6', '#ff8fd0', '#f0a64a', '#8aa9ff'][hash % 6];
}
export function agentBranchLabel(run) {
  const duration = runDuration(run);
  return `${run.label}: ${(run.description || '').slice(0, 80)}, main requests ${run.fork + 1} to ${run.merge + 1}, ${run.requests} requests, peak ${formatTokens(run.peak)}, ${run.hitRate == null ? 'cache hit unavailable' : Math.round(run.hitRate * 100) + '% cache hit'}, ${run.async ? 'ran in the background' : 'main thread waited'}${duration == null ? '' : ', ran ' + durationLabel(duration)}${run.open ? ', has not returned' : ''}`;
}
export function agentStats(session) {
  const longest = (session.agents ?? []).reduce((best, run) => !best || run.session.requests.length > best.session.requests.length ? run : best, null);
  const branches = agentBranches(session), foreground = branches.filter(b => !b.async);
  return { longest, maxParallel: maxParallel(branches), foreground: foreground.length,
    waited: foreground.some(b => runDuration(b) != null) ? foreground.reduce((n, b) => n + (runDuration(b) ?? 0), 0) : null };
}

export function agentCalls(session) {
  return [...new Set(Object.values(session.blocks).filter(b => b.kind === 'tool_result' && b.agentId).map(b => b.agentId))];
}
export function allAgentsLoaded(session) {
  const ids = agentCalls(session), runs = session.agents ?? [];
  const loaded = new Set(runs.map(a => a.agentId));
  const calls = Object.values(session.blocks).filter(b => b.kind === 'tool_use' && ['Agent', 'Task'].includes(b.toolName));
  return runs.length > 0 && (ids.length > 0 || calls.length > 0) && ids.every(id => loaded.has(id))
    && calls.every(b => runs.some(a => b.toolUseId && a.toolUseId === b.toolUseId))
    && !(session.meta.sidechainRequests > 0);
}
export function runLabel(run) {
  return run.agentType || run.session.meta.agent?.querySource?.split(':').slice(2).join(':') || 'Subagent';
}
export function linkedRun(session, block) {
  return (session?.agents ?? []).find(a => a.parentBlockId === block?.id ||
    (block?.toolUseId && a.toolUseId === block.toolUseId) || (block?.agentId && a.agentId === block.agentId));
}
// Metadata stays on the run, never in the child Session or its block text.
export function attachAgents(main, runs) {
  const agents = new Map((main.agents ?? []).map(a => [a.agentId, a]));
  const blocks = Object.values(main.blocks);
  for (const run of runs) {
    if (run.session === main) continue;
    const result = blocks.find(b => b.kind === 'tool_result' &&
      ((run.toolUseId && b.toolUseId === run.toolUseId) || (run.agentId && b.agentId === run.agentId)));
    const call = blocks.find(b => b.kind === 'tool_use' && run.toolUseId && b.toolUseId === run.toolUseId);
    const parent = result || call;
    const toolUseId = run.toolUseId ?? parent?.toolUseId ?? null;
    const parentRequestIdx = parent ? findBlockRequest(main, parent.id) : -1;
    agents.set(run.agentId, { ...run, toolUseId, parentBlockId: parent?.id ?? null,
      parentRequestIdx: parentRequestIdx < 0 ? null : parentRequestIdx });
  }
  // Return a new root so memoized analytics cannot retain the old run set.
  return sessionWithAgents(main, [...agents.values()]);
}
export function agentRun(session, fileName, metadata = {}) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) metadata = {};
  const agentId = /^agent-(.+)\.jsonl$/i.exec(fileName)?.[1] ?? session.meta.agent?.agentId ?? fileName;
  return {
    agentId, agentType: typeof metadata.agentType === 'string' ? metadata.agentType : null,
    description: typeof metadata.description === 'string' ? metadata.description : '',
    toolUseId: typeof metadata.toolUseId === 'string' ? metadata.toolUseId : null,
    spawnDepth: Number.isFinite(metadata.spawnDepth) ? metadata.spawnDepth : null,
    finished: typeof metadata.finished === 'boolean' ? metadata.finished : null, session,
  };
}
