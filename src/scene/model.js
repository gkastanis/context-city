import { layoutRequest } from '../layout.js';

export function eventLayout(session, event) {
  if (!session.requests[event.requestIdx] || event.data?.afterLast) return null;
  const layout = layoutRequest(session, event.requestIdx);
  const ids = new Set(session.requests[event.requestIdx].newBlockIds);
  return { ...layout, targets: layout.items.filter(it => ids.has(it.blockId)) };
}

export function overviewRange(layout, whole = false) {
  const high = Math.max(12, ...layout.items.map(it => it.height));
  const z1 = layout.totalTokens * .01;
  return { z0: whole || z1 <= high * 10 ? 0 : Math.max(0, z1 - high * 8), z1, high };
}

export function createQualityMonitor(change, initial = 'high') {
  let quality = initial, explicitLow = false, average = 1 / 60, slow = 0, fast = 0;
  function set(level, explicit = false) {
    if (explicit) explicitLow = level === 'low';
    slow = fast = 0; average = 1 / 60;
    if (level !== quality) { quality = level; change(level); }
  }
  return { set, sample(elapsed) {
    if (elapsed > .25) { slow = fast = 0; average = 1 / 60; return; }
    average += (elapsed - average) * (1 - Math.exp(-elapsed * 3));
    slow = average > .033 ? slow + elapsed : 0;
    fast = elapsed < .020 ? fast + elapsed : 0;
    if (quality === 'high' && slow > 3) set('low');
    else if (quality === 'low' && !explicitLow && fast >= 10) set('high');
  } };
}
