import { panelState, escapeAction } from './ui/overlay-state.js';
import { readDistrictPreference } from './ui/district-preference.js';
import { agentCalls, linkedRun, runLabel } from './ui/agents.js';
import { el, button } from './ui/dom.js';
import { parseFiles, droppedFiles } from './ui/loader.js';
import { createTimeline } from './ui/timeline.js';
import { createReaderPane } from './ui/reader.js';
import { createContextIndex } from './ui/context-index.js';
import { createHelp } from './ui/help.js';
import { layoutRequest } from './layout.js';
import { createRequestScheduler } from './ui/request-scheduler.js';
import { createGame } from './ui/game.js';
import { toolReport } from './ui/tools.js';
import { createToolsPanel } from './ui/tools-panel.js';
import { createFindingsPanel } from './ui/findings-panel.js';
import { findBlockRequest, expandSession } from './ui/compact.js';
import { gauge, formatTokens, limitOf, sessionCache } from './ui/math.js';

const app = document.getElementById('app');
app.replaceChildren();
const narrow = matchMedia('(max-width: 760px)');
let session = null, scene = null, requestIdx = 0, lastSettled = -1, selected = null, activeLoad = null;
let sceneReady = false, loadGeneration = 0, reading = 'stopped';
let layout = null, itemById = new Map();
let pendingFinding = null;
let bannerDismissed = false;
let openPanels = [];
let readerOpenedBy = 'nav';
const panelClasses = { 'index-panel': 'hide-index', 'reader-panel': 'hide-reader', 'field-guide': 'hide-guide' };
let mainSession = null, activeRun = null, mainPosition = 0, mainSelected = null, addMode = false;
const call = (method, ...args) => {
  try { if (typeof scene?.[method] === 'function') return scene[method](...args); } catch (error) { status.textContent = `Unable to navigate: ${error.message}`; }
};
const status = el('p', { id: 'status', role: 'status' }, 'Loading example session.');
const info = el('p', { id: 'session-info' });
const notice = el('p', { id: 'session-notice' });
const redactedNotice = el('p', { id: 'redacted-notice', hidden: true });
const quiet = el('p', { id: 'session-details', class: 'muted' });
const fileInput = el('input', { id: 'transcript-file', type: 'file', accept: '.jsonl,.json', multiple: true, hidden: true,
  onchange: () => { const files = Array.from(fileInput.files); if (files.length) loadFiles(files, addMode); addMode = false; fileInput.value = ''; } });
const folderInput = el('input', { id: 'session-folder', type: 'file', multiple: true, webkitdirectory: true, hidden: true,
  onchange: () => { const files = Array.from(folderInput.files); if (files.length) loadFiles(files, addMode); addMode = false; folderInput.value = ''; } });
fileInput.addEventListener('cancel', () => { addMode = false; });
folderInput.addEventListener('cancel', () => { addMode = false; });
const addPicker = el('dialog', { id: 'add-agents-picker', 'aria-label': 'Add subagent runs' },
  el('h2', {}, 'Include subagent runs'),
  button('Choose files', () => { addMode = true; addPicker.close(); fileInput.click(); }),
  button('Pick the project folder', () => { addMode = true; addPicker.close(); folderInput.click(); }),
  button('Cancel', () => addPicker.close()));
const agentBanner = el('div', { id: 'subagent-banner', hidden: true }, el('p'),
  button('Include subagent runs', () => addPicker.showModal()),
  button('Dismiss', () => { bannerDismissed = true; agentBanner.hidden = true; focusNavigation(); }));
const breadcrumbText = el('span');
const breadcrumb = el('div', { id: 'subagent-breadcrumb', hidden: true }, breadcrumbText,
  button('Back to main session', () => switchRun(null), { id: 'back-main' }));
const agentList = el('section', { id: 'subagents', hidden: true }, el('h2', {}, 'Subagents'));
const progress = el('progress', { id: 'load-progress', max: 1, value: 0, 'aria-label': 'Transcript loading progress' });
const progressName = el('span', { id: 'load-name' });
const loading = el('div', { id: 'loading', hidden: true }, progressName, progress,
  button('Cancel', () => { loadGeneration++; activeLoad?.cancel(); activeLoad = null; loading.hidden = true; status.textContent = 'Loading cancelled. The current session is unchanged.'; }, { id: 'cancel-load' }));
