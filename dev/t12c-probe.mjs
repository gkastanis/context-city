import assert from 'node:assert/strict';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { timeScale } from '../src/ui/timeline.js';
import { parseFiles } from '../src/ui/loader.js';
import { agentBranches, maxParallel, runDuration } from '../src/ui/agents.js';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE_MODULE);
const base = process.env.T12C_URL || 'http://127.0.0.1:8796';
const shots = process.env.T12C_SHOTS || 'dev/shots';
await mkdir(shots, { recursive: true });
const fixture = name => new URL(`../test/fixtures/${name}`, import.meta.url);
const payload = (name, buffer) => ({ name, buffer, mimeType: 'application/json' });
const main = payload('main-agent-branches.jsonl', await readFile(fixture('main-agent-branches.jsonl')));
const runs = (await Promise.all(['a', 'b', 'c', 'd'].map(async id => [
  payload(`agent-${id}.jsonl`, await readFile(fixture(`agent-branch-${id}.jsonl`))),
  payload(`agent-${id}.meta.json`, Buffer.from(JSON.stringify({ agentType: id === 'b' ? 'explorer' : 'reviewer', toolUseId: `call-${id}`, description: `Review synthetic square ${id}` }))),
]))).flat();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] });
const errors = [], reports = [];
async function pageFor(width) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce', ignoreHTTPSErrors: true });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  if (process.env.T12E) {
    await page.route('**/dist/index.html', async route => {
      const response = await route.fetch();
      const body = (await response.text()).replace(/const exampleData = (.*?); \/\* SAMPLE_DATA \*\//, (_, data) => {
        const examples = JSON.parse(data);
        const sample = JSON.parse(examples[0]);
        // Invented minute intervals enable By time for the timestamp-free sample.
        sample.requests.forEach((r, i) => { r.time = Date.UTC(2026, 0, 1) + i * 60000; });
        examples[0] = JSON.stringify(sample);
        return `const exampleData = ${JSON.stringify(examples)}; /* SAMPLE_DATA */`;
      });
      await route.fulfill({ response, body });
    });
  }
  await page.goto(`${base}/dist/index.html`);
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('ready'));
  return page;
}
async function load(page, files, count = 4) {
  await page.locator('#transcript-file').setInputFiles(files);
  await page.waitForFunction(n => document.querySelectorAll('.agent-branch').length === n, count);
  await page.waitForTimeout(300);
}
async function alignment(page, intervals) {
  const actual = await page.evaluate(() => {
    const spark = document.querySelector('#timeline > svg'), graph = document.querySelector('.agent-graph');
    const s = spark.getBoundingClientRect(), g = graph.getBoundingClientRect();
    const points = [...spark.querySelector('.spark-path').points].map(p => p.x / 600 * s.width + s.x);
    return { sx: s.x, sw: s.width, gx: g.x, gw: g.width, points,
      branches: [...document.querySelectorAll('.agent-branch')].map(n => ({ fork: Number(n.dataset.forkX) + g.x, merge: Number(n.dataset.mergeX) + g.x })) };
  });
  assert.ok(Math.abs(actual.sx - actual.gx) < 1); assert.ok(Math.abs(actual.sw - actual.gw) < 1);
  intervals.forEach(([fork, merge], i) => {
    if (i === 3) return;
    assert.ok(Math.abs(actual.branches[i].fork - actual.points[fork]) < 1, `fork ${i}`);
    assert.ok(Math.abs(actual.branches[i].merge - actual.points[merge]) < 1, `merge ${i}`);
  });
}
async function markersAligned(page) {
  await page.locator('#request-slider').fill('7'); await page.locator('#request-slider').dispatchEvent('change');
  const event = page.locator('.event-marker');
  await event.focus(); await page.keyboard.press('End');
  const positions = await page.evaluate(() => {
    const spark = document.querySelector('#timeline > svg'), pts = spark.querySelector('.spark-path').points;
    return { cursor: Number(spark.querySelector('.spark-cursor').getAttribute('x1')), expected: pts[7].x,
      graphCursor: parseFloat(document.querySelector('.agent-lane-cursor').style.left),
      event: parseFloat(document.querySelector('.event-marker').style.left), eventExpected: pts[9].x / 6 };
  });
  assert.ok(Math.abs(positions.cursor - positions.expected) < .01);
  assert.ok(Math.abs(positions.graphCursor - positions.expected / 6) < .01);
  assert.ok(Math.abs(positions.event - positions.eventExpected) < .01);
  await page.locator('#request-slider').fill('0'); await page.locator('#request-slider').dispatchEvent('change');
}

