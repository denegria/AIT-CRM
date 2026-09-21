import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./[id]/page.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./[id]/ContactDetail.module.css', import.meta.url), 'utf8');
const routeSource = fs.readFileSync(new URL('../api/contacts/[id]/courses/route.js', import.meta.url), 'utf8');

test('AIT USA Enrollments uses one workspace header and one empty state', () => {
  assert.match(source, /className=\{s\.courseWorkspaceHeader\}/);
  assert.match(source, /<h2>Enrollments<\/h2>/);
  assert.match(source, /No enrollments yet/);
  assert.doesNotMatch(source, /No course history yet/);
  assert.doesNotMatch(source, /Start Course/);
  assert.doesNotMatch(source, />Add History</);
  assert.match(styles, /\.courseWorkspaceHeader/);
});

test('current and past enrollment actions have one explicit intent each', () => {
  assert.match(source, /Add past enrollment/);
  assert.match(source, /activeCourseRecords\.length \? 'Add another enrollment' : 'Start enrollment'/);
  assert.match(source, /enrollmentIntent: courseModal === 'history' \? 'past_enrollment' : 'start_enrollment'/);
  assert.match(source, /opportunityId: contact\.opportunityId \|\| ''/);
  assert.match(source, /Starting this enrollment also updates the current inquiry status to Enrolled\./);
  assert.match(source, /Add an enrollment that already ended without changing the current inquiry\./);
});

test('active enrollments and ended history are separated without duplicate records', () => {
  assert.match(source, /historicalCourseRecords = useMemo/);
  assert.match(source, /record\.status !== 'active'/);
  assert.match(source, /id="active-enrollments-heading">Active enrollments/);
  assert.match(source, /id="enrollment-history-heading">Enrollment history/);
  assert.match(source, /activeCourseRecords\.map/);
  assert.match(source, /historicalCourseRecords\.map/);
});

test('server route owns the atomic enrollment and inquiry transition boundary', () => {
  assert.match(routeSource, /createCourseRecordWithEnrollmentLifecycle/);
  assert.match(routeSource, /expectedOpportunityId: cleanString\(body\.opportunityId \|\| lead\?\.id\)/);
  assert.match(routeSource, /authorize: \(\{ opportunity \}\) => assertCanAccessContactLead/);
  assert.match(routeSource, /Starting an enrollment requires a current enrollment record\./);
  assert.match(routeSource, /Past enrollments must use an ended status\./);
});
