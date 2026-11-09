export function formatTokens(value) {
  if (value == null) return 'unknown';
  if (value >= 1e6) return `${+(value / 1e6).toFixed(2)}M`;
  if (value >= 1000) return `${+(value / 1000).toFixed(1)}K`;
  return String(Math.round(value));
}
// Prompt-cache split of one request's input, from the assistant turn's usage
// block. Usage is per API call, so this cannot be attributed to single blocks.
export function cacheSplit(usage) {
  if (!usage) return null;
  const read = usage.cacheRead ?? 0, write = usage.cacheWrite ?? 0, uncached = usage.input ?? 0, total = read + write + uncached;
  return total ? { read, write, uncached, total, hitRate: read / total } : null;
}
// Totals over every request that reported usage.
export function sessionCache(requests) {
  let read = 0, write = 0, uncached = 0, count = 0;
  for (const r of requests) { const c = cacheSplit(r.usage); if (!c) continue; read += c.read; write += c.write; uncached += c.uncached; count++; }
  const total = read + write + uncached;
  return count ? { read, write, uncached, total, hitRate: total ? read / total : 0, requests: count } : null;
}
// The fill limit: the autocompact threshold when the session states one, else the window.
export const limitOf = meta => meta.autocompactAt ?? meta.window;
export const markerPercent = (idx, count) => count > 1 ? Math.max(0, Math.min(100, idx / (count - 1) * 100)) : 0;
export function gauge(request, meta) {
  const measured = request?.measuredTokens != null;
  const total = measured ? request.measuredTokens : request?.estTokens ?? 0;
  return { total, measured, percent: Math.max(0, Math.min(100, total / meta.window * 100)),
    compactPercent: Math.max(0, Math.min(100, limitOf(meta) / meta.window * 100)) };
}
export function eventLabel(event) {
  const names = event.data?.names?.join(', ');
  let label = `${event.type === 'compaction' ? 'Compaction' : event.label || event.type.replaceAll('_', ' ')}${names ? ': ' + names : ''}`;
  if (event.data?.removed?.length) label += `; removed: ${event.data.removed.join(', ')}`;
  if (event.type === 'compaction') label += `: ${formatTokens(event.data?.preTokens)} before, ${formatTokens(event.data?.postTokens)} after`;
  if (event.data?.afterLast) label += ' (after last request)';
  return label;
}
// Bound SVG complexity for long sessions while retaining every local min/max drop.
export function sparkPoints(requests, windowSize, width = 600, height = 40, xAt = i => markerPercent(i, requests.length) * width / 100) {
  const points = [];
  const step = Math.max(1, Math.ceil(requests.length / width));
  const value = i => requests[i].measuredTokens ?? requests[i].estTokens;
  for (let start = 0; start < requests.length; start += step) {
    const end = Math.min(requests.length, start + step);
    let min = start, max = start;
    for (let i = start + 1; i < end; i++) {
      if (value(i) < value(min)) min = i;
      if (value(i) > value(max)) max = i;
    }
    for (const i of [...new Set([start, min, max, end - 1])].sort((a, b) => a - b)) {
      points.push(`${xAt(i)},${height * (1 - Math.min(1, value(i) / windowSize))}`);
    }
  }
  return points.join(' ');
}

// Read prompt text from the shared block table, never an event's stale label.
export function requestStories(session) {
  let prompt = '';
  const compactions = new Map(session.events.filter(e => e.type === 'compaction' && !e.data?.afterLast).map(e => [e.requestIdx, e]));
  return session.requests.map((r, idx) => {
    const added = r.newBlockIds.map(id => session.blocks[id]).filter(Boolean);
    for (const b of added) if (b.kind === 'user_text' && !compactions.has(idx)) prompt = (b.text || '').slice(0, 512).replace(/\s+/g, ' ').trim().slice(0, 60);
    const compact = compactions.get(idx);
    const largest = added.reduce((a, b) => (a?.estTokens ?? -1) > b.estTokens ? a : b, null);
    const tokens = added.reduce((n, b) => n + b.estTokens, 0) * (r.measuredTokens != null && r.estTokens ? r.measuredTokens / r.estTokens : 1);
    const news = compact ? `Compaction: ${formatTokens(compact.data.preTokens)} to ${formatTokens(compact.data.postTokens)}`
      : `+${added.length} blocks, ${formatTokens(tokens)} tokens${largest ? ': ' + (largest.label || largest.kind).slice(0, 80) : ''}`;
    return { caption: `Request ${idx + 1}. ${prompt || 'No user prompt recorded'}${/[.!?]$/.test(prompt) ? '' : '.'} ${news}`, compacted: !!compact };
  });
}
export function fuelState(total, limit, compacted = false) {
  const fill = Math.max(0, Math.min(1, total / limit));
  const stops = [0, .5, .74, 1], colors = [[36,55,80],[83,55,95],[150,81,48],[168,42,54]];
  let i = 0; while (i < 2 && fill > stops[i + 1]) i++;
  const t = (fill - stops[i]) / (stops[i + 1] - stops[i]);
  return { fill, color: `rgb(${colors[i].map((v, j) => Math.round(v + (colors[i + 1][j] - v) * t)).join(',')})`,
    status: compacted ? 'Compacted' : fill >= .85 ? 'Nearly full' : fill >= .5 ? 'Filling up' : 'Plenty of room' };
}

// All usage remains measured; missing usage is omitted as in sessionCache.
export function wholeSessionCache(session) {
  return sessionCache([session, ...(session.agents ?? []).map(a => a.session)].flatMap(s => s.requests));
}

// Interpolate absent request times and keep transcript clock corrections monotone.
export function timelineTimes(times) {
  const valid = times.map((t, i) => Number.isFinite(t) ? i : -1).filter(i => i >= 0);
  if (valid.length < 2) return times.map((_, i) => i);
  const filled = [...times];
  let nextValid = 0;
  for (let i = 0; i < times.length; i++) {
    while (nextValid < valid.length && valid[nextValid] < i) nextValid++;
    if (Number.isFinite(times[i])) continue;
    const right = valid[nextValid], left = valid[nextValid - 1];
    filled[i] = left == null ? times[right] : right == null ? times[left] : times[left] + (times[right] - times[left]) * (i - left) / (right - left);
  }
  for (let i = 1; i < filled.length; i++) filled[i] = Math.max(filled[i - 1], filled[i]);
  return filled;
}
