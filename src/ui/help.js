import { el, button } from './dom.js';

export function createHelp() {
  const dialog = el('dialog', { id: 'help-dialog', 'aria-labelledby': 'help-title' });
  const command = el('input', { id: 'find-command', readonly: true, value: 'ls -t ~/.claude/projects/*/*.jsonl | head -5' });
  const copyStatus = el('p', { role: 'status' });
  const copy = button('Copy command', async () => {
    try { await navigator.clipboard.writeText(command.value); copyStatus.textContent = 'Copied.'; }
    catch { command.focus(); command.select(); copyStatus.textContent = 'Select and copy the command with your keyboard.'; }
  });
  dialog.append(el('div', { class: 'help-heading' }, el('h2', { id: 'help-title' }, 'Your session, in context'), button('Close', () => dialog.close())),
    el('p', {}, 'Each building holds a piece of context, in the order sent to the model. Road length represents tokens. Height follows a capped square root of token size; taller buildings hold more text. Walk the sequence follows context order; it does not measure attention.'),
    el('h3', {}, 'Find a transcript'),
    el('p', {}, 'Look in ~/.claude/projects/<project-folder>/<session-id>.jsonl. The project folder is the working directory path with /, . and other non-alphanumeric characters replaced by -. On Windows, look in %USERPROFILE%\\.claude\\projects\\.'),
    el('label', { for: 'find-command' }, 'Find the five latest transcripts'), command, copy, copyStatus,
    el('h3', {}, 'Privacy'),
    el('p', {}, 'The file is read inside this browser tab. Nothing is uploaded or stored. Closing the tab forgets it. The page downloads the 3D library (three.js) from a public CDN and fonts from Google Fonts; no transcript content goes anywhere. Transcripts can contain secrets and private text. Share screenshots with care.'),
    el('h3', {}, 'Explore'),
    el('p', {}, 'Click empty ground or press Escape to close the reader.'),
    el('p', {}, 'Drag to orbit, scroll or pinch to zoom. Click an index block to fly to it. Press Enter or double click to enter. Inside, focus the city and use WASD or arrow keys to walk. Escape exits. Use the request slider or Previous and Next to move through requests. Tab to the event list, use arrow keys to move between events, and press Enter to jump.'),
    el('p', {}, 'Measured totals come from API usage. Block shares are estimates scaled to that total. The example uses illustrative estimates and reconstructed text. Older transcripts without request snapshots show an unknown prefix. To include subagents, pick the project folder or drop the session .jsonl together with its <session-id> folder. Other sessions in the folder are ignored.'));
  return { root: dialog, open() { dialog.showModal(); } };
}
