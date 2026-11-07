// Visual, game-hook and frame-time checks. HTTP server: repository root on 8766.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const { chromium }=await import(process.env.PLAYWRIGHT_CORE_MODULE||'playwright-core');
const output=process.env.SCENE_SHOTS||'dev/shots';await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results={};
try {
  const page=await browser.newPage({viewport:{width:1440,height:900},ignoreHTTPSErrors:true,reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  if(process.env.SCENE_BASELINE)await page.route('**/src/scene/*.js',async route=>{const name=new URL(route.request().url()).pathname.split('/').at(-1);await route.fulfill({contentType:'text/javascript',body:await readFile(`${process.env.SCENE_BASELINE}/${name}`,'utf8')});});
  const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  async function load(stress=false){await page.goto(`http://127.0.0.1:8766/dev/scene.html${stress?'?stress=3000':''}`);await page.waitForFunction(()=>window.sceneAPI);await settle();}
  async function high(){await page.evaluate(()=>{sceneAPI.setQuality?.('low');sceneAPI.setQuality?.('high');});await settle();}
  async function shot(name){await high();results[name]=await page.evaluate(()=>sceneAPI.getStats());if(!process.env.SCENE_BASELINE)await page.screenshot({path:`${output}/t5a-${name}.png`});}
  async function frames(name){await high();results[name]=await page.evaluate(async()=>{const times=[];let last=performance.now();for(let i=0;i<20;i++){await new Promise(requestAnimationFrame);const now=performance.now();times.push(now-last);last=now;sceneAPI.setQuality?.('low');sceneAPI.setQuality?.('high');}times.sort((a,b)=>a-b);return {medianMs:times[10],p95Ms:times[19],quality:sceneAPI.getStats().quality??'original'};});}
  await load();await shot('sample-city');await frames('sample-frame-times');
  if(!process.env.SCENE_BASELINE){
    await page.evaluate(()=>sceneAPI.flyToBlock(sampleSession.requests[0].blockIds[0]));await shot('facade');
    await page.evaluate(()=>sceneAPI.enterBlock(sampleSession.requests[0].blockIds[0]));await shot('corridor');
    await page.evaluate(()=>sceneAPI.enterDistrict(0));await shot('hall');
    await page.evaluate(async()=>{
      const THREE=await import('https://cdn.jsdelivr.net/npm/three@0.160.0/+esm');const original=THREE.Camera.prototype.updateMatrixWorld;
      THREE.Camera.prototype.updateMatrixWorld=function(...args){if(this.isPerspectiveCamera&&this.near===.05)window.visualCamera=this;return original.apply(this,args);};
      sceneAPI.overview();
    });await settle();
    await page.evaluate(()=>{sceneAPI.showFullWindow();sceneAPI.startReading();sceneAPI.pauseReading();sceneAPI.setAtmosphere({fill:.96});visualCamera.position.set(150,65,3770);visualCamera.lookAt(0,80,4000);});await shot('autocompact-wall');
    await page.evaluate(()=>sceneAPI.overview());await settle();
    // Every hook is exercised; reduced intro finishes asynchronously exactly once.
    results.hooks=await page.evaluate(async()=>{
      let done=0,cancelled=null;sceneAPI.playIntro({onDone:r=>{done++;cancelled=r.cancelled;}});await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      if(done!==1||cancelled!==false)throw new Error('Reduced intro callback');
      sceneAPI.celebrate('unknown');sceneAPI.celebrate(sampleSession.requests[0].blockIds[0]);
      for(const type of ['compaction','tool_loaded','mcp_instructions','user_prompt','skill_listing'])sceneAPI.playEvent({type,requestIdx:0,data:{preTokens:10000,postTokens:2000}});
      sceneAPI.setQuality('low');if(sceneAPI.getStats().quality!=='low')throw new Error('Low quality failed');
      sceneAPI.setQuality('high');return {introNextFrame:true,introOnce:true,eventTypes:5,qualityToggle:true};
    });
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(()=>{window.introResults=[];sceneAPI.playIntro({onDone:r=>introResults.push(r)});document.querySelector('#stage canvas').dispatchEvent(new WheelEvent('wheel',{bubbles:true}));});await settle();
    assert.deepEqual(await page.evaluate(()=>introResults),[{cancelled:true}]);
    await page.evaluate(()=>{window.introResults=[];sceneAPI.playIntro({onDone:r=>introResults.push(r)});});
    await page.waitForFunction(()=>introResults.length===1,{timeout:30000});assert.deepEqual(await page.evaluate(()=>introResults),[{cancelled:false}]);
    results.introOwnership=await page.evaluate(()=>{let count=0;const old=sceneAPI.playIntro({onDone:()=>count++});sceneAPI.playIntro({onDone:()=>count++});old();if(count!==1)throw new Error('Stale cancel affected current intro');sceneAPI.setRequest(0);if(count!==2)throw new Error('Scrub did not cancel intro');sceneAPI.playIntro();sceneAPI.select(null);return {staleCancelSafe:true,scrubCancelled:true,selectionCancelled:true};});
    await page.evaluate(()=>sceneAPI.startReading());await shot('reading');
    await page.evaluate(()=>sceneAPI.pauseReading());await settle();const pose=await page.evaluate(()=>visualCamera.position.toArray());
    await page.evaluate(()=>{sceneAPI.setAtmosphere({fill:1.1});sceneAPI.celebrate(sampleSession.requests[0].blockIds[0]);sceneAPI.playIntro();});await settle();assert.deepEqual(await page.evaluate(()=>visualCamera.position.toArray()),pose);
    await page.emulateMedia({reducedMotion:'reduce'});
  }
  await load(true);await shot('stress-city');await frames('stress-frame-times');
  if(!process.env.SCENE_BASELINE){await page.evaluate(()=>sceneAPI.setQuality('low'));await settle();results['stress-low-frame-times']=await page.evaluate(async()=>{const t=[];let p=performance.now();for(let i=0;i<20;i++){await new Promise(requestAnimationFrame);const n=performance.now();t.push(n-p);p=n;}t.sort((a,b)=>a-b);return {medianMs:t[10],p95Ms:t[19]};});}
  if(!process.env.SCENE_BASELINE){
    await page.evaluate(()=>sceneAPI.setQuality('high'));
    await page.waitForFunction(()=>sceneAPI.getStats().quality==='low',{timeout:60000});
    results.automaticQuality={level:await page.evaluate(()=>sceneAPI.getStats().quality),callback:await page.evaluate(()=>qualityChanges.includes('low'))};
    assert.ok(results.automaticQuality.callback);
  }
  results.errors=errors;assert.deepEqual(errors,[]);
  await writeFile(`${output}/${process.env.SCENE_BASELINE?'before':'after'}-visual.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
