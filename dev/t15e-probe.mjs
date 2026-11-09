// Exercise the built page. Development instrumentation stays in this server's memory.
import assert from 'node:assert/strict';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE_MODULE);
const port = Number(process.env.T15E_PORT || 8797);
assert.ok(port >= 8790 && port <= 8799);
let html = (await readFile('site/index.html', 'utf8'))
  .replace('scene = createScene(stage, {', 'scene = window.probeScene = createScene(stage, { dev: true,')
  .replace('fov:camera.fov,camera:', 'flying:!!flight,direction:camera.getWorldDirection(new THREE.Vector3()).toArray(),free:labels.freeRegion(width,height),districtBoxes:metropolis.points(true).map(v=>{const p=v.project(camera);return {x:(p.x+1)*width/2,y:(1-p.y)*height/2};}),fov:camera.fov,camera:');
const server = createServer((req,res) => { res.setHeader('Content-Type','text/html');res.end(html); });
await new Promise(resolve => server.listen(port,'127.0.0.1',resolve));
const shots = process.env.T15E_SHOTS || '/tmp/t15e-shots';
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
    const corners=[...main,...stats.districtBoxes];
    // Each existing district begins with its eight foundation corners; all
    // active tower corners follow. Count foundations using the ordered rects.
    const projected=stats.metropolis.rects.map((r,i)=>({r,state:stats.metropolis.states[i].state})).filter(r=>r.state!=='pending');
    const inFrame=projected.length && corners.every(p=>p.x>=0&&p.x<=innerWidth&&p.y>=0&&p.y<=innerHeight)?existing:existing===0?0:-1;
    const ground=t; const free=stats.free; const xx=corners.map(p=>p.x), yy=corners.map(p=>p.y); const box={x0:Math.min(...xx),x1:Math.max(...xx),y0:Math.min(...yy),y1:Math.max(...yy)};
    const x=main.map(p=>p.x),y=main.map(p=>p.y);
    return {free,box,share:Math.max((box.x1-box.x0)/free.w,(box.y1-box.y0)/free.h),offset:[((box.x0+box.x1)/2-free.x-free.w/2)/free.w,((box.y0+box.y1)/2-free.y-free.h/2)/free.h],fov:stats.fov,elevation:Math.atan2(p[1]-ground[1],Math.hypot(p[0]-ground[0],p[2]-ground[2]))*180/Math.PI,
      mainShare:(Math.max(...x)-Math.min(...x))/innerWidth,mainBox:{x0:Math.min(...x),x1:Math.max(...x),y0:Math.min(...y),y1:Math.max(...y)},
      existing,inFrame,labels:labels.length,collisions,stats};
  },panels);
}
try{
for(const width of [1440,400]){
 const page=await pageFor(width);await choose(page,2);
 for(const idx of [0,6,39]){
  await page.locator('#request-slider').fill(String(idx));await page.locator('#request-slider').dispatchEvent('change');
  await page.evaluate(()=>{document.activeElement?.blur();probeScene.showMetropolis();});
  await page.waitForFunction(()=>!probeScene.getStats().flying);await page.waitForTimeout(250);
  const m=await measure(page);
  const {stats,...result}=m;console.log(JSON.stringify({width,request:idx+1,share:m.share,offset:m.offset,elevation:m.elevation,fov:m.fov,overlaps:m.collisions.length,free:m.free}));
  assert.ok(m.share>=.75&&m.share<=.85);assert.ok(m.offset.every(x=>Math.abs(x)<.05));
  assert.equal(m.fov,50);assert.ok(Math.abs(m.elevation-32.5)<.01);assert.equal(m.collisions.length,0);
  await page.screenshot({path:`${shots}/t15e-${width===400?'phone-':''}metro-${idx+1}.png`});
  if(width===400&&idx===39)await page.screenshot({path:`${shots}/t15e-phone-metro.png`});
 }
 for(const example of [0,1]){await choose(page,example);const hidden=await page.getByRole('button',{name:'Metropolis',exact:true,includeHidden:true}).isHidden();console.log(JSON.stringify({width,example,metropolisHidden:hidden}));assert.ok(hidden);}
 await page.close();
}
if(process.env.T15E_REAL){
  const main=process.env.T15E_REAL,dir=main.replace(/\.jsonl$/,'')+'/subagents';
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
