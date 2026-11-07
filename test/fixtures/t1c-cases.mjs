// Synthetic logging orders only; no transcript content.
export const shape = { type: 'api-request-shape', shapeHash: 's', shape: { system: ['Synthetic prefix'], tools: [] } };
export const request = (id, tail = [], extra = {}) => ({ type: 'api-request', id, querySource: 'repl_main_thread', shapeHash: 's', tail, keep: 0, ...extra });
export const user = (uuid, content, extra = {}) => ({ type: 'user', uuid, message: { role: 'user', content }, ...extra });
export const assistant = (uuid, id, content, parentUuid, extra = {}) => ({ type: 'assistant', uuid, parentUuid, message: { role: 'assistant', id, content }, ...extra });
export const blob = (hash, message) => ({ type: 'api-request-blob', hash, message });
export const call = id => ({ type: 'tool_use', id, name: 'SyntheticTool', input: {} });
export const result = id => ({ type: 'tool_result', tool_use_id: id, content: 'Synthetic result' });
export const mention = 'Synthetic core instructions mention deferred tools, available skills, available agents, working directory: and MCP instructions mid-text.';
export const interleaved = [
  user('u', 'Synthetic prompt', { parentUuid: null }),
  assistant('a1', 'm1', [call('t1')], 'u', { apiBlockIndex: 0 }),
  user('r1', [result('t1')], { parentUuid: 'a1' }),
  assistant('a2', 'm1', [call('t2')], 'r1', { apiBlockIndex: 1 }),
  user('r2', [result('t2')], { parentUuid: 'a2' }),
  assistant('a3', 'm2', [], 'r2'),
];
