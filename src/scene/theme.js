export const LAYERS = Object.freeze({
  system: { label: 'System prompt', color: '#f0a64a' },
  tools: { label: 'Tool definitions', color: '#4fc3d9' },
  user_instructions: { label: 'CLAUDE.md', color: '#ff7a6b' },
  memory: { label: 'Memory', color: '#a58cff' },
  menus: { label: 'Menus', color: '#6fd3a6' },
  harness: { label: 'Session facts', color: '#b7c0d8' },
  message: { label: 'User prompt', color: '#fff2c4' },
  assistant: { label: 'Assistant', color: '#a4b0ce' },
  tool_call: { label: 'Tool calls', color: '#72b9bd' },
  results: { label: 'Results', color: '#8aa9ff' },
  mcp: { label: 'MCP', color: '#ff8fd0' },
});
export const THEME = Object.freeze({ background: '#0a0e19', ground: '#101727',
  ink: '#e6e9f3', muted: '#98a2bf', compact: '#b49a66', end: '#b27b73', road: '#34405b' });
export const colorFor = layer => LAYERS[layer]?.color ?? THEME.muted;
