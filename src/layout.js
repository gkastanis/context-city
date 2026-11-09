// Road length is linear; height is a bounded square-root encoding of tokens.
export const HEIGHTS = Object.freeze({ system: 44, tool_def: 48, user_text: 44,
  reminder: 42, assistant_text: 44, thinking: 40, tool_use: 42, tool_result: 42, attachment: 40 });
const districtNames = { system: 'System prompt', tools: 'Tool definitions',
  user_instructions: 'CLAUDE.md', memory: 'Memory', menus: 'Menus', harness: 'Session facts',
  message: 'User prompt', assistant: 'Assistant', tool_call: 'Tool calls', results: 'Results', mcp: 'MCP' };

export function layoutRequest(session, requestIdx, opts = {}) {
  const request = session.requests[requestIdx];
  if (!request) throw new RangeError(`Unknown request: ${requestIdx}`);
  const blocks = request.blockIds.map(id => {
    if (!session.blocks[id]) throw new Error(`Missing block: ${id}`);
    return session.blocks[id];
  });
  const estimated = blocks.reduce((sum, b) => sum + b.estTokens, 0);
  const measured = request.measuredTokens != null;
  const totalTokens = measured ? request.measuredTokens : estimated;
  if (!Number.isFinite(totalTokens) || totalTokens < 0 || blocks.some(b => !Number.isFinite(b.estTokens) || b.estTokens < 0)) {
    throw new TypeError('Token counts must be finite and nonnegative');
  }
  // No relative weights are known: distribute the measured total evenly.
  const equalTokens = measured && !estimated && blocks.length ? totalTokens / blocks.length : null;
  const scale = measured && estimated ? totalTokens / estimated : 1;
  const fresh = new Set(request.newBlockIds);
  const items = [], districts = [];
  let token = 0, turn = 0, conversation = false;
  for (const b of blocks) {
    const z0 = token * 0.01;
    token += equalTokens ?? b.estTokens * scale;
    const item = { blockId: b.id, z0, z1: token * 0.01, layer: b.layer,
      kind: b.kind, ...(b.isError ? { isError: true } : {}), height: Math.min(220, (HEIGHTS[b.kind] ?? 5) + Math.sqrt(equalTokens ?? b.estTokens * scale) * .85), label: b.label, split: b.split, paramCount: b.params?.length ?? 0, isNew: requestIdx > 0 && fresh.has(b.id) };
    items.push(item);
    // A user prompt begins a conversation turn. Preserve the request's actual
    // order, including reminders and results that occur between messages.
    const newTurn = b.kind === 'user_text' && b.role === 'user';
    if (newTurn) { turn++; conversation = true; }
    const key = conversation ? `turn:${turn}` : `layer:${b.layer}`;
    let district = districts.at(-1);
    if (!district || district._key !== key) {
      district = { label: conversation ? `Turn ${turn}` : (districtNames[b.layer] ?? b.layer),
        layer: b.layer, z0, z1: item.z1, blockIds: [], _key: key };
      districts.push(district);
    }
    district.z1 = item.z1;
    district.blockIds.push(b.id);
  }
  // Avoid accumulated floating point error at the final boundary.
  if (items.length) { items.at(-1).z1 = totalTokens * 0.01; districts.at(-1).z1 = totalTokens * 0.01; }
  for (const d of districts) delete d._key;
  void opts; // Reserved for future pure layout options; token scale is fixed.
  return { items, districts, totalTokens, measured };
}
