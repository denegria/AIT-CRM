import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./[id]/page.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../globals.css', import.meta.url), 'utf8');
const sidebarStyles = fs.readFileSync(new URL('./[id]/ContactDetail.module.css', import.meta.url), 'utf8');

test('AIT USA profile editor uses Contact, inquiry, and inquiry-preference tabs', () => {
  assert.match(source, /id: 'contact', label: 'Contact'/);
  assert.match(source, /id: 'inquiry', label: inquiryProfileHeading/);
  assert.match(source, /id: 'preferences', label: 'Inquiry preferences'/);
  assert.match(source, /activeProfileEditTab === 'contact' && isAitUsaContact/);
  assert.match(source, /activeProfileEditTab === 'inquiry' && isAitUsaContact/);
  assert.match(source, /activeProfileEditTab === 'preferences' && isAitUsaContact/);
  assert.match(source, /Current inquiry/);
  assert.match(source, /Last inquiry/);
});

test('profile tabs are random-access controls with standard keyboard navigation', () => {
  assert.match(source, /role="tablist" aria-label="Profile edit sections"/);
  assert.match(source, /tabIndex=\{selected \? 0 : -1\}/);
  assert.match(source, /onKeyDown=\{\(event\) => handleProfileEditTabKeyDown\(event, tabIndex\)\}/);
  assert.match(source, /event\.key === 'ArrowRight'/);
  assert.match(source, /event\.key === 'ArrowLeft'/);
  assert.match(source, /profileEditTabRefs\.current\[nextIndex\]\?\.focus\(\)/);
});

test('AIT USA inquiry fields have one truthful scope and progressive disclosure', () => {
  assert.match(source, />Inquiry status<\/label>/);
  assert.match(source, />Inquiry owner<\/label>/);
  assert.match(source, />Student location<\/label>/);
  assert.match(source, />Intended learning location<\/label>/);
  assert.match(source, /<summary>\s*<span>Source details<\/span>/);
  assert.match(source, /<summary>\s*<span>Additional preferences<\/span>/);
  assert.match(source, />Inquiry details<\/label>/);
  assert.match(source, /not an internal Activity note/);
  assert.match(styles, /\.profile-editor-disclosure/);
});

test('Edit profile cannot split the Start enrollment transaction', () => {
  assert.match(source, /profileStatusOptions/);
  assert.match(source, /filter\(\(status\) => !isEnrolledWorkflowStatus\(status\)\)/);
  assert.match(source, /Enrollment status is managed in the Enrollments workspace/);
  assert.match(source, /openEnrollmentWorkspaceFromProfile/);
  assert.match(source, /Start enrollment/);
  assert.doesNotMatch(source, /const shouldPromptForCourse = isAitUsaContact &&\s*editForm\.status !== contact\.status/);
});

test('hidden-tab validation opens and focuses the inquiry error', () => {
  assert.match(source, /focusProfileEditField\(isAitUsaContact \? 'inquiry' : 'general', 'profile-edit-reopen-reason'/);
  assert.match(source, /focusProfileEditField\(isAitUsaContact \? 'inquiry' : 'general', 'profile-edit-terminal-reason'/);
  assert.match(source, /document\.getElementById\(fieldId\)\?\.focus\(\)/);
});

test('Archive is outside the save dialog under a Contact overflow action', () => {
  assert.match(source, /className=\{s\.contactProfileActions\}/);
  assert.match(source, /<summary aria-label="More contact actions">/);
  assert.match(source, /Archive contact/);
  assert.match(sidebarStyles, /\.contactProfileActions/);
  assert.match(source, /activeProfileEditTab === 'general' && !isAitUsaContact/);
});

test('AIT Signs retains the legacy profile editor path', () => {
  assert.match(source, /id: 'general', label: 'General'/);
  assert.match(source, /id: 'source', label: 'Source & routing'/);
  assert.match(source, /activeProfileEditTab === 'general' && !isAitUsaContact/);
  assert.match(source, /activeProfileEditTab === 'source' && !isAitUsaContact/);
});
