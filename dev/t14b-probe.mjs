// Numeric reports only. Real screenshots are explicitly local, never bundled.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { parseFiles } from '../src/ui/loader.js';
import { agentBranches } from '../src/ui/agents.js';
const {chromium}=await import(process.env.PLAYWRIGHT_CORE_MODULE||'playwright-core');
const base=process.env.T14_URL||'http://127.0.0.1:8795';
let server;
if(process.env.T14_SERVE){
 const port=Number(new URL(base).port);assert.ok(port>=8790&&port<=8799);
 const root=process.cwd(),types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
 server=createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,base).pathname));if(!file.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
}
const shots=process.env.T14_SHOTS||'dev/shots';await mkdir(shots,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=gl-egl','--ignore-gpu-blocklist','--enable-gpu','--disable-gpu-vsync','--disable-frame-rate-limit']});
const errors=[],budgetChecks=[];
async function pageFor(width=1440,reduced=true,baseline=false,fallback=false){
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion:reduced?'reduce':'no-preference',ignoreHTTPSErrors:true});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!(fallback&&m.text().includes('Error creating WebGL context')))errors.push(m.text());});
 if(fallback)await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,options){if(/webgl/.test(kind)&&(options?.powerPreference!=='low-power'||kind==='webgl2'))return null;return original.call(this,kind,options);};});
 if(baseline)await page.route('**/src/**/*.js',async route=>{const url=new URL(route.request().url());try{await route.fulfill({contentType:'text/javascript',body:await readFile(path.join(process.env.T14_BASELINE,url.pathname),'utf8')});}catch{await route.continue();}});
 else await page.route('**/src/app.js',async route=>{const body=await readFile(new URL('../src/app.js',import.meta.url),'utf8');await route.fulfill({contentType:'text/javascript',body:body.replace('scene = createScene(stage, {','scene = window.t14Scene = createScene(stage, { dev:true,').replace('onAgentOpen: id => {','onAgentOpen: id => {if(window.t14HoldRun)return;')});});
 await page.goto(base+'/index.html');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('ready'));
 if(!baseline)await page.waitForFunction(()=>window.t14Scene);
 return page;
}
const payload=(name,buffer)=>({name,buffer,mimeType:'application/json'});
const fixture=async name=>readFile(new URL('../test/fixtures/'+name,import.meta.url));
const files=[payload('main-agent-branches.jsonl',await fixture('main-agent-branches.jsonl')),...(await Promise.all(['a','b','c','d'].map(async id=>[payload(`agent-${id}.jsonl`,await fixture(`agent-branch-${id}.jsonl`)),payload(`agent-${id}.meta.json`,Buffer.from(JSON.stringify({agentType:id==='b'?'explorer':'reviewer',toolUseId:`call-${id}`,description:`Review synthetic square ${id}`})))]))).flat()];
const stats=page=>page.evaluate(()=>t14Scene.getStats().metropolis);
async function seek(page,idx){await page.locator('#request-slider').fill(String(idx));await page.locator('#request-slider').dispatchEvent('change');await page.waitForTimeout(600);await dismiss(page);}
async function dismiss(page){await page.evaluate(()=>{for(const el of document.querySelectorAll('#discovery-toast'))el.hidden=true;});}
async function view(page){if(await page.locator('#tape-toggle').isVisible()&&await page.locator('#tape-toggle').getAttribute('aria-expanded')!=='true')await page.locator('#tape-toggle').click();await page.getByRole('button',{name:'Metropolis',exact:true}).click();await page.waitForTimeout(1000);await dismiss(page);}
async function frameMs(page,on){await page.evaluate(on=>{t14Scene.setQuality('high');t14Scene.setDistrictsVisible(on);},on);await page.waitForTimeout(700);return page.evaluate(()=>new Promise(resolve=>{const samples=[];let last=performance.now();function tick(){t14Scene.finishFrame();const now=performance.now();samples.push(now-last);last=now;if(samples.length<220)requestAnimationFrame(tick);else{samples.splice(0,20);samples.sort((a,b)=>a-b);resolve(samples[Math.floor(samples.length/2)]);}}requestAnimationFrame(tick);}));}
async function performancePair(page){const off=[],on=[];for(let i=0;i<5;i++){off.push(await frameMs(page,false));on.push(await frameMs(page,true));}off.sort((a,b)=>a-b);on.sort((a,b)=>a-b);return {off:off[2],on:on[2],offRounds:off,onRounds:on};}

