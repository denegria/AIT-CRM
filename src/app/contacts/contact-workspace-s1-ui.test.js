import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./[id]/page.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./[id]/ContactDetail.module.css', import.meta.url), 'utf8');
const pipeline = fs.readFileSync(new URL('../pipeline/page.js', import.meta.url), 'utf8');

test('AIT USA defaults to Activity with direct retained tabs and no standalone Record tab', () => {
  assert.match(source, /useState\('timeline'\)/);
  assert.doesNotMatch(source, />Record<\/button>/);
  assert.match(source, /aria-label="Current inquiry summary"/);
  assert.match(source, /Other phone numbers/);
  assert.match(source, /Last interaction/);
  assert.match(source, /Profile updated/);
  assert.match(source, /aria-label="Follow-up summary"/);
  assert.match(source, /scopedFollowUpTasksFromPayload/);
  assert.match(source, /role="menuitemradio"/);
  assert.match(source, /Edit contact/);
  assert.match(source, /isAitUsaContact \? 'Activity' : 'Timeline'/);
  assert.match(source, /isAitUsaContact \? 'Enrollments' : 'Courses'/);
  assert.match(source, /detailView\.tabs\.financialLabel/);
  assert.match(source, /detailView\.tabs\.workOrdersLabel/);
  assert.match(source, /\{profileSidebar\}/);
  assert.match(styles, /grid-template-columns: minmax\(320px, 340px\) minmax\(0, 872px\)/);
  assert.match(source, /Inquiries \(\{inquiryItems\.length\}\)/);
  assert.match(source, /Discard the open inquiry edits before selecting another inquiry/);
  assert.match(fs.readFileSync(new URL('../pipeline/page.js', import.meta.url), 'utf8'), /\/contacts\?create=inquiry/);
});

