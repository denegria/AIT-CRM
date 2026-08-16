import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const tasksSource = fs.readFileSync(new URL('./page.js', import.meta.url), 'utf8');
const taskDetailSource = fs.readFileSync(new URL('./[id]/page.js', import.meta.url), 'utf8');
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
