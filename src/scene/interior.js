import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { colorFor, THEME } from './theme.js';
import { disposeTree } from './dispose.js';
import { textPage } from './labels.js';
import { chunkPages, hallPage, HALL_BLOCKS } from './paging.js';

// Crossing is tested in the door's own coordinates, independent of orientation.
export function crossesDoor(door, previous, next) {
  const a = door.worldToLocal(previous.clone()), b = door.worldToLocal(next.clone());
  if ((a.z > 0) === (b.z > 0) || a.z === b.z) return false;
  const t = -a.z / (b.z - a.z);
  const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
  return Math.abs(x) <= 1.3 && y >= 0 && y <= 4;
}

export function createInterior(navigate, reducedMotion = () => false) {
  const group = new THREE.Group();
  let view = null, glide = null, doorSignature = null;
  const doorGroup = new THREE.Group(); group.add(doorGroup);
  let doors = [], pages = [], length = 10, yaw = Math.PI, pitch = 0, pos = new THREE.Vector3(0, 1.7, 0);
  function clearDoors() {
    const panels = new Set(); doorGroup.traverse(o => { if (o.userData.buildTexture) panels.add(o); });
    pages = pages.filter(p => !panels.has(p));
    for (const c of [...doorGroup.children]) disposeTree(c); doors = [];
  }
  function clear() { clearDoors(); for (const c of [...group.children]) if (c !== doorGroup) disposeTree(c); pages = []; view = null; glide = null; doorSignature = null; }
  function door(label, x, z, rotation, action, color = colorFor(group.userData.layer ?? 'tools')) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotation;
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.3) });
    for (const px of [-1.4, 1.4]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4, 0.12), mat); p.position.set(px, 2, 0); g.add(p);
    }
    const panel = textPage(label, 'Walk through or click', [], color, true); pages.push(panel);
    panel.position.y = 2; panel.userData.action = action; g.add(panel);
    g.userData.action = action; doorGroup.add(g); doors.push(g);
  }
  function finish() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 1), new THREE.ShaderMaterial({uniforms:{tint:{value:new THREE.Color(colorFor(view?.kind==='block'?group.userData.layer:'tools'))}},vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 v;uniform vec3 tint;void main(){float reflection=exp(-abs(v.x-.5)*9.);float lane=step(.487,v.x)*step(v.x,.513);float bands=.5+.5*cos(v.y*180.);gl_FragColor=vec4(vec3(.008,.013,.026)+tint*(reflection*.06+bands*reflection*.035+lane*.45),1.);}'} ));
    floor.userData.floor = true; floor.scale.y = length + 12;
    floor.rotation.x = -Math.PI / 2; floor.position.z = length / 2; group.add(floor);
    const wallGeometry=new THREE.BoxGeometry(1,1,1),wallMaterial=new THREE.MeshStandardMaterial({color:'#080e1c',roughness:.8});
    for(const x of [-6.1,6.1]){const wall=new THREE.Mesh(wallGeometry,wallMaterial);wall.position.set(x,3,length/2);wall.scale.set(.15,6,length+12);wall.userData.wall=true;group.add(wall);}
    pos.set(0, 1.7, 0); yaw = Math.PI; pitch = 0; group.updateMatrixWorld(true);
  }
  function buildBlock(session, layout, id) {
    clear(); view = { kind: 'block', id };
    group.userData.layer=session.blocks[id].layer;
    const b = session.blocks[id], color = colorFor(b.layer);
    const text = b.text ?? `[Text unavailable · ${b.chars} characters · ${b.estTokens} estimated tokens]`;
    // Pack parameter descriptions together, and stop wrapping after the budget.
    const params = (b.params ?? []).map(p => `${p.name} (${p.type ?? 'unknown'}, ${p.required ? 'required' : 'optional'})\n${p.description ?? 'Description unavailable.'}`).join('\n\n');
    const chunks = chunkPages(text + (params ? '\n\nParameters\n' + params : ''));
    chunks.forEach((page, i) => {
      const mesh = textPage(b.label, `${b.provenance} · page ${i + 1}/${chunks.length}`, page, color);
      const left = i % 2 === 0, angle = left ? 2.21 : -2.21;
      mesh.position.set(left ? -4.6 : 4.6, 2.8, 5 + Math.floor(i / 2) * 8);
      mesh.rotation.y = angle;
      mesh.userData.action = () => {
        const destination = new THREE.Vector3(mesh.position.x + Math.sin(angle) * 4.5, 1.7, mesh.position.z + Math.cos(angle) * 4.5);
        const targetYaw = yaw + Math.atan2(Math.sin(angle - yaw), Math.cos(angle - yaw));
        glide = { from: pos.clone(), to: destination, yaw0: yaw, yaw1: targetYaw, pitch0: pitch, pitch1: Math.atan2(1.1, 4.5), elapsed: 0 };
        if (reducedMotion()) tick(0.4);
      };
      group.add(mesh); pages.push(mesh);
    });
    length = 12 + Math.ceil(chunks.length / 2) * 8;
    blockDoors(layout, id);
    finish();
  }
  function blockDoors(layout, id) {
    const index = layout.items.findIndex(it => it.blockId === id);
    const signature = JSON.stringify([layout.items[index - 1]?.blockId, layout.items[index + 1]?.blockId]);
    if (signature === doorSignature) return;
    clearDoors(); doorSignature = signature;
    if (index > 0) door('Previous block', 0, -3, 0, () => navigate('block', layout.items[index - 1].blockId));
    else door('City', 0, -3, 0, () => navigate('exit'));
    if (index < layout.items.length - 1) door('Next block', 0, length, 0, () => navigate('block', layout.items[index + 1].blockId));
    else door('City', 0, length, 0, () => navigate('exit'));
    group.updateMatrixWorld(true);
  }
  function buildDistrict(session, layout, i, page = 0) {
    clear();
    districtDoors(session, layout, i, page);
    finish();
  }
  function districtDoors(session, layout, i, requested) {
    const d = layout.districts[i], { ids, page, more, back } = hallPage(d.blockIds, requested);
    const signature = JSON.stringify([i, page, ids, layout.districts[i - 1]?.blockIds[0], layout.districts[i + 1]?.blockIds[0], more, back]);
    view = { kind: 'district', id: ids[0], ids, district: i, page };
    if (signature === doorSignature) return;
    clearDoors(); doorSignature = signature;
    ids.forEach((id, j) => door(session.blocks[id].label, j % 2 ? 4 : -4, 5 + j * 5,
      j % 2 ? -Math.PI / 2 : Math.PI / 2, () => navigate('block', id), colorFor(session.blocks[id].layer)));
    length = 10 + ids.length * 5;
    door(back ? 'Back' : i ? 'Previous district' : 'City', 0, -3, 0,
      () => back ? navigate('district', i, page - 1) : i ? navigate('district', i - 1) : navigate('exit'));
    door(more ? 'More' : i + 1 < layout.districts.length ? 'Next district' : 'City', 0, length, 0,
      () => more ? navigate('district', i, page + 1) : i + 1 < layout.districts.length ? navigate('district', i + 1) : navigate('exit'));
    const floor = group.children.find(c => c.userData.floor);
    if (floor) { floor.scale.y = length + 12; floor.position.z = length / 2; }
    for(const wall of group.children.filter(c=>c.userData.wall)){wall.scale.z=length+12;wall.position.z=length/2;}
    group.updateMatrixWorld(true);
  }
  function tick(dt) {
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
        mat.map = mesh.userData.buildTexture(); mat.color.set('#ffffff'); mat.needsUpdate = true;
      } else if (mat.map && distance > 60) {
        mat.map.dispose(); mat.map = null; mat.color.set(THEME.ground); mat.needsUpdate = true;
      }
    }
  }
  return { group, clear, buildBlock, buildDistrict,
    rebuild(session, layout) {
      if (!view) return false;
      if (view.kind === 'block') {
        if (!layout.items.some(it => it.blockId === view.id)) return false;
        blockDoors(layout, view.id);
      } else {
        const anchors = new Set(view.ids);
        const i = layout.districts.findIndex(d => d.blockIds.some(id => anchors.has(id)));
        if (i < 0) return false;
        const anchor = layout.districts[i].blockIds.findIndex(id => anchors.has(id));
        const page = Math.floor(anchor / HALL_BLOCKS);
        districtDoors(session, layout, i, page);
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
      for (const d of doors) if (crossesDoor(d, previous, pos)) { d.userData.action(); return true; }
      return false;
    },
    applyCamera(camera) { updateTextures(); camera.position.copy(pos); camera.rotation.set(pitch, yaw, 0, 'YXZ'); },
    dispose() { clear(); group.removeFromParent(); },
  };
}
