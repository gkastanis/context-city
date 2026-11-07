import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestScheduler } from '../src/ui/request-scheduler.js';

test('scene scheduler coalesces, waits for completion and a rendered frame, and lands on final change', async () => {
  let next = 0, completed;
  const frames = new Map(), timers = new Map(), calls = [];
  const scheduler = createRequestScheduler(value => {
    calls.push(value); return new Promise(resolve => { completed = resolve; });
  }, {
    raf: fn => { const id = ++next; frames.set(id, fn); return id; },
    cancelRaf: id => frames.delete(id),
    delay: fn => { const id = ++next; timers.set(id, fn); return id; },
    cancelDelay: id => timers.delete(id), now: () => 0,
  });
  const step = async queue => {
    const entries = [...queue]; queue.clear();
    for (const [, fn] of entries) fn();
    await Promise.resolve();
  };
  scheduler.request(1); scheduler.request(2); scheduler.request(3);
  await step(timers); await step(frames);
  assert.deepEqual(calls, [3]);
  scheduler.request(4); scheduler.request(5, true);
  await step(timers); await step(frames);
  assert.deepEqual(calls, [3], 'one call in flight');
  completed(); await Promise.resolve();
  await step(frames);
  assert.deepEqual(calls, [3], 'first frame after completion must render');
  await step(frames); await step(timers); await step(frames);
  assert.deepEqual(calls, [3, 5], 'final settled value survives coalescing');
  completed(); await Promise.resolve();
  scheduler.reset(); await step(frames); await step(timers);
  assert.deepEqual(calls, [3, 5]);
});
