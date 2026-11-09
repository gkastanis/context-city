// Panels are ordered from least to most recently opened.
export function panelState(openPanels, target, open, narrow) {
  const remaining = openPanels.filter(id => id !== target);
  return open ? [...(narrow ? [] : remaining), target] : remaining;
}

// One Escape closes one layer: native dialog, Findings, Menu, zoom,
// inside or reading scene mode, then the newest narrow-screen panel
// or a selection-opened Reader on desktop.
export function escapeAction({ dialog = false, findings = false, menu = false,
  zoom = false, mode = 'city', narrow = false, panels = [], readerOpenedBy = 'nav' } = {}) {
  if (dialog) return 'dialog';
  if (findings) return 'findings';
  if (menu) return 'menu';
  if (zoom) return 'zoom';
  if (mode === 'inside') return 'inside';
  if (mode === 'reading') return 'reading';
  if (narrow && panels.length) return panels[panels.length - 1];
  if (!narrow && readerOpenedBy === 'select' && panels.includes('reader-panel')) return 'reader-panel';
  return null;
}
