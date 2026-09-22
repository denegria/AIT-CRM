import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const contactsSource = fs.readFileSync(new URL('./page.js', import.meta.url), 'utf8');
const tableSource = fs.readFileSync(new URL('../../components/DataTable.js', import.meta.url), 'utf8');
const tableStyles = fs.readFileSync(new URL('../../components/DataTable.module.css', import.meta.url), 'utf8');

test('AIT USA directory defaults to the accepted lookup hierarchy', () => {
  assert.match(contactsSource, /label: 'Contact'/);
  assert.match(contactsSource, /label: 'Stage'/);
  assert.match(contactsSource, /label: 'Owner'/);
  assert.match(contactsSource, /label: 'Source'/);
  assert.match(contactsSource, /label: 'Last Touch'/);
  assert.match(contactsSource, /label: 'Next Step'/);
  assert.match(contactsSource, /defaultVisibleColumnKeys=\{columnMode === 'ait_usa' \? \[/);
  assert.match(contactsSource, /'name',\s*'enrollmentStage',\s*'assignedLabel',\s*'inquirySource',\s*'lastTouch',\s*'directoryNextStep'/s);
});

test('AIT USA rows use explicit View navigation without row-wide handlers or Edit', () => {
  assert.doesNotMatch(contactsSource, /onRowClick=/);
  assert.doesNotMatch(tableSource, /handleRowClick|handleRowKeyDown|clickableRow/);
  assert.match(contactsSource, /\{ label: 'View', onClick: openContact \}/);
  assert.match(contactsSource, /columnMode === 'ait_usa' \? \[/);
  assert.match(contactsSource, /visible: \(row\) => canWrite && directoryNextStepFor\(row\)\.action === 'log_follow_up'/);
  assert.doesNotMatch(contactsSource, /ChevronRight|DirectoryRowEnd/);
});

test('mobile keeps only the high-value contact fields and contextual actions beside View', () => {
  assert.match(contactsSource, /\? \['assignedLabel', 'directoryNextStep', 'lastTouch'\]/);
  assert.match(contactsSource, /label: \(row\) => directoryNextStepFor\(row\)\.actionLabel/);
  assert.match(contactsSource, /visible: \(row\) => canWrite && directoryNextStepFor\(row\)\.action === 'log_follow_up'/);
  assert.match(tableSource, /visibleActionsForRow\(actions, row\)/);
  assert.match(tableSource, /action\.primary \? s\.actBtnPrimary/);
  assert.match(tableStyles, /\.actions \{ display:flex; gap:4px;/);
  assert.match(contactsSource, /buttonWidth: '112px'/);
  assert.match(tableSource, /style=\{a\.buttonWidth \? \{ width: a\.buttonWidth \} : undefined\}/);
});

test('large desktop directory uses intentional widths, comfortable rows, and a sticky header', () => {
  assert.match(contactsSource, /desktopWidth: '27%'/);
  assert.match(contactsSource, /desktopWidth: '20%'/);
  assert.match(contactsSource, /desktopWidth: '13%'/);
  assert.match(contactsSource, /key: 'directoryNextStep',[\s\S]*?desktopWidth: '16%'/);
  assert.doesNotMatch(contactsSource, /headerAlign:/);
  assert.match(contactsSource, /fixedLayout=\{columnMode === 'ait_usa'\}/);
  assert.match(contactsSource, /stickyHeader=\{columnMode === 'ait_usa'\}/);
  assert.match(contactsSource, /comfortableRows=\{columnMode === 'ait_usa'\}/);
  assert.match(contactsSource, /actionColumnWidth=\{columnMode === 'ait_usa' \? '180px' : undefined\}/);
  assert.match(tableStyles, /\.tableFixed \{ min-width:0; table-layout:fixed; \}/);
  assert.match(tableStyles, /\.tableStickyHeader thead th/);
  assert.match(tableStyles, /\.tableComfortable td \{ padding-top:14px; padding-bottom:14px; \}/);
  assert.doesNotMatch(tableSource, /headerAlign/);
  assert.match(tableStyles, /\.table th\.actionHeader \{ text-align:left; padding-left:12px; \}/);
  assert.match(fs.readFileSync(new URL('../globals.css', import.meta.url), 'utf8'), /\.contacts-contact-cell > span \{[\s\S]*?color:var\(--text-secondary\);[\s\S]*?font-size:12px;/);
  assert.match(fs.readFileSync(new URL('../globals.css', import.meta.url), 'utf8'), /\.contacts-source-cell \{[\s\S]*?font-weight:500;/);
  assert.match(fs.readFileSync(new URL('../globals.css', import.meta.url), 'utf8'), /\.contacts-next-step-cell \{[\s\S]*?justify-content:flex-start;[\s\S]*?text-align:left;/);
  assert.match(tableSource, /visibleColumns\.every\(\(column\) => defaultLayoutKeys\.has\(column\.key\)\)/);
});

test('closed rows do not repeat the enrollment reason in Next Step', () => {
  assert.match(contactsSource, /nextStep\.label === 'No active work' && nextStep\.detail === row\.enrollmentStage/);
});

test('Next Step stays informational and suppresses redundant actionable detail', () => {
  assert.doesNotMatch(contactsSource, /contacts-next-step-action/);
  assert.match(contactsSource, /nextStep\.label === 'Needs first outreach' && nextStep\.detail === 'No outreach recorded'/);
  assert.match(contactsSource, /nextStep\.label === 'Ready for retargeting' && nextStep\.detail === 'Outreach may be recorded now'/);
  assert.match(contactsSource, /nextStep\.label === 'No follow-up recorded' && nextStep\.detail === 'Record the next outreach'/);
});
