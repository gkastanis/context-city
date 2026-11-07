// Resources belong to their subtree. Sharing within a subtree is supported;
// sharing between independently removable subtrees is intentionally avoided.
export function disposeTree(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      materials.add(m);
      for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const t of textures) t.dispose();
  for (const m of materials) m.dispose();
  for (const g of geometries) g.dispose();
  root.removeFromParent(); root.clear();
}
