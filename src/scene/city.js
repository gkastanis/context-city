import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { colorFor, THEME } from './theme.js';
import { failurePin, districtSkylines } from './failure-model.js';

// A single shader per layer: window cells and silhouette edges need no extra meshes,
// textures or per-block uniforms. Instance transforms supply the real facade scale.
function toolSeed(id) {
  let value = 7;
  for (let i=0;i<id.length;i++) value=(value*31+id.charCodeAt(i))>>>0;
  return value/4294967295;
}
export function facade(layer, glass = false, district = false) {
  return new THREE.ShaderMaterial({ fog: true, uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), recentStart: {value:0}, recentSpan:{value:1}, tint: { value: new THREE.Color(colorFor(layer)) }, time: { value: 0 } },
    transparent: glass, depthWrite: !glass, extensions: { derivatives: true },
    vertexShader: `${district ? 'attribute float light, tool, glassStart; varying vec3 districtTint; varying float districtLight, districtTool, districtGlass;' : ''}
varying vec3 local, dimensions, normalV; varying float fresh, seed, roadZ;
#include <fog_pars_vertex>
      void main(){local=position;normalV=normal;dimensions=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
      seed=instanceMatrix[3].z*.17;fresh=1.;
#ifdef USE_INSTANCING_COLOR
fresh=instanceColor.r;seed=instanceColor.g*100.;
#endif
      ${district ? 'districtTint=instanceColor;districtLight=light;districtTool=tool;districtGlass=glassStart;fresh=.35;seed=instanceMatrix[3].z*.17+instanceMatrix[3].x*.31;' : ''}
      roadZ=instanceMatrix[3].z;vec4 mvPosition=modelViewMatrix*instanceMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
#include <fog_vertex>
}`,
    fragmentShader: `${district ? 'varying vec3 districtTint; varying float districtLight, districtTool, districtGlass;' : ''}
uniform vec3 tint;uniform float time,recentStart,recentSpan;varying vec3 local,dimensions,normalV;varying float fresh, seed, roadZ;
#include <fog_pars_fragment>
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      void main(){vec2 uv=vec2(abs(normalV.x)>.5?local.z*dimensions.z:local.x*dimensions.x,local.y*dimensions.y);
        float pixel=max(fwidth(uv.x),fwidth(uv.y));
        float lod=exp2(max(0.,ceil(log2(max(1.,pixel*3.)))));
        vec2 grid=uv*vec2(.65,.85)/lod;
        vec2 cell=floor(grid);vec2 f=fract(grid);
        float lit=step(.34,hash(cell+seed));float win=step(.18,f.x)*step(f.x,.74)*step(.22,f.y)*step(f.y,.68)*lit;

        win*=1.-step(.5,abs(normalV.y));
        vec3 edge=step(vec3(.485),abs(local));float outline=step(1.5,edge.x+edge.y+edge.z);
        float flicker=.94+.06*sin(time*.7+hash(cell+seed)*40.);
        vec3 tone=${district ? 'districtTint' : 'tint'};
        ${district ? 'if(districtTool>.5){tone=mix(tone,vec3(.12,.32,.9),.36*hash(vec2(seed,1.)));tone*=.82+.35*hash(vec2(seed,2.));}tone=mix(vec3(dot(tone,vec3(.21,.72,.07))),tone,.88)*districtLight;' : ''}
        ${layer === 'tools' ? 'tone=mix(tint,vec3(.12,.32,.9),.36*hash(vec2(seed,1.)));tone*=.82+.35*hash(vec2(seed,2.));' : ''}
        vec3 c=tone*(.09+win*(1.05+fresh*.35)*flicker+outline*.9);
        if(abs(normalV.y)>.5)c=tone*(.1+outline*1.0);
        ${district ? 'if(districtTool>.5&&local.y>districtGlass)c=tone*(.025+win*1.2+outline*1.6);' : ''}
        ${glass ? 'c=tone*(.025+win*1.2+outline*1.6);' : ''}
        gl_FragColor=vec4(c,${glass ? '.72' : '1.'});
#include <tonemapping_fragment>
#include <colorspace_fragment>
float fogFactor=1.-exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
 // Retain facade structure in the distance instead of filling it with fog.
 float age=${district ? '0.' : '1.-smoothstep(recentStart-recentSpan*.65,recentStart,roadZ)'};
 float haze=clamp(fogFactor,0.,.68);
 vec3 sky=fogColor*.24;
 vec3 faded=mix(gl_FragColor.rgb,vec3(dot(gl_FragColor.rgb,vec3(.21,.72,.07)))*.4+sky,.72*age);
 gl_FragColor.rgb=mix(faded*(1.-age*.58),sky,min(.7,haze*.6+age*.24))+sky*(win*.14+outline*.18);
}`,
  });
}

