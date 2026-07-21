import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTACT_DIRECTORY_MODES,
  contactDirectoryModeForRequest,
  contactDirectorySortKeys,
  contactDirectorySortStateFromParams,
  nextContactDirectorySort,
  normalizeContactDirectorySort,
} from './directory-sort.js';

test('directory mode follows the route kind and active workflow', () => {
  assert.equal(contactDirectoryModeForRequest({ directoryKind: 'contacts', workflowKey: 'ait_usa', hasSingleDivisionScope: true }), CONTACT_DIRECTORY_MODES.AIT_USA);
  assert.equal(contactDirectoryModeForRequest({ directoryKind: 'contacts', workflowKey: 'ait_signs', hasSingleDivisionScope: true }), CONTACT_DIRECTORY_MODES.CONTACTS);
  assert.equal(contactDirectoryModeForRequest({ directoryKind: 'clients', workflowKey: 'ait_signs', hasSingleDivisionScope: true }), CONTACT_DIRECTORY_MODES.AIT_SIGNS);
  assert.equal(contactDirectoryModeForRequest({ directoryKind: 'clients', workflowKey: 'ait_usa', hasSingleDivisionScope: true }), CONTACT_DIRECTORY_MODES.AIT_USA);
});

test('mode-specific allowlists cover every visible sortable directory column', () => {
  assert.deepEqual(contactDirectorySortKeys(CONTACT_DIRECTORY_MODES.CONTACTS), [
    'name', 'email', 'phone', 'status', 'assignedLabel', 'divisionLabel', 'source', 'lastTouch', 'lastEdited',
  ]);
  assert.deepEqual(contactDirectorySortKeys(CONTACT_DIRECTORY_MODES.AIT_SIGNS), [
    'name', 'phone', 'sourceCategoryText', 'linkedPeopleSummary', 'status', 'assignedLabel', 'lastTouch', 'lastEdited',
  ]);
  assert.deepEqual(contactDirectorySortKeys(CONTACT_DIRECTORY_MODES.AIT_USA), [
    'name', 'email', 'phone', 'enrollmentStage', 'studentLocation', 'schoolLocation', 'inquirySource', 'assignedLabel', 'lastTouch', 'lastEdited',
  ]);
});

test('sort parsing rejects unsupported keys and normalizes direction', () => {
  assert.deepEqual(
    normalizeContactDirectorySort({ key: 'lastTouch', direction: 'desc', mode: CONTACT_DIRECTORY_MODES.AIT_USA }),
    { key: 'lastTouch', direction: 'desc' },
  );
  assert.deepEqual(
    normalizeContactDirectorySort({ key: 'divisionLabel', direction: 'sideways', mode: CONTACT_DIRECTORY_MODES.AIT_USA }),
    { key: '', direction: 'desc' },
  );
  assert.deepEqual(
    contactDirectorySortStateFromParams(new URLSearchParams('sort=name&direction=invalid'), { mode: CONTACT_DIRECTORY_MODES.CONTACTS }),
    { key: 'name', direction: 'asc' },
  );
});

test('column clicks start ascending and toggle the active key', () => {
  assert.deepEqual(nextContactDirectorySort({ key: 'name' }), { key: 'name', direction: 'asc' });
  assert.deepEqual(
    nextContactDirectorySort({ currentKey: 'name', currentDirection: 'asc', key: 'name' }),
    { key: 'name', direction: 'desc' },
  );
  assert.deepEqual(
    nextContactDirectorySort({ currentKey: 'name', currentDirection: 'desc', key: 'lastTouch' }),
    { key: 'lastTouch', direction: 'asc' },
  );
});
