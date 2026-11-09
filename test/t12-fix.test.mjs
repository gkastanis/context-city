import test from 'node:test';
import assert from 'node:assert/strict';
import { parseText } from '../src/parse.js';
import { selectFiles, parseFiles, droppedFiles } from '../src/ui/loader.js';
import { requestStories } from '../src/ui/math.js';
import { readFile } from 'node:fs/promises';

const mainText = await readFile(new URL('./fixtures/main-agent.jsonl', import.meta.url), 'utf8');
const agentText = await readFile(new URL('./fixtures/agent-run.jsonl', import.meta.url), 'utf8');

test('records-only main wins over embedded sidechain records in auto mode', () => {
  const records = [
    { type: 'user', uuid: 'u1', message: { role: 'user', content: 'Draw a square.' } },
    { type: 'user', uuid: 'side-u', isSidechain: true, agentId: 'review', message: { role: 'user', content: 'Review it.' } },
    { type: 'assistant', uuid: 'side-a', parentUuid: 'side-u', isSidechain: true, agentId: 'review', message: { id: 'side-response', role: 'assistant', content: [{ type: 'text', text: 'Square reviewed.' }] } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { id: 'main-response', role: 'assistant', content: [{ type: 'text', text: 'Square drawn.' }] } },
  ].map(r => JSON.stringify(r)).join('\n');
  const auto = parseText(records), main = parseText(records, { thread: 'main' });
  assert.equal(auto.meta.thread, 'main');
  assert.equal(auto.requests.length, 1);
  assert.deepEqual(auto.requests, main.requests);
});

test('selection prefers largest main and scopes runs to its session folder', () => {
  const files = [
    { name: 'old.jsonl', size: 10, path: 'project/old.jsonl' },
    { name: 'current.jsonl', size: 20, path: 'project/current.jsonl' },
    { name: 'agent-a.jsonl', size: 30, path: 'project/current/subagents/agent-a.jsonl' },
    { name: 'agent-b.jsonl', size: 40, path: '/project/old/subagents/agent-b.jsonl' },
    { name: 'settings.json', size: 100 },
    { name: 'agent-a.meta.json', size: 5 },
  ];
  const selection = selectFiles(files);
  assert.equal(selection.main, files[1]);
  assert.deepEqual(selection.runs, [files[2]]);
  assert.equal(selection.skipped, 1);
  assert.equal(selectFiles([{ name: 'settings.json', size: 1 }]).main.name, 'settings.json');
  assert.equal(selectFiles([{ name: 'settings.json', size: 1 }, { name: 'other.json', size: 2 }]).main, null);
  assert.equal(selectFiles(files.map(f => ({ ...f, path: '' }))).runs.length, 2);
  assert.deepEqual(selectFiles(files, 'old', files[0]).runs, [files[3]]);
});

test('loader never reads other main sessions or unrelated JSON; ignores fake agent main', async () => {
  const main = new File([mainText], 'main.jsonl');
  const old = new File(['ignored'], 'old.jsonl');
  const settings = new File(['{}'], 'settings.json');
  old.stream = settings.stream = () => { throw new Error('Unselected file read'); };
  const fake = new File([mainText], 'agent-fake.jsonl');
  const result = await parseFiles([old, settings, main, fake]).promise;
  assert.equal(result.session.requests.length, 3);
  assert.equal(result.added, 0);
  assert.equal(result.skipped, 1);
  const empty = await parseFiles([settings], () => {}, result.session).promise;
  assert.equal(empty.session, result.session);
  assert.equal(empty.added, 0);
});

test('drop entry paths restrict attached runs by session id', async () => {
  const main = new File([mainText], 'main.jsonl');
  const id = parseText(mainText).meta.sessionId ?? 'main';
  const agent = new File([agentText], 'agent-run.jsonl');
  const unrelated = new File([agentText], 'agent-other.jsonl');
  unrelated.stream = () => { throw new Error('Unrelated run read'); };
  const files = await droppedFiles({ items: [
    { webkitGetAsEntry: () => ({ isFile: true, fullPath: '/project/main.jsonl', file: resolve => resolve(main) }) },
    { webkitGetAsEntry: () => ({ isFile: true, fullPath: `/project/${id}/subagents/agent-run.jsonl`, file: resolve => resolve(agent) }) },
    { webkitGetAsEntry: () => ({ isFile: true, fullPath: '/project/other/subagents/agent-other.jsonl', file: resolve => resolve(unrelated) }) },
  ] });
  const result = await parseFiles(files).promise;
  assert.equal(result.added, 1);
});

test('request captions preserve final punctuation without doubling it', () => {
  for (const prompt of ['Draw a square.', 'Draw a square!', 'Draw a square?', 'Draw a square']) {
    const session = { blocks: { p: { kind: 'user_text', text: prompt, estTokens: 4 } }, events: [],
      requests: [{ newBlockIds: ['p'] }] };
    const caption = requestStories(session)[0].caption;
    assert.ok(caption.includes(`${prompt}${/[.!?]$/.test(prompt) ? '' : '.'} +1 blocks`));
    assert.ok(!caption.includes('..'));
  }
});


test('a main user record prevents an embedded agent API record dropping the main parser', () => {
  const records = [
    { type: 'user', uuid: 'prompt-main', message: { role: 'user', content: 'Draw a square.' } },
    { type: 'api-request', id: 'review-api', querySource: 'agent:custom:reviewer', isSidechain: true, keep: 0, tail: [] },
    { type: 'api-request', id: 'main-api', querySource: 'repl_main_thread', keep: 0, tail: [] },
  ].map(r => JSON.stringify(r)).join('\n');
  const session = parseText(records);
  assert.equal(session.meta.thread, 'main');
  assert.equal(session.requests.length, 1);
});
