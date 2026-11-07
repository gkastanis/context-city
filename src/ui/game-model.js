// Session-wide facts use the shared block table and scalar request totals only.
// Never expand the cumulative request histories to build the game layer.
export function gameFacts(session) {
  const blocks = Object.values(session.blocks);
  const biggest = blocks.reduce((a, b) => !a || b.estTokens > a.estTokens ? b : a, null);
  const first = session.requests[0];
  const firstPrompt = first?.blockIds.map(id => session.blocks[id]).find(b => b?.kind === 'user_text' && b.layer === 'message')
    ?? blocks.find(b => b.kind === 'user_text' && b.layer === 'message');
  const quests = [];
  const add = (id, label, block, sentence, action = 'select') => {
    if (block) quests.push({ id, label, blockId: block.id, sentence, action });
  };
  add('system', 'Find the system prompt', blocks.find(b => b.layer === 'system'), 'The system prompt sets the rules the model follows.');
  add('schema', 'Enter a tool schema', blocks.find(b => b.kind === 'tool_def'), 'A tool schema tells the model what arguments a tool accepts.', 'enter');
  add('instructions', 'Find your CLAUDE.md', blocks.find(b => b.layer === 'user_instructions'), 'CLAUDE.md gives the model instructions for your work.');
  add('memory', 'Find the memory index', blocks.find(b => b.layer === 'memory'), 'The memory index points the model to saved knowledge.');
  add('prompt', 'Find your first prompt', firstPrompt, 'Your prompt tells the model what you want it to do.');
  const toolNames = new Set(blocks.filter(b => b.kind === 'tool_def').map(b => b.toolName));
  const loaded = session.events.find(e => e.type === 'tool_loaded' && !e.data?.afterLast && e.data?.names?.some(name => toolNames.has(name)));
  if (loaded) quests.push({ id: 'loaded', label: 'Find a tool loaded later', event: loaded, action: 'loaded', sentence: 'A newly loaded tool adds its definition to the context the model sees.' });
  const compaction = session.events.find(e => e.type === 'compaction' && !e.data?.afterLast);
  if (compaction) quests.push({ id: 'compact', label: 'Cross a compaction on the tape', event: compaction, action: 'cross', sentence: 'Compaction replaces earlier context with a shorter summary.' });
  add('biggest', 'Find the biggest building', biggest, 'The biggest building is the longest single block of context in this session.');
  if (blocks.length && session.requests.length) quests.push({ id: 'walk', label: 'Walk the sequence for 10 seconds', action: 'walk', sentence: 'The model receives these blocks in order, with earlier text still in context.' });
  const last = session.requests.at(-1);
  let toolTokens = 0;
  for (const id of last?.blockIds ?? []) if (session.blocks[id]?.kind === 'tool_def') toolTokens += session.blocks[id].estTokens;
  const total = last?.measuredTokens ?? last?.estTokens ?? 0;
  return { quests, biggest, toolShare: last?.estTokens ? toolTokens / last.estTokens * 100 : 0,
    windowShare: total / session.meta.window * 100, windowMeasured: last?.measuredTokens != null,
    peak: session.requests.reduce((max, r) => Math.max(max, r.measuredTokens ?? r.estTokens ?? 0), 0),
    compactions: session.events.filter(e => e.type === 'compaction' && !e.data?.afterLast).length,
    toolsLoaded: session.events.filter(e => e.type === 'tool_loaded' && !e.data?.afterLast).reduce((sum, e) => sum + (e.data?.names?.length ?? 0), 0) };
}
export function crossedEvents(events, previous, current) {
  return events.filter(e => !e.data?.afterLast && (current >= previous ? e.requestIdx > previous && e.requestIdx <= current : e.requestIdx >= current && e.requestIdx < previous));
}
