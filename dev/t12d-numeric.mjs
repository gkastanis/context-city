// Local numeric verification. Paths are supplied outside the repository.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseText } from '../src/parse.js';
import { timeScale } from '../src/ui/timeline.js';
import { agentRun, attachAgents, agentBranches } from '../src/ui/agents.js';
const paths = JSON.parse(await readFile(process.env.T12D_REAL_PATHS, 'utf8'));
for (let n = 0; n < paths.length; n++) {
  let session = parseText(await readFile(paths[n], 'utf8'));
  if (!n) {
    const dir = paths[n].replace(/\.jsonl$/, '') + '/subagents';
    const runs = [];
    for (const name of (await readdir(dir)).filter(n => /^agent-.*\.jsonl$/.test(n))) {
      let meta = {}; try { meta = JSON.parse(await readFile(path.join(dir, name.replace(/\.jsonl$/, '.meta.json')), 'utf8')); } catch {}
      runs.push(agentRun(parseText(await readFile(path.join(dir, name), 'utf8')), name, meta));
    }
    session = attachAgents(session, runs);
    console.log(JSON.stringify({ realIndex: n, runs: runs.length, merged: agentBranches(session).filter(b => !b.open).length }));
  }
  const times = session.requests.map(r => r.time);
  for (const width of [1300, 314]) {
    const scale = timeScale(times, width);
    let breakPixels = 0;
    for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] > 900000) breakPixels += scale.x[i] - scale.x[i - 1];
    console.log(JSON.stringify({ realIndex: n, requests: times.length, width, distinctPixels: new Set(scale.x.map(Math.round)).size, breaks: scale.breaks.length, breakPixels, breakShare: breakPixels / width }));
  }
}
