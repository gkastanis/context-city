import test from 'node:test';
import assert from 'node:assert/strict';
import { prettyJson, jsonTokens, looksJson } from '../src/scene/paging.js';

test('prettyJson formats whole JSON and a trailing JSON section, leaves prose alone', () => {
  assert.equal(prettyJson('{"a":1,"b":[true,null]}'), '{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}');
  assert.equal(prettyJson('Make a card.\n\n{"name":"x"}'), 'Make a card.\n\n{\n  "name": "x"\n}');
  assert.equal(prettyJson('Plain words {not json'), 'Plain words {not json');
  assert.equal(prettyJson('{broken'), '{broken');
});

test('jsonTokens colours keys, strings, numbers, literals and punctuation and keeps every character', () => {
  const line = '  "name": "x, y", "n": -1.5e3, "ok": true, "z": null}';
  const runs = jsonTokens(line);
  assert.equal(runs.map(r => r.text).join(''), line);
  const kinds = t => runs.find(r => r.text === t)?.kind;
  assert.equal(kinds('"name"'), 'key');
  assert.equal(kinds('"x, y"'), 'string');
  assert.equal(kinds('-1.5e3'), 'number');
  assert.equal(kinds('true'), 'literal');
  assert.equal(kinds('null'), 'literal');
  assert.equal(kinds('}'), 'punct');
});

test('a string cut by wrapping is closed by the end of the line', () => {
  const runs = jsonTokens('  "description": "Identifier of the made-up');
  assert.equal(runs.at(-1).kind, 'string');
  assert.equal(runs.map(r => r.text).join(''), '  "description": "Identifier of the made-up');
});

test('wrapCode gives long JSON lines a hanging indent and leaves prose to wrapPixels', async () => {
  const { wrapCode, CONTINUED } = await import('../src/scene/paging.js');
  const measure = s => s.replaceAll(CONTINUED, '').length * 10;
  const lines = wrapCode('Some prose here\n    "description": "one two three four five six seven eight"', 300, measure);
  assert.equal(lines[0], 'Some prose here');
  assert.ok(lines[1].startsWith('    "description":'));
  for (const line of lines.slice(2)) { assert.ok(line.startsWith('      ' + CONTINUED)); assert.ok(measure(line) <= 300); }
  assert.equal(lines.slice(1).map(l => l.replace(/^ *​?/, '')).join(' ').replace(/ +/g, ' ').trim(),
    '"description": "one two three four five six seven eight"');
});

test('looksJson spots JSON lines and skips prose', () => {
  assert.ok(looksJson('  "a": 1'));
  assert.ok(looksJson('{'));
  assert.ok(looksJson('  ]'));
  assert.ok(!looksJson('Add a reference card'));
});
