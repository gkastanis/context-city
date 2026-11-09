import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE_MODULE);
const shots = process.env.T18C_SHOTS || '/tmp/t18c-shots';
const port = Number(process.env.T18C_PORT || 8794);
assert.ok(port >= 8790 && port <= 8799);
await mkdir(shots, {recursive:true});
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=gl-egl','--ignore-gpu-blocklist','--enable-gpu']});
const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'light'});
await context.route('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',r=>r.fulfill({path:process.env.THREE_MODULE_PATH,contentType:'text/javascript'}));
await context.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:'',contentType:'text/css'}));
const page=await context.newPage(),errors=[],heights=[],tablets=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
let checks=0;function check(value,label){assert.ok(value,label);checks++;}
async function shot(name){await page.screenshot({path:`${shots}/t18c-${name}.png`});}
async function resize(width,height){await page.setViewportSize({width,height});await page.waitForTimeout(350);}
async function openTools(){if(await page.locator('#menu-toggle').isVisible())await page.locator('#menu-toggle').click();await page.locator('#show-tools').click();}
async function fixture(){await page.locator('#transcript-file').setInputFiles('test/fixtures/tools-demo.jsonl');await page.waitForFunction(()=>document.querySelector('#session-info').textContent.includes('tools-demo'));}
try {
 await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'networkidle'});
 await page.locator('#show-tools').waitFor();
 await page.locator('#stage canvas').waitFor({timeout:60000});
 // Startup sample, with an overview of all observed failures.
 const skip=page.getByRole('button',{name:'Skip intro',exact:true});if(await skip.isVisible())await skip.click();
 await page.locator('#request-slider').evaluate(n=>{n.value=String(Math.min(16,Number(n.max)));n.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.waitForTimeout(1400);
 await page.getByRole('button',{name:'Overview',exact:true}).click({force:true});
 await page.waitForTimeout(1600);
 // Tilt the Overview orbit upward so the small failed-result roofs are visible.
 await page.mouse.move(1180,360);await page.mouse.down();await page.mouse.move(1180,590,{steps:12});await page.mouse.up();await page.waitForTimeout(400);
 await shot('city');
 // Exercise the real beacon resources, including intro and falling transitions.
 const beacons=await page.evaluate(async()=>{
   const {createCity}=await import('/src/scene/city.js');
   const city=createCity(), item={blockId:'synthetic',label:'Synthetic failure',kind:'tool_result',layer:'results',height:20,z0:0,z1:10,isError:true,paramCount:0};
   const lit=()=>city.group.children.filter(m=>m.material?.uniforms?.viewport).reduce((n,m)=>n+m.count,0);
   city.update({items:[item],totalTokens:1000},new Set(),false);
   const mesh=city.group.children.find(m=>m.material?.uniforms?.viewport);
   const ready=lit(),depthTest=mesh.material.depthTest,size=mesh.material.vertexShader.includes('*20./viewport');
   city.intro(0);const below=lit();city.intro(1);const risen=lit();
   city.update({items:[],totalTokens:0},new Set(),true);const falling=lit();
   city.dispose();return {ready,below,risen,falling,depthTest,size};
 });
 check(beacons.ready===1 && beacons.below===0 && beacons.risen===1 && beacons.falling===0,'beacons follow actual building visibility');
 check(beacons.depthTest && beacons.size,'beacons retain depth occlusion and peer size');
 await fixture();
 for(const [width,height,expected] of [[1440,900,161],[400,860,148]]){
  await resize(width,height);const measured=await page.locator('#timeline').evaluate(n=>n.getBoundingClientRect().height);
  heights.push({width,height,heightPx:measured});check(measured===expected,'timeline restored at '+width);
  const widths=await page.locator('#timeline > svg .failure-hit').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().width));
  check(widths.length>0 && widths.every(w=>w>=23.9),'pixel-based failure targets at '+width);
 }
 await resize(1440,900);await openTools();
 check(await page.locator('.tool-server').count()===3,'MCP groups and built-ins');
 check(await page.locator('#tools-health').evaluate(n=>n.scrollWidth<=n.clientWidth),'health table fits panel');
 check(await page.locator('.tool-health-row td:not(:first-child)').evaluateAll(ns=>ns.every(n=>getComputedStyle(n).whiteSpace==='nowrap')),'numeric cells do not wrap');
 const dark=await page.locator('#tools-panel').evaluate(n=>getComputedStyle(n).backgroundColor);
 await page.emulateMedia({colorScheme:'dark'});
 check(await page.locator('#tools-panel').evaluate(n=>getComputedStyle(n).backgroundColor)===dark,'HUD stays dark in both system schemes');
 await shot('tools');
 await page.locator('#failures-tab').click();
 const atlas=page.locator('.tool-failure').filter({has:page.locator('strong',{hasText:'search'})}).first();
 await atlas.click();await page.waitForTimeout(450);
 check(await page.locator('#reader-panel h2').textContent()==='atlas / search result','short MCP Reader title');
 check(await page.locator('.reader-error').isVisible(),'extracted error shown first');
 check(!(await page.locator('.reader-error').textContent()).includes('tool_use_id'),'Reader omits wrapper from error text');
 check(await page.locator('.reader-verbatim').isVisible(),'raw JSON available under Verbatim');
 await page.locator('.reader-verbatim summary').click();
 check((await page.locator('#block-text').textContent()).includes('tool_use_id'),'Verbatim preserves wrapper');
 await page.locator('.reader-verbatim summary').click();
 check(await page.locator('[data-filter="tool"][data-value="mcp__atlas__search"]').textContent()==='search 2','filter uses short name');
 check(await page.locator('[data-filter="tool"][data-value="mcp__atlas__search"]').getAttribute('title')==='mcp__atlas__search','filter title preserves full name');
 await shot('failures');
 await page.locator('[data-filter="server"][data-value="atlas"]').click();
 check(await page.locator('#reader-panel .failure-navigation span').textContent()==='1 of 4 failures','counter immediately follows an inclusive filter');
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();
 // Counter and stepping agree when the current Reader selection is outside the filter.
 await page.locator('[data-filter="server"][data-value="forge"]').click();
 await page.locator('#reader-panel').getByRole('button',{name:'Next failure',exact:true}).click();
 check(await page.locator('#reader-panel .failure-navigation span').textContent()==='2 of 10 failures','external selection steps within all failures');
 // Reader arrows scroll; j/k continue navigating. An open modal owns all keys.
 await page.locator('#reader-panel h2').evaluate(n=>{n.tabIndex=-1;n.focus();});
 const before=await page.locator('#reader-panel h2').textContent();await page.keyboard.press('ArrowDown');
 check(await page.locator('#reader-panel h2').textContent()===before,'Reader ArrowDown does not step');
 await page.evaluate(()=>{const d=document.createElement('dialog');d.id='probe-modal';d.innerHTML='<button>Modal focus</button>';document.body.append(d);d.showModal();});
 await page.keyboard.press('j');check(await page.locator('#reader-panel h2').textContent()===before,'modal does not yield keys');
 await page.evaluate(()=>document.querySelector('#probe-modal').remove());
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();
 await atlas.click();
 for(const [width,height] of [[820,1180],[1024,768]]){
  await resize(width,height);
  const geometry=await page.evaluate(()=>{const t=document.querySelector('#tools-panel').getBoundingClientRect(),r=document.querySelector('#reader-panel').getBoundingClientRect();return {width:innerWidth,readerWidth:r.width,readerHeight:r.height,toolsBottom:t.bottom,readerTop:r.top,overflow:document.documentElement.scrollWidth>innerWidth};});
  tablets.push(geometry);check(geometry.readerWidth>=320 && geometry.readerHeight>=120 && geometry.readerTop>=geometry.toolsBottom && !geometry.overflow,'tablet Reader usable at '+width);
  if(width===820)await shot('tablet');
 }
 await resize(400,860);await page.locator('#tools-tab').click();await shot('mobile');
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no mobile page overflow');
 // Findings pins failures under their own label and keeps cost ranking separate.
 await resize(1440,900);await page.locator('#close-tools').click();await page.locator('#show-findings').click();
 check(await page.locator('.findings-failures h3').textContent()==='Failures','separate failure group label');
 check(await page.locator('.findings-list .finding--failed_tools').count()===0,'ranked list excludes pinned failure summary');
 check(errors.length===0,'no console errors');
 console.log(JSON.stringify({checks,consoleErrors:errors.length,heights,tablets,screenshots:5}));
} finally {await browser.close();}
