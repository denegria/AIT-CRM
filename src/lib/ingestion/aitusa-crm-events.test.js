import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  AITUSA_CRM_EVENT_SCHEMA_VERSION,
  AITUSA_CRM_EVENT_TYPES,
  AITUSA_PLACEMENT_REVIEW_EVENT_TYPES,
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
    const isPlacementReview = AITUSA_PLACEMENT_REVIEW_EVENT_TYPES.includes(eventType);
    const reviewStatus = isPlacementReview ? eventType.replace('placement_review_', '') : null;
    const result = validateAitUsaCrmEvent({
      ...event(),
      eventType,
      eventId: `aitusa:${eventType}:fixture-001`,
      idempotencyKey: `aitusa:${eventType}:fixture-001`,
      ...(isLeadEvent ? {
        consent: { advisorContact: true, sms: false, policyVersion: 'fixture-v1' },
        lead: { formType: eventType === 'callback_requested' ? 'callback_request' : 'contact_form', interest: 'ingles-presencial' },
      } : {}),
      ...(isPlacementReview ? {
        placement: {
          reviewId: 'placement-review-opaque-001',
          resultId: 'placement-result-opaque-001',
          reviewStatus,
          ...(reviewStatus === 'confirmed' || reviewStatus === 'adjusted' ? { finalLevelKey: 'book-2' } : {}),
          verifiedEmail: true,
          communicationPreference: 'email',
        },
      } : {}),
    });
    assert.equal(result.ok, true, eventType);
  }
});

test('accepts only privacy-safe placement-review contract fields and requires a matching public review state', () => {
  const accepted = validateAitUsaCrmEvent(event({
    eventType: 'placement_review_confirmed',
    eventId: 'placement-review-confirmed-001',
    idempotencyKey: 'placement-review-confirmed-001',
    placement: {
      reviewId: 'placement-review-opaque-001',
      resultId: 'placement-result-opaque-001',
      reviewStatus: 'confirmed',
      finalLevelKey: 'book-2',
      recommendedLevelKey: 'book-2',
      verifiedEmail: true,
      verifiedMobile: false,
      communicationPreference: 'email',
    },
    consent: { advisorContactEmail: true, serviceSms: false, policyVersion: 'privacy-v2' },
  }));
  assert.equal(accepted.ok, true);
  assert.equal(validateAitUsaCrmEvent({
    ...accepted.event,
    placement: { ...accepted.event.placement, reviewerRationale: 'never send to CRM' },
  }).ok, false);
  assert.equal(validateAitUsaCrmEvent({
    ...accepted.event,
    placement: { ...accepted.event.placement, reviewStatus: 'created' },
  }).error, 'event_placement_review_status_invalid');
  assert.equal(validateAitUsaCrmEvent({
    ...accepted.event,
    placement: { ...accepted.event.placement, finalLevelKey: '' },
  }).error, 'event_placement_finalLevelKey_invalid');
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
  assert.match(route, /resolveSingleOrganizationId/);
  assert.doesNotMatch(route, /select id from organizations order by created_at asc limit 1/);
  assert.doesNotMatch(route, /source === 'AIT USA Refresh' \|\|/);
});

