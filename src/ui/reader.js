import { el, button } from './dom.js';
import { formatTokens } from './math.js';

export function createReaderPane(enter) {
  const title = el('h2', {}, 'Read the context');
  const metadata = el('p', { class: 'muted' }), badge = el('p', { class: 'provenance' });
  const content = el('pre', { class: 'reader-text', id: 'block-text' });
  const params = el('div', { class: 'parameters' });
  const description = el('p', { class: 'reader-description' });
  let block = null, offset = 0, redacted = false;
  const positions = new Map();
  const more = button('Show more', () => append());
  const inside = button('Enter this block', () => block && enter(block.id), { id: 'enter-block' });
  const scroll = el('div', { class: 'reader-scroll' }, title, metadata, badge, inside, description, params, content, more);
  const root = el('aside', { id: 'reader-panel', class: 'card panel', 'aria-label': 'Reading pane' }, scroll);
  function append() {
    const end = Math.min(block.text?.length ?? 0, offset + 200 * 1024);
    content.append(document.createTextNode((block.text ?? '').slice(offset, end)));
    offset = end; more.hidden = offset >= (block.text?.length ?? 0);
    more.textContent = `Show more (${formatTokens((block.text?.length ?? 0) - offset)} characters left)`;
  }
  return { root, reset(isRedacted = false) { redacted = isRedacted; positions.clear(); block = undefined; }, show(value, tokens) {
    if (block === value) {
      if (block) metadata.textContent = `${block.kind} · ${formatTokens(tokens)} tokens, estimated block share`;
      return;
    }
    if (block) positions.set(block.id, { offset, top: root.scrollTop });
    const saved = positions.get(value?.id);
    block = value; offset = 0; content.replaceChildren(); params.replaceChildren(); description.textContent = '';
    root.scrollTop = 0; inside.disabled = !block; more.hidden = true;
    if (!block) { title.textContent = 'Read the context'; metadata.textContent = ''; badge.classList.remove('redacted'); badge.textContent = 'Select a building or a block in the index.'; return; }
    title.textContent = block.label;
    metadata.textContent = `${block.kind} · ${formatTokens(tokens)} tokens, estimated block share`;
    badge.textContent = block.provenance === 'unavailable'
      ? redacted ? `Redacted: text removed before publishing. Original length ${block.chars} characters.` : 'Unavailable: the transcript does not hold this text, size only.'
      : block.provenance === 'reconstructed' ? `Reconstructed: ${block.note || 'Recovered from transcript records.'}` : redacted ? "Verbatim: published with the owner's approval." : 'Verbatim';
    badge.classList.toggle('redacted', redacted && block.provenance === 'unavailable');
    if (block.note && block.provenance !== 'reconstructed' && !redacted) badge.append(document.createTextNode(` ${block.note}`));
    if (block.kind === 'tool_def') {
      try { description.textContent = JSON.parse(block.text).description || 'Description unavailable.'; }
      catch { description.textContent = 'Description unavailable. See the recorded text below.'; }
      if (block.params?.length) {
        const table = el('table', {}, el('caption', {}, 'Tool parameters'),
          el('thead', {}, el('tr', {}, ...['Name', 'Type', 'Required', 'Description'].map(t => el('th', { scope: 'col' }, t)))));
        const body = el('tbody');
        let shown = 0;
        const addRows = () => {
          for (const p of block.params.slice(shown, shown + 100)) body.append(el('tr', {},
            ...[p.name, Array.isArray(p.type) ? p.type.join(', ') : p.type || 'unknown', p.required ? 'Yes' : 'No', p.description || 'Description unavailable.'].map(t => el('td', {}, String(t)))));
          shown += 100; rowsMore.hidden = shown >= block.params.length;
        };
        const rowsMore = button('Show more parameters', addRows);
        table.append(body); params.append(table, rowsMore); addRows();
      }
    }
    append();
    if (saved && block.text) {
      const end = Math.min(saved.offset, block.text.length);
      if (end > offset) { content.append(document.createTextNode(block.text.slice(offset, end))); offset = end; }
      more.hidden = offset >= block.text.length;
      more.textContent = `Show more (${formatTokens(block.text.length - offset)} characters left)`;
      root.scrollTop = saved.top;
    }
  } };
}