const stage = el('div', { id: 'stage', 'aria-label': '3D context city' });
const sceneStatus = el('p', { id: 'scene-status' }, 'Loading the 3D library.');
const help = createHelp();
const enter = id => { game.enter(id); call('enterBlock', id); };
const reader = createReaderPane(enter, { linked: block => linkedRun(session, block), openRun: switchRun,
  toolContext(block) {
    if (!block || !mainSession) return null;
    const report = toolReport(mainSession), agentId = activeRun?.agentId ?? null;
    const failure = report.failures.find(f=>f.agentId===agentId && (f.resultBlockIds.includes(block.id) || f.callBlockId===block.id));
    if (!failure) return null;
    const isCall=block.kind==='tool_use';
    return { failure, items: toolsPanel.scope(failure),
      related: isCall ? failure : failure.callBlockId ? {...failure, blockId: failure.callBlockId, requestIdx: failure.callRequestIdx} : null };
  }, navigateTool: navigate, stepTool: (delta, failure) => toolsPanel.step(delta, failure),
  backToList: () => toolsPanel.open('failures'),
});
const index = createContextIndex({ fly: id => { select(id); call('flyToBlock', id); },
  enter: id => { select(id); enter(id); }, filter: (layer, visible) => call('setLayerVisible', layer, visible) });
let districtPreference=readDistrictPreference();
const districtCheck=el('input',{id:'layer-subagents',type:'checkbox',checked:districtPreference,onchange:()=>{districtPreference=districtCheck.checked;call('setDistrictsVisible',districtPreference);}});
const districtLayer=el('label',{class:'layer-check',for:'layer-subagents',hidden:true},districtCheck,'Subagent districts');
index.root.querySelector('details').append(districtLayer);
index.root.querySelector('h2').after(agentList);
const timeline = createTimeline(jump, switchRun, (idx, agentId = activeRun?.agentId ?? null) => { const f=toolReport(mainSession).failures.find(f=>f.requestIdx===idx && f.agentId===agentId); if(f)toolsPanel.showFailure(f); });
let pendingEvents = [];
const game = createGame({ call, jump, summarySession: () => mainSession, showFindings: () => findingPanel.open(), queueEvent: event => pendingEvents.push(event), locate(id) {
  const idx = findBlockRequest(session, id);
  if (idx >= 0) { jump(idx, true); select(id); call('flyToBlock', id); }
} });
const findingPanel = createFindingsPanel({
  navigate,
  showFailures: f => toolsPanel.showFailure(f),
  onOpen() {
    toolsPanel.close(false);
    game.skipIntro(); app.classList.add('show-findings'); app.classList.remove('show-menu');
    document.getElementById('menu-toggle')?.setAttribute('aria-expanded', 'false');
    updateInsets();
  },
  onClose() { app.classList.remove('show-findings'); return narrow.matches ? document.getElementById('menu-toggle') : null; },
});
function navigate(finding) {
  game.skipIntro(); game.pausePlayback();
  if (narrow.matches && !toolsPanel.root.hidden) toolsPanel.close(false);
  const target = finding.agentId ? mainSession?.agents?.find(a => a.agentId === finding.agentId) : null;
  if ((target?.agentId ?? null) !== (activeRun?.agentId ?? null)) switchRun(target);
  pendingFinding = finding.blockId ? { idx: finding.requestIdx, id: finding.blockId } : null;
  jump(finding.requestIdx, true);
  // The request scheduler flies after its buildings have been uploaded.
  if (finding.blockId) select(finding.blockId);
}
const toolsPanel = createToolsPanel({ navigate,
  onFilterChange() { if (session && selected) reader.show(session.blocks[selected], tokens(selected)); },
  onOpen() {
    findingPanel.close(false); game.skipIntro(); game.pausePlayback(); closeMenu();
    for (const target of ['index-panel','field-guide','reader-panel']) setPanel(target,false);
    app.classList.add('show-tools'); updateInsets();
  },
  onClose() { app.classList.remove('show-tools'); return narrow.matches ? document.getElementById('menu-toggle') : null; },
});
const statValues = Array.from({ length: 4 }, () => el('b'));
const stats = el('div', { class: 'stats', 'aria-label': 'Session numbers' }, ...['Context now', 'Of the window', 'Room left', 'Requests'].map((label, i) => el('div', { class: 'stat' }, statValues[i], el('span', {}, label))));
const workspace = el('main', { id: 'workspace' }, index.root,
  el('section', { id: 'city', 'aria-label': 'City view' }, stage, sceneStatus), reader.root);
