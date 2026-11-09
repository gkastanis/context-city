import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseText } from '../src/parse.js';
import { agentBranches, agentRun, attachAgents } from '../src/ui/agents.js';
import { districtLayout, districtGrid, runState, bridgeWidth, canalWidth, districtBridgeWidth } from '../src/scene/metropolis-model.js';
import { layoutRequest } from '../src/layout.js';
import { gameFacts } from '../src/ui/game-model.js';

const read=name=>readFile(new URL(`fixtures/${name}`,import.meta.url),'utf8');
async function fixture(){return attachAgents(parseText(await read('main-agent-branches.jsonl')),await Promise.all(['a','b','c','d'].map(async id=>agentRun(parseText(await read(`agent-branch-${id}.jsonl`)),`agent-${id}.jsonl`,{toolUseId:`call-${id}`}))));}

test('return measurements use notification for async and result for foreground, with exact fork IDs',async()=>{
  const s=await fixture();
  for(const b of agentBranches(s)){
    assert.equal(s.blocks[b.forkBlockId].kind,'tool_use');
    const block=s.blocks[b.mergeBlockId];
    assert.equal(b.returnedTokens,block.estTokens);
    assert.equal(b.delegation,b.peak/block.estTokens);
    if(b.async)assert.ok(block.notifies.includes(b.agentId));else assert.equal(block.kind,'tool_result');
  }
  const open=await fixture();for(const b of Object.values(open.blocks))delete b.notifies;
  const b=agentBranches(open).find(b=>b.agentId==='a');
  assert.equal(b.open,true);assert.equal(b.returnedTokens,0);assert.equal(b.mergeBlockId,null);assert.equal(b.delegation,null);
});
test('district packing resolves collisions, preserves lane depth, and puts unlinked runs at the end',()=>{
  const sizes=Array.from({length:60},(_,i)=>({agentId:String(i),width:15+i%7,depth:20+i%3}));
  const branches=sizes.slice(0,59).map((s,i)=>({agentId:s.agentId,forkBlockId:'fork',lane:i%4}));
  const rects=districtLayout({fork:50},branches,sizes);
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
    const a=rects[i],b=rects[j];assert.ok(Math.abs(a.x-b.x)>=(a.width+b.width)/2||Math.abs(a.y-b.y)>=(a.depth+b.depth)/2);
    if(a.lane<b.lane)assert.ok(a.y<b.y);
  }
  assert.ok(rects.at(-1).x>50);assert.deepEqual(districtLayout({},[],[]),[]);
});
test('compact grid preserves main building volumes',async()=>{
  const s=await fixture(),items=layoutRequest(s.agents[0].session,0).items;
  const grid=districtGrid(items);
  for(const it of items){const volume=grid.cells.filter(c=>c.blockId===it.blockId).reduce((n,c)=>n+c.height*c.side*c.side,0);assert.ok(Math.abs(volume-7*it.height*(it.z1-it.z0)*.96)<1e-6);}
  for(const c of grid.cells){assert.ok(c.x+c.side/2<=grid.width);assert.ok(c.y+c.side/2<=grid.depth);}
});
test('large slabs become ordered tower groups with exact volume and narrow streets',()=>{
  const items=[{blockId:'first',layer:'tools',kind:'tool_def',height:180,z0:0,z1:300},{blockId:'second',layer:'results',height:80,z0:300,z1:300.5}];
  const grid=districtGrid(items);
  assert.ok(grid.cells.length>2);
  assert.ok(grid.cells.every(c=>c.side<=7&&c.height<=220));
  assert.equal(grid.cells[0].blockId,'first');assert.equal(grid.cells.at(-1).blockId,'second');
  for(const it of items){const volume=grid.cells.filter(c=>c.blockId===it.blockId).reduce((n,c)=>n+c.height*c.side**2,0);assert.ok(Math.abs(volume-7*.96*it.height*(it.z1-it.z0))<1e-6);}
  for(let i=0;i<grid.cells.length;i++)for(let j=i+1;j<grid.cells.length;j++){const a=grid.cells[i],b=grid.cells[j];assert.ok(Math.abs(a.x-b.x)>=(a.side+b.side)/2||Math.abs(a.y-b.y)>=(a.side+b.side)/2);}
});
test('canal scales with the main city and foundations stay across its far bank',()=>{
  assert.equal(canalWidth(10),21);assert.equal(canalWidth(4000),320);
  const rects=districtLayout({end:4000},[],[{agentId:'a',width:20,depth:20}]);
  assert.ok(rects[0].y-rects[0].depth/2-3.5>=320);
  assert.equal(districtBridgeWidth(0),4.2);assert.ok(districtBridgeWidth(1600)>districtBridgeWidth(400));
});
test('fractional footprints make forward progress at collision boundaries',()=>{
  const sizes=Array.from({length:60},(_,i)=>({agentId:String(i),width:Math.sqrt(9876+i)*Math.PI,depth:Math.sqrt(789+i)}));
  const branches=sizes.map(s=>({agentId:s.agentId,forkBlockId:'f',lane:0}));
  const rects=districtLayout({f:1234.56789},branches,sizes);
  for(let i=1;i<rects.length;i++)assert.ok(rects[i].x-rects[i-1].x>(rects[i].width+rects[i-1].width)/2+8);
});
test('time sync respects pending, running, merged, open and missing-time fallback',()=>{
  const b={fork:2,merge:8,open:false},r=[{time:100},{time:200},{time:300}];
  assert.deepEqual(runState(b,1,400,r),{state:'pending',idx:-1});
  assert.deepEqual(runState(b,4,250,r),{state:'running',idx:1});
  assert.deepEqual(runState(b,4,50,r),{state:'running',idx:0});
  assert.deepEqual(runState(b,5,null,r),{state:'running',idx:1});
  assert.deepEqual(runState(b,8,200,r),{state:'merged',idx:2});
  assert.deepEqual(runState({...b,open:true},8,400,r),{state:'open',idx:2});
});
test('return width uses a bounded square root scale',()=>{
  assert.equal(bridgeWidth(0),.3);assert.equal(bridgeWidth(-100),.3);
  assert.ok(Math.abs(bridgeWidth(400)-.7)<1e-10);assert.ok(Math.abs(bridgeWidth(1600)-1.4)<1e-10);assert.equal(bridgeWidth(1e9),3.5);
});
test('district discovery exists only with loaded runs',async()=>{
  const s=await fixture();assert.equal(gameFacts(s).quests.filter(q=>q.id==='subagent').length,1);
  assert.equal(gameFacts({...s,agents:[]}).quests.some(q=>q.id==='subagent'),false);
});

test('timestamped run stays monotone before its first request',()=>{
 const requests=Array.from({length:30},(_,i)=>({time:1000+i*100}));
 assert.deepEqual([900,950,1150].map((time,i)=>runState({fork:10,merge:13},10+i,time,requests).idx),[0,0,1]);
});
test('missing fork anchors on merge, and absent anchors use the unlinked row',()=>{
 const sizes=[{agentId:'result',width:8,depth:8},{agentId:'none',width:8,depth:8}];
 const rects=districtLayout({null:0,end:200,result:120},[{agentId:'result',forkBlockId:null,mergeBlockId:'result'},{agentId:'none',forkBlockId:null,mergeBlockId:null}],sizes);
 assert.equal(rects[0].x,120);assert.equal(rects[0].linked,true);
 assert.ok(rects[1].x>200);assert.equal(rects[1].linked,false);
 assert.ok(rects.every(r=>r.y-r.depth/2>=10+canalWidth(200)));
});