try{
 if(process.env.T14_BASELINE){
  for(const baseline of [true,false]){const page=await pageFor(1440,true,baseline);await page.waitForTimeout(1500);await dismiss(page);await page.screenshot({path:`${shots}/t14b-no-runs-${baseline?'before':'after'}.png`});await page.close();}
 }
 for(const width of process.env.T14_NUMERIC_ONLY?[]:[1440,400]){
  const page=await pageFor(width);await page.locator('#transcript-file').setInputFiles(files);await page.waitForFunction(()=>t14Scene.getStats().metropolis.districts===4);
  let s=await stats(page);assert.equal(s.bridges,8);assert.ok(s.states.every(r=>r.state==='pending'));
  await seek(page,11);await view(page);await page.screenshot({path:`${shots}/t14b-${width===400?'mobile':'metropolis'}.png`});
  const corners=await page.evaluate(()=>t14Scene.projectMetropolis());assert.ok(corners.every(p=>p.x>=0&&p.x<=width&&p.y>=0&&p.y<=900));console.log(JSON.stringify({width,framedCorners:corners.length}));
  await seek(page,3);s=await stats(page);assert.deepEqual(s.states.map(r=>r.state),['running','running','running','pending']);
  if(width===1440)await page.screenshot({path:`${shots}/t14b-running.png`});
  await seek(page,5);await seek(page,6);s=await stats(page);assert.equal(s.states[0].state,'merged');assert.ok(s.pulses>0);
  if(width===1440)await page.screenshot({path:`${shots}/t14b-merge.png`});
  await view(page);
  if(width===400)assert.equal((await stats(page)).glow,0);
  const stageRect=await page.locator('#stage').boundingBox();let bridgeTip=false;
  for(const p of await page.evaluate(()=>t14Scene.projectBridges())){await page.mouse.move(stageRect.x+p.x,stageRect.y+p.y);if(await page.locator('.metropolis-tooltip').isVisible()&&/Returned \d/.test(await page.locator('.metropolis-tooltip').textContent())){bridgeTip=true;break;}}
  assert.equal(bridgeTip,true);
  const p=await page.evaluate(()=>t14Scene.projectAgent('a'));const rect=await page.locator('#stage').boundingBox();
  await page.mouse.move(rect.x+p.x,rect.y+p.y);await page.waitForTimeout(200);
  assert.equal(await page.locator('.metropolis-tooltip').isVisible(),true);
  assert.match(await page.locator('.metropolis-tooltip').textContent(),/main requests/);
  if(width===1440){await page.screenshot({path:`${shots}/t14b-hover.png`});await page.evaluate(()=>{window.t14HoldRun=true;t14Scene.openAgentDistrict('a');});await page.waitForTimeout(1000);await dismiss(page);await page.screenshot({path:`${shots}/t14b-closeup.png`});await view(page);await page.evaluate(()=>window.t14HoldRun=false);}
  await page.evaluate(()=>window.t14HoldRun=false);await page.mouse.click(rect.x+p.x,rect.y+p.y);await page.waitForFunction(()=>!document.querySelector('#subagent-breadcrumb').hidden);
  await page.locator('#back-main').click();await page.waitForFunction(()=>document.querySelector('#subagent-breadcrumb').hidden);
  assert.equal(await page.locator('#request-slider').inputValue(),'6');
  if(width===1440){
   await page.locator('.agent-branch').first().focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>!document.querySelector('#subagent-breadcrumb').hidden);await page.locator('#back-main').click();
   await page.getByRole('button',{name:'Metropolis',exact:true}).focus();await page.keyboard.press('Enter');await page.waitForTimeout(300);
   await page.evaluate(async()=>{const {parseText}=await import('/src/parse.js');const s=parseText(await(await fetch('/test/fixtures/main-agent-branches.jsonl')).text());t14Scene.enterBlock(s.requests[6].blockIds[0]);});
   assert.equal(await page.evaluate(()=>t14Scene.getMode()),'inside');assert.equal(await page.evaluate(()=>t14Scene.getStats().cameraNear),.05);
   await page.evaluate(()=>t14Scene.exitInside());await view(page);
  }
  if(width===400 && !(await page.locator('#index-panel').isVisible())){await page.locator('#menu-toggle').click();await page.getByRole('button',{name:'Index',exact:true}).click();}
  else if(!(await page.locator('#index-panel').isVisible()))await page.getByRole('button',{name:'Index',exact:true}).click();
  await page.locator('#index-panel details').first().evaluate(n=>n.open=true);
  await page.locator('#layer-subagents').uncheck();assert.equal((await stats(page)).visible,false);
  await page.reload();await page.waitForFunction(()=>window.t14Scene);await page.locator('#transcript-file').setInputFiles(files);await page.waitForFunction(()=>t14Scene.getStats().metropolis.districts===4);assert.equal((await stats(page)).visible,false);
  await page.evaluate(()=>t14Scene.setDistrictsVisible(true));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  console.log(JSON.stringify({width,districts:4,bridges:8,timeStates:true,merge:true,hover:true,click:true,persistence:true,overflow:false}));await page.close();
 }
 // A non-reduced scene exercises the travelling pulse and cancellation-safe flight.
 if(!process.env.T14_NUMERIC_ONLY){
  const animated=await pageFor(1440,false);await animated.locator('#transcript-file').setInputFiles(files);await animated.waitForFunction(()=>t14Scene.getStats().metropolis.districts===4);await view(animated);await seek(animated,5);await animated.locator('#request-slider').fill('6');await animated.locator('#request-slider').dispatchEvent('change');await animated.waitForTimeout(250);assert.ok((await stats(animated)).activePulses>0);await dismiss(animated);await animated.screenshot({path:`${shots}/t14b-merge.png`});await animated.close();
  const fallback=await pageFor(400,false,false,true);await fallback.locator('#transcript-file').setInputFiles(files);await fallback.waitForFunction(()=>t14Scene.getStats().metropolis.districts===4);await seek(fallback,4);const s=await stats(fallback);assert.equal(s.glow,0);assert.equal(s.ripples,0);console.log(JSON.stringify({webglFallback:true,glow:s.glow,ripples:s.ripples}));await fallback.close();
 }
 if(process.env.T14_REAL_MAIN){
  const main=process.env.T14_REAL_MAIN,dir=main.replace(/\.jsonl$/,'')+'/subagents',names=(await readdir(dir)).filter(n=>/^agent-.*\.(jsonl|meta\.json)$/.test(n));
  const paths=[main,...names.map(n=>path.join(dir,n))];
  console.log(JSON.stringify({stage:'real-parse',files:paths.length}));
  const {session}=await parseFiles(await Promise.all(paths.map(async p=>new File([await readFile(p)],path.basename(p))))).promise;
  const branches=agentBranches(session),ratios=branches.map(b=>b.delegation).filter(Number.isFinite).sort((a,b)=>a-b);
  console.log(JSON.stringify({stage:'real-parsed',requests:session.requests.length,runs:session.agents.length}));
  const page=await pageFor(1440,false);await page.locator('#transcript-file').setInputFiles(paths);await page.waitForFunction(n=>t14Scene.getStats().metropolis.districts===n,session.agents.length,{timeout:120000});await seek(page,Math.min(596,session.requests.length-1));await view(page);
  await page.addStyleTag({content:'#session-info,.request-story,.agent-branch-label,.context-city-labels,#session-details,#session-notice {visibility:hidden !important}'});
  console.log(JSON.stringify({stage:'real-rendered',mainWidthFraction:await page.evaluate(()=>{const p=t14Scene.projectMainCity().map(p=>p.x);return(Math.max(...p)-Math.min(...p))/innerWidth;}),stats:await page.evaluate(()=>{const s=t14Scene.getStats();return{camera:s.camera,target:s.target,viewport:s.viewport,canal:s.metropolis.canalWidth,height:s.metropolis.maxHeight,buildings:s.metropolis.buildings,render:s.render};})}));await page.screenshot({path:`${shots}/t14b-real-metropolis.png`});
  const s=await stats(page);assert.ok(s.maxFootprint<=7);assert.ok(s.rects.every(r=>r.y-r.depth/2-10>=s.canalWidth-1e-6));let overlaps=0;
  for(let i=0;i<s.rects.length;i++)for(let j=i+1;j<s.rects.length;j++){const a=s.rects[i],b=s.rects[j];if(Math.abs(a.x-b.x)<(a.width+b.width)/2&&Math.abs(a.y-b.y)<(a.depth+b.depth)/2)overlaps++;}
  const {off,on,offRounds,onRounds}=await performancePair(page);console.log(JSON.stringify({realPerformanceRounds:{offRounds,onRounds}}));budgetChecks.push(on<=off*1.15);
  
  const mid=Math.floor(ratios.length/2),median=ratios.length%2?ratios[mid]:(ratios[mid-1]+ratios[mid])/2;
  console.log(JSON.stringify({real:{requests:session.requests.length,runs:s.districts,bridges:s.bridges,overlaps,medianDelegation:median,offMs:off,onMs:on,deltaPercent:(on/off-1)*100}}));
  // Hold only the development callback to inspect the completed district flight.
  await seek(page,agentBranches(session)[0].fork);await view(page);await page.screenshot({path:`${shots}/t14b-real-running.png`});await seek(page,596);await page.evaluate(id=>{window.t14HoldRun=true;t14Scene.openAgentDistrict(id);},session.agents[0].agentId);
  await page.waitForTimeout(1100);await page.screenshot({path:`${shots}/t14b-real-closeup.png`});await page.close();
 }
 // Full-size synthetic district stress, independent of text fixtures.
 const stress=await pageFor();
 console.log(JSON.stringify({stage:'stress'}));
 await stress.evaluate(async()=>{
  const {attachAgents}=await import('/src/ui/agents.js');
  const make=(n,prefix)=>{
   const blocks={},requests=[];for(let i=0;i<n;i++){const id=prefix+i;blocks[id]={id,kind:i%7===0?'tool_use':'tool_result',toolName:i%7===0?'Agent':'Read',toolUseId:'call-'+i,layer:'results',label:'Synthetic block',estTokens:300+i%17*80,provenance:'reconstructed',text:'Synthetic'};requests.push({idx:i,time:i*60000,blockIds:Object.keys(blocks),newBlockIds:[id],estTokens:Object.values(blocks).reduce((n,b)=>n+b.estTokens,0),measuredTokens:null});}return{blocks,requests,events:[],meta:{window:1e6}};
  };
  const main=make(600,'main:');const agents=Array.from({length:60},(_,i)=>({agentId:'stress-'+i,toolUseId:'call-'+i*7,agentType:'reviewer',description:'Synthetic stress district',session:make(35,'run:'+i+':')}));
  const session=attachAgents(main,agents);t14Scene.setSession(session);t14Scene.setRequest(599);t14Scene.showMetropolis();
 });
 await stress.waitForTimeout(1200);const {off,on}=await performancePair(stress),s=await stats(stress);console.log(JSON.stringify({stress60:{districts:s.districts,bridges:s.bridges,buildings:s.buildings,offMs:off,onMs:on,fps:1000/on}}));assert.ok(on<1000/30);await stress.close();
 assert.deepEqual(errors,[]);assert.ok(budgetChecks.every(Boolean),'Real-session district overhead exceeds 15%');console.log(JSON.stringify({consoleErrors:errors.length}));
}finally{await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
