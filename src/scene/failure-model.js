// A cap clears the district skyline; the stem starts at the failed roof.
export function failurePin(roof, skyline, visible = true) {
  const top = Math.max(roof, skyline) + 8;
  return { base: roof + .15, height: top - roof, visible };
}

export function districtSkylines(layout) {
  const heights = new Map(layout.items.map(it => [it.blockId, it.height]));
  const skyline = new Map();
  for (const district of layout.districts) {
    const maximum = Math.max(0, ...district.blockIds.map(id => heights.get(id) ?? 0));
    for (const id of district.blockIds) skyline.set(id, maximum);
  }
  return skyline;
}
