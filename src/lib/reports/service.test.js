import test from 'node:test';
import assert from 'node:assert/strict';
import { enrollmentStatusEvidence, successfulContactEvent } from './metrics.js';

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
