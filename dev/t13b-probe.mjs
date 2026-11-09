import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE_MODULE);
const base = process.env.T13_URL || 'http://127.0.0.1:8796';
assert.match(base, /^http:\/\/127\.0\.0\.1:879[0-9]$/);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
  headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] });
let checks = 0;
const errors = [], reports = [];
function check(value, label) { assert.ok(value, label); checks++; }
try {
  for (const width of [1440, 400]) {
    const page = await browser.newPage({ viewport: { width, height: width === 400 ? 860 : 900 }, reducedMotion: 'reduce' });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    // Read-only observations inside the real built artifact; all input uses the mouse and keyboard.
    await page.route('**/dist/index.html', async route => {
      let html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
      for (const [from, to] of [
        ['sceneReady = true;', 'window.t13bState = () => ({ selected, readerOpenedBy }); sceneReady = true;'],
        ['onHover: id => select(id, true)', 'onHover: id => { window.t13bHover = id; select(id, true); }'],
        ['function setSelected(id) {', 'function setSelected(id) { window.t13bCitySelected = id;'],
      ]) { assert.ok(html.includes(from), `Observation hook: ${from}`); html = html.replace(from, to); }
      await route.fulfill({ contentType: 'text/html', body: html });
    });
    await page.goto(`${base}/dist/index.html`);
    await page.waitForFunction(() => window.t13bState);
    await page.locator('#stage canvas').click({ position: { x: width / 2, y: 290 } });
    if (await page.locator('#guess-card').isVisible()) await page.locator('#guess-card').getByRole('button', { name: 'Dismiss', exact: true }).click();
    const reader = page.locator('#reader-panel');
    const state = () => page.evaluate(() => t13bState());
    async function point(kind) {
      const height = page.viewportSize().height;
      for (let y = 220; y < height - 210; y += 24) for (let x = 18; x < width - 18; x += 24) {
        const canvas = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', { x, y });
        if (!canvas) continue;
        await page.mouse.move(x, y);
        const hit = await page.evaluate(() => window.t13bHover);
        if ((kind === 'building' && hit) || (kind === 'ground' && hit === null)) return { x, y };
      }
      throw new Error(`No ${kind} point at width ${width}`);
    }
    async function building() {
      const p = await point('building'); await page.mouse.click(p.x, p.y);
      check(await reader.isVisible(), 'Building opens Reader');
      check((await state()).selected != null, 'Building selects a block');
      return p;
    }
    async function ground() {
      const p = await point('ground'); await page.mouse.click(p.x, p.y);
      check((await state()).selected === null, 'Ground clears app selection');
      check(await page.evaluate(() => window.t13bCitySelected === null), 'Ground clears city selection');
      const heading = await page.locator('#reader-panel h2').textContent();
      check(heading === 'Read the context', `Reader empty heading: ${JSON.stringify(heading)}`);
      check(await page.locator('#block-text').textContent() === '', 'Reader empty text');
      check(await page.locator('#index-panel [aria-current="true"]').count() === 0, 'Index selection cleared');
    }
    await building(); check((await state()).readerOpenedBy === 'select', 'Selection origin');
    await ground(); check(!await reader.isVisible(), 'Ground closes selection Reader');
    await building(); await page.keyboard.press('Escape');
    check(!await reader.isVisible(), 'Escape closes selection Reader');
    if (width === 1440) {
      check((await state()).selected === null, 'Desktop Escape clears app selection');
      check(await page.evaluate(() => window.t13bCitySelected === null), 'Desktop Escape clears city selection');
    }
    if (width === 400) await page.locator('#menu-toggle').click();
    await page.locator('.viewbar [aria-controls="reader-panel"]').click();
    check((await state()).readerOpenedBy === 'nav', 'Nav origin');
    await building(); check((await state()).readerOpenedBy === 'nav', 'Building preserves nav origin');
    await ground(); check(await reader.isVisible(), 'Nav Reader remains open with empty state');
    await reader.getByRole('button', { name: 'Close Reader', exact: true }).click();
    await building();
    const before = (await state()).selected, p = await point('ground');
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.mouse.move(p.x + 45, p.y + 15, { steps: 8 }); await page.mouse.up();
    check(await reader.isVisible(), 'Orbit drag preserves selection Reader');
    check((await state()).selected === before, 'Orbit drag preserves selection');
    reports.push({ width, height: page.viewportSize().height });
    await page.close();
  }
  check(errors.length === 0, JSON.stringify(errors));
  console.log(JSON.stringify({ checks, reports, consoleErrors: errors.length }));
} finally { await browser.close(); }