function focusNavigation(target) {
  (narrow.matches ? menuToggle : app.querySelector(`[aria-controls="${target}"]`) ?? document.getElementById('load-transcript')).focus({ preventScroll: true });
}
function closeMenu(restoreFocus = false) {
  app.classList.remove('show-menu'); menuToggle.setAttribute('aria-expanded', 'false');
  if (restoreFocus) menuToggle.focus({ preventScroll: true });
}
function setPanel(target, open, restoreFocus = false, openedBy = 'nav') {
  if (target === 'reader-panel' && open && (openedBy === 'nav' || !openPanels.includes(target))) readerOpenedBy = openedBy;
  openPanels = panelState(openPanels, target, open, narrow.matches);
  for (const [id, cls] of Object.entries(panelClasses)) {
    const shown = openPanels.includes(id);
    app.classList.toggle(cls, !shown);
    document.getElementById(id)?.classList.toggle('front-panel', id === openPanels[openPanels.length - 1]);
    app.querySelector(`[aria-controls="${id}"]`)?.setAttribute('aria-expanded', String(shown));
  }
  if (narrow.matches) closeMenu();
  if (restoreFocus) focusNavigation(target);
}
function panelToggle(label, target) {
  return button(label, () => {
    toolsPanel.close(false); findingPanel.close(false);
    const open = !openPanels.includes(target);
    setPanel(target, open);
    if (open) {
      const panel = document.getElementById(target);
      panel.scrollTop = 0;
      panel.querySelector('.panel-heading button').focus({ preventScroll: true });
    } else if (narrow.matches) focusNavigation(target);
  }, { 'aria-controls': target, 'aria-expanded': 'false' });
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
    ['A real session with subagents', 'A Claude Code session that built a feature on this repo with four helper agents. Shows the branch graph and the Metropolis view.'],
    ['A real session, redacted: the session that built this page', '224 requests, one compaction and real tool loads, with 8 approved prompts.'],
  ].map(([label, line], i) => el('section', {}, button(label, () => { exampleChooser.close(); loadExample(i); }, { id: `example-${i}` }), el('p', { class: 'muted' }, line))));
const mode = el('span', { id: 'mode-label' }, 'City');
app.append(el('header', { class: 'card topbar' }, el('div', { class: 'identity' }, el('h1', {}, 'CONTEXT CITY'), el('p', { class: 'subtitle' }, 'Explore the world inside a context window.'), stats, info),
  el('nav', { 'aria-label': 'Session controls' }, button('Load your session', () => { addMode = false; fileInput.click(); }, { class: 'primary', id: 'load-transcript' }),
    button('Pick the project folder', () => { addMode = false; folderInput.click(); }, { id: 'load-folder' }),
    button('Load example', () => exampleChooser.showModal(), { id: 'load-example' }), button('Help and privacy', () => help.open(), { id: 'help' })), fileInput, folderInput),
  el('div', { class: 'session-messages' }, notice, quiet, status, loading),
  el('nav', { class: 'viewbar', 'aria-label': 'View controls' }, panelToggle('Index', 'index-panel'),
    panelToggle('Reader', 'reader-panel'), panelToggle('Field guide 0 of 9', 'field-guide'), button('Run summary', () => game.summary()), findingPanel.toggle, toolsPanel.toggle, button('Guess', () => game.toggleGuess()), mode),
  exampleChooser, addPicker, breadcrumb, agentBanner, workspace, game.guide, game.guess, game.intro, game.toast, game.summaryDialog, findingPanel.root, toolsPanel.root,
  el('section', { class: 'card walk-controls', 'aria-label': 'Walk the sequence' }, el('strong', {}, 'Walk the sequence'), start, pause, stop,
    el('label', { for: 'reading-speed' }, 'Speed'), speed, speedLabel), timeline.root, help.root);
