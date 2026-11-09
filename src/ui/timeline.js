import { forEachRequestChange } from './compact.js';
import { el, button, svgEl } from './dom.js';
import { formatTokens, gauge, markerPercent, eventLabel, sparkPoints, requestStories, fuelState, limitOf, cacheSplit, timelineTimes } from './math.js';
import { agentBranches, agentColor, agentBranchLabel, runDuration, durationLabel } from './agents.js';

const failedRequests = new WeakMap();
// Mark the request where a failed result first enters the context. A failed
// result stays in later requests; ticking those too would hide new failures.
export function failedRequestIndices(session) {
  if (failedRequests.has(session)) return failedRequests.get(session);
  const out = [], seen = new Set();
  forEachRequestChange(session, (r, idx, ids, removed, keep) => {
    let fresh = false;
    for (let i = keep; i < ids.length; i++) if (session.blocks[ids[i]]?.isError && !seen.has(ids[i])) { seen.add(ids[i]); fresh = true; }
    if (fresh) out.push(idx);
  });
  failedRequests.set(session, out);
  return out;
}
export function failureTickPositions(session, project) {
  return failedRequestIndices(session).map(idx => ({ idx, x: project(idx) })).filter(p => Number.isFinite(p.x));
}

export function branchFailureTickPositions(session, { axis, async, start, end, timeX, width }) {
  return failureTickPositions(session, i => axis === 'time' && !async && Number.isFinite(session.requests[i].time)
    ? timeX(session.requests[i].time) / 100 * width
    : start + (end - start) * i / Math.max(1, session.requests.length - 1));
}

// Axis domains use full-chart coordinates, independent of viewport size.
export function axisRange(domain, a, b) {
  const lo = Math.max(domain[0], Math.min(a, b)), hi = Math.min(domain[1], Math.max(a, b));
  return hi > lo ? [lo, hi] : [...domain];
}
export function rangePosition(value, domain, width = 100) {
  return (value - domain[0]) / (domain[1] - domain[0] || 1) * width;
}
// Foreground work is active time even when main requests are far apart.
export function timeScale(times, width, foreground = []) {
  const valid = times.filter(Number.isFinite);
  const evenly = () => ({ x: times.map((_, i) => markerPercent(i, times.length) * width / 100), breaks: [] });
  if (valid.length < 2) return evenly();
  const filled = timelineTimes(times);
  const gaps = filled.slice(1).map((t, i) => t - filled[i]);
  const idle = gaps.map((g, i) => g > 15 * 60000 && !foreground.some(([a, b]) => a <= filled[i + 1] && b >= filled[i]));
  const long = idle.filter(Boolean).length;
  const duration = gaps.reduce((n, g, i) => n + (idle[i] ? 0 : g), 0);
  if (!duration) return evenly();
  // Dense breaks share the same budget; nearby marks are merged below.
  const markWidth = Math.max(2, Math.min(12, .2 * width / Math.max(1, long)));
  const breakWidth = Math.min(markWidth, .2 * width / Math.max(1, long));
  const available = width - long * breakWidth;
  const x = [0], breaks = [];
  gaps.forEach((gap, i) => {
    const size = idle[i] ? breakWidth : gap / duration * available;
    if (idle[i]) {
      const center = x[i] + size / 2;
      if (!breaks.length || center - breaks.at(-1) >= 4) breaks.push(center);
    }
    x.push(x[i] + size);
  });
  return { x, breaks };
}

