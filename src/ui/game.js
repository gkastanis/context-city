import { el, button, svgEl } from './dom.js';
import { formatTokens, sessionCache, wholeSessionCache } from './math.js';
import { gameFacts, crossedEvents } from './game-model.js';
import { findings } from './findings.js';

export function createGame({ call, jump, locate, showFindings = () => {}, summarySession = () => null, queueEvent = () => {} }) {
  let states = new WeakMap();
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
    const source = summarySession() ?? session;
    const summaryFacts = source === session ? facts : gameFacts(source);
    const rows = [ ['Peak context', formatTokens(summaryFacts.peak)], ['Compactions', summaryFacts.compactions],
      ['Tools loaded mid-session', summaryFacts.toolsLoaded], ['Tool definitions at the last request', `${summaryFacts.toolShare.toFixed(1)}% (estimated)`],
      ['Longest single block', `${formatTokens(summaryFacts.biggest?.estTokens ?? 0)} tokens (estimated)`], ['Total requests', source.requests.length] ];
    if (source.agents?.length) {
      for (const row of rows) row[0] += ' (main thread)';
      rows.push(['Subagent runs', source.agents.length],
        ['Subagent requests', source.agents.reduce((n, a) => n + a.session.requests.length, 0)]);
      const whole = wholeSessionCache(source);
      if (whole) rows.push(['Whole session input', `${formatTokens(whole.total)} tokens: ${formatTokens(whole.read)} read from cache, ${formatTokens(whole.write)} written to cache, ${formatTokens(whole.uncached)} uncached (${(whole.hitRate * 100).toFixed(1)}% cache hit rate)`]);
    }
    // Input tokens summed over every request that reported usage (each request resends the context).
    const cache = sessionCache(source.requests);
    if (cache) rows.push(['Input read from cache', formatTokens(cache.read)], ['Input written to cache', formatTokens(cache.write)],
      ['Uncached input', formatTokens(cache.uncached)], ['Cache hit rate', `${(cache.hitRate * 100).toFixed(1)}% of ${formatTokens(cache.total)} input tokens`]);
    if (source.agents?.length) {
      const start = rows.findIndex(r => r[0] === 'Input read from cache');
      if (start >= 0) for (let i = start; i < rows.length; i++) rows[i][0] += ' (main thread)';
    }
    const cacheBar = cache && el('div', { class: 'cache-bar cache-bar--wide', role: 'img', 'aria-label': `Input over the ${source.agents?.length ? 'main thread' : 'whole session'}: ${(cache.hitRate * 100).toFixed(1)}% read from cache` },
      ...[['read', cache.read], ['write', cache.write], ['uncached', cache.uncached]].map(([kind, v]) => { const seg = el('i', { class: `cache-seg cache-${kind}` }); seg.style.width = `${v / cache.total * 100}%`; return seg; }));
    const cacheKey = cache && el('p', { class: 'cache-key muted' }, el('i', { class: 'cache-dot cache-read' }), 'read from cache ', el('i', { class: 'cache-dot cache-write' }), 'written to cache ', el('i', { class: 'cache-dot cache-uncached' }), 'uncached. Usage is reported per request, so it cannot be split per block.');
    summaryDialog.replaceChildren(el('div', { class: 'help-heading' }, el('h2', { id: 'summary-heading' }, completion === true ? 'Every discovery found' : 'Your run'), button('Close', () => summaryDialog.close())),
      el('p', { class: 'muted' }, completion === true ? 'You explored the whole Field guide. Here is your session.' : 'A session in numbers.'), el('dl', { class: 'run-stats' }, ...rows.flatMap(([label, value]) => [el('dt', {}, label), el('dd', {}, String(value))])));
    if (cache) summaryDialog.append(cacheBar, cacheKey);
    const top = findings(source)[0];
    summaryDialog.append(el('p', { class: 'summary-finding' }, top ? `Top finding: ${top.title}` : 'No problems found in this session.',
      button('Show findings', () => { summaryDialog.close(); showFindings(); })));
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
  function skipIntro(invite = true) {
    const active = !intro.hidden;
    introTimers.forEach(clearTimeout); introTimers = []; intro.hidden = true;
    if (invite !== false && active && session?.requests.length) inviteGuess();
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
    setSession(value, navigating = false) {
      skipIntro(false); pausePlayback();
      if (navigating && session) states.set(session, { found, completed, guessShown, walkMs,
        guessNodes: [...guessBody.childNodes] });
      if (!navigating) states = new WeakMap();
      const saved = states.get(value);
      clearInterval(walkTimer); walkMs = saved?.walkMs ?? 0; walking = false;
      clearTimeout(toastTimer); toast.hidden = true; if (summaryDialog.open) summaryDialog.close();
      clearTimeout(guessTimer); guessShown = saved?.guessShown ?? false; completed = saved?.completed ?? false;
      session = value; facts = gameFacts(value); current = 0; found = saved?.found ?? new Set(); renderQuests();
      play.disabled = !session.requests.length; guess.hidden = true;
      guessBody.replaceChildren(...(saved?.guessNodes ?? [button('How much of this city is tools? Take a guess', () => showGuess())]));
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
