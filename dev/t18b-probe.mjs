import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE_MODULE);
const shots = process.env.T18B_SHOTS || 'dev/shots';
await mkdir(shots,{recursive:true});
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=gl-egl','--ignore-gpu-blocklist','--enable-gpu']});
const errors=[];
const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'light',permissions:['clipboard-read','clipboard-write']});
// Exact cached copy of the existing pinned CDN module, to keep verification offline.
await context.route('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',route=>route.fulfill({path:process.env.THREE_MODULE_PATH,contentType:'text/javascript'}));
await context.route('https://fonts.googleapis.com/**',route=>route.fulfill({body:'',contentType:'text/css'}));
const page=await context.newPage();
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
let checks=0;function check(value,message){assert.ok(value,message);checks++;}
async function shot(name){await page.screenshot({path:`${shots}/t18b-${name}.png`});}
async function tools(){
  if(await page.locator('#menu-toggle').isVisible()) await page.locator('#menu-toggle').click();
  await page.locator('#show-tools').click();
}
try{
  await page.goto('http://127.0.0.1:8794',{waitUntil:'networkidle'});
  await page.locator('#show-tools').waitFor();
  await page.locator('#transcript-file').setInputFiles('test/fixtures/tools-demo.jsonl');
  await page.waitForFunction(()=>document.querySelector('#session-info').textContent.includes('tools-demo'));
  await tools();
  await page.locator('.tool-server').first().waitFor();
  check(await page.locator('.tool-server').count()===3,'Two MCP servers and built-ins');
  check(await page.locator('#show-tools .tools-badge').textContent()==='10','Failure count badge');
  await shot('tools');
  await page.locator('#failures-tab').click();
  await page.locator('.tool-failure').first().click();
  await page.waitForTimeout(500);
  check(await page.locator('#reader-panel').isVisible(),'Reader opens on failed call');
  check(await page.getByRole('button',{name:'Copy as issue',exact:true}).isVisible(),'Copy as issue present');
  check(await page.getByRole('button',{name:'Show call',exact:true}).isVisible(),'Show call present');
  await shot('failures');
  await page.getByRole('button',{name:'Copy as issue',exact:true}).click();
  check((await page.evaluate(()=>navigator.clipboard.readText())).includes('```json'),'Clipboard has JSON issue snippet');
  await page.getByRole('button',{name:'Show call',exact:true}).click();
  check(await page.getByRole('button',{name:'Show result',exact:true}).isVisible(),'Matching call links back');
  await page.getByRole('button',{name:'Show result',exact:true}).click();
  await page.locator('[data-filter="category"][data-value="Permission / rejected"]').click();
  check(await page.locator('.tool-failure').count()===2,'Category filters results');
  await page.locator('#tools-heading').focus();
  await page.keyboard.press('j');await page.keyboard.press('k');
  check(await page.locator('.tool-failure[aria-current="true"]').count()===1,'Keyboard selects an active filtered row');
  await shot('filter');
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await page.emulateMedia({colorScheme:'dark'});
  await page.waitForTimeout(250);
  await page.locator('.tool-failure').first().click();
  await shot('dark');
  check(await page.locator('#close-tools').evaluate(n=>getComputedStyle(n).backgroundColor==='rgb(38, 50, 77)'),'Dark controls use the dark surface token');
  await page.locator('#tools-heading').focus();await page.keyboard.press('Escape');
  check(await page.locator('#show-tools').evaluate(n=>document.activeElement===n),'Escape restores toolbar focus');
  await tools();
  await page.locator('#tools-tab').click();
  await page.locator('#tools-health thead button').nth(2).click();
  check(await page.locator('#tools-health [aria-sort="descending"]').count()===1,'Sortable health table has aria-sort');
  // Timeline ticks and Findings share the selected failure state.
  await page.locator('#close-tools').click();
  await page.locator('#timeline .failure-tick-target').first().click();
  check(await page.locator('#tools-failures').isVisible(),'Timeline tick opens Failures');
  check(await page.locator('.tool-failure[aria-current="true"]').count()===1,'Timeline selects failure state');
  await page.locator('#close-tools').click();
  await page.locator('#show-findings').click();
  await page.locator('[data-finding-id="failed_tools:all"]').click();
  check(await page.locator('#findings-panel').isHidden(),'Failure finding closes Findings');
  check(await page.locator('#tools-failures').isVisible(),'Failure finding opens Failures');
  await page.locator('[data-filter="server"][data-value="atlas"]').click();
  await page.locator('[data-filter="category"][data-value="MCP / server"]').click();
  check(await page.locator('.tools-empty').textContent()==='No failures for this filter.','AND filters show empty state');
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await page.locator('.tool-failure').first().click();
  // Rejected clipboard permission falls back to selected local text.
  await page.evaluate(()=>{
    window.originalCopy=document.execCommand;
    window.originalWrite=navigator.clipboard.writeText;
    navigator.clipboard.writeText=()=>Promise.reject(new Error('Invented permission rejection'));
    document.execCommand=()=>false;
  });
  await page.getByRole('button',{name:'Copy as issue',exact:true}).click();
  check(await page.locator('.clipboard-manual').evaluate(n=>n.selectionEnd===n.value.length && n.selectionEnd>0),'Rejected clipboard selects Markdown for manual copy');
  await page.keyboard.press('Escape');
  check(await page.locator('#tools-panel').isVisible(),'Tools leaves text input Escape alone');
  await page.evaluate(()=>{navigator.clipboard.writeText=window.originalWrite;document.execCommand=window.originalCopy;document.querySelector('.clipboard-manual').remove();});
  await page.locator('#tools-tab').click();
  const slider=page.locator('#request-slider'), box=await slider.boundingBox();
  await page.mouse.click(box.x+box.width*.8,box.y+box.height*.3);
  check(Number(await slider.inputValue())>0,'Timeline pointer seeking still works');
  await page.mouse.move(box.x+box.width*.6,box.y+box.height*.3);
  await page.keyboard.down('Control');await page.mouse.wheel(0,-150);await page.keyboard.up('Control');
  await page.waitForTimeout(200);
  check(await page.getByRole('button',{name:'Zoom out',exact:true}).isVisible(),'Timeline wheel zoom still works');
  await page.getByRole('button',{name:'Zoom out',exact:true}).click();
  // The badge uses white text on a dedicated red fill in both palettes.
  const contrast = await page.locator('.tools-badge').evaluate(n=>{
    const c=getComputedStyle(n);
    const luminance=value=>{const rgb=value.match(/\d+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
    const a=luminance(c.color),b=luminance(c.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  });
  check(contrast>=4.5,'Badge text contrast >= 4.5:1');
  await page.setViewportSize({width:400,height:860});
  await page.emulateMedia({colorScheme:'light'});
  await page.waitForTimeout(250);
  check(await page.locator('#show-tools').getAttribute('aria-expanded')==='true','Responsive transition preserves toolbar expanded state');
  check(await page.locator('#tools-panel').evaluate(n=>n.getBoundingClientRect().height<=innerHeight*.7+1),'Phone bottom sheet at most 70vh');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No phone page horizontal overflow');
  await shot('mobile-tools');
  await page.locator('#failures-tab').click();await page.locator('.tool-failure').first().click();
  await page.waitForTimeout(300);
  check(await page.locator('.tool-failure').first().evaluate(n=>n.getBoundingClientRect().height>=44),'Phone rows have touch targets');
  await shot('mobile-failures');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No phone failure overflow');
  check(errors.length===0,'No console errors: '+JSON.stringify(errors));
  console.log(JSON.stringify({checks,consoleErrors:errors.length,screenshots:6}));
}finally{await browser.close();}
