import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { findings } from '../src/ui/findings.js';
import { compactSession, expandSession } from '../src/ui/compact.js';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE_MODULE);
const base = process.env.T11_URL || 'http://127.0.0.1:8794';
const shots = process.env.T11_SHOTS || 'dev/shots';
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const errors = [], reports = [];
try {
  for (const [entry, name, width, height, screenshot] of [
    ['dist', 'fresh-session', 1440, 900, 'fresh'],
    ['site', 'real-session-redacted', 1440, 900, 'redacted'],
    ['site', 'real-session-redacted', 400, 860, 'mobile'],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, ignoreHTTPSErrors: true, reducedMotion: 'reduce' });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route(`**/${entry}/index.html`, async route => {
      const response = await route.fetch();
      let body = await response.text();
      body = body.replace("await call('setRequest', idx);", "await call('setRequest', idx); window.t11Applied = idx;");
      body = body.replace('onSelect: id => select(id)', 'onSelect: id => { window.t11SceneSelected = id; select(id); }');
      body = body.replace('selected = id;', 'selected = id; window.t11Selected = id;');
      await route.fulfill({ response, body });
    });
    await page.goto(`${base}/${entry}/index.html`);
    await page.waitForFunction(() => document.querySelector('#scene-status').hidden, null, { timeout: 60000 });
    if (width === 400) await page.locator('#menu-toggle').click();
    if (name.includes('redacted')) {
      await page.locator('#load-example').click();
      await page.getByRole('button', { name: /A real session, redacted/ }).click();
      await page.waitForFunction(() => document.querySelector('#request-slider').max === '223');
    }
    const source = JSON.parse(await readFile(new URL(`../sample/${name}.json`, import.meta.url), 'utf8'));
    const expected = findings(expandSession(compactSession(source)));
    if (width === 400 && !await page.locator('#show-findings').isVisible()) await page.locator('#menu-toggle').click();
    await page.locator('#show-findings').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#findings-panel').isVisible(), true);
    assert.equal(await page.locator('.finding').count(), Math.min(12, expected.length));
    assert.equal(await page.locator('.findings-count').textContent(), String(expected.length));
    assert.deepEqual(await page.locator('.finding-title').allTextContents(), expected.slice(0, 12).map(f => f.title));
    const before = await page.locator('#request-slider').inputValue();
    await page.locator('.finding').first().click();
    await page.waitForFunction(f => Number(document.querySelector('#request-slider').value) === f.requestIdx
      && window.t11Applied === f.requestIdx && window.t11Selected === f.blockId && window.t11SceneSelected === f.blockId, expected[0]);
    assert.notEqual(await page.locator('#request-slider').inputValue(), before);
    assert.equal(await page.locator('#reader-panel').isVisible(), true);
    assert.equal(await page.locator('#findings-panel').isVisible(), true);
    const bounds = await page.locator('#findings-panel, #timeline, #reader-panel').evaluateAll(nodes => Object.fromEntries(nodes.map(n => {
      const r = n.getBoundingClientRect(); return [n.id, { top: r.top, bottom: r.bottom, left: r.left, right: r.right }];
    })));
    assert.ok(bounds['findings-panel'].bottom < bounds.timeline.top, JSON.stringify(bounds));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => document.querySelector('#discovery-toast').hidden);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${shots}/t11-${screenshot}.png` });
    // Enter activates a native row, retaining focus and the open panel.
    await page.locator('.finding').last().focus(); await page.keyboard.press('Enter');
    const last = expected[Math.min(12, expected.length) - 1];
    await page.waitForFunction(f => Number(document.querySelector('#request-slider').value) === f.requestIdx && window.t11Selected === f.blockId, last);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#findings-panel').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), width === 400 ? 'menu-toggle' : 'show-findings');
    if (width === 400) await page.locator('#menu-toggle').click();
    await page.getByRole('button', { name: 'Run summary', exact: true }).click();
    assert.ok((await page.locator('.summary-finding').textContent()).includes(`Top finding: ${expected[0].title}`));
    await page.getByRole('button', { name: 'Show findings', exact: true }).click();
    assert.equal(await page.locator('#run-summary').isVisible(), false);
    assert.equal(await page.locator('#findings-panel').isVisible(), true);
    await page.locator('#close-findings').click();
    assert.equal(await page.locator('#findings-panel').isVisible(), false);
    reports.push({ example: name, width, findings: expected.length, rows: Math.min(12, expected.length), navigation: true, keyboard: true, summary: true, screenshot: `${shots}/t11-${screenshot}.png` });
    await page.close();
  }
  console.log(JSON.stringify({ reports, consoleErrors: errors }));
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
