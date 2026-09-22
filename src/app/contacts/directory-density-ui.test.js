import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const contactsSource = fs.readFileSync(new URL('./page.js', import.meta.url), 'utf8');
const tableSource = fs.readFileSync(new URL('../../components/DataTable.js', import.meta.url), 'utf8');
const tableStyles = fs.readFileSync(new URL('../../components/DataTable.module.css', import.meta.url), 'utf8');

test('AIT USA directory defaults to the accepted lookup hierarchy', () => {
  assert.match(contactsSource, /label: 'Contact'/);
  assert.match(contactsSource, /label: 'Enrollment'/);
  assert.match(contactsSource, /label: 'Owner'/);
  assert.match(contactsSource, /label: 'Next Step'/);
  assert.match(contactsSource, /label: 'Last Touch'/);
  assert.match(contactsSource, /label: 'Source'/);
  assert.match(contactsSource, /defaultVisibleColumnKeys=\{columnMode === 'ait_usa' \? \[/);
  assert.match(contactsSource, /'name',\s*'enrollmentStage',\s*'assignedLabel',\s*'lastTouch',\s*'inquirySource',\s*'directoryNextStep'/s);
});

test('AIT USA rows use explicit View navigation without row-wide handlers or Edit', () => {
  assert.doesNotMatch(contactsSource, /onRowClick=/);
  assert.doesNotMatch(tableSource, /handleRowClick|handleRowKeyDown|clickableRow/);
  assert.match(contactsSource, /\{ label: 'View', onClick: openContact \}/);
  assert.match(contactsSource, /columnMode !== 'ait_usa' \|\| action\.label === 'View'/);
  assert.doesNotMatch(contactsSource, /ChevronRight|DirectoryRowEnd/);
});

test('mobile keeps only the high-value contact fields and explicit View action', () => {
  assert.match(contactsSource, /\? \['assignedLabel', 'directoryNextStep', 'lastTouch'\]/);
  assert.match(contactsSource, /nextStep\.action === 'log_follow_up'/);
  assert.match(contactsSource, /\{nextStep\.actionLabel\}/);
  assert.match(tableSource, /\{actions\?\.map/);
});

test('large desktop directory uses intentional widths, comfortable rows, and a sticky header', () => {
  assert.match(contactsSource, /desktopWidth: '22%'/);
  assert.match(contactsSource, /desktopWidth: '16%'/);
  assert.match(contactsSource, /desktopWidth: '10%'/);
  assert.match(contactsSource, /fixedLayout=\{columnMode === 'ait_usa'\}/);
  assert.match(contactsSource, /stickyHeader=\{columnMode === 'ait_usa'\}/);
  assert.match(contactsSource, /comfortableRows=\{columnMode === 'ait_usa'\}/);
  assert.match(contactsSource, /actionColumnWidth=\{columnMode === 'ait_usa' \? '6%' : undefined\}/);
  assert.match(tableStyles, /\.tableFixed \{ min-width:0; table-layout:fixed; \}/);
  assert.match(tableStyles, /\.tableStickyHeader thead th/);
  assert.match(tableStyles, /\.tableComfortable td \{ padding-top:14px; padding-bottom:14px; \}/);
  assert.match(tableSource, /visibleColumns\.every\(\(column\) => defaultLayoutKeys\.has\(column\.key\)\)/);
});

test('closed rows do not repeat the enrollment reason in Next Step', () => {
  assert.match(contactsSource, /nextStep\.label === 'No active work' && nextStep\.detail === row\.enrollmentStage/);
});
