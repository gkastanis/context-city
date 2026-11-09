import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE_MODULE);
const base = process.env.T13_URL || 'http://127.0.0.1:8796';
const shots = process.env.T13_SHOTS || 'dev/shots';
assert.ok(/^http:\/\/127\.0\.0\.1:879[0-9]$/.test(base), 'Use a T13 probe port');
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] });
const errors = [], reports = [];
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
async function inViewport(locator) {
  await locator.waitFor({ state: 'visible' });
  const box = await locator.boundingBox(), size = locator.page().viewportSize();
  check(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height, 'Control inside viewport');
}
async function focusVisible(page) {
  check(await page.evaluate(() => {
    const n = document.activeElement, r = n.getBoundingClientRect();
    return n !== document.body && n.checkVisibility() && r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
  }), 'Focus on visible element');
}
async function nav(page, locator, narrow) {
  if (narrow && !await page.locator('#app').evaluate(n => n.classList.contains('show-menu'))) await page.locator('#menu-toggle').click();
  await locator.click();
}
try {
  for (const width of [400, 1440]) {
    const phone = width === 400;
    const page = await browser.newPage({ viewport: { width, height: phone ? 860 : 900 }, reducedMotion: 'reduce' });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${base}/dist/index.html`);
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('ready'));
    const overlays = [];
    for (const [id, name, shot] of [['index-panel', 'Index', 'index'], ['reader-panel', 'Reader', 'reader'], ['field-guide', 'Field guide', 'guide']]) {
      const root = page.locator(`#${id}`), toggle = page.locator(`.viewbar [aria-controls="${id}"]`);
      await nav(page, toggle, phone);
      const close = root.getByRole('button', { name: `Close ${name}`, exact: true });
      await inViewport(close);
      if (phone) await page.screenshot({ path: `${shots}/t13-${shot}-mobile.png` });
      await root.evaluate(n => n.scrollTop = n.scrollHeight);
      await inViewport(close);
      await close.click(); check(!await root.isVisible(), `${name} closes`); check(await toggle.getAttribute('aria-expanded') === 'false', 'Toggle synchronized'); await focusVisible(page);
      await nav(page, toggle, phone); await page.keyboard.press('Escape');
      check(await root.isVisible() === !phone, `${name} Escape depends on viewport`); await focusVisible(page);
      if (!phone) await close.click();
      overlays.push({ name, click: true, escape: phone ? 'closed' : 'kept open' });
    }
    for (const [id, control, closeName] of [
      ['findings-panel', '#show-findings', 'Close'], ['run-summary', '.viewbar button:text-is("Run summary")', 'Close'],
      ['example-chooser', '#load-example', 'Close'], ['help-dialog', '#help', 'Close'],
    ]) {
      const root = page.locator(`#${id}`), trigger = page.locator(control);
      await nav(page, trigger, phone); const close = root.getByRole('button', { name: closeName, exact: true });
      await inViewport(close); await close.click(); check(!await root.isVisible(), `${id} closes`); await focusVisible(page);
      await nav(page, trigger, phone); await page.keyboard.press('Escape'); check(!await root.isVisible(), `${id} Escape`); await focusVisible(page);
      overlays.push({ name: id, click: true, escape: 'closed' });
    }
    // A native dialog closes before a still-open Findings panel.
    await nav(page, page.locator('#show-findings'), phone);
    await nav(page, page.locator('#load-example'), phone);
    await page.keyboard.press('Escape'); check(await page.locator('#findings-panel').isVisible(), 'Dialog Escape preserves Findings');
    await page.keyboard.press('Escape'); check(!await page.locator('#findings-panel').isVisible(), 'Next Escape closes Findings');
    if (phone) {
      await nav(page, page.locator('.viewbar [aria-controls="index-panel"]'), true);
      check(!await page.locator('#app').evaluate(n => n.classList.contains('show-menu')), 'Index closes Menu');
      await page.locator('#menu-toggle').click();
      await page.locator('.viewbar [aria-controls="reader-panel"]').click();
      check(await page.locator('#reader-panel').isVisible(), 'Reader opens');
      check(!await page.locator('#index-panel').isVisible() && !await page.locator('#field-guide').isVisible(), 'Only Reader open');
      check(!await page.locator('#app').evaluate(n => n.classList.contains('show-menu')), 'Reader closes Menu');
      await page.locator('#menu-toggle').click();
      const close = page.locator('#phone-menu').getByRole('button', { name: 'Close Menu' });
      await inViewport(close); await close.click(); await focusVisible(page);
      check(await page.locator('#reader-panel').isVisible(), 'Menu Close preserves sheet');
      await page.locator('#menu-toggle').click(); await page.keyboard.press('Escape'); await focusVisible(page);
      check(await page.locator('#reader-panel').isVisible(), 'Menu Escape preserves sheet');
      await page.keyboard.press('Escape'); check(!await page.locator('#reader-panel').isVisible(), 'Next Escape closes Reader');
      await nav(page, page.locator('.viewbar [aria-controls="reader-panel"]'), true);
      await nav(page, page.locator('.viewbar [aria-controls="reader-panel"]'), true);
      check(!await page.locator('#reader-panel').isVisible(), 'Menu can toggle an open sheet closed');
      check(!await page.locator('#app').evaluate(n => n.classList.contains('show-menu')), 'Closing sheet also closes Menu');
      await focusVisible(page);
      overlays.push({ name: 'Menu', click: true, escape: 'closed' });
    }
    // Guess retains its explicit dismissal, with visible focus afterwards.
    if (await page.locator('#guess-card').isVisible()) await page.locator('#guess-card').getByRole('button', { name: 'Dismiss', exact: true }).click();
    await nav(page, page.locator('.viewbar button:text-is("Guess")'), phone);
    if (phone) await page.locator('#phone-menu').getByRole('button', { name: 'Close Menu' }).click();
    const guess = page.locator('#guess-card'), dismiss = guess.getByRole('button', { name: 'Dismiss', exact: true });
    await inViewport(dismiss); await dismiss.click(); check(!await guess.isVisible(), 'Guess dismissed'); await focusVisible(page);
    overlays.push({ name: 'Guess', click: true, escape: 'not assigned' });
    if (!phone) {
      await nav(page, page.locator('.viewbar [aria-controls="index-panel"]'), false);
      await page.screenshot({ path: `${shots}/t13-desktop.png` });
      await page.locator('#index-panel').getByRole('button', { name: 'Close Index' }).click();
    }
    // Exercise the real canvas handler under stacked layers and an inside mode.
    await nav(page, page.locator('.viewbar [aria-controls="index-panel"]'), phone);
    await page.locator('#index-panel .district > summary').first().click();
    await page.locator('#index-panel .block-row').first().click();
    await page.locator('#enter-block').click();
    await page.waitForFunction(() => document.querySelector('#mode-label').textContent === 'Inside a block');
    const sr = await page.locator('#request-slider').boundingBox();
    await page.locator('#request-slider').dispatchEvent('wheel', { ctrlKey: true, deltaY: -100, clientX: sr.x + sr.width / 2 });
    const zoom = page.getByRole('button', { name: 'Zoom out', exact: true });
    check(await zoom.isVisible(), 'Zoom active');
    await nav(page, page.locator('.viewbar [aria-controls="field-guide"]'), phone);
    await nav(page, page.locator('#show-findings'), phone);
    await nav(page, page.locator('#help'), phone);
    await page.keyboard.press('Escape');
    check(await page.locator('#findings-panel').isVisible() && await zoom.isVisible(), 'Dialog Escape preserves lower layers');
    await page.keyboard.press('Escape');
    check(!await page.locator('#findings-panel').isVisible() && await zoom.isVisible(), 'Findings Escape preserves zoom');
    if (phone) {
      check(await page.locator('#app').evaluate(n => n.classList.contains('show-menu')), 'Menu still open');
      await page.keyboard.press('Escape');
      check(await zoom.isVisible(), 'Menu Escape preserves zoom');
    }
    const canvas = page.locator('#stage canvas');
    await canvas.focus(); await page.keyboard.press('Escape');
    check(!await zoom.isVisible(), 'Escape clears zoom');
    check(await page.locator('#mode-label').textContent() === 'Inside a block', 'Zoom Escape preserves inside mode with canvas focused');
    await page.keyboard.press('Escape');
    check(await page.locator('#mode-label').textContent() === 'City', 'Next Escape exits inside');
    check(await page.locator('#field-guide').isVisible(), 'Scene Escape preserves sheet');
    await page.keyboard.press('Escape');
    check(await page.locator('#field-guide').isVisible() === !phone, 'Next Escape handles sheet by viewport');
    if (!phone) await page.locator('#field-guide').getByRole('button', { name: 'Close Field guide' }).click();
    if (phone) await page.locator('#tape-toggle').click();
    await page.locator('#start-reading').click();
    await page.waitForFunction(() => document.querySelector('#mode-label').textContent === 'Walking the sequence');
    await nav(page, page.locator('.viewbar [aria-controls="field-guide"]'), phone);
    await canvas.focus(); await page.keyboard.press('Escape');
    check(await page.locator('#mode-label').textContent() === 'City', 'Escape stops reading');
    check(await page.locator('#field-guide').isVisible(), 'Reading Escape preserves sheet');
    await page.locator('#field-guide').getByRole('button', { name: 'Close Field guide' }).click();
    if (await page.locator('#reader-panel').isVisible()) await page.locator('#reader-panel').getByRole('button', { name: 'Close Reader' }).click();
    if (phone) await page.locator('#tape-toggle').click();
    // Load only the main transcript so its separate-run banner is shown.
    await page.locator('#transcript-file').setInputFiles(new URL('../test/fixtures/main-agent.jsonl', import.meta.url).pathname);
    const banner = page.locator('#subagent-banner'); await banner.waitFor({ state: 'visible' });
    const bannerDismiss = banner.getByRole('button', { name: 'Dismiss', exact: true }); await inViewport(bannerDismiss);
    await banner.getByRole('button', { name: 'Include subagent runs' }).click();
    const picker = page.locator('#add-agents-picker'), cancel = picker.getByRole('button', { name: 'Cancel', exact: true });
    await inViewport(cancel); await cancel.click(); check(!await picker.isVisible(), 'Add runs Cancel'); await focusVisible(page);
    await banner.getByRole('button', { name: 'Include subagent runs' }).click(); await page.keyboard.press('Escape');
    check(!await picker.isVisible(), 'Add runs Escape'); await focusVisible(page);
    await bannerDismiss.click(); check(!await banner.isVisible(), 'Banner dismissed'); await focusVisible(page);
    // Reloading resets the dismissal without persistent storage.
    await page.locator('#transcript-file').setInputFiles(new URL('../test/fixtures/main-agent.jsonl', import.meta.url).pathname);
    await banner.waitFor({ state: 'visible' }); check(await banner.isVisible(), 'Banner returns on next load');
    await bannerDismiss.click();
    overlays.push({ name: 'banner', click: true, escape: 'not assigned' }, { name: 'Add subagent runs', click: true, escape: 'closed' });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
    reports.push({ width, height: phone ? 860 : 900, overlays }); await page.close();
  }
  check(errors.length === 0, `Console errors: ${JSON.stringify(errors)}`);
  console.log(JSON.stringify({ checks, reports, consoleErrors: errors.length }));
} finally { await browser.close(); }
