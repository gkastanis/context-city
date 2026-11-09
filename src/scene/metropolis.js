import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { layoutRequest } from '../layout.js';
import { agentBranches, agentColor, agentBranchLabel, runLabel } from '../ui/agents.js';
import { districtLayout, districtGrid, runState, districtBridgeWidth, canalWidth, metropolisBounds } from './metropolis-model.js';
import { facade, createFailureBeacons } from './city.js';
import { failurePin } from './failure-model.js';
import { colorFor } from './theme.js';
import { disposeTree } from './dispose.js';

const vertex = `attribute float light; varying vec3 local,dim,tint,n; varying float lit;
void main(){local=position;dim=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));n=normal;tint=instanceColor;lit=light;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`;

export function createMetropolis() {
  const group = new THREE.Group(); group.name='subagent-metropolis';
  let root=null, session=null, records=[], buildings=null, decks=null, pads=null, water=null, lampLights=null, beads=null, alerts=null;
  let canal=21, mainLength=0;
  let time=0, previous=-1, enabled=true, hovered=null, pulseCount=0;
  // Keep immutable run geometry and the last request layout across Back rebuilds.
  const runLayouts=new WeakMap();
  const transform=new THREE.Object3D(), color=new THREE.Color();
  const setMatrix=(mesh,i,x,y,z,sx,sy,sz,angle=0)=>{
    transform.position.set(x,y,z);transform.scale.set(sx,sy,sz);transform.rotation.set(0,angle,0);transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix);
  };
  function clear() { if(root){root.traverse(o=>{if(o.isInstancedMesh)o.dispose();});disposeTree(root);}root=null;records=[];buildings=decks=pads=water=lampLights=beads=alerts=null;previous=-1;hovered=null;pulseCount=0; }
  function load(value) {
    clear(); session=value;
    if(!value.agents?.some(run=>run.session.requests.length))return;
    root=new THREE.Group();group.add(root);
    const branches=agentBranches(value), positions={end:Math.max(0,...value.requests.map(r=>r.measuredTokens??r.estTokens??0))*.01}, snapshots=new Map();
    const anchor=(id,idx)=>{
      if(!id)return 0;
      if(!snapshots.has(idx))snapshots.set(idx,layoutRequest(value,idx));
      const it=snapshots.get(idx).items.find(it=>it.blockId===id);
      return it?(it.z0+it.z1)/2:0;
    };
    for(const b of branches){
      if(b.forkBlockId)positions[b.forkBlockId]=anchor(b.forkBlockId,b.fork);
      if(b.mergeBlockId)positions[b.mergeBlockId]=anchor(b.mergeBlockId,b.merge);
    }
    mainLength=positions.end;canal=canalWidth(mainLength);
    records=value.agents.filter(run=>run.session.requests.length).map(run=>{
      const branch=branches.find(b=>b.agentId===run.agentId);
      let cached=runLayouts.get(run.session);
      if(!cached){
        const maxima=new Map();
        run.session.requests.forEach((_,idx)=>{
          for(const it of layoutRequest(run.session,idx).items) {
            const old=maxima.get(it.blockId);
            if(!old || it.height*(it.z1-it.z0)>old.height*(old.z1-old.z0))maxima.set(it.blockId,it);
          }
        });
        cached={grid:districtGrid([...maxima.values()]),maximum:maxima,idx:-1,layout:null};
        runLayouts.set(run.session,cached);
      }
      const {grid,maximum}=cached;
      return {run,branch,grid,maximum,cached,agentId:run.agentId,width:grid.width,depth:grid.depth,
        forkZ:branch?anchor(branch.forkBlockId,branch.fork):0,
        mergeZ:branch?anchor(branch.mergeBlockId,branch.merge):0,state:'pending',idx:-1,pulse:-10};
    });
    const rects=districtLayout(positions,branches,records,canal);
    records=rects;
    [...records].sort((a,b)=>b.grid.cells.reduce((n,c)=>n+c.side*c.side*c.height,0)-a.grid.cells.reduce((n,c)=>n+c.side*c.side*c.height,0)).forEach((r,i)=>r.labelRank=i);
    const box=new THREE.BoxGeometry(1,1,1);
    const count=records.reduce((n,r)=>n+r.grid.cells.length,0);
    const geometry=box.clone();
    geometry.setAttribute('light',new THREE.InstancedBufferAttribute(new Float32Array(count),1));
    geometry.setAttribute('glassStart',new THREE.InstancedBufferAttribute(new Float32Array(count),1));
    geometry.setAttribute('tool',new THREE.InstancedBufferAttribute(new Float32Array(count),1));
    const material=facade(null,false,true);
    buildings=new THREE.InstancedMesh(geometry,material,Math.max(1,count));buildings.setColorAt(0,color.set('#ffffff'));buildings.count=count;buildings.frustumCulled=false;buildings.name='subagent-buildings';root.add(buildings);
    alerts=createFailureBeacons(Math.max(1,count));alerts.count=count;alerts.frustumCulled=false;alerts.name='subagent-failure-beacons';root.add(alerts);
    const padGeometry=box.clone();padGeometry.setAttribute('light',new THREE.InstancedBufferAttribute(new Float32Array(records.length),1));
    pads=new THREE.InstancedMesh(padGeometry,new THREE.ShaderMaterial({vertexColors:true,vertexShader:vertex,transparent:true,depthWrite:false,
      fragmentShader:`varying vec3 local,dim,tint,n;varying float lit;void main(){vec2 edge=(.5-abs(local.xz))*dim.xz;float rim=1.-smoothstep(.12,.45,min(edge.x,edge.y));vec2 g=abs(fract(local.xz*dim.xz/4.)-.5);float grid=step(.48,max(g.x,g.y));gl_FragColor=vec4(tint*rim*(.55+lit)+vec3(.07,.1,.15)*grid,rim*.7+.09);}`} ),records.length);
    pads.name='subagent-foundations';root.add(pads);
    let offset=0;
    records.forEach((r,i)=>{
      r.offset=offset;offset+=r.grid.cells.length;
      r.color=agentColor(r.run.agentType??runLabel(r.run));
      setMatrix(pads,i,r.y,.04,r.x,r.depth,.1,r.width);pads.setColorAt(i,color.set(r.color));
      r.box=new THREE.Box3(new THREE.Vector3(r.y-r.depth/2,0,r.x-r.width/2),new THREE.Vector3(r.y+r.depth/2,Math.max(24,...r.grid.cells.map(c=>c.height)),r.x+r.width/2));
    });
    const segments=[];
    records.forEach((r,ri)=>{
      if(!r.branch)return;
      for(const returning of [false,true]) {
        if(returning ? !r.branch.mergeBlockId : !r.branch.forkBlockId)continue;
        const start=new THREE.Vector3(returning?r.y: 3.5,.6,returning?r.x+2:r.forkZ);
        const end=new THREE.Vector3(returning?3.5:r.y,.6,returning?r.mergeZ:r.x-2);
        const steps=Math.max(24,Math.ceil(start.distanceTo(end)/6));
        const points=Array.from({length:steps+1},(_,i)=>{const t=i/steps;return start.clone().lerp(end,t).add(new THREE.Vector3(0,Math.sin(Math.PI*t)*Math.max(3,canal*.05),0));});
        for(let j=0;j<steps;j++)segments.push({ri,returning,t:(j+.5)/steps,half:1/(2*steps),middle:j===Math.floor(steps/2),a:points[j],b:points[j+1]});
      }
    });
    const bridgeGeo=box.clone();
    for(const name of ['light','progress','returning','pulse'])bridgeGeo.setAttribute(name,new THREE.InstancedBufferAttribute(new Float32Array(segments.length),1));
    const bridgeMat=new THREE.ShaderMaterial({vertexColors:true,uniforms:{time:{value:0},glow:{value:1},pixelScale:{value:0}},
      vertexShader:`uniform float pixelScale;attribute float light,progress,returning,pulse;varying vec3 tint;varying float strength,p,ret,at;void main(){tint=instanceColor;strength=light;p=progress;ret=returning;at=pulse;vec3 pos=position;vec4 center=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);float w=length(instanceMatrix[0].xyz);if(w>1.)pos.x*=max(1.,abs(center.z)*pixelScale/w);gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(pos,1.);}`,
      fragmentShader:`uniform float time,glow;varying vec3 tint;varying float strength,p,ret,at;void main(){float travel=exp(-pow((p-(time-at)/.8)*18.,2.))*step(time-at,.8)*step(0.,time-at)*ret;float breathing=(.5+.5*sin(time*1.8-p*6.))*(1.-ret)*step(.5,strength);gl_FragColor=vec4(tint*(.35+strength*1.5+glow*(breathing*.8+travel*8.)),1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`});
    decks=new THREE.InstancedMesh(bridgeGeo,bridgeMat,Math.max(1,segments.length));decks.setColorAt(0,color.set('#ffffff'));decks.count=segments.length;decks.frustumCulled=false;decks.name='subagent-bridges';decks.userData.segments=segments;root.add(decks);
    segments.forEach((s,i)=>{
      const delta=s.b.clone().sub(s.a),mid=s.a.clone().add(s.b).multiplyScalar(.5),r=records[s.ri];
      transform.position.copy(mid);transform.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),delta.clone().normalize());transform.scale.set(s.returning?districtBridgeWidth(r.branch.returnedTokens):2.45,.65,delta.length()+.03);transform.updateMatrix();decks.setMatrixAt(i,transform.matrix);decks.setColorAt(i,color.set(r.color));
      bridgeGeo.attributes.progress.setX(i,s.t);bridgeGeo.attributes.returning.setX(i,Number(s.returning));bridgeGeo.attributes.pulse.setX(i,-10);
    });
    // Bridge decks use one instanced box draw. Lamp posts use one Points draw.
    const lightGeo=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(new Float32Array(segments.length*6),3)).setAttribute('color',new THREE.BufferAttribute(new Float32Array(segments.length*6),3));
    lampLights=new THREE.Points(lightGeo,new THREE.ShaderMaterial({vertexColors:true,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,uniforms:{screenScale:{value:900}},vertexShader:'uniform float screenScale;varying vec3 tint;void main(){tint=color;vec4 p=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(1.8*screenScale/max(.1,-p.z),1.6,16.);gl_Position=projectionMatrix*p;}',fragmentShader:'varying vec3 tint;void main(){vec2 p=gl_PointCoord;float bulb=1.-smoothstep(.1,.23,length(p-vec2(.5,.2)));float stem=(1.-smoothstep(.035,.09,abs(p.x-.5)))*step(.2,p.y)*step(p.y,.95);gl_FragColor=vec4(tint*(.2+bulb*1.4),max(bulb,stem*.6));}'}));lampLights.frustumCulled=false;root.add(lampLights);
    beads=new THREE.InstancedMesh(new THREE.SphereGeometry(1,8,6),new THREE.MeshBasicMaterial({color:0xffffff}),records.length);
    beads.frustumCulled=false;beads.visible=false;root.add(beads);
    records.forEach((r,i)=>{beads.setColorAt(i,color.set(r.color).multiplyScalar(6));setMatrix(beads,i,0,0,0,0,0,0);});
    box.dispose();
    const min=Math.min(0,...records.map(r=>r.x-r.width/2))-14,max=Math.max(mainLength,...records.map(r=>r.x+r.width/2))+14;
    // Water, bank lights and additive window streaks share one instanced draw.
    const streaks=[];
    for(const r of records)for(const c of r.grid.cells.filter((_,i)=>i%3===0))streaks.push({r,c});
    const waterGeo=new THREE.PlaneGeometry(1,1);waterGeo.rotateX(-Math.PI/2);
    waterGeo.setAttribute('reflection',new THREE.InstancedBufferAttribute(new Float32Array(streaks.length+1),1));
    water=new THREE.InstancedMesh(waterGeo,new THREE.ShaderMaterial({side:THREE.DoubleSide,extensions:{derivatives:true},vertexColors:true,uniforms:{time:{value:0},ripples:{value:1},reflections:{value:1}},
      vertexShader:'attribute float reflection;varying vec2 v;varying vec3 tint;varying float reflected;void main(){v=uv;tint=instanceColor;reflected=reflection;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}',
      fragmentShader:`varying vec2 v;varying vec3 tint;varying float reflected;uniform float time,ripples,reflections;void main(){vec3 c=vec3(.008,.018,.032);if(reflected<.5){float bank=1.-smoothstep(0.,max(fwidth(v.x)*1.5,.001),min(v.x,1.-v.x));float wave=pow(.5+.5*sin(v.x*95.+sin(v.y*190.+time*.4)*2.+time*.6),18.)*ripples;c+=vec3(.35,.44,.48)*bank+vec3(.07,.16,.23)*wave*.09;}else{float a=pow(1.-abs(v.x-.5)*2.,2.)*(1.-v.y)*(.3+.7*pow(.5+.5*sin(v.y*110.-time*.35),8.));c+=tint*a*.14*reflections;}gl_FragColor=vec4(c,1.);}`}),streaks.length+1);
    water.name='subagent-canal';water.frustumCulled=false;water.renderOrder=1;water.userData.streaks=streaks;root.add(water);
    setMatrix(water,0,10+canal/2,.015,(min+max)/2,canal,1,max-min);water.setColorAt(0,color.set('#ffffff'));
    streaks.forEach(({r,c},i)=>{waterGeo.attributes.reflection.setX(i+1,1);setMatrix(water,i+1,10+canal*.64,.035,r.x+c.x-r.width/2,canal*.65,1,Math.max(.6,c.side*.5));water.setColorAt(i+1,color.set(colorFor(c.layer)));});
    group.visible=enabled;
  }
  function sync(idx,reduced=false,mainLayout=null,restore=false) {
    if(alerts)alerts.instanceMatrix.needsUpdate=true;
    if(!root)return;
    for(const r of records) {
      const next=r.branch?runState(r.branch,idx,session.requests[idx]?.time,r.run.session.requests):{state:'merged',idx:r.run.session.requests.length-1};
      if(!restore && r.branch && !r.branch.open && idx===r.branch.merge && idx===previous+1 && previous>=0) {r.pulse=reduced?-10:time;pulseCount++;}
      r.state=next.state;r.idx=next.idx;
      if(next.idx>=0 && r.cached.idx!==next.idx){r.cached.idx=next.idx;r.cached.layout=layoutRequest(r.run.session,next.idx);}
      const active=next.idx>=0?new Map(r.cached.layout.items.map(it=>[it.blockId,it])):new Map();
      r.active=active;
      const skyline=Math.max(0,...r.grid.cells.filter(cell=>active.has(cell.blockId)).map(cell=>cell.height));
      r.grid.cells.forEach((c,j)=>{
        const it=active.get(c.blockId),max=r.maximum.get(c.blockId);
        const factor=it?Math.sqrt(it.height*(it.z1-it.z0)/(max.height*(max.z1-max.z0)||1)):0;
        setMatrix(buildings,r.offset+j,r.y+c.y-r.depth/2,c.height/2,r.x+c.x-r.width/2,Math.max(0,c.side*factor),it?c.height:0,Math.max(0,c.side*factor));
        const pin=failurePin(c.height, skyline, !!it?.isError && factor>0 && next.state!=='pending');
        setMatrix(alerts,r.offset+j,r.y+c.y-r.depth/2,pin.base,r.x+c.x-r.width/2,pin.visible?1:0,pin.visible?pin.height:0,pin.visible?1:0);
        buildings.setColorAt(r.offset+j,color.set(colorFor(c.layer)));
        buildings.geometry.attributes.tool.setX(r.offset+j,c.kind==='tool_def'?1:0);
        const split=max.split,total=(split?.descTokens??0)+(split?.schemaTokens??0);buildings.geometry.attributes.glassStart.setX(r.offset+j,(total?split.descTokens/total:.5)-.5);
        buildings.geometry.attributes.light.setX(r.offset+j,next.state==='merged'?.75:1);
      });
    }
    buildings.instanceMatrix.needsUpdate=true;buildings.instanceColor.needsUpdate=true;buildings.geometry.attributes.light.needsUpdate=buildings.geometry.attributes.tool.needsUpdate=buildings.geometry.attributes.glassStart.needsUpdate=true;
    water.userData.streaks.forEach(({r,c},i)=>water.setColorAt(i+1,color.set(colorFor(c.layer)).multiplyScalar(!r.active.has(c.blockId)?0:r.state==='merged'?.75:1)));
    water.instanceColor.needsUpdate=true;
    const anchors=new Map((mainLayout?.items??[]).map(it=>[it.blockId,(it.z0+it.z1)/2]));
    decks.userData.segments.forEach((s,i)=>{
      const r=records[s.ri];
      const fork=anchors.get(r.branch.forkBlockId)??r.forkZ,merge=anchors.get(r.branch.mergeBlockId)??r.mergeZ;
      const start=new THREE.Vector3(s.returning?r.y-r.depth/2:3.5,.6,s.returning?r.x+r.width*.2:fork);
      const end=new THREE.Vector3(s.returning?3.5:r.y-r.depth/2,.6,s.returning?merge:r.x-r.width*.2);
      const point=t=>start.clone().lerp(end,t).add(new THREE.Vector3(0,Math.sin(Math.PI*t)*Math.max(3,canal*.05),0));
      const a=point(s.t-s.half),b=point(s.t+s.half),delta=b.clone().sub(a);
      transform.position.copy(a).add(b).multiplyScalar(.5);transform.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),delta.clone().normalize());
      transform.scale.set(s.returning?districtBridgeWidth(r.branch.returnedTokens):2.45,.65,delta.length()+.03);
      if(r.state==='pending')transform.scale.setScalar(0);
      transform.updateMatrix();decks.setMatrixAt(i,transform.matrix);
      if(s.returning){r.returnStart=start;r.returnEnd=end;}
      const width=s.returning?districtBridgeWidth(r.branch.returnedTokens):2.45;
      for(let side=0;side<2;side++){
        const across=new THREE.Vector3(delta.z,0,-delta.x).normalize().multiplyScalar((side-.5)*(width+.3));
        const p=a.clone().add(b).multiplyScalar(.5).add(across);

        lampLights.geometry.attributes.position.setXYZ(i*2+side,p.x,p.y+.85,p.z);
        color.set(r.color).multiplyScalar(r.state==='pending'?0:2);lampLights.geometry.attributes.color.setXYZ(i*2+side,color.r,color.g,color.b);
      }
      decks.geometry.attributes.light.setX(i,r.state==='pending'?.04:r.state==='merged'?.32:1);decks.geometry.attributes.pulse.setX(i,r.pulse);
    });
    decks.instanceMatrix.needsUpdate=true;decks.instanceColor.needsUpdate=true;decks.geometry.attributes.progress.needsUpdate=decks.geometry.attributes.returning.needsUpdate=true;
    lampLights.geometry.attributes.position.needsUpdate=lampLights.geometry.attributes.color.needsUpdate=true;
    decks.geometry.attributes.light.needsUpdate=decks.geometry.attributes.pulse.needsUpdate=true;
    previous=idx;
  }
  function highlight(id) {
    hovered=id;
    if(!pads)return;
    records.forEach((r,i)=>pads.geometry.attributes.light.setX(i,r.agentId===id?1:0));pads.geometry.attributes.light.needsUpdate=true;
  }
  return {group,load,sync,highlight,
    setVisible(v){enabled=v;group.visible=v;highlight(null);},
    labels:(metropolis=false)=>enabled?records.filter(r=>!metropolis||r.labelRank<6||r.agentId===hovered).map(r=>({label:runLabel(r.run,session.agents),layer:null,agent:true,agentId:r.agentId,x:r.y,color:r.color,metropolis,labelHeight:Math.max(10,...r.grid.cells.map(c=>c.height))+4,z0:r.x,z1:r.x,hovered:r.agentId===hovered})):[],
    bounds(layout){return metropolisBounds(layout,records);},
    points(existingOnly=false){
      const points=[];
      const corners=(x0,x1,z0,z1,high)=>{for(const x of [x0,x1])for(const z of [z0,z1])for(const y of [0,high])points.push(new THREE.Vector3(x,y,z));};
      for(const r of records){
        if(existingOnly && r.state==='pending')continue;
        if(!existingOnly)corners(r.y-r.depth/2,r.y+r.depth/2,r.x-r.width/2,r.x+r.width/2,.1);
        for(const c of r.grid.cells){
          const it=r.active?.get(c.blockId);if(!it)continue;
          const max=r.maximum.get(c.blockId),factor=Math.sqrt(it.height*(it.z1-it.z0)/(max.height*(max.z1-max.z0)||1));
          const x=r.y+c.y-r.depth/2,z=r.x+c.x-r.width/2,half=c.side*factor/2;
          corners(x-half,x+half,z-half,z+half,c.height);
        }
      }
      if(existingOnly && decks){
        const m=new THREE.Matrix4();
        decks.userData.segments.forEach((s,i)=>{
          if(records[s.ri].state==='pending')return;
          decks.getMatrixAt(i,m);
          for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5])
            points.push(new THREE.Vector3(x,y,z).applyMatrix4(m));
        });
      }
      return points;
    },
    view(id){const r=records.find(r=>r.agentId===id);return r?{position:new THREE.Vector3(r.y-r.depth,Math.max(40,r.width,...r.grid.cells.map(c=>c.height))*1.1,r.x-r.width),target:new THREE.Vector3(r.y,Math.max(6,...r.grid.cells.map(c=>c.height))*.4,r.x)}:null;},
    bridgePoints(){if(!decks)return [];const m=new THREE.Matrix4();return decks.userData.segments.filter(s=>s.middle).map(s=>{const i=decks.userData.segments.indexOf(s);decks.getMatrixAt(i,m);return new THREE.Vector3().setFromMatrixPosition(m);});},
    pick(ray){
      if(!enabled||!root||!group.visible)return null;
      const hit=new THREE.Vector3();let best=null,distance=Infinity;
      for(const r of records)if(ray.ray.intersectBox(r.box,hit)){const d=hit.distanceTo(ray.ray.origin);if(d<distance){distance=d;best=r;}}
      if(best)return {userData:{agentId:best.agentId,tooltip:best.branch?agentBranchLabel(best.branch):runLabel(best.run,session.agents)}};
      const bridge=ray.intersectObject(decks)[0];
      if(bridge){const segment=decks.userData.segments[bridge.instanceId%decks.userData.segments.length],r=records[segment.ri],b=r.branch;return {userData:{bridge:true,tooltip:b.open?'Has not returned yet':!segment.returning?'Started this subagent run':`Returned ${b.returnedTokens.toLocaleString('en-US')} tokens to the main context, kept ${Math.max(0,b.peak-b.returnedTokens).toLocaleString('en-US')} out (${b.delegation==null?'unavailable':b.delegation.toFixed(1)+'x'})`}};}
      return null;
    },
    tick(dt,reduced,low,visible,camera,height){group.visible=enabled&&visible;if(!root||!group.visible)return;time+=reduced?0:dt;decks.material.uniforms.pixelScale.value=2*Math.tan(camera.fov*Math.PI/360)/height*2.5;lampLights.visible=!low;lampLights.material.uniforms.screenScale.value=height/(2*Math.tan(camera.fov*Math.PI/360));
      let active=false;records.forEach((r,i)=>{const t=(time-r.pulse)/.8,show=!reduced&&t>=0&&t<1&&r.returnStart;active||=!!show;if(show){transform.position.lerpVectors(r.returnStart,r.returnEnd,t);transform.position.y+=Math.sin(Math.PI*t)*Math.max(3,canal*.05)+.5;transform.rotation.set(0,0,0);transform.scale.setScalar(Math.max(.9,districtBridgeWidth(r.branch.returnedTokens)*.23,camera.position.distanceTo(transform.position)*decks.material.uniforms.pixelScale.value*.8));transform.updateMatrix();beads.setMatrixAt(i,transform.matrix);}else setMatrix(beads,i,0,0,0,0,0,0);});beads.visible=active;if(active)beads.instanceMatrix.needsUpdate=true;
      buildings.material.uniforms.time.value=time;water.material.uniforms.reflections.value=low?0:1;water.material.uniforms.time.value=time;water.material.uniforms.ripples.value=low||reduced?0:1;decks.material.uniforms.time.value=time;decks.material.uniforms.glow.value=low?0:1;},
    stats:()=>({canalWidth:canal,mainLength,maxFootprint:Math.max(0,...records.flatMap(r=>r.grid.cells.map(c=>c.side))),maxHeight:Math.max(0,...records.flatMap(r=>r.grid.cells.map(c=>c.height))),districts:records.length,bridges:records.reduce((n,r)=>n+(r.branch?.forkBlockId?1:0)+(r.branch?.mergeBlockId?1:0),0),buildings:buildings?.count??0,pulses:pulseCount,activePulses:records.filter(r=>time-r.pulse>=0&&time-r.pulse<.8).length,ripples:water?.material.uniforms.ripples.value??0,glow:decks?.material.uniforms.glow.value??0,visible:enabled,states:records.map(r=>({agentId:r.agentId,state:r.state,idx:r.idx})),rects:records.map(({x,y,width,depth,lane})=>({x,y,width,depth,lane}))}),
    dispose(){clear();group.removeFromParent();},
  };
}
