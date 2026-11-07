import { el, button, svgEl } from './dom.js';
import { formatTokens, gauge, markerPercent, eventLabel, sparkPoints, requestStories, fuelState, limitOf, cacheSplit } from './math.js';

export function createTimeline(jump) {
  const slider = el('input', { id: 'request-slider', type: 'range', min: 0, max: 0, value: 0, step: 1 });
  const story = el('p', { id: 'request-story', class: 'request-story' });
  const fuelFill = el('i');
  const fuelStatus = el('span', { class: 'fuel-status' });
  const fuelMark = el('span', { class: 'fuel-mark' });
  const fuel = el('div', { class: 'context-fuel', role: 'meter', 'aria-label': 'Context toward the limit', 'aria-valuemin': 0 }, fuelFill, fuelMark);
  const position = el('output', { for: 'request-slider', id: 'request-position' });
  const total = el('strong'), fill = el('div', { class: 'gauge-fill' }), compact = el('i', { class: 'compact-line' });
  const bar = el('div', { class: 'gauge', role: 'meter', 'aria-label': 'Context window', 'aria-valuemin': 0 }, fill, compact);
  const markers = el('div', { class: 'markers', 'aria-label': 'Session events' });
  // Prompt cache for this request: read from cache, written to cache, uncached input.
  const cacheSegs = ['read', 'write', 'uncached'].map(kind => el('i', { class: `cache-seg cache-${kind}` }));
  const cacheBar = el('div', { class: 'cache-bar', role: 'img' }, ...cacheSegs), cacheText = el('span', { class: 'cache-text' });
  const cacheRow = el('div', { class: 'cache-row' }, el('span', { class: 'cache-label' }, 'Input cache'), cacheBar, cacheText);
  const markerCanvas = el('canvas', { class: 'marker-canvas', height: 18, 'aria-hidden': 'true' });
  const eventItem = el('div', { role: 'listitem' });
  const markerButton = button('', () => events[focused] && jump(events[focused].requestIdx, true), {
    class: 'event-marker', tabindex: 0, 'aria-describedby': 'event-label', 'aria-label': 'Session event',
  });
  eventItem.append(markerButton);
  const eventList = el('div', { role: 'list', 'aria-label': 'Session events. Use arrow keys, then Enter to jump.' }, eventItem);
  markers.append(markerCanvas, eventList);
  const tracks = { user_prompt: 0, tool_loaded: 1, mcp_instructions: 2, deferred_tools: 3, skill_listing: 4, compaction: 5 };
  const colors = { user_prompt: '--message', tool_loaded: '--tools', mcp_instructions: '--mcp', deferred_tools: '--harness', skill_listing: '--menus', compaction: '--accent' };
  let events = [], focused = 0, clusters = [], bins = 1;
  function labelAt(i) { return `Request ${events[i].requestIdx + 1}. ${eventLabel(events[i])}`; }
  function focusEvent(i) {
    focused = Math.max(0, Math.min(events.length - 1, i));
    eventList.hidden = !events.length;
    if (!events.length) return;
    const event = events[focused], label = labelAt(focused);
    markerButton.setAttribute('aria-label', label); markerButton.title = label;
    markerButton.className = `event-marker event-${event.type}`;
    markerButton.style.left = `${markerPercent(event.requestIdx, session.requests.length)}%`;
    markerButton.style.top = '3px';
    eventItem.setAttribute('aria-posinset', focused + 1); eventItem.setAttribute('aria-setsize', events.length);
    tooltip.textContent = label;
  }
  markerButton.addEventListener('focus', () => focusEvent(focused));
  markerButton.addEventListener('keydown', event => {
    const move = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (move || event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); focusEvent(event.key === 'Home' ? 0 : event.key === 'End' ? events.length - 1 : focused + move);
    }
  });
  function drawMarkers() {
    if (!session) return;
    const width = Math.max(1, Math.round(markers.getBoundingClientRect().width));
    markerCanvas.width = width; markerCanvas.height = 18; bins = Math.max(1, Math.floor(width / 9));
    const groups = new Map();
    events.forEach((event, i) => {
      const bin = Math.min(bins - 1, Math.floor(markerPercent(event.requestIdx, session.requests.length) / 100 * bins));
      const track = 0, key = `${bin}:${track}`;
      if (event.type === 'compaction' && groups.has(key)) groups.get(key).type = 'compaction';
      if (!groups.has(key)) groups.set(key, { bin, track, type: event.type, indices: [] });
      groups.get(key).indices.push(i);
    });
    clusters = [...groups.values()];
    const ctx = markerCanvas.getContext('2d'), style = getComputedStyle(markers);
    for (const cluster of clusters) {
      ctx.fillStyle = style.getPropertyValue(colors[cluster.type] ?? '--muted');
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1.2;
      const x = Math.max(5, Math.min(width - 5, cluster.bin / bins * width));
      ctx.beginPath();
      if (cluster.type === 'user_prompt') { ctx.moveTo(x - 3, 4); ctx.lineTo(x + 3, 9); ctx.lineTo(x - 3, 14); }
      else if (cluster.type === 'compaction') { ctx.moveTo(x - 4, 4); ctx.lineTo(x + 4, 14); ctx.moveTo(x + 4, 4); ctx.lineTo(x - 4, 14); }
      else if (cluster.type === 'tool_loaded') { ctx.rect(x - 3, 5, 6, 8); ctx.moveTo(x, 3); ctx.lineTo(x, 15); }
      else { ctx.moveTo(x, 3); ctx.lineTo(x + 4, 9); ctx.lineTo(x, 15); ctx.lineTo(x - 4, 9); ctx.closePath(); }
      ctx.stroke();
      if (cluster.indices.length > 1) { ctx.beginPath(); ctx.arc(x + 4, 3, 1.5, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  function hit(event) {
    const rect = markerCanvas.getBoundingClientRect();
    const bin = Math.min(bins - 1, Math.floor((event.clientX - rect.left) / rect.width * bins));
    const track = 0;
    return clusters.find(cluster => cluster.bin === bin && cluster.track === track);
  }
  markerCanvas.addEventListener('pointermove', event => {
    const cluster = hit(event);
    if (cluster) tooltip.textContent = `${labelAt(cluster.indices[0])}${cluster.indices.length > 1 ? `; ${cluster.indices.length} nearby events. Arrow keys explore each event.` : ''}`;
  });
  markerCanvas.addEventListener('click', event => {
    const cluster = hit(event);
    if (cluster) { focusEvent(cluster.indices[0]); jump(events[focused].requestIdx, true); }
  });
  new ResizeObserver(drawMarkers).observe(markers);
  const tooltip = el('p', { class: 'event-label', id: 'event-label' }, 'Focus or hover an event to read its label.');
  const spark = svgEl('svg', { viewBox: '0 0 600 40', preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Context totals across requests. Missing measurements use estimates.' });
  const area = svgEl('polygon', { class: 'spark-area' });
  const path = svgEl('polyline', { class: 'spark-path', fill: 'none' });
  const threshold = svgEl('line', { class: 'spark-threshold', x1: 0, x2: 600 });
  const cursor = svgEl('line', { class: 'spark-cursor', y1: 0, y2: 40 });
  spark.append(area, threshold, path, cursor);
  let stories = [];
  let session, idx = 0, frame = 0;
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => jump(Number(slider.value))); };
  slider.addEventListener('input', schedule);
  const settle = () => { cancelAnimationFrame(frame); frame = 0; jump(Number(slider.value), true); };
  slider.addEventListener('change', settle);
  slider.addEventListener('pointerup', settle);
  const previous = button('Previous', () => jump(idx - 1, true), { id: 'previous-request' });
  const next = button('Next', () => jump(idx + 1, true), { id: 'next-request' });
  const root = el('section', { id: 'timeline', class: 'card', 'aria-label': 'Request timeline' },
    el('div', { class: 'timeline-head' }, el('label', { for: 'request-slider' }, 'Request'), position, fuel, fuelStatus, previous, next, cacheRow, total),
    slider, markers, story, tooltip, bar,
    el('div', { class: 'gauge-key' }, el('span', {}, '0'), el('span', { id: 'compact-caption' }), el('span', { id: 'window-caption' })), spark);
  return { root,
    setSession(value) {
      session = value; stories = requestStories(session); cancelAnimationFrame(frame);
      const limit = limitOf(session.meta);
      fuelMark.textContent = formatTokens(limit);
      slider.max = Math.max(0, session.requests.length - 1); slider.disabled = !session.requests.length;
      events = [...session.events].sort((a, b) => a.requestIdx - b.requestIdx);
      focused = 0; focusEvent(0); drawMarkers();
      let points = sparkPoints(session.requests, session.meta.window);
      if (session.requests.length === 1) points += ` 600,${points.split(',')[1]}`;
      path.setAttribute('points', points);
      area.setAttribute('points', `0,40 ${points} 600,40`);
      const hasCompact = session.meta.autocompactAt != null, y = 40 * (1 - limit / session.meta.window);
      threshold.setAttribute('y1', y); threshold.setAttribute('y2', y); threshold.style.display = hasCompact ? '' : 'none';
      root.querySelector('#compact-caption').textContent = hasCompact ? `Autocompact ${formatTokens(limit)}` : '';
      root.querySelector('#window-caption').textContent = formatTokens(session.meta.window);
    },
    update(value) {
      idx = value; slider.value = idx;
      const request = session.requests[idx], g = gauge(request, session.meta);
      story.textContent = stories[idx]?.caption || 'No requests recorded';
      const limit = limitOf(session.meta), f = fuelState(g.total, limit, stories[idx]?.compacted);
      fuelFill.style.width = `${f.fill * 100}%`; fuel.style.setProperty('--fuel-color', f.color);
      fuelStatus.textContent = f.status; fuel.classList.toggle('fuel-near', f.fill >= .85);
      fuel.setAttribute('aria-valuemax', limit); fuel.setAttribute('aria-valuenow', Math.min(g.total, limit));
      fuel.setAttribute('aria-valuetext', `${formatTokens(g.total)} of ${formatTokens(limit)}. ${f.status}`);
      position.textContent = session.requests.length ? `${idx + 1} of ${session.requests.length}` : '0 of 0';
      root.classList.toggle('near-compact', g.total >= limit * .85);
      root.classList.toggle('at-compact', g.total >= limit);
      total.textContent = `${formatTokens(g.total)} of ${formatTokens(session.meta.window)}${g.measured ? ' measured' : ' estimated'}`;
      const c = cacheSplit(request?.usage); cacheRow.hidden = !c;
      if (c) {
        [c.read, c.write, c.uncached].forEach((v, i) => { cacheSegs[i].style.width = `${v / c.total * 100}%`; });
        cacheText.textContent = `${formatTokens(c.read)} read, ${formatTokens(c.write)} written, ${formatTokens(c.uncached)} uncached (${Math.round(c.hitRate * 100)}% hit)`;
        cacheBar.setAttribute('aria-label', `Input cache for this request: ${cacheText.textContent}`);
      }
      fill.style.width = `${g.percent}%`; compact.style.left = `${g.compactPercent}%`;
      bar.setAttribute('aria-valuemax', session.meta.window); bar.setAttribute('aria-valuenow', g.total);
      bar.setAttribute('aria-valuetext', total.textContent);
      const x = markerPercent(idx, session.requests.length) * 6;
      cursor.setAttribute('x1', x); cursor.setAttribute('x2', x);
      previous.disabled = !session.requests.length || idx <= 0;
      next.disabled = !session.requests.length || idx >= session.requests.length - 1;
    },
  };
}
