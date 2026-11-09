import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseText } from '../src/parse.js';
import { agentRun, attachAgents, agentBranches, packLanes, maxParallel, agentColor, agentBranchLabel, agentStats, durationLabel } from '../src/ui/agents.js';
import { timeScale, axisRange, rangePosition } from '../src/ui/timeline.js';
import { compactSession, expandSession } from '../src/ui/compact.js';
const read = name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const main = await read('main-agent-branches.jsonl');
const children = await Promise.all(['a', 'b', 'c', 'd'].map(id => read(`agent-branch-${id}.jsonl`)));
function fixture(text = main) {
  return attachAgents(parseText(text), ['a', 'b', 'c', 'd'].map((id, i) => agentRun(parseText(children[i]), `agent-${id}.jsonl`,
    { agentType: id === 'b' ? 'explorer' : 'reviewer', description: 'Synthetic square', toolUseId: `call-${id}` })));
}
test('request times come from defining records, nearest records, or remain null', () => {
  const s = fixture();
  assert.equal(s.requests[0].time, Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(s.requests[9].time - s.requests[8].time, 120 * 60000);
  assert.equal(expandSession(compactSession(s)).requests[9].time, s.requests[9].time);
  const rows = [
    { type: 'api-request', id: 'a', querySource: 'sdk' },
    { type: 'queue-operation', timestamp: '2026-01-01T00:01:00Z' },
    { type: 'api-request', id: 'b', querySource: 'sdk' },
  ];
  const parsed = parseText(rows.map(r => JSON.stringify(r)).join('\n'));
  assert.deepEqual(parsed.requests.map(r => r.time), [Date.parse(rows[1].timestamp), Date.parse(rows[1].timestamp)]);
  assert.equal(parseText(JSON.stringify(rows[0])).requests[0].time, null);
  const records = parseText(JSON.stringify({ type: 'assistant', timestamp: rows[1].timestamp,
    message: { id: 'fallback', role: 'assistant', content: 'Synthetic', usage: { input_tokens: 10 } } }));
  assert.equal(records.requests[0].time, Date.parse(rows[1].timestamp));
});
test('async launches link to later string notifications across queue and attachment records', () => {
  const s = fixture(), branches = agentBranches(s);
  assert.deepEqual(branches.map(({ agentId, fork, merge, async, open, lane }) => ({ agentId, fork, merge, async, open, lane })), [
    { agentId: 'a', fork: 1, merge: 6, async: true, open: false, lane: 0 },
    { agentId: 'b', fork: 2, merge: 7, async: true, open: false, lane: 1 },
    { agentId: 'c', fork: 3, merge: 8, async: true, open: false, lane: 2 },
    { agentId: 'd', fork: 4, merge: 4, async: false, open: false, lane: 3 },
  ]);
  const result = Object.values(s.blocks).find(b => b.agentId === 'a');
  assert.equal(result.async, true);
  assert.equal(Object.values(s.blocks).find(b => b.agentId === 'd').async, undefined);
  const notice = Object.values(s.blocks).find(b => b.notifies?.includes('a'));
  assert.ok(s.requests[6].blockIds.includes(notice.id));
  assert.ok(!s.requests[5].blockIds.includes(notice.id));
  assert.equal(branches[0].runEnd - branches[0].runStart, 5 * 60000);
  assert.equal(branches[0].forkTime, s.requests[1].time);
  assert.equal(branches[0].mergeTime, s.requests[6].time);
  assert.equal(branches[0].inputTokens, 4000); assert.equal(branches[0].hitRate, .5);
  assert.deepEqual(agentBranches(expandSession(compactSession(s))), branches);
  assert.equal(maxParallel(branches), 4);
});
test('missing notification stays open despite an async launch result; foreground uses result', () => {
  const s = fixture();
  for (const b of Object.values(s.blocks)) if (b.notifies?.includes('c')) delete b.notifies;
  const branches = agentBranches(s), open = branches.find(b => b.agentId === 'c');
  assert.equal(open.open, true); assert.equal(open.merge, 11);
  assert.equal(branches.find(b => b.agentId === 'd').merge, 4);
  assert.equal(agentBranches({ blocks: {}, requests: [], agents: [] }).length, 0);
});
test('missing tool use links by result agent ID; unlinked runs stay outside graph', () => {
  const s = fixture();
  s.agents.push(agentRun(parseText(children[0]), 'agent-unlinked.jsonl'));
  for (const b of Object.values(s.blocks)) if (b.kind === 'tool_use') b.toolUseId = 'missing';
  assert.equal(agentBranches(s)[0].fork, 1); assert.equal(agentBranches(s).length, 4);
});
test('packing uses inclusive intervals independently on each axis without mutating input', () => {
  const items = [{ fork: 0, merge: 2, forkTime: 0, mergeTime: 10 }, { fork: 1, merge: 3, forkTime: 11, mergeTime: 20 }, { fork: 4, merge: 5, forkTime: 20, mergeTime: 30 }];
  assert.deepEqual(packLanes(items, 'fork', 'merge').map(b => b.lane), [0, 1, 0]);
  assert.deepEqual(packLanes(items, 'forkTime', 'mergeTime').map(b => b.lane), [0, 0, 1]);
  assert.equal(items[0].lane, undefined);
  assert.equal(maxParallel(items), 2);
  assert.equal(maxParallel(items.map((b, i) => ({ ...b, forkTime: i * 11, mergeTime: i * 11 + 10 }))), 1);
  assert.equal(maxParallel(items.map(({ forkTime, mergeTime, ...b }) => b)), 2);
  assert.equal(maxParallel([]), 0);
});
test('time scale compresses a two-hour gap to twelve pixels and interpolates missing times', () => {
  const m = 60000, scale = timeScale([0, m, 121 * m, 122 * m], 600);
  assert.deepEqual(scale.x, [0, 294, 306, 600]); assert.deepEqual(scale.breaks, [300]);
  assert.deepEqual(timeScale([0, null, 2 * m], 600).x, [0, 300, 600]);
  assert.deepEqual(timeScale([null, null], 600), { x: [0, 600], breaks: [] });
  assert.deepEqual(timeScale([10, 5, 20], 600).x, [0, 0, 600]);
  assert.deepEqual(timeScale([null, 0, m, null], 600).x, [0, 0, 600, 600]);
});
test('colours stay stable and branch labels explain background, blocking, duration and open state', () => {
  assert.equal(agentColor('reviewer'), '#f0a64a');
  assert.notEqual(agentColor('reviewer'), agentColor('explorer'));
  const branches = agentBranches(fixture());
  assert.match(agentBranchLabel(branches[0]), /ran in the background, ran 5 min$/);
  assert.match(agentBranchLabel(branches[3]), /main thread waited, ran under 1 min$/);
  assert.match(agentBranchLabel({ ...branches[0], open: true, runStart: null }), /has not returned$/);
  const description = '<b>square</b>' + 'x'.repeat(100);
  assert.ok(agentBranchLabel({ ...branches[0], description }).includes(description.slice(0, 80)));
  assert.ok(!agentBranchLabel({ ...branches[0], description }).includes(description.slice(0, 81)));
});
test('summary retains longest run and sums known foreground durations', () => {
  const s = fixture(), stats = agentStats(s);
  assert.equal(stats.maxParallel, 4); assert.equal(stats.foreground, 1); assert.equal(stats.waited, 48000);
  assert.equal(stats.longest.session.requests.length, 2);
  assert.deepEqual(agentStats({ blocks: {}, requests: [], agents: [] }), { longest: null, maxParallel: 0, foreground: 0, waited: null });
});

test('attachment and system text notifications complete runs, including two IDs in one block', () => {
  const rows = main.trim().split('\n').map(JSON.parse);
  const notice = rows.find(r => r.hash === 'notification-a');
  notice.message.content[0].text += '<task-notification><agent-id>b</agent-id></task-notification>';
  const branches = agentBranches(fixture(rows.map(JSON.stringify).join('\n')));
  assert.equal(branches[0].merge, 6); assert.equal(branches[1].merge, 6);
  const s = fixture();
  assert.equal(Object.values(s.blocks).find(b => b.notifies?.includes('a')).role, 'system');
});
test('dense idle gaps preserve active width and distinct request pixels', () => {
  const times = [0];
  for (let i = 0; i < 110; i++) times.push(times.at(-1) + 3600000, times.at(-1) + 3601000);
  const scale = timeScale(times, 1300);
  let idle = 0;
  for (let i = 1; i < times.length; i += 2) idle += scale.x[i] - scale.x[i - 1];
  assert.ok(idle <= 260.00001);
  assert.ok(new Set(scale.x.map(Math.round)).size >= times.length * .9);
  assert.deepEqual(timeScale([0, 3600000, 7200000], 1300).x, [0, 650, 1300]);
  assert.ok(timeScale(times, 314).breaks.length < 110);
});
test('foreground intervals preserve elapsed time', () => {
  assert.deepEqual(timeScale([0, 3600000, 3601000], 600, [[1000, 3600000]]).breaks, []);
});
test('zoom domains clamp, reverse, and project axis units', () => {
  assert.deepEqual(axisRange([0, 100], 80, 20), [20, 80]);
  assert.deepEqual(axisRange([0, 100], -20, 120), [0, 100]);
  assert.deepEqual(axisRange([0, 100], 20, 20), [0, 100]);
  assert.equal(rangePosition(50, [20, 80], 600), 300);
  assert.equal(rangePosition(10, [20, 80], 600), -100);
});

test('short durations use plain minute wording', () => {
  assert.equal(durationLabel(0), 'under 1 min');
  assert.equal(durationLabel(59999), 'under 1 min');
  assert.equal(durationLabel(60000), '1 min');
});
