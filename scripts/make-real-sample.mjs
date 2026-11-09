import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { redactFolder } from './redact.mjs';
import { createParser } from '../src/parse.js';
import { agentRun, attachAgents, agentBranches } from '../src/ui/agents.js';
import { compactSession } from '../src/ui/compact.js';

export async function makeRealSample(input, user, privateWords = []) {
  const temporary = await mkdtemp(join(tmpdir(), 'real-sample-'));
  const output = join(temporary, 'redacted');
  try {
    const { main, children, sessionId } = await redactFolder(input, output, user, privateWords);
    async function parse(name) {
      const parser = createParser({ sourceName: basename(name) });
      for (const line of (await readFile(join(output, name), 'utf8')).split('\n')) parser.push(line);
      return parser.finish();
    }
    const runs = [];
    for (const child of children.filter(n => n.endsWith('.jsonl'))) {
      const name = join(sessionId, 'subagents', child);
      const metadata = JSON.parse(await readFile(join(output, name.replace(/\.jsonl$/, '.meta.json')), 'utf8'));
      runs.push(agentRun(await parse(name), child, metadata));
    }
    const session = attachAgents(await parse(main), runs);
    session.meta.sample = true;
    session.meta.redacted = true;
    session.meta.targetedRedaction = true;
    session.meta.sourceName = 'real-agents-session.json';
    const branches = agentBranches(session);
    const parallel = session.requests.map((_, idx) => branches.filter(b => idx >= b.fork && (b.open || idx < b.merge)).length);
    session.meta.startRequest = parallel.indexOf(Math.max(...parallel));
    return session;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [input, flag, user, wordsFlag, wordsPath] = process.argv.slice(2);
    if (!input || flag !== '--user' || !user || ![5, 7].includes(process.argv.length) || (wordsFlag && wordsFlag !== '--private-words')) throw new Error('Arguments');
    const privateWords = wordsPath ? (await readFile(wordsPath, 'utf8')).split(/\r?\n/).map(w => w.trim()).filter(Boolean) : [];
    const session = await makeRealSample(input, user, privateWords);
    const wire = JSON.stringify(compactSession(session), (_, value) => value instanceof Int32Array ? Array.from(value) : value);
    if (Buffer.byteLength(wire) >= 500000) throw new Error('Sample exceeds size limit');
    await writeFile(new URL('../sample/real-agents-session.json', import.meta.url), JSON.stringify(session) + '\n');
    console.log(JSON.stringify({ requests: session.requests.length, runs: session.agents.length, startRequest: session.meta.startRequest, compactBytes: Buffer.byteLength(wire) }));
  } catch {
    console.error('Sample generation failed. Check input, username, metadata and size locally.');
    process.exitCode = 1;
  }
}
