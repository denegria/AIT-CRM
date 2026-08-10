import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const taskListSource = fs.readFileSync(new URL('../../components/TaskList.js', import.meta.url), 'utf8');
const tasksPageSource = fs.readFileSync(new URL('./page.js', import.meta.url), 'utf8');
const contactPageSource = fs.readFileSync(new URL('../contacts/[id]/page.js', import.meta.url), 'utf8');
const contactRouteSource = fs.readFileSync(new URL('../api/contacts/[id]/follow-up/route.js', import.meta.url), 'utf8');
const tasksRouteSource = fs.readFileSync(new URL('../api/tasks/route.js', import.meta.url), 'utf8');

test('Dashboard Log and Follow-up links open the exact outcome path, never generic New Task', () => {
  assert.match(taskListSource, /href=\{followUpTaskEntryHref\(t\)\}/);
  assert.doesNotMatch(taskListSource, /tasks\?contactId=.*taskType=follow_up/);
  assert.match(tasksPageSource, /searchParams\.get\('action'\) === 'log-follow-up'/);
  assert.match(tasksPageSource, /if \(!contactId \|\| searchParams\.get\('action'\) === 'log-follow-up'\) return undefined;/);
  assert.match(tasksPageSource, /assertExactFollowUpTaskSelection\(\{/);
});

test('Contact outcome submission carries the resolved exact identifiers and disables on selection conflict', () => {
  assert.match(contactPageSource, /taskId: followUpSubmissionTaskId\(\{/);
  assert.match(contactPageSource, /requestedTaskId: followUpRequestedTaskId/);
  assert.match(contactPageSource, /contactId: contact\.id/);
  assert.match(contactPageSource, /leadId: followUpLeadId/);
  assert.match(contactPageSource, /submitDisabled=\{followUpResolving \|\| Boolean\(followUpError\)\}/);
  assert.doesNotMatch(contactPageSource, /Completes oldest open follow-up task/);
  assert.match(contactPageSource, /does not complete or cancel any task/);
  assert.match(contactPageSource, /followUpRequestedTaskId \|\| followUpTask \? 'Complete follow-up' : 'Record outreach'/);
});

test('Contact completion route has no oldest-open completion fallback', () => {
  assert.doesNotMatch(contactRouteSource, /findOldestOpenFollowUpTask/);
  assert.doesNotMatch(contactRouteSource, /findOpenFollowUpTasks/);
  assert.match(contactRouteSource, /const existingTask = explicitTaskId/);
  assert.match(contactRouteSource, /: null;\s+\n\s+if \(existingTask/s);
  assert.match(contactRouteSource, /assertExactFollowUpTaskSelection\(\{/);
  assert.match(contactRouteSource, /resolveExactFollowUpTaskRequest\(\{/);
  assert.match(contactRouteSource, /resolveFollowUpLeadContext\(\{/);
  assert.match(contactRouteSource, /cancelOpenFollowUps: false/);
});

test('Tasks completion validates the exact Contact and Lead chain before calling the write service', () => {
  const contextIndex = tasksRouteSource.indexOf('const exactContext = await resolveExactFollowUpTaskContext({');
  const completionIndex = tasksRouteSource.indexOf('const { task, nextTask } = await completeFollowUpTaskWithActivity({');

  assert.notEqual(contextIndex, -1);
  assert.notEqual(completionIndex, -1);
  assert.ok(contextIndex < completionIndex);
});