function createEventClient({ leadRows = [], contactUpdateRows = [{ id: 'contact-1' }] } = {}) {
  const calls = [];
  let leadRead = 0;
  return {
    calls,
    async query(statement, values = []) {
      const sql = String(statement);
      calls.push({ sql, values });
      if (sql.includes('from activity_events')) return { rows: [] };
      if (sql.includes('from contacts')) return { rows: [{ id: 'contact-1' }] };
      if (sql.includes('update contacts')) return { rows: contactUpdateRows };
      if (sql.includes('from leads')) return { rows: [leadRows[leadRead++]].filter(Boolean) };
      if (sql.includes('insert into leads')) return { rows: [{ id: 'lead-created-1' }] };
      if (sql.includes('from import_batches')) return { rows: [{ id: 'batch-1' }] };
      if (sql.includes('select coalesce(max(source_row_number)')) return { rows: [{ max_row: 0 }] };
      if (sql.includes('insert into import_source_rows')) return { rows: [{ id: 'source-row-1' }] };
      if (sql.includes('insert into import_normalized_records')) return { rows: [{ id: 'normalized-1' }] };
      if (sql.includes('insert into import_review_items')) return { rows: [{ id: 'review-1' }] };
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

test('updates an exact AIT USA contact only in the caller organization', async () => {
  const client = createEventClient();
  await ingestAitUsaCrmEvent(client, {
    organizationId: 'org-1',
    businessUnitId: 'unit-1',
    event: event(),
  });

  const update = client.calls.find((call) => call.sql.includes('update contacts'));
  assert.match(update.sql, /where id = \$1 and organization_id = \$2 returning id/);
  assert.deepEqual(update.values.slice(0, 2), ['contact-1', 'org-1']);
});

test('never attaches an AIT USA event to a lead from another business unit', async () => {
  const client = createCrossBusinessUnitLeadClient();
  const result = await ingestAitUsaCrmEvent(client, {
    organizationId: 'org-1',
    businessUnitId: 'unit-b',
    event: event(),
  });

  assert.equal(result.leadId, 'lead-unit-b');
  const existingLeadLookup = client.calls.find((call) => call.sql.includes('from leads'));
  assert.match(existingLeadLookup.sql, /organization_id = \$1 and business_unit_id = \$2 and contact_id = \$3/);
  assert.deepEqual(existingLeadLookup.values, ['org-1', 'unit-b', 'contact-1']);
  assert.equal(client.calls.some((call) => call.sql.includes('lead-foreign-unit-a')), false);
});

test('AIT USA follow-up events reuse the sole active Opportunity and closed history allows one new Opportunity', async () => {
  const existingClient = createOpportunityEventClient([
    { id: 'active-1', status: 'Follow Up', assigned_user_id: 'owner-existing', source_name: 'Original source' },
    { id: 'closed-1', status: 'Dropped / Quit' },
  ]);
  const existing = await ingestAitUsaCrmEvent(existingClient, {
    organizationId: 'org-1', businessUnitId: 'unit-1', event: event(),
  });
  assert.equal(existing.leadId, 'active-1');
  assert.equal(existingClient.calls.some((call) => call.sql.includes('insert into leads')), false);

  const closedClient = createOpportunityEventClient([
    { id: 'closed-1', status: 'Dropped / Quit' },
    { id: 'closed-2', status: 'Course Completed' },
  ]);
  const created = await ingestAitUsaCrmEvent(closedClient, {
    organizationId: 'org-1', businessUnitId: 'unit-1', event: event(),
  });
  assert.equal(created.leadId, 'lead-created-1');
  assert.equal(closedClient.calls.filter((call) => call.sql.includes('insert into leads')).length, 1);
});

test('routes multiple active same-business-unit AIT USA Opportunities to durable review before contact mutation and keeps replay idempotent', async () => {
  const client = createMultipleSameBusinessUnitLeadClient();
  const input = {
    organizationId: 'org-1',
    businessUnitId: 'unit-1',
    event: event(),
  };

  const first = await ingestAitUsaCrmEvent(client, input);
  const replay = await ingestAitUsaCrmEvent(client, input);

  assert.equal(first.review, true);
  assert.equal(first.reviewRecord.reviewId, 'review-1');
  assert.equal(replay.duplicate, true);
  assert.equal(replay.review, true);
  assert.equal(client.calls.some((call) => call.sql.includes('update contacts')), false);
  assert.equal(client.calls.some((call) => call.sql.includes('insert into contacts')), false);
  assert.equal(client.calls.some((call) => call.sql.includes('insert into leads')), false);
  assert.equal(client.calls.some((call) => call.sql.includes('insert into tasks')), false);
  assert.equal(client.calls.filter((call) => call.sql.includes('insert into activity_events')).length, 1);
  assert.equal(client.calls.filter((call) => call.sql.includes('insert into import_review_items')).length, 1);
  const reviewActivity = client.calls.find((call) =>
    call.sql.includes('insert into activity_events') &&
    String(call.values[3] || '').includes('contact_identity_review:multiple_active_opportunities'),
  );
  assert.ok(reviewActivity);
});

test('fails closed to an AIT USA identity review when an exact contact update affects no row', async () => {
  const client = createEventClient({ contactUpdateRows: [] });
  const result = await ingestAitUsaCrmEvent(client, {
    organizationId: 'org-1',
    businessUnitId: 'unit-1',
    event: event(),
  });

  assert.equal(result.review, true);
  assert.equal(result.contactId, null);
  assert.equal(result.leadId, null);
  assert.equal(client.calls.some((call) => call.sql.includes('insert into contacts')), false);
  assert.equal(client.calls.some((call) => call.sql.includes('insert into leads')), false);
  const review = client.calls.find((call) =>
    call.sql.includes('insert into activity_events') &&
    String(call.values[3] || '').includes('contact_identity_review:exact_contact_not_available_for_organization'),
  );
  assert.ok(review);
});

test('returns an AIT USA identity review outcome without contact or lead mutation when evidence conflicts', async () => {
  const client = createAmbiguousIdentityEventClient();
  const result = await ingestAitUsaCrmEvent(client, {
    organizationId: 'org-1',
    businessUnitId: 'unit-1',
    event: event({ contact: { firstName: 'Ana', email: 'ana@example.com', phone: '+15550101000' } }),
  });

  assert.equal(result.review, true);
  assert.equal(result.acknowledged, true);
  assert.equal(result.contactId, null);
  assert.equal(result.leadId, null);
  assert.equal(client.calls.some((call) => call.sql.includes('update contacts')), false);
  assert.equal(client.calls.some((call) => call.sql.includes('insert into contacts')), false);
  assert.equal(client.calls.some((call) => call.sql.includes('insert into leads')), false);
  assert.equal(client.calls.some((call) => call.sql.includes('insert into activity_events')), true);
  assert.equal(client.calls.some((call) => call.sql.includes('insert into import_source_rows')), true);
  assert.equal(client.calls.some((call) => call.sql.includes('insert into import_normalized_records')), true);
  assert.equal(client.calls.some((call) => call.sql.includes('insert into import_review_items')), true);
  assert.equal(result.reviewRecord.reviewId, 'review-1');
});

test('creates one durable Import Review item for an ambiguous AIT USA event and keeps replay idempotent', async () => {
  const client = createAmbiguousIdentityEventClient();
  const input = {
    organizationId: 'org-1',
    businessUnitId: 'unit-1',
    event: event({ contact: { firstName: 'Ana', email: 'ana@example.com', phone: '+15550101000' } }),
  };

  const first = await ingestAitUsaCrmEvent(client, input);
  const replay = await ingestAitUsaCrmEvent(client, input);

  assert.equal(first.review, true);
  assert.deepEqual(first.reviewRecord, {
    batchId: 'batch-1',
    sourceRowId: 'source-row-1',
    normalizedRecordId: 'normalized-1',
    reviewId: 'review-1',
  });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.review, true);
  assert.equal(client.calls.filter((call) => call.sql.includes('insert into import_source_rows')).length, 1);
  assert.equal(client.calls.filter((call) => call.sql.includes('insert into import_normalized_records')).length, 1);
  assert.equal(client.calls.filter((call) => call.sql.includes('insert into import_review_items')).length, 1);
  assert.equal(client.calls.filter((call) => call.sql.includes('insert into activity_events')).length, 1);
  assert.equal(client.calls.some((call) => call.sql.includes('insert into contacts')), false);
  assert.equal(client.calls.some((call) => call.sql.includes('insert into leads')), false);
  assert.equal(client.calls.some((call) => call.sql.includes('insert into tasks')), false);
});

test('scopes AIT USA identity review batches and operator-visible records to each business unit', async () => {
  const client = createBusinessUnitScopedAmbiguousEventClient();
  const firstEvent = event({
    eventId: 'evt:division-one',
    idempotencyKey: 'aitusa:division-one',
    contact: { firstName: 'Ana', email: 'ana@example.com', phone: '+15550101000' },
  });
  const secondEvent = event({
    eventId: 'evt:division-two',
    idempotencyKey: 'aitusa:division-two',
    contact: { firstName: 'Ana', email: 'ana@example.com', phone: '+15550101000' },
  });

  const first = await ingestAitUsaCrmEvent(client, {
    organizationId: 'org-1', businessUnitId: 'bu-1', event: firstEvent,
  });
  const second = await ingestAitUsaCrmEvent(client, {
    organizationId: 'org-1', businessUnitId: 'bu-2', event: secondEvent,
  });
  const replay = await ingestAitUsaCrmEvent(client, {
    organizationId: 'org-1', businessUnitId: 'bu-1', event: firstEvent,
  });

  assert.equal(first.reviewRecord.batchId, 'batch-bu-1');
  assert.equal(second.reviewRecord.batchId, 'batch-bu-2');
  assert.notEqual(first.reviewRecord.batchId, second.reviewRecord.batchId);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.review, true);
  const batchLookups = client.calls.filter((call) =>
    call.sql.includes('from import_batches') && call.sql.includes('organization_id = $1 and business_unit_id = $2'),
  );
  assert.equal(batchLookups.length, 2);
  for (const lookup of batchLookups) {
    assert.match(lookup.sql, /organization_id = \$1 and business_unit_id = \$2 and source_type = \$3/);
  }
  assert.deepEqual(batchLookups.map((call) => call.values.slice(0, 2)), [['org-1', 'bu-1'], ['org-1', 'bu-2']]);
  const createdBatches = client.calls.filter((call) => call.sql.includes('insert into import_batches'));
  assert.deepEqual(createdBatches.map((call) => call.values.slice(0, 2)), [['org-1', 'bu-1'], ['org-1', 'bu-2']]);
  const sourceRows = client.calls.filter((call) => call.sql.includes('insert into import_source_rows'));
  assert.deepEqual(sourceRows.map((call) => call.values[0]), ['batch-bu-1', 'batch-bu-2']);
  assert.equal(client.calls.filter((call) => call.sql.includes('insert into import_review_items')).length, 2);
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

test('placement-review ingestion is transactionally idempotent and creates one CRM task/timeline orchestration record', async () => {
  let recorded = false;
  const calls = [];
  const client = {
    calls,
    async query(statement, values = []) {
      const sql = String(statement);
      calls.push({ sql, values });
      if (sql.includes('from activity_events')) {
        return { rows: recorded ? [{ contact_id: 'contact-1', lead_id: 'lead-1', metadata_json: {} }] : [] };
      }
      if (sql.includes('from contacts')) return { rows: [{ id: 'contact-1' }] };
      if (sql.includes('update contacts')) return { rows: [{ id: 'contact-1' }] };
      if (sql.includes('from leads')) return { rows: [{ id: 'lead-1', status: 'Follow Up', assigned_user_id: 'senior-aitusa', source_name: 'AIT USA Refresh' }] };
      if (sql.includes("r.key = 'senior_coordinator'")) return { rows: [{ id: 'senior-aitusa', tier: 'senior_coordinator' }] };
      if (sql.includes("r.key = 'admin'")) return { rows: [] };
      if (sql.includes('from tasks')) return { rows: [] };
      if (sql.includes('insert into tasks')) return { rows: [{ id: 'task-review-1', status: 'open', owner_user_id: 'senior-aitusa', due_at: '2026-08-20T12:00:00.000Z' }] };
      if (sql.includes('insert into activity_events')) { recorded = true; return { rows: [] }; }
      if (sql.includes('insert into notifications')) return { rows: [{ id: 'notification-review-1' }] };
      return { rows: [] };
    },
  };
  const reviewEvent = event({
    eventType: 'placement_review_created',
    eventId: 'placement-review-created-event-001',
    idempotencyKey: 'placement-review-created-event-001',
    correlationId: 'placement-review-correlation-001',
    placement: {
      reviewId: 'placement-review-opaque-001',
      resultId: 'placement-result-opaque-001',
      reviewStatus: 'created',
      recommendedLevelKey: 'book-2',
      verifiedEmail: true,
      communicationPreference: 'email',
    },
  });
  const first = await ingestAitUsaCrmEvent(client, { organizationId: 'org-1', businessUnitId: 'unit-1', event: reviewEvent });
  const replay = await ingestAitUsaCrmEvent(client, { organizationId: 'org-1', businessUnitId: 'unit-1', event: reviewEvent });
  assert.equal(first.placementReview.taskId, 'task-review-1');
  assert.equal(replay.duplicate, true);
  assert.equal(calls.filter((call) => call.sql.includes('insert into activity_events')).length, 1);
  assert.equal(calls.filter((call) => call.sql.includes('insert into tasks')).length, 1);
  assert.equal(calls.filter((call) => call.sql.includes('insert into notifications')).length, 1);
});

function createAmbiguousIdentityEventClient() {
  const calls = [];
  let recorded = false;
  return {
    calls,
    async query(statement, values = []) {
      const sql = String(statement);
      calls.push({ sql, values });
      if (sql.includes('from activity_events')) {
        return {
          rows: recorded
            ? [{ contact_id: null, lead_id: null, metadata_json: { contactIdentity: { reason: 'email_and_phone_resolve_to_different_contacts' } } }]
            : [],
        };
      }
      if (sql.includes('insert into activity_events')) {
        recorded = true;
        return { rows: [] };
      }
      if (sql.includes('lower(email)')) return { rows: [{ id: 'contact-email' }] };
      if (sql.includes('regexp_replace(coalesce(phone')) return { rows: [{ id: 'contact-phone' }] };
      if (sql.includes('from import_batches')) return { rows: [{ id: 'batch-1' }] };
      if (sql.includes('select id from import_batches where id = $1 for update')) return { rows: [{ id: 'batch-1' }] };
      if (sql.includes('select coalesce(max(source_row_number)')) return { rows: [{ max_row: 0 }] };
      if (sql.includes('insert into import_source_rows')) return { rows: [{ id: 'source-row-1' }] };
      if (sql.includes('insert into import_normalized_records')) return { rows: [{ id: 'normalized-1' }] };
      if (sql.includes('insert into import_review_items')) return { rows: [{ id: 'review-1' }] };
      return { rows: [] };
    },
  };
}

function createBusinessUnitScopedAmbiguousEventClient() {
  const calls = [];
  const recordedEvents = new Set();
  const batches = new Map();
  let sourceRowCount = 0;
  return {
    calls,
    async query(statement, values = []) {
      const sql = String(statement);
      calls.push({ sql, values });
      if (sql.includes('from activity_events')) {
        return {
          rows: recordedEvents.has(values[1])
            ? [{ contact_id: null, lead_id: null, metadata_json: { contactIdentity: { reason: 'email_and_phone_resolve_to_different_contacts' } } }]
            : [],
        };
      }
      if (sql.includes('insert into activity_events')) {
        recordedEvents.add(JSON.parse(values[4]).aitusa_event_idempotency_key);
        return { rows: [] };
      }
      if (sql.includes('lower(email)')) return { rows: [{ id: 'contact-email' }] };
      if (sql.includes('regexp_replace(coalesce(phone')) return { rows: [{ id: 'contact-phone' }] };
      if (sql.includes('from import_batches')) return { rows: batches.has(values[1]) ? [{ id: batches.get(values[1]) }] : [] };
      if (sql.includes('insert into import_batches')) {
        const batchId = `batch-${values[1]}`;
        batches.set(values[1], batchId);
        return { rows: [{ id: batchId }] };
      }
      if (sql.includes('select id from import_batches where id = $1 for update')) return { rows: [{ id: values[0] }] };
      if (sql.includes('select coalesce(max(source_row_number)')) return { rows: [{ max_row: 0 }] };
      if (sql.includes('insert into import_source_rows')) return { rows: [{ id: `source-row-${++sourceRowCount}` }] };
      if (sql.includes('insert into import_normalized_records')) return { rows: [{ id: `normalized-${sourceRowCount}` }] };
      if (sql.includes('insert into import_review_items')) return { rows: [{ id: `review-${sourceRowCount}` }] };
      return { rows: [] };
    },
  };
}

function createCrossBusinessUnitLeadClient() {
  const calls = [];
  return {
    calls,
    async query(statement, values = []) {
      const sql = String(statement);
      calls.push({ sql, values });
      if (sql.includes('from activity_events')) return { rows: [] };
      if (sql.includes('from contacts')) return { rows: [{ id: 'contact-1' }] };
      if (sql.includes('update contacts')) return { rows: [{ id: 'contact-1' }] };
      if (sql.includes('from leads')) {
        // The fixture has a foreign-unit lead, which must not be returned by
        // the same-business-unit lookup.
        return { rows: sql.includes('business_unit_id = $2') ? [] : [{ id: 'lead-foreign-unit-a' }] };
      }
      if (sql.includes('insert into leads')) return { rows: [{ id: 'lead-unit-b' }] };
      return { rows: [] };
    },
  };
}

function createOpportunityEventClient(opportunityRows) {
  const calls = [];
  return {
    calls,
    async query(statement, values = []) {
      const sql = String(statement);
      calls.push({ sql, values });
      if (sql.includes('from activity_events')) return { rows: [] };
      if (sql.includes('from contacts')) return { rows: [{ id: 'contact-1' }] };
      if (sql.includes('update contacts')) return { rows: [{ id: 'contact-1' }] };
      if (sql.includes('from leads')) return { rows: opportunityRows };
      if (sql.includes('insert into leads')) return { rows: [{ id: 'lead-created-1' }] };
      if (sql.includes('insert into notifications')) return { rows: [{ id: 'notification-1' }] };
      if (sql.includes('insert into tasks')) return { rows: [{ id: 'task-1' }] };
      return { rows: [] };
    },
  };
}

function createMultipleSameBusinessUnitLeadClient() {
  const calls = [];
  let recorded = false;
  return {
    calls,
    async query(statement, values = []) {
      const sql = String(statement);
      calls.push({ sql, values });
      if (sql.includes('from activity_events')) {
        return {
          rows: recorded
            ? [{ contact_id: null, lead_id: null, metadata_json: { contactIdentity: { reason: 'multiple_same_business_unit_leads' } } }]
            : [],
        };
      }
      if (sql.includes('insert into activity_events')) {
        recorded = true;
        return { rows: [] };
      }
      if (sql.includes('from contacts')) return { rows: [{ id: 'contact-1' }] };
      if (sql.includes('from leads')) return { rows: [{ id: 'lead-1' }, { id: 'lead-2' }] };
      if (sql.includes('from import_batches')) return { rows: [{ id: 'batch-1' }] };
      if (sql.includes('select coalesce(max(source_row_number)')) return { rows: [{ max_row: 0 }] };
      if (sql.includes('insert into import_source_rows')) return { rows: [{ id: 'source-row-1' }] };
      if (sql.includes('insert into import_normalized_records')) return { rows: [{ id: 'normalized-1' }] };
      if (sql.includes('insert into import_review_items')) return { rows: [{ id: 'review-1' }] };
      return { rows: [] };
    },
  };
}
