// Scene work is synchronous today. Also await a future asynchronous implementation.
// Two frame boundaries guarantee a paint opportunity after each completed call.
export function createRequestScheduler(apply, { raf = requestAnimationFrame, cancelRaf = cancelAnimationFrame,
  delay = setTimeout, cancelDelay = clearTimeout, now = () => performance.now() } = {}) {
  let lastApplied = null;
  let pending = null, busy = false, generation = 0, timer = 0, frame = 0, urgent = false, cost = 0;
  function schedule() {
    if (busy || timer || frame || pending == null) return;
    timer = delay(() => { timer = 0; frame = raf(run); }, urgent ? 0 : Math.max(80, cost * 2));
  }
  async function run() {
    frame = 0;
    if (pending == null) return;
    busy = true;
    const value = pending, epoch = generation; pending = null; urgent = false;
    const started = now();
    try { await apply(value); lastApplied = value; if (pending === value) pending = null; }
    finally {
      cost = now() - started;
      if (epoch !== generation) return;
      frame = raf(() => { frame = raf(() => { frame = 0; busy = false; schedule(); }); });
    }
  }
  return {
    request(value, settled = false) {
      if (!busy && value === lastApplied && pending == null) return;
      pending = value; urgent ||= settled;
      if (settled && timer) { cancelDelay(timer); timer = 0; }
      schedule();
    },
    reset() {
      generation++; cancelDelay(timer); cancelRaf(frame); timer = 0; frame = 0;
      pending = null; lastApplied = null; busy = false; urgent = false;
    },
  };
}
