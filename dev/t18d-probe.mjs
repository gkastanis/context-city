import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE_MODULE);
const shots = process.env.T18D_SHOTS || '/tmp/t18d-shots';
const ports = [Number(process.env.T18D_HEAD_PORT || 8792), Number(process.env.T18D_PORT || 8793)];
assert.ok(ports.every(p => p >= 8790 && p <= 8799));
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] });
const errors = [], comparisons = [], contrast = [];
let checks = 0;
function check(condition, label) { assert.ok(condition, label); checks++; }
async function geometry(page) {
  return page.evaluate(() => {
    const box = selector => {
      const n = document.querySelector(selector);
      if (!n) return null;
      const { x, y, width, height } = n.getBoundingClientRect();
      return { x, y, width, height };
    };
    return { timeline: box('#timeline'), svg: box('#timeline > svg'), path: box('.spark-path'),
      graphMainLine: box('.agent-main-line'), mainTicks: document.querySelectorAll('#timeline > svg .failure-tick').length,
      graphMainTicks: document.querySelectorAll('.agent-graph > .failure-tick-target').length,
      branchTicks: document.querySelectorAll('.agent-branch .failure-tick').length };
  });
}
async function openTools(page) {
  if (await page.locator('#menu-toggle').isVisible()) await page.locator('#menu-toggle').click();
  await page.locator('#show-tools').click();
}
async function tabContrast(page, selected) {
  const result = await page.locator('.tools-tabs button').evaluateAll(nodes => nodes.map(n => {
    const style = getComputedStyle(n);
    const luminance = color => {
      const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => {
        v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
      });
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    const a = luminance(style.color), b = luminance(style.backgroundColor);
    return { selected: n.getAttribute('aria-selected') === 'true', ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
  }));
  check(result.every(r => r.ratio >= 4.5), 'tab contrast meets 4.5:1');
  check(await page.locator(`#${selected}-tab`).getAttribute('aria-selected') === 'true', 'selected tab ARIA state');
  contrast.push(...result);
}
try {
  for (const [width, height, name] of [[1440, 900, 'city'], [400, 860, 'mobile']]) {
    const pair = { width, height };
    for (const [index, port] of ports.entries()) {
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: 'light' });
      await context.route('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', r => r.fulfill({ path: process.env.THREE_MODULE_PATH, contentType: 'text/javascript' }));
      await context.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.name));
      page.on('console', m => { if (m.type() === 'error') errors.push('console error'); });
      await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
      await page.locator('#stage canvas').waitFor({ timeout: 60000 });
      await page.waitForFunction(() => document.querySelector('#scene-status')?.hidden);
      const skip = page.getByRole('button', { name: 'Skip', exact: true });
      await skip.waitFor({ state: 'visible' });
      if (await skip.isVisible()) await skip.click();
      // Use the default Overview at the startup request, without an orbit drag.
      // Phone tucks these controls under More; invoke the same button action
      // without expanding that footer and changing the comparison geometry.
      await page.locator('.camera-controls button').filter({ hasText: /^Overview$/ }).evaluate(n => n.click());
      await page.waitForTimeout(2000);
      const build = index ? 'current' : 'head';
      pair[build] = await geometry(page);
      await page.screenshot({ path: `${shots}/t18d-${index ? '' : 'head-'}${name}.png` });
      if (index) {
        check(pair.current.mainTicks === 1 && pair.current.graphMainTicks === 1 && pair.current.branchTicks === 1, 'sample has one main and one subagent failure');
        check(pair.current.svg.x + pair.current.svg.width <= pair.current.timeline.x + pair.current.timeline.width, 'sparkline fits card');
        const tick = page.locator('#timeline > svg .failure-tick');
        const tickBox = await tick.boundingBox();
        check(tickBox.width > 0 || tickBox.height > 0, 'main failure tick renders');
        check(tickBox.x >= pair.current.svg.x && tickBox.x <= pair.current.svg.x + pair.current.svg.width && tickBox.y >= pair.current.svg.y && tickBox.y + tickBox.height <= pair.current.svg.y + pair.current.svg.height, 'main failure tick inside SVG');
        if (width === 400) {
          await openTools(page);
          await tabContrast(page, 'tools');
          check(await page.locator('.tools-table thead').isHidden(), 'stacked cards hide table header');
          await page.locator('#tools-tab').hover(); await tabContrast(page, 'tools');
          await page.screenshot({ path: `${shots}/t18d-mobile-tools.png` });
          await page.locator('#failures-tab').click();
          await tabContrast(page, 'failures');
          await page.locator('#tools-tab').hover(); await tabContrast(page, 'failures');
          await page.screenshot({ path: `${shots}/t18d-mobile-failures.png` });
          check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no mobile document overflow');
          await page.locator('#close-tools').click();
        }
      }
      // Also compare the same session without subagent lanes.
      await page.locator('#transcript-file').setInputFiles('test/fixtures/tools-demo.jsonl');
      await page.waitForFunction(() => !document.querySelector('#timeline').classList.contains('has-agent-lanes'));
      await page.waitForTimeout(500);
      pair[`${build}WithoutAgents`] = await geometry(page);
      await context.close();
    }
    for (const suffix of ['', 'WithoutAgents']) for (const key of ['timeline', 'svg', 'path']) {
      for (const coordinate of ['x', 'y', 'width', 'height']) {
        check(Math.abs(pair[`head${suffix}`][key][coordinate] - pair[`current${suffix}`][key][coordinate]) < .1,
          `${width} ${suffix || 'with agents'} ${key}.${coordinate} matches HEAD`);
      }
    }
    comparisons.push(pair);
  }
  check(errors.length === 0, 'no browser console or page errors');
  const report = { checks, consoleErrors: errors.length, comparisons, contrast, screenshots: 6 };
  await writeFile(`${shots}/t18d-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
