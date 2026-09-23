import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const tasksSource = fs.readFileSync(new URL('./page.js', import.meta.url), 'utf8');
const taskDetailSource = fs.readFileSync(new URL('./[id]/page.js', import.meta.url), 'utf8');
const taskStyles = fs.readFileSync(new URL('./FollowUpQueue.module.css', import.meta.url), 'utf8');
const globalStyles = fs.readFileSync(new URL('../globals.css', import.meta.url), 'utf8');

test('Task Detail uses the shared notification safe area', () => {
  assert.match(taskDetailSource, /className=\{`\$\{s\.topBar\} app-notification-safe`\}/);
  assert.match(globalStyles, /:where\(\.page-header, \.app-notification-safe\)\s*\{[^}]*padding-right: var\(--app-notification-clearance\)/s);
  assert.match(globalStyles, /--app-notification-clearance: 56px/);
  assert.match(globalStyles, /--app-notification-clearance: 46px/);
});

test('New Task identifies and explains the first invalid editable required field', () => {
  assert.match(tasksSource, /const \[createErrorField, setCreateErrorField\] = useState\(''\);/);
  assert.match(tasksSource, /id="new-task-form-error"[^>]*role="alert"/s);

  for (const field of [
    ['new-task-title', 'title'],
    ['new-task-owner', 'ownerUserId'],
    ['new-task-business-unit', 'businessUnitId'],
    ['new-task-due-date', 'dueDate'],
  ]) {
    const [id, name] = field;
    const controlPattern = new RegExp(`id="${id}"[\\s\\S]*?name="${name}"[\\s\\S]*?required[\\s\\S]*?aria-required="true"[\\s\\S]*?aria-invalid=\\{createErrorField === '${name}'`);
    assert.match(tasksSource, controlPattern, `${name} should expose required and invalid state`);
  }

  assert.match(tasksSource, /aria-describedby=\{createErrorField === 'title' \? 'new-task-form-error' : undefined\}/);
  assert.match(tasksSource, /setCreateErrorField\(fieldName\);/);
  assert.match(tasksSource, /createFormRef\.current\?\.elements\.namedItem\(fieldName\)\?\.focus\(\);/);

  const ownerCheck = tasksSource.indexOf("showCreateValidationError('Task owner is required.'");
  const divisionCheck = tasksSource.indexOf('showCreateValidationError(`${scopeLabel} is required.`');
  const dueDateCheck = tasksSource.indexOf("showCreateValidationError('Task due date is required.'");
  assert.ok(ownerCheck < divisionCheck && divisionCheck < dueDateCheck, 'validation should follow the visible field order');
});

test('New Task clears a field error when that field is corrected', () => {
  assert.match(tasksSource, /function clearCreateValidationError\(changedFields = \[\]\)/);
  assert.match(tasksSource, /!createErrorField \|\| changedFields\.includes\(createErrorField\)/);
  assert.match(tasksSource, /clearCreateValidationError\(Object\.keys\(patch\)\);/);
  assert.match(tasksSource, /clearCreateValidationError\(\['businessUnitId'\]\);/);
});

test('generic task actions and the edit form submit the loaded task version', () => {
  assert.match(tasksSource, /expectedUpdatedAt: task\.updatedAt/);
  assert.match(tasksSource, /expectedUpdatedAt: editDraft\.expectedUpdatedAt/);
  assert.match(tasksSource, /expectedUpdatedAt: task\.updatedAt \|\| ''/);
});

