import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE_MODULE);
const base = process.env.T12_URL || 'http://127.0.0.1:8796';
const shots = process.env.T12_SHOTS || 'dev/shots';
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] });
const errors = [], reports = [];
const main = new URL('../test/fixtures/main-agent.jsonl', import.meta.url).pathname;
const child = { name: 'agent-run.jsonl', mimeType: 'application/json', buffer: await readFile(new URL('../test/fixtures/agent-run.jsonl', import.meta.url)) };
const meta = new URL('../test/fixtures/agent-run.meta.json', import.meta.url).pathname;
try {
  for (const width of [1440, 400]) {
    const page = await browser.newPage({ viewport: { width, height: width === 400 ? 860 : 900 }, reducedMotion: 'reduce', ignoreHTTPSErrors: true });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${base}/dist/index.html`);
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('ready'));
    await page.waitForFunction(() => document.querySelector('#scene-status').hidden || !document.querySelector('#scene-status').textContent.includes('Loading the 3D'));
    const input = page.locator('#transcript-file');
    await input.setInputFiles(main);
    await page.waitForFunction(() => !document.querySelector('#subagent-banner').hidden);
    assert.match(await page.locator('#subagent-banner').textContent(), /ran 1 subagent\./);
    await page.screenshot({ path: `${shots}/t12-banner${width === 400 ? '-mobile' : ''}.png` });
    await input.setInputFiles([{ name: 'main-agent.jsonl', mimeType: 'application/json', buffer: await readFile(main) }, child,
      { name: 'agent-run.meta.json', mimeType: 'application/json', buffer: await readFile(meta) }]);
    await page.waitForFunction(() => document.querySelectorAll('.subagent-row').length === 1);
    assert.equal(await page.locator('#subagent-banner').isVisible(), false);
    async function menuButton(name) {
      const control = page.getByRole('button', { name, exact: true });
      if (!await control.isVisible()) await page.locator('#menu-toggle').click();
      await control.click();
      if (width === 400 && !await page.locator('#run-summary').isVisible() && await page.locator('#app').evaluate(n => n.classList.contains('show-menu'))) await page.locator('#menu-toggle').click();
    }
    await menuButton('Index');
    assert.match(await page.locator('.subagent-row').textContent(), /reviewer.*2 requests.*2K input tokens.*From main request 3/s);
    await page.screenshot({ path: `${shots}/t12fix-list${width === 400 ? '-mobile' : ''}.png` });
    await page.locator('#request-slider').fill('1');
    await page.locator('#request-slider').dispatchEvent('change');
    for (const details of await page.locator('.district').all()) await details.evaluate(n => { n.open = true; });
    await page.locator('.block-row').filter({ hasText: /^System/ }).first().click();
    const guideBefore = await page.locator('#quest-progress').textContent();
    assert.ok(!guideBefore.startsWith('0 '));
    const readerBefore = await page.locator('#block-text').textContent();
    if (!await page.locator('.subagent-row').isVisible()) await menuButton('Index');
    await page.locator('.subagent-row').click();
    assert.equal(await page.locator('.subagent-row').getAttribute('aria-current'), 'true');
    assert.ok((await page.locator('.subagent-row').textContent()).includes('Viewing'));
    assert.equal(await page.locator('#city-intro').isVisible(), false);
    assert.equal(await page.locator('#guess-card').isVisible(), false);
    const crumbRect = await page.locator('#subagent-breadcrumb').boundingBox();
    if (width === 1440) {
      const navRect = await page.locator('.viewbar').boundingBox();
      assert.ok(crumbRect.y >= navRect.y + navRect.height);
      assert.ok(crumbRect.y < navRect.y + navRect.height + 20);
      assert.ok(Math.abs(crumbRect.x + crumbRect.width - navRect.x - navRect.width) < 2);
    }
    assert.ok(crumbRect.x >= 0 && crumbRect.x + crumbRect.width <= width);
    assert.equal(await page.locator('#subagent-breadcrumb').isVisible(), true);
    assert.match(await page.locator('#subagent-breadcrumb').textContent(), /Main session \/ reviewer: Review the synthetic square/);
    assert.equal(await page.locator('#request-slider').getAttribute('max'), '1');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#subagent-breadcrumb').isVisible(), true);
    await page.screenshot({ path: `${shots}/t12fix-run${width === 400 ? '-mobile' : ''}.png` });
    await page.locator('#back-main').click();
    assert.equal(await page.locator('#request-slider').inputValue(), '1');
    assert.equal(await page.locator('#quest-progress').textContent(), guideBefore);
    assert.equal(await page.locator('#block-text').textContent(), readerBefore);
    assert.equal(await page.locator('.subagent-row').evaluate(n => n === document.activeElement), true);
    assert.equal(await page.locator('#guess-card').isVisible(), false);
    // Select the Agent call from the index, then use the reader's linked button.
    if (!await page.locator('#index-panel').isVisible()) await menuButton('Index');
    for (const details of await page.locator('.district').all()) await details.evaluate(n => { n.open = true; });
    const call = page.locator('.block-row').filter({ hasText: /^Agenttool_use/ }).first();
    await call.click();
    assert.equal(await page.locator('#open-subagent').isVisible(), true);
    await page.locator('#open-subagent').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#subagent-breadcrumb').isVisible(), true);
    await menuButton('Run summary');
    assert.ok((await page.locator('#run-summary').textContent()).includes('Subagent requests'));
    await page.locator('#run-summary').getByRole('button', { name: 'Close', exact: true }).click();
    if (width === 400 && await page.locator('#app').evaluate(n => n.classList.contains('show-menu'))) await page.locator('#menu-toggle').click();
    await page.locator('#back-main').click();
    await menuButton('Run summary');
    const summary = page.locator('#run-summary');
    assert.match(await summary.locator('.cache-bar').getAttribute('aria-label'), /main thread/);
    for (const label of ['Subagent runs', 'Subagent requests', 'Whole session input', 'Total requests (main thread)']) assert.ok((await summary.textContent()).includes(label));
    await page.screenshot({ path: `${shots}/t12fix-summary${width === 400 ? '-mobile' : ''}.png` });
    await summary.getByRole('button', { name: 'Close', exact: true }).click();
    if (!await page.locator('#show-findings').isVisible()) await page.locator('#menu-toggle').click();
    await page.locator('#show-findings').click();
    const finding = page.locator('.finding').filter({ has: page.locator('.finding-title', { hasText: /^reviewer: Bash result/ }) });
    assert.equal(await finding.count(), 1);
    await finding.click();
    assert.equal(await page.locator('#subagent-breadcrumb').isVisible(), true);
    assert.equal(await page.locator('#request-slider').inputValue(), '1');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    await page.locator('#close-findings').click();
    await page.locator('#back-main').click();
    // Add picker uses the retained main session; the chosen files include only the run.
    await input.setInputFiles(main);
    await page.waitForFunction(() => !document.querySelector('#subagent-banner').hidden);
    await page.getByRole('button', { name: 'Include subagent runs', exact: true }).click();
    await page.keyboard.press('Escape');
    if (!await page.locator('#show-findings').isVisible()) await page.locator('#menu-toggle').click();
    await page.locator('#show-findings').click();
    if (width === 400 && await page.locator('#app').evaluate(n => n.classList.contains('show-menu'))) await page.locator('#menu-toggle').click();
    await page.getByRole('button', { name: 'Include subagent runs', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#add-agents-picker').evaluate(n => n.open), false);
    assert.equal(await page.locator('#findings-panel').isVisible(), true);
    await page.locator('#close-findings').click();
    await page.getByRole('button', { name: 'Include subagent runs', exact: true }).click();
    let chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose files', exact: true }).click();
    await (await chooser).setFiles([{ name: 'settings.json', mimeType: 'application/json', buffer: Buffer.from('{}') }]);
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'No subagent files found');
    assert.equal(await page.locator('#request-slider').getAttribute('max'), '2');
    await page.getByRole('button', { name: 'Include subagent runs', exact: true }).click();
    chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose files', exact: true }).click();
    await (await chooser).setFiles([child, { name: 'agent-run.meta.json', mimeType: 'application/json', buffer: await readFile(meta) }]);
    await page.waitForFunction(() => document.querySelector('#subagent-banner').hidden && document.querySelectorAll('.subagent-row').length === 1);
    assert.equal(await page.locator('#request-slider').getAttribute('max'), '2');
    reports.push({ width, banner: true, list: true, breadcrumb: true, back: true, reader: true, summary: true, finding: true, add: true, fieldGuide: true, backFocus: true, readerRestored: true, noIntroOrGuess: true, dialogEscape: true, emptyAdd: true, horizontalOverflow: false });
    await page.close();
  }
  console.log(JSON.stringify({ reports, consoleErrors: errors }));
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