export function createTimeline(jump, openRun = () => {}, selectFailure = () => {}) {
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
    markerButton.hidden = xPercent(event.requestIdx) < 0 || xPercent(event.requestIdx) > 100;
    markerButton.style.left = `${xPercent(event.requestIdx)}%`;
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
      if (xPercent(event.requestIdx) < 0 || xPercent(event.requestIdx) > 100) return;
      const bin = Math.min(bins - 1, Math.floor(xPercent(event.requestIdx) / 100 * bins));
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
  const breaks = svgEl('g', { class: 'time-breaks', 'aria-hidden': 'true' });
  spark.append(breaks);
  const failures = svgEl('g', { class: 'failure-ticks' }); spark.append(failures);
  const tick = (x,y,idx,agentId,unitsPerPixel = 1) => {
    const hitWidth = Math.max(10, 24 * unitsPerPixel);
    const node = svgEl('g', { class: 'failure-tick-target', tabindex:'0', role:'button', 'aria-label':`Failed tool call at request ${idx+1}`, 'data-request-idx':idx });
    node.append(svgEl('path',{d:`M${x},${y-3} v6`,class:'failure-tick'}),svgEl('rect',{x:x-hitWidth/2,y:Math.max(0,y-12),width:hitWidth,height:24,class:'failure-hit'}));
    const activate=event=>{event.stopPropagation();selectFailure(idx,agentId);};
    node.addEventListener('click',activate);
    node.addEventListener('pointerdown',event=>event.stopPropagation());
    node.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();activate(event);}});
    return node;
  };
  const laneTrack = el('div', { class: 'agent-lane-track' });
  const laneCursor = el('i', { class: 'agent-lane-cursor', 'aria-hidden': 'true' });
  const laneTip = el('p', { class: 'agent-lane-tip', role: 'tooltip', id: 'agent-lane-tip', hidden: true });
  const laneCount = el('span');
  let returnFocus = null;
  let lanes = [], allRows = false, laneButtons = [], axis = 'request', scale = null, zoom = null;
  try { axis = localStorage.getItem('timeline-axis') === 'time' ? 'time' : 'request'; } catch { /* Storage is optional. */ }
  let preferredAxis = axis;
  const byRequest = button('By request', () => changeAxis('request'), { 'aria-pressed': 'true' });
  const byTime = button('By time', () => changeAxis('time'), { 'aria-pressed': 'false' });
  const axisSwitch = el('div', { class: 'timeline-axis', role: 'group', 'aria-label': 'Timeline axis' }, byRequest, byTime);
  const fullDomain = () => axis === 'time' ? [0, scale?.width || 1] : [0, Math.max(1, session.requests.length - 1)];
  const unit = i => axis === 'time' ? scale?.x[i] ?? 0 : i;
  function xPercent(i) { return rangePosition(unit(i) ?? 0, zoom ?? fullDomain()); }
  function timeX(t) {
    const times = timelineTimes(session.requests.map(r => r.time));
    let i = times.findIndex(v => v >= t);
    if (i < 0) return xPercent(times.length - 1);
    if (!i) return xPercent(0);
    const f = (t - times[i - 1]) / (times[i] - times[i - 1] || 1);
    return xPercent(i - 1) + f * (xPercent(i) - xPercent(i - 1));
  }
  const zoomOut = button('Zoom out', resetZoom, { class: 'timeline-zoom-out', hidden: true });
  function resetZoom() { if (!zoom) return false; zoom = null; redraw(); return true; }
  function seek(event, rect, settled = true) {
    const percent = Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100));
    let nearest = 0;
    for (let i = 1; i < session.requests.length; i++) if (Math.abs(xPercent(i) - percent) < Math.abs(xPercent(nearest) - percent)) nearest = i;
    jump(nearest, settled);
  }
  function changeAxis(value) {
    axis = value; preferredAxis = value; zoom = null;
    try { localStorage.setItem('timeline-axis', value); } catch { /* Storage is optional. */ }
    redraw();
  }
  function redraw() {
    if (!session) return;
    const width = Math.max(1, spark.getBoundingClientRect().width);
    const oldWidth = scale?.width;
    scale = { ...timeScale(session.requests.map(r => r.time), width, lanes.filter(b => !b.async && b.runStart != null && b.runEnd != null).map(b => [b.runStart, b.runEnd])), width };
    if (zoom && axis === 'time' && oldWidth) zoom = zoom.map(x => x * width / oldWidth);
    zoomOut.hidden = !zoom; root.classList.toggle('time-axis', axis === 'time');
    byRequest.setAttribute('aria-pressed', String(axis === 'request'));
    byTime.setAttribute('aria-pressed', String(axis === 'time'));
    let points = sparkPoints(session.requests, session.meta.window, 600, 40, i => xPercent(i) * 6);
    if (session.requests.length === 1) points += ` 600,${points.split(',')[1]}`;
    path.setAttribute('points', points); area.setAttribute('points', `0,40 ${points} 600,40`);
    breaks.replaceChildren();
    if (axis === 'time') for (const x of scale.breaks) breaks.append(svgEl('path', { d: `M${rangePosition(x, zoom ?? fullDomain(), 600) - 2},1 l-2,7 M${rangePosition(x, zoom ?? fullDomain(), 600) + 2},1 l-2,7`, class: 'time-break' }));
    failures.replaceChildren(...failureTickPositions(session, i => xPercent(i)*6).filter(p => p.x>=0 && p.x<=600).map(p => tick(p.x, 35, p.idx, undefined, 600 / Math.max(1, spark.getBoundingClientRect().width))));
    renderLanes(); drawMarkers(); focusEvent(focused);
    cursor.style.display = laneCursor.style.display = xPercent(idx) < 0 || xPercent(idx) > 100 ? 'none' : '';
    cursor.setAttribute('x1', xPercent(idx) * 6); cursor.setAttribute('x2', xPercent(idx) * 6);
    laneCursor.style.left = `${xPercent(idx)}%`;
  }
  const laneToggle = button('', () => { allRows = !allRows; renderLanes(); }, { class: 'agent-lane-toggle', 'aria-expanded': 'false' });
  const laneStrip = el('div', { class: 'agent-lanes', hidden: true },
    el('span', { class: 'agent-lane-gutter' }, 'Subagents ', laneCount), laneTrack, laneToggle, laneTip);
  const runTiming = el('p', { class: 'agent-run-timing', hidden: true });
  laneTrack.addEventListener('click', event => {
    if (suppressClick || event.shiftKey || event.target.closest('[role="button"]')) return;
    seek(event, laneTrack.getBoundingClientRect());
  });
  function renderLanes() {
    const focusedAgent = returnFocus ?? document.activeElement?.closest('.agent-branch')?.dataset.agentId;
    laneTip.hidden = true; laneButtons = [];
    laneTrack.replaceChildren(laneCursor);
    lanes = lanes.map(b => ({ ...b, lane: axis === 'time' ? b.timeLane : b.requestLane }));
    const rows = lanes.reduce((n, run) => Math.max(n, run.lane + 1), 0);
    const mobile = matchMedia('(max-width: 760px)').matches, rowHeight = mobile ? allRows ? 24 : 10 : 22;
    const height = Math.max(12, (allRows ? rows : Math.min(4, rows)) * rowHeight + 2);
    laneTrack.style.height = `${height}px`;
    laneToggle.hidden = rows <= 4;
    laneToggle.textContent = allRows ? 'Show fewer rows' : `Show all ${rows} rows`;
    laneToggle.setAttribute('aria-expanded', String(allRows));
    const width = Math.max(1, laneTrack.getBoundingClientRect().width);
    const graph = svgEl('svg', { class: 'agent-graph', viewBox: `0 0 ${width} ${height}`, 'aria-label': 'Subagent branch graph' });
    graph.append(svgEl('path', { d: `M0,1 H${width}`, class: 'agent-main-line' }));
    for (const p of failureTickPositions(session, i => xPercent(i)/100*width).filter(p => p.x>=0 && p.x<=width)) graph.append(tick(p.x, 4, p.idx));
    lanes.forEach((run, index) => {
      const source = session.agents.find(a => a.agentId === run.agentId), label = agentBranchLabel(run);
      const start = (axis === 'time' && !run.async && run.runStart != null ? timeX(run.runStart) : xPercent(run.fork)) / 100 * width;
      const end = !run.async && run.fork === run.merge ? start : (axis === 'time' && !run.async && run.runEnd != null ? timeX(run.runEnd) : xPercent(run.merge)) / 100 * width;
      const y = 1 + (run.lane + 1) * rowHeight, bend = Math.min(9, (end - start) / 3);
      const loop = end === start;
      const size = Math.min(18, 5 + Math.sqrt(run.requests) * 2);
      const d = loop ? `M${start},1 C${start - size},1 ${start - size},${y} ${start},${y} C${start + size},${y} ${start + size},1 ${start},1`
        : `M${start},1 C${start},${y} ${start + bend},${y} ${start + bend},${y} H${end - bend} C${end},${y} ${end},${y} ${end},1`;
      const group = svgEl('g', { class: `agent-branch${!allRows && run.lane >= 4 ? ' agent-lane-extra' : ''}${run.open ? ' agent-branch-open' : ''}`,
        tabindex: '0', role: 'button', 'aria-label': label, 'aria-describedby': 'agent-lane-tip',
        'data-agent-id': run.agentId, 'data-lane': run.lane, 'data-fork-x': start, 'data-merge-x': end });
      group.style.setProperty('--agent-color', agentColor(run.label));
      // The transparent stroke keeps thin branches easy to tap at phone widths.
      group.append(svgEl('rect', { x: Math.max(0, start - (loop ? size : 0)), y: 1 + run.lane * rowHeight, width: Math.max(6, Math.min(width, end + (loop ? size : 0)) - Math.max(0, start - (loop ? size : 0))), height: rowHeight, class: 'agent-branch-hit' }));
      if (!mobile && !loop && end > start) {
        const points = sparkPoints(source.session.requests, source.session.meta.window, Math.max(1, end - start - 2 * bend), 7);
        group.append(svgEl('polygon', { class: 'agent-branch-fill', points: `0,7 ${points} ${Math.max(1, end - start - 2 * bend)},7`, transform: `translate(${start + bend},${y - 7})` }));
      }
      group.append(svgEl('path', { d, class: 'agent-branch-line', fill: 'none' }));
      const branchTicks = branchFailureTickPositions(source.session, { axis, async: run.async, start, end, timeX, width });
      for (const p of branchTicks.filter(p => p.x>=0 && p.x<=width)) group.append(tick(p.x, y, p.idx, run.agentId));
      if (run.open) group.append(svgEl('path', { d: `M${end},1 H${width}`, class: 'agent-open-tail', fill: 'none' }));
      for (const [x, kind] of [[start, 'fork'], [end, 'merge']]) group.append(svgEl('circle', { cx: x, cy: 1, r: 2.5, class: `agent-dot agent-${kind}${run.open && kind === 'merge' ? ' agent-dot-open' : ''}` }));
      if (!mobile && end - start > 32) {
        const text = svgEl('text', { x: Math.max(0, start + bend) + 3, y: y - 3, class: 'agent-branch-label' });
        text.textContent = run.label.slice(0, Math.max(0, Math.floor((Math.min(width, end) - Math.max(0, start) - 18) / 6)));
        group.append(text);
      }
      const show = () => { laneTip.textContent = label; laneTip.hidden = false; };
      group.addEventListener('click', event => { if (!suppressClick && !event.shiftKey) openRun(source, { kind: 'graph', agentId: run.agentId }); });
      group.addEventListener('pointerenter', show); group.addEventListener('focus', show);
      group.addEventListener('pointerleave', () => { if (document.activeElement !== group) laneTip.hidden = true; });
      group.addEventListener('blur', () => { laneTip.hidden = true; });
      group.addEventListener('keydown', event => {
        if (['Enter', ' '].includes(event.key)) { event.preventDefault(); openRun(source, { kind: 'graph', agentId: run.agentId }); return; }
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        let next = event.key === 'Home' ? 0 : event.key === 'End' ? lanes.length - 1 : index + (event.key === 'ArrowRight' ? 1 : -1);
        next = Math.max(0, Math.min(lanes.length - 1, next));
        if (lanes[next].lane >= 4 && !allRows) { allRows = true; renderLanes(); }
        laneButtons[next]?.focus();
      });
      laneButtons.push(group); graph.append(group);
    });
    laneTrack.append(graph);
    if (focusedAgent) laneButtons.find(n => n.dataset.agentId === focusedAgent)?.focus({ preventScroll: true });
  }
  let stories = [];
  let session, idx = 0, frame = 0;
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { frame = 0; jump(Number(slider.value)); }); };
  slider.addEventListener('input', schedule);
  const settle = () => { cancelAnimationFrame(frame); frame = 0; jump(Number(slider.value), true); };
  slider.addEventListener('change', settle);
  slider.addEventListener('pointerup', () => { if (axis !== 'time' && !gesture?.selecting) settle(); });
  const previous = button('Previous', () => jump(idx - 1, true), { id: 'previous-request' });
  const next = button('Next', () => jump(idx + 1, true), { id: 'next-request' });
  const root = el('section', { id: 'timeline', class: 'card', 'aria-label': 'Request timeline' },
    el('div', { class: 'timeline-head' }, el('label', { for: 'request-slider' }, 'Request'), position, fuel, fuelStatus, previous, next, axisSwitch, zoomOut, cacheRow, total),
    spark, laneStrip, runTiming, markers, bar,
    el('div', { class: 'gauge-key' }, el('span', {}, '0'), el('span', { id: 'compact-caption' }), el('span', { id: 'window-caption' })), story, slider, tooltip);
  new ResizeObserver(redraw).observe(spark);
  const band = el('div', { class: 'timeline-selection', hidden: true });
  root.append(band);
  let gesture = null, pendingSeek = null, suppressClick = false;
  const pointers = new Map();
  document.addEventListener('pointerdown', () => { returnFocus = null; }, true);
  document.addEventListener('keydown', () => { returnFocus = null; }, true);
  function percent(event) {
    const rect = spark.getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  }
  function paintBand(a, b) {
    const r = spark.getBoundingClientRect(), rootRect = root.getBoundingClientRect();
    Object.assign(band.style, { left: `${r.left - rootRect.left + Math.min(a, b) * r.width}px`, width: `${Math.abs(b - a) * r.width}px`, top: `${r.top - rootRect.top}px`, height: `${laneStrip.hidden ? r.height : laneTrack.getBoundingClientRect().bottom - r.top}px` });
    band.hidden = false;
  }
  function applySelection(a, b) {
    if (Math.abs(a - b) < .01) return;
    const d = zoom ?? fullDomain();
    zoom = axisRange(fullDomain(), d[0] + a * (d[1] - d[0]), d[0] + b * (d[1] - d[0]));
    redraw();
  }
  function pointerDown(event) {
    suppressClick = false;
    if (event.target.closest('button') || event.target.closest('[role="button"]') && !event.shiftKey) return;
    pointers.set(event.pointerId, percent(event));
    if (event.shiftKey || pointers.size === 2) {
      event.preventDefault();
      const values = [...pointers.values()];
      gesture = { start: values[0], end: values.at(-1), selecting: true };
      paintBand(gesture.start, gesture.end);
    } else if (event.currentTarget === slider && axis === 'time') {
      event.preventDefault(); slider.focus(); gesture = { selecting: false };
      seek(event, spark.getBoundingClientRect(), false);
    } else return;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event) {
    if (!gesture) return;
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, percent(event));
    if (gesture.selecting) {
      const values = [...pointers.values()];
      if (values.length === 2) [gesture.start, gesture.end] = values;
      else gesture.end = percent(event);
      paintBand(gesture.start, gesture.end);
    } else {
      pendingSeek = event;
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; seek(pendingSeek, spark.getBoundingClientRect(), false); });
    }
  }
  function pointerUp(event) {
    pointers.delete(event.pointerId);
    if (!gesture) return;
    const was = gesture; gesture = null; band.hidden = true;
    cancelAnimationFrame(frame); frame = 0;
    if (was.selecting) { suppressClick = true; applySelection(was.start, was.end); event.preventDefault(); }
    else seek(event, spark.getBoundingClientRect(), true);
  }
  for (const surface of [slider, laneTrack]) {
    surface.addEventListener('pointerdown', pointerDown);
    surface.addEventListener('pointermove', pointerMove);
    surface.addEventListener('pointerup', pointerUp);
    surface.addEventListener('pointercancel', () => { gesture = null; pointers.clear(); band.hidden = true; cancelAnimationFrame(frame); frame = 0; });
    surface.addEventListener('wheel', event => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const d = zoom ?? fullDomain(), full = fullDomain(), anchor = d[0] + percent(event) * (d[1] - d[0]);
      const factor = Math.exp(Math.max(-1, Math.min(1, event.deltaY * .005)));
      const span = Math.min(full[1] - full[0], Math.max((full[1] - full[0]) / 1000, (d[1] - d[0]) * factor));
      const start = Math.max(full[0], Math.min(full[1] - span, anchor - percent(event) * span));
      zoom = span >= full[1] - full[0] ? null : [start, start + span]; redraw();
    }, { passive: false });
  }
  return { root, resetZoom, isZoomed: () => !!zoom, focusBranch(id) { returnFocus = id; requestAnimationFrame(() => { renderLanes(); requestAnimationFrame(() => { laneButtons.find(n => n.dataset.agentId === id)?.focus({ preventScroll: true }); }); }); },
    setSession(value, mainSession = value, activeRun = null) {
      session = value; returnFocus = null; zoom = null; scale = null; stories = requestStories(session); cancelAnimationFrame(frame);
      lanes = activeRun ? [] : agentBranches(session); allRows = false;
      laneStrip.hidden = !lanes.length; laneCount.textContent = lanes.length;
      const timing = activeRun && agentBranches(mainSession).find(a => a.agentId === activeRun.agentId);
      runTiming.hidden = !activeRun;
      const clock = t => t == null ? '' : ` (${new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
      const duration = timing && runDuration(timing);
      runTiming.textContent = timing ? `Forked at main request ${timing.fork + 1}${clock(timing.forkTime)}, ${timing.open ? 'has not merged' : 'merged at request ' + (timing.merge + 1) + clock(timing.mergeTime)}${duration == null ? '' : ', ran ' + durationLabel(duration)}${timing.async ? ' in the background' : ', main thread waited'}` : 'This run is not linked to a main request';
      byTime.disabled = session.requests.filter(r => Number.isFinite(r.time)).length < 2;
      byTime.title = byTime.disabled ? 'This transcript has no timestamps' : '';
      axis = byTime.disabled ? 'request' : preferredAxis;
      root.classList.toggle('has-agent-lanes', !!lanes.length);
      root.classList.toggle('has-run-timing', !!activeRun);
      renderLanes();
      const limit = limitOf(session.meta);
      fuelMark.textContent = formatTokens(limit);
      slider.max = Math.max(0, session.requests.length - 1); slider.disabled = !session.requests.length;
      events = [...session.events].sort((a, b) => a.requestIdx - b.requestIdx);
      focused = 0; focusEvent(0); drawMarkers();
      redraw();
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
      cursor.style.display = laneCursor.style.display = xPercent(idx) < 0 || xPercent(idx) > 100 ? 'none' : '';
      const x = xPercent(idx) * 6;
      cursor.setAttribute('x1', x); cursor.setAttribute('x2', x);
      laneCursor.style.left = `${x / 6}%`;
      previous.disabled = !session.requests.length || idx <= 0;
      next.disabled = !session.requests.length || idx >= session.requests.length - 1;
    },
  };
}
