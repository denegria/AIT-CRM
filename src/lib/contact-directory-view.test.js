import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clientDirectoryColumnMode,
  contactabilityText,
  enrollmentSourceText,
  enrollmentStageText,
  isCurrentLeadDateScope,
  lifecycleBucket,
  leadDateForDirectoryScope,
  programText,
} from './contact-directory-view.js';

test('client directory column mode follows workflow only in clients mode', () => {
  assert.equal(clientDirectoryColumnMode({ isClientsMode: false, workflowKey: 'ait_usa' }), 'contacts');
  assert.equal(clientDirectoryColumnMode({ isClientsMode: false, workflowKey: 'ait_usa', isSingleDivisionScope: true }), 'ait_usa');
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

test('AIT Signs lifecycle buckets distinguish source history from current work', () => {
  assert.deepEqual(
    lifecycleBucket({
      workflowKey: 'ait_signs',
      isPipelineEligible: false,
      lastTouch: '2023-04-01',
    }),
    {
      label: 'Source history',
      tone: 'muted',
      detail: 'Hidden from active pipeline',
    },
  );
  assert.deepEqual(
    lifecycleBucket({
      workflowKey: 'ait_signs',
      isPipelineEligible: true,
      lastTouch: '2025-10-16',
    }),
    {
      label: 'Current work',
      tone: 'active',
      detail: '2025-10-16',
    },
  );
  assert.deepEqual(
    lifecycleBucket({
      workflowKey: 'ait_signs',
      isPipelineEligible: true,
      hasRecentFollowUpTouch: true,
      lastFollowUpTouch: '2026-03-28',
      lastTouch: '2024-03-12',
    }),
    {
      label: '2026 follow-up',
      tone: 'success',
      detail: '2026-03-28',
    },
  );
});

test('lead date scope uses lead dates and keeps current plus previous year', () => {
  const now = new Date('2026-06-13T00:00:00.000Z');

  assert.equal(leadDateForDirectoryScope({
    submittedAt: '2024-04-01T12:00:00.000Z',
    leadCreatedAt: '2026-05-01T12:00:00.000Z',
    contactCreatedAt: '2024-01-01T12:00:00.000Z',
  }), '2024-04-01T12:00:00.000Z');
  assert.equal(isCurrentLeadDateScope({ leadCreatedAt: '2026-01-01T00:00:00.000Z' }, now), true);
  assert.equal(isCurrentLeadDateScope({ leadCreatedAt: '2025-12-31T23:00:00.000Z' }, now), true);
  assert.equal(isCurrentLeadDateScope({ leadCreatedAt: '2024-12-31T23:00:00.000Z' }, now), false);
  assert.equal(isCurrentLeadDateScope({ submittedAt: '2024-12-31T23:00:00.000Z', leadCreatedAt: '2026-01-01T00:00:00.000Z' }, now), false);
  assert.equal(isCurrentLeadDateScope({ leadCreatedAt: '' }, now), true);
});
