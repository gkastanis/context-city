// Run against the bundled artifact; instrumentation is injected only in memory.
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE_MODULE || 'playwright-core');
const port = Number(process.env.T15B_PORT || 8796);
assert.ok(port >= 8790 && port <= 8799);
const artifact = process.env.T15B_ARTIFACT || 'site/index.html';
const html = (await readFile(artifact, 'utf8')).replace('scene = createScene(stage, {', 'scene = window.probeScene = createScene(stage, { dev: true,');
const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); });
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
const shots = process.env.T15B_SHOTS || 'dev/shots';
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] });
const errors = [];
async function pageFor(width, height, reduced = true) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference', ignoreHTTPSErrors: true });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => window.probeScene && document.querySelector('#status').textContent.includes('ready'));
  return page;
}
async function choose(page) {
  await page.locator('#load-example').click();
  await page.locator('#example-2').click();
  await page.waitForFunction(() => probeScene.getStats().metropolis.districts === 5);
  await page.waitForTimeout(700);
}
async function seek(page, idx) {
  await page.locator('#request-slider').fill(String(idx));
  await page.locator('#request-slider').dispatchEvent('change');
  await page.waitForTimeout(700);
}
async function metro(page) {
  if (await page.locator('#tape-toggle').isVisible() && await page.locator('#tape-toggle').getAttribute('aria-expanded') !== 'true') await page.locator('#tape-toggle').click();
  await page.getByRole('button', { name: 'Metropolis', exact: true }).click();
  await page.waitForTimeout(700);
}
function box(points) {
  return { x0: Math.min(...points.map(p => p.x)), x1: Math.max(...points.map(p => p.x)),
    y0: Math.min(...points.map(p => p.y)), y1: Math.max(...points.map(p => p.y)) };
}
try {
  const page = await pageFor(1440, 900);
  assert.equal(await page.locator('#request-slider').inputValue(),'0');
  await choose(page);
  const opening = Number(await page.locator('#request-slider').inputValue());
  const states = await page.evaluate(() => probeScene.getStats().metropolis.states);
  console.log(JSON.stringify({ openingRequest: opening + 1, states }));
  if (!process.env.T15B_BASELINE) assert.ok(states.filter(s => s.state === 'running').length >= 2);
  await page.screenshot({ path: `${shots}/t15b-open.png` });
  for (const [idx, name] of [[0, 'metro-start'], [opening, null], [39, 'metro-end']]) {
    await seek(page, idx); await metro(page);
    const data = await page.evaluate(() => ({ main: probeScene.projectMainCity(),
      districts: probeScene.projectDistricts?.(), all: probeScene.projectMetropolis(), stats: probeScene.getStats() }));
    const main = box(data.main), districts = box(data.districts || data.all);
    const mainShare = (main.x1 - main.x0) / 1440, districtShare = (districts.x1 - districts.x0) / 1440;
    console.log(JSON.stringify({ request: idx + 1, mainShare, districtShare, main, districts, camera: data.stats.camera, viewport: data.stats.viewport, fov: data.stats.fov, rects: data.stats.metropolis.rects }));
    if (!process.env.T15B_BASELINE) {
      assert.ok(mainShare >= .4 && mainShare <= .55, `main city share ${mainShare} at request ${idx + 1}`);
      assert.ok([main, districts].every(b => Object.values(b).every(Number.isFinite) && b.x0 >= 0 && b.x1 <= 1440 && b.y0 >= 0 && b.y1 <= 900));
    }
    if (!name) await page.screenshot({ path: `${shots}/t15b-metro-opening.png` });
    if (name) await page.screenshot({ path: `${shots}/t15b-${name}.png` });
  }
  if (!process.env.T15B_BASELINE) {
    const shares=[];
    for(let idx=0;idx<40;idx++) {
      await page.evaluate(idx=>probeScene.setRequest(idx),idx);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const points=await page.evaluate(()=>probeScene.projectMainCity());
      const b=box(points);shares.push((b.x1-b.x0)/1440);
    }
    console.log(JSON.stringify({allRequestsMainShare:{min:Math.min(...shares),max:Math.max(...shares)}}));
    assert.ok(shares.every(share=>share>=.4&&share<=.55));
    for(const example of [0,1]) {
      await page.locator('#load-example').click();await page.locator(`#example-${example}`).click();
      await page.waitForFunction(()=>probeScene.getStats().metropolis.districts===0);
      assert.equal(await page.locator('#request-slider').inputValue(),'0');
      assert.equal(await page.evaluate(()=>probeScene.getStats().fov),50);
    }
    console.log(JSON.stringify({otherExamplesStartAtRequest:1,otherViewsFov:50}));
  }
  await page.close();
  if (!process.env.T15B_BASELINE) {
    const animated = await pageFor(1440,900,false);
    await choose(animated);
    await animated.waitForFunction(()=>!document.querySelector('#city-intro').hidden);
    const caption=await animated.locator('#city-intro p').textContent();
    await animated.waitForTimeout(2500);
    assert.notEqual(await animated.locator('#city-intro p').textContent(),caption);
    assert.equal(await animated.locator('#request-slider').inputValue(),'6');
    await animated.locator('#skip-intro').click();
    assert.equal(await animated.locator('#city-intro').isVisible(),false);
    console.log(JSON.stringify({introCaptionsAdvance:true,skipClosesIntro:true}));
    await animated.close();
  }
  const phone = await pageFor(400, 860);
  await phone.locator('#menu-toggle').click();
  await choose(phone);
  const menuClosed = await phone.locator('#menu-toggle').getAttribute('aria-expanded') === 'false';
  console.log(JSON.stringify({ phoneMenuClosed: menuClosed }));
  if (!process.env.T15B_BASELINE) assert.ok(menuClosed);
  await phone.screenshot({ path: `${shots}/t15b-phone.png` });
  if (!process.env.T15B_BASELINE) {
    for (const input of ['#transcript-file', '#session-folder']) {
      await phone.locator('#menu-toggle').click();
      const directory=await mkdtemp(path.join(tmpdir(),'city-load-'));
      try {
        await writeFile(path.join(directory,'main-agent.jsonl'),await readFile('test/fixtures/main-agent.jsonl'));
        await phone.locator(input).setInputFiles(input === '#session-folder' ? directory : path.join(directory,'main-agent.jsonl'));
      } finally { await rm(directory,{recursive:true,force:true}); }
      await phone.waitForFunction(() => document.querySelector('#menu-toggle').getAttribute('aria-expanded') === 'false');
      console.log(JSON.stringify({input,menuClosed:true}));
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ consoleErrors: errors.length }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
