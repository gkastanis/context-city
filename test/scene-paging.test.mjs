import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapText, chunkPages, hallPage } from '../src/scene/paging.js';

test('160 KB text has twelve content pages and one continuation', () => {
  const text = 'Large synthetic result. '.repeat(8000).slice(0, 160000);
  assert.equal(Buffer.byteLength(text), 160000);
  const pages = chunkPages(text);
  assert.equal(pages.length, 13);
  assert.ok(pages.slice(0, 12).every(p => p.length === 18));
  assert.equal(pages[12][0], 'Continues in the reader pane');
});

test('content page counts at line and character boundaries', () => {
  for (const [lines, expected] of [[1,1], [18,1], [19,2], [198,11], [216,12], [217,13], [1000,13]]) {
    assert.equal(chunkPages(Array(lines).fill('line').join('\n')).length, expected, `${lines} lines`);
  }
  assert.deepEqual(wrapText('a'.repeat(69)), ['a'.repeat(68), 'a']);
  assert.equal(wrapText('a'.repeat(160000), 68, 217).length, 217);
  assert.deepEqual(wrapText('one\n\nthree'), ['one', '', 'three']);
  assert.equal(chunkPages('').length, 1);
});

test('hall pages have at most 22 block doors and exactly two navigation doors', () => {
  const ids = Array.from({ length: 3000 }, (_, i) => `block:${i}`), all = [];
  for (let page = 0; page < Math.ceil(ids.length / 22); page++) {
    const result = hallPage(ids, page);
    assert.ok(result.ids.length <= 22);
    assert.equal(result.navigationDoors, 2);
    assert.ok(result.ids.length + result.navigationDoors <= 24);
    assert.equal(result.back, page > 0);
    assert.equal(result.more, page < result.pageCount - 1);
    all.push(...result.ids);
  }
  assert.deepEqual(all, ids);
});

test('hall page counts and clamping at boundaries', () => {
  for (const [count, pages, last] of [[0,1,0], [1,1,1], [21,1,21], [22,1,22], [23,2,1], [44,2,22], [45,3,1]]) {
    const ids = Array.from({ length: count }, (_, i) => i);
    assert.equal(hallPage(ids).pageCount, pages);
    assert.equal(hallPage(ids, 100).page, pages - 1);
    assert.equal(hallPage(ids, 100).ids.length, last);
    assert.equal(hallPage(ids, -1).page, 0);
  }
});
