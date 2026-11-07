import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createParser } from '../src/parse.js';

const count = (items, key) => items.reduce((out, item) => {
  out[item[key]] = (out[item[key]] ?? 0) + 1;
  return out;
}, {});
const summary = values => ({ first: values[0] ?? null, last: values.at(-1) ?? null,
  max: values.filter(v => v != null).reduce((max, v) => max == null ? v : Math.max(max, v), null) });

if (!process.argv[2]) process.exitCode = 1;
for (const file of process.argv.slice(2)) {
  const start = performance.now();
  let peakRss = process.memoryUsage().rss, lines = 0, humanUserRecords = 0;
  const sample = () => { peakRss = Math.max(peakRss, process.memoryUsage().rss); };
  const parser = createParser({ sourceName: basename(file) });
  const input = createReadStream(file);
  const reader = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      parser.push(line);
      try {
        const r = JSON.parse(line);
        if (r.type === 'user' && !r.isSidechain && r.origin?.kind === 'human') {
          const content = r.message?.content;
          const texts = typeof content === 'string' ? [content] : (content ?? []).filter(p => p.type === 'text').map(p => p.text ?? '');
          if (texts.some(t => t.trim()) && !texts.some(t => /<(?:command-|local-command)/i.test(t) || /^\s*\//.test(t))) humanUserRecords++;
        }
      } catch { /* The parser counts malformed lines. */ }
      if (++lines % 128 === 0) sample();
    }
    const session = parser.finish();
    sample();
    const measured = session.requests.map(r => r.measuredTokens);
    const estimated = session.requests.map(r => r.estTokens);
    // Report measured and estimated values for the SAME maximum request.
    // If no usage exists, select the maximum estimate instead.
    const hasUsage = measured.some(v => v != null);
    const maximum = session.requests.reduce((best, r) => {
      const score = hasUsage ? r.measuredTokens ?? -1 : r.estTokens;
      return best == null || score > (hasUsage ? best.measuredTokens ?? -1 : best.estTokens) ? r : best;
    }, null);
    const ratios = session.requests.filter(r => r.measuredTokens != null && r.estTokens > 0)
      .map(r => r.measuredTokens / r.estTokens);
    const sorted = [...ratios].sort((a, b) => a - b);
    const blocks = Object.values(session.blocks);
    const last = session.requests.at(-1);
    const layerTokens = {};
    for (const id of last?.blockIds ?? []) {
      const b = session.blocks[id];
      layerTokens[b.layer] = (layerTokens[b.layer] ?? 0) + b.estTokens;
    }
    const layerTokenShare = Object.fromEntries(Object.entries(layerTokens).map(([layer, tokens]) => [layer, last.estTokens ? tokens / last.estTokens : 0]));
    for (const layer of ['menus', 'memory', 'user_instructions']) layerTokenShare[layer] ??= 0;
    const callIds = new Map(), resultIds = new Map();
    for (const b of blocks) {
      if (b.kind === 'tool_use') callIds.set(b.id, JSON.parse(b.text).id);
      if (b.toolUseId) resultIds.set(b.id, b.toolUseId);
      else if (b.kind === 'tool_result' && b.text) resultIds.set(b.id, JSON.parse(b.text).tool_use_id);
    }
    let duplicateToolResultIds = 0, orphanToolUsesLast50 = 0;
    const orphanCallIds = new Set();
    const duplicateToolResultIdsPerRequest = [];
    for (const r of session.requests) {
      const results = new Set(), calls = [];
      const duplicatesBefore = duplicateToolResultIds;
      let previousResult = null, previousResultBlock = null;
      for (const id of r.blockIds) {
        if (callIds.has(id)) calls.push(callIds.get(id));
        if (resultIds.has(id)) {
          const result = resultIds.get(id);
          // Image results may be split into consecutive text/image sub-parts.
          if ((result !== previousResult || id === previousResultBlock) && results.has(result)) duplicateToolResultIds++;
          results.add(result); previousResult = result; previousResultBlock = id;
        } else if (session.blocks[id].kind !== 'attachment') previousResult = null;
      }
      duplicateToolResultIdsPerRequest.push(duplicateToolResultIds - duplicatesBefore);
      if (r.idx >= session.requests.length - 50) {
        const orphans = calls.filter(id => !results.has(id));
        orphanToolUsesLast50 += orphans.length;
        for (const id of orphans) orphanCallIds.add(id);
      }
    }
    peakRss = Math.max(peakRss, process.resourceUsage().maxRSS * 1024);
    console.log(JSON.stringify({ source: session.meta.source, emptyReason: session.meta.emptyReason,
      ignoredRecords: session.meta.ignoredRecords, layerTokenShare, sourceName: basename(file), requests: session.requests.length,
      maxRequestIdx: maximum?.idx ?? null,
      measuredTokens: { ...summary(measured), max: maximum?.measuredTokens ?? null },
      estimatedTokens: { ...summary(estimated), max: maximum?.estTokens ?? null },
      ratio: { first: measured[0] != null && estimated[0] ? measured[0] / estimated[0] : null,
        last: measured.at(-1) != null && estimated.at(-1) ? measured.at(-1) / estimated.at(-1) : null,
        maxRequest: maximum?.measuredTokens != null && maximum.estTokens ? maximum.measuredTokens / maximum.estTokens : null,
        min: sorted[0] ?? null, max: sorted.at(-1) ?? null, median: sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null },
      blocks: { kind: count(blocks, 'kind'), layer: count(blocks, 'layer'), provenance: count(blocks, 'provenance') },
      duplicateToolResultIds, maxDuplicateToolResultIdsPerRequest: Math.max(0, ...duplicateToolResultIdsPerRequest),
      orphanToolUsesLast50, orphanToolUseIdsLast50: orphanCallIds.size,
      orphanIdsWithResultElsewhere: [...orphanCallIds].filter(id => [...resultIds.values()].includes(id)).length,
      unavailableMessageBlocks: blocks.filter(b => b.provenance === 'unavailable' && b.label === 'Unavailable message').length,
      unavailableMessageOccurrences: session.requests.reduce((n, r) => n + r.blockIds.filter(id => session.blocks[id].label === 'Unavailable message').length, 0),
      humanUserRecords,
      ...(process.argv.includes('--tool-loads') ? { toolLoaded: session.events.filter(e => e.type === 'tool_loaded').map(e => ({ requestIdx: e.requestIdx, ...e.data })) } : {}),
      events: count(session.events, 'type'), sidechainRequests: session.meta.sidechainRequests,
      skippedLines: session.meta.skippedLines, wallMs: Math.round(performance.now() - start), peakRss }));
  } catch {
    // Never print exceptions: OS errors can contain full paths or input data.
    console.log(JSON.stringify({ sourceName: basename(file), failed: true,
      wallMs: Math.round(performance.now() - start), peakRss }));
    process.exitCode = 1;
  } finally {
    reader.close(); input.destroy();
  }
}
