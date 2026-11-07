import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE_MODULE);
const shots = process.env.T5B_SHOTS || 'dev/shots';
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
page.on('dialog', async d => { errors.push('Unexpected dialog'); await d.dismiss(); });
try {
  await page.goto(`${process.env.T5B_URL || 'http://127.0.0.1:8789'}/dist/index.html`);
  await page.waitForFunction(() => document.querySelector('#status')?.textContent === 'Example session ready.');
  await page.waitForFunction(() => document.querySelector('#scene-status')?.hidden, null, { timeout: 60000 });
  await page.waitForTimeout(1000);
  if (await page.locator('#skip-intro').isVisible()) await page.locator('#skip-intro').evaluate(n=>n.click());
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('#stage canvas').count(), 1);
  const sceneBounds = await page.locator('#stage').boundingBox();
  assert.equal(sceneBounds.width, 1440); assert.equal(sceneBounds.height, 1000);
  await page.screenshot({ path: `${shots}/t5b-desktop.png` });
  console.log('Sample: ' + await page.locator('#request-position').textContent());
  await page.getByRole('button', {name:'How much of this city is tools? Take a guess'}).click();
  await page.locator('#share-guess').fill('42'); await page.getByRole('button', { name: 'Check my guess' }).click();
  assert.match(await page.locator('#guess-card').textContent(), /Off by/);
  await page.getByRole('button', { name: 'Try the window' }).click(); await page.getByRole('button', { name: 'Check my guess' }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('[aria-controls="field-guide"]').click();
  await page.getByRole('button', { name: 'Find the system prompt', exact: true }).click();
  assert.match(await page.locator('#quest-progress').textContent(), /^1 of/);
  assert.ok(await page.locator('#reader-panel').isVisible());
  await page.screenshot({ path: `${shots}/t5b-reader.png` });
  await page.locator('[aria-controls="reader-panel"]').click();
  await page.setInputFiles('#transcript-file', 'test/fixtures/session.jsonl');
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Transcript ready. File read in this tab.');
  if (await page.locator('#skip-intro').isVisible()) await page.locator('#skip-intro').evaluate(n=>n.click());
  assert.equal(await page.locator('#request-slider').getAttribute('max'), '2');
  await page.locator('#load-transcript').focus(); assert.equal(await page.locator('#load-transcript').evaluate(n => n === document.activeElement), true);
  await page.locator('#play-timelapse').focus(); await page.keyboard.press('Enter');
  await page.waitForTimeout(1100); await page.locator('#pause-timelapse').click();
  const paused = await page.locator('#request-slider').inputValue();
  await page.waitForTimeout(1100); assert.equal(await page.locator('#request-slider').inputValue(), paused);
  const marker = page.locator('.event-marker'); assert.equal(await marker.count(), 1);
  await marker.focus(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#request-slider').value === '2');
  await page.locator('#request-slider').focus(); await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('#request-slider').value === '1');
  await page.locator('[aria-controls="field-guide"]').focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.locator('#timelapse-rate').selectOption('16'); await page.locator('#play-timelapse').click();
  await page.locator('#run-summary[open]').waitFor();
  assert.match(await page.locator('#run-summary').textContent(), /Total requests3/);
  await page.locator('#run-summary').getByRole('button', { name: 'Close' }).click();
  console.log('Fixture: 3 requests; Play, Pause, End marker, slider arrows, Field guide keyboard and summary passed.');
  await page.locator('#load-example').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Example session ready.');
  if (await page.locator('#skip-intro').isVisible()) await page.locator('#skip-intro').evaluate(n=>n.click());
  await page.setViewportSize({ width: 400, height: 800 }); await page.locator('#menu-toggle').click();
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 400);
  await page.screenshot({ path: `${shots}/t5b-phone.png` });
  await page.locator('[aria-controls="field-guide"]').click();
  await page.screenshot({ path: `${shots}/t5b-phone-guide.png` });
  await page.locator('[aria-controls="index-panel"]').click();
  assert.equal(await page.locator('#field-guide').isVisible(), false);
  assert.equal(await page.locator('#index-panel').isVisible(), true);
  console.log('Phone: 400 x 800, scrollWidth 400, mutually exclusive sheets passed.');
  // Test reduced motion and hook detection against the real current scene API.
  const hooks = await page.evaluate(async () => {
    const { createScene } = await import('/src/scene/index.js');
    const host = document.createElement('div'); Object.assign(host.style, { position: 'fixed', width: '100px', height: '100px' }); document.body.append(host);
    const scene = createScene(host);
    const missing = ['playIntro', 'setAtmosphere', 'celebrate', 'playEvent', 'setQuality'].filter(name => typeof scene[name] !== 'function');
    scene.dispose(); host.remove(); return missing;
  });
  console.log('Missing scene hooks: ' + JSON.stringify(hooks));
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.locator('#load-example').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Example session ready.');
  assert.equal(await page.locator('#city-intro').isVisible(), false);
  // This separate UI instance exercises every optional hook being absent.
  await page.evaluate(async () => {
    const { createGame } = await import('/src/ui/game.js');
    const game = createGame({ call() {}, jump() {}, locate() {} });
    game.setSession({ blocks: {}, requests: [], events: [], meta: { window: 1e6 } });
    game.startIntro(); game.update(0); game.dispose();
  });
  if (process.env.XSS_FILE) {
    const baselineBold = await page.locator('#app b').count();
    await page.setInputFiles('#transcript-file', {name: '</script><img src=x onerror=alert(1)> <b> <!--<script>.jsonl', mimeType: 'application/jsonl', buffer: await readFile(process.env.XSS_FILE)});
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'Transcript ready. File read in this tab.');
    if (await page.locator('[aria-controls="index-panel"]').getAttribute('aria-expanded') !== 'true') await page.locator('[aria-controls="index-panel"]').click();
    assert.ok((await page.locator('#session-info').textContent()).includes('<img src=x onerror=alert(1)> <b> <!--<script>.jsonl'));
    for (let idx=0;idx<3;idx++) {
      await page.locator('#request-slider').evaluate((n,i)=>{n.value=i;n.dispatchEvent(new Event('change',{bubbles:true}));},idx);
      await page.evaluate(()=>document.querySelectorAll('.district').forEach(n=>n.open=true));
      await page.waitForTimeout(150);
      for(const row of await page.locator('.block-row').all()) await row.evaluate(n=>n.click());
    }
    const district = page.locator('.district summary').first();
    if (await district.count()) { await district.evaluate(n=>n.parentNode.open=true); const row = page.locator('.block-row').first(); if (await row.count()) await row.evaluate(n=>n.click()); }
    assert.equal(await page.evaluate(() => Boolean(window.xss || window.__xss || window.XSS || window.__pwned)), false);
    assert.equal(await page.locator('#app script, #app img, #reader-panel b, #index-panel b').count(), 0);
    assert.equal(await page.locator('#app b').count(), baselineBold);
    console.log('XSS payload and filename loaded: 0 injected img/b elements, 0 dialogs, 0 execution.');
  }
  const mechanics = await page.evaluate(async () => {
    const { createGame } = await import('/src/ui/game.js');
    const calls = [];
    const game = createGame({ call(method) { calls.push(method); }, jump() {}, locate() {} });
    const b = (id, kind, layer, estTokens) => ({ id, kind, layer, estTokens, toolName: id });
    const blocks = { system: b('system', 'system', 'system', 20), tool: b('tool', 'tool_def', 'tools', 80), user: b('user', 'user_text', 'message', 10) };
    const requests = [0, 1, 2].map(idx => ({ idx, blockIds: Object.keys(blocks), estTokens: 110 }));
    game.setSession({ blocks, requests, meta: { window: 1000 }, events: [
      { type: 'tool_loaded', requestIdx: 1, data: { names: ['tool'] } }, { type: 'compaction', requestIdx: 2 },
    ] });
    game.select('system'); game.select('tool'); game.enter('tool'); game.select('user');
    game.update(1); game.select('tool'); game.update(2);
    game.mode('reading', {}); await new Promise(resolve => setTimeout(resolve, 10300)); game.mode('city');
    const result = { progress: game.guide.querySelector('#quest-progress').textContent, celebrations: calls.filter(x => x === 'celebrate').length };
    game.dispose(); return result;
  });
  assert.deepEqual(mechanics, { progress: '7 of 7 found', celebrations: 7 });
  console.log('Game mechanics: ' + JSON.stringify(mechanics));
  console.log('Errors: ' + JSON.stringify(errors)); assert.deepEqual(errors, []);
} finally { await context.close(); await browser.close(); }
