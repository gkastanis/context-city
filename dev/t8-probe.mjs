import assert from 'node:assert/strict';
import { mkdir, readFile, readdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE_MODULE);
const shots = process.env.T8_SHOTS || 'dev/shots';
const base = process.env.T5B_URL || 'http://127.0.0.1:8873';
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const format of ['dist', 'site']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
    const errors = [], dialogs = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('dialog', async d => { dialogs.push(d.type()); await d.dismiss(); });
    // Observe actual bundled execution without adding production debug hooks.
    await page.route(`**/${format}/index.html`, async route => {
      const response = await route.fetch();
      let body = await response.text();
      body = body.replace('const reader = createReaderPane(enter);', 'const reader = window.t8Reader = createReaderPane(enter);');
      body = body.replace('session = value; requestIdx = 0;', 'session = window.t8Session = value; window.t8Select = select; window.t8Jump = jump; requestIdx = 0;');
      body = body.replace('scene = createScene(stage, {', 'scene = window.t8Scene = createScene(stage, {');
      body = body.replace('playEvent(event) {', 'playEvent(event) { window.t8Events ??= []; window.t8Events.push(event.type); if(event.type === "compaction") document.querySelector("#pause-timelapse").click();');
      await route.fulfill({ response, body });
    });
    await page.goto(`${base}/${format}/index.html`);
    console.log(`${format}: document loaded`);
    await page.waitForFunction(() => window.t8Scene && document.querySelector('#scene-status').hidden, null, { timeout: 60000 });
    console.log(`${format}: scene ready`);
    assert.equal(await page.evaluate(() => t8Session.meta.redacted === true), false);
    const inventedRequests = await page.evaluate(() => t8Session.requests.length);
    if (format === 'site') assert.equal(await page.evaluate(() => document.compatMode), 'CSS1Compat');
    async function dismissIntro() {
      if (await page.locator('#skip-intro').isVisible()) await page.locator('#skip-intro').evaluate(n => n.click());
      if (await page.locator('#guess-card').isVisible()) await page.locator('#guess-card').getByRole('button', { name: 'Dismiss' }).click();
    }
    await dismissIntro();
    await page.locator('#load-example').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#example-chooser').isVisible(), true);
    await page.locator('#example-1').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.t8Session.meta.redacted === true);
    await dismissIntro(); await page.waitForTimeout(1800);
    assert.match(await page.locator('#session-info').textContent(), /224 requests/);
    assert.equal(await page.locator('#redacted-notice').isVisible(), true);
    const counts = await page.evaluate(() => {
      const blocks = Object.values(t8Session.blocks);
      return { requests: t8Session.requests.length, blocks: blocks.length,
        readable: blocks.filter(b => b.text !== null).length,
        compactions: t8Session.events.filter(e => e.type === 'compaction').length,
        compaction: t8Session.events.find(e => e.type === 'compaction').requestIdx,
        otherText: blocks.filter(b => b.text !== null && (b.kind !== 'user_text' || b.provenance !== 'verbatim')).length };
    });
    assert.equal(counts.requests, 224); assert.equal(counts.blocks, 1114);
    assert.equal(counts.readable, 8); assert.equal(counts.otherText, 0); assert.equal(counts.compactions, 1);
    const shot = name => page.screenshot({ path: `${shots}/t8-${format}-${name}.png` });
    await shot('first');
    const readerChecks = await page.evaluate(() => {
      let readable = 0, redacted = 0;
      for (const b of Object.values(t8Session.blocks)) {
        t8Reader.show(b, b.estTokens);
        const text = document.querySelector('#block-text').textContent;
        const badge = document.querySelector('.provenance').textContent;
        if (b.text !== null) { if (text !== b.text || !badge.startsWith('Verbatim')) throw Error('Readable prompt mismatch'); readable++; }
        else { if (text !== '' || !badge.startsWith('Redacted:') || !badge.includes(`${b.chars} characters`)) throw Error('Redaction mismatch'); redacted++; }
      }
      t8Reader.show(null);
      return { readable, redacted };
    });
    assert.deepEqual(readerChecks, { readable: 8, redacted: 1106 });
    await page.evaluate(() => t8Jump(t8Session.requests.length - 1, true)); await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Whole session', exact: true }).click();
    await page.waitForTimeout(1800); await shot('whole-session');
    await page.evaluate(idx => t8Jump(idx - 1, true), counts.compaction); await page.waitForTimeout(700);
    await page.locator('#timelapse-rate').selectOption('1');
    await page.locator('#play-timelapse').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.t8Events?.includes('compaction'), null, { timeout: 20000 });
    assert.equal(Number(await page.locator('#request-slider').inputValue()), counts.compaction);
    assert.match(await page.locator('#request-story').textContent(), /Compaction:/);
    await page.waitForTimeout(2000); await shot('after-compaction');
    // The accessible marker represents every event, including the compaction.
    const eventIndex = await page.evaluate(() => [...t8Session.events].sort((a,b) => a.requestIdx-b.requestIdx).findIndex(e => e.type === 'compaction'));
    await page.locator('.event-marker').focus(); await page.keyboard.press('Home');
    for (let i = 0; i < eventIndex; i++) await page.keyboard.press('ArrowRight');
    assert.match(await page.locator('.event-marker').getAttribute('aria-label'), /compaction/i);
    await page.keyboard.press('Enter');
    async function selectBlock(readable) {
      await page.evaluate(readable => {
        const b = Object.values(t8Session.blocks).find(b => readable ? b.text !== null : b.text === null);
        const idx = t8Session.requests.findIndex(r => r.blockIds.includes(b.id));
        t8Jump(idx, true);
        window.t8Chosen = b.id;
      }, readable);
      await page.waitForTimeout(500);
      await page.evaluate(() => t8Select(t8Chosen)); await page.waitForTimeout(500);
    }
    await selectBlock(false); assert.match(await page.locator('.provenance').textContent(), /^Redacted:/); await shot('reader-redacted');
    await selectBlock(true); assert.match(await page.locator('.provenance').textContent(), /^Verbatim/); await shot('reader-prompt');
    await page.locator('[aria-controls="reader-panel"]').click();
    await page.locator('[aria-controls="field-guide"]').click();
    await page.getByRole('button', { name: 'Find the system prompt', exact: true }).click();
    assert.match(await page.locator('#quest-progress').textContent(), /^[1-9]/);
    await page.getByRole('button', { name: 'Run summary', exact: true }).click();
    assert.match(await page.locator('#run-summary').textContent(), /Total requests224/);
    await page.locator('#run-summary').getByRole('button', { name: 'Close', exact: true }).click();
    await page.setViewportSize({ width: 400, height: 860 }); await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 400);
    assert.equal(await page.locator('#redacted-notice').isVisible(), true);
    await shot('phone');
    await page.locator('#menu-toggle').click(); await page.locator('#load-example').click();
    assert.equal(await page.locator('#example-1').isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 400);
    await page.locator('#example-0').click();
    await page.waitForFunction(() => !t8Session.meta.redacted);
    assert.equal(await page.locator('#redacted-notice').isVisible(), false);
    await page.setViewportSize({ width: 1440, height: 900 }); await dismissIntro();
    const xssName = (await readdir('dev')).find(n => n.startsWith('xss-') && n.endsWith('.jsonl'));
    assert.ok(xssName, 'T5e XSS fixture must exist');
    await page.setInputFiles('#transcript-file', { name: '</script><img src=x onerror=alert(1)> <b> <!--<script>.jsonl', mimeType: 'application/jsonl', buffer: await readFile(`dev/${xssName}`) });
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'Transcript ready. File read in this tab.');
    await dismissIntro();
    const xss = await page.evaluate(() => {
      for (const b of Object.values(t8Session.blocks)) t8Reader.show(b, b.estTokens);
      return { executed: Boolean(window.xss || window.__xss || window.XSS || window.__pwned), injected: document.querySelectorAll('#app img, #app script, #reader-panel b, #index-panel b').length };
    });
    assert.deepEqual(xss, { executed: false, injected: 0 });
    assert.deepEqual(dialogs, []); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ format, inventedRequests, ...counts, readerChecks, xss, errors, screenshots: 6 }));
    await page.close();
  }
} finally { await browser.close(); }
