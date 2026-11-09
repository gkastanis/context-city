import { el, button } from './dom.js';
import { findings } from './findings.js';
import { formatTokens } from './math.js';

export function createFindingsPanel({ navigate, onOpen, onClose }) {
  let items = [];
  const badge = el('span', { class: 'findings-count' }, '0');
  const toggle = button('', () => root.hidden ? open() : close(), {
    id: 'show-findings', 'aria-controls': 'findings-panel', 'aria-expanded': 'false',
  });
  toggle.append('Findings ', badge);
  const list = el('div', { class: 'findings-list' });
  const root = el('aside', { id: 'findings-panel', class: 'card panel', hidden: true, 'aria-labelledby': 'findings-heading' },
    el('div', { class: 'help-heading' }, el('h2', { id: 'findings-heading', tabindex: '-1' }, 'Findings'), button('Close', () => close(), { id: 'close-findings' })),
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
      list.replaceChildren(...items.slice(0, 12).map(f => button('', () => navigate(f), {
        class: `finding finding--${f.kind}`, 'data-finding-id': f.id,
      })));
      for (const [i, row] of [...list.children].entries()) {
        const f = items[i];
        row.append(el('span', { class: 'finding-marker', 'aria-hidden': 'true' }),
          el('strong', { class: 'finding-title' }, f.title), el('span', { class: 'finding-detail muted' }, f.detail),
          el('span', { class: 'finding-cost', title: `${f.basis === 'measured' ? 'Measured' : 'Estimated'} input token cost` }, `${formatTokens(f.id.endsWith('cache_rewrite:summary') ? f.tokens : f.cost)} tokens (${f.basis})`));
      }
      if (!items.length) list.append(el('p', {}, 'No problems found in this session.'));
      if (items.length > 12) list.append(el('p', { class: 'muted' }, 'Showing the first 12 entries.'));
    },
  };
}
