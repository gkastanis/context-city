import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, splitText, rules } from '../src/classify.js';

test('ordered data rules recognise context sources', () => {
  const cases = [
    ['Contents of /imaginary/CLAUDE.md: pretend rules', 'user_instructions', 'CLAUDE.md'],
    ['Contents of /imaginary/MEMORY.md: pretend index', 'memory', 'Memory index'],
    ['Contents of /imaginary/MEMORY.md (synthetic): index', 'memory', 'Memory index'],
    ['## Skills\nAvailable skills', 'menus', 'Skills'],
    ['The following agents are available', 'menus', 'Agents'],
    ['<available-deferred-tools>mcp__demo__lookup</available-deferred-tools>', 'menus', 'Deferred tools'],
    ['# MCP Server Instructions\nSynthetic guidance', 'mcp', 'MCP instructions'],
    ['<environment_context>Imaginary platform</environment_context>', 'harness', 'Environment'],
    ["Today's date is 2026-01-01", 'harness', 'Date'],
    ['A generic synthetic harness reminder', 'harness', 'Harness reminder'],
  ];
  for (const [text, layer, label] of cases) {
    assert.deepEqual(classify(text, { reminder: true }), { kind: 'reminder', layer, label });
  }
  assert.ok(rules.every(r => r.test instanceof RegExp && r.kind && r.layer && r.label));
});

test('split reminders losslessly in place, including adjacent and multiline sections', () => {
  const text = 'Before <system-reminder>Today\'s date is 2026-01-01\n</system-reminder><system-reminder>Generic</system-reminder> after';
  const pieces = splitText(text);
  assert.equal(pieces.map(p => p.text).join(''), text);
  assert.deepEqual(pieces.map(p => p.kind), ['user_text', 'reminder', 'reminder', 'user_text']);
  assert.deepEqual(pieces.map(p => p.label), ['User', 'Date', 'Harness reminder', 'User']);
});

test('ordinary prose, assistant quotations and unclosed tags stay intact', () => {
  assert.equal(classify('Please explain MEMORY.md').kind, 'user_text');
  assert.equal(splitText('<system-reminder>unfinished')[0].kind, 'user_text');
  assert.equal(splitText('<system-reminder>quote</system-reminder>', 'assistant')[0].kind, 'assistant_text');
  assert.deepEqual(classify('Synthetic prefix', { role: 'system' }), { kind: 'system', layer: 'system', label: 'System' });
  assert.equal(classify('# MCP Server Instructions', { role: 'system' }).layer, 'mcp');
});

const { systemBlob, memoryReminder } = await import('./fixtures/review-cases.mjs');

test('large system blob splits all harness sections losslessly with separate labels', () => {
  const parts = splitText(systemBlob, 'system');
  assert.equal(parts.map(p => p.text).join(''), systemBlob);
  assert.deepEqual(parts.map(p => [p.layer, p.label]), [
    ['harness', 'Environment'], ['menus', 'Deferred tools'], ['menus', 'Agents'], ['mcp', 'MCP instructions'], ['menus', 'Skills'],
  ]);
  assert.ok(parts.every(p => p.kind === 'system'));
});

test('CLAUDE reminder splits each Contents section; core memory instructions stay system', () => {
  const parts = splitText(memoryReminder);
  assert.equal(parts.map(p => p.text).join(''), memoryReminder);
  assert.deepEqual(parts.filter(p => p.layer !== 'harness').map(p => p.layer), ['user_instructions', 'memory', 'memory']);
  assert.equal(classify('Synthetic core instructions\n# Memory\nRead MEMORY.md when needed.', { role: 'system' }).layer, 'system');
  assert.equal(classify('A mention of MEMORY.md', { reminder: true }).layer, 'harness');
});
