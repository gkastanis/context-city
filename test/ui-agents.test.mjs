import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseText } from '../src/parse.js';
import { compactSession, expandSession } from '../src/ui/compact.js';
import { agentCalls, agentRun, attachAgents, linkedRun, allAgentsLoaded } from '../src/ui/agents.js';
import { wholeSessionCache, sessionCache } from '../src/ui/math.js';
import { findings } from '../src/ui/findings.js';
import { parseFiles, droppedFiles } from '../src/ui/loader.js';

const mainText = await readFile(new URL('./fixtures/main-agent.jsonl', import.meta.url), 'utf8');
const agentText = await readFile(new URL('./fixtures/agent-run.jsonl', import.meta.url), 'utf8');
const metadata = JSON.parse(await readFile(new URL('./fixtures/agent-run.meta.json', import.meta.url), 'utf8'));
const pair = () => {
  const main = parseText(mainText), child = parseText(agentText);
  return attachAgents(main, [agentRun(child, 'agent-run.jsonl', metadata)]);
};

test('agent and auto select a lone agent, explicit main remains empty', () => {
  for (const thread of ['agent', 'auto']) {
    const s = parseText(agentText, { thread });
    assert.equal(s.meta.thread, 'agent');
    assert.equal(s.meta.agent.agentId, 'run');
    assert.equal(s.meta.agent.querySource, 'agent:custom:reviewer');
    assert.equal(s.requests.length, 2);
    assert.equal(s.requests[1].usage.cacheRead, 600);
    assert.ok(Object.values(s.blocks).some(b => b.toolName === 'Bash'));
  }
  assert.equal(parseText(agentText, { thread: 'main' }).requests.length, 0);
  assert.equal(parseText(mainText).meta.thread, 'main');
});

test('auto prefers main and continues counting embedded sidechain requests', () => {
  const s = parseText(mainText + '\n' + agentText);
  assert.equal(s.meta.thread, 'main');
  assert.equal(s.requests.length, 3);
  assert.equal(s.meta.sidechainRequests, 2);
});

test('Agent results retain agentId; missing-run detection and both links work', () => {
  const s = pair(), run = s.agents[0];
  assert.deepEqual(agentCalls(s), ['run']);
  assert.equal(allAgentsLoaded(s), true);
  assert.equal(run.parentRequestIdx, 2);
  assert.equal(s.blocks[run.parentBlockId].agentId, run.agentId);
  assert.equal(linkedRun(s, Object.values(s.blocks).find(b => b.kind === 'tool_use')), run);
  const noMetadata = attachAgents(parseText(mainText), [agentRun(parseText(agentText), 'agent-run.jsonl')]);
  assert.equal(noMetadata.agents[0].parentRequestIdx, 2);
  assert.equal(noMetadata.agents[0].toolUseId, 'call-review');
  const noResult = parseText(mainText.split('\n').slice(0, 5).join('\n'));
  const callOnly = attachAgents(noResult, [agentRun(parseText(agentText), 'agent-run.jsonl', metadata)]);
  assert.equal(callOnly.agents[0].parentRequestIdx, 1);
  assert.equal(allAgentsLoaded(callOnly), true);
  const unlinked = attachAgents(parseText(mainText), [agentRun(parseText(agentText), 'agent-other.jsonl')]);
  assert.equal(unlinked.agents[0].parentRequestIdx, null);
});

test('agent sessions survive nested compact/expand and whole cache sums measurements', () => {
  const s = pair(), expanded = expandSession(compactSession(s));
  assert.equal(expanded.agents[0].session.requests.length, 2);
  assert.deepEqual(expanded.agents[0].session.requests[1].blockIds, s.agents[0].session.requests[1].blockIds);
  assert.equal(expanded.agents[0].description, metadata.description);
  const whole = wholeSessionCache(expanded), main = sessionCache(s.requests), child = sessionCache(s.agents[0].session.requests);
  for (const key of ['total', 'read', 'write', 'uncached', 'requests']) assert.equal(whole[key], main[key] + child[key]);
});

