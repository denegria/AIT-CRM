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
  assert.match(contactsSource, /'name',\s*'enrollmentStage',\s*'assignedLabel',\s*'directoryNextStep',\s*'lastTouch',\s*'inquirySource'/s);
});

test('AIT USA rows own navigation and remove redundant View and Edit actions', () => {
  assert.match(contactsSource, /onRowClick=\{columnMode === 'ait_usa' \? openContact : undefined\}/);
  assert.match(contactsSource, /actions=\{columnMode === 'ait_usa' \? undefined : \[/);
  assert.match(tableSource, /\['Enter', ' '\]\.includes\(event\.key\)/);
  assert.match(tableSource, /event\.target\.closest\('a, button, input, select, textarea, summary, label'\)/);
  assert.match(tableStyles, /\.clickableRow:focus-visible/);
});

test('mobile keeps only the high-value contact fields and conditional outreach action', () => {
  assert.match(contactsSource, /\? \['assignedLabel', 'directoryNextStep', 'lastTouch'\]/);
  assert.match(contactsSource, /nextStep\.action === 'log_follow_up'/);
  assert.match(contactsSource, /\{nextStep\.actionLabel\}/);
});
