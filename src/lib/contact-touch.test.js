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

test('latestExcelDateFromText ignores decimal money fragments and future serials', () => {
  const text = '144 | 45931.0 | BLUE MOUNTAIN | $ | 265 | 17.55625 | 282.55625 | 282.56 | 545.0 | 45946.0 | -0.00375';
  assert.equal(
    new Date(latestExcelDateFromText(text, { referenceTime: new Date('2026-06-02T12:00:00.000Z').getTime() })).toISOString().slice(0, 10),
    '2025-10-16',
  );
  assert.equal(
    latestExcelDateFromText('future date-looking artifact | 55625.0 | BLUE MOUNTAIN', {
      referenceTime: new Date('2026-06-02T12:00:00.000Z').getTime(),
    }),
    0,
  );
});

test('summarizeContactTouch keeps AIT USA last touch to follow-up/contact events', () => {
  const summary = summarizeContactTouch({
    contact: {
      updatedAt: new Date('2026-06-02T15:00:00.000Z'),
      createdAt: new Date('2026-06-01T15:00:00.000Z'),
    },
    businessUnit: { name: 'AIT USA Institute' },
    referenceTime: new Date('2026-06-02T20:00:00.000Z').getTime(),
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
    referenceTime: new Date('2026-06-02T20:00:00.000Z').getTime(),
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
  assert.equal(summary.lastFollowUpTouch, '');
});

test('summarizeContactTouch ignores MIS-97 cleanup notes as customer comments', () => {
  const summary = summarizeContactTouch({
    contact: {
      updatedAt: new Date('2026-06-05T00:00:00.000Z'),
      createdAt: new Date('2026-06-01T15:00:00.000Z'),
    },
    businessUnit: { name: 'AIT Signs' },
    referenceTime: new Date('2026-06-05T00:00:00.000Z').getTime(),
    notes: [{
      body: 'MIS-97 staging duplicate cleanup (mis97_blue_contacts_confirmed_staging_apply).\nCanonical contact retained as: BLUE MOUNTAIN.\nMerged contact rows and preserved source contact details:\n- name=MARK BLUE MOUNTAIN | phone=908 642 3020',
      createdAt: new Date('2026-06-04T23:55:46.644Z'),
    }],
    activityEvents: [{
      eventType: 'import_promoted_work_order',
      message: '1527 | SI | NO | 45315.0 | BLUE MOUNTAIN | FELIX | (20) YARD SIGN 24 X 18 | ENTREGADO',
      createdAt: new Date('2026-05-30T13:05:44.087Z'),
    }],
  });

  assert.match(summary.latestComment, /BLUE MOUNTAIN/);
  assert.doesNotMatch(summary.latestComment, /MIS-97 staging duplicate cleanup/);
});

test('summarizeContactTouch ignores MIS cleanup and correction notes as AIT Signs touch evidence', () => {
  const summary = summarizeContactTouch({
    contact: {
      updatedAt: new Date('2026-06-07T00:00:00.000Z'),
      createdAt: new Date('2026-06-01T15:00:00.000Z'),
    },
    businessUnit: { name: 'AIT Signs' },
    referenceTime: new Date('2026-06-07T00:00:00.000Z').getTime(),
    notes: [{
      body: 'MIS-125 staging invalid phone correction from hardened AIT Signs workbook parser. Previous invalid phone tail/length: 20',
      createdAt: new Date('2026-06-05T00:00:00.000Z'),
    }, {
      body: 'MIS-97 staging short-term fuller-name consolidation: ART BY LORELAY',
      createdAt: new Date('2026-06-04T00:00:00.000Z'),
    }],
  });

  assert.equal(summary.latestComment, '');
  assert.equal(summary.lastTouch, '');
  assert.equal(summary.lastFollowUpTouch, '');
  assert.equal(summary.hasRecentFollowUpTouch, false);
});

test('summarizeContactTouch exposes real AIT Signs follow-up evidence separately', () => {
  const summary = summarizeContactTouch({
    contact: {
      updatedAt: new Date('2026-06-07T00:00:00.000Z'),
      createdAt: new Date('2026-06-01T15:00:00.000Z'),
    },
    businessUnit: { name: 'AIT Signs' },
    referenceTime: new Date('2026-06-07T00:00:00.000Z').getTime(),
    notes: [{
      body: 'Follow-up note: called client about updated sign proof.',
      createdAt: new Date('2026-06-03T14:00:00.000Z'),
    }],
  });

  assert.equal(summary.lastTouch, '2026-06-03');
  assert.equal(summary.lastFollowUpTouch, '2026-06-03');
  assert.equal(summary.hasRecentFollowUpTouch, true);
});

test('summarizeContactTouch ignores future AIT Signs date artifacts', () => {
  const summary = summarizeContactTouch({
    contact: {
      updatedAt: new Date('2026-06-02T15:00:00.000Z'),
      createdAt: new Date('2026-06-01T15:00:00.000Z'),
    },
    businessUnit: { name: 'AIT Signs' },
    referenceTime: new Date('2026-06-02T20:00:00.000Z').getTime(),
    activityEvents: [{
      eventType: 'import_promoted_work_order',
      message: '144 | 45931.0 | BLUE MOUNTAIN | 12 YARD SIGNS | 17.55625 | 282.55625 | 45946.0',
      createdAt: new Date('2026-05-30T13:05:44.087Z'),
    }],
  });

  assert.equal(summary.lastTouch, '2025-10-16');
  assert.equal(summary.lastEdited, '2026-06-02');
});

test('summarizeContactTouch does not use import timestamps as AIT Signs business touch dates', () => {
  const summary = summarizeContactTouch({
    contact: {
      updatedAt: new Date('2026-06-02T15:00:00.000Z'),
      createdAt: new Date('2026-06-01T15:00:00.000Z'),
    },
    businessUnit: { name: 'AIT Signs' },
    referenceTime: new Date('2026-06-02T20:00:00.000Z').getTime(),
    activityEvents: [{
      eventType: 'import_promoted_work_order',
      message: '1370 | SI | NO | BLUE MOUNTAIN | 20 YARD SIGN | READY | $ | 482.0 | 31.92 | 513.0',
      createdAt: new Date('2026-05-30T13:05:44.087Z'),
    }, {
      eventType: 'import_promoted_work_order',
      message: '144 | 45931.0 | BLUE MOUNTAIN | 12 YARD SIGNS | 45946.0',
      createdAt: new Date('2026-05-30T13:05:44.087Z'),
    }],
  });

  assert.equal(summary.lastTouch, '2025-10-16');
  assert.equal(summary.latestCommentDate, '2025-10-16');
});
