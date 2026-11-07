import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheSplit, sessionCache } from '../src/ui/math.js';

test('cacheSplit separates read, written and uncached input of one request', () => {
  const c = cacheSplit({ input: 2, cacheRead: 49416, cacheWrite: 17832, output: 12213 });
  assert.deepEqual([c.read, c.write, c.uncached, c.total], [49416, 17832, 2, 67250]);
  assert.ok(Math.abs(c.hitRate - 49416 / 67250) < 1e-12);
  assert.equal(cacheSplit(null), null);
  assert.equal(cacheSplit({ input: 0, cacheRead: 0, cacheWrite: 0 }), null);
});

test('sessionCache sums requests that reported usage and skips the rest', () => {
  const s = sessionCache([{ usage: { input: 10, cacheRead: 80, cacheWrite: 10 } }, { usage: null }, { usage: { input: 0, cacheRead: 100, cacheWrite: 0 } }]);
  assert.deepEqual([s.read, s.write, s.uncached, s.total, s.requests], [180, 10, 10, 200, 2]);
  assert.equal(s.hitRate, .9);
  assert.equal(sessionCache([{ usage: null }]), null);
});
