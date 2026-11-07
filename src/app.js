import { el, button } from './ui/dom.js';
import { parseFile } from './ui/loader.js';
import { createTimeline } from './ui/timeline.js';
import { createReaderPane } from './ui/reader.js';
import { createContextIndex } from './ui/context-index.js';
import { createHelp } from './ui/help.js';
import { layoutRequest } from './layout.js';
import { createRequestScheduler } from './ui/request-scheduler.js';
import { createGame } from './ui/game.js';
import { findBlockRequest, expandSession } from './ui/compact.js';
import { gauge, formatTokens, limitOf } from './ui/math.js';

const app = document.getElementById('app');
app.replaceChildren();
const narrow = matchMedia('(max-width: 760px)');
let session = null, scene = null, requestIdx = 0, lastSettled = -1, selected = null, activeLoad = null;
let sceneReady = false, loadGeneration = 0, reading = 'stopped';
let layout = null, itemById = new Map();
const call = (method, ...args) => {
  try { if (typeof scene?.[method] === 'function') return scene[method](...args); } catch (error) { status.textContent = `Unable to navigate: ${error.message}`; }
};
const status = el('p', { id: 'status', role: 'status' }, 'Loading example session.');
const info = el('p', { id: 'session-info' });
const notice = el('p', { id: 'session-notice' });
const redactedNotice = el('p', { id: 'redacted-notice', hidden: true });
const quiet = el('p', { id: 'session-details', class: 'muted' });
const fileInput = el('input', { id: 'transcript-file', type: 'file', accept: '.jsonl,.json', hidden: true,
  onchange: () => { const file = fileInput.files[0]; if (file) loadFile(file); fileInput.value = ''; } });
const progress = el('progress', { id: 'load-progress', max: 1, value: 0, 'aria-label': 'Transcript loading progress' });
const progressName = el('span', { id: 'load-name' });
const loading = el('div', { id: 'loading', hidden: true }, progressName, progress,
  button('Cancel', () => { loadGeneration++; activeLoad?.cancel(); activeLoad = null; loading.hidden = true; status.textContent = 'Loading cancelled. The current session is unchanged.'; }, { id: 'cancel-load' }));
const stage = el('div', { id: 'stage', 'aria-label': '3D context city' });
const sceneStatus = el('p', { id: 'scene-status' }, 'Loading the 3D library.');
const help = createHelp();
const enter = id => { game.enter(id); call('enterBlock', id); };
const reader = createReaderPane(enter);
const index = createContextIndex({ fly: id => { select(id); call('flyToBlock', id); },
  enter: id => { select(id); enter(id); }, filter: (layer, visible) => call('setLayerVisible', layer, visible) });
const timeline = createTimeline(jump);
let pendingEvents = [];
const game = createGame({ call, jump, queueEvent: event => pendingEvents.push(event), locate(id) {
  const idx = findBlockRequest(session, id);
  if (idx >= 0) { jump(idx, true); select(id); call('flyToBlock', id); }
} });
const statValues = Array.from({ length: 4 }, () => el('b'));
const stats = el('div', { class: 'stats', 'aria-label': 'Session numbers' }, ...['Context now', 'Of the window', 'Room left', 'Requests'].map((label, i) => el('div', { class: 'stat' }, statValues[i], el('span', {}, label))));
const workspace = el('main', { id: 'workspace' }, index.root,
  el('section', { id: 'city', 'aria-label': 'City view' }, stage, sceneStatus), reader.root);
function panelToggle(label, target, cls) {
  const toggle = button(label, () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open)); app.classList.toggle(cls, !open);
    if (narrow.matches && open && target !== 'timeline') {
      for (const [other, hide] of [['reader-panel', 'hide-reader'], ['index-panel', 'hide-index'], ['field-guide', 'hide-guide']]) {
        if (other === target) continue;
        document.querySelector(`[aria-controls="${other}"]`)?.setAttribute('aria-expanded', 'false'); app.classList.add(hide);
      }
    }
  }, { 'aria-controls': target, 'aria-expanded': 'false' });
  return toggle;
}
const pause = button('Pause', () => {
  if (reading === 'paused') { call('resumeReading'); reading = 'playing'; }
  else { call('pauseReading'); reading = 'paused'; }
  updateReading();
}, { id: 'pause-reading', disabled: true });
const start = button('Start', () => { call('startReading'); }, { id: 'start-reading' });
const stop = button('Stop', () => call('stopReading'), { id: 'stop-reading', disabled: true });
const speed = el('input', { type: 'range', id: 'reading-speed', min: 50, max: 2000, step: 10, value: 220,
  oninput: () => { speedLabel.textContent = `${speed.value} tokens/s`; call('setReadingSpeed', Number(speed.value)); } });
