import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createParser } from '../src/parse.js';
import { agentRun, attachAgents, agentBranches } from '../src/ui/agents.js';
import { compactSession } from '../src/ui/compact.js';

// All words, paths, times and usage counts are invented for Lantern.
// Fixed recipe, no randomness or machine metadata enters the public Session.
const stamp = minutes => new Date(Date.UTC(2030, 3, 12, 9) + minutes * 60000).toISOString();
const minute = i => i <= 19 ? i * 1.25 : i * 1.25 + 20;
const runs = [
  { id: 'layout', type: 'Explore', description: 'Find the export layout and page boundaries', fork: 2, merge: 12, count: 22, peak: 60000, returned: 1500 },
  { id: 'settings', type: 'Explore', description: 'Trace settings and export checks', fork: 3, merge: 14, count: 18, peak: 45000, returned: 1500 },
  { id: 'docs', type: 'lookup', description: 'Research PDF print rules and font loading', fork: 6, merge: 17, count: 12, peak: 25000, returned: 2000 },
  { id: 'checks', type: 'test-runner', description: 'Run the PDF matrix and return every diagnostic', fork: 23, merge: 31, count: 16, peak: 28000, returned: 12000 },
  { id: 'review', type: 'reviewer', description: 'Review PDF pagination and keyboard access', fork: 35, merge: 35, count: 14, peak: 35000, returned: 3000, foreground: true },
];
const tools = ['Read', 'Grep', 'Bash', 'Edit', 'Agent', 'TaskOutput'].map(name => ({ name,
  description: `Fictional Lantern ${name} tool. Inspect project documents or report focused checks.`,
  input_schema: { type: 'object', properties: { target: { type: 'string' } } } }));
const prompt = run => `${run.description}. Work on the fictional Lantern PDF export. Inspect the relevant documents and checks. Return evidence, remaining questions and a short summary.`;
function prose(subject, tokens) {
  let text = '', row = 0;
  const checks = ['page breaks preserve headings', 'fonts finish loading before export', 'keyboard focus returns to Export', 'empty pages are omitted', 'dim theme prints with readable contrast', 'long tables repeat their headers'];
  while (text.length < tokens * 4) {
    text += `Lantern ${subject}, case ${++row}: ${checks[row % checks.length]}. The fictional fixture records the expected page count, checks the saved settings and compares the preview with the exported document.\n`;
  }
  return text.slice(0, tokens * 4);
}
function transcript(id, agent, initial) {
  const records = [{ type: 'api-request-shape', shapeHash: 'lantern-shape', shape: {
    system: [`You are the fictional Lantern ${agent ? id : 'main'} coding desk. Read evidence before changing PDF export. All tools and counts in this example are illustrative.`],
    tools: agent ? tools.slice(0, 3) : tools,
  } }], tail = [];
  let serial = 0;
  const blob = (role, content) => {
    const hash = `${id}-blob-${serial++}`;
    records.push({ type: 'api-request-blob', hash, message: { role, content } }); tail.push(hash);
  };
  blob('user', initial);
  return { records, blob,
    result(call, content, at, metadata = null) {
      const message = { role: 'user', content: [{ type: 'tool_result', tool_use_id: call, content }] };
      if (metadata) records.push({ type: 'user', timestamp: stamp(at), toolUseResult: metadata, message });
      blob(message.role, message.content);
    },
    call(name, input, call) { blob('assistant', [{ type: 'tool_use', id: call, name, input }]); },
    request(i, at, peak, reply = null) {
      const ref = `${id}-request-${i}`;
      records.push({ type: 'api-request', id: ref, querySource: agent ? `agent:lantern:${id}` : 'repl_main_thread',
        ...(agent ? { agentId: id } : {}), shapeHash: 'lantern-shape', timestamp: stamp(at), keep: 0, tail: [...tail] });
      records.push({ type: 'assistant', isSidechain: agent, requestRef: ref, timestamp: stamp(at), message: {
        id: `${id}-answer-${i}`, role: 'assistant', model: 'Lantern Demo',
        content: [{ type: 'text', text: reply ?? `Lantern PDF step ${i + 1}: inspect the evidence and check the next page boundary.` }],
        usage: { input_tokens: 800, cache_creation_input_tokens: 1200, cache_read_input_tokens: Math.max(0, peak - 2000), output_tokens: reply ? Math.ceil(reply.length / 4) : 240 + i * 9 },
      } });
    },
  };
}

