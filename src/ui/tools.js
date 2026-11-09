import { forEachRequestChange } from './compact.js';
import { runLabel } from './agents.js';


// First match wins. Keep categories deliberately broad and explainable.
export const errorRules = [
  ['Not found', /not found|no such file|does not exist|ENOENT|command not found/i],
  ['Permission / rejected', /permission denied|permission to use|denied by|user (?:rejected|denied|doesn\x27t want)|not allowed|unauthori[sz]ed|EACCES/i],
  ['Input validation', /InputValidationError|schema validation|invalid (?:input|argument|param)|validation (?:error|failed)/i],
  ['Timeout', /time[ -]?out|timed out|deadline exceeded/i],
  ['Non-zero exit', /(?:exit(?:ed)?(?: with)?(?: code| status)?|return code)\s*[:=]?\s*[1-9]\d*|non[- ]zero/i],
  ['MCP / server', /\bmcp\b|server error|internal error|connection (?:closed|refused|reset)|JSON.?RPC/i],
];
export function errorCategory(text, tool = '') {
  return errorRules.find(([category, rule]) => (category !== 'Non-zero exit' || /^(?:Bash|bash|shell|exec_command)$/.test(tool)) && rule.test(text ?? ''))?.[0] ?? 'Other';
}
export function toolIdentity(name = 'Unknown tool') {
  const match = /^mcp__(.+?)__(.+)$/.exec(name) ?? /^mcp:([^/]+)\/(.+)$/.exec(name);
  return { tool: name, server: match?.[1] ?? null, shortName: match?.[2] ?? name };
}
const size = b => Math.max(0, Number.isFinite(b?.estTokens) ? b.estTokens : 0);
const json = text => { try { return JSON.parse(text); } catch { return null; } };
export function callInput(block) {
  const value = json(block?.text);
  return value && Object.hasOwn(value, 'input') ? JSON.stringify(value.input, null, 2) : block?.text ?? '';
}
export function resultText(block) {
  const value = json(block?.text);
  if (!value || !Object.hasOwn(value, 'content')) return block?.text ?? '';
  return typeof value.content === 'string' ? value.content : (value.content ?? []).filter(p => p.type === 'text').map(p => p.text).join('\n');
}
export function distribution(values) {
  if (!values.length) return { total: 0, median: null, max: null };
  const sorted = [...values].sort((a,b) => a-b), half = Math.floor(sorted.length/2);
  return { total: values.reduce((n,x) => n+x,0), median: sorted.length%2 ? sorted[half] : (sorted[half-1]+sorted[half])/2, max: sorted.at(-1) };
}
// Reader counters and navigation share this exact scope, including external selections.
export function failureScope(items, active, all) { return active && !items.includes(active) ? all : items; }
export function toolLabel(name) {
  const { server, shortName } = toolIdentity(name);
  return server ? `${server} / ${shortName}` : shortName;
}
const memo = new WeakMap();
export function toolReport(session) {
  if (memo.has(session)) return memo.get(session);
  const tools = new Map(), failed = [], allCalls = [];
  const get = name => {
    if (!tools.has(name)) tools.set(name, { ...toolIdentity(name), calls: 0, failures: 0, retries: 0, identicalInputs: 0,
      definitionTokens: 0, definitionRequests: 0, definitionCost: 0, categories: {}, runs: [], callList: [], outputs: [], latencies: [] });
    return tools.get(name);
  };
  const runs = [{ session, agentId: null, label: 'Main' }, ...(session.agents ?? []).map(r => ({ ...r, label: runLabel(r, session.agents) }))];
  for (const run of runs) {
    const seen = new Set(), calls = new Map(), results = new Map(), ordered = [], repeats = new Set(), defStats = new Map(), activeDefs = new Map();
    forEachRequestChange(run.session, (request, idx, ids, removed, keep) => {
      for (const id of removed) if (activeDefs.has(id)) { const d = defStats.get(id); d.requests += idx-d.start; activeDefs.delete(id); }
      for (let pos = keep; pos < ids.length; pos++) {
        const b = run.session.blocks[ids[pos]]; if (!b) continue;
        if (b.kind === 'tool_def' || (b.kind === 'system' && b.toolName)) {
          if (!activeDefs.has(b.id)) { const d = defStats.get(b.id) ?? { b, requests: 0 }; d.start = idx; defStats.set(b.id,d); activeDefs.set(b.id,true); }
          continue;
        }
        if (seen.has(b.id)) continue; seen.add(b.id);
        const parsed = json(b.text), link = b.toolUseId ?? parsed?.id ?? parsed?.tool_use_id ?? b.id;
        if (b.kind === 'tool_use') {
          const tool = b.toolName || parsed?.name || 'Unknown tool', report = get(tool);
          const input = callInput(b), key = tool+'\0'+input;
          const call = { ...toolIdentity(tool), blockId: b.id, callBlockId: b.id, requestIdx: idx, requestNumber: idx+1, agentId: run.agentId, run: run.label, input, time: b.time ?? null, result: null };
          if (repeats.has(key)) report.identicalInputs++; repeats.add(key);
          calls.set(link,call); ordered.push(call); report.calls++; report.callList.push(call); allCalls.push(call);
        } else if (b.kind === 'tool_result' || (b.kind === 'attachment' && b.layer === 'results')) {
          const result = results.get(link) ?? { blocks: [], requestIdx: idx }; result.blocks.push(b); results.set(link,result);
        }
      }
    });
    for (const [id] of activeDefs) { const d = defStats.get(id); d.requests += run.session.requests.length-d.start; }
    for (const { b, requests } of defStats.values()) {
      const t = get(b.toolName || b.label); t.definitionTokens = Math.max(t.definitionTokens,size(b)); t.definitionRequests += requests; t.definitionCost += requests*size(b);
    }
    for (const [link, result] of results) {
      const call = calls.get(link), blocks = result.blocks;
      const tool = call?.tool ?? blocks.find(b=>b.toolName)?.toolName ?? 'Unknown tool', t = get(tool);
      const tokens = blocks.reduce((n,b)=>n+size(b),0), errorText = blocks.filter(b=>b.kind==='tool_result').map(resultText).join('\n');
      t.outputs.push(tokens);
      const isError = blocks.some(b=>b.isError === true);
      if (call) {
        call.result = { blockId: blocks.find(b=>b.kind==='tool_result')?.id ?? blocks[0].id, requestIdx: result.requestIdx, isError };
        // Never use request.time: it may have been interpolated. Own record times only.
        const end = blocks.find(b=>Number.isFinite(b.time))?.time;
        if (Number.isFinite(call.time) && Number.isFinite(end) && end>=call.time) t.latencies.push(end-call.time);
      }
      if (!isError) continue;
      const category = errorCategory(errorText,tool); t.failures++; t.categories[category] = (t.categories[category] ?? 0)+1;
      failed.push({ ...toolIdentity(tool), blockId: call?.result.blockId ?? blocks[0].id, resultBlockIds: blocks.map(b=>b.id),
        callBlockId: call?.blockId ?? null, callRequestIdx: call?.requestIdx ?? null, input: call?.input ?? '', errorText, category,
        requestIdx: result.requestIdx, requestNumber: result.requestIdx+1, agentId: run.agentId, run: run.label,
        time: blocks.find(b=>Number.isFinite(b.time))?.time ?? null, orderTime: blocks.find(b=>Number.isFinite(b.time))?.time ?? run.session.requests[result.requestIdx]?.time ?? null, tokens, errorTokens: Math.ceil(errorText.length / 4), retried: false });
    }
    for (let i=1;i<ordered.length;i++) {
      const previous = ordered[i-1], call = ordered[i];
      if (previous.tool !== call.tool || !previous.result?.isError || previous.result.requestIdx >= call.requestIdx) continue;
      get(call.tool).retries++;
      const f = failed.find(f=>f.agentId===run.agentId && f.callBlockId===previous.blockId); if (f) f.retried=true;
    }
    for (const t of tools.values()) {
      const mine = t.callList.filter(c=>c.agentId===run.agentId);
      const errors = failed.filter(f=>f.agentId===run.agentId && f.tool===t.tool).length;
      if (mine.length || errors) t.runs.push({ agentId: run.agentId, run: run.label, calls: mine.length, failures: errors });
    }
  }
  const rows = [...tools.values()].map(({outputs,latencies,...t})=>({ ...t, failureRate: t.calls ? t.failures/t.calls : 0, resultTokens: distribution(outputs), latency: distribution(latencies) }));
  // Request timing can order results across runs, but never enters latency.
  // Undated runs retain their request order after the dated results.
  failed.sort((a,b)=> (a.orderTime ?? Infinity)-(b.orderTime ?? Infinity));
  const unused = rows.filter(t=>!t.calls && t.definitionRequests>0);
  const report = { tools: rows, failures: failed, calls: allCalls, unused, unusedTokens: unused.reduce((n,t)=>n+t.definitionTokens,0), unusedCost: unused.reduce((n,t)=>n+t.definitionCost,0) };
  memo.set(session,report); return report;
}
export function failures(session) { return toolReport(session).failures; }
export function filterFailures(items, filters = {}) {
  return items.filter(f => Object.entries(filters).every(([key,value]) => value === undefined || f[key] === value));
}
export function stepFailure(items, active, delta) {
  if (!items.length) return null;
  const at = items.indexOf(active);
  return items[(at < 0 ? delta<0 ? items.length-1 : 0 : (at+delta+items.length)%items.length)];
}
const fenced = (text, language='') => {
  const longest = Math.max(2,...[...String(text).matchAll(/`+/g)].map(m=>m[0].length));
  const fence = '`'.repeat(longest+1); return `${fence}${language}\n${text}\n${fence}`;
};
export function issueMarkdown(failure) {
  return `## Failed tool call: ${failure.tool}\n\nServer: ${failure.server ?? 'Built-in'}\nCategory: ${failure.category}\n\n### Input\n\n${fenced(failure.input,'json')}\n\n### Error\n\n${fenced(failure.errorText)}\n`;
}
