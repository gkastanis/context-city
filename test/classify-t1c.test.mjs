import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, splitText } from '../src/classify.js';
import { mention } from './fixtures/t1c-cases.mjs';
test('M2: core prompt mentions remain system; section rules require a section start', () => {
  for (const text of [mention, ...['deferred tools', 'available skills', 'available agents', '# MCP Server Instructions', '# Environment', "Today's date"].map(t => `Synthetic core prose mentions ${t} mid-text.`)]) {
    assert.equal(classify(text, { role: 'system' }).layer, 'system');
    assert.deepEqual(splitText(text, 'system').map(p => p.layer), ['system']);
  }
  assert.equal(classify('<system-reminder>deferred tools: Synthetic</system-reminder>', { reminder: true }).layer, 'menus');
});
