// Pure resource budgets: usable by the renderer and Node tests.
export const CONTENT_PAGES = 12, LINES_PER_PAGE = 18, HALL_BLOCKS = 22;

// JSON on the walls: pretty-print a block that is JSON, or that ends in a JSON
// section (a tool description followed by its schema). Other text is unchanged.
export function prettyJson(text) {
  const tryParse = s => { const t = s.trim(); if (!/^[{[]/.test(t)) return null; try { return JSON.stringify(JSON.parse(t), null, 2); } catch { return null; } };
  const whole = tryParse(text); if (whole != null) return whole;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
    if (!/[{[]/.test(text[i + 1] ?? '')) continue;
    const tail = tryParse(text.slice(i + 1)); if (tail != null) return text.slice(0, i + 1) + tail;
  }
  return text;
}

// Marks a wrapped piece of a long JSON line (zero width, never shown).
export const CONTINUED = '​';

// Like wrapPixels, but a long JSON line wraps with a hanging indent under its
// own indent, and each continued piece starts with CONTINUED after the indent.
export function wrapCode(text, width, measure, limit = Infinity) {
  const lines = [];
  for (const raw of String(text).replace(/\t/g, '    ').split('\n')) {
    if (lines.length >= limit) break;
    if (!looksJson(raw) || measure(raw) <= width) { lines.push(...wrapPixels(raw, width, measure, limit - lines.length)); continue; }
    const pad = ' '.repeat(raw.match(/^ */)[0].length + 2), first = wrapPixels(raw, width, measure, 1)[0];
    lines.push(first);
    const rest = raw.slice(first.length).replace(/^ +/, '');
    for (const piece of wrapPixels(rest, Math.max(width / 2, width - measure(pad)), measure, limit - lines.length)) lines.push(pad + CONTINUED + piece);
  }
  return lines.slice(0, limit);
}

export function looksJson(line) { return /^\s*(["{}[\]]|-?\d|true\b|false\b|null\b)/.test(line); }

// Split one line into coloured runs: key, string, number, literal, punct, plain.
// A string cut by wrapping is closed by the end of the line.
export function jsonTokens(line) {
  const out = [], re = /("(?:[^"\\]|\\.)*"?)(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;
  let last = 0, m;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), kind: 'plain' });
    if (m[1] != null) { out.push({ text: m[1], kind: m[2] ? 'key' : 'string' }); if (m[2]) out.push({ text: m[2], kind: 'punct' }); }
    else if (m[3] != null) out.push({ text: m[3], kind: 'number' });
    else if (m[4] != null) out.push({ text: m[4], kind: 'literal' });
    else out.push({ text: m[5], kind: 'punct' });
    last = re.lastIndex;
  }
  if (last < line.length) out.push({ text: line.slice(last), kind: 'plain' });
  return out;
}

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

export function chunkPages(text, measure, width = 936) {
  const budget = CONTENT_PAGES * LINES_PER_PAGE;
  const lines = measure ? wrapCode(text, width, measure, budget + 1) : wrapText(text, 68, budget + 1), pages = [];
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

// Work in logical canvas pixels, independently of the texture resolution.
export function wrapPixels(text, width, measure, limit = Infinity) {
  if (!(width > 0) || !(limit > 0)) return [];
  const lines = [];
  for (const paragraph of String(text).replace(/\t/g, '    ').split('\n')) {
    const chars = Array.from(paragraph);
    let start = 0;
    do {
      const remaining = chars.length - start;
      const slice = n => chars.slice(start, start + n).join('');
      // Bound the search near a line's width, even for a huge unbroken result.
      let lo = 0, hi = Math.min(1, remaining);
      while (hi < remaining && measure(slice(hi)) <= width) hi = Math.min(remaining, hi * 2);
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (measure(slice(mid)) <= width) lo = mid; else hi = mid - 1;
      }
      let end = Math.max(1, lo);
      if (end < remaining) {
        const space = chars.slice(start, start + end + 1).lastIndexOf(' ');
        if (space > end / 2) end = space;
      }
      lines.push(slice(end));
      if (lines.length >= limit) return lines;
      start += end;
      if (chars[start] === ' ') start++;
    } while (start < chars.length);
  }
  return lines;
}

export const GALLERY = Object.freeze({ wallX: 6.1, wallThickness: .15, pageX: 5.82,
  pageWidth: 6, pageHeight: 3, pageY: 2.65, pageStart: 9, pageSpacing: 7,
  portalHalfWidth: 1.65, portalHeight: 3.8 });
export function pagePlacement(index) {
  const side = index % 2 === 0 ? -1 : 1;
  return { x: side * GALLERY.pageX, y: GALLERY.pageY,
    z: GALLERY.pageStart + index * GALLERY.pageSpacing, rotation: -side * Math.PI / 2 };
}
export function portalCrossing(a, b) {
  if ((a.z > 0) === (b.z > 0) || a.z === b.z) return false;
  const t = -a.z / (b.z - a.z);
  const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
  return Math.abs(x) <= GALLERY.portalHalfWidth && y >= 0 && y <= GALLERY.portalHeight;
}
export function galleryTokens(value) {
  return value >= 1e6 ? `${+(value / 1e6).toFixed(1)}M` : value >= 1000 ? `${+(value / 1000).toFixed(1)}K` : String(Math.round(value));
}
export function tokenRuler(start, count, length, divisions = 8) {
  return Array.from({ length: divisions + 1 }, (_, i) => ({ z: 4 + i / divisions * (length - 8),
    token: start + count * i / divisions }));
}
