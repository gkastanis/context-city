// Boundary-limited playback: unused time is carried as token debt. Even at
// extreme speed, each block owns at least one rendered frame and callback.
export function createReader(report, onEnd = () => {}) {
  let items = [], index = 0, token = 0, debt = 0, speed = 220, paused = true;
  function emit() { if (items[index]) report({ blockId: items[index].blockId, token }); }
  return {
    start(layout, from = 0) {
      items = layout.items; debt = 0; paused = false;
      token = Math.max(0, Math.min(layout.totalTokens, from));
      index = token === 0 ? 0 : items.findIndex(it => it.z1 * 100 > token);
      if (index < 0) index = Math.max(0, items.length - 1);
      emit();
    },
    tick(dt) {
      if (paused) return null;
      if (!items.length) { paused = true; onEnd(); return null; }
      debt += speed * dt;
      const end = items[index].z1 * 100;
      if (token >= end && index < items.length - 1) {
        index++; token = items[index].z0 * 100;
      }
      const step = Math.min(debt, Math.max(0, items[index].z1 * 100 - token));
      token += step; debt -= step; emit();
      if (index === items.length - 1 && token >= items[index].z1 * 100) { paused = true; debt = 0; onEnd(); }
      return { token, item: items[index] };
    },
    getState() { return { token, paused }; },
    pause() { paused = true; }, resume() { paused = false; },
    stop() { paused = true; items = []; index = 0; token = 0; debt = 0; },
    setSpeed(value) { if (!Number.isFinite(value) || value <= 0) throw new RangeError('Speed must be positive'); speed = value; },
  };
}
