import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { bundle, build } from '../scripts/build.mjs';
import { agentBranches } from '../src/ui/agents.js';
import { expandSession } from '../src/ui/compact.js';

test('standalone artifact bundles modules, worker and example with valid module syntax', async () => {
  const root = new URL('../', import.meta.url);
  const { output: html } = await build();
  assert.ok(html.startsWith('<title>Context City</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<style>'));
  assert.doesNotMatch(html, /<\/?(?:html|head|body)(?:\s|>)/i);
  assert.doesNotMatch(html.replace(/const exampleData = .*; \/\* SAMPLE_DATA \*\//, ''), /(?:from\s*|import\s*\()(['"])\.{1,2}\//);
  assert.doesNotMatch(html.replace(/const exampleData = .*; \/\* SAMPLE_DATA \*\//, ''), /innerHTML\s*=|\u2014/);
  assert.ok(Buffer.byteLength(html) < 3 * 1024 * 1024);
  assert.equal((html.match(/<script\b/g) ?? []).length, 1);
  assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
  const script = html.match(/<script type="module">([\s\S]*)<\/script>/)[1];
  assert.doesNotMatch(script, /^import /m);
  const external = [...new Set(script.match(/https:\/\/cdn\.jsdelivr\.net[^"]+/g))];
  assert.ok(external.length >= 2);
  assert.ok(external.every(url => url.startsWith('https://cdn.jsdelivr.net/npm/three@0.160.0/')));
  assert.doesNotMatch(html, /[^\x00-\x7f]|<!--/);
  assert.match(html, /Loading the 3D view\./);
  const workerLiteral = script.match(/const embeddedWorker = ("(?:\\.|[^"\\])*"); \/\* WORKER_SOURCE \*\//)[1];
  const worker = JSON.parse(workerLiteral);
  assert.match(worker, /createParser/); assert.match(worker, /TextDecoderStream/);
  assert.doesNotMatch(worker, /^import |^export /m);
  const dir = await mkdtemp(path.join(tmpdir(), 'context-city-build-'));
  try {
    for (const [name, code] of [['app.mjs', script], ['worker.mjs', worker]]) {
      const file = path.join(dir, name); await writeFile(file, code);
      execFileSync(process.execPath, ['--check', file]);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('bundler preserves paging-style declarations, functions, classes and export aliases', async () => {
  const files = new Map([
    ['paging.js', `export const CONTENT_PAGES = 12, LINES_PER_PAGE = 18, HALL_BLOCKS = 22;
export function f() { return HALL_BLOCKS; }
export class Hall { value = LINES_PER_PAGE; }
const a = "a", b = "b";
export { a, b as alias };
`],
    ['entry.js', `import { CONTENT_PAGES, LINES_PER_PAGE, HALL_BLOCKS, f, Hall, a, alias as b } from './paging.js';
globalThis.result = [CONTENT_PAGES, LINES_PER_PAGE, HALL_BLOCKS, f(), new Hall().value, a, b];`],
  ]);
  const code = await bundle('entry.js', files);
  const context = vm.createContext({});
  await vm.runInContext(`(async () => { ${code} })()`, context);
  assert.equal(JSON.stringify(context.result), '[12,18,22,22,18,"a","b"]');
  files.set('entry.js', "import { MISSING as alias } from './paging.js';");
  await assert.rejects(bundle('entry.js', files), /MISSING, not exported by paging.js/);
  files.set('entry.js', "export { MISSING as alias } from './paging.js';");
  await assert.rejects(bundle('entry.js', files), /MISSING, not exported by paging.js/);
});

test('sample placeholder replacement preserves dollar patterns, script comments and Unicode', async () => {
  const payload = "$$ $& $` $' <!-- <script </script> <SCRIPT </SCRIPT> café 日本語 😀";
  const { output } = await build({ sample: JSON.stringify({ payload }) });
  assert.doesNotMatch(output, /[^\x00-\x7f]|<!--/);
  assert.equal((output.match(/<script\b/g) ?? []).length, 1);
  const literal = output.match(/const exampleData = (.*); \/\* SAMPLE_DATA \*\//)[1];
  const context = vm.createContext({});
  const sample = vm.runInContext(literal, context);
  assert.equal(JSON.parse(sample[0]).payload, payload);
  await build();
});

test('all three compact embedded examples preserve every request and approved text in both formats', async () => {
  const artifact = await build();
  const pages = await build({ pages: true });
  assert.ok(pages.output.startsWith('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'));
  assert.ok(pages.output.endsWith('</body></html>\n'));
  assert.doesNotMatch(pages.output, /[^\x00-\x7f]|<!--/);
  const script = html => html.match(/<script type="module">([\s\S]*)<\/script>/)[1];
  assert.equal(script(pages.output), script(artifact.output));
  assert.equal(pages.output.match(/<style>([\s\S]*?)<\/style>/)[1], artifact.output.match(/<style>([\s\S]*?)<\/style>/)[1]);
  const embedded = JSON.parse(artifact.output.match(/const exampleData = (.*); \/\* SAMPLE_DATA \*\//)[1]);
  for (const [i, filename] of ['real-agents-session.json', 'real-session-redacted.json'].entries()) {
    const original = JSON.parse(await readFile(new URL('../sample/' + filename, import.meta.url), 'utf8'));
    const wire = JSON.parse(embedded[i]);
    assert.ok(wire.requests.every(r => !Object.hasOwn(r, 'blockIds') && !Object.hasOwn(r, 'newBlockIds')));
    const expanded = expandSession(wire);
    assert.deepEqual(expanded, original);
    assert.ok(artifact.exampleSizes[i].after < artifact.exampleSizes[i].before);
    if (i === 0) {
      assert.ok(artifact.exampleSizes[i].after < 500000);
      assert.equal(agentBranches(expanded).length, 4);
      assert.equal(original.agents.length, 4);
      assert.match(artifact.output, /A real session with subagents/);
    }
    if (i === 1) {
      assert.equal(original.requests.length, 224);
      assert.equal(Object.keys(original.blocks).length, 1114);
      assert.equal(original.events.filter(e => e.type === 'compaction').length, 1);
      const readable = Object.values(original.blocks).filter(b => b.text !== null);
      assert.equal(readable.length, 8);
      assert.ok(readable.every(b => b.kind === 'user_text' && b.provenance === 'verbatim'));
    }
  }
});
