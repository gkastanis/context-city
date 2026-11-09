import { el, button } from './dom.js';
import { findings } from './findings.js';
import { formatTokens } from './math.js';

export function createFindingsPanel({ navigate, onOpen, onClose, showFailures = null }) {
  let items = [];
  const badge = el('span', { class: 'findings-count' }, '0');
  const toggle = button('', () => root.hidden ? open() : close(), {
    id: 'show-findings', 'aria-controls': 'findings-panel', 'aria-expanded': 'false',
  });
  toggle.append('Findings ', badge);
  const list = el('div', { class: 'findings-list' });
  const failures = el('section', { class: 'findings-failures', hidden: true, 'aria-label': 'Failures' });
  const root = el('aside', { id: 'findings-panel', class: 'card panel', hidden: true, 'aria-labelledby': 'findings-heading' },
    el('div', { class: 'help-heading' }, el('h2', { id: 'findings-heading', tabindex: '-1' }, 'Findings'), button('Close', () => close(), { id: 'close-findings' })), failures,
    el('p', { class: 'muted' }, 'Ranked by input token cost across the session. Chips label estimated or measured costs. Each request resends its context, so a block that stays costs again on every request.'), list);
  function open() {
    root.hidden = false; toggle.setAttribute('aria-expanded', 'true'); onOpen();
    root.querySelector('h2').focus({ preventScroll: true });
  }
  function close(restoreFocus = true) {
    if (root.hidden) return;
    root.hidden = true; toggle.setAttribute('aria-expanded', 'false');
    const focusTarget = onClose() ?? toggle;
    if (restoreFocus) focusTarget.focus({ preventScroll: true });
  }
  return { root, toggle, open, close,
    setSession(session) {
      close(false); items = findings(session); badge.textContent = String(items.filter(f => !f.id.endsWith('cache_rewrite:summary')).length);
      const failureItems = items.filter(f => f.kind === 'failed_tools');
      const ranked = items.filter(f => f.kind !== 'failed_tools');
      failures.hidden = !failureItems.length;
      function row(f) {
        const node = button('', () => f.kind === 'failed_tools' && showFailures ? showFailures(f.targets[0]) : navigate(f.targets ? { ...f, ...f.targets[0] } : f), {
          class: `finding finding--${f.kind}`, 'data-finding-id': f.id,
        });
        node.append(el('span', { class: 'finding-marker', 'aria-hidden': 'true' }),
          el('strong', { class: 'finding-title' }, f.title), el('span', { class: 'finding-detail muted' }, f.detail),
          el('span', { class: 'finding-cost', title: `${f.basis === 'measured' ? 'Measured' : 'Estimated'} input token cost` }, `${formatTokens(f.id.endsWith('cache_rewrite:summary') ? f.tokens : f.cost)} tokens (${f.basis})`));
        return node;
      }
      failures.replaceChildren(el('h3', {}, 'Failures'), ...failureItems.map(row));
      list.replaceChildren(...ranked.slice(0, 12).map(row));
      if (!items.length) list.append(el('p', {}, 'No problems found in this session.'));
      if (ranked.length > 12) list.append(el('p', { class: 'muted' }, 'Showing the first 12 entries.'));
    },
  };
}
