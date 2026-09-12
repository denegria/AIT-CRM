import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./[id]/page.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./[id]/ContactDetail.module.css', import.meta.url), 'utf8');
const pipeline = fs.readFileSync(new URL('../pipeline/page.js', import.meta.url), 'utf8');

test('AIT USA defaults to Activity with direct retained tabs and no standalone Record tab', () => {
  assert.match(source, /useState\('timeline'\)/);
  assert.doesNotMatch(source, />Record<\/button>/);
  assert.match(source, /aria-label="Contact preview and current inquiry summary"/);
  assert.match(source, /Contact details/);
  assert.match(source, /Edit contact/);
  assert.match(source, /isAitUsaContact \? 'Activity' : 'Timeline'/);
  assert.match(source, /isAitUsaContact \? 'Enrollments' : 'Courses'/);
  assert.match(source, /detailView\.tabs\.financialLabel/);
  assert.match(source, /detailView\.tabs\.workOrdersLabel/);
  assert.match(source, /\{profileSidebar\}/);
  assert.match(styles, /grid-template-columns: minmax\(292px, 304px\) minmax\(0, 1fr\)/);
  assert.match(source, /Inquiries \(\{inquiryItems\.length\}\)/);
  assert.match(source, /aria-label="Selected inquiry"/);
  assert.match(source, /Discard the open inquiry edits before selecting another inquiry/);
  assert.match(fs.readFileSync(new URL('../pipeline/page.js', import.meta.url), 'utf8'), /\/contacts\?create=inquiry/);
});

test('record uses actual inquiry resolution states without creating a substitute inquiry', () => {
  assert.match(source, /hasResolvedCurrentInquiry/);
  assert.match(source, /hasClosedInquiry/);
  assert.match(source, /contact\.opportunityConflict/);
  assert.match(source, /'Current inquiry'/);
  assert.match(source, /'Last inquiry \(closed\)'/);
  assert.match(source, /'No active inquiry'/);
  assert.match(source, /Start inquiry/);
  assert.match(source, /const openStartInquiry = \(\) => \{/);
  assert.match(source, /onClick=\{openStartInquiry\}/);
  assert.match(source, /title=\{isAitUsaContact \? \(startOpportunityOpen \? 'Start inquiry' : editScope === 'inquiry' \? 'Edit inquiry' : 'Edit contact'\)/);
  assert.match(source, /active inquiries need resolution/);
  assert.match(source, /const contactSource = cleanText\(contact\?\.sourceLabel\) \|\| 'Unknown';/);
  assert.match(source, /const inquirySource = cleanText\(contact\?\.inquirySource\) \|\| 'Unknown';/);
  assert.match(source, /Coordinator/);
  assert.match(source, /Change<\/button>/);
  assert.match(source, /aria-label="Change inquiry status"/);
  assert.match(source, /aria-label="Change inquiry owner"/);
  assert.match(source, /const hasActiveInquiry = inquiryItems\.some\(\(item\) => item\.isActive\);/);
  assert.match(source, /inquiriesState\.contactId === contact\?\.id && !inquiriesState\.loading && !inquiriesState\.error/);
  assert.match(source, /!contact\?\.opportunityConflict && !hasActiveInquiry/);
  assert.match(source, /\(selectedInquiryIsActive \|\| !hasActiveInquiry\)/);
});

test('S1 keeps established action paths and supplies bounded responsive layout', () => {
  assert.match(source, /onClick=\{\(\) => openEditModal\(\)\}/);
  assert.doesNotMatch(source, /onClick=\{openEditModal\}/, 'click events must not become editor scopes');
  assert.match(source, /onClick=\{\(\) => openInquiryEditor\('general'\)\}/);
  assert.match(source, /href=\{`\/tasks\?contactId=\$\{encodeURIComponent\(contact\.id\)\}&taskType=follow_up`\}/);
  assert.match(source, /openCourseModal\('new'\)/);
  assert.match(source, /downloadFinancialPdf\(f\)/);
  assert.match(source, /href=\{`\/work-orders\/\$\{wo\.id\}`\}/);
  assert.match(styles, /\.usaWorkspace/);
  assert.match(source, /!isAitUsaContact && <div className=\{s\.snapshotStrip\}/);
  assert.match(styles, /\.previewDetails/);
  assert.match(pipeline, /isAitUsaPipeline \? 'Work next inquiry' : 'Work Next Lead'/);
  assert.match(styles, /@media \(max-width: 900px\) \{\s+\.usaWorkspace \{ grid-template-columns: minmax\(0, 1fr\); \}\s+\.usaWorkspace \.profileCard \{\s+grid-column: 1;\s+grid-row: 1;/);
  assert.match(styles, /\.usaWorkspace \.contentSection \{\s+grid-column: 1;\s+grid-row: 2;/);
});

test('AIT USA preview and mutations bind to the exact selected inquiry', () => {
  assert.match(source, /const selectedInquiryIsActive = Boolean\(selectedInquiry\?\.isActive\);/);
  assert.match(source, /updatedAt: selectedInquiry\.updatedAt \|\| ''/);
  assert.match(source, /opportunityId: selectedInquiry\.id, updatedAt: selectedInquiry\.updatedAt, status: statusTo/);
  assert.match(source, /\{canEditSelectedInquiry && \(/);
  assert.match(source, /\{selectedInquiry\.status \|\| 'Unknown'/);
  assert.match(source, /setInquiryReloadKey\(\(key\) => key \+ 1\)/);
  assert.match(source, /setIsEditModalOpen\(false\);\s+setTimelineReloadKey\(\(key\) => key \+ 1\);\s+setInquiryReloadKey\(\(key\) => key \+ 1\);\s+toast\('Inquiry started'\)/);
  assert.match(source, /\{canStartInquiry && <button className="btn btn-sm" type="button" onClick=\{openStartInquiry\}>Start inquiry<\/button>\}/);
  assert.doesNotMatch(source, /\{access\.canWriteCrm && <button className="btn btn-sm" type="button" onClick=\{\(\) => openInquiryEditor\('general'\)\}/);
});

test('AIT USA manual inquiry creation preserves unknown attribution', () => {
  const directory = fs.readFileSync(new URL('./page.js', import.meta.url), 'utf8');
  assert.match(directory, /source: defaultIsAitUsa \? '' : empty\.source/);
  assert.match(directory, /source: '',\s+assignedTo: '',\s+idempotencyKey:/);
  assert.match(directory, /\{isAitUsaForm && <option value="">Not recorded<\/option>\}/);
});

test('enrollment presentation tolerates manual records without a class section', () => {
  const helper = source.match(/function classSectionScheduleLabel\(section = \{\}\) \{([\s\S]*?)\n\}/);
  assert.ok(helper, 'the rendered enrollment schedule helper is present');
  const scheduleLabel = new Function('section', helper[1]);
  assert.equal(scheduleLabel(null), '', 'manual enrollments have no linked class section');
  assert.equal(scheduleLabel(undefined), '');
  assert.equal(scheduleLabel({ scheduleDays: ['Mon', 'Wed'], startTime: '09:00', endTime: '10:30' }), 'Mon, Wed 09:00–10:30');
});
