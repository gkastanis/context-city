import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_CORE_MODULE);
const output=process.env.T10_SHOTS || 'dev/shots';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900},ignoreHTTPSErrors:true,reducedMotion:'reduce'});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/dist/index.html',async route=>{
  const response=await route.fetch();let body=await response.text();
  body=body.replace('scene = createScene(stage, {','scene = window.t10Scene = createScene(stage, { dev: true,');
  body=body.replace('session = value; requestIdx = 0;','session = window.t10Session = value; requestIdx = 0;');
  body=body.replace('const interior = createInterior(', 'const interior = window.t10Interior = createInterior(');
  body=body.replace('const camera = new THREE.PerspectiveCamera(50,', 'const camera = window.t10Camera = new THREE.PerspectiveCamera(50,');
  body=body.replace('const originalPosition = container.style.position;', 'window.t10Renderer = renderer; const originalPosition = container.style.position;');
  await route.fulfill({response,body});
 });
 await page.goto('http://127.0.0.1:8784/dist/index.html');
 await page.waitForFunction(()=>window.t10Scene&&window.t10Session,null,{timeout:60000});
 await page.evaluate(()=>{document.querySelector('#skip-intro')?.click();document.querySelector('#guess-card button')?.click();
  window.t10Id=Object.values(t10Session.blocks).filter(b=>b.text?.length>2000).sort((a,b)=>b.text.length-a.text.length).find(b=>t10Session.requests[0].blockIds.includes(b.id))?.id;
  if(!t10Id)throw Error('No long real block in first request');
  t10Scene.setQuality('high');t10Scene.enterBlock(t10Id);
  if(document.querySelector('[aria-controls="reader-panel"]').getAttribute('aria-expanded')==='true')document.querySelector('[aria-controls="reader-panel"]').click();
 });
 const settle=async()=>{await page.waitForTimeout(600);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));};
 const shot=async name=>{await page.evaluate(level=>t10Scene.setQuality(level),name==='low-quality'?'low':'high');await page.evaluate(()=>{if(document.querySelector('[aria-controls="reader-panel"]').getAttribute('aria-expanded')==='true')document.querySelector('[aria-controls="reader-panel"]').click();});await settle();await page.screenshot({path:`${output}/t10-${name}.png`});};
 await shot('entrance');
 console.log('high',await page.evaluate(()=>({quality:t10Scene.getStats().quality,calls:t10Renderer.info.render.calls,memory:{...t10Renderer.info.memory},textLength:t10Session.blocks[t10Id].text.length})));
 await page.evaluate(()=>t10Interior.group.children.filter(c=>c.userData.buildTexture)[0].userData.action());await shot('page-left');
 await page.evaluate(()=>t10Interior.group.children.filter(c=>c.userData.buildTexture)[1].userData.action());await shot('page-right');
 console.log('texture',await page.evaluate(()=>{const m=t10Interior.group.children.find(c=>c.userData.buildTexture).material.map;return {width:m.image.width,height:m.image.height,anisotropy:m.anisotropy,mipmaps:m.generateMipmaps};}));
 await page.evaluate(()=>{t10Scene.enterBlock(t10Id);const portal=t10Interior.group.children[0].children.at(-1);const canvas=t10Renderer.domElement;
  // Walk close to the actual exit without crossing it.
  const steps=Math.floor((portal.position.z-12)/2);for(let i=0;i<steps;i++)canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:200,cancelable:true}));});await shot('portal');
 await page.evaluate(()=>{t10Scene.setQuality('low');t10Scene.enterBlock(t10Id);});await shot('low-quality');
 console.log('low',await page.evaluate(()=>({quality:t10Scene.getStats().quality,calls:t10Renderer.info.render.calls,memory:{...t10Renderer.info.memory},width:t10Interior.group.children.find(c=>c.userData.buildTexture).material.map.image.width})));
 await page.evaluate(()=>{t10Scene.setQuality('high');t10Scene.enterDistrict(0);});await shot('district');
 console.log('district',await page.evaluate(()=>({quality:t10Scene.getStats().quality,calls:t10Renderer.info.render.calls,memory:{...t10Renderer.info.memory}})));
 // Check traversal and child click actions on real portal geometry.
 const checks=await page.evaluate(()=>{const doors=t10Interior.group.children[0].children;
  return {doors:doors.length,clickable:doors.every(d=>d.children.every(c=>typeof c.userData.action==='function'))};});assert.ok(checks.clickable);
 const clickTarget=await page.evaluate(()=>{
   const d=t10Interior.group.children[0].children[1], p=d.children[1].getWorldPosition(t10Camera.position.clone()).project(t10Camera);
   const rect=t10Renderer.domElement.getBoundingClientRect();return {x:rect.x+(p.x+1)*rect.width/2,y:rect.y+(1-p.y)*rect.height/2,id:t10Interior.getView().ids[1]};
 });await page.mouse.click(clickTarget.x,clickTarget.y);await settle();
 assert.equal(await page.evaluate(()=>t10Interior.getView().id),clickTarget.id);
 await page.evaluate(()=>{t10Scene.enterDistrict(0);window.t10WalkId=t10Interior.getView().ids[0];t10Interior.move(5,4);});
 assert.equal(await page.evaluate(()=>t10Interior.getView().id),await page.evaluate(()=>t10WalkId));
 console.log('portal checks',{...checks,rayClick:true,walkThroughSidePortal:true});
 const stress=await page.evaluate(async()=>{
  const s=structuredClone(t10Session),b=s.blocks[t10Id];b.text='Large synthetic result. '.repeat(8000);b.chars=b.text.length;
  t10Scene.setSession(s);t10Scene.setQuality('high');t10Scene.enterBlock(t10Id);
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const high=t10Renderer.info.render.calls;
  const pose=t10Camera.position.clone();t10Scene.setQuality('low');
  await new Promise(r=>requestAnimationFrame(r));if(!t10Camera.position.equals(pose))throw Error('Quality switch moved walker');
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const low=t10Renderer.info.render.calls;
  t10Scene.exitInside();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const before={...t10Renderer.info.memory};
  for(let i=0;i<5;i++){t10Scene.enterBlock(t10Id);await new Promise(r=>requestAnimationFrame(r));t10Scene.exitInside();await new Promise(r=>requestAnimationFrame(r));}
  return {high,low,before,after:{...t10Renderer.info.memory}};
 });assert.ok(stress.high<120);assert.deepEqual(stress.before,stress.after);console.log('maximum pages and five cycles',stress);
console.log('browser errors',errors);assert.deepEqual(errors,[]);
}finally{await browser.close();}
