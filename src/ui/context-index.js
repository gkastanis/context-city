import { el, button } from './dom.js';
import { formatTokens } from './math.js';
import { LAYERS } from '../scene/theme.js';

export function createContextIndex({ fly, enter, filter }) {
  const filters = el('details', {}, el('summary', {}, 'Layers'));
  for (const [layer, info] of Object.entries(LAYERS)) {
    const input = el('input', { type: 'checkbox', id: `layer-${layer}`, checked: true,
      onchange: () => filter(layer, input.checked) });
    filters.append(el('label', { class: 'layer-check', for: `layer-${layer}` }, input,
      el('i', { class: `dot layer-${layer}` }), info.label));
  }
  const note = el('p', { class: 'muted' });
  const list = el('div', { id: 'context-districts' });
  const root = el('aside', { id: 'index-panel', class: 'card panel', 'aria-label': 'Context index' },
    el('h2', {}, 'Context in order'), note, filters, list);
  let selected = null, hover = null, markedSelected = null, markedHover = null;
  let rows = new Map(), districts = [], items, session, shown = 0, pageStart = 0;
  const districtForBlock = new Map();
  const locations = new Map(), expanded = new Set();
  function mark() {
    const active = new Set([markedSelected, markedHover, selected, hover]);
    for (const id of active) {
      const i = districtForBlock.get(id), location = locations.get(i);
      if (location) {
        location.details.classList.toggle('active-district', i === districtForBlock.get(selected) || i === districtForBlock.get(hover));
      }
    }
    for (const id of active) for (const row of rows.get(id) ?? []) {
      row.classList.toggle('selected', id === selected);
      row.classList.toggle('hovered', id === hover);
      row.setAttribute('aria-current', id === selected ? 'true' : 'false');
    }
    markedSelected = selected; markedHover = hover;
  }
  const previousDistricts = button('Previous districts', () => showDistrictPage(Math.max(0, pageStart - 100)));
  const moreDistricts = button('Next districts', () => showDistrictPage(pageStart + 100));
  function showDistrictPage(start) {
    pageStart = start; shown = start; rows = new Map(); locations.clear();
    list.replaceChildren(previousDistricts, moreDistricts); addDistricts(); mark();
  }
  function addDistricts() {
    const end = Math.min(districts.length, shown + 100);
    for (; shown < end; shown++) {
      const d = districts[shown], index = shown;
      const details = el('details', { class: 'district' });
      if (expanded.has(index)) details.open = true;
      details.append(el('summary', {}, el('i', { class: `dot layer-${d.layer}` }),
        `${d.label} · ${d.blockIds.length} blocks · ${formatTokens((d.z1 - d.z0) * 100)}`));
      const body = el('div'), more = button('Next blocks', () => addRows());
      const previous = button('Previous blocks', () => addRows(Math.max(0, count - 300)));
      let count = 0;
      const addRows = (start = count) => {
        // Keep a bounded page even for one district with 50,000 results.
        for (const row of body.querySelectorAll('.block-row')) {
          const id = row.dataset.block;
          rows.set(id, (rows.get(id) ?? []).filter(node => node !== row));
          if (!rows.get(id).length) rows.delete(id);
        }
        body.replaceChildren();
        const fragment = document.createDocumentFragment();
        for (const id of d.blockIds.slice(start, start + 150)) {
          const block = session.blocks[id], item = items.get(id);
          const row = button('', () => fly(id), { class: 'block-row', 'data-block': id, title: 'Click to fly. Enter or double click to enter.' });
          row.append(el('i', { class: `dot layer-${block.layer}` }), el('span', { class: 'block-name' }, block.label,
            el('small', {}, `${block.kind}${item.isNew ? ' · new' : ''}`)), el('span', { class: 'token-count' }, formatTokens((item.z1 - item.z0) * 100)));
          row.addEventListener('dblclick', () => enter(id));
          row.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); enter(id); } });
          if (!rows.has(id)) rows.set(id, []); rows.get(id).push(row);
          fragment.append(row);
        }
        body.append(fragment); count = start + 150;
        previous.hidden = start === 0; more.hidden = count >= d.blockIds.length; mark();
      };
      details.addEventListener('toggle', () => {
        if (details.open) { expanded.add(index); if (!count) addRows(); }
        else expanded.delete(index);
      });
      details.append(body, previous, more); previous.hidden = true; more.hidden = true;
      list.insertBefore(details, moreDistricts);
      if (details.open) addRows();
      locations.set(index, { details, addRows, get count() { return count; } });
    }
    moreDistricts.hidden = shown >= districts.length;
    previousDistricts.hidden = pageStart === 0;
  }
  return { root,
    reset() {
      expanded.clear(); selected = null; hover = null; pageStart = 0;
      for (const input of filters.querySelectorAll('input')) input.checked = true;
    },
    render(value, layout) {
      session = value; districts = layout.districts;
      districtForBlock.clear();
      districts.forEach((district, i) => district.blockIds.forEach(id => districtForBlock.set(id, i)));
      items = new Map(layout.items.map(item => [item.blockId, item]));
      note.textContent = layout.measured ? 'Block tokens are estimates scaled to the measured total.' : 'Block tokens are estimates. No measured total for this request.';
      showDistrictPage(Math.min(pageStart, Math.floor(Math.max(0, districts.length - 1) / 100) * 100));
    },
    highlight(id, isHover = false) { if (isHover) hover = id; else selected = id; mark(); },
    reveal(id) {
      const index = districtForBlock.get(id);
      if (index == null) return;
      if (index < pageStart || index >= shown) showDistrictPage(Math.floor(index / 100) * 100);
      const location = locations.get(index), position = districts[index].blockIds.indexOf(id);
      location.details.open = true; expanded.add(index);
      if (!rows.has(id)) location.addRows(Math.floor(position / 150) * 150);
      rows.get(id)?.[0]?.scrollIntoView({ block: 'nearest' });
    },
  };
}