// Two screen-sized quads per instance: a narrow depth-tested stem and a red cap.
export function createFailureBeacons(capacity) {
  const viewport = new THREE.Vector2(1440, 900);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -.5,0,0, .5,0,0, .5,1,0, -.5,1,0,
    -.5,-.5,1, .5,-.5,1, .5,.5,1, -.5,.5,1,
  ], 3));
  geometry.setIndex([0,1,2,0,2,3,4,5,6,4,6,7]);
  const material = new THREE.ShaderMaterial({ depthTest: true, depthWrite: false, transparent: true,
    uniforms: { viewport: { value: viewport } },
    vertexShader: `uniform vec2 viewport; varying vec2 v; varying float cap;
      void main(){cap=position.z;v=position.xy;
      vec4 p=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(0.,cap>.5?1.:position.y,0.,1.);
      if(cap>.5)p.xy+=position.xy*p.w*14./viewport;
      else p.x+=position.x*p.w*2.5/viewport.x;
      if(length(instanceMatrix[0].xyz)==0.)p=vec4(2.,2.,2.,1.);gl_Position=p;}`,
    fragmentShader: `varying vec2 v;varying float cap;void main(){float alpha=.72;
      if(cap>.5){float d=length(v);if(d>.5)discard;alpha=1.-smoothstep(.32,.5,d);}
      gl_FragColor=vec4(1.,.08,.12,alpha);}` });
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.frustumCulled = false; mesh.renderOrder = 4;
  mesh.onBeforeRender = renderer => renderer.getSize(viewport);
  return mesh;
}