// T12e measures rendered boxes only. Real-session text never enters the report.
async function layoutChecks() {
  const extra = ['e', 'f'].flatMap(id => [payload(`agent-${id}.jsonl`, runs[0].buffer),
    payload(`agent-${id}.meta.json`, Buffer.from(JSON.stringify({ agentType: 'reviewer', toolUseId: 'call-a', description: 'Synthetic overlap' })))]);
  const cases = [{ name: 'plain', files: null, count: 0 },
    { name: 'branches', files: [main, ...runs], count: 4 },
    { name: 'expanded', files: [main, ...runs, ...extra], count: 6 }];
  if (process.env.T12C_REAL_MAIN) {
    const p = process.env.T12C_REAL_MAIN, dir = p.replace(/\.jsonl$/, '') + '/subagents';
    const names = (await readdir(dir)).filter(n => /^agent-.*\.(jsonl|meta\.json)$/.test(n));
    const paths = [p, ...names.map(n => path.join(dir, n))];
    const { session } = await parseFiles(await Promise.all(paths.map(async f => new File([await readFile(f)], path.basename(f))))).promise;
    console.log(JSON.stringify({ real: { requests: session.requests.length, runs: session.agents.length } }));
    cases.push({ name: 'real', files: paths, count: agentBranches(session).length });
  }
  for (const item of cases) for (const width of [1440, 400]) {
    const page = await pageFor(width);
    if (item.files) await load(page, item.files, item.count);
    // Exercise the visible walk controls on mobile as well as their collapsed state.
    for (const axis of ['request', 'time']) {
      await page.getByRole('button', { name: axis === 'time' ? 'By time' : 'By request', exact: true }).click();
      if (item.name === 'expanded') {
        const toggle = page.locator('.agent-lane-toggle');
        if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
      }
      for (const zoomed of [false, true]) {
        if (zoomed) {
          const r = await page.locator('#request-slider').boundingBox();
          await page.locator('#request-slider').dispatchEvent('wheel', { ctrlKey: true, deltaY: -100, clientX: r.x + r.width / 2 });
          assert.equal(await page.getByRole('button', { name: 'Zoom out', exact: true }).isVisible(), true);
        }
        for (const tools of width === 400 ? [false, true] : [true]) {
          if (width === 400 && await page.locator('#tape-toggle').getAttribute('aria-expanded') !== String(tools)) await page.locator('#tape-toggle').click();
          await page.waitForTimeout(150);
          const boxes = await page.evaluate(() => {
            const box = selector => {
              const n = document.querySelector(selector);
              if (!n || !n.getClientRects().length || getComputedStyle(n).display === 'none') return null;
              const r = n.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
            };
            const rows = [...document.querySelectorAll('.agent-branch:not(.agent-lane-extra) .agent-branch-line')].map(n => n.getBoundingClientRect().bottom);
            return { graph: box('.agent-graph'), markers: box('.markers'), scale: box('.gauge'), labels: box('.gauge-key'),
              story: box('.request-story'), walk: box('.walk-controls'), playback: ['#timelapse-rate', '#pause-timelapse', '#stop-timelapse'].map(box).filter(Boolean),
              lastRow: rows.length ? Math.max(...rows) : null,
              overflow: document.documentElement.scrollWidth > innerWidth };
          });
          const ordered = ['graph', 'markers', 'scale', 'labels', 'story', 'walk'].filter(k => boxes[k]);
          const gaps = Object.fromEntries(ordered.slice(1).map((key, i) => [`${ordered[i]}-${key}`, +(boxes[key].top - boxes[ordered[i]].bottom).toFixed(2)]));
          const branchGap = boxes.lastRow == null ? null : +(boxes.markers.top - boxes.lastRow).toFixed(2);
          const report = { case: item.name, width, axis, zoomed, tools, branchGap, gaps, overflow: boxes.overflow };
          console.log(JSON.stringify(report));
          if (!process.env.T12E_BASELINE) {
            for (const [pair, gap] of Object.entries(gaps)) assert.ok(gap >= -.5, `${JSON.stringify(report)}: ${pair} overlaps`);
            for (const control of boxes.playback) for (const key of ordered) {
              const r = boxes[key];
              assert.ok(control.right <= r.left || control.left >= r.right || control.bottom <= r.top || control.top >= r.bottom, `playback overlaps ${key}: ${JSON.stringify(report)}`);
            }
            if (branchGap != null) assert.ok(branchGap >= 0 && branchGap <= 12, `branch gap ${JSON.stringify(report)}`);
            assert.equal(boxes.overflow, false);
          }
          if (axis === 'time' && zoomed && (width === 1440 || tools)) {
            const name = item.name === 'real' && width === 1440 ? 'real' : item.name === 'plain' ? width === 400 ? 'mobile' : 'plain' : null;
            if (name) await page.screenshot({ path: `${shots}/t12e-${name}.png` });
          }
        }
        if (zoomed) await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
      }
    }
    await page.close();
  }
  assert.deepEqual(errors, []); console.log(JSON.stringify({ consoleErrors: errors.length }));
}

