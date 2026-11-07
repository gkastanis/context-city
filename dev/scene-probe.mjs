// Run from the repository root; SCENE_URL defaults to a local server on 8766.
import { homedir } from 'node:os';
import { join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE_MODULE || 'playwright-core');
import assert from 'node:assert/strict';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || process.env.CHROMIUM_PATH || join(homedir(), '.cache/ms-playwright/chromium-1247/chrome-linux64/chrome'),
  headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', ignoreHTTPSErrors: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  if(process.env.SCENE_BASELINE) await page.route('**/src/**/*.js', async route=>{ const {readFile}=await import('node:fs/promises');const path=new URL(route.request().url()).pathname;try{await route.fulfill({contentType:'text/javascript',body:await readFile(process.env.SCENE_BASELINE+path,'utf8')});}catch{await route.continue();}});
  await page.goto(`${process.env.SCENE_URL || 'http://127.0.0.1:8766'}/dev/scene.html?stress=3000`);
  await page.waitForFunction(() => window.sceneAPI, { timeout: 60000 });
  await page.evaluate(async () => {
    const { createScene } = await import('../src/scene/index.js');
    window.sceneAPI.dispose();
    window.probeEvents = []; window.probeSelections = [];
    window.sceneAPI = createScene(document.querySelector('#stage'), { dev: true,
      onModeChange: (mode, info) => probeEvents.push({ mode, ...info }),
      onSelect: id => probeSelections.push(id), onError: e => console.error(e.message) });
    sceneAPI.setSession(sampleSession);
    const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/+esm');
    const originalUpdate = THREE.Camera.prototype.updateMatrixWorld;
    THREE.Camera.prototype.updateMatrixWorld = function(...args) {
      if (this.isPerspectiveCamera && this.near === 0.05) window.probeCamera = this;
      return originalUpdate.apply(this, args);
    };
  });
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const stats = async label => { await page.evaluate(()=>{sceneAPI.setQuality('low');sceneAPI.setQuality('high');}); await settle(); const result = await page.evaluate(() => sceneAPI.getStats()); console.log(label, JSON.stringify(result)); return result; };
  // Warm the lazily allocated composer targets before recording the baseline.
  await page.evaluate(() => sceneAPI.enterBlock('stress:1')); await settle();
  await page.evaluate(() => sceneAPI.exitInside()); await settle();
  const city = await stats('city');
  await page.evaluate(() => sceneAPI.enterDistrict(0));
  await stats('hall page 1');
  // Cross the More door, exercising the same route as clicking its panel.
  await page.evaluate(() => { const c = document.querySelector('#stage canvas'); for (let i = 0; i < 61; i++) c.dispatchEvent(new WheelEvent('wheel', { deltaY: 200, bubbles: true, cancelable: true })); });
  await stats('hall page 2');
  assert.equal(await page.evaluate(() => probeEvents.at(-1).page), 1);
  await page.evaluate(() => sceneAPI.enterBlock('stress:1'));
  await stats('160 KB corridor start');
  await page.evaluate(() => { const c = document.querySelector('#stage canvas'); for (let i = 0; i < 30; i++) c.dispatchEvent(new WheelEvent('wheel', { deltaY: 200, bubbles: true, cancelable: true })); });
  await stats('160 KB corridor far end');
  await page.evaluate(() => sceneAPI.exitInside());
  const exited = await stats('after exit');
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => sceneAPI.enterBlock('stress:1')); await settle();
    await page.evaluate(() => sceneAPI.exitInside()); await settle();
  }
  const cycled = await stats('after 5 enter/exit cycles');
  assert.deepEqual(cycled.memory, exited.memory);
  assert.equal(cycled.memory.textures, city.memory.textures);
  assert.ok(city.memory.geometries < 20);
  assert.ok(city.render.calls < 40);
  const componentChecks = await page.evaluate(async () => {
    const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/+esm');
    const { createInterior } = await import('../src/scene/interior.js');
    const { createCity } = await import('../src/scene/city.js');
    const { layoutRequest } = await import('../src/layout.js');
    const session = sampleSession, layout = layoutRequest(session, 0), camera = new THREE.PerspectiveCamera();
    const exterior = createCity();
    exterior.update(layout, new Set(), false);
    const oldBatches = exterior.group.children.filter(c => c.isInstancedMesh);
    let disposedBatches = 0;
    oldBatches.forEach(mesh => mesh.addEventListener('dispose', () => disposedBatches++));
    exterior.clear();
    if (!oldBatches.length || disposedBatches !== oldBatches.length ||
      exterior.group.children.some(c => c.isInstancedMesh)) throw new Error('Clear retained instance buffers');
    const small = layoutRequest({ ...session, requests: [{ ...session.requests[0], blockIds: ['stress:1'] }] }, 0);
    exterior.update(small, new Set(), false);
    const smallBatches = exterior.group.children.filter(c => c.isInstancedMesh);
    if (smallBatches.some(c => c.instanceMatrix.count > 16)) throw new Error('Clear retained old batch capacity');
    exterior.dispose();
    window.probeBatchChecks = { disposedBatches, freshCapacity: 16 };
    let reduced = false;
    const interior = createInterior(() => {}, () => reduced);
    interior.buildBlock(session, layout, 'stress:1'); interior.applyCamera(camera);
    const pages = interior.group.children.filter(c => c.userData.buildTexture);
    if (pages.length !== 13) throw new Error('Corridor page budget');
    const page = pages[0], texture = page.material.map;
    const doors = interior.group.children[0].children.slice();
    interior.rebuild(session, layout); interior.applyCamera(camera);
    if (page.material.map !== texture || interior.group.children[0].children[0] !== doors[0]) throw new Error('Unchanged interior resource churn');
    const changed = structuredClone(layout); changed.items.splice(2, 1);
    interior.rebuild(session, changed); interior.applyCamera(camera);
    if (page.material.map !== texture || interior.group.children[0].children[0] === doors[0]) throw new Error('Door-only refresh failed');
    const start = camera.position.clone(); page.userData.action(); interior.applyCamera(camera);
    if (!camera.position.equals(start)) throw new Error('Page click teleported');
    interior.tick(0.2); interior.applyCamera(camera); const halfway = camera.position.clone();
    interior.tick(0.2); interior.applyCamera(camera);
    if (halfway.equals(start) || halfway.equals(camera.position)) throw new Error('Page click did not glide');
    reduced = true; pages[1].userData.action(); interior.applyCamera(camera);
    const immediate = camera.position.clone(); interior.tick(0.1); interior.applyCamera(camera);
    if (!immediate.equals(camera.position)) throw new Error('Reduced-motion page click was animated');
    interior.dispose();
    return { contentPages: 12, continuationPages: 1, unchangedResourcesRetained: true, changedDoorsOnly: true, glideSeconds: 0.4, reducedMotionImmediate: true };
  });
  console.log('component checks', JSON.stringify(componentChecks));
  console.log('batch checks', JSON.stringify(await page.evaluate(() => probeBatchChecks)));
  const timing = await page.evaluate(async () => {
    const session = structuredClone(sampleSession), ids = session.requests[0].blockIds;
    session.requests = Array.from({ length: 8000 }, (_, idx) => ({ ...session.requests[0], idx,
      blockIds: idx % 2 ? ids.slice(0, 2500) : ids, newBlockIds: [], measuredTokens: idx % 2 ? 50000 : 60000 }));
    sceneAPI.setSession(session);
    sceneAPI.flyToBlock('stress:100');
    const before = probeCamera.position.clone();
    const eventsBeforeFrame = probeEvents.length;
    for (let i = 1; i <= 50; i++) sceneAPI.setRequest(i % 2);
    sceneAPI.setRequest(1);
    if (probeEvents.length !== eventsBeforeFrame) throw new Error('Framed scrub emitted mode changes');
    if (probeCamera.position.equals(before)) throw new Error('Framed block did not follow shifted offsets');
    sceneAPI.overview();
    // Warm the label variants, then measure 50 synchronous slider updates.
    sceneAPI.setRequest(1); sceneAPI.setRequest(0); probeSelections.length = 0;
    const eventsBeforeScrub = probeEvents.length;
    const start = performance.now();
    for (let i = 0; i < 50; i++) sceneAPI.setRequest(i);
    const elapsed = performance.now() - start;
    if (probeSelections.length) throw new Error('Null selection callback during scrub');
    if (probeEvents.length !== eventsBeforeScrub) throw new Error('Overview scrub emitted mode changes');
    sceneAPI.enterBlock('stress:1');
    const textures = sceneAPI.getStats().memory.textures;
    sceneAPI.setRequest(0); sceneAPI.setRequest(1);
    if (sceneAPI.getMode() !== 'inside' || sceneAPI.getStats().memory.textures !== textures) throw new Error('Surviving interior rebuilt');
    // Remove the active interior and require an overview flight (immediate here).
    session.requests[2] = { ...session.requests[2], blockIds: ids.slice(2) };
    sceneAPI.setRequest(2);
    if (sceneAPI.getMode() !== 'city' || !probeEvents.some(e => e.view === 'overview' && e.requestIdx === 2)) throw new Error('Removed interior did not recover');
    if (probeCamera.position.y < 10) throw new Error('Camera remained inside removed building');
    return { requests: session.requests.length, blocks: ids.length, calls: 50, framedScrubModeChanges: 0, overviewScrubModeChanges: 0, elapsedMs: elapsed, perCallMs: elapsed / 50 };
  });
  console.log('scrub timing', JSON.stringify(timing));
  assert.ok(timing.perCallMs < 8, `Scrub exceeded 8 ms: ${timing.perCallMs}`);
  console.log('browser errors', JSON.stringify(errors));
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