test('merged findings prefix runs and share tool usage across threads', () => {
  const s = pair(), list = findings(s);
  assert.ok(list.some(f => f.agentId === 'run' && f.title.startsWith('reviewer: '+metadata.description+': Bash result')));
  const unused = list.filter(f => f.kind === 'unused_tools');
  assert.ok(unused.length);
  assert.ok(unused.every(f => !f.detail.includes('Bash')));
  assert.ok(unused.every(f => !f.title.includes('in the main thread')));
  const partial = attachAgents(s, []);
  partial.agents = [];
  assert.ok(findings(partial).some(f => f.kind === 'unused_tools' && f.title.includes('in the main thread')));
});

test('multi-file loader picks main, pairs metadata, adds runs without reading main', async () => {
  const main = new File([mainText], 'main-agent.jsonl');
  const child = new File([agentText], 'agent-run.jsonl');
  const meta = new File([JSON.stringify(metadata)], 'agent-run.meta.json');
  const s = (await parseFiles([child, meta, main]).promise).session;
  assert.equal(s.requests.length, 3);
  assert.equal(s.agents[0].agentType, 'reviewer');
  assert.equal(s.agents[0].parentRequestIdx, 2);
  const lone = (await parseFiles([child]).promise).session;
  assert.equal(lone.meta.thread, 'agent');
  assert.equal(lone.requests.length, 2);
  main.stream = () => { throw new Error('Main must not be read'); };
  const added = (await parseFiles([main, child, meta], () => {}, parseText(mainText)).promise).session;
  assert.equal(added.agents.length, 1);
});

test('drop recursion drains all directory batches', async () => {
  const file = new File(['{}'], 'agent-demo.meta.json');
  let batch = 0;
  const dir = { isDirectory: true, createReader: () => ({ readEntries: resolve => resolve(batch++ === 0 ? [{ isFile: true, file: resolve => resolve(file) }] : []) }) };
  const files = await droppedFiles({ items: [{ webkitGetAsEntry: () => dir }] });
  assert.deepEqual(files, [file]);
});

test('multiple main files choose the largest, and an all-agent selection chooses its first file', async () => {
  const a = new File([mainText], 'main-small.jsonl');
  const b = new File([mainText + '\n'.repeat(20)], 'main-large.jsonl');
  const chosen = (await parseFiles([a, b]).promise).session;
  assert.equal(chosen.meta.sourceName, 'main-large.jsonl');
  assert.equal(chosen.agents?.length ?? 0, 0);
  const first = new File([agentText], 'agent-first.jsonl');
  const second = new File([agentText], 'agent-second.jsonl');
  const lone = (await parseFiles([first, second]).promise).session;
  assert.equal(lone.meta.sourceName, 'agent-first.jsonl');
  assert.equal(lone.agents[0].agentId, 'second');
});

test('optional invalid metadata never hides a run and adding the same run replaces it', async () => {
  for (const data of ['null', 'false', '[]', '{broken']) {
    const s = (await parseFiles([new File([mainText], 'main.jsonl'), new File([agentText], 'agent-run.jsonl'),
      new File([data], 'agent-run.meta.json')]).promise).session;
    assert.equal(s.agents.length, 1);
    assert.equal(s.agents[0].description, '');
    assert.equal(s.agents[0].parentRequestIdx, 2);
  }
  const s = pair();
  const replaced = attachAgents(s, [agentRun(parseText(agentText), 'agent-run.jsonl', { ...metadata, finished: false })]);
  assert.equal(replaced.agents.length, 1);
  assert.equal(replaced.agents[0].finished, false);
});

test('multi-file cancellation rejects without replacing the retained root', async () => {
  const original = pair();
  const task = parseFiles([new File([agentText], 'agent-run.jsonl')], () => {}, original);
  task.cancel();
  await assert.rejects(task.promise, { name: 'AbortError' });
  assert.equal(original.agents.length, 1);
});

test('agent request source selects runs when API records omit the sidechain flag', () => {
  const text = agentText.split('\n').map(line => {
    if (!line) return line;
    const r = JSON.parse(line);
    if (r.type === 'api-request') delete r.isSidechain;
    return JSON.stringify(r);
  }).join('\n');
  const s = parseText(text);
  assert.equal(s.meta.thread, 'agent');
  assert.equal(s.requests.length, 2);
});
