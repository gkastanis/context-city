import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeAgentsSample } from '../scripts/make-agents-sample.mjs';
import { agentBranches, maxParallel, allAgentsLoaded } from '../src/ui/agents.js';
import { findings } from '../src/ui/findings.js';
import { timeScale } from '../src/ui/timeline.js';

test('public Lantern PDF sample is deterministic and exercises linked transcript records', async () => {
  const sample = JSON.parse(await readFile(new URL('../sample/agents-session.json', import.meta.url), 'utf8'));
  assert.deepEqual(await makeAgentsSample(), sample);
  assert.equal(sample.requests.length, 40);
  assert.equal(sample.agents.length, 5);
  assert.equal(allAgentsLoaded(sample), true);
  const branches = agentBranches(sample);
  assert.equal(branches.length, 5);
  assert.equal(branches.filter(b => b.async).length, 4);
  assert.ok(branches.every(b => !b.open && b.forkBlockId && b.mergeBlockId));
  assert.ok(maxParallel(branches) >= 2);
  const parallel = sample.requests.map((_, idx) => branches.filter(b => idx >= b.fork && (b.open || idx < b.merge)).length);
  assert.equal(sample.meta.startRequest, parallel.indexOf(Math.max(...parallel)));
  assert.equal(parallel[sample.meta.startRequest], 3);
  assert.ok(Math.max(...branches.map(b => b.lane)) >= 1);
  const times = sample.requests.map(r => r.time);
  assert.ok(times.some((t, i) => i > 0 && t - times[i - 1] > 15 * 60000));
  assert.equal(timeScale(times, 1000).breaks.length, 1);
  assert.equal((times.at(-1) - times[0]) / 60000, 68.75);
  assert.deepEqual(sample.agents.map(a => Math.max(...a.session.requests.map(r => r.measuredTokens))), [60000, 45000, 25000, 28000, 35000]);
  for (const run of sample.agents) {
    assert.ok(run.session.requests.length >= 8 && run.session.requests.length <= 25);
    assert.ok(run.session.requests.every(r => r.usage.input > 0 && r.usage.cacheRead > 0 && r.usage.cacheWrite > 0));
    for (const kind of ['tool_def', 'system', 'user_text', 'thinking', 'tool_use', 'tool_result']) {
      assert.ok(Object.values(run.session.blocks).some(b => b.kind === kind), `${run.agentId}: ${kind}`);
    }
  }
  const checker = branches.find(b => b.agentId === 'checks');
  assert.ok(checker.returnedTokens >= 12000);
  assert.ok(checker.delegation < 3);
  const dump = Object.values(sample.blocks).find(b => b.kind === 'tool_result' && b.toolName === 'TaskOutput');
  assert.ok(dump.estTokens >= 12000);
  assert.ok(findings(sample).some(f => f.kind === 'heavy_result' && f.blockId === dump.id && !f.agentId));
  const reviewer = branches.find(b => !b.async);
  assert.ok(reviewer.runEnd > reviewer.runStart);
});
