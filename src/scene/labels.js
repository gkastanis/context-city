import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { freeViewport } from './metropolis-model.js';
import { colorFor, THEME } from './theme.js';
export { wrapText } from './paging.js';
import { wrapPixels, looksJson, jsonTokens, CONTINUED } from './paging.js';

// Syntax colours chosen for dark ink on light paper.
const JSON_INK = { key: '#0f4f86', string: '#1d6b34', number: '#a8461c', literal: '#7d2e94', punct: '#6d7a83', plain: '#1b2730' };

// Measure the HTML HUD only when its layout changes, never in update(). A
// panel may move without resizing when an ancestor changes class (phone menu,
// title expansion, timeline tools), so watch those visibility changes too.
const HUD_PANELS = '.identity, #phone-menu, #phone-menu nav, #menu-toggle, #index-panel, #reader-panel, #field-guide, #findings-panel, #guess-card, #timeline, #subagent-breadcrumb, #subagent-banner, .session-messages, #city-intro, #discovery-toast, dialog';
function hudOcclusion(container) {
  const host = container.closest('#app') ?? container.parentElement;
  const panels = [...host.querySelectorAll(HUD_PANELS)];
  let rects = [], pending = 0, disposed = false;
  function measure() {
    pending = 0;
    const origin = container.getBoundingClientRect();
    rects = panels.filter(n => n.checkVisibility({ visibilityProperty: true, opacityProperty: true })).map(n => n.getBoundingClientRect())
      .filter(r => r.width > 0 && r.height > 0)
      .map(r => ({ x: r.left-origin.left, y: r.top-origin.top, w: r.width, h: r.height }));
  }
  function schedule() { if (!disposed && !pending) pending = requestAnimationFrame(measure); }
  const sizes = new ResizeObserver(schedule);
  for (const panel of [container, ...panels]) sizes.observe(panel);
  const changes = new MutationObserver(schedule);
  const ancestors = new Set(panels);
  for (const panel of panels) for (let n = panel.parentElement; n; n = n.parentElement) ancestors.add(n);
  // Do not observe the scene subtree: its pooled labels write styles every
  // frame. Panel content size changes are already covered by ResizeObserver.
  for (const n of ancestors) changes.observe(n, { attributes: true, attributeFilter: ['class', 'hidden', 'open', 'style'] });
  // Font metrics can change after the first resize notification.
  document.fonts?.ready.then(schedule);
  measure();
  return {
    measure, rects: () => rects,
    intersects: (x,y,w,h) => rects.some(r => x < r.x+r.w && x+w > r.x && y < r.y+r.h && y+h > r.y),
    dispose() { disposed = true; sizes.disconnect(); changes.disconnect(); cancelAnimationFrame(pending); },
  };
}
function drawCodeLine(ctx, line, x, y) {
  const continued = line.includes(CONTINUED);
  if (!continued && !looksJson(line)) { ctx.fillStyle = JSON_INK.plain; ctx.fillText(line, x, y); return; }
  const indent = line.match(/^ */)[0].length, cw = ctx.measureText(' ').width;
  ctx.fillStyle = '#d6d0c0';
  for (let k = 0; k < indent - (continued ? 2 : 0); k += 2) ctx.fillRect(x + k * cw + cw * .4, y - 2, 1.5, 21);
  // A continued piece is almost always the rest of a long string value.
  if (continued) { ctx.fillStyle = JSON_INK.string; ctx.fillText(line.replace(CONTINUED, ''), x, y); return; }
  let cx = x;
  for (const run of jsonTokens(line)) { ctx.fillStyle = JSON_INK[run.kind]; ctx.fillText(run.text, cx, y); cx += ctx.measureText(run.text).width; }
}

