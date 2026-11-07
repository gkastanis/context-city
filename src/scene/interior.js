import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { colorFor, LAYERS } from './theme.js';
import { disposeTree } from './dispose.js';
import { textPage, pageMeasure, pageFonts } from './labels.js';
import { chunkPages, hallPage, HALL_BLOCKS, pagePlacement, portalCrossing, galleryTokens, tokenRuler, prettyJson } from './paging.js';

// Crossing is tested in the door's own coordinates, independent of orientation.
export function crossesDoor(door, previous, next) {
  return portalCrossing(door.worldToLocal(previous.clone()), door.worldToLocal(next.clone()));
}

export function createInterior(navigate, reducedMotion = () => false, renderer = null) {
  const group = new THREE.Group();
  let view = null, glide = null, doorSignature = null, blockSignature = null, quality = 'high', time = 0, activeSession = null, activeLayout = null;
  const options = { quality: () => quality, anisotropy: renderer?.capabilities.getMaxAnisotropy() ?? 1 };
  const portalMaterials = new Set();
  const sheet = (...args) => textPage(...args, options);
  const doorGroup = new THREE.Group(); group.add(doorGroup);
  let doors = [], pages = [], length = 10, yaw = Math.PI, pitch = 0, pos = new THREE.Vector3(0, 1.7, 0);
  function clearDoors() {
    const panels = new Set(); doorGroup.traverse(o => { if (o.userData.buildTexture) panels.add(o); });
    pages = pages.filter(p => !panels.has(p));
    doorGroup.traverse(o=>{if(o.isInstancedMesh)o.dispose();});
    for (const c of [...doorGroup.children]) disposeTree(c); doors = []; portalMaterials.clear();
  }
  function clear() { group.traverse(o=>{if(o.isInstancedMesh && !doorGroup.children.includes(o.parent))o.dispose();}); clearDoors(); for (const c of [...group.children]) if (c !== doorGroup) disposeTree(c); pages = []; numberObjects = []; blockSignature = null; view = null; glide = null; doorSignature = null; }
  function door(label, x, z, rotation, action, color = colorFor(group.userData.layer ?? 'tools'), detail = 'Walk through or click') {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotation;
    const stone = new THREE.MeshStandardMaterial({ color: '#c8c5bb', roughness: .4, metalness: .15 });
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const parts = new THREE.InstancedMesh(geometry, stone, 3), dummy = new THREE.Object3D();
    [[-1.85, 1.95, 0, .4, 3.9, .7], [1.85, 1.95, 0, .4, 3.9, .7], [0, 4.05, 0, 4.1, .4, .7]].forEach((v, i) => {
      dummy.position.set(...v.slice(0,3)); dummy.scale.set(...v.slice(3)); dummy.updateMatrix(); parts.setMatrixAt(i, dummy.matrix);
    }); g.add(parts);
    const mat = new THREE.ShaderMaterial({ uniforms: { tint: { value: new THREE.Color(color) }, time: { value: time } },
      side: THREE.DoubleSide, transparent: true, depthWrite: false,
      vertexShader: 'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec2 v;uniform vec3 tint;uniform float time;
        void main(){float wave=.5+.5*sin(v.y*5.-time*.45+sin(v.x*6.+time*.2));
        vec3 c=mix(vec3(.10,.19,.25),tint,.3+wave*.6);float edge=pow(abs(v.x-.5)*2.,8.);
        gl_FragColor=vec4(c+edge*.22,.92);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }` });
    portalMaterials.add(mat);
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 3.8), mat); surface.position.y = 1.9; g.add(surface);
    const panel = sheet(label, detail, [], color, true); pages.push(panel);
    panel.position.set(0, 4.95, .38); g.add(panel);
    g.traverse(o => { o.userData.action = action; });
    doorGroup.add(g); doors.push(g);
  }
  function finish() {
    const tint = new THREE.Color(colorFor(group.userData.layer ?? 'tools'));
    const wallMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color('#e5e2d8').lerp(tint, .09), roughness: .65 });
    const box = new THREE.BoxGeometry(1,1,1);
    function solid(x,y,z,w,h,d,mat) { const m=new THREE.Mesh(box,mat);m.position.set(x,y,z);m.scale.set(w,h,d);group.add(m);return m; }
    const floor = solid(0,-.09,length/2,12.2,.16,length+12,new THREE.MeshStandardMaterial({color:'#a8b2b2',roughness:.22,metalness:.25})); floor.userData.floor=true;
    for(const z of [-3.4,length+.4]) {
      for(const x of [-4.1,4.1])solid(x,3.3,z,4,6.6,.2,wallMaterial).userData.endWall=z>0?'far':'near';
      solid(0,6,z,4.2,1.2,.2,wallMaterial).userData.endWall=z>0?'far':'near';
    }
    for (const x of [-6.1,6.1]) { const wall=solid(x,3.3,length/2,.15,6.6,length+12,wallMaterial);wall.userData.wall=true; }
    solid(0,6.6,length/2,12.2,.15,length+12,wallMaterial).userData.ceiling=true;
    const runner = new THREE.Mesh(new THREE.PlaneGeometry(3.5,length+10),new THREE.ShaderMaterial({
      uniforms:{tint:{value:tint}},vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:`varying vec2 v;uniform vec3 tint;void main(){float soft=smoothstep(0.,.16,v.x)*smoothstep(0.,.16,1.-v.x);gl_FragColor=vec4(mix(vec3(.29,.37,.38),tint,.14),soft*.65);}`,
      transparent:true,depthWrite:false }));runner.rotation.x=-Math.PI/2;runner.position.set(0,.005,length/2);runner.userData.runner=true;group.add(runner);
    group.add(new THREE.HemisphereLight('#fff8e8','#adbfc6',1.8));
    for(const z of [0,length/2,length]){const light=new THREE.PointLight('#fff3d9',35,24,2);light.position.set(0,5.8,z);group.add(light);}
    const strips = new THREE.InstancedMesh(box,new THREE.MeshBasicMaterial({color:'#fff9e5',toneMapped:false}),quality==='high'?4:2);
    const dummy=new THREE.Object3D();
    for(let i=0;i<strips.count;i++){dummy.position.set(quality==='high'?[-4.2,-2.8,2.8,4.2][i]:(i%2?-3.4:3.4),6.48,length/2);dummy.scale.set(i<2?.16:.06,.04,length+9);dummy.updateMatrix();strips.setMatrixAt(i,dummy.matrix);}group.add(strips);
    pos.set(0,1.7,0);yaw=Math.PI;pitch=0;group.updateMatrixWorld(true);
  }
  // Small floor label: its own 256x64 canvas, not a full sheet texture.
  function rulerLabel(text) {
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;
    const ctx=canvas.getContext('2d');ctx.font='500 30px "IBM Plex Mono", monospace';ctx.fillStyle='#3d4c50';ctx.textBaseline='middle';ctx.fillText(text,8,32,240);
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(1.2,.3),new THREE.MeshBasicMaterial({map,transparent:true,depthWrite:false,toneMapped:false}));
  }
  // Plaque and ruler depend only on the block's token numbers; they are rebuilt alone when those change.
  let numberObjects=[];
  function addNumbers(b,item,index,layout,session) {
    const color=colorFor(b.layer);
    const plaque=sheet(b.label, `${LAYERS[b.layer]?.label ?? b.layer}, ${galleryTokens((item.z1-item.z0)*100)} tokens`,
      [`Block ${index+1} of ${layout.items.length}`, `Starts at ${galleryTokens(item.z0*100)} of ${galleryTokens(session.meta.window)} tokens`, '', 'Walk to explore. Click a sheet to read.', 'Walk through a portal to continue.'],color,false);
    // Hung overhead in the middle of the hall, facing the entrance, so it is the first thing seen.
    plaque.scale.setScalar(.65);plaque.position.set(0,4.1,9);plaque.rotation.y=Math.PI;group.add(plaque);pages.push(plaque);
    const marks=tokenRuler(item.z0*100,(item.z1-item.z0)*100,length,quality==='high'?8:4);
    const ticks=new THREE.InstancedMesh(new THREE.BoxGeometry(.65,.012,.045),new THREE.MeshBasicMaterial({color:'#53666a'}),marks.length);
    const dummy=new THREE.Object3D();numberObjects=[plaque,ticks];
    marks.forEach((mark,i)=>{dummy.position.set(1.15,.018,mark.z);dummy.updateMatrix();ticks.setMatrixAt(i,dummy.matrix);
      // Readable for someone walking in (facing +z).
      const label=rulerLabel(galleryTokens(mark.token)+' tokens');label.rotation.set(-Math.PI/2,0,Math.PI);label.position.set(2.1,.025,mark.z);group.add(label);numberObjects.push(label);
    });group.add(ticks);
    blockSignature=JSON.stringify([item.z0,item.z1,index,layout.items.length,session.meta.window]);
  }
  function refreshNumbers(session,layout,id) {
    const old=new Set(numberObjects);pages=pages.filter(p=>!old.has(p));for(const o of numberObjects){if(o.isInstancedMesh)o.dispose();disposeTree(o);}numberObjects=[];
    const index=layout.items.findIndex(it=>it.blockId===id);
    addNumbers(session.blocks[id],layout.items[index],index,layout,session);group.updateMatrixWorld(true);
  }
  function buildBlock(session, layout, id) {
    activeLayout=layout;
    clear(); view = { kind: 'block', id };
    activeSession = session; group.userData.layer=session.blocks[id].layer;
    const b = session.blocks[id], color = colorFor(b.layer);
    const text = b.text ?? `[Text unavailable. ${b.chars} characters, ${b.estTokens} estimated tokens]`;
    // Pack parameter descriptions together, and stop wrapping after the budget.
    const params = (b.params ?? []).map(p => `${p.name} (${p.type ?? 'unknown'}, ${p.required ? 'required' : 'optional'})\n${p.description ?? 'Description unavailable.'}`).join('\n\n');
    const chunks = chunkPages(prettyJson(text) + (params ? '\n\nParameters\n' + params : ''), pageMeasure(), 920);
    chunks.forEach((page, i) => {
      const mesh = sheet(b.label, `${b.provenance}, page ${i + 1} of ${chunks.length}`, page, color, false);
      const placement = pagePlacement(i), angle = placement.rotation;
      mesh.position.set(placement.x, placement.y, placement.z);
      mesh.rotation.y = angle;
      mesh.userData.action = () => {
        const destination = new THREE.Vector3(mesh.position.x + Math.sin(angle) * 6.5, 1.7, mesh.position.z + Math.cos(angle) * 6.5);
        const targetYaw = yaw + Math.atan2(Math.sin(angle - yaw), Math.cos(angle - yaw));
        glide = { from: pos.clone(), to: destination, yaw0: yaw, yaw1: targetYaw, pitch0: pitch, pitch1: Math.atan2(.95, 6.5), elapsed: 0 };
        if (reducedMotion()) tick(0.4);
      };
      group.add(mesh); pages.push(mesh);
    });
    length = 16 + chunks.length * 7;
    const index=layout.items.findIndex(it=>it.blockId===id),item=layout.items[index];
    if(quality==='high') {
      const poolMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,
        vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader:'varying vec2 v;void main(){float a=exp(-dot((v-.5)*3.,(v-.5)*3.));gl_FragColor=vec4(.28,.23,.15,a*.22);}' });
      const geometry=new THREE.PlaneGeometry(6.7,4.4);
      for(let i=0;i<chunks.length;i++){const p=pagePlacement(i),pool=new THREE.Mesh(geometry,poolMaterial);pool.position.set(p.x+Math.sign(p.x)*.1,p.y,p.z);pool.rotation.y=p.rotation;group.add(pool);}
    }
    blockDoors(layout, id);
    finish(); addNumbers(b,item,index,layout,session);
  }
  function blockDoors(layout, id) {
    const index = layout.items.findIndex(it => it.blockId === id);
    const signature = JSON.stringify([layout.items[index - 1], layout.items[index + 1]]);
    if (signature === doorSignature) return;
    clearDoors(); doorSignature = signature;
    const destination = (item, prefix) => `${prefix}: ${activeSession.blocks[item.blockId].label}`;
    const detail = item => `${galleryTokens((item.z1-item.z0)*100)} tokens, ${LAYERS[item.layer]?.label ?? item.layer}`;
    if (index > 0) door(destination(layout.items[index - 1], 'Previous'), 0, -3, 0, () => navigate('block', layout.items[index - 1].blockId), colorFor(layout.items[index - 1].layer), detail(layout.items[index - 1]));
    else door('City', 0, -3, 0, () => navigate('exit'));
    if (index < layout.items.length - 1) door(destination(layout.items[index + 1], 'Next'), 0, length, Math.PI, () => navigate('block', layout.items[index + 1].blockId), colorFor(layout.items[index + 1].layer), detail(layout.items[index + 1]));
    else door('City', 0, length, Math.PI, () => navigate('exit'));
    group.updateMatrixWorld(true);
  }
  function buildDistrict(session, layout, i, page = 0) {
    activeLayout=layout;activeSession=session;
    clear(); group.userData.layer = layout.districts[i].layer;
    districtDoors(session, layout, i, page);
    finish();
  }
  function districtDoors(session, layout, i, requested) {
    const d = layout.districts[i], { ids, page, more, back } = hallPage(d.blockIds, requested);
    const signature = JSON.stringify([i, page, ids.map(id=>layout.items.find(it=>it.blockId===id)), layout.districts[i - 1]?.blockIds[0], layout.districts[i + 1]?.blockIds[0], more, back]);
    view = { kind: 'district', id: ids[0], ids, district: i, page };
    if (signature === doorSignature) return;
    clearDoors(); doorSignature = signature;
    ids.forEach((id, j) => door(session.blocks[id].label, j % 2 ? 4 : -4, 5 + j * 5,
      j % 2 ? -Math.PI / 2 : Math.PI / 2, () => navigate('block', id), colorFor(session.blocks[id].layer), `${galleryTokens((layout.items.find(it=>it.blockId===id).z1-layout.items.find(it=>it.blockId===id).z0)*100)} tokens, ${LAYERS[session.blocks[id].layer]?.label ?? session.blocks[id].layer}`));
    length = 10 + ids.length * 5;
    door(back ? 'Back' : i ? 'Previous district' : 'City', 0, -3, 0,
      () => back ? navigate('district', i, page - 1) : i ? navigate('district', i - 1) : navigate('exit'));
    door(more ? 'More' : i + 1 < layout.districts.length ? 'Next district' : 'City', 0, length, Math.PI,
      () => more ? navigate('district', i, page + 1) : i + 1 < layout.districts.length ? navigate('district', i + 1) : navigate('exit'));
    const floor = group.children.find(c => c.userData.floor);
    if (floor) { floor.scale.z = length + 12; floor.position.z = length / 2; }
    for(const wall of group.children.filter(c=>c.userData.wall)){wall.scale.z=length+12;wall.position.z=length/2;}
    for(const m of group.children.filter(c=>c.userData.endWall==='far'))m.position.z=length+.4;
    for(const m of group.children.filter(c=>c.userData.ceiling)){m.scale.z=length+12;m.position.z=length/2;}
    const runner=group.children.find(c=>c.userData.runner);if(runner){runner.scale.y=(length+10)/runner.geometry.parameters.height;runner.position.z=length/2;}
    group.updateMatrixWorld(true);
  }
  function tick(dt) {
    time += reducedMotion() ? 0 : dt; for(const m of portalMaterials)m.uniforms.time.value=time;
    if (!glide) return;
    glide.elapsed += dt;
    const t = reducedMotion() ? 1 : Math.min(1, glide.elapsed / 0.4), k = t * t * (3 - 2 * t);
    pos.lerpVectors(glide.from, glide.to, k);
    yaw = glide.yaw0 + (glide.yaw1 - glide.yaw0) * k; pitch = glide.pitch0 + (glide.pitch1 - glide.pitch0) * k;
    if (t === 1) glide = null;
  }
  const world = new THREE.Vector3();
  function updateTextures() {
    group.updateMatrixWorld(true);
    for (const mesh of pages) {
      mesh.getWorldPosition(world); const distance = world.distanceTo(pos), mat = mesh.material;
      if (!mat.map && distance <= 30) {
        mat.map = mesh.userData.buildTexture(); if(mat.map){mat.color.set('#ffffff'); mat.needsUpdate = true;}
      } else if (mat.map && distance > 60) {
        mat.map.dispose(); mat.map = null; mat.color.set('#f3f0e8'); mat.needsUpdate = true;
      }
    }
  }
  // Reflow after fonts settle, without a delayed navigation or camera change.
  pageFonts.then(() => { if(view?.kind==='block') { const saved=pos.clone(), y=yaw, p=pitch; const id=view.id;
    buildBlock(activeSession, activeLayout, id);pos.copy(saved);yaw=y;pitch=p; } });
  return { group, clear,
    buildBlock(session,layout,id){activeLayout=layout;buildBlock(session,layout,id);}, buildDistrict,
    setQuality(level) {
      if(quality===level)return;quality=level;
      if(!view)return;
      const saved=pos.clone(),y=yaw,p=pitch,current={...view};
      if(current.kind==='block')buildBlock(activeSession,activeLayout,current.id);
      else buildDistrict(activeSession,activeLayout,current.district,current.page);
      pos.copy(saved);yaw=y;pitch=p;
    },
    rebuild(session, layout) {
      if (!view) return false; activeLayout=layout; activeSession=session;
      if (view.kind === 'block') {
        if (!layout.items.some(it => it.blockId === view.id)) return false;
        const index=layout.items.findIndex(it=>it.blockId===view.id),item=layout.items[index];
        // Token numbers move on most request steps; only the plaque and ruler depend on them.
        if(blockSignature!==JSON.stringify([item.z0,item.z1,index,layout.items.length,session.meta.window])) refreshNumbers(session,layout,view.id);
        blockDoors(layout, view.id);
      } else {
        const anchors = new Set(view.ids);
        const i = layout.districts.findIndex(d => d.blockIds.some(id => anchors.has(id)));
        if (i < 0) return false;
        const anchor = layout.districts[i].blockIds.findIndex(id => anchors.has(id));
        const page = Math.floor(anchor / HALL_BLOCKS);
        const newLength=10+hallPage(layout.districts[i].blockIds,page).ids.length*5;
        if(newLength!==length){const saved=pos.clone(),y=yaw,p=pitch;buildDistrict(session,layout,i,page);pos.copy(saved);yaw=y;pitch=p;}
        else districtDoors(session, layout, i, page);
      }
      pos.z = THREE.MathUtils.clamp(pos.z, -5, length + 2);
      return { ...(view.kind === 'block' ? { blockId: view.id } : { district: view.district, page: view.page }) };
    },
    getView: () => view && { ...view },
    tick,
    look(dx, dy) { glide = null; yaw -= dx * 0.005; pitch = THREE.MathUtils.clamp(pitch - dy * 0.004, -1.2, 1.2); },
    move(forward, right) {
      glide = null; const previous = pos.clone();
      const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), r = new THREE.Vector3(-f.z, 0, f.x);
      pos.addScaledVector(f, forward).addScaledVector(r, right);
      pos.x = THREE.MathUtils.clamp(pos.x, -5, 5); pos.z = THREE.MathUtils.clamp(pos.z, -5, length + 2);
      // Outside a portal opening the end walls are solid (walls at z -3.4 and length + 0.4).
      if (Math.abs(pos.x) > 1.65) pos.z = THREE.MathUtils.clamp(pos.z, -3.05, length + .05);
      for (const d of doors) if (crossesDoor(d, previous, pos)) { d.userData.action(); return true; }
      return false;
    },
    applyCamera(camera) { updateTextures(); camera.position.copy(pos); camera.rotation.set(pitch, yaw, 0, 'YXZ'); },
    dispose() { clear(); group.removeFromParent(); },
  };
}
