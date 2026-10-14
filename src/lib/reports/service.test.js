import test from 'node:test';
import assert from 'node:assert/strict';
import { enrollmentStatusEvidence, successfulContactEvent } from './metrics.js';
import { buildReportEvidence, parseReportDates } from './metrics.js';

const asOf = new Date('2026-10-14T00:00:00.000Z');

test('reports count only affirmative follow-up outcomes as successful contact', () => {
  assert.equal(successfulContactEvent({ eventType: 'follow_up.reached_interested', occurredAt: '2026-10-01T10:00:00Z' }, asOf), true);
  assert.equal(successfulContactEvent({ eventType: 'follow_up.reached_not_interested', occurredAt: '2026-10-01T10:00:00Z' }, asOf), true);
  assert.equal(successfulContactEvent({ eventType: 'follow_up.no_answer', occurredAt: '2026-10-01T10:00:00Z' }, asOf), false);
  assert.equal(successfulContactEvent({ eventType: 'ait_usa.follow_up', metadataJson: { outcome: 'reached_interested' }, occurredAt: '2026-10-01T10:00:00Z' }, asOf), true);
  assert.equal(successfulContactEvent({ eventType: 'ait_usa.follow_up', metadataJson: { outcome: 'no_answer' }, occurredAt: '2026-10-01T10:00:00Z' }, asOf), false);
  assert.equal(successfulContactEvent({ eventType: 'message.sent', occurredAt: '2026-10-01T10:00:00Z' }, asOf), false);
  assert.equal(successfulContactEvent({ eventType: 'follow_up.reached_interested', occurredAt: '2026-11-01T10:00:00Z' }, asOf), false);
});

test('reports preserve historic enrollment evidence through the report as-of time', () => {
  assert.equal(enrollmentStatusEvidence({ toStatus: 'Enrolled', occurredAt: '2026-04-01T10:00:00Z' }, asOf), true);
  assert.equal(enrollmentStatusEvidence({ toStatus: 'Dropped / Quit', occurredAt: '2026-04-01T10:00:00Z' }, asOf), false);
  assert.equal(enrollmentStatusEvidence({ toStatus: 'Enrolled', occurredAt: '2026-11-01T10:00:00Z' }, asOf), false);
});

function evidenceFixture(overrides = {}) {
  const lead = { id: 'lead-a', contactId: 'contact-1', businessUnitId: 'usa' };
  return buildReportEvidence({
    lead,
    allLeads: [lead],
    eventsByLead: new Map(),
    eventsByContact: new Map(),
    historyByLead: new Map(),
    coursesByLead: new Map(),
    coursesByContact: new Map(),
    asOf,
    unit: { id: 'usa', name: 'AIT USA' },
    ...overrides,
  });
}

test('report evidence never crosses same-contact lead opportunities and allows only unambiguous legacy fallback', () => {
  const leadA = { id: 'lead-a', contactId: 'contact-1', businessUnitId: 'usa' };
  const leadB = { id: 'lead-b', contactId: 'contact-1', businessUnitId: 'usa' };
  const result = evidenceFixture({
    lead: leadB,
    allLeads: [leadA, leadB],
    eventsByContact: new Map([['contact-1', [{ contactId: 'contact-1', eventType: 'follow_up.reached_interested', occurredAt: '2026-10-01T10:00:00Z', businessUnitId: 'usa' }]]]),
  });
  assert.equal(result.contacted, false);
  assert.equal(result.legacyFallbackUsed, false);
});

test('report evidence accepts exact lead and same-BU evidence but excludes cross-BU and no-answer records', () => {
  const result = evidenceFixture({
    eventsByLead: new Map([['lead-a', [
      { leadId: 'lead-a', eventType: 'follow_up.no_answer', occurredAt: '2026-10-01T10:00:00Z', businessUnitId: 'usa' },
      { leadId: 'lead-a', eventType: 'follow_up.reached_interested', occurredAt: '2026-10-01T10:00:00Z', businessUnitId: 'signs' },
    ]]]),
  });
  assert.equal(result.contacted, false);
});

test('report evidence preserves historical enrollment and current AIT USA enrollment snapshots', () => {
  const result = evidenceFixture({
    historyByLead: new Map([['lead-a', [{ leadId: 'lead-a', businessUnitId: 'usa', toStatus: 'Enrolled', occurredAt: '2026-04-01T10:00:00Z' }]]]),
    coursesByLead: new Map([['lead-a', [{ leadId: 'lead-a', contactId: 'contact-1', businessUnitId: 'usa', status: 'dropped', createdAt: '2026-04-01T10:00:00Z' }]]]),
  });
  assert.equal(result.enrolled, true);
});

test('report date validation rejects malformed, rolled, reversed, and future values', () => {
  const params = (values) => new URLSearchParams(values);
  assert.throws(() => parseReportDates(params({ from: '2026-02-30' }), new Date('2026-10-14T00:00:00Z')), /valid calendar date/);
  assert.throws(() => parseReportDates(params({ from: '2026-10-15', to: '2026-10-14' }), new Date('2026-10-14T00:00:00Z')), /on or before/);
  assert.throws(() => parseReportDates(params({ asOf: '2026-10-15' }), new Date('2026-10-14T00:00:00Z')), /future/);
});
