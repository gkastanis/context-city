import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { colorFor, THEME } from './theme.js';
export { wrapText } from './paging.js';

export function createLabels(container) {
  const root = document.createElement('div');
  Object.assign(root.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
  root.className='context-city-labels';
  root.setAttribute('aria-hidden', 'true'); container.append(root);
  const measure = document.createElement('canvas').getContext('2d');
  // A fixed pool, rather than a DOM node for each block.
  const pool = Array.from({ length: 62 }, () => {
    const el = document.createElement('span');
    Object.assign(el.style, { position: 'absolute', whiteSpace: 'nowrap', background: THEME.background,
      padding: '3px 6px', borderRadius: '3px', display: 'none' });
    root.append(el); return el;
  });
  let ranked = [], buildings = [], districts = [], gates = [], ticks = [], previousSession = null;
  const cache = new Map();
  function set(layout, session) {
    if (session !== previousSession) { cache.clear(); previousSession = session; }
    function record(text, layer, position, district, gate = false) {
      const font = district ? '700 15px "Arial Narrow", sans-serif' : '12px monospace'; measure.font = font;
      return { text, layer, position, district, gate, font, width: measure.measureText(text).width + 12 };
    }
    districts = layout.districts.filter(d => !d.gate && !d.tick).map(d => record(d.label, d.layer,
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
      const p = r.position.clone(); if (!r.gate && !r.tick) p.y *= heightScale; p.project(camera);
      if (p.z >= -1 && p.z <= 1 && Math.abs(p.x) < .94 && Math.abs(p.y) < .9) story.push({ ...r, ...r.short, position: r.position, story: true });
    }
    const newest = buildings.findLast(r => r.isNew);
    if (newest) story.unshift({ ...newest, text: 'new', width: 36, story: true });
    const near = Math.hypot(camera.position.x, camera.position.y - 4) < 100;
    function* candidates() {
      yield* gates;
      yield* story;
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
      const p = r.position.clone(); if (!r.gate && !r.tick) p.y *= heightScale; p.project(camera);
      if (p.z < -1 || p.z > 1) continue;
      const w = r.width, h = r.district ? 25 : 22;
      let x = (p.x + 1) * width / 2 - w / 2, y = (1 - p.y) * height / 2 - h;
      const anchorY = y;
      if(r.gate && Math.abs(p.x)<1.2 && Math.abs(p.y)<1.2){x=Math.max(4,Math.min(width-w-4,x));y=Math.max(4,Math.min(height-h-4,y));}
      if (x < 4 || x + w > width - 4 || y < 4 || y + h > height - 4) continue;
      const overlaps = () => occupied.some(b => x < b.x + b.w + 8 && x + w + 8 > b.x && y < b.y + b.h + 6 && y + h + 6 > b.y);
      if (r.story) for (let n=0; n<5 && overlaps(); n++) y -= 28;
      if (y < (r.story ? Math.max(4, topInset) : 4) || (!r.gate && overlaps())) continue;
      occupied.push({ x, y, w, h });
      const el = pool[used++]; if (!r.gate) count++;
      el.className=`context-city-label ${r.gate?'context-city-label--gate':r.tick?'context-city-label--tick':r.district?'context-city-label--district':'context-city-label--block'}`;
      if(r.layer)el.dataset.layer=r.layer;else delete el.dataset.layer;
      el.style.setProperty('--label-lift', `${Math.max(0, anchorY-y)}px`);
      el.style.setProperty('--layer-color',r.gate?THEME.ink:colorFor(r.layer));
      el.textContent = r.text;
      Object.assign(el.style, { display: 'block', font: `var(--context-city-label-font, ${r.font})`, color: r.gate ? THEME.ink : colorFor(r.layer), left: `${x}px`, top: `${y}px` });
    }
    for (; used < pool.length; used++) pool[used].style.display = 'none';
  }
  return { set, update, dispose() { root.remove(); cache.clear(); previousSession = null; ranked = []; buildings = []; districts = []; gates = []; } };
}

// Meshes are cheap placeholders. Canvas/GPU allocation happens near the walker.
export function textPage(title, subtitle, lines, color, compact = false) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(compact ? 2.6 : 6, compact ? 1 : 3),
    new THREE.MeshBasicMaterial({ color: THEME.ground, side: THREE.DoubleSide }));
  const edge=new THREE.Mesh(new THREE.PlaneGeometry(compact?2.66:6.06,compact?1.06:3.06),new THREE.MeshBasicMaterial({color:new THREE.Color(color).multiplyScalar(1.6),side:THREE.DoubleSide}));edge.position.z=-.01;mesh.add(edge);
  mesh.userData.buildTexture = () => {
    const canvas = document.createElement('canvas');
    canvas.width = compact ? 512 : 1024; canvas.height = compact ? 128 : 512;
    const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    ctx.fillStyle = THEME.ground; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.strokeRect(2, 2, w - 4, h - 4);
    ctx.textBaseline = 'top'; ctx.font = 'bold 26px sans-serif'; ctx.fillStyle = color;
    ctx.fillText(title, 20, 16, w - 40);
    ctx.font = '18px monospace'; ctx.fillStyle = THEME.muted; ctx.fillText(subtitle, 20, 52, w - 40);
    ctx.font = '21px monospace'; ctx.fillStyle = THEME.ink;
    lines.forEach((line, i) => ctx.fillText(line, 20, 90 + i * 23, w - 40));
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    return map;
  };
  return mesh;
}