const speedLabel = el('output', { for: 'reading-speed' }, '220 tokens/s');
const exampleChooser = el('dialog', { id: 'example-chooser', 'aria-labelledby': 'example-title' },
  el('div', { class: 'help-heading' }, el('h2', { id: 'example-title' }, 'Choose an example'), button('Close', () => exampleChooser.close())),
  ...[
    ['Invented example: Lantern settings page', 'A short invented session with readable text and illustrative token counts.'],
    ['A real session, redacted: the session that built this page', '224 requests, one compaction and real tool loads, with 8 approved prompts.'],
  ].map(([label, line], i) => el('section', {}, button(label, () => { exampleChooser.close(); loadExample(i); }, { id: `example-${i}` }), el('p', { class: 'muted' }, line))));
const mode = el('span', { id: 'mode-label' }, 'City');
app.append(el('header', { class: 'card topbar' }, el('div', { class: 'identity' }, el('h1', {}, 'CONTEXT CITY'), el('p', { class: 'subtitle' }, 'Explore the world inside a context window.'), stats, info),
  el('nav', { 'aria-label': 'Session controls' }, button('Load your session', () => fileInput.click(), { class: 'primary', id: 'load-transcript' }),
    button('Load example', () => exampleChooser.showModal(), { id: 'load-example' }), button('Help and privacy', () => help.open(), { id: 'help' })), fileInput),
  el('div', { class: 'session-messages' }, notice, quiet, status, loading),
  el('nav', { class: 'viewbar', 'aria-label': 'View controls' }, panelToggle('Index', 'index-panel', 'hide-index'),
    panelToggle('Reader', 'reader-panel', 'hide-reader'), panelToggle('Field guide 0 of 9', 'field-guide', 'hide-guide'), button('Run summary', () => game.summary()), button('Guess', () => game.toggleGuess()), mode),
  exampleChooser, workspace, game.guide, game.guess, game.intro, game.toast, game.summaryDialog,
  el('section', { class: 'card walk-controls', 'aria-label': 'Walk the sequence' }, el('strong', {}, 'Walk the sequence'), start, pause, stop,
    el('label', { for: 'reading-speed' }, 'Speed'), speed, speedLabel), timeline.root, help.root);
