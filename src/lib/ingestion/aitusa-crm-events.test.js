import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AITUSA_CRM_EVENT_SCHEMA_VERSION,
  aitUsaEventToWebsiteLeadBody,
  validateAitUsaCrmEvent,
} from './aitusa-crm-events.js';

function event(overrides = {}) {
  return {
    schemaVersion: AITUSA_CRM_EVENT_SCHEMA_VERSION,
    eventId: 'evt:advisor-handoff:fixture-001',
    eventType: 'advisor_handoff_requested',
    idempotencyKey: 'aitusa:advisor-handoff:fixture-001',
    correlationId: 'claim:fixture-001',
    occurredAt: '2026-07-31T12:00:00.000Z',
    source: { product: 'aitusa_refresh', surface: 'portal', path: '/portal', version: 'mis-343-v1' },
    contact: { firstName: 'Ana', email: 'ana@example.com' },
    consent: { advisorContactEmail: true, email: true, policyVersion: 'fixture-v1' },
    placement: { resultStatus: 'provisional', recommendedLevelKey: 'book-2', answeredQuestionCount: 9, skippedQuestionCount: 1, advisorConfirmationRequired: true, scoringContractVersion: 'v1' },
    ...overrides,
  };
}

test('accepts only the fixed AIT USA CRM event whitelist', () => {
  const result = validateAitUsaCrmEvent(event());
  assert.equal(result.ok, true);
  const lead = aitUsaEventToWebsiteLeadBody(result.event);
  assert.equal(lead.externalId, 'aitusa:advisor-handoff:fixture-001');
  assert.equal(lead.email, 'ana@example.com');
  assert.equal(Object.hasOwn(lead, 'rawAnswers'), false);
});

test('rejects forbidden fields before legacy lead normalization or audit persistence', () => {
  for (const field of ['selectedAnswers', 'writingSample', 'transcript', 'providerTrace', 'crmContactId']) {
    const result = validateAitUsaCrmEvent({ ...event(), [field]: 'forbidden' });
    assert.equal(result.ok, false, field);
  }
  const nested = validateAitUsaCrmEvent(event({ practice: { state: 'completed', transcript: 'forbidden' } }));
  assert.equal(nested.ok, false);
});
