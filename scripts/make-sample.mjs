import { mkdir, writeFile } from 'node:fs/promises';
import { TOOLS, CONTEXT, STEPS } from './sample-data.mjs';

const estTokens = text => Math.ceil(text.length / 4);
const blocks = {}, requests = [], events = [];
function add(kind, layer, label, text, extra = {}) {
  const id = `sample:${Object.keys(blocks).length}`;
  blocks[id] = { id, kind, layer, label, text, chars: text.length,
    estTokens: estTokens(text), provenance: 'reconstructed',
    note: 'Invented example text for the fictional Lantern demonstration.',
    role: kind === 'tool_def' ? null : layer === 'system' ? 'system' : 'user',
    toolName: null, ...extra };
  return id;
}
function definition(tool) {
  const schema = JSON.stringify({ name: tool.name, ...(tool.server ? { server: tool.server } : {}), parameters: tool.params }, null, 2);
  const schemaText = `\n\n${schema}`;
  const descTokens = estTokens(tool.description), schemaTokens = estTokens(schemaText);
  return add('tool_def', tool.server === 'issues' ? 'mcp' : 'tools', tool.name, tool.description + schemaText, {
    toolName: tool.name, params: tool.params, split: { descTokens, schemaTokens },
    estTokens: descTokens + schemaTokens,
  });
}
const tools = TOOLS.filter(t => t.server !== 'issues').map(definition);
const systems = [], messages = [];
for (const [layer, label, text] of CONTEXT) {
  const id = add(layer === 'message' ? 'user_text' : layer === 'system' ? 'system' : 'reminder',
    layer === 'user' ? 'user_instructions' : layer, label, text);
  (layer === 'system' ? systems : messages).push(id);
}
// Everything except the initial conversation is a persistent prefix.
const conversationStart = messages.findIndex(id => blocks[id].kind === 'user_text');
const prefix = messages.splice(0, conversationStart);
const ts = idx => `2030-04-12T09:${String(idx).padStart(2, '0')}:00.000Z`;
function request(measuredTokens) {
  const idx = requests.length, blockIds = [...tools, ...systems, ...prefix, ...messages];
  const previous = requests.at(-1)?.blockIds ?? [], seen = new Set(previous);
  let newFrom = 0;
  while (newFrom < previous.length && previous[newFrom] === blockIds[newFrom]) newFrom++;
  requests.push({ idx, ts: ts(idx), blockIds,
    newBlockIds: blockIds.filter(id => !seen.has(id)), newFrom,
    usage: { input: measuredTokens % 1000, cacheRead: Math.floor(measuredTokens / 1000) * 1000,
      cacheWrite: 0, output: 280 + idx * 7 }, measuredTokens,
    estTokens: blockIds.reduce((sum, id) => sum + blocks[id].estTokens, 0) });
}
function event(type, label, data = {}) {
  events.push({ type, label, data, requestIdx: requests.length, ts: ts(requests.length) });
}
function say(kind, text, label = kind) {
  const role = kind === 'user_text' ? 'user' : 'assistant';
  const id = add(kind, role === 'user' ? 'message' : 'assistant', label, text, { role });
  messages.push(id);
  return id;
}
function call(name, params) {
  const toolUseId = `call-${requests.length}`;
  messages.push(add('tool_use', 'tool_call', name, JSON.stringify({ name, input: params }),
    { role: 'assistant', toolName: name, toolUseId }));
  return toolUseId;
}
function result(name, toolUseId, text) {
  const id = add('tool_result', 'results', `${name} result`, text,
    { role: 'user', toolName: name, toolUseId });
  messages.push(id);
  return id;
}
// Bounded, deterministic fictional diagnostic rows: never inflate token counters
// with missing text. Each large reply is stored once and referenced by id.
function longReply({ generated, batch }) {
  const rows = [`Fictional Lantern ${generated} batch ${batch}; expanded output follows.`];
  let length = rows[0].length;
  for (let row = 1; ; row++) {
    const choice = ['bright', 'dim', 'device'][row % 3];
    const line = generated === 'dependencies'
      ? `branch ${batch}.${row} lantern-check-helper-${row}: revision 2.${row % 17}; uses choice-cell, preview-node, focus-ring; scope settings; resolved in fictional dependency graph; shared with reload checks.`
      : generated === 'failure'
        ? `FAIL case ${batch}.${row} checks/remember-choice.check.js:${row}: theme=${choice}; expected restored choice ${choice}; received device; scenario reload after navigation; trace restoreChoice -> preferenceCell -> appearancePanel; check fixture needs persistent store.`
        : `PASS case ${batch}.${row} checks/remember-choice.check.js:${row}: theme=${choice}; restored ${choice}; navigation retains selection; invalid values use device; blocked storage keeps visit state; focus label present; device preference listener cleaned up.`;
    if (length + line.length + 1 > 56500) break;
    rows.push(line); length += line.length + 1;
  }
  rows.push(generated === 'failure' ? 'Batch failed: storage fixture does not preserve choice. Exit value: 1.'
    : 'Batch complete. Exit value: 0.');
  return rows.join('\n');
}
event('user_prompt', 'Add the theme selector');
request(10000);
let latestLarge;
for (let i = 0; i < STEPS.length; i++) {
  const [name, params, reply, reflection] = STEPS[i];
  if (i === 7) {
    say('user_text', 'Also make it remember the choice.', 'Remember the choice');
    event('user_prompt', 'Remember the choice');
  }
  if (i === 9) {
    tools.push(...TOOLS.filter(t => t.server === 'issues').map(definition));
    prefix.push(add('reminder', 'mcp', 'Issues server guidance',
      'The fictional issues server holds exercise work items. List items to read acceptance notes; comments describe observed checks and never change item state.'));
    event('tool_loaded', 'Issues tools arrive', { names: ['issues_list', 'issues_comment'] });
    event('mcp_instructions', 'Issues server guidance');
  }
  if (i === 11) {
    say('assistant_text', 'The stored value should be validated, and blocked storage should keep the current visit working. Shall I include those checks?');
    say('user_text', 'yes, go ahead', 'Proceed with edge cases');
    event('user_prompt', 'Proceed with edge cases');
    result('edit_file', call('edit_file', {
      document_file: 'checks/remember-choice.check.js', matching_passage: 'freshStoreOnReload()',
      replacement_passage: 'retainStoreOnReload()',
    }), 'revision t2: reload fixture now retains the test store; blocked-storage cases still use an isolated unavailable store.');
  }
  if (i === 13) {
    prefix.push(add('reminder', 'menus', 'Deferred tools refreshed', 'Deferred fictional reference tools: notes_search, notes_create. Issues tools are now loaded.'));
    event('deferred_tools', 'Deferred reference menu refreshed', { names: ['notes_search', 'notes_create'] });
  }
  if (i === 15) {
    prefix.push(add('reminder', 'menus', 'Skill recipes refreshed', 'Available fictional recipes: theme-preview, keyboard-tour. Run both after the reload checks pass.'));
    event('skill_listing', 'Preview and keyboard recipes');
  }
  say('thinking', `Step ${i + 1}: ${reflection}`);
  const use = call(name, params);
  const id = result(name, use, typeof reply === 'string' ? reply : longReply(reply));
  if (typeof reply !== 'string') latestLarge = messages.slice(-2);
  say('assistant_text', reflection);
  // Measured growth follows the actual generated text, with a gradually rising
  // fictional tokenizer ratio. The final pre-compaction request is 402K.
  const estimated = [...tools, ...systems, ...prefix, ...messages].reduce((sum, id) => sum + blocks[id].estTokens, 0);
  request(i === STEPS.length - 1 ? 402000 : Math.max(requests.at(-1).measuredTokens + 100, Math.round(estimated * (1 + i * 0.04))));
}
// Retain only the newest exchange beside the reconstructed summary and prefix.
event('compaction', 'Automatic context compaction', { trigger: 'auto', preTokens: 402000, postTokens: 38000 });
messages.length = 0;
say('user_text', 'Fictional summary: Add a labelled bright/dim/device selector to Lantern. Shared state retains the choice during navigation. The user also requested remembering it across visits and approved invalid-value and blocked-storage checks. The selector and rememberedChoice helper are edited. Early matrix failures came from a storage fixture that reset on reload; later batches passed after it was corrected. No dependencies were added. Issues tools are loaded. Remaining work: inspect the work item, run the final focused checks, review focus styling, and report the result.', 'Compacted session summary');
messages.push(...latestLarge);
request(38000);
const finish = [
  ['issues_list', { board_key: 'lantern-example', page_size: 2 }, 'LANTERN-7 active: selector must retain valid choices after reload, follow device mode, and keep keyboard focus visible.'],
  ['read_file', { target_file: 'checks/remember-choice.check.js' }, 'check("restore valid choice", reloadWith("dim"), "dim");\ncheck("reject unknown choice", reloadWith("other"), "device");\ncheck("blocked storage", visitWithoutStore(), "device");'],
  ['edit_file', { document_file: 'components/appearance.css', matching_passage: 'outline: none;', replacement_passage: 'outline: 2px solid currentColor; outline-offset: 3px;' }, 'revision c2: visible focus outline in both bright and dim preview checks.'],
  ['run_command', { shell_line: 'desk-check settings --focused --preview', working_folder: '.' }, '12 checks passed: selection, navigation, reload, invalid value, blocked storage, device changes, listener cleanup, label, keyboard movement, bright focus, dim focus, decorative swatch. Exit value: 0.'],
  ['run_command', { shell_line: 'desk-check changes --summary', working_folder: '.' }, 'Changed appearance.js, preferences.js, appearance.css, remember-choice.check.js. No dependency changes. Exit value: 0.'],
];
for (const [name, params, reply] of finish) {
  say('thinking', 'Finish the remaining acceptance checks using the retained summary.');
  result(name, call(name, params), reply);
  request(38000 + (requests.length - 21) * 420);
}
say('assistant_text', 'Added the Theme selector with bright, dim, and device choices. The choice survives navigation and reload; invalid saved values fall back to device, and unavailable storage keeps the current visit working. Added a visible keyboard focus outline. All 12 focused checks passed, with no new dependencies.', 'Theme selector complete');
request(40500);
const session = { meta: { sessionId: 'fictional-lantern-sample', sourceName: 'fresh-session.json', model: 'Lantern Demo',
  cliVersion: null, startedAt: ts(0), endedAt: ts(requests.length - 1), window: 1000000, autocompactAt: null,
  sample: true, skippedLines: 0, ignoredRecords: 0, sidechainRequests: 0, source: 'requests', emptyReason: null },
  blocks, requests, events };
await mkdir(new URL('../sample/', import.meta.url), { recursive: true });
await writeFile(new URL('../sample/fresh-session.json', import.meta.url), JSON.stringify(session, null, 2) + '\n');
console.log(`Sample: ${requests.length} requests, ${Object.keys(blocks).length} blocks, ${events.length} events`);
