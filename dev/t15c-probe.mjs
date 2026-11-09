// Exercise the built page. Development instrumentation stays in this server's memory.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE_MODULE);
const port = Number(process.env.T15C_PORT || 8797);
assert.ok(port >= 8790 && port <= 8799);
let html = (await readFile('site/index.html', 'utf8'))
  .replace('scene = createScene(stage, {', 'scene = window.probeScene = createScene(stage, { dev: true,')
  .replace('const view=metropolisCamera(layout,metropolis.points(),b,{width,height},insets);',
    'window.cameraInput={layout,points:metropolis.points(),b,viewport:{width,height},insets};const view=metropolisCamera(layout,metropolis.points(),b,{width,height},insets);');
const server = createServer((req,res) => { res.setHeader('Content-Type','text/html');res.end(html); });
await new Promise(resolve => server.listen(port,'127.0.0.1',resolve));
const shots = process.env.T15C_SHOTS || '/tmp/t15c-shots';
await mkdir(shots,{recursive:true});
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true,
  args:['--no-sandbox','--use-gl=angle','--use-angle=gl-egl','--ignore-gpu-blocklist','--enable-gpu']});
const errors=[];
const panels='.identity, #phone-menu nav, #phone-menu, #menu-toggle, #index-panel, #reader-panel, #field-guide, #findings-panel, #guess-card, #timeline, #subagent-breadcrumb, #subagent-banner, .session-messages, #city-intro, #discovery-toast, dialog[open]';
async function pageFor(width){
  const page=await browser.newPage({viewport:{width,height:width===400?860:900},reducedMotion:'reduce',ignoreHTTPSErrors:true});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(()=>window.probeScene&&document.querySelector('#status').textContent.includes('ready'));
  return page;
}
async function choose(page,example){
  await page.evaluate(example=>{document.querySelector('#load-example').click();document.querySelector(`#example-${example}`).click();},example);
  await page.waitForTimeout(800);
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
    const x=main.map(p=>p.x),y=main.map(p=>p.y);
    return {fov:stats.fov,elevation:Math.atan2(p[1]-t[1],Math.hypot(p[0]-t[0],p[2]-t[2]))*180/Math.PI,
      mainShare:(Math.max(...x)-Math.min(...x))/innerWidth,mainBox:{x0:Math.min(...x),x1:Math.max(...x),y0:Math.min(...y),y1:Math.max(...y)},
      labels:labels.length,collisions,stats};
  },panels);
}
try{
  const page=await pageFor(1440);await choose(page,2);
  for(const idx of [0,6,39]){
    await page.locator('#request-slider').fill(String(idx));
    await page.locator('#request-slider').dispatchEvent('change');await page.waitForTimeout(300);
    await page.evaluate(()=>probeScene.showMetropolis());await page.waitForTimeout(250);
    assert.equal(await page.locator('#request-slider').inputValue(),String(idx));
    const m=await measure(page);console.log(JSON.stringify({request:idx+1,...m}));
    await writeFile(`/tmp/t15c-input-${idx}.json`,JSON.stringify(await page.evaluate(()=>cameraInput)));
    await page.screenshot({path:`${shots}/t15c-metro-${idx+1}.png`});
    if(!process.env.T15C_EXPLORE){assert.equal(m.fov,50);assert.ok(m.elevation>=30&&m.elevation<=35);assert.ok(m.mainShare>=.4&&m.mainShare<=.55);assert.equal(m.collisions.length,0);}
  }
  const shares=[];
  for(let idx=0;idx<40;idx++){
    await page.evaluate(idx=>probeScene.setRequest(idx),idx);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const m=await measure(page);shares.push(m.mainShare);
    if(!process.env.T15C_EXPLORE){assert.equal(m.fov,50);assert.ok(m.elevation>=30&&m.elevation<=35);assert.ok(m.mainShare>=.4&&m.mainShare<=.55,`request ${idx+1}: ${m.mainShare}`);assert.equal(m.collisions.length,0);}
  }
  console.log(JSON.stringify({allRequests:{minShare:Math.min(...shares),maxShare:Math.max(...shares)}}));await page.close();
  for(const width of [1440,400]){
    const p=await pageFor(width);
    for(const example of [0,1,2]){
      await choose(p,example);await p.evaluate(()=>probeScene.overview());await p.waitForTimeout(250);
      const m=await measure(p);console.log(JSON.stringify({overview:{width,example,labels:m.labels,collisions:m.collisions}}));
      if(!process.env.T15C_EXPLORE)assert.equal(m.collisions.length,0);
    }
    for(const name of ['Index','Reader','Field guide','Findings','Guess']){
      await p.evaluate(name=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(name))?.click(),name);
      await p.waitForTimeout(250);
      const m=await measure(p);console.log(JSON.stringify({panelChange:{width,name,labels:m.labels,collisions:m.collisions}}));
      assert.equal(m.collisions.length,0);
      await p.keyboard.press('Escape');await p.waitForTimeout(100);
    }
    await p.waitForTimeout(500);
    const layoutReads=await p.evaluate(async selectors=>{
      const panels=new Set(document.querySelectorAll(selectors));
      const original=Element.prototype.getBoundingClientRect;let count=0;
      Element.prototype.getBoundingClientRect=function(){if(panels.has(this))count++;return original.call(this);};
      try{for(let i=0;i<12;i++)await new Promise(requestAnimationFrame);return count;}
      finally{Element.prototype.getBoundingClientRect=original;}
    },panels);
    console.log(JSON.stringify({restingHudLayoutReads:{width,frames:12,count:layoutReads}}));
    assert.equal(layoutReads,0);
    if(width===400){await p.evaluate(()=>probeScene.showMetropolis());await p.waitForTimeout(250);const m=await measure(p);console.log(JSON.stringify({phoneMetro:m}));if(!process.env.T15C_EXPLORE)assert.equal(m.collisions.length,0);await p.screenshot({path:`${shots}/t15c-phone-metro.png`});}
    await p.close();
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({consoleErrors:errors.length}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
