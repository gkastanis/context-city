// Exercise the built page. Development instrumentation stays in this server's memory.
import assert from 'node:assert/strict';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE_MODULE);
const port = Number(process.env.T15D_PORT || 8797);
assert.ok(port >= 8790 && port <= 8799);
let html = (await readFile('site/index.html', 'utf8'))
  .replace('scene = createScene(stage, {', 'scene = window.probeScene = createScene(stage, { dev: true,')
  .replace('fov:camera.fov,camera:', 'flying:!!flight,direction:camera.getWorldDirection(new THREE.Vector3()).toArray(),groundCentre:[0,0,layout.totalTokens*.005],districtBoxes:metropolis.points(true).map(v=>{const p=v.project(camera);return {x:(p.x+1)*width/2,y:(1-p.y)*height/2};}),fov:camera.fov,camera:');
const server = createServer((req,res) => { res.setHeader('Content-Type','text/html');res.end(html); });
await new Promise(resolve => server.listen(port,'127.0.0.1',resolve));
const shots = process.env.T15D_SHOTS || '/tmp/t15d-shots';
await mkdir(shots,{recursive:true});
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true,
  args:['--no-sandbox','--use-gl=angle','--use-angle=gl-egl','--ignore-gpu-blocklist','--enable-gpu']});
const errors=[];
const panels='.identity, #phone-menu nav, #phone-menu, #menu-toggle, #index-panel, #reader-panel, #field-guide, #findings-panel, #guess-card, #timeline, #subagent-breadcrumb, #subagent-banner, .session-messages, #city-intro, #discovery-toast, dialog[open]';
async function pageFor(width){
  const page=await browser.newPage({viewport:{width,height:width===400?860:900},reducedMotion:'no-preference',ignoreHTTPSErrors:true});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(()=>window.probeScene&&document.querySelector('#status').textContent.includes('ready'));
  return page;
}
async function choose(page,example){
  await page.evaluate(example=>{document.querySelector('#load-example').click();document.querySelector(`#example-${example}`).click();},example);
  await page.waitForTimeout(2000);
}
async function measure(page){
  return page.evaluate(selectors=>{
    const visible=n=>n.checkVisibility()&&n.getBoundingClientRect().width&&n.getBoundingClientRect().height;
    const hud=[...document.querySelectorAll(selectors)].filter(visible).map(n=>({id:n.id||n.className,r:n.getBoundingClientRect()}));
    const labels=[...document.querySelectorAll('.context-city-label')].filter(visible);
    const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
    const collisions=labels.flatMap(n=>hud.filter(p=>intersects(n.getBoundingClientRect(),p.r)).map(p=>({label:n.textContent,panel:p.id})));
    const stats=probeScene.getStats(),p=stats.camera,t=stats.target;
    const main=probeScene.projectMainCity();
    const existing=stats.metropolis.states.filter(s=>s.state!=='pending').length;
    const corners=stats.districtBoxes;
    // Each existing district begins with its eight foundation corners; all
    // active tower corners follow. Count foundations using the ordered rects.
    const projected=stats.metropolis.rects.map((r,i)=>({r,state:stats.metropolis.states[i].state})).filter(r=>r.state!=='pending');
    const inFrame=projected.length && corners.every(p=>p.x>=0&&p.x<=innerWidth&&p.y>=0&&p.y<=innerHeight)?existing:existing===0?0:-1;
    const ground=stats.groundCentre;
    const x=main.map(p=>p.x),y=main.map(p=>p.y);
    return {fov:stats.fov,elevation:Math.atan2(p[1]-ground[1],Math.hypot(p[0]-ground[0],p[2]-ground[2]))*180/Math.PI,
      mainShare:(Math.max(...x)-Math.min(...x))/innerWidth,mainBox:{x0:Math.min(...x),x1:Math.max(...x),y0:Math.min(...y),y1:Math.max(...y)},
      existing,inFrame,labels:labels.length,collisions,stats};
  },panels);
}
try{
  const page=await pageFor(1440);await choose(page,2);
for(const idx of [0,6,39]){
  await page.locator('#request-slider').fill(String(idx));
  await page.locator('#request-slider').dispatchEvent('change');
  await page.evaluate(()=>{document.activeElement?.blur();probeScene.showMetropolis();});
  await page.waitForFunction(()=>!probeScene.getStats().flying);
  await page.waitForTimeout(150);
  const m=await measure(page);console.log(JSON.stringify({request:idx+1,...m}));
  assert.equal(m.fov,50);assert.ok(m.elevation>=30&&m.elevation<=35);assert.equal(m.collisions.length,0);
  assert.equal(m.inFrame,m.existing);
  await page.screenshot({path:`${shots}/t15d-metro-${idx+1}.png`});
}
await page.close();
const phone=await pageFor(400);await choose(phone,2);
await phone.locator('#request-slider').fill('39');await phone.locator('#request-slider').dispatchEvent('change');
await phone.evaluate(()=>{document.activeElement?.blur();probeScene.showMetropolis();});
await phone.waitForFunction(()=>!probeScene.getStats().flying);await phone.waitForTimeout(150);
const pm=await measure(phone);console.log(JSON.stringify({phone:pm}));assert.equal(pm.collisions.length,0);assert.equal(pm.inFrame,pm.existing);
await phone.screenshot({path:`${shots}/t15d-phone-metro.png`});await phone.close();
if(process.env.T15D_REAL){
  const main=process.env.T15D_REAL,dir=main.replace(/\.jsonl$/,'')+'/subagents';
  const names=(await readdir(dir)).filter(n=>/^agent-.*\.(jsonl|meta\.json)$/.test(n));
  const real=await pageFor(1440);
  await real.locator('#transcript-file').setInputFiles([main,...names.map(n=>dir+'/'+n)]);
  await real.waitForFunction(()=>probeScene.getStats().metropolis.districts>0,{timeout:120000});
  await real.locator('#request-slider').fill(await real.locator('#request-slider').getAttribute('max'));
  await real.locator('#request-slider').dispatchEvent('change');
  await real.evaluate(()=>{document.activeElement?.blur();probeScene.showMetropolis();});
  await real.waitForFunction(()=>!probeScene.getStats().flying);await real.waitForTimeout(150);
  const m=await measure(real);
  console.log(JSON.stringify({real:{files:names.length+1,requests:Number(await real.locator('#request-slider').inputValue())+1,
    districts:m.stats.metropolis.districts,existing:m.existing,inFrame:m.inFrame,bridges:m.stats.metropolis.bridges,
    hudOverlaps:m.collisions.length}}));
  assert.equal(m.inFrame,m.existing);assert.equal(m.collisions.length,0);await real.close();
}
assert.deepEqual(errors,[]);console.log(JSON.stringify({consoleErrors:errors.length}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