if (process.env.T12E) {
  try { await layoutChecks(); } finally { await browser.close(); }
  process.exit(0);
}

try {
  for (const width of process.env.T12D_REAL_ONLY ? [] : [1440, 400]) {
    const page = await pageFor(width);
    await load(page, [main, ...runs]);
    await page.getByRole('button', { name: 'By request', exact: true }).click();
    await alignment(page, [[1, 6], [2, 7], [3, 8], [4, 4]]);
    await markersAligned(page);
    assert.equal(await page.locator('.agent-branch-line').last().getAttribute('d').then(d => d.includes(' H')), false);
    await page.screenshot({ path: `${shots}/t12d-${width === 400 ? 'mobile' : 'request'}.png` });
    await page.getByRole('button', { name: 'By time', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'By time', exact: true }).getAttribute('aria-pressed'), 'true');
    await alignment(page, [[1, 6], [2, 7], [3, 8], [4, 4]]);
    await markersAligned(page);
    assert.equal(await page.locator('.time-break').count(), 1);
    assert.equal(await page.locator('.agent-branch-line').last().getAttribute('d').then(d => d.includes(' H')), false);
    const gapWidth = await page.evaluate(() => {
      const s = document.querySelector('#timeline > svg');
      const p = s.querySelector('.spark-path').points;
      return (p[9].x - p[8].x) / 600 * s.getBoundingClientRect().width;
    });
    assert.ok(Math.abs(gapWidth - 12) < .1);
    if (width === 1440) await page.screenshot({ path: `${shots}/t12d-time.png` });
    const sr = await page.locator('#request-slider').boundingBox();
    await page.keyboard.down('Shift');
    await page.mouse.move(sr.x + sr.width * .05, sr.y + 10); await page.mouse.down();
    await page.mouse.move(sr.x + sr.width * .7, sr.y + 10, { steps: 8 });
    assert.equal(await page.locator('.timeline-selection').isVisible(), true);
    await page.mouse.up(); await page.keyboard.up('Shift');
    assert.equal(await page.getByRole('button', { name: 'Zoom out', exact: true }).isVisible(), true);
    await alignment(page, [[1, 6], [2, 7], [3, 8]]);
    if (width === 1440) {
      assert.ok((await page.locator('.agent-branch-label').first().textContent()).length >= 6);
      await page.screenshot({ path: `${shots}/t12d-zoom.png` });
    }
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Zoom out', exact: true }).isVisible(), false);
    await page.locator('#request-slider').dispatchEvent('wheel', { ctrlKey: true, deltaY: -100, clientX: sr.x + sr.width / 2 });
    assert.equal(await page.getByRole('button', { name: 'Zoom out', exact: true }).isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', { name: 'Zoom out', exact: true }).isVisible(), false);
    if (width === 400) {
      const touch = await page.context().newCDPSession(page);
      const points = [{ x: sr.x + sr.width * .1, y: sr.y + 10, id: 1 }, { x: sr.x + sr.width * .8, y: sr.y + 10, id: 2 }];
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...points[0], x: sr.x + sr.width * .2 }, { ...points[1], x: sr.x + sr.width * .65 }] });
      assert.equal(await page.locator('.timeline-selection').isVisible(), true);
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.equal(await page.getByRole('button', { name: 'Zoom out', exact: true }).isVisible(), true);
      await page.locator('#menu-toggle').click(); await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('button', { name: 'Zoom out', exact: true }).isVisible(), true);
      assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'), 'false');
      await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
      await touch.detach();
    }

    await page.reload(); await page.waitForFunction(() => document.querySelector('#status').textContent.includes('ready'));
    await load(page, [main, ...runs]);
    assert.equal(await page.getByRole('button', { name: 'By time', exact: true }).getAttribute('aria-pressed'), 'true');
    const branches = page.locator('.agent-branch');
    await branches.first().focus();
    assert.equal(await page.locator('.agent-lane-tip').textContent(), await branches.first().getAttribute('aria-label'));
    if (width === 1440) await page.screenshot({ path: `${shots}/t12d-hover.png` });
    await page.keyboard.press('ArrowRight'); assert.equal(await branches.nth(1).evaluate(n => n === document.activeElement), true);
    await page.keyboard.press('ArrowLeft'); assert.equal(await branches.first().evaluate(n => n === document.activeElement), true);
    await page.locator('#request-slider').fill('7'); await page.locator('#request-slider').dispatchEvent('change');
    await branches.first().focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('#subagent-breadcrumb').hidden);
    assert.equal(await page.locator('.agent-lanes').isVisible(), false);
    assert.match(await page.locator('.agent-run-timing').textContent(), /Forked at main request 2 .*merged at request 7 .*ran 5 min in the background/);
    if (width === 1440) await page.screenshot({ path: `${shots}/t12d-run.png` });
    await page.locator('#back-main').click();
    await page.waitForTimeout(500);
    await page.waitForFunction(() => document.activeElement?.classList.contains('agent-branch'));
    assert.equal(await page.locator('#request-slider').inputValue(), '7');
    // The list and graph each restore their own return target.
    await page.locator('.subagent-row').first().click();
    await page.locator('#back-main').click();
    await page.waitForFunction(() => document.activeElement?.classList.contains('subagent-row'));
    const occlusion = await page.evaluate(() => {
      const r = document.querySelector('#timeline').getBoundingClientRect();
      return [...document.querySelectorAll('.context-city-label, #mode-label')].filter(n => getComputedStyle(n).display !== 'none').some(n => {
        const b = n.getBoundingClientRect(); return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
      });
    });
    assert.equal(occlusion, false);
    if (width === 400) {
      for (let i = 0; i < 3; i++) {
        const hit = await branches.nth(i).locator('.agent-branch-hit').boundingBox();
        await page.mouse.click(hit.x + Math.min(8, hit.width / 2), hit.y + hit.height / 2);
        await page.waitForFunction(() => !document.querySelector('#subagent-breadcrumb').hidden);
        await page.locator('#back-main').click();
        await page.waitForFunction(() => document.activeElement?.classList.contains('agent-branch'));
        assert.equal(await page.evaluate(() => document.activeElement.dataset.agentId), ['a', 'b', 'c'][i]);
      }
    }
    // Both click surfaces seek using time positions.
    const sliderRect = await page.locator('#request-slider').boundingBox();
    await page.mouse.click(sliderRect.x + sliderRect.width * .98, sliderRect.y + 8);
    assert.equal(await page.locator('#request-slider').inputValue(), '11');
    await page.locator('.agent-lane-track').click({ position: { x: 1, y: 1 } });
    assert.equal(await page.locator('#request-slider').inputValue(), '0');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    if (width === 400) {
      assert.equal(await branches.first().locator('.agent-branch-hit').getAttribute('height'), '10');
      assert.equal(await branches.first().locator('.agent-branch-fill').isVisible(), false);
      await page.locator('#menu-toggle').click();
    }
    await page.getByRole('button', { name: 'Run summary', exact: true }).click();
    const summary = await page.locator('#run-summary').textContent();
    assert.match(summary, /Most parallel subagents4/); assert.match(summary, /Main thread waited for subagentsunder 1 min/);
    await page.locator('#run-summary').getByRole('button', { name: 'Close', exact: true }).click();
    {
      const extra = ['e', 'f'].flatMap(id => [payload(`agent-${id}.jsonl`, runs[0].buffer),
        payload(`agent-${id}.meta.json`, Buffer.from(JSON.stringify({ agentType: 'reviewer', toolUseId: 'call-a', description: 'Synthetic overlap' })))]);
      await load(page, [main, ...runs, ...extra], 6);
      const toggle = page.getByRole('button', { name: 'Show all 6 rows', exact: true });
      await toggle.click();
      assert.equal(await page.locator('.agent-branch:visible').count(), 6);
      if (width === 400) assert.equal(await page.locator('.agent-branch-hit').first().getAttribute('height'), '24');
      await page.getByRole('button', { name: 'Show fewer rows', exact: true }).click();
      await page.locator('.agent-branch').first().focus(); await page.keyboard.press('End');
      assert.equal(await page.locator('.agent-branch').last().evaluate(n => n === document.activeElement), true);
      assert.equal(await page.getByRole('button', { name: 'Show fewer rows', exact: true }).getAttribute('aria-expanded'), 'true');
      const noTimes = main.buffer.toString().trim().split('\n').map(line => { const r = JSON.parse(line); delete r.timestamp; return JSON.stringify(r); }).join('\n');
      await page.locator('#transcript-file').setInputFiles(payload('synthetic-no-times.jsonl', Buffer.from(noTimes)));
      await page.waitForFunction(() => document.querySelector('.timeline-axis button:last-child').disabled);
      assert.equal(await page.getByRole('button', { name: 'By time', exact: true }).getAttribute('title'), 'This transcript has no timestamps');
    }
    if (width === 1440) {
      const one = payload('single.jsonl', Buffer.from(JSON.stringify({ type: 'api-request', id: 'one', querySource: 'sdk', timestamp: '2026-01-01T00:00:00Z' })));
      await page.locator('#transcript-file').setInputFiles(one);
      await page.waitForFunction(() => document.querySelector('#request-slider').max === '0');
      assert.equal(await page.locator('.spark-path').evaluate(n => n.points.numberOfItems), 2);
      assert.equal(await page.locator('.spark-path').evaluate(n => n.points[1].x), 600);
    }
    reports.push({ width, branches: 4, axesAligned: 2, gapPixels: 12, persistence: true, keyboard: true, back: true, seek: true, overflow: false });
    await page.close();
  }
  if (process.env.T12C_REAL_MAIN) {
    const mainPath = process.env.T12C_REAL_MAIN, dir = mainPath.replace(/\.jsonl$/, '') + '/subagents';
    const names = (await readdir(dir)).filter(n => /^agent-.*\.(jsonl|meta\.json)$/.test(n));
    const paths = [mainPath, ...names.map(n => path.join(dir, n))];
    const files = await Promise.all(paths.map(async p => new File([await readFile(p)], path.basename(p))));
    const { session } = await parseFiles(files).promise;
    const branches = agentBranches(session), durations = branches.map(runDuration).filter(Number.isFinite).sort((a, b) => a - b);
    const mid = Math.floor(durations.length / 2);
    console.log(JSON.stringify({ real: { requests: session.requests.length, runs: session.agents.length,
      asyncRuns: branches.filter(b => b.async).length, mergesFound: branches.filter(b => !b.open).length,
      maxParallelTime: maxParallel(branches), requestRows: Math.max(0, ...branches.map(b => b.requestLane + 1)),
      timeRows: Math.max(0, ...branches.map(b => b.timeLane + 1)),
      medianRunMinutes: (durations.length % 2 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2) / 60000 } }));
    const page = await pageFor(1440); await load(page, paths, branches.length);
    for (const axis of ['time']) {
      await page.getByRole('button', { name: axis === 'request' ? 'By request' : 'By time', exact: true }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${shots}/t12d-real-${axis}.png` });
    }
    const r = await page.locator('#request-slider').boundingBox();
    await page.keyboard.down('Shift'); await page.mouse.move(r.x + r.width * .05, r.y + 10); await page.mouse.down();
    await page.mouse.move(r.x + r.width * .22, r.y + 10, { steps: 8 }); await page.mouse.up(); await page.keyboard.up('Shift');
    await page.screenshot({ path: `${shots}/t12d-real-zoom.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 1440); await page.close();
  }
  if (process.env.T12D_REAL_PATHS) {
    const paths = JSON.parse(await readFile(process.env.T12D_REAL_PATHS, 'utf8'));
    for (let n = 0; n < paths.length; n++) {
      const { parseText } = await import('../src/parse.js');
      const session = parseText(await readFile(paths[n], 'utf8'));
      const times = session.requests.map(r => r.time);
      for (const width of [1300, 314]) {
        const scale = timeScale(times, width);
        let breakPixels = 0;
        for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] > 900000) breakPixels += scale.x[i] - scale.x[i - 1];
        console.log(JSON.stringify({ realIndex: n, requests: times.length, width, distinctPixels: new Set(scale.x.map(Math.round)).size, breaks: scale.breaks.length, breakPixels, breakShare: breakPixels / width }));
      }
    }
  }
  console.log(JSON.stringify({ reports, consoleErrors: errors.length })); assert.deepEqual(errors, []);
} finally { await browser.close(); }
