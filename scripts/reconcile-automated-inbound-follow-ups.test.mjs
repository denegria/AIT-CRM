import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);

test('fixture reconciliation excludes cross-contact, historical, and imported automated tasks', async () => {
  const { stdout } = await run(process.execPath, [
    'scripts/reconcile-automated-inbound-follow-ups.mjs',
    '--fixture', 'scripts/fixtures/mis-316-task-integrity.json',
    '--organization-id', 'org-fixture',
    '--business-unit-id', 'bu-fixture',
  ], { cwd: process.cwd() });
  const plan = JSON.parse(stdout);

  assert.deepEqual(plan.candidates.map((candidate) => candidate.taskId), [
    'task-owner',
    'task-enrolled',
    'task-unassigned',
  ]);
  assert.deepEqual(plan.groupedCounts, { sync_owner: 2, cancel: 1 });
});
