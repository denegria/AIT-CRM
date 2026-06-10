import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clientDirectoryColumnMode,
  contactabilityText,
  enrollmentSourceText,
  enrollmentStageText,
  programText,
} from './contact-directory-view.js';

test('client directory column mode follows workflow only in clients mode', () => {
  assert.equal(clientDirectoryColumnMode({ isClientsMode: false, workflowKey: 'ait_usa' }), 'contacts');
  assert.equal(clientDirectoryColumnMode({ isClientsMode: true, workflowKey: 'ait_usa' }), 'ait_usa');
  assert.equal(clientDirectoryColumnMode({ isClientsMode: true, workflowKey: 'ait_signs' }), 'ait_signs');
  assert.equal(clientDirectoryColumnMode({ isClientsMode: true, workflowKey: 'default' }), 'ait_signs');
});

test('AIT USA row labels prefer enrollment-specific signals', () => {
  const row = {
    currentStage: 'Follow Up',
    status: 'New Lead',
    programInterest: 'ESL',
    inquirySource: '',
    source: 'Wix Historical Import',
    processPills: ['missing_phone', 'ready_for_follow_up'],
    enrollmentSignals: {
      source: { channel: 'Wix Website Form' },
      inquiry: { programInterest: 'Citizenship' },
      contactability: { status: 'reachable' },
    },
  };

  assert.equal(enrollmentStageText(row), 'Follow Up');
  assert.equal(programText(row), 'ESL');
  assert.equal(contactabilityText(row), 'Missing Phone');
  assert.equal(enrollmentSourceText(row), 'Wix Website Form');
});

test('AIT USA row labels fall back to readable defaults', () => {
  assert.equal(enrollmentStageText({}), 'Unstaged');
  assert.equal(programText({}), 'Program not set');
  assert.equal(contactabilityText({}), 'Reachable');
  assert.equal(enrollmentSourceText({}), 'Source not set');
});