export function createCity() {
  const group = new THREE.Group(), buildings = new Map(), batches = new Map();
  // City owns these resources. Removing an instance never disposes shared assets.
  const box = new THREE.BoxGeometry(1, 1, 1), beam = new THREE.CylinderGeometry(0.12, 0.12, 22, 8, 1, true);
  const ring = new THREE.RingGeometry(1.2, 1.8, 24); ring.rotateX(-Math.PI / 2);
  const road = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color('#b9dfff').multiplyScalar(2) }));
  group.add(road);
  const selection = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: THEME.ink, wireframe: true }));
  selection.visible = false; group.add(selection);
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
  const color = new THREE.Color(), hit = new THREE.Vector3(), bounds = new THREE.Box3();
  let selected = null, items = [], hidden = new Set(), falling = [], moving = false, time = 0;
  function batch(layer, part, count) {
    const key = `${layer}:${part}`;
    let b = batches.get(key);
    if (!b) {
      const material = part === 'failure' ? new THREE.MeshBasicMaterial({ color: '#ff3038', toneMapped: false }) : ['beam', 'ring'].includes(part) ? new THREE.MeshBasicMaterial({ color: colorFor(layer), transparent: true,
        opacity: part === 'ring' ? .4 : .24, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }) : part === 'pool' ? new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{tint:{value:new THREE.Color(colorFor(layer))}},vertexShader:'varying vec3 v;void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 v;uniform vec3 tint;void main(){float a=exp(-dot(v.xz*2.,v.xz*2.)*2.);gl_FragColor=vec4(tint*1.3,a*.11);}'}) : part === 'floor' ?
        new THREE.MeshBasicMaterial({ color: new THREE.Color(colorFor(layer)).multiplyScalar(.55), transparent:true, opacity:.25 }) : facade(layer, part === 'glass');
      if(material.uniforms?.recentStart){material.uniforms.recentStart.value=recentStart;material.uniforms.recentSpan.value=recentSpan;}
      b = { material, capacity: 0, mesh: null }; batches.set(key, b);
    }
    if (count > b.capacity) {
      if (b.mesh) { b.mesh.removeFromParent(); if (part === 'failure') b.mesh.geometry.dispose(); b.mesh.dispose(); }
      b.capacity = Math.max(16, 2 ** Math.ceil(Math.log2(count)));
      if (part === 'failure') {
        const marker = createFailureBeacons(b.capacity);
        b.material.dispose(); b.material = marker.material; b.mesh = marker;
      } else b.mesh = new THREE.InstancedMesh(part === 'beam' ? beam : part === 'ring' ? ring : box, b.material, b.capacity);
      b.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      b.mesh.frustumCulled = false; group.add(b.mesh);
    }
    if (b.mesh) { b.mesh.count = count; b.mesh.visible = !hidden.has(layer); }
    return b;
  }
  function transform(b, i, x, y, z, sx, sy, sz, fresh = false, seed = .5) {
    position.set(x, y, z); scale.set(sx, sy, sz); matrix.compose(position, rotation, scale);
    b.mesh.setMatrixAt(i, matrix);
    if (b.part === 'body' || b.part === 'glass') { color.setRGB(fresh ? 0.9 : 0.35, seed, 0); b.mesh.setColorAt(i, color); }
  }
  function highlight() {
    const r = buildings.get(selected);
    selection.visible = !!r && !hidden.has(r.item.layer);
    if (r) { const it = r.item; selection.position.set(0, r.y + it.height / 2, (it.z0 + it.z1) / 2);
      selection.scale.set(7.05, it.height + 0.05, Math.max(0.03, (it.z1 - it.z0) * 0.97)); }
  }
  function upload() {
    const groups = new Map();
    for (const r of [...buildings.values(), ...falling]) {
      const list = groups.get(r.item.layer) ?? []; list.push(r); groups.set(r.item.layer, list);
    }
    for (const b of batches.values()) if (b.mesh) b.mesh.count = 0;
    for (const [layer, records] of groups) {
      const tools = records.filter(r => r.item.kind === 'tool_def'), beacons = layer === 'message' ? records : [];
      const failures = records.filter(r => r.item.isError && r.y >= 0 && !falling.includes(r));
      const alerts = batch(layer, 'failure', failures.length);
      failures.forEach((r, i) => {
        const pin = failurePin(r.y + r.item.height, skylines.get(r.item.blockId) ?? r.item.height);
        transform(alerts, i, 0, pin.base, (r.item.z0 + r.item.z1) / 2, 1, pin.height, 1);
      });
      const pools = batch(layer, 'pool', records.length);
      const body = batch(layer, 'body', records.length); body.part = 'body';
      const glass = batch(layer, 'glass', tools.length); glass.part = 'glass';
      const floors = batch(layer, 'floor', tools.reduce((n, r) => n + r.item.paramCount, 0));
      const beams = batch(layer, 'beam', beacons.length), rings = batch(layer, 'ring', beacons.length);
      let gi = 0, fi = 0, bi = 0;
      records.forEach((r, i) => {
        const seed = r.seed;
        const it = r.item, z = (it.z0 + it.z1) / 2, depth = Math.max(0.00001, it.z1 - it.z0);
        const sum = (it.split?.descTokens ?? 0) + (it.split?.schemaTokens ?? 0);
        const lower = it.kind === 'tool_def' ? it.height * (sum ? it.split.descTokens / sum : 0.5) : it.height;
        transform(pools, i, 0, -.025, z, 22, .015, Math.max(3, depth * 1.3));
        transform(body, i, 0, r.y + lower / 2, z, 7, lower, depth * 0.96, it.isNew, seed);
        if (it.kind === 'tool_def') {
          const upper = it.height - lower;
          transform(glass, gi++, 0, r.y + lower + upper / 2, z, 6.5, upper, depth * 0.9, it.isNew, seed);
          for (let j = 0; j < it.paramCount; j++) transform(floors, fi++, 0, r.y + lower + upper * (j + 0.5) / it.paramCount, z, 6.7, 0.04, depth * 0.94);
        }
        if (layer === 'message') { transform(rings, bi, 0, .06, z, 1, 1, 1); transform(beams, bi++, 0, r.y + 11, z, 1, 1, 1); }
      });
      for (const b of [body, glass, floors, beams, rings, pools, alerts]) if (b.mesh && b.mesh.count) {
        b.mesh.instanceMatrix.needsUpdate = true;
        if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
      }
    }
    highlight();
  }
  function lowerBound(z) {
    let lo = 0, hi = items.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (items[mid].z1 < z) lo = mid + 1; else hi = mid; }
    return lo;
  }
  let recentStart=0, recentSpan=1, skylines=new Map();
  return { group, buildings,
    setRange(start,end) { recentStart=start;recentSpan=Math.max(1,end-start);for(const b of batches.values())if(b.material.uniforms?.recentStart){b.material.uniforms.recentStart.value=start;b.material.uniforms.recentSpan.value=recentSpan;} },
    update(layout, filters, animate) {
      hidden = filters; items = layout.items; skylines = districtSkylines(layout);
      const keep = new Set(items.map(it => it.blockId));
      for (const [id, r] of buildings) if (!keep.has(id)) { buildings.delete(id); if (animate) falling.push({ ...r, velocity: 0 }); }
      // A quick reverse scrub revives an item instead of leaving a falling duplicate.
      falling = falling.filter(r => !keep.has(r.item.blockId));
      for (const it of items) {
        const r = buildings.get(it.blockId) ?? { y: animate ? -it.height : 0, seed: it.kind === 'tool_def' ? toolSeed(it.blockId) : .5 };
        r.item = it; if (!animate) r.y = 0; buildings.set(it.blockId, r);
      }
      if (!animate) falling = [];
      moving = animate;
      road.scale.set(0.08, 0.04, Math.max(1, layout.totalTokens * 0.01)); road.position.set(6, 0, road.scale.z / 2);
      upload();
    },
    setHidden(filters) { hidden = filters; for (const [key, b] of batches) if (b.mesh) b.mesh.visible = !hidden.has(key.split(':')[0]); highlight(); },
    select(id) { if (selected === id) return; selected = id; highlight(); },
    pick(raycaster) {
      if (!items.length) return null;
      // Clip the ray to the building envelope, then binary-search its z range.
      const r = raycaster.ray.clone(); r.origin.y /= group.scale.y; r.direction.y /= group.scale.y; r.direction.normalize(); let near = 0, far = raycaster.far;
      for (const [axis, min, max] of [['x', -3.5, 3.5], ['y', 0, 220]]) {
        if (Math.abs(r.direction[axis]) < 1e-12) { if (r.origin[axis] < min || r.origin[axis] > max) return null; }
        else { const a = (min - r.origin[axis]) / r.direction[axis], b = (max - r.origin[axis]) / r.direction[axis];
          near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b)); }
      }
      if (far < near) return null;
      const za = r.origin.z + r.direction.z * near, zb = r.origin.z + r.direction.z * far;
      const z0 = Math.min(za, zb), z1 = Math.max(za, zb);
      let closest = Infinity, id = null;
      for (let i = lowerBound(z0); i < items.length && items[i].z0 <= z1; i++) {
        const it = items[i], record = buildings.get(it.blockId);
        if (hidden.has(it.layer)) continue;
        bounds.min.set(-3.5, record.y, it.z0); bounds.max.set(3.5, record.y + it.height, Math.max(it.z0 + 0.00001, it.z1));
        if (r.intersectBox(bounds, hit)) { const distance = hit.distanceToSquared(r.origin); if (distance < closest) { closest = distance; id = it.blockId; } }
      }
      return id ? { userData: { blockId: id } } : null;
    },
    tick(dt, reduced) {
      time += reduced ? 0 : dt;
      for (const b of batches.values()) if (b.material.uniforms?.time) b.material.uniforms.time.value = time;
      const pulse = reduced ? 0.4 : 0.4 + Math.sin(time * 2.2) * 0.2;
      const beacon = batches.get('message:beam'); if (beacon) beacon.material.opacity = pulse;
      if (!moving) return;
      moving = false;
      for (const r of buildings.values()) { r.y = reduced ? 0 : Math.min(0, r.y + dt * 450); moving ||= r.y < 0; }
      for (const r of falling) { r.velocity += dt * 150; r.y -= r.velocity * dt; }
      falling = reduced ? [] : falling.filter(r => r.y >= -r.item.height - 10);
      moving ||= falling.length > 0; upload();
    },
    intro(progress) { let i=0; for (const r of buildings.values()) { r.y = -r.item.height * (1-THREE.MathUtils.clamp(progress*1.5-i++/Math.max(1,buildings.size)*.5,0,1)); } upload(); },
    clear() { buildings.clear(); falling = []; items = []; moving = false; selected = null;
      for (const b of batches.values()) {
        b.mesh?.removeFromParent(); if (b.mesh?.geometry.type === 'PlaneGeometry') b.mesh.geometry.dispose(); b.mesh?.dispose(); b.mesh = null; b.capacity = 0;
      }
      selection.visible = false; },
    dispose() { this.clear(); for (const b of batches.values()) { b.mesh?.dispose(); b.material.dispose(); }
      batches.clear(); road.material.dispose(); selection.material.dispose(); box.dispose(); beam.dispose(); ring.dispose(); group.removeFromParent(); group.clear(); },
  };
}

