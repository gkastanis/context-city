import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js/+esm';
import { layoutRequest } from '../layout.js';
import { createModes } from './modes.js';
import { createCity, createWindow } from './city.js';
import { createInterior } from './interior.js';
import { createLabels } from './labels.js';
import { createReader } from './reader.js';
import { disposeTree } from './dispose.js';
import { THEME } from './theme.js';
import { createAtmosphere } from './atmosphere.js';
import { createEffects } from './effects.js';
import { eventLayout, overviewRange, createQualityMonitor } from './model.js';
import { hallPage } from './paging.js';

export function createScene(container, callbacks = {}) {
  const emit = (name, ...args) => {
    try { callbacks[name]?.(...args); }
    catch (err) {
      if (name !== 'onError') { try { callbacks.onError?.(err); } catch { /* Error handlers cannot interrupt scene state. */ } }
    }
  };
  let renderer;
  // Try lighter settings before giving up: some drivers refuse antialiasing or the default GPU choice.
  const attempts = [{ antialias: true }, { antialias: false }, { antialias: false, powerPreference: 'low-power', depth: true, stencil: false }];
  let lastError = null;
  for (const options of attempts) { try { renderer = new THREE.WebGLRenderer(options); break; } catch (err) { lastError = err; } }
  if (!renderer) {
    const probe = document.createElement('canvas');
    const anyWebGL = !!(probe.getContext('webgl2') || probe.getContext('webgl'));
    const err = new Error(anyWebGL ? (lastError?.message ?? 'WebGL failed to start') : 'WebGL is turned off or blocked in this browser');
    err.webglDisabled = !anyWebGL; emit('onError', err); throw err;
  }
  const originalPosition = container.style.position;
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  const canvas = renderer.domElement;
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });
  canvas.tabIndex = 0; canvas.setAttribute('aria-label', 'Context city. Drag to orbit. Double click a building to enter. Inside: drag to look, WASD or arrows to walk, Escape to exit.');
  container.append(canvas);
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.5;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(THEME.background);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 100000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false; controls.maxPolarAngle = Math.PI * 0.49; controls.maxDistance = 80000;
  scene.add(new THREE.HemisphereLight('#d6e0f2', '#2c2838', 1.4));
  const light = new THREE.DirectionalLight('#fff0d9', 1.4); light.position.set(-20, 70, -30); scene.add(light);
  const atmosphere = createAtmosphere(scene, renderer, camera);
  const effects = createEffects(); scene.add(effects.group);
  const city = createCity(); scene.add(city.group);
  const head = new THREE.Mesh(new THREE.PlaneGeometry(11, 26),
    new THREE.MeshBasicMaterial({ color: '#ffd38a', transparent: true, opacity: .12, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  head.position.y = 13;
  const headLine=new THREE.Mesh(new THREE.BoxGeometry(11,.08,.1),new THREE.MeshBasicMaterial({color:'#ffe0a0'}));headLine.position.y=-12.9;head.add(headLine);
  const trail=new THREE.Mesh(new THREE.PlaneGeometry(11,8),new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 v;void main(){gl_FragColor=vec4(.6,.35,.12,.16*(1.-v.y));}'}));trail.rotation.x=-Math.PI/2;trail.position.set(0,.12,-4);head.add(trail);
  head.position.y = 13; head.visible = false; scene.add(head);
  const labels = createLabels(container), hidden = new Set(), keys = new Set();
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = media.matches, session = null, layout = { items: [], districts: [], totalTokens: 0 }, windowGroup = null;
  let currentRequest = 0;
  let flight = null, selected = null, hover = null, dead = false, width = 1, height = 1;
  let intro = null, quality = matchMedia('(pointer: coarse)').matches ? 'low' : 'high', frameMs = 0;
  atmosphere.setQuality(quality); effects.setQuality(quality);
  const qualityMonitor = createQualityMonitor(level => {
    quality = level; atmosphere.setQuality(level); effects.setQuality(level); interior.setQuality(level); emit('onQualityChange', level);
  }, quality);
  let down = null, lastPointer = null, fullWindow = false, framing = null;
  const modes = createModes((mode, info) => emit('onModeChange', mode, info));
  const reader = createReader(position => { city.select(position.blockId); emit('onReadPosition', position); },
    () => { head.visible = false; controls.enabled = true; modes.request('city', 'orbit', { readingEnded: true }); });
  const interior = createInterior((type, id, page) => {
    if (type === 'block') api.enterBlock(id);
    else if (type === 'district') api.enterDistrict(id, page);
    else api.exitInside();
  }, () => reduced, renderer);
  interior.setQuality(quality);
  scene.add(interior.group); interior.group.visible = false;
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const listeners = [];
  function listen(target, name, fn, options) { target.addEventListener(name, fn, options); listeners.push(() => target.removeEventListener(name, fn, options)); }
  function setHover(id) { if (id !== hover) { hover = id; emit('onHover', id); } }
  function setSelected(id) { selected = id; city.select(id); emit('onSelect', id); }
  function prepare(mode, owner, info = {}) {
    cancelIntro(true, false);
    if (info.view !== 'whole-session') targetHeightScale = 1;
    if (mode !== 'city') camera.clearViewOffset();
    flight = null; keys.clear(); lastPointer = null;
    reader.stop(); interior.clear(); setHover(null);
    city.select(selected);
    city.group.visible = mode !== 'inside'; interior.group.visible = mode === 'inside';
    head.visible = mode === 'reading';
    if (windowGroup) windowGroup.visible = mode !== 'inside';
    // Prevent OrbitControls from applying buffered input when another owner runs.
    controls.enabled = mode === 'city' && owner === 'orbit';
    const id = modes.request(mode, owner, info);
    return id;
  }
  let heightScale = 1, targetHeightScale = 1;
  let viewInsets = { left: 0, right: 0, top: 0, bottom: 0 };
  function frame(z0, z1, high = Math.max(12, ...layout.items.map(it => it.height))) {
    // Fit every corner in the available container, using both FOV axes. The UI
    // supplies free space by sizing this container around its panels.
    const target = new THREE.Vector3(0, high / 2, (z0 + z1) / 2);
    const direction = (targetHeightScale > 1 ? new THREE.Vector3(-1, 1.1, -.32) : new THREE.Vector3(-1, .4, -.7)).normalize();
    const forward = direction.clone().negate();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    const freeW = Math.max(width * .22, width - viewInsets.left - viewInsets.right);
    const freeH = Math.max(height * .22, height - viewInsets.top - viewInsets.bottom);
    const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const tanY = tangent * freeH / height * .9;
    const tanX = tangent * camera.aspect * freeW / width * .9;
    let distance = 25;
    for (const x of [-15, 15]) for (const y of [0, high]) for (const z of [z0, z1]) {
      const v = new THREE.Vector3(x, y, z).sub(target), toward = v.dot(direction);
      distance = Math.max(distance, toward + Math.abs(v.dot(right)) / tanX, toward + Math.abs(v.dot(up)) / tanY);
    }
    // Off-axis projection centers the free HUD rectangle without perspective drift.
    camera.setViewOffset(width, height, -(viewInsets.left-viewInsets.right)/2, -(viewInsets.top-viewInsets.bottom)/2, width, height);
    return { position: target.clone().addScaledVector(direction, distance), target };
  }
  function overviewView(whole = false, exaggerate = whole) {
    targetHeightScale = exaggerate ? 2.8 : 1;
    const { z0, z1, high } = overviewRange(layout, whole);
    atmosphere.setRange(whole ? 0 : z0, z1); city.setRange(z0,z1);
    return frame(z0, z1, high * targetHeightScale);
  }
  function fly(view, info = {}, immediate = false) {
    framing = info.blockId != null ? { blockId: info.blockId } : info.view ?? null;
    const id = prepare('city', 'flight', info);
    flight = { id, p0: camera.position.clone(), t0: controls.target.clone(), ...view, elapsed: 0 };
    if (reduced || immediate) finishFlight();
  }
  function reframe(view) {
    // A scrub changes the footprint, not the mode or camera owner. If a flight
    // is in progress, keep its destination current until it hands back to orbit.
    camera.position.copy(view.position); controls.target.copy(view.target); camera.lookAt(view.target);
    if (flight) { flight.position.copy(view.position); flight.target.copy(view.target);
      flight.p0.copy(view.position); flight.t0.copy(view.target); }
  }
  function finishFlight() {
    if (!flight || !modes.valid(flight.id)) return;
    camera.position.copy(flight.position); controls.target.copy(flight.target); camera.lookAt(controls.target);
    flight = null; modes.request('city', 'orbit'); controls.enabled = true;
  }
  function currentItem(id) {
    const item = layout.items.find(it => it.blockId === id);
    if (!item) throw new RangeError(`Block not in current request: ${id}`);
    return item;
  }
  function district(i) { const d = layout.districts[i]; if (!d) throw new RangeError(`Unknown district: ${i}`); return d; }
  function updateLabels() {
    const range = overviewRange(layout, framing === 'whole-session');
    const visibleGates = windowGroup?.userData.gates.filter(g => {
      const visible = fullWindow || (g.z0 >= range.z0 && g.z0 <= range.z1 + (range.z1-range.z0)*.3);
      g.meshes.forEach(mesh => { mesh.visible = visible; });
      return visible;
    }) ?? [];
    const gates = windowGroup ? [...visibleGates, ...windowGroup.userData.ticks] : [];
    labels.set({ ...layout, newestBlockId: session?.requests[currentRequest]?.newBlockIds.at(-1), districts: [...layout.districts, ...gates] }, session);
  }
  function changeRequest(idx, initial) {
    const next = layoutRequest(session, idx);
    cancelIntro(true);
    const mode = modes.get(), reading = reader.getState(), keep = next.items.some(it => it.blockId === selected);
    const oldFraming = framing;
    layout = next; currentRequest = idx;
    city.update(layout, hidden, !initial && !reduced); updateLabels();
    if (selected != null && !keep) setSelected(null); else city.select(selected);
    if (!initial && mode === 'reading') {
      reader.start(layout, reading.token); if (reading.paused) reader.pause();
      head.position.z = Math.min(reading.token, layout.totalTokens) * 0.01;
      return;
    }
    if (!initial && mode === 'inside') {
      const before = interior.getView(), info = interior.rebuild(session, layout);
      if (info) {
        if (info.district != null && (before.district !== info.district || before.page !== info.page)) modes.request('inside', 'interior', info);
        interior.applyCamera(camera); return;
      }
      fullWindow = false;
      fly(overviewView(), { view: 'overview', requestIdx: idx });
      return;
    }
    if (!initial && oldFraming?.blockId) {
      const it = layout.items.find(it => it.blockId === oldFraming.blockId);
      if (it) reframe(frame(it.z0, it.z1, it.height + 4));
      else fly(overviewView(), { view: 'overview' });
      return;
    }
    if (initial || oldFraming === 'overview' || oldFraming === 'whole-session') {
      fullWindow = false;
      const view = overviewView(oldFraming === 'whole-session');
      if (initial) fly(view, { view: 'overview' }, true);
      else reframe(view);
    }
  }

  function cancelIntro(cancelled = true, jump = true) {
    if (!intro) return;
    const old=intro;intro=null; city.intro(1);
    if(jump) { framing='overview'; reframe(overviewView()); modes.request('city','orbit');controls.enabled=true; }
    try { old.onDone?.({cancelled}); } catch(err) {emit('onError',err);}
  }

  const api = {
    setViewInsets(value = {}) {
      const next = {};
      for (const key of ['left','right','top','bottom']) {
        const n = value[key] ?? 0;
        if (!Number.isFinite(n) || n < 0) throw new RangeError('View insets must be finite nonnegative pixels');
        next[key] = n;
      }
      viewInsets = next; resize();
    },
    setAtmosphere({ fill }) { atmosphere.setFill(fill, reduced); },
    setQuality(level) {
      if (!['high','low'].includes(level)) throw new RangeError('Quality must be high or low');
      qualityMonitor.set(level, true);
    },
    playIntro({ onDone } = {}) {
      if(modes.get()!=='city'||dead) return () => {};
      cancelIntro(true,false); prepare('city','intro');
      intro={elapsed:0,onDone};city.intro(reduced?1:0);
      if(!reduced){camera.position.set(-13,3,-18);controls.target.set(0,3,15);camera.lookAt(controls.target);}
      const playback=intro;
      return () => { if(intro===playback)cancelIntro(true); };
    },
    celebrate(id) { const r=city.buildings.get(id);if(r)effects.burst(r.item,'celebrate',reduced); },
    playEvent(event) {
      if(!event||!session)return;
      const own = eventLayout(session, event); if (!own) return;
      const targets = own.targets;
      if(event.type==='compaction') {
        const cut=Math.max(0,(event.data?.preTokens??own.totalTokens)-(event.data?.postTokens??0))*.01;
        const before=own.items.filter(it=>it.z0<cut);
        for(const it of before.filter((_,i)=>i%Math.max(1,Math.ceil(before.length/6))===0).slice(0,6))effects.burst(it,'compaction',reduced);
        effects.summary(own.totalTokens*.01,reduced,own.totalTokens*.01);
      } else if(['tool_loaded','mcp_instructions'].includes(event.type)) {
        const matches=targets.filter(it=>event.type==='tool_loaded'?it.kind==='tool_def':it.layer==='mcp');
        for(const it of matches.slice(0,6)) effects.burst(it,'beam',reduced);
      } else if(event.type==='user_prompt') {
        const it=targets.find(it=>it.kind==='user_text')??own.items.findLast(it=>it.kind==='user_text');if(it)effects.burst(it,'user_prompt',reduced);
      } else effects.burst(targets[0]??own.items.at(-1),'pulse',reduced);
    },
    setSession(value) {
      // Validate before replacing a working scene.
      if (!value?.meta || !value.blocks || !Array.isArray(value.requests)) throw new TypeError('Expected a Session');
      if (value.requests.length) layoutRequest(value, 0);
      heightScale = targetHeightScale = 1; city.group.scale.y = 1;
      framing = null; fullWindow = false; prepare('city', 'orbit'); modes.reset(); setSelected(null); city.clear();
      if (windowGroup) disposeTree(windowGroup);
      session = value; effects.clear(); atmosphere.setFill(0, true); hidden.clear(); windowGroup = createWindow(session.meta); scene.add(windowGroup);
      if (value.requests.length) changeRequest(0, true);
      else { layout = { items: [], districts: [], totalTokens: 0, measured: false }; city.update(layout, hidden, false); updateLabels(); fly(frame(0, 1), {}, true); }
    },
    setRequest(idx) { if (!session) throw new Error('Set a session first'); changeRequest(idx, false); },
    select(id) {
      if (id != null) currentItem(id);
      cancelIntro(true);
      const wasInside = modes.get() === 'inside';
      if (wasInside && id != null) { api.enterBlock(id); return; }
      if (wasInside) { api.overview(); setSelected(null); return; }
      if (modes.get() !== 'city' || flight) { prepare('city', 'orbit'); camera.lookAt(controls.target); }
      else modes.request('city', 'orbit', { blockId: id });
      setSelected(id);
    },
    flyToBlock(id) { targetHeightScale = 1; city.setRange(0,layout.totalTokens*.01); const it = currentItem(id); setSelected(id); fullWindow = false; updateLabels(); fly(frame(it.z0, it.z1, it.height + 4), { blockId: id }); },
    flyToDistrict(i) { targetHeightScale = 1; city.setRange(0,layout.totalTokens*.01); const d = district(i); setSelected(null); fullWindow = false; updateLabels(); fly(frame(d.z0, d.z1), { district: i }); },
    overview() { fullWindow = false; fly(overviewView(), { view: 'overview' }); if (session) updateLabels(); },
    showWholeSession() { fullWindow = false; fly(overviewView(true), { view: 'whole-session' }); updateLabels(); },
    showFullWindow() { if (!session) return; targetHeightScale = 1; city.setRange(0,session.meta.window*.01); atmosphere.setRange(0,session.meta.window*.01); fullWindow = true; updateLabels(); fly(frame(0, session.meta.window * 0.01, Math.max(36, session.meta.window * 0.0002 + 100)), { view: 'full-window' }); },
    enterBlock(id) {
      framing = null; currentItem(id); prepare('inside', 'interior', { blockId: id }); setSelected(id);
      interior.buildBlock(session, layout, id); interior.applyCamera(camera); canvas.focus({ preventScroll: true });
    },
    enterDistrict(i, page = 0) {
      if (!Number.isInteger(page) || page < 0) throw new RangeError('Hall page must be a nonnegative integer');
      framing = null; const d = district(i); page = hallPage(d.blockIds, page).page; prepare('inside', 'interior', { district: i, page }); setSelected(null);
      interior.buildDistrict(session, layout, i, page); interior.applyCamera(camera); canvas.focus({ preventScroll: true });
    },
    exitInside() { api.overview(); },
    startReading(fromToken = 0) {
      if (!Number.isFinite(fromToken)) throw new TypeError('Reading token must be finite');
      city.setRange(0,layout.totalTokens*.01); framing = null; prepare('reading', 'reader', { fromToken }); setSelected(null); reader.start(layout, fromToken);
      head.position.z = Math.max(0, Math.min(layout.totalTokens, fromToken)) * 0.01;
      if (reduced) { const view = overviewView(true, false); camera.position.copy(view.position); controls.target.copy(view.target); camera.lookAt(view.target); }
    },
    pauseReading() { if (modes.get() !== 'reading') return; reader.pause(); modes.request('reading', 'paused', { paused: true }); },
    resumeReading() { if (modes.get() !== 'reading') return; reader.resume(); modes.request('reading', 'reader', { paused: false }); },
    stopReading() { if (modes.get() === 'reading') { prepare('city', 'orbit'); city.select(selected); } },
    setReadingSpeed(tokensPerSecond) { reader.setSpeed(tokensPerSecond); },
    setLayerVisible(layer, visible) { if (visible) hidden.delete(layer); else hidden.add(layer); city.setHidden(hidden); setHover(null); },
    getMode: () => modes.get(),
    // Exposed only when the embedding development harness opts in.
    ...(callbacks.dev ? { getStats: () => ({ memory: { ...renderer.info.memory }, render: { ...renderer.info.render }, quality, frameMs }) } : {}),
    dispose() {
      if (dead) return; cancelIntro(true,false); dead = true; flight = null; reader.stop(); keys.clear(); modes.reset();
      renderer.setAnimationLoop(null); observer.disconnect(); listeners.forEach(remove => remove());
      atmosphere.dispose(); controls.dispose(); interior.dispose(); city.dispose(); labels.dispose();
      if (windowGroup) disposeTree(windowGroup);
      disposeTree(scene); renderer.dispose(); renderer.forceContextLoss(); canvas.remove(); container.style.position = originalPosition;
    },
  };
  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    ray.setFromCamera(pointer, camera);
    if (modes.get() !== 'inside') return city.pick(ray);
    const objects = interior.group.children;
    // The nearest surface stops the ray, so a sign cannot be clicked through the plaque or a sheet.
    const hit = ray.intersectObjects(objects, true)[0];
    for (let o = hit?.object; o && o !== interior.group; o = o.parent) if (o.userData.action || o.userData.blockId) return o;
    return null;
  }
  for(const name of ['pointerdown','wheel','keydown']) listen(document,name,()=>cancelIntro(true),{capture:true});
  listen(canvas, 'pointerdown', e => {
    if (modes.get() === 'city') framing = null;
    canvas.focus({ preventScroll: true }); down = [e.clientX, e.clientY]; lastPointer = down;
    if (modes.get() === 'city' && flight) { flight = null; modes.request('city', 'orbit'); controls.enabled = true; }
    canvas.setPointerCapture(e.pointerId);
  });
  listen(canvas, 'pointermove', e => {
    if (modes.get() === 'inside' && down && lastPointer) {
      interior.look(e.clientX - lastPointer[0], e.clientY - lastPointer[1]); lastPointer = [e.clientX, e.clientY]; return;
    }
    setHover(modes.get() === 'city' ? pick(e)?.userData.blockId ?? null : null);
  });
  listen(canvas, 'pointerup', e => {
    const click = down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5; down = null; lastPointer = null;
    if (!click) return;
    const object = pick(e);
    if (object?.userData.action) object.userData.action();
    else if (object?.userData.blockId) api.select(object.userData.blockId);
  });
  listen(canvas, 'pointercancel', () => { down = null; lastPointer = null; });
  listen(canvas, 'pointerleave', () => setHover(null));
  listen(canvas, 'dblclick', e => { if (modes.get() === 'city') { const id = pick(e)?.userData.blockId; if (id) api.enterBlock(id); } });
  listen(canvas, 'wheel', e => { if (modes.get() === 'city') framing = null; if (modes.get() === 'inside') { e.preventDefault(); interior.move(Math.max(-2, Math.min(2, e.deltaY * 0.01)), 0); } }, { passive: false });
  listen(canvas, 'keydown', e => {
    if (e.key === 'Escape') { if (modes.get() === 'inside') api.exitInside(); else if (modes.get() === 'reading') api.stopReading(); return; }
    if (!['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Shift'].includes(e.key)) return;
    e.preventDefault(); keys.add(e.key.toLowerCase());
  });
  listen(canvas, 'keyup', e => keys.delete(e.key.toLowerCase()));
  listen(canvas, 'blur', () => { keys.clear(); down = null; lastPointer = null; });
  listen(media, 'change', e => { reduced = e.matches; if (reduced && flight) finishFlight(); });
  listen(canvas, 'webglcontextlost', e => { e.preventDefault(); emit('onError', new Error('WebGL context lost. Recreate the scene to recover.')); });
  function resize() {
    width = Math.max(1, container.clientWidth); height = Math.max(1, container.clientHeight);
    camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false); atmosphere.resize(width,height);
    if (modes.get() === 'city' && session && (framing === 'overview' || framing === 'full-window' || framing === 'whole-session')) {
      const view = fullWindow ? frame(0, session.meta.window * 0.01, Math.max(36, session.meta.window * 0.0002 + 100)) : overviewView(framing === 'whole-session');
      if (flight) { flight.position.copy(view.position); flight.target.copy(view.target); }
      else { camera.position.copy(view.position); controls.target.copy(view.target); camera.lookAt(view.target); }
    }
  }
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  camera.position.set(25, 25, -25); camera.lookAt(0, 0, 0);
  let previous = performance.now();
  renderer.setAnimationLoop(now => {
    if (dead) return;
    const elapsed=Math.max(0,(now-previous)/1000);
    const dt = Math.min(.1, elapsed); previous=now;frameMs=elapsed*1000;
    qualityMonitor.sample(elapsed);
    try {
      const owner = modes.owner();
      if (owner === 'intro' && intro) {
        intro.elapsed+=dt;const t=reduced?1:Math.min(1,intro.elapsed/3.6);city.intro(t);
        if(!reduced){const view=overviewView(),k=t*t*(3-2*t);camera.position.lerpVectors(new THREE.Vector3(-13,3,layout.totalTokens*.01*t*.5-18),view.position,k);controls.target.lerpVectors(new THREE.Vector3(0,3,layout.totalTokens*.01*t*.5+15),view.target,k);camera.lookAt(controls.target);}
        if(t===1)cancelIntro(false);
      } else if (owner === 'flight' && flight && modes.valid(flight.id)) {
        flight.elapsed += dt; const t = Math.min(1, flight.elapsed / 0.8), k = t * t * (3 - 2 * t);
        camera.position.lerpVectors(flight.p0, flight.position, k); controls.target.lerpVectors(flight.t0, flight.target, k); camera.lookAt(controls.target);
        if (t === 1) finishFlight();
      } else if (owner === 'interior') {
        const speed = (keys.has('shift') ? 10 : 4) * dt;
        const f = Number(keys.has('w') || keys.has('arrowup')) - Number(keys.has('s') || keys.has('arrowdown'));
        const r = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
        const changed = (f || r) && interior.move(f * speed, r * speed);
        if (!changed && modes.owner() === 'interior') { interior.tick(dt); interior.applyCamera(camera); }
      } else if (owner === 'reader') {
        const position = reader.tick(dt);
        if (position) head.position.z = position.token * 0.01;
        if (position && !reduced) {
          // x stays well beyond the seven-unit building envelope, regardless of
          // the length of the current building. Height is fixed by kind.
          const z = position.token * 0.01, h = position.item.height;
          camera.position.set(24 + h, h + 17, z - 15); controls.target.set(0, h / 2, z); camera.lookAt(controls.target);
        }
      } else if (owner === 'orbit') controls.update();
      heightScale = reduced ? targetHeightScale : THREE.MathUtils.damp(heightScale, targetHeightScale, 6, dt);
      city.group.scale.y = heightScale;
      city.tick(dt, reduced); effects.tick(dt,reduced); effects.group.visible=modes.get()!=='inside';
      trail.visible=head.visible&&!reduced&&owner==='reader';
      const air=atmosphere.tick(dt,reduced,modes.get()==='inside');
      for(const u of windowGroup?.userData.walls??[]){u.time.value=air.time;u.alarm.value=air.fill>.85?1:0;}
      camera.updateMatrixWorld();
      labels.update(camera, width, height, hidden, modes.get() !== 'inside', heightScale, viewInsets.top);
      atmosphere.render();
    } catch (err) { renderer.setAnimationLoop(null); emit('onError', err); }
  });
  return api;
}
