// All content is synthetic. Build headers here so image tests require no binaries.
export const shape = { type: 'api-request-shape', shapeHash: 's', shape: { system: ['Synthetic prefix'], tools: [] } };
export const request = (id, tail = [], extra = {}) => ({ type: 'api-request', id, shapeHash: 's', querySource: 'repl_main_thread', keep: 0, tail, ...extra });
export const user = (uuid, content, extra = {}) => ({ type: 'user', uuid, message: { role: 'user', content }, ...extra });
export const assistant = (uuid, id, content, parentUuid, extra = {}) => ({ type: 'assistant', uuid, parentUuid, message: { role: 'assistant', id, content, usage: { input_tokens: 100, cache_read_input_tokens: 200, cache_creation_input_tokens: 30, output_tokens: 4 } }, ...extra });
export const blob = (hash, role, content) => ({ type: 'api-request-blob', hash, message: { role, content } });
export const systemBlob = '# Environment\nSynthetic platform\n' + 'environment detail\n'.repeat(100)
  + 'The following deferred tools are available\n' + 'synthetic deferred name\n'.repeat(100)
  + 'Available agent types:\n' + 'synthetic agent\n'.repeat(100)
  + '# MCP Server Instructions\n' + 'synthetic MCP instruction\n'.repeat(100)
  + 'The following skills are available\n' + 'synthetic skill\n'.repeat(100);
export const memoryReminder = '<system-reminder>\nContents of /synthetic/CLAUDE.md (rules):\nSynthetic rules\n'
  + 'Contents of /synthetic/MEMORY.md (memory):\nSynthetic global index\n'
  + 'Contents of /synthetic/MEMORY.md (memory):\nSynthetic local index\n</system-reminder>';
const png = Buffer.alloc(33);
Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
png.writeUInt32BE(13, 8); png.write('IHDR', 12); png.writeUInt32BE(30, 16); png.writeUInt32BE(50, 20);
png[24] = 8; png[25] = 2;
// Valid IHDR CRC; only the header is needed by the parser.
let crc = 0xffffffff;
for (const b of png.subarray(12, 29)) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
png.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29);
export const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } };
export const custom = [shape, blob('p', 'user', 'Synthetic prompt'), request('a', ['p'], { querySource: 'repl_main_thread:outputStyle:custom' })];
export const sdk = [shape, request('sdk', [], { querySource: 'sdk' }), assistant('a', 'headless', [], null, { requestRef: 'sdk' })];
export const unmatched = [shape, blob('start', 'user', 'Synthetic first prompt'), request('a', ['start']),
  blob('call', 'assistant', [{ type: 'tool_use', id: 'c', name: 'SyntheticTool', input: {} }]),
  user('u1', [{ type: 'tool_result', tool_use_id: 'c', content: 'Synthetic result' }]),
  request('b', ['call', '1'.repeat(64)], { keep: 1 }),
  blob('answer', 'assistant', 'Synthetic answer'), user('u2', 'Synthetic second prompt'),
  request('c', ['answer', '2'.repeat(64)], { keep: 3 })];
export const wrappers = [shape,
  user('command', '<command-name>synthetic</command-name>'),
  user('local', '<local-command-stdout>Synthetic output</local-command-stdout>'),
  user('meta', 'Synthetic harness', { isMeta: true }), user('summary', 'Synthetic summary', { isCompactSummary: true }),
  request('a'), user('prompt1', 'Synthetic prompt one'), user('prompt2', 'Synthetic prompt two'), request('b'),
  { type: 'attachment', attachment: { type: 'deferred_tools_delta', addedNames: ['A'], surfacedNames: ['B', 'A'] } },
  { type: 'attachment', attachment: { type: 'deferred_tools_record', entries: [{ name: 'C' }, { name: 'D' }] } }];
export const recordsOnly = [user('u1', 'Synthetic first prompt', { parentUuid: null }),
  assistant('a1', 'm1', [{ type: 'text', text: 'Synthetic answer' }], 'u1'),
  assistant('a1b', 'm1', [{ type: 'thinking', thinking: 'Synthetic thought' }], 'a1'),
  user('u2', 'Synthetic second prompt', { parentUuid: 'a1b' }),
  assistant('a2', 'm2', [{ type: 'text', text: 'Synthetic second answer' }], 'u2'),
  { type: 'system', subtype: 'compact_boundary', uuid: 'compact', parentUuid: null, compactMetadata: { trigger: 'auto', preTokens: 330 } },
  user('summary', 'Synthetic compacted context', { parentUuid: 'compact', isCompactSummary: true }),
  assistant('a3', 'm3', [{ type: 'text', text: 'Synthetic final answer' }], 'summary'),
  { type: 'attachment', attachment: { type: 'skill_listing', names: ['SyntheticSkill'] } }];
