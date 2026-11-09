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