const compactContext = el('span', { id: 'compact-context' });
const titleToggle = button('CONTEXT CITY', () => {
  const open = titleToggle.getAttribute('aria-expanded') !== 'true';
  titleToggle.setAttribute('aria-expanded', String(open)); app.classList.toggle('show-numbers', open);
}, { id: 'title-toggle', 'aria-expanded': 'false', 'aria-label': 'Context City. Show session numbers' });
app.querySelector('.identity').prepend(titleToggle, compactContext);
const menu = el('div', { id: 'phone-menu' });
menu.append(el('div', { class: 'help-heading menu-heading' }, el('h2', {}, 'Menu'), button('Close', () => closeMenu(true), { 'aria-label': 'Close Menu' })), app.querySelector('.topbar nav'), app.querySelector('.viewbar'));
const menuToggle = button('Menu', () => {
  const open = menuToggle.getAttribute('aria-expanded') !== 'true';
  menuToggle.setAttribute('aria-expanded', String(open)); app.classList.toggle('show-menu', open);
}, { id: 'menu-toggle', 'aria-controls': 'phone-menu', 'aria-expanded': 'false' });
app.append(menu, menuToggle);
for (const [panel, name] of [[index.root, 'Index'], [reader.root, 'Reader'], [game.guide, 'Field guide']]) {
  const title = panel.querySelector('h2');
  const heading = el('div', { class: 'help-heading panel-heading' }, title,
    button('Close', () => setPanel(panel.id, false, true), { 'aria-label': `Close ${name}` }));
  panel.prepend(heading);
}
// A dismissed card must not leave keyboard focus in hidden content.
new MutationObserver(() => {
  if (game.guess.hidden && game.guess.contains(document.activeElement)) focusNavigation();
}).observe(game.guess, { attributes: true, attributeFilter: ['hidden'] });
const drop = el('div', { id: 'drop-overlay', hidden: true }, el('strong', {}, 'Drop a Claude Code transcript'), el('span', {}, '.jsonl or .json, read only in this tab'));
app.append(drop);
timeline.root.querySelector('.timeline-head').prepend(game.play, game.rate, game.pause, game.stop);
app.classList.add('hide-reader');
const tapeTools = el('div', { class: 'tape-tools' });
const metropolisButton=button('Metropolis',()=>call('showMetropolis'),{hidden:true});
tapeTools.append(app.querySelector('.walk-controls'), el('div', { class: 'camera-controls', 'aria-label': 'Camera controls' }, button('Overview', () => call('overview')), metropolisButton, button('Whole session', () => call('showWholeSession')), button('Full window', () => call('showFullWindow')), button('Exit inside', () => call('exitInside'))));
const tapeToggle = button('More', () => {
  const open = tapeToggle.getAttribute('aria-expanded') !== 'true';
  tapeToggle.setAttribute('aria-expanded', String(open)); app.classList.toggle('show-tape-tools', open);
}, { id: 'tape-toggle', 'aria-expanded': 'false', 'aria-controls': 'tape-tools' });
tapeTools.id = 'tape-tools';
timeline.root.append(tapeTools, tapeToggle);
app.querySelector('.identity').append(el('div', { class: 'session-meta' }, info, status), loading, notice, redactedNotice);
function applyPanelState() {
  openPanels = [];
  app.classList.remove('show-menu', 'show-tape-tools', 'show-numbers');
  titleToggle.setAttribute('aria-expanded', 'false');
  app.classList.add('hide-reader', 'hide-index', 'hide-guide');
  for (const control of app.querySelectorAll('[aria-controls]')) control.setAttribute('aria-expanded','false');
  findingPanel.toggle.setAttribute('aria-expanded',String(!findingPanel.root.hidden));
  toolsPanel.toggle.setAttribute('aria-expanded',String(!toolsPanel.root.hidden));
}
function updateInsets() {
  const rect = stage.getBoundingClientRect();
  const title = app.querySelector('.identity').getBoundingClientRect();
  const tape = timeline.root.getBoundingClientRect();
  const stripBottom = Math.max(80, ...[breadcrumb, agentBanner].filter(n => !n.hidden).map(n => n.getBoundingClientRect().bottom + 12));
  app.style.setProperty('--run-content-top', `${stripBottom}px`);
  app.style.setProperty('--findings-bottom', `${rect.bottom - tape.top + 12}px`);
  const panels = [reader.root, game.guide, game.guess, findingPanel.root, toolsPanel.root].filter(n => !n.hidden && getComputedStyle(n).display !== 'none');
  const right = Math.max(0, ...panels.map(n => rect.right - n.getBoundingClientRect().left + 18));
  call('setViewInsets', narrow.matches
    ? { left: 12, right: 12, top: title.bottom + 20, bottom: Math.max(rect.bottom - tape.top, ...panels.map(n => rect.bottom - n.getBoundingClientRect().top)) + 12 }
    : { left: Math.max(title.right + 24, app.classList.contains('hide-index') ? 0 : 320), right: Math.max(24,right), top: 110, bottom: rect.bottom - tape.top + 18 });
}
const hudObserver = new ResizeObserver(updateInsets);
for (const n of [app.querySelector('.identity'), reader.root, index.root, game.guide, game.guess, timeline.root, findingPanel.root, toolsPanel.root, breadcrumb, agentBanner]) hudObserver.observe(n);
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
  toolsPanel.sync(id,activeRun?.agentId ?? null);
  if (id && reveal) {
    game.select(id);
    setPanel('reader-panel', true, false, 'select');
  }
  const shown = selected;
  reader.show(session.blocks[shown] ?? null, tokens(shown));
}
function clearSelection() {
  select(null);
  call('select', null);
}
function backgroundClick() {
  clearSelection();
  if (readerOpenedBy === 'select') setPanel('reader-panel', false);
}
function renderIndex() {
  if (!layout) return;
  index.render(session, layout); index.highlight(selected);
}
let navigationRestoreIdx = null;
const sceneRequests = createRequestScheduler(async idx => {
  const restore = idx === navigationRestoreIdx;
  navigationRestoreIdx = null;
  await call('setRequest', idx, { restore });
  if (pendingFinding?.idx === idx && requestIdx === idx) {
    const id = pendingFinding.id; pendingFinding = null; call('flyToBlock', id);
  }
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
  if (pendingFinding && pendingFinding.idx !== idx) pendingFinding = null;
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
function renderAgents() {
  const runs = mainSession?.agents ?? [], ids = agentCalls(mainSession);
  districtLayer.hidden=metropolisButton.hidden=!!activeRun||!runs.length;
  agentBanner.hidden = bannerDismissed || !!activeRun || !!runs.length || !ids.length;
  agentBanner.querySelector('p').textContent = `This session ran ${ids.length} ${ids.length === 1 ? 'subagent' : 'subagents'}. Their work is stored separately. Pick the project folder or drop the session .jsonl together with its <session-id> folder to include them. Other sessions are ignored.`;
  breadcrumb.hidden = !activeRun;
  app.classList.toggle('viewing-run', !!activeRun);
  breadcrumbText.textContent = activeRun ? `Main session / ${runLabel(activeRun, mainSession.agents)}` : '';
  agentList.hidden = !runs.length;
  agentList.replaceChildren(el('h2', {}, 'Subagents'), ...runs.map(run => {
    const cache = sessionCache(run.session.requests);
    const total = cache ? `${formatTokens(cache.total)} input tokens, ${(cache.hitRate * 100).toFixed(1)}% cache hit rate` : 'Input tokens and cache hit rate unavailable';
    const row = button('', () => switchRun(run, { kind: 'list', agentId: run.agentId }), { class: 'subagent-row', 'data-agent-id': run.agentId });
    if (run.agentId === activeRun?.agentId) {
      row.setAttribute('aria-current', 'true'); row.append(el('span', { class: 'viewing-label' }, 'Viewing'));
    }
    row.append(el('strong', {}, runLabel(run, mainSession.agents)), ...(run.description.length > 64 ? [el('span', {}, run.description)] : []),
      el('span', { class: 'muted' }, `${run.session.requests.length} requests, ${total}. ${run.parentRequestIdx == null ? 'Not linked to a main request' : 'From main request ' + (run.parentRequestIdx + 1)}`));
    return row;
  }));
}
let runReturnTarget = null;
function switchRun(run, returnTarget = null) {
  if (!mainSession) return;
  const left = activeRun;
  if (run && !activeRun) runReturnTarget = returnTarget;
  if (!activeRun) { mainPosition = requestIdx; mainSelected = selected; }
  activeRun = run;
  setSession(run?.session ?? mainSession, true);
  if (!run) {
    navigationRestoreIdx = mainPosition;
    jump(mainPosition, true);
    if (mainSelected && itemById.has(mainSelected)) select(mainSelected, false, false);
    setPanel('index-panel', true);
    const row = [...agentList.querySelectorAll('.subagent-row')].find(n => n.dataset.agentId === left?.agentId);
    if (runReturnTarget?.kind === 'graph') timeline.focusBranch(runReturnTarget.agentId);
    else row?.focus({ preventScroll: true });
  } else breadcrumb.querySelector('button').focus({ preventScroll: true });
}
function setSession(value, navigating = false, startRequest = 0) {
  if (!navigating) { bannerDismissed = false; mainSession = value; activeRun = null; mainPosition = 0; }
  renderAgents();
  navigationRestoreIdx = null;
  pendingFinding = null;
  sceneRequests.reset(); pendingEvents = []; reader.reset(value.meta.redacted === true && !value.meta.targetedRedaction); lastSettled = -1;
  layout = null; itemById.clear(); index.reset(); selected = null;
  session = value; requestIdx = 0; reading = 'stopped';
  districtCheck.checked=districtPreference;
  const meta = session.meta;
  redactedNotice.hidden = !meta.redacted;
  redactedNotice.textContent = meta.targetedRedaction ? "Real recorded session. Personal identifiers were replaced before publishing; public code, prompts and tool definitions remain readable." : meta.redacted ? "Real session, text redacted before publishing. Shapes, sizes, order, timing and tool loads are real; only 8 of the owner's prompts are readable." : '';
  info.textContent = `${meta.sample ? 'Example session · ' : ''}${meta.sourceName || 'Session'} · ${meta.model || 'Model unknown'} · ${meta.startedAt?.slice(0, 10) || 'Date unknown'}${meta.endedAt ? ' to ' + meta.endedAt.slice(0, 10) : ''} · ${session.requests.length} ${session.requests.length === 1 ? 'request' : 'requests'}`;
  notice.textContent = meta.source === 'records'
    ? 'This transcript has no request snapshots (older Claude Code). The prefix shows as one block with unknown text.'
    : meta.source === 'empty' ? `${meta.emptyReason}. Try a main Claude Code session transcript with API requests or assistant records.` : '';
  notice.hidden = !notice.textContent;
  info.title = `${meta.skippedLines || 0} skipped lines · ${meta.sidechainRequests || 0} subagent requests not shown`;
  game.setSession(session, navigating);
  findingPanel.setSession(mainSession);
  toolsPanel.setSession(mainSession);
  timeline.setSession(session, mainSession, activeRun); timeline.update(0); call('setSession', session);
  if (session.requests.length) {
    jump(startRequest, true);
    // Apply the opening request before the intro owns the camera. A queued
    // request change would otherwise cancel its flight and captions next frame.
    sceneRequests.reset(); call('setRequest', requestIdx, { restore: true });
    if (sceneReady && !navigating) game.startIntro();
  }
  else {
    index.root.querySelector('#context-districts').replaceChildren(); reader.show(null);
    ['0', '0.0%', formatTokens(limitOf(meta)), '0'].forEach((text, i) => { statValues[i].textContent = text; });
    stats.classList.remove('near-compact'); call('setAtmosphere', { fill: 0 });
  }
  updateReading(); status.textContent = meta.sample ? 'Example session ready.' : 'Transcript ready. File read in this tab.';
}
async function loadFiles(files, adding = false) {
  closeMenu();
  const generation = ++loadGeneration; activeLoad?.cancel();
  const retainedPosition = activeRun ? mainPosition : requestIdx;
  status.textContent = files.some(f => f.size > 300 * 1024 * 1024)
    ? 'A file is over 300 MB. Parsing may take time and use substantial memory. You can cancel.'
    : 'Reading transcripts in this tab.';
  loading.hidden = false; progress.value = 0;
  activeLoad = parseFiles(files, (bytes, total, name) => {
    if (generation === loadGeneration) { progress.value = total ? bytes / total : 0; progressName.textContent = name; }
  }, adding ? mainSession : null);
  try {
    const result = await activeLoad.promise;
    if (generation === loadGeneration) {
      if (adding && !result.added) { status.textContent = 'No subagent files found'; return; }
      setSession(result.session); if (adding) jump(retainedPosition, true);
      if (result.skipped) status.textContent += ` Skipped ${result.skipped} other ${result.skipped === 1 ? 'session' : 'sessions'} in this folder.`;
    }
  } catch (error) {
    if (generation === loadGeneration) status.textContent = error.name === 'AbortError' ? 'Loading cancelled.' : `Unable to read transcript: ${error.message}`;
  } finally { if (generation === loadGeneration) { activeLoad = null; loading.hidden = true; } }
}
// The builder replaces this sentinel with data, not another retained Session.
const exampleData = null; /* SAMPLE_DATA */
async function loadExample(which = 0) {
  closeMenu();
  const generation = ++loadGeneration; activeLoad?.cancel(); activeLoad = null; loading.hidden = true;
  try {
    let value;
    if (exampleData != null) value = expandSession(JSON.parse(exampleData[which]), 8);
    else {
      const response = await fetch(new URL(['../sample/real-agents-session.json', '../sample/real-session-redacted.json'][which], import.meta.url));
      if (!response.ok) throw new Error(`Example load failed (${response.status})`);
      value = await response.json();
    }
    if (generation === loadGeneration) setSession(value, false, Number.isInteger(value.meta.startRequest) ? value.meta.startRequest : 0);
  } catch (error) { if (generation === loadGeneration) status.textContent = error.message; }
}
let dragDepth = 0;
const fileDrag = event => Array.from(event.dataTransfer?.types ?? []).includes('Files');
document.addEventListener('dragenter', event => { if (fileDrag(event)) { event.preventDefault(); dragDepth++; drop.hidden = false; } });
document.addEventListener('dragover', event => { if (fileDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; drop.hidden = false; } });
document.addEventListener('dragleave', event => { if (fileDrag(event) && --dragDepth <= 0) { dragDepth = 0; drop.hidden = true; } });
document.addEventListener('drop', async event => {
  if (!fileDrag(event)) return;
  event.preventDefault(); dragDepth = 0; drop.hidden = true;
  try { const files = await droppedFiles(event.dataTransfer); if (files.length) loadFiles(files); }
  catch (error) { status.textContent = `Unable to read folder: ${error.message}`; }
});
addEventListener('blur', () => { dragDepth = 0; drop.hidden = true; });
// Priority is shared with the pure helper: native dialog, Findings, Menu,
// zoom, inside or reading scene mode, then the newest panel on narrow screens
// or a selection-opened Reader on desktop.
// Capture before canvas handlers so one press cannot also exit a scene mode.
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (!toolsPanel.root.hidden && event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  if (!toolsPanel.root.hidden && !app.querySelector('dialog[open]') && !event.target.closest?.('input, textarea, select, [contenteditable="true"]')) { event.preventDefault(); event.stopImmediatePropagation(); toolsPanel.close(); return; }
  const action = escapeAction({ dialog: !!app.querySelector('dialog[open]'),
    findings: !findingPanel.root.hidden, menu: narrow.matches && app.classList.contains('show-menu'),
    zoom: timeline.isZoomed(), mode: scene?.getMode(), narrow: narrow.matches, panels: openPanels, readerOpenedBy });
  event.stopImmediatePropagation();
  if (action === 'dialog') return; // Keep the browser's native cancel and focus restoration.
  event.preventDefault();
  if (action === 'findings') findingPanel.close();
  else if (action === 'menu') closeMenu(true);
  else if (action === 'zoom') timeline.resetZoom();
  else {
    game.skipIntro(); game.pausePlayback();
    if (action === 'inside') call('exitInside');
    else if (action === 'reading') call('stopReading');
    else if (action) {
      if (!narrow.matches && action === 'reader-panel' && readerOpenedBy === 'select') clearSelection();
      setPanel(action, false, true);
    }
  }
}, { capture: true });
await loadExample();
try {
  const { createScene } = await import('./scene/index.js');
  scene = createScene(stage, {
    onSelect: id => select(id), onHover: id => select(id, true),
    onBackgroundClick: backgroundClick,
    onAgentHover: () => game.findDistrict(),
    onAgentOpen: id => {game.findDistrict();switchRun(mainSession?.agents?.find(a=>a.agentId===id));},
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