export function createWindow(meta) {
  const group = new THREE.Group(), length = meta.window * 0.01;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80000, 80000), new THREE.ShaderMaterial({ fog: true,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), color: { value: new THREE.Color('#3d5a85') } },
    vertexShader: `varying vec3 world;
#include <fog_pars_vertex>
void main(){vec4 p=modelMatrix*vec4(position,1.);world=p.xyz;vec4 mvPosition=viewMatrix*p;gl_Position=projectionMatrix*mvPosition;
#include <fog_vertex>
}`,
    fragmentShader: `varying vec3 world;uniform vec3 color;
#include <fog_pars_fragment>
    void main(){vec2 q=world.xz/5.;vec2 d=abs(fract(q-.5)-.5)/max(fwidth(q),vec2(.001));float grid=(1.-min(min(d.x,d.y),1.))*(1.-smoothstep(.15,.9,max(fwidth(q).x,fwidth(q).y)));
    float road=step(3.8,world.x)*step(world.x,9.);float tick=step(4.,world.x)*step(world.x,8.8)*(1.-smoothstep(.18,.5,abs(mod(world.z+50.,100.)-50.)));
    float lane=(1.-smoothstep(.025,.08,abs(world.x-6.)));
    vec3 c=mix(vec3(.05,.07,.11),vec3(.07,.09,.13),road)+color*grid*.16*(1.-road)+vec3(.3,.6,.85)*lane+vec3(.3,.55,.8)*tick;
    gl_FragColor=vec4(c,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
#include <fog_fragment>
}`, extensions: { derivatives: true },
  })); ground.rotation.x=-Math.PI/2;ground.position.set(0,-.08,length/2);group.add(ground);
  for (const [tokens, color, name] of [[meta.autocompactAt, THEME.compact, 'Autocompact'], [meta.window, THEME.end, 'Window end']].filter(([t]) => t != null)) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.8) });
    const thickness = Math.max(.3, length * .0004), gateHeight = Math.max(30, length * .02), gateWidth = Math.max(24, length * .02);
    const box = new THREE.BoxGeometry(1,1,1);
    // One instanced draw for all three frame members.
    const frame = new THREE.InstancedMesh(box,mat,3), m=new THREE.Matrix4();
    for (const [i,x] of [-gateWidth/2,gateWidth/2].entries()) { m.makeScale(thickness,gateHeight,thickness);m.setPosition(x,gateHeight/2,tokens*.01);frame.setMatrixAt(i,m); }
    m.makeScale(gateWidth+thickness,thickness,thickness);m.setPosition(0,gateHeight,tokens*.01);frame.setMatrixAt(2,m);group.add(frame);
    const uniforms={...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),time:{value:0},alarm:{value:0},tint:{value:new THREE.Color(color)}};
    const wall=new THREE.Mesh(new THREE.PlaneGeometry(gateWidth,gateHeight),new THREE.ShaderMaterial({uniforms,fog:true,extensions:{derivatives:true},transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
      vertexShader:`varying vec2 v;
#include <fog_pars_vertex>
void main(){v=uv;vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
#include <fog_vertex>
}`,
      fragmentShader:`varying vec2 v;uniform float time,alarm;uniform vec3 tint;
#include <fog_pars_fragment>
void main(){float rim=pow(abs(v.x-.5)*2.,6.)+pow(abs(v.y-.5)*2.,8.);float scan=pow(.5+.5*sin(v.y*180.-time*2.),18.);scan*=1.-smoothstep(.7,3.14,fwidth(v.y)*180.);float pulse=1.+alarm*(.3+.3*sin(time*4.));gl_FragColor=vec4(tint*(.15+rim*.8+scan*.3)*pulse,.3);
#include <fog_fragment>
}`,
    }));wall.position.set(0,gateHeight/2,tokens*.01);group.add(wall);
    group.userData.walls??=[];group.userData.walls.push(uniforms);
    group.userData.gates ??= [];
    group.userData.gates.push({ label: `${name} · ${tokens.toLocaleString('en-US')} tokens`, gate: true, meshes: [frame, wall], labelHeight: gateHeight + thickness * 2,
      z0: tokens * .01, z1: tokens * .01, blockIds: [] });
  }
  group.userData.ticks=[];
  for(let t=50000;t<meta.window;t+=50000) group.userData.ticks.push({label:`${t/1000}K`,layer:null,tick:true,labelHeight:.5,z0:t*.01,z1:t*.01,blockIds:[]});
  return group;
}
