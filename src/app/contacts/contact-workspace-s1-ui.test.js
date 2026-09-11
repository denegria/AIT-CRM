import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./[id]/page.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./[id]/ContactDetail.module.css', import.meta.url), 'utf8');
const pipeline = fs.readFileSync(new URL('../pipeline/page.js', import.meta.url), 'utf8');

test('AIT USA defaults to a single identity workspace with direct retained tabs', () => {
  assert.match(source, /useState\('record'\)/);
  assert.match(source, /aria-label="Contact identity"/);
  assert.match(source, /Edit contact/);
  assert.match(source, />Record<\/button>/);
  assert.match(source, /isAitUsaContact \? 'Activity' : 'Timeline'/);
  assert.match(source, /isAitUsaContact \? 'Enrollments' : 'Courses'/);
  assert.match(source, /detailView\.tabs\.financialLabel/);
  assert.match(source, /detailView\.tabs\.workOrdersLabel/);
  assert.match(source, /!isAitUsaContact && profileSidebar/);
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
  assert.match(source, /title=\{isAitUsaContact \? \(editScope === 'inquiry' \? 'Edit inquiry' : 'Edit contact'\)/);
  assert.match(source, /active inquiries need resolution before inquiry changes can be made/);
  assert.match(source, /const contactSource = cleanText\(contact\?\.sourceLabel\) \|\| 'Unknown';/);
  assert.match(source, /const inquirySource = cleanText\(contact\?\.inquirySource\) \|\| 'Unknown';/);
});

test('S1 keeps established action paths and supplies bounded responsive layout', () => {
  assert.match(source, /onClick=\{openEditModal\}/);
  assert.match(source, /onClick=\{\(\) => openInquiryEditor\(\)\}/);
  assert.match(source, /href=\{`\/tasks\?contactId=\$\{encodeURIComponent\(contact\.id\)\}&taskType=follow_up`\}/);
  assert.match(source, /openCourseModal\('new'\)/);
  assert.match(source, /downloadFinancialPdf\(f\)/);
  assert.match(source, /href=\{`\/work-orders\/\$\{wo\.id\}`\}/);
  assert.match(styles, /\.usaWorkspace/);
  assert.match(styles, /\.propertyGrid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(styles, /\.propertyGrid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(pipeline, /isAitUsaPipeline \? 'Work next inquiry' : 'Work Next Lead'/);
});
