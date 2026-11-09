// Numeric-only check. Pass a main transcript path; no transcript text is logged.
import { openAsBlob } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseFiles } from '../src/ui/loader.js';
import { wholeSessionCache } from '../src/ui/math.js';

try {
  const mainPath = process.argv[2];
  const folder = mainPath.replace(/\.jsonl$/i, '') + '/subagents';
  const names = (await readdir(folder)).filter(n => /^agent-.+\.(jsonl|meta\.json)$/.test(n));
  const files = [];
  for (const filePath of [mainPath, ...names.map(n => path.join(folder, n))]) {
    const blob = await openAsBlob(filePath);
    Object.defineProperty(blob, 'name', { value: path.basename(filePath) });
    files.push(blob);
  }
  const session = await parseFiles(files).promise;
  console.log(JSON.stringify({ mainRequests: session.requests.length, runs: session.agents.length,
    subagentRequests: session.agents.reduce((n, a) => n + a.session.requests.length, 0),
    linkedRuns: session.agents.filter(a => a.parentRequestIdx != null).length,
    inputTokens: wholeSessionCache(session)?.total ?? 0 }));
} catch {
  console.log(JSON.stringify({ success: false }));
  process.exitCode = 1;
}
