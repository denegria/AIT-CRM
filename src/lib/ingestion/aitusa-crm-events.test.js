import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  AITUSA_CRM_EVENT_SCHEMA_VERSION,
  AITUSA_CRM_EVENT_TYPES,
  aitUsaEventToWebsiteLeadBody,
  validateAitUsaCrmEvent,
} from './aitusa-crm-events.js';
import { ingestAitUsaCrmEvent } from './aitusa-crm-event-ingestion.js';

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
  assert.equal(lead.communicationConsent.contact, false);
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
    const isLeadEvent = eventType === 'contact_form_submitted' || eventType === 'callback_requested';
    const result = validateAitUsaCrmEvent({
      ...event(),
      eventType,
      eventId: `aitusa:${eventType}:fixture-001`,
      idempotencyKey: `aitusa:${eventType}:fixture-001`,
      ...(isLeadEvent ? {
        consent: { advisorContact: true, sms: false, policyVersion: 'fixture-v1' },
        lead: { formType: eventType === 'callback_requested' ? 'callback_request' : 'contact_form', interest: 'ingles-presencial' },
      } : {}),
    });
    assert.equal(result.ok, true, eventType);
  }
});

test('normalizes full contact and callback events into distinct website lead intake', () => {
  const contactEvent = event({
    eventType: 'contact_form_submitted',
    eventId: 'aitusa:contact-form:fixture-001',
    idempotencyKey: 'aitusa:contact-form:fixture-001',
    source: { product: 'aitusa_refresh', surface: 'public_site', path: '/contactanos', version: 'mis-221-v2' },
    contact: { firstName: 'Ana', email: 'ana@example.com', phone: '+17325550123' },
    consent: { advisorContact: true, sms: true, policyVersion: 'privacy-v2', smsDisclosureVersion: 'sms-v1', consentedAt: '2026-08-03T19:00:00.000Z' },
    lead: { formType: 'contact_form', interest: 'ingles-presencial', preferredMode: 'Presencial', preferredSchedule: 'Noche', location: 'Bound Brook', ageGroup: 'Adulto', message: 'Quiero saber horarios.' },
  });
  const callbackEvent = {
    ...contactEvent,
    eventType: 'callback_requested',
    eventId: 'aitusa:callback:fixture-001',
    idempotencyKey: 'aitusa:callback:fixture-001',
    consent: { advisorContact: true, policyVersion: 'privacy-v2' },
    lead: { ...contactEvent.lead, formType: 'callback_request', message: 'Solicitud de llamada.' },
  };

  const contact = validateAitUsaCrmEvent(contactEvent);
  const callback = validateAitUsaCrmEvent(callbackEvent);
  assert.equal(contact.ok, true);
  assert.equal(callback.ok, true);

  const contactLead = aitUsaEventToWebsiteLeadBody(contact.event);
  const callbackLead = aitUsaEventToWebsiteLeadBody(callback.event);
  assert.equal(contactLead.submissionType, 'website_lead');
  assert.equal(contactLead.formName, 'AIT USA Contact Form');
  assert.equal(contactLead.communicationConsent.contact, true);
  assert.equal(contactLead.communicationConsent.sms, true);
  assert.equal(contactLead.preferredSchedule, 'Noche');
  assert.equal(contactLead.age, 'Adulto');
  assert.equal(callbackLead.submissionType, 'contact_cta');
  assert.equal(callbackLead.formName, 'AIT USA Request a Call');
  assert.equal(Object.hasOwn(callbackLead.communicationConsent, 'sms'), false);
  assert.equal(callbackLead.communicationPreference, 'phone');
});

test('requires explicit advisor-contact permission for lead events', () => {
  const result = validateAitUsaCrmEvent(event({
    eventType: 'callback_requested',
    eventId: 'aitusa:callback:fixture-002',
    idempotencyKey: 'aitusa:callback:fixture-002',
    consent: { advisorContact: false, policyVersion: 'privacy-v2' },
    lead: { formType: 'callback_request', interest: 'ingles-presencial' },
  }));
  assert.equal(result.ok, false);
  assert.equal(result.error, 'event_lead_advisor_contact_required');
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
  assert.match(route, /isAitUsaEvent \? AITUSA_SECRET_ENV : SECRET_ENV/);
  assert.match(route, /AITUSA_CRM_WEBHOOK_SECRET/);
  assert.doesNotMatch(route, /source === 'AIT USA Refresh' \|\|/);
});

function createEventClient({ leadRows = [] } = {}) {
  const calls = [];
  let leadRead = 0;
  return {
    calls,
    async query(statement, values = []) {
      const sql = String(statement);
      calls.push({ sql, values });
      if (sql.includes('from activity_events')) return { rows: [] };
      if (sql.includes('from contacts')) return { rows: [{ id: 'contact-1' }] };
      if (sql.includes('update contacts')) return { rows: [] };
      if (sql.includes('from leads')) return { rows: [leadRows[leadRead++]].filter(Boolean) };
      if (sql.includes('insert into leads')) return { rows: [{ id: 'lead-created-1' }] };
      return { rows: [] };
    },
  };
}

test('non-follow-up events attach an existing lead but never create one', async () => {
  const client = createEventClient({ leadRows: [] });
  const result = await ingestAitUsaCrmEvent(client, {
    organizationId: 'org-1', businessUnitId: 'unit-1', event: event({ eventType: 'ai_practice_completed' }),
  });
  assert.equal(result.leadId, null);
  assert.equal(client.calls.some((call) => call.sql.includes('insert into leads')), false);
  assert.equal(client.calls.some((call) => call.sql.includes('insert into notifications')), false);
  assert.equal(client.calls.some((call) => call.sql.includes('insert into tasks')), false);
});

test('serializes concurrent first-contact upserts by normalized contact identity', async () => {
  const client = createEventClient();
  await ingestAitUsaCrmEvent(client, {
    organizationId: 'org-1',
    businessUnitId: 'unit-1',
    event: event({ contact: { firstName: 'Ana', email: ' Ana@Example.COM ' } }),
  });
  const contactLocks = client.calls.filter(
    (call) => call.sql.includes('pg_advisory_xact_lock') &&
      String(call.values[0] || '').startsWith('aitusa-crm-contact:'),
  );
  assert.deepEqual(contactLocks.map((call) => call.values), [
    ['aitusa-crm-contact:org-1:email:ana@example.com'],
  ]);
});

test('placement completion and advisor handoff share one correlation-scoped follow-up key', async () => {
  const client = createEventClient({ leadRows: [null, { id: 'lead-created-1' }] });
  const first = event({ eventType: 'placement_completed', idempotencyKey: 'aitusa:placement-completed:fixture-001' });
  const second = event({ eventType: 'advisor_handoff_requested', idempotencyKey: 'aitusa:advisor-handoff:fixture-001' });
  await ingestAitUsaCrmEvent(client, { organizationId: 'org-1', businessUnitId: 'unit-1', event: first });
  await ingestAitUsaCrmEvent(client, { organizationId: 'org-1', businessUnitId: 'unit-1', event: second });
  assert.equal(client.calls.filter((call) => call.sql.includes('insert into leads')).length, 1);
  const followUpKeys = client.calls
    .filter((call) => call.sql.includes('insert into notifications') || call.sql.includes('insert into tasks'))
    .map((call) => call.values.at(-1) || call.values.at(-2))
    .filter((value) => typeof value === 'string' && value.includes(':follow-up'));
  assert.equal(new Set(followUpKeys).size, 1);
  assert.equal(followUpKeys[0], 'aitusa:claim:fixture-001:follow-up');
});
