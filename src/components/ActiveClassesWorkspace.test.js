import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./ActiveClassesWorkspace.js', import.meta.url), 'utf8');

test('workspace preserves the approved Overview, Roster, and Attendance tabs without Activity', () => {
  assert.match(source, /const TABS = \['overview', 'roster', 'attendance'\]/);
  assert.doesNotMatch(source, /'activity'/i);
  assert.match(source, /Session notes/);
  assert.match(source, /This week · oldest to newest/);
  assert.match(source, /Open roster/);
});

test('roster links remain conditional on the server-provided capability', () => {
  assert.match(source, /workspace\.canLinkContacts && student\.contactId/);
  assert.match(source, /href={`\/contacts\/\$\{student\.contactId\}`}/);
  assert.match(source, /canReopenSubmittedAttendance/);
});

test('Quick Mark keeps unmarked explicit and guards submission completeness', () => {
  assert.match(source, /Mark all present/);
  assert.match(source, /Unmarked/);
  assert.match(source, /Mark every student before submitting/);
  assert.match(source, /counts\.unmarked > 0/);
  assert.match(source, /Submit attendance/);
  assert.match(source, /<Check size=\{14\} \/> Saved/);
  assert.doesNotMatch(source, /: 'Ready'/);
});

test('mobile class rail keeps the selected class visible without forcing motion', () => {
  assert.match(source, /classCardRefs\.current\.get\(selectedClassId\)/);
  assert.match(source, /scrollIntoView/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /inline: 'center'/);
});
