import { el, button, svgEl } from './dom.js';
import { formatTokens } from './math.js';
import { gameFacts, crossedEvents } from './game-model.js';

export function createGame({ call, jump, locate, queueEvent = () => {} }) {
  let session, facts, current = 0, found = new Set(), playing = false, timer = 0, walkTimer = 0, walkMs = 0;
  let guessTimer = 0, guessShown = false, completed = false;
  let introTimers = [], cancelIntro = null, toastTimer = 0, walking = false, lastWalk = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const toast = el('p', { id: 'discovery-toast', class: 'card', role: 'status', hidden: true });
  const ring = svgEl('svg', { viewBox: '0 0 44 44', 'aria-hidden': 'true' });
  const circle = svgEl('circle', { cx: 22, cy: 22, r: 18, class: 'progress-ring', pathLength: 100 });
  ring.append(svgEl('circle', { cx: 22, cy: 22, r: 18, class: 'ring-track' }), circle);
  const progress = el('span', { id: 'quest-progress' });
  const list = el('div', { class: 'quest-list' });
  const guide = el('aside', { id: 'field-guide', class: 'card panel', 'aria-label': 'Field guide' },
    el('div', { class: 'guide-heading' }, ring, el('div', {}, el('h2', {}, 'Field guide'), progress)),
    el('p', { class: 'muted' }, 'Find what the model sees. Explore a building to make a discovery.'), list);
  function renderQuests() {
    const focused = [...list.children].indexOf(document.activeElement);
    progress.textContent = `${found.size} of ${facts.quests.length} found`;
    circle.style.strokeDasharray = `${facts.quests.length ? found.size / facts.quests.length * 100 : 0} 100`;
    list.replaceChildren(...facts.quests.map(q => button(q.label, () => {
      if (q.blockId) locate(q.blockId);
      else if (q.event) {
        jump(q.event.requestIdx, true);
        if (q.action === 'loaded') {
          const r = session.requests[q.event.requestIdx];
          const blockId = r.blockIds.find(id => session.blocks[id]?.kind === 'tool_def' && q.event.data.names.includes(session.blocks[id].toolName));
          if (blockId) locate(blockId);
        }
      } else { call('startReading'); }
    }, { class: `quest ${found.has(q.id) ? 'found' : ''}`, 'aria-label': `${q.label}${found.has(q.id) ? '. Found' : ''}` })));
    if (focused >= 0) list.children[focused]?.focus({ preventScroll: true });
  }
  function discover(q, blockId) {
    if (!q || found.has(q.id)) return;
    found.add(q.id); renderQuests(); call('celebrate', blockId ?? q.blockId);
    clearTimeout(toastTimer); toast.replaceChildren(questIcon(q.id), document.createTextNode(q.sentence)); toast.hidden = false;
    if (found.size === facts.quests.length && !completed) { completed = true; if (summaryDialog.isConnected) { pausePlayback(); summary(true); } }
    toastTimer = setTimeout(() => { toast.hidden = true; }, 5500);
  }
  const summaryDialog = el('dialog', { id: 'run-summary', 'aria-labelledby': 'summary-heading' });
  function summary(completion = false) {
    if (!session) return;
    const rows = [ ['Peak context', formatTokens(facts.peak)], ['Compactions', facts.compactions],
      ['Tools loaded mid-session', facts.toolsLoaded], ['Tool definitions at the last request', `${facts.toolShare.toFixed(1)}% (estimated)`],
      ['Longest single block', `${formatTokens(facts.biggest?.estTokens ?? 0)} tokens (estimated)`], ['Total requests', session.requests.length] ];
    summaryDialog.replaceChildren(el('div', { class: 'help-heading' }, el('h2', { id: 'summary-heading' }, completion === true ? 'Every discovery found' : 'Your run'), button('Close', () => summaryDialog.close())),
      el('p', { class: 'muted' }, completion === true ? 'You explored the whole Field guide. Here is your session.' : 'A session in numbers.'), el('dl', { class: 'run-stats' }, ...rows.flatMap(([label, value]) => [el('dt', {}, label), el('dd', {}, String(value))])));
    if (completion === true) summaryDialog.append(button('Replay the session', () => { summaryDialog.close(); jump(0, true); play.click(); }, { class: 'primary' }));
    if (!summaryDialog.open) summaryDialog.showModal();
  }
  const play = button('Play', () => {
    if (!session?.requests.length) return;
    skipIntro(); if (current >= session.requests.length - 1) jump(0, true);
    playing = true; play.disabled = true; pause.disabled = false; stop.disabled = false; tick();
  }, { id: 'play-timelapse', class: 'primary', 'aria-label': 'Play time-lapse' });
  const rate = el('select', { id: 'timelapse-rate', 'aria-label': 'Time-lapse speed' }, ...[1, 4, 16].map(n => el('option', { value: n }, `${n}x`)));
  const pause = button('Pause', pausePlayback, { id: 'pause-timelapse', disabled: true });
  const stop = button('Stop', pausePlayback, { id: 'stop-timelapse', disabled: true });
  function pausePlayback() { playing = false; clearTimeout(timer); play.disabled = !session?.requests.length; pause.disabled = true; stop.disabled = true; }
  function tick() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!playing) return;
      if (current >= session.requests.length - 1) { pausePlayback(); summary(); return; }
      jump(current + 1, true); tick();
    }, 1000 / Number(rate.value));
  }
  const caption = el('p');
  const interruptIntro = event => { if (!intro.hidden && !intro.contains(event.target)) skipIntro(); };
  for (const name of ['pointerdown', 'wheel', 'keydown']) document.addEventListener(name, interruptIntro, { passive: true });
  const intro = el('div', { id: 'city-intro', class: 'card', hidden: true }, el('span', { class: 'eyebrow' }, 'Welcome to the city'), caption, button('Skip', skipIntro, { id: 'skip-intro' }));
  function skipIntro() {
    const active = !intro.hidden;
    introTimers.forEach(clearTimeout); introTimers = []; intro.hidden = true;
    if (active && session?.requests.length) inviteGuess();
    const cancel = cancelIntro; cancelIntro = null; if (typeof cancel === 'function') cancel();
  }
  function inviteGuess() {
    if (guessShown) return;
    guessShown = true; guess.hidden = false;
    clearTimeout(guessTimer); guessTimer = setTimeout(() => { guess.hidden = true; }, 12000);
  }
  function startIntro() {
    skipIntro(); guess.hidden = true; if (!session?.requests.length) return;
    if (reduced.matches) { const cancel = call('playIntro', { onDone() {} }); if (typeof cancel === 'function') cancel(); inviteGuess(); return; }
    const captions = ['Every block is text the model sees.', 'Left to right is the order it arrives in.', 'Enter a building to read what is inside.', 'Find the city\'s secrets in the Field guide.'];
    intro.hidden = false; caption.textContent = captions[0];
    cancelIntro = call('playIntro', { onDone: () => { cancelIntro = null; intro.hidden = true; inviteGuess(); introTimers.forEach(clearTimeout); introTimers = []; } });
    captions.slice(1).forEach((text, i) => introTimers.push(setTimeout(() => { caption.textContent = text; }, (i + 1) * 2400)));
    introTimers.push(setTimeout(skipIntro, 9600));
  }
  const guessBody = el('div');
  const guess = el('section', { id: 'guess-card', class: 'card', 'aria-label': 'Guess the share' },
    el('div', { class: 'help-heading' }, el('span', { class: 'eyebrow' }, 'Guess the share'), button('Dismiss', () => { guess.hidden = true; })), guessBody);
  guess.addEventListener('pointerdown', () => clearTimeout(guessTimer));
  guess.addEventListener('keydown', () => clearTimeout(guessTimer));
  guess.addEventListener('focusin', () => clearTimeout(guessTimer));
  function showGuess(index = 0) {
    const title = el('p', {}, index ? 'How full is the window at the last request?' : 'At the last request, how much of this context is tool definitions?');
    const output = el('output', { for: 'share-guess' }, '50%');
    const slider = el('input', { id: 'share-guess', type: 'range', min: 0, max: 100, value: 50, 'aria-label': 'Your guess in percent', oninput: () => { output.textContent = `${slider.value}%`; } });
    const reveal = button('Check my guess', () => {
      const real = index ? facts.windowShare : facts.toolShare;
      const bar = el('div', { class: 'answer-bar' }, el('i', { style: `width:${Math.max(0, Math.min(100, real))}%` }));
      guessBody.replaceChildren(title, el('strong', {}, `${real.toFixed(1)}%${index && facts.windowMeasured ? ' measured' : ' estimated'}`), bar,
        el('p', {}, `Off by ${Math.abs(Number(slider.value) - real).toFixed(0)} points.`),
        button(index ? 'Done' : 'Try the window', () => index ? guess.hidden = true : showGuess(1)));
    });
    guessBody.replaceChildren(title, el('div', { class: 'guess-input' }, slider, output), reveal);
  }
  function update(idx) {
    if (!session || idx === current) return;
    const events = crossedEvents(session.events, current, idx);
    if (playing && idx > current) for (const event of events) queueEvent(event);
    for (const event of events) if (event.type === 'compaction') discover(facts.quests.find(q => q.id === 'compact'));
    current = idx;
    // Request zero may itself contain a newly loaded tool; selecting its definition is required.
  }
  function checkBlock(id, entering) {
    const block = session?.blocks[id]; if (!block) return;
    for (const q of facts.quests) {
      if (q.action === 'enter' ? entering && block.kind === 'tool_def' : q.action === 'select' && q.blockId === id) discover(q, id);
      if (q.action === 'loaded' && current >= q.event.requestIdx && block.kind === 'tool_def' && q.event.data.names.includes(block.toolName)) discover(q, id);
    }
  }
  function mode(value, details = {}) {
    const now = performance.now();
    if (walking) walkMs += now - lastWalk;
    clearInterval(walkTimer); walking = value === 'reading' && !details.paused; lastWalk = now;
    if (walking) walkTimer = setInterval(() => {
      const t = performance.now(); walkMs += t - lastWalk; lastWalk = t;
      if (walkMs >= 10000) { discover(facts.quests.find(q => q.id === 'walk')); clearInterval(walkTimer); }
    }, 250);
  }
  return { guide, guess, intro, toast, summaryDialog, play, pause, stop, rate, summary, update, startIntro, skipIntro, pausePlayback, mode,
    toggleGuess() { clearTimeout(guessTimer); guess.hidden = !guess.hidden; },
    select: id => checkBlock(id, false), enter: id => checkBlock(id, true),
    setSession(value) {
      skipIntro(); pausePlayback(); clearInterval(walkTimer); walkMs = 0; walking = false;
      clearTimeout(toastTimer); toast.hidden = true; if (summaryDialog.open) summaryDialog.close();
      clearTimeout(guessTimer); guessShown = false; completed = false;
      session = value; facts = gameFacts(value); current = 0; found = new Set(); renderQuests();
      play.disabled = !session.requests.length; guess.hidden = true; guessBody.replaceChildren(button('How much of this city is tools? Take a guess', () => showGuess()));
    },
    dispose() { for (const name of ['pointerdown', 'wheel', 'keydown']) document.removeEventListener(name, interruptIntro); skipIntro(); pausePlayback(); clearInterval(walkTimer); clearTimeout(toastTimer); clearTimeout(guessTimer); },
  };
}

// Each quest has a code-drawn symbol; transcript strings never enter SVG markup.
function questIcon(kind) {
  const paths = { system: 'M4 3h12v14H4z M7 7h6 M7 10h6', schema: 'M3 5h14v12H3z M3 9h14 M9 9v8', instructions: 'M5 2h8l3 4v12H5z M8 9h5 M8 13h5', memory: 'M3 4h14v4H3z M5 8v9h10V8 M8 12h4', prompt: 'M3 3h14v10H9l-4 4v-4H3z', loaded: 'M10 2v12 M5 9l5 5 5-5 M4 17h12', compact: 'M3 3l6 6 M17 3l-6 6 M3 17l6-6 M17 17l-6-6', biggest: 'M4 18V8h5v10 M10 18V2h6v16', walk: 'M4 17l3-5 4 1 4-8 M12 5h3v3' };
  const icon = svgEl('svg', { viewBox: '0 0 20 20', class: 'quest-icon', 'aria-hidden': 'true' });
  icon.append(svgEl('path', { d: paths[kind] || paths.schema, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }));
  return icon;
}
