import assert from 'node:assert/strict';
import test from 'node:test';
import {
  latestExcelDateFromText,
  summarizeContactTouch,
} from './contact-touch.js';

test('latestExcelDateFromText extracts workbook business dates instead of import time', () => {
  assert.equal(
    new Date(latestExcelDateFromText('1509 | SI | NO | 45315.0 | AIT USA | FRANK')).toISOString().slice(0, 10),
    '2024-01-24',
  );
  assert.equal(latestExcelDateFromText('plain note without workbook dates'), 0);
});

test('summarizeContactTouch keeps AIT USA last touch to follow-up/contact events', () => {
  const summary = summarizeContactTouch({
    contact: {
      updatedAt: new Date('2026-06-02T15:00:00.000Z'),
      createdAt: new Date('2026-06-01T15:00:00.000Z'),
    },
    businessUnit: { name: 'AIT USA Institute' },
    notes: [{
      body: 'Internal note after profile edit.',
      createdAt: new Date('2026-06-02T16:00:00.000Z'),
    }],
    activityEvents: [{
      eventType: 'website_lead_captured',
      message: 'Website lead submitted.',
      occurredAt: new Date('2026-06-02T14:00:00.000Z'),
    }, {
      eventType: 'ait_usa.follow_up',
      message: 'Called student and left a voicemail.',
      occurredAt: new Date('2026-05-20T14:00:00.000Z'),
    }],
  });

  assert.equal(summary.lastTouch, '2026-05-20');
  assert.equal(summary.lastTouchLabel, 'Follow-up');
  assert.equal(summary.lastEdited, '2026-06-02');
  assert.equal(summary.latestComment, 'Internal note after profile edit.');
});

test('summarizeContactTouch uses AIT Signs job history dates and exposes edit separately', () => {
  const summary = summarizeContactTouch({
    contact: {
      updatedAt: new Date('2026-06-02T15:00:00.000Z'),
      createdAt: new Date('2026-06-01T15:00:00.000Z'),
    },
    businessUnit: { name: 'AIT Signs' },
    activityEvents: [{
      eventType: 'import_promoted_work_order',
      message: '1450 | SI | NO | 45215.0 | EL PALACIO | 30 STICKERS 1.5 X 1.5 | ENTREGADO',
      occurredAt: new Date('2026-05-30T13:05:44.087Z'),
      createdAt: new Date('2026-05-30T13:05:44.087Z'),
    }],
  });

  assert.equal(summary.lastTouch, '2023-10-16');
  assert.equal(summary.lastEdited, '2026-06-02');
  assert.match(summary.latestComment, /EL PALACIO/);
});
