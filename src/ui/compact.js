const requestTapes = new WeakMap();

// Wire format: one shared blocks table and transferred integer request deltas.
// Each tape entry is [keep, addCount, newCount, ...add, ...newBlockIds].
export function compactSession(session) {
  const ids = Object.keys(session.blocks), indices = new Map(ids.map((id, i) => [id, i]));
  // A missing id must fail loudly, not become index 0 and show the wrong block.
  const indexOf = id => {
    const n = indices.get(id);
    if (n === undefined) throw new Error(`Missing block ${id}`);
    return n;
  };
  const offsets = new Int32Array(session.requests.length + 1);
  const chunks = [];
  let previous = [];
  const requests = session.requests.map((request, i) => {
    const { blockIds, newBlockIds, ...metadata } = request;
    let keep = 0;
    while (keep < previous.length && keep < blockIds.length && previous[keep] === blockIds[keep]) keep++;
    const addCount = blockIds.length - keep;
    const chunk = new Int32Array(3 + addCount + newBlockIds.length);
    chunk[0] = keep; chunk[1] = addCount; chunk[2] = newBlockIds.length;
    for (let j = keep; j < blockIds.length; j++) chunk[3 + j - keep] = indexOf(blockIds[j]);
    for (let j = 0; j < newBlockIds.length; j++) chunk[3 + addCount + j] = indexOf(newBlockIds[j]);
    offsets[i + 1] = offsets[i] + chunk.length; chunks.push(chunk); previous = blockIds;
    return metadata;
  });
  const tape = new Int32Array(offsets[offsets.length - 1]);
  chunks.forEach((chunk, i) => tape.set(chunk, offsets[i]));
  return { meta: session.meta, blocks: session.blocks, events: session.events, requests, ids, offsets, tape };
}

export function expandSession(wire, cacheLimit = 8) {
  const { ids, offsets } = wire;
  const tape = wire.tape instanceof Int32Array ? wire.tape : new Int32Array(wire.tape);
  const cache = new Map();
  function materialize(idx) {
    if (cache.has(idx)) {
      const value = cache.get(idx); cache.delete(idx); cache.set(idx, value); return value;
    }
    let start = 0, blockIds = [];
    // Start from the closest preceding cached request; do not cache intermediate prefixes.
    let nearest = -1;
    for (const key of cache.keys()) if (key < idx && key > nearest) nearest = key;
    if (nearest >= 0) { blockIds = cache.get(nearest).blockIds.slice(); start = nearest + 1; }
    for (let i = start; i <= idx; i++) {
      const at = offsets[i], keep = tape[at], count = tape[at + 1];
      blockIds.length = keep;
      for (let j = 0; j < count; j++) blockIds.push(ids[tape[at + 3 + j]]);
    }
    const at = offsets[idx], addCount = tape[at + 1], newCount = tape[at + 2];
    const newBlockIds = Array.from(tape.subarray(at + 3 + addCount, at + 3 + addCount + newCount), n => ids[n]);
    // Callers share cached arrays, so they must not be able to mutate them.
    const value = { blockIds: Object.freeze(blockIds), newBlockIds: Object.freeze(newBlockIds) };
    cache.set(idx, value);
    while (cache.size > cacheLimit) cache.delete(cache.keys().next().value);
    return value;
  }
  const requests = wire.requests.map((metadata, i) => Object.defineProperties(metadata, {
    blockIds: { enumerable: true, get: () => materialize(i).blockIds },
    newBlockIds: { enumerable: true, get: () => materialize(i).newBlockIds },
  }));
  const session = { meta: wire.meta, blocks: wire.blocks, events: wire.events, requests };
  requestTapes.set(session, { ids, offsets, tape });
  return session;
}

// Quest navigation must not materialize thousands of cumulative histories.
// The first occurrence of an id is always in a delta's added tail.
export function findBlockRequest(session, id) {
  const wire = requestTapes.get(session);
  if (!wire) return session.requests.findIndex(request => request.blockIds.includes(id));
  const index = wire.ids.indexOf(id);
  if (index < 0) return -1;
  for (let i = 0; i < wire.offsets.length; i++) {
    const at = wire.offsets[i], count = wire.tape[at + 1];
    for (let j = 0; j < count; j++) if (wire.tape[at + 3 + j] === index) return i;
  }
  return -1;
}
