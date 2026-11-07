import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE_MODULE);
const shots=process.env.T5E_SHOTS||'dev/shots';
await mkdir(shots,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900},ignoreHTTPSErrors:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.route('**/dist/index.html',async route=>{const r=await route.fetch();let body=await r.text();
 body=body.replace('const game = createGame(', 'const game = window.t6Game = createGame(');
 body=body.replace('scene = createScene(stage, {','scene = window.t5eScene = createScene(stage, {');
 body=body.replace('if (!moving) return;', 'window.t5eMoving=moving; if (!moving) return;');
 body=body.replace('const effects = createEffects();','const effects = window.t5eEffects = createEffects();');
 body=body.replace('windowGroup = createWindow(session.meta)', 'windowGroup = window.t5eWindow = createWindow(session.meta)');
 body=body.replace('const camera = new THREE.PerspectiveCamera(50','const camera = window.t5eCamera = new THREE.PerspectiveCamera(50');
 body=body.replace('if (dead) return;\n    const elapsed','if (dead || window.t5ePaused) return;\n    const elapsed');
 body=body.replace('playEvent(event) {','playEvent(event) { window.t5eEvents ??= []; window.t5eEvents.push({event,applied:window.t5eApplied}); if(event.type === window.t5eWatch){window.t5eFreezeNext=.35;document.querySelector("#pause-timelapse").click();}');
 body=body.replace('changeRequest(idx, false);','changeRequest(idx, false); window.t5eApplied=idx;');
 body=body.replace('atmosphere.render();','atmosphere.render(); if(window.t5eFreezeNext>0){window.t5eFreezeNext-=dt;if(window.t5eFreezeNext<=0)window.t5ePaused=true;}');
 await route.fulfill({response:r,body});});
 await page.goto('http://127.0.0.1:8873/dist/index.html');
 await page.waitForFunction(()=>window.t5eScene && document.querySelector('#scene-status').hidden,{timeout:60000});
 async function jump(i){await page.locator('#request-slider').evaluate((n,i)=>{n.value=i;n.dispatchEvent(new Event('change',{bubbles:true}));},i);await page.waitForFunction(i=>window.t5eApplied===i,i);await page.waitForTimeout(900);await page.waitForFunction(()=>window.t5eMoving===false,null,{timeout:30000});}
 async function shot(name){await page.screenshot({path:`${shots}/t6-${name}.png`});}
 async function measure(i){return page.evaluate(async i=>{const {layoutRequest}=await import('/src/layout.js');const {overviewRange}=await import('/src/scene/model.js');const THREE=await import('https://cdn.jsdelivr.net/npm/three@0.160.0/+esm');const s=await (await fetch('/sample/fresh-session.json')).json(),l=layoutRequest(s,i),range=overviewRange(l);const c=t5eCamera;c.updateMatrixWorld();const project=(y,z)=>new THREE.Vector3(0,y,z).project(c);const heights=l.items.filter(it=>it.z1>=range.z0).map(it=>Math.abs(project(it.height,(it.z0+it.z1)/2).y-project(0,(it.z0+it.z1)/2).y)*innerHeight/2).sort((a,b)=>a-b);const a=project(0,range.z0),b=project(0,range.z1);return {requestIdx:i,medianPx:heights[Math.floor(heights.length/2)],leftToRight:a.x<b.x,range};},i);}
 for(const [w,h,label] of [[1440,900,'desktop'],[400,860,'phone']]){
  await page.setViewportSize({width:w,height:h});await page.locator('#load-example').evaluate(n=>n.click());await page.waitForTimeout(700);if(await page.locator('#skip-intro').isVisible())await page.locator('#skip-intro').evaluate(n=>n.click());await jump(0);assert.equal(await page.evaluate(()=>t5eWindow.userData.gates.filter(g=>g.meshes.some(m=>m.visible)).length),0);await shot(`${label}-first`); const spacing=await page.locator('.gauge-key, #request-story').evaluateAll(ns=>ns.map(n=>({name:n.className,y:n.getBoundingClientRect().y,bottom:n.getBoundingClientRect().bottom}))); assert.ok(spacing[0].y>=spacing[1].bottom, JSON.stringify(spacing));
  if(w===400){
    const bounds=await page.locator('#timeline').boundingBox();assert.ok(bounds.y-76>=430);
    await page.locator('#title-toggle').click();assert.equal(await page.locator('.stats').isVisible(),true);await page.locator('#title-toggle').click();
    await page.locator('#menu-toggle').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#load-transcript').isVisible(),true);await page.locator('#menu-toggle').click();
    await page.locator('#tape-toggle').click();assert.equal(await page.getByRole('button',{name:'Whole session',exact:true}).isVisible(),true);await page.locator('#tape-toggle').click();
  }
  if(w===1440){await page.waitForTimeout(12400);assert.equal(await page.locator('#guess-card').isHidden(),true);}
  const first=await measure(0);
  await jump(17);assert.match(await page.locator('#request-story').textContent(), /Request 18\./);await shot(`${label}-request18`);const late=await measure(17);assert.ok(first.leftToRight&&late.leftToRight);if(w===1440){assert.ok(first.medianPx>=20,JSON.stringify(first));assert.ok(late.medianPx>=20,JSON.stringify(late));}
  console.log(JSON.stringify({viewport:[w,h],first,late}));
  await jump(9);await page.evaluate(()=>{window.t5eEvents=[];window.t5eWatch='tool_loaded';t5eScene.setQuality('high');});await page.locator('#play-timelapse').click();await page.waitForFunction(()=>window.t5eEvents?.some(e=>e.event.type==='tool_loaded'),{timeout:30000});await page.locator('#pause-timelapse').evaluate(n=>n.click());await page.waitForFunction(()=>window.t5ePaused);
  const beams=await page.evaluate(async()=>{const {eventLayout}=await import('/src/scene/model.js');const s=await(await fetch('/sample/fresh-session.json')).json();const record=t5eEvents.find(e=>e.event.type==='tool_loaded');const own=eventLayout(s,record.event),zs=own.targets.map(it=>(it.z0+it.z1)/2),toolZs=own.targets.filter(it=>it.kind==='tool_def').map(it=>(it.z0+it.z1)/2);const beams=t5eEffects.group.children.filter(m=>m.visible&&m.geometry?.type==='CylinderGeometry');return {applied:record.applied,eventRequest:record.event.requestIdx,beams:beams.length,toolsHit:beams.filter(b=>toolZs.some(z=>Math.abs(z-b.position.z)<1e-6)).length,onNewBlocks:beams.every(b=>zs.some(z=>Math.abs(z-b.position.z)<1e-6))};});console.log(JSON.stringify({beams}));assert.equal(beams.applied,10);assert.ok(beams.toolsHit>0&&beams.onNewBlocks);await shot(`${label}-request10-mid-beam`);
  await page.evaluate(()=>{window.t5ePaused=false;window.t5eWatch=null;});await jump(20);await page.evaluate(()=>{window.t5eEvents=[];window.t5eWatch='compaction';t5eScene.setQuality('high');});await page.locator('#play-timelapse').click();await page.waitForFunction(()=>window.t5eEvents?.some(e=>e.event.type==='compaction'),{timeout:30000});await page.locator('#pause-timelapse').evaluate(n=>n.click());assert.equal(await page.evaluate(()=>t5eEvents.find(e=>e.event.type==='compaction').applied),21);await page.waitForFunction(()=>window.t5ePaused);await shot(`${label}-mid-compaction`);
  await page.evaluate(()=>{window.t5ePaused=false;window.t5eWatch=null;t5eEffects.tick(4,false);});await page.waitForFunction(()=>window.t5eMoving===false,null,{timeout:30000});assert.match(await page.locator('#request-story').textContent(), /Request 22\..*Compaction: 402K to 38K/);await shot(`${label}-after-compaction`);
  await jump(17);await page.getByRole('button',{name:'Whole session',exact:true,includeHidden:true}).evaluate(n=>n.click());await page.waitForTimeout(1800);await shot(`${label}-whole-session`);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),w);
  const small=await page.locator('.viewbar button, .camera-controls button, .timeline-head button, .walk-controls button, #guess-card button, .topbar nav button').evaluateAll(ns=>ns.filter(n=>{const r=n.getBoundingClientRect();return r.width&&r.height&&(parseFloat(getComputedStyle(n).fontSize)<11||r.height<32)}).map(n=>n.textContent));if(w===400)assert.deepEqual(small,[]);
  await page.getByRole('button',{name:'Full window',exact:true,includeHidden:true}).evaluate(n=>n.click());await page.waitForTimeout(2200);
  assert.equal(await page.evaluate(()=>t5eWindow.userData.gates.filter(g=>g.meshes.every(m=>m.visible)).length),2);
  assert.equal(await page.locator('.context-city-label--gate:visible').count(),2);await shot(`${label}-full-window`);
 }
 await page.setViewportSize({width:1440,height:900});
 await page.evaluate(async()=>{
   const {gameFacts}=await import('/src/ui/game-model.js');
   const s=await(await fetch('/sample/fresh-session.json')).json();const qs=gameFacts(s).quests;
   for(const q of qs){ if(q.blockId){ t6Game.select(q.blockId); }
   if(q.action==='enter'){const id=Object.values(s.blocks).find(b=>b.kind==='tool_def').id;t6Game.enter(id);}
   if(q.action==='loaded'){t6Game.update(q.event.requestIdx);const id=s.requests[q.event.requestIdx].blockIds.find(id=>s.blocks[id].kind==='tool_def'&&q.event.data.names.includes(s.blocks[id].toolName));t6Game.select(id);}
   if(q.id==='compact')t6Game.update(q.event.requestIdx);
   }
   t6Game.mode('reading');
 });
 await page.waitForFunction(()=>document.querySelector('#quest-progress').textContent==='9 of 9 found',null,{timeout:20000});
 await page.locator('#run-summary[open]').waitFor(); await shot('desktop-all-quests');
 assert.equal(await page.getByRole('button',{name:'Replay the session',exact:true}).count(),1);
 await page.getByRole('button',{name:'Replay the session',exact:true}).click();assert.equal(await page.locator('#run-summary').isVisible(),false);assert.equal(await page.locator('#request-slider').inputValue(),'0');
 console.log(JSON.stringify({screenshots:15,guessAutoCollapse:true,phoneCityAtLeastHalf:true,replay:true,errors}));assert.deepEqual(errors,[]);
}finally{await browser.close();}
