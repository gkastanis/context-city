// Walk a full session in the built page and screenshot each stage.
// Usage: node full-run.mjs <url> <outdir> [width height prefix]
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE_MODULE);
const [url, out, w = '1440', h = '900', prefix = 'd'] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] });
const context = await browser.newContext({ viewport: { width: +w, height: +h }, colorScheme: 'dark' });
await context.route('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  r => r.fulfill({ path: process.env.THREE_MODULE_PATH, contentType: 'text/javascript' }));
const page = await context.newPage();
const errors = []; let checks=0; const check=(ok,label)=>{if(!ok)throw new Error(label);checks++;};
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
let n = 0;
const shot = async name => { await page.waitForTimeout(900); await page.screenshot({ path: `${out}/${prefix}-${String(++n).padStart(2, '0')}-${name}.png` }); };
const phone = +w < 761;
const menu = async () => { if (phone && await page.locator('#menu-toggle').isVisible() && await page.locator('#menu-toggle').getAttribute('aria-expanded')!=='true') await page.locator('#menu-toggle').click(); };
const click = async (name) => { const b = page.getByRole('button', { name, exact: true }).first(); if (await b.isVisible()) { await b.click(); return true; }
if(phone && ['Overview','Metropolis','Whole session'].includes(name)){
 const more=page.locator('#tape-toggle'); const expanded=await more.getAttribute('aria-expanded')==='true';
 if(!expanded)await more.click();
 if(await b.isVisible()){await b.click();if(!expanded)await more.click();return true;}
 if(!expanded)await more.click();
}
return false; };
const step = async k => { for (let i = 0; i < k; i++) { await page.locator('#request-slider').evaluate(s => { s.value = String(+s.value + 1); s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(120); } };
try {
  await page.goto(url, { waitUntil: 'load' });
  await page.locator('#request-slider').waitFor({ state: 'attached', timeout: 30000 });
  await page.waitForTimeout(3000);
const beacons=await page.evaluate(async()=>{
  const {createCity}=await import('/src/scene/city.js');
  const {createMetropolis}=await import('/src/scene/metropolis.js');
  const city=createCity(), item={blockId:'synthetic',label:'Synthetic failure',kind:'tool_result',layer:'results',height:20,z0:0,z1:10,isError:true,paramCount:0};
  const tower={...item,blockId:'tower',height:180,z0:11,z1:20,isError:false};
  const layout={items:[item,tower],districts:[{blockIds:['synthetic','tower']}],totalTokens:2000};
  const count=()=>city.group.children.filter(m=>m.material?.uniforms?.viewport).reduce((n,m)=>n+m.count,0);
  city.update(layout,new Set(),false);
  const mesh=city.group.children.find(m=>m.material?.uniforms?.viewport);
  const matrix=Array.from(mesh.instanceMatrix.array.slice(0,16));
  const ready=count(),depth=mesh.material.depthTest&&!mesh.material.depthWrite;
  city.intro(0);const below=count();city.intro(1);const risen=count();
  city.update({items:[],districts:[],totalTokens:0},new Set(),true);const falling=count();city.dispose();
  const sample=await (await fetch('/sample/real-agents-session.json')).json();
  const metro=createMetropolis();metro.load(sample);metro.sync(0,true);
  const alerts=metro.group.getObjectByName('subagent-failure-beacons');
  const lit=()=>Array.from({length:alerts.count},(_,i)=>alerts.instanceMatrix.array[i*16]).filter(v=>v>0).length;
  const pending=lit();metro.sync(sample.requests.length-1,true);const merged=lit();
  const metroDepth=alerts.material.depthTest;metro.dispose();
  return {ready,below,risen,falling,depth,roof:matrix[13],top:matrix[13]+matrix[5],pending,merged,metroDepth};
});
check(beacons.ready===1&&beacons.below===0&&beacons.risen===1&&beacons.falling===0,'actual city pins follow intro and falling');
check(beacons.roof>20&&beacons.roof<21&&beacons.top>180&&beacons.depth,'actual pin clears skyline and retains depth');
check(beacons.pending===0&&beacons.merged===1&&beacons.metroDepth,'district pins follow pending and merged runs');
  await shot('start');
  // Rewind to request 1, then walk forward.
  await page.locator('#request-slider').evaluate(s => { s.value = s.min; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); });
  await shot('request-01');
  const total = await page.locator('#request-slider').evaluate(s => +s.max - +s.min + 1);
  for (const target of [Math.round(total * 0.25), Math.round(total * 0.5), Math.round(total * 0.75), total]) {
    const cur = await page.locator('#request-slider').evaluate(s => +s.value - +s.min + 1);
    await step(target - cur);
    await shot(`request-${String(target).padStart(2, '0')}`);
  }
  if (await click('Metropolis')) await shot('metropolis');
  if (await click('Whole session')) await shot('whole-session');
  await click('Overview');
  await menu(); await page.locator('#show-tools').click(); await shot('tools-tab');
  await page.locator('#failures-tab').click();
check((await page.locator('#tools-failures .failure-navigation span').textContent())==='2 failures','unselected failure count');
check(!/\([a-f0-9]{12,}\)/.test(await page.locator('#tools-panel').innerText()),'readable run labels');
const chips=await page.locator('.filter-group').evaluateAll(ns=>ns.map(n=>({height:n.clientHeight,scroll:n.scrollHeight,top:n.getBoundingClientRect().top,bottom:n.getBoundingClientRect().bottom,parent:n.parentElement.getBoundingClientRect().bottom})));
check(chips.every(n=>n.height>=32 && n.scroll<=n.height+1 && n.bottom<=n.parent+1),'chips fully visible');
await shot('failures-tab');
  await page.locator('.tool-failure').first().click();
if(phone){check(!(await page.locator('#tools-panel').isVisible()),'phone sheet closes');
for(const name of ['Copy as issue','Show call','Back to list'])check(await page.locator('#reader-panel').getByRole('button',{name,exact:true}).isVisible(),'reader '+name);
check((await page.locator('#reader-panel').boundingBox()).height>500,'phone reader height');}
else { const a=await page.locator('#subagent-breadcrumb').boundingBox(),b=await page.locator('#close-tools').boundingBox();check(a.y+a.height<=b.y,'breadcrumb clears controls'); }
await shot('failure-1-reader');check(!/Unable to navigate/.test(await page.locator('#status').textContent()),'failure navigation waits for city upload');
  { const nb = page.locator('#reader-panel').getByRole('button', { name: 'Next failure', exact: true }); if (await nb.isVisible()) { await nb.click(); check((await page.locator('#reader-panel .failure-navigation span').textContent())==='2 of 2 failures','Reader steps across runs'); await shot('failure-2-reader'); } }
  if(phone){await page.locator('#reader-panel').getByRole('button',{name:'Back to list',exact:true}).click();check(await page.locator('#tools-panel').isVisible(),'back to list opens');check(await page.locator('.tool-failure[aria-current="true"]').count()===1,'active row retained');
 const selectedId=await page.locator('.tool-failure[aria-current="true"]').getAttribute('data-block-id');
 const main=page.locator('[data-filter="agentId"][data-value="main"]');await main.click();
 await page.locator('.tool-failure').first().click();await page.locator('#reader-panel').getByRole('button',{name:'Back to list',exact:true}).click();
 check(await main.getAttribute('aria-pressed')==='true','run filter retained');
 check(await page.locator('.tool-failure[aria-current="true"]').getAttribute('data-block-id')===selectedId,'same row restored');
 await shot('back-to-list');}
await page.locator('#close-tools').click();
  await menu(); await page.locator('#show-findings').click(); await shot('findings');
  await page.locator('#close-findings').click().catch(() => {});
  await menu();await page.getByRole('button',{name:'Run summary',exact:true}).click();await shot('run-summary');
await page.locator('#run-summary').getByRole('button',{name:'Close',exact:true}).click();
const closeReader=page.getByRole('button',{name:'Close Reader',exact:true});if(await closeReader.isVisible())await closeReader.click();
for(let i=0;i<2 && !(await page.locator('#index-panel').isVisible());i++){await menu();await page.getByRole('button',{name:'Index',exact:true}).click();}
const layers=page.locator('#index-panel details').first();if(!(await layers.evaluate(n=>n.open)))await layers.locator('summary').first().click();
await page.locator('#layer-subagents').check();
await page.getByRole('button',{name:'Close Index',exact:true}).click();
await click('Metropolis');await shot('sample-district-beacons');
} catch (e) { errors.push('PROBE: ' + e.message.split('\n')[0]); await shot('error'); }
// The same walkthrough also covers ten simultaneous fixture failures.
await page.locator('#transcript-file').setInputFiles('test/fixtures/tools-demo.jsonl');
await page.waitForFunction(()=>document.querySelector('#session-info').textContent.includes('tools-demo'));
await page.waitForTimeout(1000);
for(const id of ['reader-panel','index-panel']){const close=page.locator('#'+id).getByRole('button',{name:/^Close (Reader|Index)$/});if(await close.isVisible())await close.click();}
await page.locator('#request-slider').evaluate(s=>{s.value=s.max;s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));});
await page.waitForTimeout(1800);
await click('Overview');await shot('fixture-overview-beacons');
await click('Whole session');await shot('fixture-whole-session-beacons');
console.log(JSON.stringify({ shots: n, checks, errors }));
await browser.close();
