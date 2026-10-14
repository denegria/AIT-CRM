import test from 'node:test';
import assert from 'node:assert/strict';
import { enrollmentStatusEvidence, successfulContactEvent } from './metrics.js';
import { buildReportEvidence, canonicalLeadDate, detailRowsForSelection, parseReportDates } from './metrics.js';

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

test('report evidence counts a current AIT USA enrolled snapshot only through its snapshot time', () => {
  const current = evidenceFixture({ lead: { id: 'lead-a', contactId: 'contact-1', businessUnitId: 'usa', currentStage: 'Enrolled', updatedAt: '2026-10-01T10:00:00Z' } });
  assert.equal(current.enrolled, true);
  const beforeSnapshot = evidenceFixture({ lead: { id: 'lead-a', contactId: 'contact-1', businessUnitId: 'usa', currentStage: 'Enrolled', updatedAt: '2026-10-20T10:00:00Z' }, asOf: new Date('2026-10-14T00:00:00Z') });
  assert.equal(beforeSnapshot.enrolled, false);
});

test('report evidence never maps an AIT Signs snapshot to enrollment', () => {
  const result = evidenceFixture({ lead: { id: 'lead-a', contactId: 'contact-1', businessUnitId: 'signs', currentStage: 'Enrolled', updatedAt: '2026-10-01T10:00:00Z' }, allLeads: [{ id: 'lead-a', contactId: 'contact-1', businessUnitId: 'signs' }], unit: { id: 'signs', name: 'AIT Signs' } });
  assert.equal(result.enrolled, false);
  assert.equal(result.enrollmentSupported, false);
});

test('report date validation rejects malformed, rolled, reversed, and future values', () => {
  const params = (values) => new URLSearchParams(values);
  assert.throws(() => parseReportDates(params({ from: '2026-02-30' }), new Date('2026-10-14T00:00:00Z')), /valid calendar date/);
  assert.throws(() => parseReportDates(params({ from: '2026-10-15', to: '2026-10-14' }), new Date('2026-10-14T00:00:00Z')), /on or before/);
  assert.throws(() => parseReportDates(params({ asOf: '2026-10-15' }), new Date('2026-10-14T00:00:00Z')), /future/);
});

test('canonical intake dates isolate ambiguous same-contact legacy captures', () => {
  const leadA = { id: 'lead-a', contactId: 'contact-1', businessUnitId: 'usa', createdAt: '2026-10-10T00:00:00Z' };
  const leadB = { id: 'lead-b', contactId: 'contact-1', businessUnitId: 'usa', createdAt: '2026-10-11T00:00:00Z' };
  const eventsByContact = new Map([['contact-1', [{ contactId: 'contact-1', eventType: 'website_lead_captured', occurredAt: '2026-01-01T00:00:00Z', businessUnitId: null }]]]);
  const shared = { contact: { createdAt: '2026-01-02T00:00:00Z' }, eventsByLead: new Map(), eventsByContact, allLeads: [leadA, leadB], unit: { id: 'usa', name: 'AIT USA' } };
  assert.equal(canonicalLeadDate({ ...shared, lead: leadA }).toISOString(), '2026-10-10T00:00:00.000Z');
  assert.equal(canonicalLeadDate({ ...shared, lead: leadB }).toISOString(), '2026-10-11T00:00:00.000Z');
});

test('canonical intake dates retain linked captures and allow a single-lead legacy fallback', () => {
  const lead = { id: 'lead-a', contactId: 'contact-1', businessUnitId: 'usa', createdAt: '2026-10-10T00:00:00Z' };
  const linked = { leadId: 'lead-a', eventType: 'facebook_lead_captured', occurredAt: '2026-09-01T00:00:00Z', businessUnitId: 'usa' };
  const legacy = { contactId: 'contact-1', eventType: 'website_lead_captured', occurredAt: '2026-08-01T00:00:00Z', businessUnitId: null };
  const args = { lead, contact: { createdAt: '2026-01-01T00:00:00Z' }, eventsByLead: new Map([['lead-a', [linked]]]), eventsByContact: new Map([['contact-1', [legacy]]]), allLeads: [lead], unit: { id: 'usa', name: 'AIT USA' } };
  assert.equal(canonicalLeadDate(args).toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(canonicalLeadDate({ ...args, eventsByLead: new Map() }).toISOString(), '2026-08-01T00:00:00.000Z');
});

test('report detail selections return only the selected context', () => {
  const rows = [
    { id: 'a', source: 'Website form', coordinatorId: 'u1', status: 'New', businessUnit: 'AIT USA', contacted: true, enrolled: false, leadDate: '2026-01-02T00:00:00Z' },
    { id: 'b', source: 'Workbook import', coordinatorId: '', status: 'Enrolled', businessUnit: 'AIT USA', contacted: false, enrolled: true, leadDate: '2026-02-02T00:00:00Z' },
  ];
  assert.deepEqual(detailRowsForSelection(rows, { detailType: 'source', detailKey: 'Website form' }).map((row) => row.id), ['a']);
  assert.deepEqual(detailRowsForSelection(rows, { detailType: 'coordinator', detailKey: '__unassigned__' }).map((row) => row.id), ['b']);
  assert.deepEqual(detailRowsForSelection(rows, { detailType: 'metric', detailKey: 'enrolled' }).map((row) => row.id), ['b']);
  assert.deepEqual(detailRowsForSelection(rows, { detailType: 'trend', detailKey: '2026-02-01', detailUnit: 'month' }).map((row) => row.id), ['b']);
});
