// Pure resource budgets: usable by the renderer and Node tests.
export const CONTENT_PAGES = 12, LINES_PER_PAGE = 18, HALL_BLOCKS = 22;

export function wrapText(text, columns = 68, limit = Infinity) {
  if (!Number.isInteger(columns) || columns < 1 || !(limit > 0)) return [];
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let rest = paragraph;
    while (rest.length > columns) {
      const space = rest.lastIndexOf(' ', columns);
      const end = space > columns / 2 ? space + 1 : columns;
      lines.push(rest.slice(0, end));
      if (lines.length >= limit) return lines;
      rest = rest.slice(end);
    }
    lines.push(rest);
    if (lines.length >= limit) return lines;
  }
  return lines;
}

export function chunkPages(text) {
  const budget = CONTENT_PAGES * LINES_PER_PAGE;
  const lines = wrapText(text, 68, budget + 1), pages = [];
  for (let i = 0; i < Math.min(lines.length, budget); i += LINES_PER_PAGE) pages.push(lines.slice(i, i + LINES_PER_PAGE));
  if (lines.length > budget) pages.push(['Continues in the reader pane', 'Open this block in the reader pane for the complete text.']);
  return pages;
}

export function hallPage(blockIds, requested = 0) {
  const pageCount = Math.max(1, Math.ceil(blockIds.length / HALL_BLOCKS));
  const page = Math.max(0, Math.min(pageCount - 1, Math.trunc(requested) || 0));
  return { page, pageCount, ids: blockIds.slice(page * HALL_BLOCKS, (page + 1) * HALL_BLOCKS),
    back: page > 0, more: page + 1 < pageCount, navigationDoors: 2 };
}