export function createLabels(container) {
  const root = document.createElement('div');
  Object.assign(root.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
  root.className='context-city-labels';
  root.setAttribute('aria-hidden', 'true'); container.append(root);
  const hud = hudOcclusion(container);
  let freeCache=null, freeRects=null, freeWidth=0, freeHeight=0;
  const measure = document.createElement('canvas').getContext('2d');
  // A fixed pool, rather than a DOM node for each block.
  const pool = Array.from({ length: 62 }, () => {
    const el = document.createElement('span');
    Object.assign(el.style, { position: 'absolute', whiteSpace: 'nowrap', background: THEME.background,
      padding: '3px 6px', borderRadius: '3px', display: 'none' });
    root.append(el); return el;
  });
  let ranked = [], buildings = [], districts = [], gates = [], ticks = [], agents = [], previousSession = null;
  const cache = new Map();
  function set(layout, session) {
    if (session !== previousSession) { cache.clear(); previousSession = session; }
    function record(text, layer, position, district, gate = false) {
      const font = district ? '700 15px "Arial Narrow", sans-serif' : '12px monospace'; measure.font = font;
      return { text, layer, position, district, gate, font, width: measure.measureText(text).width + 12 };
    }
    agents=layout.districts.filter(d=>d.agent).map(d=>({...record(d.label,null,new THREE.Vector3(d.x,d.labelHeight,d.z0),true),agent:true,color:d.color,metropolis:d.metropolis,hovered:d.hovered}));
    districts = layout.districts.filter(d => !d.gate && !d.tick && !d.agent).map(d => record(d.label, d.layer,
      new THREE.Vector3(-6, 12, (d.z0 + d.z1) / 2), true));
    gates = layout.districts.filter(d => d.gate).map(d => record(d.label, null,
      new THREE.Vector3(0, d.labelHeight, d.z0), true, true));
    ticks=layout.districts.filter(d=>d.tick).map(d=>({...record(d.label,null,new THREE.Vector3(9,.5,d.z0),false),tick:true}));
    buildings = layout.items.map(it => {
      const tokens = Math.round((it.z1 - it.z0) * 100), key = JSON.stringify([it.blockId, tokens]);
      let r = cache.get(key);
      if (!r) {
        r = record(`${it.label} · ~${tokens.toLocaleString('en-US')} tokens · ${session.blocks[it.blockId].provenance}`, it.layer, null, false);
        const block = session.blocks[it.blockId];
        const shortTokens = tokens >= 1000 ? `${+(tokens / 1000).toFixed(1)}K` : String(tokens);
        r.short = record(`${block.toolName || it.label}${block.kind === 'tool_result' && block.toolName ? ' result' : ''}, ${shortTokens}`, it.layer, null, false);
        cache.set(key, r);
        if (cache.size > 20000) cache.delete(cache.keys().next().value);
      }
      return { ...r, tokens, isNew: it.blockId === layout.newestBlockId || it.isNew, position: new THREE.Vector3(0, it.height + 2, (it.z0 + it.z1) / 2) };
    });
    ranked = [...buildings].sort((a,b) => b.tokens - a.tokens);
  }
  function lowerBound(z) {
    let lo = 0, hi = buildings.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (buildings[mid].position.z < z) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function update(camera, width, height, hidden, visible, heightScale = 1, topInset = 0) {
    const occupied = []; let used = 0, count = 0;
    const story = [];
    for (const r of ranked) {
      if (story.length >= 5) break;
      if (hidden.has(r.layer)) continue;
      const p = r.position.clone(); if (!r.gate && !r.tick && !r.agent) p.y *= heightScale; p.project(camera);
      if (p.z >= -1 && p.z <= 1 && Math.abs(p.x) < .94 && Math.abs(p.y) < .9) story.push({ ...r, ...r.short, position: r.position, story: true });
    }
    const newest = buildings.findLast(r => r.isNew);
    if (newest) story.unshift({ ...newest, text: 'new', width: 36, story: true });
    const near = Math.hypot(camera.position.x, camera.position.y - 4) < 100;
    function* candidates() {
      yield* gates;
      yield* story;
      for(const a of agents)if(a.hovered||a.metropolis||camera.position.distanceTo(a.position)<600)yield a;
      if (near) {
        for (let i = lowerBound(camera.position.z - 110); i < buildings.length && buildings[i].position.z <= camera.position.z + 110; i++) yield buildings[i];
      } else yield* districts;
      for(const t of ticks)if(Math.abs(t.position.z-camera.position.z)<600)yield t;
    }
    if (visible) for (const r of candidates()) {
      // Gates are visited first, so both independent gate slots are already handled.
      if (count >= 60 || used >= pool.length) break;
      if (!r.gate && hidden.has(r.layer)) continue;
      if (!r.story && !r.district && camera.position.distanceTo(r.position) > 110) continue;
      const p = r.position.clone(); if (!r.gate && !r.tick && !r.agent) p.y *= heightScale; p.project(camera);
      if (p.z < -1 || p.z > 1) continue;
      const w = r.width + 2, h = r.district ? 27 : 22;
      let x = (p.x + 1) * width / 2 - w / 2, y = (1 - p.y) * height / 2 - h;
      const anchorY = y;
      if(r.gate && Math.abs(p.x)<1.2 && Math.abs(p.y)<1.2){x=Math.max(4,Math.min(width-w-4,x));y=Math.max(4,Math.min(height-h-4,y));}
      if (x < 4 || x + w > width - 4 || y < 4 || y + h > height - 4) continue;
      const overlaps = () => occupied.some(b => x < b.x + b.w + 8 && x + w + 8 > b.x && y < b.y + b.h + 6 && y + h + 6 > b.y);
      if (r.story) for (let n=0; n<5 && overlaps(); n++) y -= 28;
      if (y < (r.story ? Math.max(4, topInset) : 4) || (!r.gate && overlaps())) continue;
      if (hud.intersects(x,y,w,h)) continue;
      occupied.push({ x, y, w, h });
      const el = pool[used++]; if (!r.gate) count++;
      // Keep district chips from adding DOM style writes while the camera rests.
      const prior=el.labelSignature;
      if(r.agent&&prior&&prior.text===r.text&&prior.color===r.color&&prior.font===r.font&&prior.x===x&&prior.y===y&&prior.anchorY===anchorY&&el.style.display==='block')continue;
      el.labelSignature=r.agent?{text:r.text,color:r.color,font:r.font,x,y,anchorY}:null;
      el.className=`context-city-label ${r.gate?'context-city-label--gate':r.tick?'context-city-label--tick':r.district?'context-city-label--district':'context-city-label--block'}`;
      if(r.layer)el.dataset.layer=r.layer;else delete el.dataset.layer;
      el.style.setProperty('--label-lift', `${Math.max(0, anchorY-y)}px`);
      el.style.setProperty('--layer-color',r.color??(r.gate?THEME.ink:colorFor(r.layer)));
      el.style.border=r.agent?`1px solid ${r.color}`:'';
      el.textContent = r.text;
      Object.assign(el.style, { display: 'block', font: `var(--context-city-label-font, ${r.font})`, color: r.agent?THEME.ink:r.gate ? THEME.ink : colorFor(r.layer), left: `${x}px`, top: `${y}px` });
    }
    for (; used < pool.length; used++) pool[used].style.display = 'none';
  }
  return { set, update, freeRegion(width,height,refresh=true) {
      if(refresh)hud.measure();
      if(freeRects!==hud.rects()||freeWidth!==width||freeHeight!==height){
        const next=freeViewport(width,height,hud.rects());
        if(!next||!freeCache||Object.keys(next).some(k=>next[k]!==freeCache[k]))freeCache=next;
        freeRects=hud.rects();freeWidth=width;freeHeight=height;
      }
      return freeCache;
    }, dispose() { hud.dispose(); root.remove(); cache.clear(); previousSession = null; ranked = []; buildings = []; districts = []; gates = []; } };
}

// Meshes are cheap placeholders. Canvas/GPU allocation happens near the walker.
// Font loading gates the first canvas draw, including fallback after a failed load.
let pageFontsReady = !globalThis.document?.fonts;
export const pageFonts = globalThis.document?.fonts
  // A stalled font download must not leave the sheets blank: fall back after 2.5 s.
  ? Promise.race([Promise.allSettled([document.fonts.load('19px "IBM Plex Mono"'), document.fonts.load('600 28px "IBM Plex Sans"')]),
      new Promise(resolve => setTimeout(resolve, 2500))]).then(() => { pageFontsReady = true; })
  : Promise.resolve();
export function pageMeasure() {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = '19px "IBM Plex Mono", monospace';
  return text => ctx.measureText(text).width;
}
export function textPage(title, subtitle, lines, color, compact = false, options = {}) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(compact ? 3.9 : 6, compact ? 1.05 : 3),
    new THREE.MeshBasicMaterial({ color: '#f3f0e8', side: THREE.DoubleSide, toneMapped: false }));
  const edge = new THREE.Mesh(new THREE.PlaneGeometry(compact ? 4.02 : 6.12, compact ? 1.17 : 3.12),
    new THREE.MeshBasicMaterial({ color: '#48535b', side: THREE.DoubleSide, toneMapped: false }));
  edge.position.z = -.025; mesh.add(edge);
  mesh.userData.buildTexture = () => {
    if (!pageFontsReady) return null;
    const canvas = document.createElement('canvas');
    const scale = options.quality?.() === 'low' ? 1 : 2;
    canvas.width = 1024 * scale; canvas.height = (compact ? 276 : 512) * scale;
    const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
    ctx.fillStyle = '#f3f0e8'; ctx.fillRect(0, 0, 1024, 512);
    ctx.fillStyle = color; ctx.fillRect(0, 0, 1024, compact ? 140 : 65);
    ctx.textBaseline = 'top'; ctx.font = compact ? '600 52px "IBM Plex Sans", sans-serif' : '600 28px "IBM Plex Sans", sans-serif'; ctx.fillStyle = '#17232c';
    const headings = wrapPixels(title, 936, t => ctx.measureText(t).width, compact ? 2 : 1);
    headings.forEach((line, i) => ctx.fillText(line, 44, 17 + i * (compact ? 56 : 34)));
    ctx.font = compact ? '36px "IBM Plex Sans", sans-serif' : '18px "IBM Plex Sans", sans-serif'; ctx.fillStyle = '#46525b';
    wrapPixels(subtitle, 936, t => ctx.measureText(t).width, compact ? 2 : 1)
      .forEach((line, i) => ctx.fillText(line, 44, (compact ? 160 : 78) + i * (compact ? 43 : 25)));
    ctx.font = '19px "IBM Plex Mono", monospace'; ctx.fillStyle = '#1b2730';
    const wrapped = lines.flatMap(line => wrapPixels(line, 936, t => ctx.measureText(t).width));
    wrapped.slice(0, 18).forEach((line, i) => drawCodeLine(ctx, line, 44, 111 + i * 21));
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = options.anisotropy ?? 1; map.generateMipmaps = true; map.minFilter = THREE.LinearMipmapLinearFilter;
    return map;
  };
  return mesh;
}