test('record uses actual inquiry resolution states without creating a substitute inquiry', () => {
  assert.match(source, /const selectedInquiryIsActive = Boolean\(selectedInquiry\?\.isActive\);/);
  assert.match(source, /contact\.opportunityConflict/);
  assert.match(source, /'Current inquiry'/);
  assert.match(source, /'Last inquiry'/);
  assert.match(source, /'No inquiry recorded'/);
  assert.match(source, /Start inquiry/);
  assert.match(source, /const openStartInquiry = \(\) => \{/);
  assert.match(source, /title=\{isAitUsaContact \? \(startOpportunityOpen \? 'Start inquiry' : editScope === 'inquiry' \? 'Edit inquiry' : 'Edit contact'\)/);
  assert.match(source, /active inquiries need resolution/);
  assert.match(source, /const contactSource = cleanText\(contact\?\.sourceLabel\) \|\| 'Unknown';/);
  assert.match(source, /const hasActiveInquiry = inquiryItems\.some\(\(item\) => item\.isActive\);/);
  assert.match(source, /const inquiryHistoryLoading = Boolean\(/);
  assert.match(source, /const inquiryHistoryReady = Boolean\(!inquiryHistoryLoading && !inquiryHistoryError\);/);
  assert.match(source, /!contact\?\.opportunityConflict && !hasActiveInquiry/);
  assert.match(source, /\(selectedInquiryIsActive \|\| !hasActiveInquiry\)/);
});

test('AIT USA render path keeps the production-language hierarchy without changing AIT Signs', () => {
  const viewModel = fs.readFileSync(new URL('../../lib/contact-detail-view-model.js', import.meta.url), 'utf8');
  assert.match(viewModel, /profileTitle: 'Student Profile'/);
  assert.doesNotMatch(viewModel, /profileTitle: 'Enrollment Profile'/);
  assert.match(source, /<div className=\{s\.profileIdentityMark\}>/);
  assert.match(source, /<h1 className=\{s\.profileName\}>\{contact\.name\}<\/h1>/);
  assert.match(source, /selectedInquiry\.program \|\| 'Program not recorded'/);
  assert.match(source, /No email on file/);
  assert.match(source, /lead: GraduationCap/);
  assert.match(source, /<details className=\{s\.timelineProvenance\}>/);
  assert.match(source, /<summary>Source details<\/summary>/);
  assert.match(source, /function timelineRawProvenanceText\(item = \{\}\)/);
  assert.match(source, /workbook_sha256=/);
  assert.match(source, /const rawProvenanceText = timelineRawProvenanceText\(item\)/);
  assert.match(source, /\{timelineText && <div className=\{`\$\{s\.timelineText\}/);
  assert.match(source, /\{rawProvenanceText && <pre className=\{s\.timelineRawText\}>\{rawProvenanceText\}<\/pre>\}/);
  assert.match(source, /!isAitUsaContact && <section className=\{s\.reviewContext\}/);
  assert.match(styles, /\.usaWorkspace \.contentSection \{[\s\S]*?box-shadow: var\(--shadow-soft\);/);
  assert.match(styles, /\.usaWorkspace \.profileCard \{[\s\S]*?background: linear-gradient/);
  assert.match(styles, /\.usaWorkspace \.contentTab\.active \{[\s\S]*?background: var\(--accent-muted\);/);
  assert.match(viewModel, /profileTitle: isSigns \? 'Customer Account' : 'Contact Profile'/);
  assert.match(styles, /\.contentSection:not\(.usaContent\) \.contentTabs/);
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
  assert.doesNotMatch(styles, /\.previewDetails/);
  assert.match(pipeline, /isAitUsaPipeline \? 'Work next inquiry' : 'Work Next Lead'/);
  assert.match(styles, /@media \(max-width: 900px\) \{\s+\.usaWorkspace \{ grid-template-columns: minmax\(0, 1fr\); \}\s+\.usaWorkspace \.profileCard \{\s+grid-column: 1;\s+grid-row: 1;/);
  assert.match(styles, /\.usaWorkspace \.contentSection \{\s+grid-column: 1;\s+grid-row: 2;/);
});

test('AIT USA preview and mutations bind to the exact selected inquiry', () => {
  assert.match(source, /const selectedInquiryIsActive = Boolean\(selectedInquiry\?\.isActive\);/);
  assert.match(source, /updatedAt: selectedInquiry\.updatedAt \|\| ''/);
  assert.match(source, /opportunityId: selectedInquiry\.id, updatedAt: selectedInquiry\.updatedAt, status: statusTo/);
  assert.match(source, /\{canEditSelectedInquiry && <button className="btn btn-sm" type="button" onClick=\{\(\) => openInquiryEditor\('general'\)\}/);
  assert.match(source, /\{selectedInquiry\.status \|\| 'Unknown'/);
  assert.match(source, /setInquiryReloadKey\(\(key\) => key \+ 1\)/);
  assert.match(source, /setIsEditModalOpen\(false\);\s+setTimelineReloadKey\(\(key\) => key \+ 1\);\s+setInquiryReloadKey\(\(key\) => key \+ 1\);\s+toast\('Inquiry started'\)/);
  assert.match(source, /isAitUsaContact && canStartInquiry && startOpportunityOpen/);
  assert.match(source, /'Loading inquiry history'/);
  assert.match(source, /'Inquiry history unavailable'/);
  assert.match(source, /Loading the permitted inquiry history…/);
  assert.match(source, /Inquiry history could not load\./);
  assert.doesNotMatch(source, /\{access\.canWriteCrm && <button className="btn btn-sm" type="button" onClick=\{\(\) => openInquiryEditor\('general'\)\}/);
});

test('AIT USA manual inquiry creation preserves unknown attribution', () => {
  const directory = fs.readFileSync(new URL('./page.js', import.meta.url), 'utf8');
  assert.match(directory, /isAitUsaDirectory \? 'Add prospective student' : `Add \$\{singularLabel\}`/);
  assert.match(directory, /source: defaultIsAitUsa \? '' : empty\.source/);
  assert.match(directory, /source: '',\s+assignedTo: '',\s+idempotencyKey:/);
  assert.match(directory, /\{isAitUsaForm && <option value="">Not recorded<\/option>\}/);
  assert.match(source, /!startOpportunityOpen && editScope === 'contact' && isAitUsaContact/);
});

test('enrollment presentation tolerates manual records without a class section', () => {
  const helper = source.match(/function classSectionScheduleLabel\(section = \{\}\) \{([\s\S]*?)\n\}/);
  assert.ok(helper, 'the rendered enrollment schedule helper is present');
  const scheduleLabel = new Function('section', helper[1]);
  assert.equal(scheduleLabel(null), '', 'manual enrollments have no linked class section');
  assert.equal(scheduleLabel(undefined), '');
  assert.equal(scheduleLabel({ scheduleDays: ['Mon', 'Wed'], startTime: '09:00', endTime: '10:30' }), 'Mon, Wed 09:00–10:30');
});

test('follow-up refresh invalidates exact task links and reuses the canonical contact patch', () => {
  assert.match(source, /const taskProjectionKey = \[contact\?\.id, contactBusinessUnit\?\.id, currentUser\?\.id, isPrivilegedFollowUpScope \? 'privileged' : 'regular', taskProjectionReloadKey\]\.join\(':'\);/);
  assert.doesNotMatch(source, /setTaskProjection\(\{ key: requestKey, items: \[\], loading: true, error: '' \}\);/);
  assert.match(source, /import \{ contactPatchForFollowUpOutcome \} from '@\/lib\/tasks\/follow-up\.js';/);
  assert.match(source, /const contactPatch = contactPatchForFollowUpOutcome\(followUpDraft\.outcome\);\s+if \(contactPatch\) replaceContactFromServer\(\{ \.\.\.contact, \.\.\.contactPatch \}\);/);
  assert.match(source, /setTimelineReloadKey\(\(key\) => key \+ 1\);\s+setTaskProjectionReloadKey\(\(key\) => key \+ 1\);/);
});

test('AIT USA contains no dormant legacy preview or generic contact-details wall', () => {
  assert.doesNotMatch(source, /false && isAitUsaContact/);
  assert.doesNotMatch(source, /Contact preview and current inquiry summary/);
  assert.doesNotMatch(source, /<summary>Contact details<\/summary>/);
  assert.doesNotMatch(styles, /\.inquiryPreview/);
  assert.doesNotMatch(styles, /\.previewDetails/);
});

test('AIT USA contact-wide restrictions suppress direct outreach actions', () => {
  assert.match(source, /const aitUsaOutreachBlocked = isAitUsaContact && detailView\.contactability\?\.canFollowUp === false;/);
  assert.match(source, /const primaryPhoneDirectActionAllowed = !aitUsaOutreachBlocked && !contact\?\.isWrongNumber && !contact\?\.isDoNotCall;/);
  assert.match(source, /aitUsaOutreachBlocked \? <span className=\{s\.infoLink\}>\{contact\.email\}<\/span> : <a className=\{s\.infoLink\} href=\{`mailto:/);
  assert.match(source, /primaryPhoneDirectActionAllowed \? <a className=\{s\.infoLink\} href=\{phoneHref\(contact\.phone\)\}>/);
  assert.match(source, /if \(!access\.canSendOutboundMessages \|\| !contact\?\.id \|\| manualSend\.sending \|\| aitUsaOutreachBlocked\) return;/);
  assert.match(source, /Outreach is disabled for this contact\./);
  assert.match(source, /disabled=\{aitUsaOutreachBlocked \|\| manualSend\.sending/);
});

test('AIT USA follow-up commitments retain the scheduled time', () => {
  assert.match(source, /function taskDateLabel\(value\) \{[\s\S]*?hour: 'numeric',[\s\S]*?minute: '2-digit'/);
});
