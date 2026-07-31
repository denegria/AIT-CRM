import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  AITUSA_CRM_EVENT_SCHEMA_VERSION,
  AITUSA_CRM_EVENT_TYPES,
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
    consent: { advisorContactEmail: true, policyVersion: 'fixture-v1' },
    placement: { resultStatus: 'provisional', recommendedLevelKey: 'book-2', answeredQuestionCount: 9, skippedQuestionCount: 1, advisorConfirmationRequired: true, scoringContractVersion: 'v1' },
    ...overrides,
  };
}

test('accepts only the fixed AIT USA CRM event whitelist', () => {
  const result = validateAitUsaCrmEvent(event());
  assert.equal(result.ok, true);
  const lead = aitUsaEventToWebsiteLeadBody(result.event);
  assert.equal(lead.externalId, 'aitusa:advisor-handoff:fixture-001');
  assert.equal(lead.communicationConsent.email, false);
  assert.equal(lead.email, 'ana@example.com');
  assert.equal(Object.hasOwn(lead, 'rawAnswers'), false);
});

test('rejects wrong-type, oversized, and forbidden nested values before persistence', () => {
  assert.equal(validateAitUsaCrmEvent({ ...event(), contact: { email: ['student@example.com'] } }).ok, false);
  assert.equal(validateAitUsaCrmEvent({ ...event(), placement: { recommendedLevelLabel: 'x'.repeat(121) } }).error, 'event_placement_recommendedLevelLabel_invalid');
  assert.equal(validateAitUsaCrmEvent({ ...event(), practice: { transcript: 'never persist this' } }).ok, false);
  assert.equal(validateAitUsaCrmEvent({ ...event(), utm: { campaign: 42 } }).error, 'event_utm_invalid');
});

test('allows the complete server event taxonomy without generic browser fields', () => {
  for (const eventType of AITUSA_CRM_EVENT_TYPES) {
    const result = validateAitUsaCrmEvent({ ...event(), eventType, eventId: `aitusa:${eventType}:fixture-001`, idempotencyKey: `aitusa:${eventType}:fixture-001` });
    assert.equal(result.ok, true, eventType);
  }
});

test('rejects forbidden fields before legacy lead normalization or audit persistence', () => {
  for (const field of ['selectedAnswers', 'writingSample', 'transcript', 'providerTrace', 'crmContactId']) {
    const result = validateAitUsaCrmEvent({ ...event(), [field]: 'forbidden' });
    assert.equal(result.ok, false, field);
  }
  const nested = validateAitUsaCrmEvent(event({ practice: { state: 'completed', transcript: 'forbidden' } }));
  assert.equal(nested.ok, false);
});

test('keeps legacy source-labelled website leads on the legacy path', async () => {
  const route = await readFile(new URL('../../app/api/webhooks/website-leads/route.js', import.meta.url), 'utf8');
  assert.match(route, /const isAitUsaEvent = body\?\.schemaVersion === AITUSA_CRM_EVENT_SCHEMA_VERSION/);
  assert.doesNotMatch(route, /source === 'AIT USA Refresh' \|\|/);
});
