import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SMS_CONSENT_EVENT_TYPES,
  SMS_CONSENT_SOURCE_TYPES,
  SMS_CONSENT_STATUSES,
  SMS_ELIGIBILITY_BLOCK_CODES,
  classifySmsKeyword,
  evaluateSmsEligibility,
  loadSmsConsentForContact,
  normalizeSmsConsentEvent,
  recordSmsConsentEvent,
  smsConsentScopeKey,
} from './sms-consent.js';

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
}

function createConsentClient({ duplicateEventId = null, consentRows = [] } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      async query(sql, params = []) {
        const normalized = normalizeSql(sql);
        calls.push({ sql: normalized, params });

        if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
          return { rows: [] };
        }
        if (normalized.startsWith('select id from contact_channel_consent_events')) {
          return { rows: duplicateEventId ? [{ id: duplicateEventId }] : [] };
        }
        if (normalized.startsWith('insert into contact_channel_consents')) {
          return { rows: [{ id: 'consent-1', consent_status: params[5] }] };
        }
        if (normalized.startsWith('insert into contact_channel_consent_events')) {
          return { rows: [{ id: 'event-1' }] };
        }
        if (normalized.startsWith('select id, organization_id')) {
          return { rows: consentRows };
        }

        throw new Error('Unexpected query: ' + normalized);
      },
    },
  };
}

test('classifies standard SMS consent keywords', () => {
  assert.deepEqual(classifySmsKeyword(' STOP '), {
    eventType: SMS_CONSENT_EVENT_TYPES.OPT_OUT,
    keyword: 'stop',
  });
  assert.deepEqual(classifySmsKeyword('Unsubscribe'), {
    eventType: SMS_CONSENT_EVENT_TYPES.OPT_OUT,
    keyword: 'unsubscribe',
  });
  assert.deepEqual(classifySmsKeyword('START'), {
    eventType: SMS_CONSENT_EVENT_TYPES.OPT_IN,
    keyword: 'start',
  });
  assert.deepEqual(classifySmsKeyword('HELP'), {
    eventType: SMS_CONSENT_EVENT_TYPES.HELP,
    keyword: 'help',
  });
  assert.deepEqual(classifySmsKeyword('hello'), {
    eventType: null,
    keyword: 'hello',
  });
});

test('normalizes explicit SMS opt-in events with business-unit scope', () => {
  const event = normalizeSmsConsentEvent({
    organizationId: 'org-1',
    contactId: 'contact-1',
    businessUnitId: 'bu-1',
    eventType: SMS_CONSENT_EVENT_TYPES.OPT_IN,
    sourceType: SMS_CONSENT_SOURCE_TYPES.WEBSITE_FORM,
    sourceReference: 'refresh-contact-form',
    disclosureText: 'Reply STOP to opt out.',
    occurredAt: '2026-06-29T12:00:00.000Z',
    metadataJson: { source: 'fixture' },
  });

  assert.equal(event.channel, 'sms');
  assert.equal(event.scopeKey, smsConsentScopeKey({ businessUnitId: 'bu-1' }));
  assert.equal(event.consentStatus, SMS_CONSENT_STATUSES.OPTED_IN);
  assert.equal(event.sourceType, SMS_CONSENT_SOURCE_TYPES.WEBSITE_FORM);
  assert.equal(event.occurredAt.toISOString(), '2026-06-29T12:00:00.000Z');
});

test('rejects unsupported SMS consent events before persistence', () => {
  assert.throws(
    () => normalizeSmsConsentEvent({
      organizationId: 'org-1',
      contactId: 'contact-1',
      eventType: 'maybe',
    }),
    /Unsupported SMS consent event type/,
  );
});

