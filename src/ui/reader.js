import { el, button } from './dom.js';
import { formatTokens } from './math.js';
import { issueMarkdown, resultText, toolIdentity } from './tools.js';

export function createReaderPane(enter, { linked = () => null, openRun = () => {}, toolContext = () => null, navigateTool = () => {}, stepTool = () => {}, backToList = () => {} } = {}) {
  const title = el('h2', {}, 'Read the context');
  const metadata = el('p', { class: 'muted' }), badge = el('p', { class: 'provenance' });
  const failed = el('span', { class: 'failed-chip', hidden: true }, 'Failed');
  let copyTimer = null;
  const diagnostics = el('div', { class: 'reader-diagnostics', hidden: true });
  const content = el('pre', { class: 'reader-text', id: 'block-text' });
  const params = el('div', { class: 'parameters' });
  const description = el('p', { class: 'reader-description' });
  let block = null, offset = 0, redacted = false;
  const verbatim = el('details', { class: 'reader-verbatim', hidden: true }, el('summary', {}, 'Verbatim'));
  const errorMessage = el('pre', { class: 'reader-text reader-error', hidden: true });
  const positions = new Map();
  const more = button('Show more', () => append());
  const inside = button('Enter this block', () => block && enter(block.id), { id: 'enter-block' });
  const agentButton = button('Open this subagent run', () => { const run = linked(block); if (run) openRun(run); }, { id: 'open-subagent', hidden: true });
  const scroll = el('div', { class: 'reader-scroll' }, title, failed, diagnostics, metadata, badge, inside, agentButton, description, params, errorMessage, content, more, verbatim);
  const root = el('aside', { id: 'reader-panel', class: 'card panel', 'aria-label': 'Reading pane' }, scroll);
  function renderDiagnostics(value) {
    clearTimeout(copyTimer); diagnostics.replaceChildren();
    const context = toolContext(value); diagnostics.hidden = !context;
    if (!context) return;
    const { failure, related, items } = context;
    if (failure && value?.kind !== 'tool_use') {
      diagnostics.append(button('Back to list', backToList, { class: 'failure-back-list' }));
      const position = Math.max(0,items.indexOf(failure));
      diagnostics.append(el('span', { class: 'category-chip' }, failure.category),
        el('div', { class: 'failure-navigation' }, button('Previous',()=>stepTool(-1, failure), {'aria-label':'Previous failure'}),
          el('span', {}, `${position+1} of ${items.length} failures`),button('Next',()=>stepTool(1, failure), {'aria-label':'Next failure'})));
      const copy = button('Copy as issue', async () => {
        const text = issueMarkdown(failure);
        try { await navigator.clipboard.writeText(text); }
        catch {
          const area = el('textarea', { class: 'clipboard-fallback', 'aria-label': 'Issue Markdown. Copy with Control C or Command C.' });
          area.value = text; document.body.append(area); area.focus(); area.select();
          let copied = false;
          try { copied = document.execCommand('copy'); } catch { /* Keep text selected for manual copying. */ }
          if (!copied) { area.classList.add('clipboard-manual'); copy.textContent='Press Ctrl+C / Command+C'; area.addEventListener('blur',()=>queueMicrotask(()=>area.remove()),{once:true}); return; }
          area.remove(); copy.focus();
        }
        copy.textContent='Copied'; copyTimer=setTimeout(()=>{copy.textContent='Copy as issue';},1800);
      });
      diagnostics.append(copy);
    }
    if (related) diagnostics.append(button(value.kind==='tool_use'?'Show result':'Show call',()=>navigateTool(related),{class:'tool-related'}));
  }
  function append() {
    const end = Math.min(block.text?.length ?? 0, offset + 200 * 1024);
    content.append(document.createTextNode((block.text ?? '').slice(offset, end)));
    offset = end; more.hidden = offset >= (block.text?.length ?? 0);
    more.textContent = `Show more (${formatTokens((block.text?.length ?? 0) - offset)} characters left)`;
  }
  return { root, reset(isRedacted = false) { clearTimeout(copyTimer); diagnostics.replaceChildren(); redacted = isRedacted; positions.clear(); block = undefined; }, show(value, tokens) {
    renderDiagnostics(value);
    if (block === value) {
      if (block) metadata.textContent = `${block.kind} · ${formatTokens(tokens)} tokens, estimated block share`;
      return;
    }
    if (block) positions.set(block.id, { offset, top: root.scrollTop });
    const saved = positions.get(value?.id);
    agentButton.hidden = !linked(value);
    block = value; failed.hidden = block?.isError !== true; offset = 0; content.replaceChildren(); params.replaceChildren(); description.textContent = '';
    root.scrollTop = 0; inside.disabled = !block; more.hidden = true;
    errorMessage.hidden = verbatim.hidden = true;
    if (!block) { title.textContent = 'Read the context'; metadata.textContent = ''; badge.classList.remove('redacted'); badge.textContent = 'Select a building or a block in the index.'; return; }
    const identity = toolIdentity(block.toolName);
    title.textContent = identity.server ? `${identity.server} / ${identity.shortName}${block.kind === 'tool_result' ? ' result' : block.kind === 'tool_use' ? ' call' : ''}` : block.label;
    title.title = block.label;
    const isFailure = block.isError === true && block.kind === 'tool_result' && block.text != null;
    errorMessage.hidden = verbatim.hidden = !isFailure;
    errorMessage.textContent = isFailure ? resultText(block) : '';
    if (isFailure) { verbatim.append(content, more); verbatim.open = false; }
    else { scroll.insertBefore(content, verbatim); scroll.insertBefore(more, verbatim); }
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
