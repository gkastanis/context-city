// Logical x follows the main road (world Z); y measures distance across the canal.
export function canalWidth(mainLength, footprint = 7) { return Math.max(footprint * 3, mainLength * .08); }

export function districtLayout(positions, branches, sizes, canal = canalWidth(positions.end ?? 0)) {
  const maxDepth = Math.max(0, ...sizes.map(s => s.depth));
  const smallCity = (positions.end ?? 0) < 200;
  const street = smallCity ? 14 : 8;
  const rects = [];
  const end = Math.max(0, ...Object.values(positions)) + 30;
  let unlinkedEnd = end;
  for (const size of sizes) {
    const b = branches.find(b => b.agentId === size.agentId);
    const lane = b?.lane ?? 0;
    const anchor = b && (b.forkBlockId ?? b.mergeBlockId);
    const linked = anchor != null && Number.isFinite(positions[anchor]);
    let x = linked ? positions[anchor] : unlinkedEnd + size.width / 2;
    const y = 10 + canal + lane * (maxDepth + 12) + size.depth / 2;
    let collision;
    do {
      // Small fixtures need distinct silhouettes as well as separate plates:
      // stagger their longitudinal slots even when they occupy different lanes.
      collision = rects.find(r => (smallCity || Math.abs(y-r.y) < (size.depth+r.depth)/2+8) && Math.abs(x-r.x) < (size.width+r.width)/2+street);
      // Leave a small clearance beyond the comparison boundary. Fractional
      // token footprints must not reselect the same rectangle through rounding.
      if (collision) x = Math.max(x+.01,collision.x + (collision.width + size.width)/2 + street + .01);
    } while (collision);
    rects.push({ ...size, x, y, lane, linked });
    if (!linked) unlinkedEnd = x + size.width/2 + 12;
  }
  return rects;
}

export function bridgeWidth(tokens) { return Math.min(3.5, Math.max(.3, Math.sqrt(Math.max(0, tokens)) * .035)); }
export function districtBridgeWidth(tokens, footprint = 7) { return Math.max(.6 * footprint, bridgeWidth(tokens) * footprint); }

// Bounds describe actual plots, not a tall cuboid over the entire canal.
// Pending plots stay drawn but do not contribute to framing.
export function metropolisBounds(layout, districts) {
  const boxes = [{ x0: -3.5, x1: 3.5, z0: 0, z1: Math.max(1, layout.totalTokens * .01),
    high: Math.max(12, ...layout.items.map(it => it.height)) }, ...districts.filter(r => r.state !== 'pending').map(r => ({
    x0: r.y - r.depth / 2, x1: r.y + r.depth / 2,
    z0: r.x - r.width / 2, z1: r.x + r.width / 2,
    high: Math.max(.1, ...r.grid.cells.map(c => c.height)),
  }))];
  return { boxes, x0: Math.min(...boxes.map(b => b.x0)), x1: Math.max(...boxes.map(b => b.x1)),
    z0: Math.min(...boxes.map(b => b.z0)), z1: Math.max(...boxes.map(b => b.z1)),
    high: Math.max(...boxes.map(b => b.high)) };
}

// The convex skyline has the same perspective extrema as all main buildings.
// Keep its corners rather than testing thousands of interior points per view.
export function skylineCorners(layout) {
  const points = layout.items.flatMap(it => [[it.z0, it.height], [it.z1, it.height]]);
  points.push([0, 0], [layout.totalTokens * .01, 0]);
  points.sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half = values => { const hull=[];for(const p of values){while(hull.length>1&&cross(hull.at(-2),hull.at(-1),p)<=0)hull.pop();hull.push(p);}return hull.slice(0,-1); };
  return [...half(points), ...half([...points].reverse())].flatMap(([z,y]) => [-3.5,3.5].map(x => ({x,y,z})));
}

// Largest axis-aligned canvas rectangle left unobstructed by visible HUD panels.
export function freeViewport(width, height, panels) {
  const rects=panels.map(r=>({x:Math.max(0,r.x),y:Math.max(0,r.y),
    right:Math.min(width,r.x+r.w),bottom:Math.min(height,r.y+r.h)}))
    .filter(r=>r.right>r.x&&r.bottom>r.y);
  const xs=[...new Set([0,width,...rects.flatMap(r=>[r.x,r.right])])].sort((a,b)=>a-b);
  let best={x:0,y:0,w:width,h:height},area=-1;
  for(let i=0;i<xs.length-1;i++)for(let j=i+1;j<xs.length;j++){
    const blocked=rects.filter(r=>r.x<xs[j]&&r.right>xs[i]).sort((a,b)=>a.y-b.y);
    let top=0;
    for(const r of [...blocked,{y:height,bottom:height}]){
      const w=xs[j]-xs[i],h=r.y-top;
      if(w*h>area){area=w*h;best={x:xs[i],y:top,w,h};}
      top=Math.max(top,r.bottom);
    }
  }
  return area>0?best:null;
}

export function runState(branch, mainIdx, mainTime, requests) {
  if (mainIdx < branch.fork) return { state: 'pending', idx: -1 };
  if (!branch.open && mainIdx >= branch.merge) return { state: 'merged', idx: requests.length - 1 };
  let idx = -1;
  if (Number.isFinite(mainTime)) requests.forEach((r, i) => { if (Number.isFinite(r.time) && r.time <= mainTime) idx = i; });
  if (idx < 0 && (!Number.isFinite(mainTime) || !requests.some(r => Number.isFinite(r.time)))) idx = Math.floor((mainIdx-branch.fork) / Math.max(1, branch.merge-branch.fork) * Math.max(0, requests.length-1));
  return { state: branch.open ? 'open' : 'running', idx: Math.max(0, Math.min(requests.length-1, idx)) };
}

// Keep the city's volume encoding, but fold its long blocks into tower plots.
// The 7-unit city frontage is the typical plot; excess volume rises vertically.
export function districtGrid(items) {
  const cells = items.flatMap(it => {
    const volume = 7 * it.height * (it.z1-it.z0) * .96;
    const side = Math.min(7, Math.max(.7, Math.sqrt(7 * (it.z1-it.z0) * .96)));
    // A long main-city slab becomes a tower group, keeping both its total volume
    // and the city's 220-unit skyline ceiling. Adjacent plots retain block order.
    const count = Math.max(1, Math.ceil(volume / (side * side * 220)));
    const height = volume / (side * side * count);
    return Array.from({length:count},()=>({ blockId: it.blockId, height, side, layer: it.layer, kind: it.kind }));
  });
  const target = Math.max(12, ...cells.map(c => c.side+1), Math.sqrt(cells.reduce((n,c) => n+(c.side+1)**2,0)));
  let x=0, y=0, row=0, width=0;
  for (const c of cells) {
    if (x && x+c.side+1 > target) { y+=row; x=0; row=0; }
    c.x=x+c.side/2+2; c.y=y+c.side/2+2;
    x+=c.side+1; row=Math.max(row,c.side+1); width=Math.max(width,x+2);
  }
  const depth=Math.max(8,y+row+2);
  return { cells, width: Math.max(8,width), depth };
}