const compactContext = el('span', { id: 'compact-context' });
const titleToggle = button('CONTEXT CITY', () => {
  const open = titleToggle.getAttribute('aria-expanded') !== 'true';
  titleToggle.setAttribute('aria-expanded', String(open)); app.classList.toggle('show-numbers', open);
}, { id: 'title-toggle', 'aria-expanded': 'false', 'aria-label': 'Context City. Show session numbers' });
app.querySelector('.identity').prepend(titleToggle, compactContext);
const menu = el('div', { id: 'phone-menu' });
menu.append(app.querySelector('.topbar nav'), app.querySelector('.viewbar'));
const menuToggle = button('Menu', () => {
  const open = menuToggle.getAttribute('aria-expanded') !== 'true';
  menuToggle.setAttribute('aria-expanded', String(open)); app.classList.toggle('show-menu', open);
}, { id: 'menu-toggle', 'aria-controls': 'phone-menu', 'aria-expanded': 'false' });
app.append(menu, menuToggle);
const drop = el('div', { id: 'drop-overlay', hidden: true }, el('strong', {}, 'Drop a Claude Code transcript'), el('span', {}, '.jsonl or .json, read only in this tab'));
app.append(drop);
timeline.root.querySelector('.timeline-head').prepend(game.play, game.rate, game.pause, game.stop);
app.classList.add('hide-reader');
const tapeTools = el('div', { class: 'tape-tools' });
tapeTools.append(app.querySelector('.walk-controls'), el('div', { class: 'camera-controls', 'aria-label': 'Camera controls' }, button('Overview', () => call('overview')), button('Whole session', () => call('showWholeSession')), button('Full window', () => call('showFullWindow')), button('Exit inside', () => call('exitInside'))));
const tapeToggle = button('More', () => {
  const open = tapeToggle.getAttribute('aria-expanded') !== 'true';
  tapeToggle.setAttribute('aria-expanded', String(open)); app.classList.toggle('show-tape-tools', open);
}, { id: 'tape-toggle', 'aria-expanded': 'false', 'aria-controls': 'tape-tools' });
tapeTools.id = 'tape-tools';
timeline.root.append(tapeTools, tapeToggle);
app.querySelector('.identity').append(el('div', { class: 'session-meta' }, info, status), loading, notice, redactedNotice);
function applyPanelState() {
  app.classList.remove('show-menu', 'show-tape-tools', 'show-numbers');
  titleToggle.setAttribute('aria-expanded', 'false');
  app.classList.add('hide-reader', 'hide-index', 'hide-guide');
  for (const control of app.querySelectorAll('[aria-controls]')) control.setAttribute('aria-expanded','false');
}
function updateInsets() {
  const rect = stage.getBoundingClientRect();
  const title = app.querySelector('.identity').getBoundingClientRect();
  const tape = timeline.root.getBoundingClientRect();
  const panels = [reader.root, game.guide, game.guess].filter(n => !n.hidden && getComputedStyle(n).display !== 'none');
  const right = Math.max(0, ...panels.map(n => rect.right - n.getBoundingClientRect().left + 18));
  call('setViewInsets', narrow.matches
    ? { left: 12, right: 12, top: title.bottom + 20, bottom: Math.max(rect.bottom - tape.top, ...panels.map(n => rect.bottom - n.getBoundingClientRect().top)) + 12 }
    : { left: Math.max(title.right + 24, app.classList.contains('hide-index') ? 0 : 320), right: Math.max(24,right), top: 110, bottom: rect.bottom - tape.top + 18 });
}
const hudObserver = new ResizeObserver(updateInsets);
for (const n of [app.querySelector('.identity'), reader.root, index.root, game.guide, game.guess, timeline.root]) hudObserver.observe(n);
new MutationObserver(updateInsets).observe(app, { attributes: true, attributeFilter: ['class'] });
new MutationObserver(updateInsets).observe(game.guess, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true });
new MutationObserver(() => {
  const control = app.querySelector('[aria-controls="field-guide"]');
  control.textContent = `Field guide ${game.guide.querySelector('#quest-progress').textContent.replace(' found','')}`;
}).observe(game.guide.querySelector('#quest-progress'), { childList: true });

applyPanelState();
narrow.addEventListener('change', applyPanelState);