test('task queue consolidates filters and row actions without removing workflow access', () => {
  assert.match(tasksSource, /aria-controls="secondary-task-filters"/);
  assert.match(tasksSource, /secondaryFiltersOpen && \(/);
  assert.match(tasksSource, />\s*Filters\s*/);
  assert.doesNotMatch(tasksSource, />\s*Review\s*</);
  assert.doesNotMatch(tasksSource, />\s*Assign to me\s*</);
  assert.match(tasksSource, /task\.contactName \|\| \(task\.contactId \? 'Linked contact' : 'No contact linked'\)/);
  assert.match(tasksSource, />\s*Log outcome\s*</);
  assert.match(tasksSource, />\s*Contact\s*</);
  assert.match(tasksSource, />\s*More\s*</);
});

test('task queue default chrome reflects only user-controlled filters', () => {
  assert.match(tasksSource, /const secondaryFilterCount = \[/);
  assert.match(tasksSource, /const businessUnitFilterIsUserControlled = !currentBusinessUnitId/);
  assert.match(tasksSource, /const hasUserControlledFilters = filters\.due !== 'open'/);
  assert.match(tasksSource, /secondaryFilterCount > 0 && \(/);
  assert.match(tasksSource, /!currentBusinessUnitId && \(/);
  assert.match(tasksSource, /hasUserControlledFilters && \(\s*<button className="btn btn-sm"/s);
  assert.match(tasksSource, />\s*View unassigned\s*</);
  assert.doesNotMatch(tasksSource, />\s*Show queue\s*</);
  assert.doesNotMatch(tasksSource, /className=\{s\.queueCount\}/);
  assert.doesNotMatch(tasksSource, /className=\{s\.queueSubtitle\}/);
});

test('task workload metrics are integrated into the queue header', () => {
  assert.match(tasksSource, /<div className=\{s\.queueHeaderMain\}>[\s\S]*?<dl className=\{s\.queueMetrics\} aria-label="Task workload summary">/);
  assert.match(tasksSource, /<dt className=\{s\.summaryLabel\}>Due Now<\/dt>/);
  assert.match(tasksSource, /<dt className=\{s\.summaryLabel\}>Due Today<\/dt>/);
  assert.match(tasksSource, /<dt className=\{s\.summaryLabel\}>Overdue<\/dt>/);
  assert.match(tasksSource, /<dt className=\{s\.summaryLabel\}>Done Today<\/dt>/);
  assert.match(tasksSource, /stats\.overdue > 0 \? s\.summaryValueOverdue : ''/);
  assert.doesNotMatch(tasksSource, /summaryStrip|summaryTile(Current|Today|Overdue|Completed)/);
});

test('task queue uses one flat work surface and secondary contextual actions', () => {
  assert.match(tasksSource, /<div className=\{s\.queueAlert\}>/);
  assert.match(tasksSource, /<button className="btn btn-sm" type="button" onClick=\{showUnassignedLeadFollowUps\}>/);
  assert.doesNotMatch(tasksSource, /className=\{s\.intakeAlert\}/);
  assert.match(tasksSource, /task\.status !== 'open' && \(/);
  assert.match(tasksSource, /className=\{`btn btn-sm \$\{s\.outcomeAction\}`\}/);
  assert.doesNotMatch(tasksSource, /className="btn btn-sm btn-primary"[\s\S]{0,180}Log outcome/);
  assert.doesNotMatch(tasksSource, /queueItemOverdue|queueItemToday/);
  assert.match(taskStyles, /\.queueShell\s*\{[^}]*margin: 0 -20px;[^}]*border-bottom:/s);
  assert.match(taskStyles, /\.queueItem\s*\{[^}]*background: transparent;[^}]*border-top:/s);
  assert.match(taskStyles, /\.outcomeAction\s*\{[^}]*color: var\(--accent\)/s);
  assert.doesNotMatch(taskStyles, /\.queueItem(Overdue|Today)\b/);
});

test('Task Detail is outcome-first and keeps advanced controls deliberate', () => {
  assert.match(taskDetailSource, /function followUpHref\(task\)/);
  assert.match(taskDetailSource, /action: 'log-follow-up'/);
  assert.match(taskDetailSource, />\s*Log outcome\s*</);
  assert.doesNotMatch(taskDetailSource, />\s*Open Queue\s*</);
  assert.match(taskDetailSource, /<details className=\{s\.moreMenu\}>/);
  assert.match(taskDetailSource, /aria-label="Task owner"/);
  assert.match(taskDetailSource, /action: 'assign'/);
});
