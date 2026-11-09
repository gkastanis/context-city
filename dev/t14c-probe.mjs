// Numeric reports only. Real screenshots are explicitly local, never bundled.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
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
const errors=[];
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
try{
 const main=process.env.T14_REAL_MAIN,dir=main.replace(/\.jsonl$/,'')+'/subagents';
 const paths=[main,...(await readdir(dir)).filter(n=>/^agent-.*\.(jsonl|meta\.json)$/.test(n)).map(n=>path.join(dir,n))];
 const page=await pageFor();
 await page.route('**/src/scene/index.js',async route=>{
  let body=await readFile(new URL('../src/scene/index.js',import.meta.url),'utf8');
  body=body.replace('const controls = new OrbitControls(camera, canvas);','const controls = new OrbitControls(camera, canvas);window.t14Camera=camera;window.t14Controls=controls;')
   .replace('const near = modes.get()','const near = window.t14Reference ? .05 : modes.get()')
   .replace('setSession(value) {','setSession(value) { const started=performance.now();')
   .replace('metropolis.load(value);','const loadStarted=performance.now();metropolis.load(value);window.t14LoadMs=performance.now()-loadStarted;')
   .replace('    },\n    setRequest(', '      window.t14SessionMs=performance.now()-started;\n    },\n    setRequest(');
  await route.fulfill({contentType:'text/javascript',body});
 });
 await page.reload();await page.waitForFunction(()=>window.t14Scene);await page.locator('#transcript-file').setInputFiles(paths);await page.waitForFunction(()=>t14Scene.getStats().metropolis.districts>0,{timeout:120000});
 console.log(JSON.stringify({main:{setSessionMs:await page.evaluate(()=>t14SessionMs),loadMs:await page.evaluate(()=>t14LoadMs)}}));
 await page.locator('.agent-branch').first().focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>!document.querySelector('#subagent-breadcrumb').hidden);await page.locator('#back-main').click();await page.waitForFunction(()=>document.querySelector('#subagent-breadcrumb').hidden);
 console.log(JSON.stringify({back:{setSessionMs:await page.evaluate(()=>t14SessionMs),loadMs:await page.evaluate(()=>t14LoadMs)}}));
 await seek(page,596);await dismiss(page);
 await page.addStyleTag({content:'body * {visibility:hidden!important} #stage,#stage canvas {visibility:visible!important}'});
 for(const mode of ['overview','whole','metropolis']){
  await page.evaluate(mode=>mode==='overview'?t14Scene.overview():mode==='whole'?t14Scene.showWholeSession():t14Scene.showMetropolis(),mode);
  await page.waitForTimeout(300);await page.screenshot({path:`${shots}/t14c-real-${mode}.png`});
 }
 console.log(JSON.stringify({realCounts:await page.evaluate(()=>{const s=t14Scene.getStats().metropolis;let overlaps=0;for(let i=0;i<s.rects.length;i++)for(let j=i+1;j<s.rects.length;j++){const a=s.rects[i],b=s.rects[j];if(Math.abs(a.x-b.x)<(a.width+b.width)/2&&Math.abs(a.y-b.y)<(a.depth+b.depth)/2)overlaps++;}return {districts:s.districts,bridges:s.bridges,overlaps};})}));
 // Focus a main block, then wheel from Metropolis's depth range into it.
 await page.evaluate(()=>{t14Camera.position.set(-16,12,60);t14Controls.target.set(0,8,65);});
 const box=await page.locator('#stage').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,-450);await page.waitForTimeout(300);
 const near=await page.evaluate(()=>({near:t14Camera.near,distance:t14Camera.position.distanceTo(t14Controls.target)}));assert.ok(near.near<=Math.max(.05,near.distance/2000)+1e-8);
 await page.screenshot({path:`${shots}/t14c-near-current.png`});await page.evaluate(()=>window.t14Reference=true);await page.waitForTimeout(200);await page.screenshot({path:`${shots}/t14c-near-reference.png`});console.log(JSON.stringify({near}));await page.close();
 const synthetic=await pageFor(1440,false);await synthetic.route('**/src/scene/labels.js',async route=>{let body=await readFile(new URL('../src/scene/labels.js',import.meta.url),'utf8');body=body.replace('const occupied = [];','window.t14Chips=[];const occupied = [];').replace('const w = r.width, h =',"if(r.agent)window.t14Chips.push({scale:heightScale,actual:p.y,expected:r.position.clone().project(camera).y});const w = r.width, h =");await route.fulfill({contentType:'text/javascript',body});});await synthetic.reload();await synthetic.waitForFunction(()=>window.t14Scene);await synthetic.locator('#transcript-file').setInputFiles(files);await synthetic.waitForFunction(()=>t14Scene.getStats().metropolis.districts===4);await seek(synthetic,5);await seek(synthetic,6);assert.ok((await stats(synthetic)).pulses>0);
 await synthetic.locator('.agent-branch').first().focus();await synthetic.keyboard.press('Enter');await synthetic.waitForFunction(()=>!document.querySelector('#subagent-breadcrumb').hidden);await synthetic.locator('#back-main').click();await synthetic.waitForFunction(()=>document.querySelector('#subagent-breadcrumb').hidden);await synthetic.waitForTimeout(300);assert.equal((await stats(synthetic)).pulses,0);
 await synthetic.evaluate(()=>{t14Scene.setRequest(0);t14Scene.setRequest(6,{restore:true});});assert.equal((await stats(synthetic)).pulses,0);
 await synthetic.evaluate(()=>t14Scene.showWholeSession());await synthetic.waitForTimeout(1200);
 const chips=await synthetic.evaluate(()=>window.t14Chips);assert.ok(chips.length>0);assert.ok(chips.every(c=>c.scale>2.7&&Math.abs(c.actual-c.expected)<1e-8));console.log(JSON.stringify({districtChips:chips.length,heightScale:chips[0].scale}));
 console.log(JSON.stringify({pulseAfterBack:(await stats(synthetic)).pulses,wholeSession:true}));
 // A result-only link creates only the return span; an empty run is skipped.
 await synthetic.evaluate(async()=>{const {parseText}=await import('/src/parse.js');const {attachAgents,agentRun}=await import('/src/ui/agents.js');const main=parseText(await(await fetch('/test/fixtures/main-agent.jsonl')).text());const run=agentRun(parseText(await(await fetch('/test/fixtures/agent-run.jsonl')).text()),'agent-a.jsonl');for(const b of Object.values(main.blocks))if(b.kind==='tool_use'&&b.toolName==='Agent')b.toolUseId=null;const result=Object.values(main.blocks).find(b=>b.kind==='tool_result'&&b.agentId);run.agentId=result.agentId;run.toolUseId=null;const session=attachAgents(main,[run,{agentId:'empty',session:{requests:[],blocks:{},events:[],meta:{}}}]);t14Scene.setSession(session);t14Scene.setRequest(main.requests.length-1);});
 const unlinked=await stats(synthetic);assert.equal(unlinked.districts,1);assert.equal(unlinked.bridges,1);console.log(JSON.stringify({resultOnly:{districts:unlinked.districts,bridges:unlinked.bridges},emptyRunSkipped:true}));await synthetic.close();assert.deepEqual(errors,[]);

}finally{await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