function updateReading() {
  pause.textContent = reading === 'paused' ? 'Resume' : 'Pause';
  pause.disabled = reading === 'stopped'; stop.disabled = reading === 'stopped';
  start.disabled = !sceneReady || !session?.requests.length || reading !== 'stopped';
}
function tokens(id) { const item = itemById.get(id); return item ? (item.z1 - item.z0) * 100 : session?.blocks[id]?.estTokens ?? 0; }
function select(id, hover = false, reveal = true) {
  if (!session) return;
  index.highlight(id, hover);
  if (hover) return;
  selected = id;
  if (id && reveal) {
    game.select(id);
    app.classList.remove('hide-reader');
    document.querySelector('[aria-controls="reader-panel"]').setAttribute('aria-expanded', 'true');
    if (narrow.matches) { app.classList.add('hide-index', 'hide-guide');
      for (const target of ['index-panel', 'field-guide']) document.querySelector(`[aria-controls="${target}"]`).setAttribute('aria-expanded', 'false'); }
  }
  const shown = selected;
  reader.show(session.blocks[shown] ?? null, tokens(shown));
}
function renderIndex() {
  if (!layout) return;
  index.render(session, layout); index.highlight(selected);
}
const sceneRequests = createRequestScheduler(async idx => {
  await call('setRequest', idx);
  const ready = pendingEvents.filter(event => event.requestIdx <= idx);
  pendingEvents = pendingEvents.filter(event => event.requestIdx > idx);
  for (const event of ready) call('playEvent', event);
});
function settleIndex() {
  if (!session?.requests.length) return;
  layout = layoutRequest(session, requestIdx);
  itemById = new Map(layout.items.map(item => [item.blockId, item]));
  if (!itemById.has(selected)) selected = null;
  renderIndex(); select(selected, false, false);
}
function jump(value, settled = false) {
  if (!session?.requests.length) return;
  const idx = Math.max(0, Math.min(session.requests.length - 1, value));
  const changed = idx !== requestIdx;
  if (idx < requestIdx) pendingEvents = [];
  requestIdx = idx;
  timeline.update(idx);
  const g = gauge(session.requests[idx], session.meta);
  statValues[0].textContent = formatTokens(g.total);
  compactContext.textContent = `${formatTokens(g.total)} context now`;
  statValues[0].title = g.measured ? 'Measured tokens' : 'Estimated tokens';
  statValues[1].textContent = `${(g.total / session.meta.window * 100).toFixed(1)}%`;
  const limit = limitOf(session.meta);
  statValues[2].textContent = formatTokens(Math.max(0, limit - g.total));
  statValues[3].textContent = String(session.requests.length);
  stats.classList.toggle('near-compact', g.total >= limit * .85);
  stats.classList.toggle('at-compact', g.total >= limit);
  call('setAtmosphere', { fill: g.total / limit });
  game.update(idx);
  if (changed || settled) sceneRequests.request(idx, settled);
  // pointerup and change both settle the same value; rebuild the index once.
  if (settled && idx !== lastSettled) { lastSettled = idx; settleIndex(); }
}
function setSession(value) {
  sceneRequests.reset(); pendingEvents = []; reader.reset(value.meta.redacted === true); lastSettled = -1;
  layout = null; itemById.clear(); index.reset(); selected = null;
  session = value; requestIdx = 0; reading = 'stopped';
  const meta = session.meta;
  redactedNotice.hidden = !meta.redacted;
  redactedNotice.textContent = meta.redacted ? "Real session, text redacted before publishing. Shapes, sizes, order, timing and tool loads are real; only 8 of the owner's prompts are readable." : '';
  info.textContent = `${meta.sample ? 'Example session · ' : ''}${meta.sourceName || 'Session'} · ${meta.model || 'Model unknown'} · ${meta.startedAt?.slice(0, 10) || 'Date unknown'}${meta.endedAt ? ' to ' + meta.endedAt.slice(0, 10) : ''} · ${session.requests.length} ${session.requests.length === 1 ? 'request' : 'requests'}`;
  notice.textContent = meta.source === 'records'
    ? 'This transcript has no request snapshots (older Claude Code). The prefix shows as one block with unknown text.'
    : meta.source === 'empty' ? `${meta.emptyReason}. Try a main Claude Code session transcript with API requests or assistant records.` : '';
  notice.hidden = !notice.textContent;
  info.title = `${meta.skippedLines || 0} skipped lines · ${meta.sidechainRequests || 0} subagent requests not shown`;
  game.setSession(session);
  timeline.setSession(session); timeline.update(0); call('setSession', session);
  if (session.requests.length) { jump(0, true); if (sceneReady) game.startIntro(); }
  else {
    index.root.querySelector('#context-districts').replaceChildren(); reader.show(null);
    ['0', '0.0%', formatTokens(limitOf(meta)), '0'].forEach((text, i) => { statValues[i].textContent = text; });
    stats.classList.remove('near-compact'); call('setAtmosphere', { fill: 0 });
  }
  updateReading(); status.textContent = meta.sample ? 'Example session ready.' : 'Transcript ready. File read in this tab.';
}
async function loadFile(file) {
  if (!/\.(jsonl|json)$/i.test(file.name)) { status.textContent = 'Choose a .jsonl or .json transcript file.'; return; }
  const generation = ++loadGeneration; activeLoad?.cancel();
  status.textContent = file.size > 300 * 1024 * 1024 ? 'This file is over 300 MB. Parsing may take time and use substantial memory. You can cancel.' : 'Reading transcript in this tab.';
  loading.hidden = false; progress.value = 0; progressName.textContent = file.name;
  activeLoad = parseFile(file, (bytes, total) => { if (generation === loadGeneration) progress.value = total ? bytes / total : 0; });
  try { const result = await activeLoad.promise; if (generation === loadGeneration) setSession(result); }
  catch (error) { if (generation === loadGeneration) status.textContent = error.name === 'AbortError' ? 'Loading cancelled.' : `Unable to read transcript: ${error.message}`; }
  finally { if (generation === loadGeneration) { activeLoad = null; loading.hidden = true; } }
}
// The builder replaces this sentinel with data, not another retained Session.
const exampleData = null; /* SAMPLE_DATA */
async function loadExample(which = 0) {
  const generation = ++loadGeneration; activeLoad?.cancel(); activeLoad = null; loading.hidden = true;
  try {
    let value;
    if (exampleData != null) value = expandSession(JSON.parse(exampleData[which]), 8);
    else {
      const response = await fetch(new URL(which === 1 ? '../sample/real-session-redacted.json' : '../sample/fresh-session.json', import.meta.url));
      if (!response.ok) throw new Error(`Example load failed (${response.status})`);
      value = await response.json();
    }
    if (generation === loadGeneration) setSession(value);
  } catch (error) { if (generation === loadGeneration) status.textContent = error.message; }
}
let dragDepth = 0;
const fileDrag = event => Array.from(event.dataTransfer?.types ?? []).includes('Files');
document.addEventListener('dragenter', event => { if (fileDrag(event)) { event.preventDefault(); dragDepth++; drop.hidden = false; } });
document.addEventListener('dragover', event => { if (fileDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; drop.hidden = false; } });
document.addEventListener('dragleave', event => { if (fileDrag(event) && --dragDepth <= 0) { dragDepth = 0; drop.hidden = true; } });
document.addEventListener('drop', event => {
  if (!fileDrag(event)) return;
  event.preventDefault(); dragDepth = 0; drop.hidden = true;
  const file = event.dataTransfer.files[0]; if (file) loadFile(file);
});
addEventListener('blur', () => { dragDepth = 0; drop.hidden = true; });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !help.root.open && !exampleChooser.open) {
    app.classList.remove('show-menu'); menuToggle.setAttribute('aria-expanded', 'false');
    game.skipIntro(); game.pausePlayback();
    if (scene?.getMode() === 'inside') call('exitInside');
    else if (scene?.getMode() === 'reading') call('stopReading');
  }
});
await loadExample();
try {
  const { createScene } = await import('./scene/index.js');
  scene = createScene(stage, {
    onSelect: id => select(id), onHover: id => select(id, true),
    onReadPosition: ({ blockId }) => { if (selected !== blockId) { select(blockId); index.reveal(blockId); } },
    onModeChange: (value, details) => {
      mode.textContent = value === 'reading' ? 'Walking the sequence' : value === 'inside' ? 'Inside a block' : 'City';
      game.mode(value, details);
      reading = value === 'reading' ? (details.paused ? 'paused' : 'playing') : 'stopped'; updateReading();
    },
    onError: error => { sceneStatus.hidden = false; sceneStatus.textContent = `3D view unavailable: ${String(error.message ?? error).replace(/[.\s]+$/, '')}. The index and reader remain available.`; },
  });
  sceneReady = true; sceneStatus.hidden = true; updateInsets();
  if (session) { scene.setSession(session); if (session.requests.length) scene.setRequest(requestIdx); }
  call('setAtmosphere', { fill: gauge(session?.requests[requestIdx], session.meta).total / limitOf(session.meta) });
  game.startIntro();
  scene.setReadingSpeed(Number(speed.value)); updateReading();
} catch (error) {
  const reason = String(error.message ?? error).replace(/[.\s]+$/, '');
  sceneStatus.textContent = `3D view unavailable: ${reason}. ` + (error.webglDisabled || /webgl/i.test(reason)
    ? 'Turn on hardware acceleration in your browser settings (in Chrome: Settings, System, Use graphics acceleration when available), then reload. chrome://gpu or about:support shows whether WebGL is blocked. Meanwhile the index and reader work without it.'
    : 'Use the index and reader to explore the transcript.');
  updateReading();
}
addEventListener('pagehide', () => { sceneRequests.reset(); activeLoad?.cancel(); hudObserver.disconnect(); game.dispose(); scene?.dispose(); });
