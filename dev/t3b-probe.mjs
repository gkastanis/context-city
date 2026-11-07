// Statistics-only browser probe. Never logs transcript strings or screenshots.
import { createServer } from 'node:http';
import { readFile, readdir, stat, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const { chromium } = await import(process.env.PLAYWRIGHT_CORE_MODULE || 'playwright-core');
const server = createServer(async (req, res) => {
  try {
    const file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!file.startsWith(root + '/')) throw Error();
    const data = await readFile(file);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(8766, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
async function newPage(url = 'dist/index.html', blocked = false) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', () => errors.push('pageerror'));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('console'); });
  if (blocked) await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
  await page.addInitScript(() => {
    window.probe = { parseMs: null, tapeBytes: null, requestCount: null, longTasks: [] };
    const Original = Worker;
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({ data }) => {
          if (data.type !== 'session') return;
          window.probe.parseMs = performance.now() - this.started;
          window.probe.tapeBytes = data.session.tape.byteLength + data.session.offsets.byteLength;
          window.probe.requestCount = data.session.requests.length;
          window.probe.compact = data.session.requests.every(r => !('blockIds' in r));
        });
      }
      postMessage(...args) { this.started = performance.now(); return super.postMessage(...args); }
    };
    new PerformanceObserver(list => window.probe.longTasks.push(...list.getEntries().map(x => x.duration))).observe({ type: 'longtask', buffered: true });
  });
  await page.goto('http://127.0.0.1:8766/' + url);
  await page.waitForFunction(() => document.querySelector('#status')?.textContent === 'Example session ready.');
  await page.waitForFunction(() => document.querySelector('#scene-status')?.hidden || document.querySelector('#scene-status')?.textContent.includes('unavailable'));
  return { page, errors };
}
async function load(page, file) {
  await page.setInputFiles('#transcript-file', file);
  await page.waitForFunction(() => document.querySelector('#status')?.textContent === 'Transcript ready. File read in this tab.', null, { timeout: 240000 });
  return page.evaluate(() => ({ parseMs: Math.round(probe.parseMs), tapeBytes: probe.tapeBytes, requests: probe.requestCount, compact: probe.compact }));
}
async function scrub(page) {
  return page.evaluate(async () => {
    const slider = document.querySelector('#request-slider'), max = Number(slider.max), start = performance.now();
    probe.longTasks = [];
    let indexBatches = 0, labelMismatches = 0;
    const observer = new MutationObserver(() => indexBatches++);
    observer.observe(document.querySelector('#context-districts'), { childList: true, subtree: true });
    for (let i = 1; i <= 40; i++) {
      slider.value = Math.round(max * i / 40); slider.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (document.querySelector('#request-position').textContent !== `${Number(slider.value) + 1} of ${max + 1}`) labelMismatches++;
    }
    const indexBatchesBeforeChange = indexBatches;
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    // Account for pending synchronous scene work and the paint cooldown.
    await new Promise(resolve => setTimeout(resolve, 500));
    observer.disconnect();
    return { indexBatchesBeforeChange, indexBatches, labelMismatches, steps40Ms: Math.round(performance.now() - start), finalValue: Number(slider.value), max,
      finalPosition: document.querySelector('#request-position').textContent,
      longTasks: probe.longTasks.length, maxLongTaskMs: Math.round(Math.max(0, ...probe.longTasks)) };
  });
}
async function heap(page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const value = await cdp.send('Runtime.getHeapUsage'); await cdp.detach();
  return { heapMB: +(value.usedSize / 1048576).toFixed(1), embedderMB: +(value.embedderHeapUsedSize / 1048576).toFixed(1), backingMB: +(value.backingStorageSize / 1048576).toFixed(1) };
}
try {
  if (!process.argv.includes('--real-only')) {
    for (const entry of ['index.html', 'dist/index.html']) {
      const { page, errors } = await newPage(entry);
      assert.equal(await page.locator('#stage canvas').count(), 1, '3D scene loaded');
      const fixture = await load(page, path.join(root, 'test/fixtures/session.jsonl'));
      assert.equal(fixture.requests, 3); assert.ok(fixture.compact);
      assert.equal(await page.locator('.event-marker').count(), 1);
      const keyboard = page.locator('.event-marker'); await keyboard.focus();
      await keyboard.press('End'); await keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('#request-slider').value === '2');
      const scrubStats = await scrub(page);
      await page.locator('.district summary').first().click();
      await page.locator('.block-row').first().click();
      assert.ok((await page.locator('#block-text').textContent()).length > 0);
      const selectedText = await page.locator('#block-text').textContent();
      const city = await page.locator('#stage').boundingBox();
      for (let i = 0; i < 12; i++) await page.mouse.move(city.x + city.width * i / 12, city.y + city.height * (i % 3 + 1) / 4);
      await page.mouse.move(1, 1);
      assert.equal(await page.locator('#block-text').textContent(), selectedText, 'hover preserves selected text');
      await page.locator('#start-reading').click();
      await page.waitForFunction(() => document.querySelector('#pause-reading').disabled === false);
      await page.locator('#pause-reading').click(); await page.locator('#pause-reading').click(); await page.locator('#stop-reading').click();
      const colors = [];
      for (const colorScheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme });
        colors.push(await page.locator('#reader-panel').evaluate(n => getComputedStyle(n).backgroundColor));
      }
      assert.notEqual(...colors);
      await page.setViewportSize({ width: 400, height: 800 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.locator('#app.hide-index.hide-reader').waitFor();
      await page.locator('[aria-controls="reader-panel"]').click();
      await page.locator('[aria-controls="index-panel"]').click();
      assert.equal(await page.locator('#app.hide-reader').count(), 1);
      console.log(JSON.stringify({ kind: 'browser', entry, fixture, scrubStats, narrow: true, themes: true, playback: true, errors: errors.length }));
      await page.close();
    }
    const readerProbe = await newPage();
    const readerState = await readerProbe.page.evaluate(async () => {
      const { createReaderPane } = await import('/src/ui/reader.js');
      const pane = createReaderPane(() => {});
      pane.root.id = 'probe-reader';
      Object.assign(pane.root.style, { position: 'fixed', width: '300px', height: '200px', overflow: 'auto', zIndex: 100 });
      document.body.append(pane.root);
      const a = { id: 'a', label: 'Synthetic A', text: 'long line\n'.repeat(60000), kind: 'tool_result', provenance: 'verbatim' };
      const b = { ...a, id: 'b', label: 'Synthetic B', text: 'Other text' };
      pane.show(a, 1);
      [...pane.root.querySelectorAll('button')].find(n => n.textContent.startsWith('Show more')).click();
      const length = pane.root.querySelector('pre').textContent.length;
      pane.root.scrollTop = 1234;
      pane.show(b, 1); pane.show(a, 1);
      const result = { length, restoredLength: pane.root.querySelector('pre').textContent.length, restoredScroll: pane.root.scrollTop };
      pane.reset(); pane.show(null);
      result.emptyCleared = pane.root.querySelector('pre').textContent.length === 0;
      pane.root.remove(); return result;
    });
    assert.equal(readerState.length, readerState.restoredLength); assert.equal(readerState.restoredScroll, 1234); assert.ok(readerState.emptyCleared);
    console.log(JSON.stringify({ kind: 'reader-state', ...readerState, errors: readerProbe.errors.length }));
    await readerProbe.page.close();
    const fallback = await newPage('dist/index.html', true);
    const fixture = await load(fallback.page, path.join(root, 'test/fixtures/session.jsonl'));
    console.log(JSON.stringify({ kind: 'cdn-blocked', fixture, usable: await fallback.page.locator('.district').count() > 0, notice: await fallback.page.locator('#scene-status').isVisible(), errors: fallback.errors.length }));
    await fallback.page.close();
    const main = await newPage();
    await main.page.evaluate(() => { window.Worker = class { constructor() { throw new Error('Synthetic worker unavailable'); } }; });
    await load(main.page, path.join(root, 'test/fixtures/session.jsonl'));
    assert.equal(await main.page.locator('#request-slider').getAttribute('max'), '2');
    console.log(JSON.stringify({ kind: 'main-thread-fallback', requests: 3, errors: main.errors.length }));
    await main.page.close();
    const lines = [JSON.stringify({ type: 'api-request-shape', shapeHash: 'shape', shape: { system: [{ type: 'text', text: 'Synthetic system' }], tools: [] } })];
    for (let i = 0; i < 4000; i++) {
      lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: `Synthetic prompt ${i}` } }),
        JSON.stringify({ type: 'api-request-blob', hash: `u${i}`, message: { role: 'user', content: [{ type: 'text', text: `Synthetic prompt ${i}` }, { type: 'tool_result', tool_use_id: `t${i}`, content: `Synthetic result ${i}` }] } }),
        JSON.stringify({ type: 'api-request', id: `r${i}`, querySource: 'repl_main_thread', shapeHash: 'shape', keep: i, tail: [`u${i}`] }));
    }
    const synthetic = path.join(root, 'dev/t3b-synthetic.jsonl');
    await writeFile(synthetic, lines.join('\n'));
    const { page, errors } = await newPage();
    const stats = await load(page, synthetic), memory = await heap(page), steps = await scrub(page);
    assert.equal(steps.indexBatchesBeforeChange, 0); assert.equal(steps.labelMismatches, 0);
    console.log(JSON.stringify({ kind: 'synthetic4000', fileBytes: (await stat(synthetic)).size, ...stats, ...memory, ...steps, markerButtons: await page.locator('.event-marker').count(), errors: errors.length }));
    await page.close();
    await unlink(synthetic);
  }
  // Real transcripts are opt-in: they hold private text. Only statistics are printed.
  if (process.argv.includes('--real') || process.argv.includes('--real-only')) {
    const projects = `${process.env.HOME}/.claude/projects`;
    const files = [];
    for (const folder of await readdir(projects)) {
      const dir = path.join(projects, folder);
      if (!(await stat(dir)).isDirectory()) continue;
      for (const file of await readdir(dir)) {
        if (!file.endsWith('.jsonl')) continue;
        const full = path.join(dir, file); files.push({ full, size: (await stat(full)).size });
      }
    }
    files.sort((a, b) => b.size - a.size);
    for (const [i, file] of files.slice(0, 3).entries()) {
      const { page, errors } = await newPage();
      const started = Date.now();
      const stats = await load(page, file.full), memory = await heap(page), steps = await scrub(page);
      console.log(JSON.stringify({ kind: 'real', rank: i + 1, fileBytes: file.size, ...stats, ...memory, ...steps, totalMs: Date.now() - started, errors: errors.length }));
      await page.close();
    }
  }
} finally { await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
