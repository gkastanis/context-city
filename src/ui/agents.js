import { findBlockRequest, sessionWithAgents } from './compact.js';

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