export async function makeAgentsSample() {
  const directory = await mkdtemp(path.join(tmpdir(), 'lantern-agents-'));
  try {
    await mkdir(path.join(directory, 'subagents'));
    const main = transcript('lantern-pdf', false,
      'Add export to PDF to the fictional Lantern settings page. Preserve headings, long tables and readable print colours. Keep keyboard access and show progress while fonts load.');
    const beats = ['Read the export entry point', 'Map the settings page', 'Inspect page layout', 'Trace saved preferences',
      'Sketch the print document', 'Inspect existing checks', 'Read print guidance', 'Design the export button',
      'Wait for font readiness', 'Build the document shell', 'Add print colours', 'Preserve headings',
      'Compare layout findings', 'Add table headers', 'Compare settings findings', 'Handle empty content',
      'Check page size choices', 'Compare documentation findings', 'Check the preview', 'Pause for the fictional design review',
      'Resume after the review break', 'Implement page boundaries', 'Add focused checks', 'Run the export matrix',
      'Inspect narrow tables', 'Adjust wrapping rules', 'Check repeated headings', 'Test bright and dim themes',
      'Test blocked downloads', 'Check keyboard focus', 'Inspect the export bytes', 'Read the verbose matrix output',
      'Reduce duplicate diagnostics', 'Run focused checks again', 'Prepare the review', 'Apply the foreground review',
      'Fix the final focus detail', 'Read the finished diff', 'Run acceptance checks', 'Report PDF export complete'];
    for (let i = 0; i < 40; i++) {
      for (const run of runs.filter(r => r.fork === i)) {
        main.call('Agent', { subagent_type: run.type, description: run.description, prompt: prompt(run), run_in_background: !run.foreground }, `call-${run.id}`);
        main.result(`call-${run.id}`, run.foreground ? prose('review summary', run.returned) : `Agent ${run.id} started in the background.`, minute(i),
          { agentId: run.id, ...(run.foreground ? { status: 'completed' } : { isAsync: true, status: 'async_launched' }) });
      }
      for (const run of runs.filter(r => !r.foreground && r.merge === i)) {
        // The verbose checker repeats its full completion report through
        // TaskOutput, illustrating the cost of an unfiltered return.
        const summary = prose(`${run.type} summary`, run.returned);
        main.blob('system', `<task-notification>\n<task-id>${run.id}</task-id>\n<status>completed</status>\n<summary>${summary}</summary>\n</task-notification>`);
        if (run.id === 'checks') {
          main.call('TaskOutput', { task_id: run.id, block: true }, 'read-checks');
          main.result('read-checks', prose('PDF matrix diagnostic', run.returned), minute(i));
        }
      }
      main.blob('assistant', [{ type: 'thinking', thinking: `${beats[i]}. Keep the PDF change focused and compare the observed checks.` }]);
      const name = i % 4 === 0 ? 'Bash' : i % 4 === 1 ? 'Grep' : i % 4 === 2 ? 'Read' : 'Edit';
      main.call(name, { target: i % 4 === 0 ? 'lantern-check pdf --focused' : `components/pdf/section-${i}.js` }, `main-tool-${i}`);
      main.result(`main-tool-${i}`, `${beats[i]}. Fictional Lantern evidence: headings stay with their content; table headers repeat; fonts are ready; focus returns to Export. Check exit value: 0.`, minute(i));
      main.request(i, minute(i), 8000 + i * 1150 + (i >= 31 ? 12000 : 0));
    }
    await writeFile(path.join(directory, 'lantern-pdf.jsonl'), main.records.map(r => JSON.stringify(r)).join('\n') + '\n');
    for (const run of runs) {
      const child = transcript(run.id, true, prompt(run));
      const start = run.foreground ? minute(run.fork - 1) + .1 : minute(run.fork) + .1;
      const end = minute(run.merge) - .1;
      for (let i = 0; i < run.count; i++) {
        child.blob('assistant', [{ type: 'thinking', thinking: `Inspect Lantern PDF evidence ${i + 1}. Compare the layout and checks before summarising.` }]);
        const name = ['Grep', 'Read', 'Read', 'Bash'][i % 4];
        child.call(name, { target: name === 'Bash' ? `lantern-check pdf --batch ${i}` : `components/pdf/${run.id}-${i}.js` }, `${run.id}-tool-${i}`);
        child.result(`${run.id}-tool-${i}`, prose(`${run.id} file ${i + 1}`, 100 + i * 4), start);
        child.request(i, start + (end - start) * i / (run.count - 1), Math.round(5000 + (run.peak - 5000) * i / (run.count - 1)),
          i === run.count - 1 ? prose(`${run.type} final summary`, run.returned) : null);
      }
      const base = path.join(directory, 'subagents', `agent-${run.id}`);
      await writeFile(`${base}.jsonl`, child.records.map(r => JSON.stringify(r)).join('\n') + '\n');
      await writeFile(`${base}.meta.json`, JSON.stringify({ agentType: run.type, description: run.description, toolUseId: `call-${run.id}`, spawnDepth: 1, finished: true }));
    }
    // Read the actual temporary transcript files, using the same parser and
    // agentRun/attachAgents metadata path as the browser's parseFiles loader.
    async function parse(file) {
      const parser = createParser({ sourceName: path.basename(file) });
      for (const line of (await readFile(file, 'utf8')).split('\n')) parser.push(line);
      return parser.finish();
    }
    const children = [];
    for (const run of runs) {
      const file = path.join(directory, 'subagents', `agent-${run.id}.jsonl`);
      children.push(agentRun(await parse(file), path.basename(file), JSON.parse(await readFile(file.replace('.jsonl', '.meta.json'), 'utf8'))));
    }
    const session = attachAgents(await parse(path.join(directory, 'lantern-pdf.jsonl')), children);
    session.meta.sample = true;
    session.meta.sessionId = 'fictional-lantern-pdf';
    const branches = agentBranches(session);
    const parallel = session.requests.map((_, idx) => branches.filter(b => idx >= b.fork && (b.open || idx < b.merge)).length);
    session.meta.startRequest = parallel.indexOf(Math.max(...parallel));
    return session;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const session = await makeAgentsSample();
  const raw = JSON.stringify(session, null, 2) + '\n';
  const wire = JSON.stringify(compactSession(session), (_, v) => v instanceof Int32Array ? Array.from(v) : v);
  await writeFile(new URL('../sample/agents-session.json', import.meta.url), raw);
  console.log(`Lantern PDF: ${session.requests.length} main requests, ${session.agents.length} runs; ${Buffer.byteLength(raw)} bytes before compaction, ${Buffer.byteLength(wire)} after`);
}
