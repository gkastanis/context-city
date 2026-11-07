import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE_MODULE);
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const shots=process.env.T5D_SHOTS||'dev/shots';
const {mkdir}=await import('node:fs/promises'); await mkdir(shots,{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900},ignoreHTTPSErrors:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 // Retain the real combined-page scene only in this browser probe, without a production debug global.
 await page.route('**/dist/index.html',async route=>{const r=await route.fetch();let body=await r.text();body=body.replace('scene = createScene(stage, {','scene = window.t5dScene = createScene(stage, {');await route.fulfill({response:r,body});});
 await page.goto('http://127.0.0.1:8873/dist/index.html');
 await page.waitForFunction(()=>window.t5dScene && document.querySelector('#scene-status').hidden,{timeout:60000});
 await page.waitForTimeout(1300); if(await page.locator('#skip-intro').isVisible())await page.locator('#skip-intro').evaluate(n=>n.click());
 await page.waitForTimeout(800);
 async function shot(name){await page.evaluate(()=>{t5dScene.setQuality('low');t5dScene.setQuality('high')});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.equal(await page.locator('#scene-status').isHidden(),true,await page.locator('#scene-status').textContent());await page.screenshot({path:`${shots}/t5d-${process.env.T5D_PASS||'final'}-${name}.png`});}
 async function jump(idx){await page.locator('#request-slider').evaluate((n,i)=>{n.value=i;n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));},idx);await page.waitForTimeout(1000);}
 await shot('desktop-first');
 if(process.env.T5D_PASS){console.log(JSON.stringify({errors}));assert.deepEqual(errors,[]);process.exitCode=0;}
 else for(const [w,h,label] of [[1440,900,'desktop'],[400,860,'phone']]){
  await page.setViewportSize({width:w,height:h});if(w===400)await page.locator('#menu-toggle').click();await page.locator('#load-example').click();await page.waitForTimeout(500);if(await page.locator('#skip-intro').isVisible())await page.locator('#skip-intro').evaluate(n=>n.click());await jump(0);await page.waitForTimeout(500);await shot(`${label}-first`);
  assert.equal(await page.locator('[aria-controls="index-panel"]').getAttribute('aria-expanded'),'false');
  await jump(17); await shot(`${label}-request18`);
  await jump(20);await shot(`${label}-threshold`);
  await jump(21);await page.evaluate(()=>{t5dScene.playEvent({type:'compaction',requestIdx:21,data:{preTokens:402000,postTokens:38000}})});await page.waitForTimeout(250);await shot(`${label}-compaction`);
  await page.waitForTimeout(3200);await shot(`${label}-after-compaction`);
  await page.locator('[aria-controls="field-guide"]').click();await page.waitForTimeout(500);await shot(`${label}-guide`);
  await page.locator('[aria-controls="field-guide"]').click();await jump(0);
  await page.evaluate(async()=>{const r=await fetch('/sample/fresh-session.json');const s=await r.json();const id=s.requests[0].blockIds.find(id=>s.blocks[id].kind==='tool_def');t5dScene.enterBlock(id);});
  await page.waitForTimeout(700);await shot(`${label}-interior-reader`);await page.locator('[aria-controls="reader-panel"]').click();await shot(`${label}-interior`);await page.evaluate(()=>t5dScene.exitInside());
  await page.locator('[aria-controls="reader-panel"]').evaluate(n=>{if(n.getAttribute('aria-expanded')==='true')n.click()});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),w);
 }
 if (!process.env.T5D_PASS) {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setInputFiles('#transcript-file','test/fixtures/session.jsonl');
  await page.waitForFunction(()=>document.querySelector('#status').textContent==='Transcript ready. File read in this tab.');
  assert.equal(await page.locator('#request-slider').getAttribute('max'),'2');
  assert.equal(await page.locator('#city-intro').isHidden(),true);
  await page.locator('#load-transcript').focus();await page.keyboard.press('Tab');
  await page.locator('.event-marker').focus();await page.keyboard.press('End');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('#request-slider').value==='2');
  await page.locator('[aria-controls="field-guide"]').focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('#field-guide').isVisible(),true);
  const ownership=await page.evaluate(async()=>{
    const before=t5dScene.getMode();t5dScene.setViewInsets({left:10,right:12,top:20,bottom:220});
    if(t5dScene.getMode()!==before)throw new Error('Insets changed mode');
    let invalid=false;try{t5dScene.setViewInsets({left:-1})}catch{invalid=true}if(!invalid)throw new Error('Negative inset accepted');
    let done=0;t5dScene.playIntro({onDone(){done++}});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));if(done!==1)throw new Error('Reduced intro callback');
    return {insetsPreserveMode:true,invalidRejected:true,reducedIntroOnce:true};
  });console.log(JSON.stringify({fixtureRequests:3,keyboardMarker:true,ownership}));
 }
 console.log(JSON.stringify({errors}));assert.deepEqual(errors,[]);
}finally{await browser.close();}
