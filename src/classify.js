// Ordered rules: specific context sources precede generic harness reminders.
export const rules = [
  { test: /^\s*(?:<system-reminder>\s*)?Contents of [^\n]*CLAUDE\.md\b/i, kind: 'reminder', layer: 'user_instructions', label: 'CLAUDE.md' },
  { test: /^\s*(?:<system-reminder>\s*)?Contents of [^\n]*MEMORY\.md\b/i, kind: 'reminder', layer: 'memory', label: 'Memory index' },
  { test: /^\s*(?:<system-reminder>\s*)?(?:# MCP Server Instructions|<mcp_instructions>)/i, kind: 'reminder', layer: 'mcp', label: 'MCP instructions' },
  { test: /^\s*(?:<system-reminder>\s*)?(?:(?:available|following|listed) skills|The following[^\n]*skills\b|skill[_ -]listing|<skills(?:_instructions)?>|## Skills\b)/i, kind: 'reminder', layer: 'menus', label: 'Skills' },
  { test: /^\s*(?:<system-reminder>\s*)?(?:(?:The )?(?:available|following) (?:agents|agent types)|agent[_ -]listing|<available_agents>|## Agents\b)/i, kind: 'reminder', layer: 'menus', label: 'Agents' },
  { test: /^\s*(?:<system-reminder>\s*)?(?:(?:The following[^\n]*deferred tools\b|deferred tools|deferred_tool|<available-deferred-tools>|<available_deferred_tools>))/i, kind: 'reminder', layer: 'menus', label: 'Deferred tools' },
  { test: /^\s*(?:<system-reminder>\s*)?(?:# Environment\b|<environment_context>|<env>|working directory:|platform:|environment information)/i, kind: 'reminder', layer: 'harness', label: 'Environment' },
  { test: /^\s*(?:<system-reminder>\s*)?(?:(?:today.s|current) date|<current_date>|\bdate:\s*\d{4}-\d{2}-\d{2})/i, kind: 'reminder', layer: 'harness', label: 'Date' },
];

export function classify(text, { role = 'user', reminder = false } = {}) {
  // Ordinary user prose is never reinterpreted just because it mentions a file.
  if (reminder || role === 'system') {
    const rule = rules.find(rule => rule.test.test(text));
    if (rule) return { kind: role === 'system' ? 'system' : rule.kind, layer: rule.layer, label: rule.label };
  }
  if (reminder) return { kind: 'reminder', layer: 'harness', label: 'Harness reminder' };
  if (role === 'system') return { kind: 'system', layer: 'system', label: 'System' };
  if (role === 'assistant') return { kind: 'assistant_text', layer: 'assistant', label: 'Assistant' };
  return { kind: 'user_text', layer: 'message', label: 'User' };
}

// Cut only at harness section starts; slicing keeps every delimiter and newline.
function sections(text, role, reminder = false) {
  const starts = [0];
  const headers = /^(?:# Environment\b|# MCP Server Instructions\b|The following[^\n]*(?:skills|deferred tools)\b|Available agent types\b|Contents of [^\n]+(?:\(|:))/gim;
  for (const match of text.matchAll(headers)) if (match.index && !/^\s*(?:<system-reminder>\s*)?$/.test(text.slice(0, match.index))) starts.push(match.index);
  return starts.map((start, i) => {
    const part = text.slice(start, starts[i + 1] ?? text.length);
    return { text: part, ...classify(part, { role, reminder }) };
  });
}

export function splitText(text, role = 'user') {
  if (role === 'system') return sections(text, role);
  if (role !== 'user') return [{ text, ...classify(text, { role }) }];
  const pieces = [];
  const pattern = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > offset) {
      const part = text.slice(offset, match.index);
      pieces.push({ text: part, ...classify(part, { role }) });
    }
    // Preserve the delimiters and whitespace: concatenation recovers API text.
    pieces.push(...sections(match[0], role, true));
    offset = match.index + match[0].length;
  }
  if (offset < text.length || !pieces.length) {
    const part = text.slice(offset);
    pieces.push({ text: part, ...classify(part, { role }) });
  }
  return pieces;
}