test('records opt-in event, current consent, and audit row in one transaction', async () => {
  const { client, calls } = createConsentClient();
  const result = await recordSmsConsentEvent(client, {
    organizationId: 'org-1',
    contactId: 'contact-1',
    businessUnitId: 'bu-1',
    eventType: SMS_CONSENT_EVENT_TYPES.OPT_IN,
    sourceType: SMS_CONSENT_SOURCE_TYPES.WEBSITE_FORM,
    sourceReference: 'refresh-contact-form',
    disclosureText: 'Reply STOP to opt out.',
    idempotencyKey: 'website-form:submission-1:sms-opt-in',
    occurredAt: '2026-06-29T12:00:00.000Z',
    metadataJson: { consentCopyVersion: '2026-06-29' },
  });

  assert.deepEqual(result, {
    duplicate: false,
    eventId: 'event-1',
    consentId: 'consent-1',
    consentStatus: SMS_CONSENT_STATUSES.OPTED_IN,
    eventType: SMS_CONSENT_EVENT_TYPES.OPT_IN,
  });
  assert.equal(calls[0].sql, 'begin');
  assert.equal(calls.at(-1).sql, 'commit');

  const consentUpsert = calls.find((call) => call.sql.startsWith('insert into contact_channel_consents'));
  assert.equal(consentUpsert.params[3], 'business_unit:bu-1');
  assert.equal(consentUpsert.params[5], SMS_CONSENT_STATUSES.OPTED_IN);
  assert.equal(consentUpsert.params[6], SMS_CONSENT_SOURCE_TYPES.WEBSITE_FORM);
  assert.equal(consentUpsert.params[8], 'Reply STOP to opt out.');

  const auditInsert = calls.find((call) => call.sql.startsWith('insert into contact_channel_consent_events'));
  assert.equal(auditInsert.params[5], SMS_CONSENT_EVENT_TYPES.OPT_IN);
  assert.equal(auditInsert.params[12], 'website-form:submission-1:sms-opt-in');
});

test('deduplicates provider consent events before mutating current consent', async () => {
  const { client, calls } = createConsentClient({ duplicateEventId: 'event-existing' });
  const result = await recordSmsConsentEvent(client, {
    organizationId: 'org-1',
    contactId: 'contact-1',
    text: 'STOP',
    sourceType: SMS_CONSENT_SOURCE_TYPES.PROVIDER_WEBHOOK,
    provider: 'telnyx',
    providerEventId: 'provider-event-1',
    idempotencyKey: 'telnyx:provider-event-1',
  });

  assert.deepEqual(result, {
    duplicate: true,
    eventId: 'event-existing',
    consentId: null,
    consentStatus: SMS_CONSENT_STATUSES.OPTED_OUT,
    eventType: SMS_CONSENT_EVENT_TYPES.OPT_OUT,
  });
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contact_channel_consents')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contact_channel_consent_events')), false);
});

test('loads business-unit scoped SMS consent before organization default', async () => {
  const { client, calls } = createConsentClient({
    consentRows: [{
      id: 'consent-1',
      consent_status: SMS_CONSENT_STATUSES.OPTED_IN,
      scope_key: 'business_unit:bu-1',
    }],
  });
  const consent = await loadSmsConsentForContact(client, {
    organizationId: 'org-1',
    contactId: 'contact-1',
    businessUnitId: 'bu-1',
  });

  assert.equal(consent.id, 'consent-1');
  const select = calls.find((call) => call.sql.startsWith('select id, organization_id'));
  assert.deepEqual(select.params[2], ['business_unit:bu-1', 'organization']);
  assert.equal(select.params[3], 'business_unit:bu-1');
});

test('evaluates SMS campaign eligibility from contact and consent posture', () => {
  assert.equal(evaluateSmsEligibility({
    contact: { phone: '+15551234567' },
    consent: { consent_status: SMS_CONSENT_STATUSES.OPTED_IN },
  }).ok, true);

  const missingConsent = evaluateSmsEligibility({
    contact: { phone: '+15551234567' },
    consent: null,
  });
  assert.equal(missingConsent.ok, false);
  assert.equal(missingConsent.reasons[0].code, SMS_ELIGIBILITY_BLOCK_CODES.SMS_CONSENT_MISSING);

  const optedOut = evaluateSmsEligibility({
    contact: { phone: '+15551234567' },
    consent: { consent_status: SMS_CONSENT_STATUSES.OPTED_OUT },
  });
  assert.equal(optedOut.ok, false);
  assert.equal(optedOut.reasons[0].code, SMS_ELIGIBILITY_BLOCK_CODES.SMS_OPTED_OUT);

  const blocked = evaluateSmsEligibility({
    contact: { phone: '', isDoNotCall: true },
    consent: { consent_status: SMS_CONSENT_STATUSES.OPTED_IN },
  });
  assert.deepEqual(blocked.reasons.map((reason) => reason.code), [
    SMS_ELIGIBILITY_BLOCK_CODES.PHONE_MISSING,
    SMS_ELIGIBILITY_BLOCK_CODES.CONTACT_BLOCKED,
  ]);
});
