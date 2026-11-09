import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeAction, panelState } from '../src/ui/overlay-state.js';

const layers = { dialog: true, findings: true, menu: true, zoom: true,
  mode: 'inside', narrow: true, panels: ['index-panel', 'field-guide', 'reader-panel'] };
for (const [name, overrides, expected] of [
  ['native dialog first', {}, 'dialog'],
  ['Findings before Menu', { dialog: false }, 'findings'],
  ['Menu before zoom', { dialog: false, findings: false }, 'menu'],
  ['zoom before scene', { dialog: false, findings: false, menu: false }, 'zoom'],
  ['inside before sheets', { dialog: false, findings: false, menu: false, zoom: false }, 'inside'],
  ['reading before sheets', { dialog: false, findings: false, menu: false, zoom: false, mode: 'reading' }, 'reading'],
  ['newest narrow sheet', { dialog: false, findings: false, menu: false, zoom: false, mode: 'city' }, 'reader-panel'],
  ['wide layout stays open', { dialog: false, findings: false, menu: false, zoom: false, mode: 'city', narrow: false }, null],
]) test(`Escape: ${name}`, () => assert.equal(escapeAction({ ...layers, ...overrides }), expected));

test('Escape with no layers does nothing', () => assert.equal(escapeAction(), null));
for (const [name, state, expected] of [
  ['selection-opened desktop Reader', { panels: ['reader-panel'], readerOpenedBy: 'select' }, 'reader-panel'],
  ['nav-opened desktop Reader', { panels: ['reader-panel'], readerOpenedBy: 'nav' }, null],
  ['closed Reader with selection origin', { panels: ['index-panel'], readerOpenedBy: 'select' }, null],
  ['inside before selection-opened Reader', { mode: 'inside', panels: ['reader-panel'], readerOpenedBy: 'select' }, 'inside'],
  ['reading before selection-opened Reader', { mode: 'reading', panels: ['reader-panel'], readerOpenedBy: 'select' }, 'reading'],
  ['newer narrow sheet before selection-opened Reader', { narrow: true, panels: ['reader-panel', 'field-guide'], readerOpenedBy: 'select' }, 'field-guide'],
  ['narrow nav Reader still closes', { narrow: true, panels: ['reader-panel'], readerOpenedBy: 'nav' }, 'reader-panel'],
]) test(`Escape: ${name}`, () => assert.equal(escapeAction(state), expected));
test('narrow Index then Reader leaves only Reader open', () => {
  const index = panelState([], 'index-panel', true, true);
  assert.deepEqual(index, ['index-panel']);
  const reader = panelState(index, 'reader-panel', true, true);
  assert.deepEqual(reader, ['reader-panel']);
  assert.deepEqual(index, ['index-panel']);
  assert.deepEqual(panelState(reader, 'reader-panel', false, true), []);
});
test('wide panels retain opening order without duplicates', () => {
  const panels = panelState(['reader-panel', 'index-panel'], 'reader-panel', true, false);
  assert.deepEqual(panels, ['index-panel', 'reader-panel']);
  assert.deepEqual(panelState(panels, 'index-panel', false, false), ['reader-panel']);
});
