import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectWebsiteLeadSubmittedSecrets,
  findDuplicateWebsiteLeadSubmission,
  ingestWebsiteLeadSubmission,
  normalizeWebsiteLeadSubmission,
  resolveSingleOrganizationId,
  sanitizeWebhookBodyForAudit,
  verifyWebsiteLeadSecret,
} from './website-leads.js';
import {
  SMS_CONSENT_EVENT_TYPES,
  SMS_CONSENT_SOURCE_TYPES,
  SMS_CONSENT_STATUSES,
} from '../communication-consent/sms-consent.js';

test('normalizes plain website lead JSON and preserves non-core form fields', () => {
  const { payload, lead } = normalizeWebsiteLeadSubmission({
    firstName: ' Ana ',
    lastName: ' Rivera ',
    email: ' ANA@EXAMPLE.COM ',
    phone: '(555) 010-1000',
    service: 'Sign repair',
    customQuestion: 'Needs install next week',
    workflowTags: 'hot;needs_first_outreach',
    webhookSecret: 'do-not-store',
  });

  assert.equal(payload.email, ' ANA@EXAMPLE.COM ');
  assert.equal(lead.name, 'Ana Rivera');
  assert.equal(lead.email, 'ana@example.com');
  assert.equal(lead.phone, '5550101000');
  assert.equal(lead.service, 'Sign repair');
  assert.deepEqual(lead.tags, ['hot', 'needs_first_outreach']);
  assert.deepEqual(lead.formFields, {
    customQuestion: 'Needs install next week',
  });
});

test('normalizes refresh-site contact CTA consent and communication preference metadata', () => {
  const { lead } = normalizeWebsiteLeadSubmission({
    submissionType: 'contact_cta',
    sourceName: 'AIT USA Refresh Site',
    firstName: 'Maria',
    lastName: 'Lopez',
    email: 'maria.lopez@example.test',
    phone: '(555) 010-9911',
    message: 'Please contact me about English classes.',
    communication: {
      consent: {
        contact: 'I agree',
        whatsapp: 'yes',
        sms: 'no',
      },
      preference: 'WhatsApp',
    },
    customQuestion: 'Morning classes',
  });

  assert.equal(lead.submissionType, 'contact_cta');
  assert.deepEqual(lead.communicationConsent, {
    contact: true,
    whatsapp: true,
    sms: false,
  });
  assert.equal(lead.communicationPreference, 'whatsapp');
  assert.deepEqual(lead.formFields, {
    customQuestion: 'Morning classes',
  });
});

test('normalizes refresh-site placement result metadata without assuming absent consent', () => {
  const { lead } = normalizeWebsiteLeadSubmission({
    submissionType: 'placement_test',
    sourceName: 'AIT USA Refresh Site',
    fullName: 'Carlos Gomez',
    email: 'carlos.gomez@example.test',
    smsConsent: 'no',
    preferredContactMethod: 'text message',
    placement: {
      recommendation: 'Intermediate English',
      score: '82',
      scoreBand: 'B1',
      selectedGoals: ['Conversation', 'Career growth'],
      selectedAnswers: {
        listening: 'most',
        grammar: 'some',
        webhookSecret: 'do-not-store',
      },
      advisorConfirmation: 'Advisor confirms final placement before enrollment.',
    },
  });

  assert.equal(lead.submissionType, 'placement_test');
  assert.equal(lead.service, 'Placement test');
  assert.deepEqual(lead.communicationConsent, {
    contact: null,
    whatsapp: null,
    sms: false,
  });
  assert.equal(lead.communicationPreference, 'sms');
  assert.deepEqual(lead.placement, {
    recommendation: 'Intermediate English',
    score: 82,
    scoreBand: 'B1',
    selectedGoals: ['Conversation', 'Career growth'],
    selectedAnswers: {
      listening: 'most',
      grammar: 'some',
      webhookSecret: '[redacted]',
    },
    advisorConfirmation: 'Advisor confirms final placement before enrollment.',
  });
  assert.deepEqual(lead.formFields, {});
});

test('does not infer placement-test metadata from generic lead score fields', () => {
  const { lead } = normalizeWebsiteLeadSubmission({
    sourceName: 'Generic Website Form',
    fullName: 'Scored Lead',
    email: 'scored.lead@example.test',
    score: '92',
    recommendation: 'Call tomorrow morning',
    answers: 'Asked for evening classes',
  });

  assert.equal(lead.submissionType, 'website_lead');
  assert.deepEqual(lead.placement, {});
  assert.deepEqual(lead.formFields, {
    score: '92',
    recommendation: 'Call tomorrow morning',
    answers: 'Asked for evening classes',
  });
});

test('unwraps Wix-style data payloads before normalization', () => {
  const { payload, lead } = normalizeWebsiteLeadSubmission({
    data: {
      formName: 'AIT USA Wix',
      fullName: 'Wix Customer',
      email: 'wix@example.com',
      message: 'Interested in channel letters',
      submissionId: 'wix-001',
    },
  });

  assert.equal(payload.formName, 'AIT USA Wix');
  assert.equal(lead.name, 'Wix Customer');
  assert.equal(lead.sourceKey, 'AIT USA Wix');
  assert.equal(lead.sourceName, 'AIT USA Wix');
  assert.equal(lead.externalId, 'wix-001');
});

test('prefers split Wix contact names over a legacy concatenated name field', () => {
  const { lead } = normalizeWebsiteLeadSubmission({
    name: 'HildaRodriguez',
    firstName: 'Hilda',
    lastName: 'Rodriguez',
    email: 'hilda@example.com',
  });

  assert.equal(lead.name, 'Hilda Rodriguez');
  assert.deepEqual(lead.formFields, {});
});

test('accepts common spaced and snake_case Wix name keys', () => {
  const { lead } = normalizeWebsiteLeadSubmission({
    'Contact first name': 'Hilda',
    contact_last_name: 'Rodriguez',
    email: 'hilda@example.com',
  });

  assert.equal(lead.name, 'Hilda Rodriguez');
  assert.deepEqual(lead.formFields, {});
});

test('normalizes website lead lifecycle status fields', () => {
  const { lead } = normalizeWebsiteLeadSubmission({
    email: 'qualified@example.com',
    status: 'qualified',
    currentStage: 'proposal_sent',
  });

  assert.equal(lead.status, 'Qualified');
  assert.equal(lead.currentStage, 'Proposal Sent');

  const { lead: fallbackLead } = normalizeWebsiteLeadSubmission({
    email: 'fallback@example.com',
    status: 'random-invalid-foo',
  });

  assert.equal(fallbackLead.status, 'New Lead');
  assert.equal(fallbackLead.currentStage, 'New Lead');
});

test('accepts body-secret authentication from wrapped payloads', () => {
  const body = {
    webhook_secret: 'shared-secret',
    data: {
      webhookSecret: 'shared-secret',
      email: 'body-secret@example.com',
      message: 'Body auth',
    },
  };

  assert.equal(verifyWebsiteLeadSecret({ body, expectedSecret: 'shared-secret' }), true);
  assert.deepEqual(collectWebsiteLeadSubmittedSecrets({ body }), ['shared-secret', 'shared-secret']);
});

test('redacts secret-like values from audit payloads', () => {
  const sanitized = sanitizeWebhookBodyForAudit({
    webhook_secret: 'shared-secret',
    Authorization: 'Bearer shared-secret',
    'content-type': 'application/json',
    nested: {
      xAitWebhookSecret: 'shared-secret',
      safe: 'visible',
    },
  });

  assert.deepEqual(sanitized, {
    webhook_secret: '[redacted]',
    Authorization: '[redacted]',
    nested: {
      xAitWebhookSecret: '[redacted]',
      safe: 'visible',
    },
  });
  assert.equal(JSON.stringify(sanitized).includes('shared-secret'), false);
});

test('resolves an organization only when exactly one organization exists', async () => {
  const calls = [];
  const resolve = async (rows) => resolveSingleOrganizationId({
    async query(sql) {
      calls.push(sql);
      return { rows };
    },
  });

  assert.equal(await resolve([]), null);
  assert.equal(await resolve([{ id: 'org-1' }]), 'org-1');
  assert.equal(await resolve([{ id: 'org-1' }, { id: 'org-2' }]), null);
  assert.deepEqual(calls, [
    'select id from organizations order by created_at asc limit 2',
    'select id from organizations order by created_at asc limit 2',
    'select id from organizations order by created_at asc limit 2',
  ]);
});

test('records duplicate externalId submissions for review without creating CRM rows', async () => {
  const { client, calls } = createDuplicateClient();

  const result = await ingestWebsiteLeadSubmission(client, {
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    body: {
      externalId: 'external-001',
      email: 'dupe@example.com',
      message: 'Duplicate submission',
      webhookSecret: 'shared-secret',
      customQuestion: 'Keep this field',
    },
  });

  assert.deepEqual(result, {
    ok: true,
    duplicate: true,
    contactId: 'contact-existing',
    leadId: 'lead-existing',
  });
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), false);

  const auditInsert = calls.find((call) => call.sql.startsWith('insert into import_source_rows'));
  const rawValues = JSON.parse(auditInsert.params[3]);
  assert.equal(rawValues.external_id, 'external-001');
  assert.equal(rawValues.raw.webhookSecret, '[redacted]');
  assert.equal(rawValues.raw.customQuestion, 'Keep this field');

  const normalizedInsert = calls.find((call) => call.sql.startsWith('insert into import_normalized_records'));
  const proposedLead = JSON.parse(normalizedInsert.params[4]);
  assert.equal(proposedLead.external_id, 'external-001');
  assert.equal(proposedLead.lead_id, 'lead-existing');
  assert.equal(proposedLead.duplicate_lead_id, 'lead-existing');
  assert.equal(normalizedInsert.params[6], 'needs_review');
});

test('serializes a replay before rechecking its duplicate state, creating at most one contact and lead', async () => {
  const { client, calls } = createWebsitePromotionClient({ duplicateAfterFirstPromotion: true });
  const input = {
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    body: { externalId: 'replay-001', email: 'replay@example.com', message: 'Replay-safe submission' },
  };

  const first = await ingestWebsiteLeadSubmission(client, input);
  const second = await ingestWebsiteLeadSubmission(client, input);

  assert.equal(first.duplicate, false);
  assert.deepEqual(second, {
    ok: true,
    duplicate: true,
    contactId: 'contact-1',
    leadId: 'lead-1',
  });
  assert.equal(calls.filter((call) => call.sql.startsWith('insert into contacts')).length, 1);
  assert.equal(calls.filter((call) => call.sql.startsWith('insert into leads')).length, 1);
  const duplicateLookup = calls.find((call) => call.sql.startsWith('select l.id as lead_id'));
  const firstLock = calls.findIndex((call) => call.sql.startsWith('select pg_advisory_xact_lock'));
  const duplicateLookupIndex = calls.indexOf(duplicateLookup);
  assert.ok(firstLock >= 0);
  assert.ok(duplicateLookupIndex > firstLock);
  assert.ok(calls.some((call) => call.params[0] === 'website-lead-external:org-1:replay-001'));
  assert.ok(calls.some((call) => call.params[0] === 'website-lead-contact:org-1:email:replay@example.com'));
});

test('replays an ambiguous external-id website submission from its durable review without duplicate audit records', async () => {
  const { client, calls } = createIdentityReviewClient({
    emailRows: [{ id: 'contact-a' }, { id: 'contact-b' }],
    phoneRows: [],
  });
  const input = {
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    body: { externalId: 'ambiguous-replay-001', email: 'ambiguous@example.com' },
  };

  const first = await ingestWebsiteLeadSubmission(client, input);
  const replay = await ingestWebsiteLeadSubmission(client, input);

  assert.equal(first.review, true);
  assert.equal(first.duplicate, false);
  assert.deepEqual(replay, {
    ok: true,
    duplicate: true,
    review: true,
    contactId: null,
    leadId: null,
  });
  assert.equal(calls.filter((call) => call.sql.startsWith('insert into import_source_rows')).length, 1);
  assert.equal(calls.filter((call) => call.sql.startsWith('insert into import_normalized_records')).length, 1);
  assert.equal(calls.filter((call) => call.sql.startsWith('insert into import_review_items')).length, 1);
  const reviewLookup = calls.find((call) => call.sql.startsWith('select 1 from import_normalized_records'));
  assert.deepEqual(reviewLookup.params, ['org-1', 'bu-1', 'website_form', 'ambiguous-replay-001']);
});

test('does not dedupe ambiguous website reviews without a durable external id', async () => {
  const { client, calls } = createIdentityReviewClient({
    emailRows: [{ id: 'contact-a' }, { id: 'contact-b' }],
    phoneRows: [],
  });
  const input = {
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    body: { email: 'no-external-id@example.com' },
  };

  await ingestWebsiteLeadSubmission(client, input);
  await ingestWebsiteLeadSubmission(client, input);

  assert.equal(calls.filter((call) => call.sql.startsWith('insert into import_source_rows')).length, 2);
  assert.equal(calls.filter((call) => call.sql.startsWith('insert into import_normalized_records')).length, 2);
  assert.equal(calls.filter((call) => call.sql.startsWith('insert into import_review_items')).length, 2);
  assert.equal(calls.some((call) => call.sql.startsWith('select 1 from import_normalized_records')), false);
});

test('scopes website Import Review batches to business units without duplicating an organization-level Contact', async () => {
  const { client, calls, historicalNullBusinessUnitBatchId } = createBusinessUnitScopedWebsiteClient();
  const first = await ingestWebsiteLeadSubmission(client, {
    organizationId: 'org-1',
    businessUnitId: 'bu-a',
    body: { externalId: 'bu-a-shared-contact', email: 'shared@example.com', message: 'Division A' },
  });
  const second = await ingestWebsiteLeadSubmission(client, {
    organizationId: 'org-1',
    businessUnitId: 'bu-b',
    body: { externalId: 'bu-b-shared-contact', email: 'shared@example.com', message: 'Division B' },
  });

  assert.equal(first.contactId, 'contact-shared');
  assert.equal(second.contactId, 'contact-shared');
  assert.equal(calls.filter((call) => call.sql.startsWith('insert into contacts')).length, 1);
  const batchLookups = calls.filter((call) => call.sql.startsWith('select id from import_batches where organization_id'));
  assert.deepEqual(batchLookups.map((call) => call.params.slice(0, 2)), [['org-1', 'bu-a'], ['org-1', 'bu-b']]);
  for (const lookup of batchLookups) {
    assert.match(lookup.sql, /organization_id = \$1 and business_unit_id = \$2/);
  }
  const createdBatches = calls.filter((call) => call.sql.startsWith('insert into import_batches'));
  assert.deepEqual(createdBatches.map((call) => call.params.slice(0, 2)), [['org-1', 'bu-a'], ['org-1', 'bu-b']]);
  const sourceRows = calls.filter((call) => call.sql.startsWith('insert into import_source_rows'));
  assert.deepEqual(sourceRows.map((call) => call.params[0]), ['batch-bu-a', 'batch-bu-b']);
  assert.equal(sourceRows.some((call) => call.params[0] === historicalNullBusinessUnitBatchId), false);
  assert.ok(calls.some((call) => call.params[0] === 'website-lead-batch:org-1:bu-a'));
  assert.ok(calls.some((call) => call.params[0] === 'website-lead-batch:org-1:bu-b'));
});

test('ignores a dirty cross-tenant embedded lead reference during duplicate lookup', async () => {
  const calls = [];
  const duplicate = await findDuplicateWebsiteLeadSubmission({
    async query(sql, params = []) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      // A legacy normalized record points to another organization's lead. The
      // scoped joins must exclude it before it can be returned to the caller.
      return { rows: [] };
    },
  }, { organizationId: 'org-1', externalId: 'dirty-foreign-lead' });

  assert.equal(duplicate, null);
  assert.match(calls[0].sql, /l\.organization_id = ib\.organization_id/);
  assert.match(calls[0].sql, /c\.organization_id = ib\.organization_id/);
  assert.deepEqual(calls[0].params, ['org-1', 'website_form', 'dirty-foreign-lead']);
});

test('keeps ambiguous website-lead identity candidates in import review without CRM mutation', async () => {
  for (const scenario of [
    { name: 'duplicate email', emailRows: [{ id: 'contact-a' }, { id: 'contact-b' }], phoneRows: [] },
    { name: 'duplicate phone', emailRows: [], phoneRows: [{ id: 'contact-a' }, { id: 'contact-b' }] },
    { name: 'split email and phone', emailRows: [{ id: 'contact-email' }], phoneRows: [{ id: 'contact-phone' }] },
  ]) {
    const { client, calls } = createIdentityReviewClient(scenario);
    const result = await ingestWebsiteLeadSubmission(client, {
      organizationId: 'org-1',
      businessUnitId: 'bu-1',
      body: { externalId: `identity-${scenario.name}`, email: 'ana@example.com', phone: '(555) 010-1000' },
    });

    assert.equal(result.review, true, scenario.name);
    assert.equal(result.contactId, null, scenario.name);
    assert.equal(result.leadId, null, scenario.name);
    assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), false, scenario.name);
    assert.equal(calls.some((call) => call.sql.startsWith('update contacts')), false, scenario.name);
    assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), false, scenario.name);
    const normalized = calls.find((call) => call.sql.startsWith('insert into import_normalized_records'));
    assert.equal(normalized.params[6], 'needs_review', scenario.name);
    const review = calls.find((call) => call.sql.startsWith('insert into import_review_items'));
    assert.match(review.params[3], /identity needs review/, scenario.name);
  }
});

test('keeps a submission with no usable identity in import review without CRM mutation', async () => {
  const { client, calls } = createIdentityReviewClient({ emailRows: [], phoneRows: [] });
  const result = await ingestWebsiteLeadSubmission(client, {
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    body: { externalId: 'no-identity-001', message: 'Please call me.' },
  });

  assert.equal(result.review, true);
  assert.equal(result.contactId, null);
  assert.equal(result.leadId, null);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), false);
  const review = calls.find((call) => call.sql.startsWith('insert into import_review_items'));
  assert.match(review.params[3], /no_usable_contact_identity/);
});

test('fails closed to import review when an exact contact cannot be updated in the caller organization', async () => {
  const { client, calls } = createExactContactMissingClient();
  const result = await ingestWebsiteLeadSubmission(client, {
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    body: { externalId: 'exact-missing-001', email: 'exact@example.com' },
  });

  assert.equal(result.review, true);
  assert.equal(result.contactId, null);
  assert.equal(result.leadId, null);
  const update = calls.find((call) => call.sql.startsWith('update contacts'));
  assert.match(update.sql, /where id = \$1 and organization_id = \$2 returning id/);
  assert.deepEqual(update.params.slice(0, 2), ['contact-exact', 'org-1']);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), false);
});

test('creates a notification after a new website lead is promoted', async () => {
  const { client, calls } = createWebsitePromotionClient();

  const result = await ingestWebsiteLeadSubmission(client, {
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    body: {
      externalId: 'web-001',
      fullName: 'Wix Lead',
      email: 'wix@example.com',
      service: 'Channel letters',
      message: 'Need an estimate',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.contactId, 'contact-1');
  assert.equal(result.leadId, 'lead-1');

  const notificationInsert = calls.find((call) => call.sql.startsWith('insert into notifications'));
  assert.ok(notificationInsert);
  assert.deepEqual(notificationInsert.params.slice(0, 8), [
    'org-1',
    'bu-1',
    null,
    'inbound_lead',
    'website_form',
    'Wix Lead - Website Form',
    'Interested in Channel letters. Open the contact to assign and follow up.',
    '/contacts/contact-1?leadId=lead-1',
  ]);
  assert.equal(notificationInsert.params[11], 'website:web-001');

  const taskInsert = calls.find((call) => call.sql.startsWith('with intake_lock as'));
  assert.ok(taskInsert);
  assert.equal(taskInsert.params[6], 'follow_up');
  assert.equal(taskInsert.params[8], 'high');
  assert.equal(taskInsert.params[10], 'automation');
  assert.equal(taskInsert.params[11], 'website:web-001');
  assert.equal(taskInsert.params[12], 'New lead follow-up');
});

test('AIT USA website inquiries reuse the sole active Opportunity and preserve its source and owner', async () => {
  const { client, calls } = createWebsitePromotionClient({
    existingContactId: 'contact-1',
    opportunityRows: [{
      id: 'opportunity-existing',
      organization_id: 'org-1',
      business_unit_id: 'bu-usa',
      contact_id: 'contact-1',
      status: 'Follow Up',
      assigned_user_id: 'owner-existing',
      source_name: 'Original inquiry',
    }],
  });
  const result = await ingestWebsiteLeadSubmission(client, {
    organizationId: 'org-1',
    businessUnitId: 'bu-usa',
    businessUnit: { id: 'bu-usa', name: 'AIT USA Institute' },
    body: { externalId: 'aitusa-reuse-001', email: 'student@example.com', message: 'A second inquiry' },
  });

  assert.equal(result.leadId, 'opportunity-existing');
  assert.equal(result.assignedUserId, 'owner-existing');
  assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('update leads set original_notes')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into activity_events')), true);
  const task = calls.find((call) => call.sql.startsWith('with intake_lock as'));
  assert.equal(task.params.includes('owner-existing'), true);
});

test('AIT USA website inquiries with multiple active Opportunities go to Import Review without Contact or CRM side effects', async () => {
  const { client, calls } = createWebsitePromotionClient({
    existingContactId: 'contact-1',
    opportunityRows: [
      { id: 'active-1', status: 'New Lead' },
      { id: 'active-2', status: 'Enrolled' },
    ],
  });
  const result = await ingestWebsiteLeadSubmission(client, {
    organizationId: 'org-1',
    businessUnitId: 'bu-usa',
    businessUnit: { id: 'bu-usa', name: 'AIT USA Institute' },
    body: { externalId: 'aitusa-review-001', email: 'student@example.com' },
  });

  assert.equal(result.review, true);
  assert.equal(result.contactId, null);
  assert.equal(result.leadId, null);
  assert.equal(calls.some((call) => call.sql.startsWith('update contacts')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into notifications')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('with intake_lock as')), false);
  const review = calls.find((call) => call.sql.startsWith('insert into import_review_items'));
  assert.match(review.params[3], /multiple_active_opportunities/);
});

test('closed AIT USA Opportunity history does not block one new Opportunity', async () => {
  const { client, calls } = createWebsitePromotionClient({
    existingContactId: 'contact-1',
    opportunityRows: [
      { id: 'closed-1', status: 'Dropped / Quit' },
      { id: 'closed-2', status: 'retargeting only' },
    ],
  });
  const result = await ingestWebsiteLeadSubmission(client, {
    organizationId: 'org-1',
    businessUnitId: 'bu-usa',
    businessUnit: { id: 'bu-usa', name: 'AIT USA Institute' },
    body: { externalId: 'aitusa-new-after-closed-001', email: 'student@example.com' },
  });

  assert.equal(result.leadId, 'lead-1');
  assert.equal(calls.filter((call) => call.sql.startsWith('insert into leads')).length, 1);
});

test('routes Wix student geography to the lead and explicit campus to intended learning location', async () => {
  const { client, calls } = createWebsitePromotionClient();

  const result = await ingestWebsiteLeadSubmission(client, {
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    body: {
      externalId: 'wix-location-contract-001',
      formName: 'AIT USA Wix',
      fullName: 'Location Contract Lead',
      email: 'location-contract@example.test',
      city: 'Madrid, Spain',
      campus: 'Online',
    },
  });

  assert.equal(result.ok, true);
  const contactInsert = calls.find((call) => call.sql.startsWith('insert into contacts'));
  assert.equal(contactInsert.params[6], 'Online');

  const leadInsert = calls.find((call) => call.sql.startsWith('insert into leads'));
  assert.equal(leadInsert.params[15], 'Madrid, Spain');

  const normalizedInsert = calls.find((call) => call.sql.startsWith('insert into import_normalized_records'));
  const proposedContact = JSON.parse(normalizedInsert.params[3]);
  const proposedLead = JSON.parse(normalizedInsert.params[4]);
  assert.equal(proposedContact.address, 'Online');
  assert.equal(proposedLead.address, 'Madrid, Spain');
  assert.equal(proposedLead.lead_profile.locationPreference, 'Madrid, Spain');
});

test('records refresh-site SMS decline in the consent ledger', async () => {
  const { client, calls } = createWebsitePromotionClient();

  const result = await ingestWebsiteLeadSubmission(client, {
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    body: {
      externalId: 'refresh-contact-no-sms',
      submissionType: 'contact_cta',
      sourceName: 'AIT USA Refresh Site',
      firstName: 'Maria',
      lastName: 'Lopez',
      phone: '(555) 010-9911',
      communication: {
        consent: {
          contact: 'yes',
          whatsapp: 'yes',
          sms: 'no',
        },
        preference: 'WhatsApp',
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.duplicate, false);

  const consentUpsert = calls.find((call) => call.sql.startsWith('insert into contact_channel_consents'));
  assert.equal(consentUpsert.params[0], 'org-1');
  assert.equal(consentUpsert.params[1], 'contact-1');
  assert.equal(consentUpsert.params[2], 'bu-1');
  assert.equal(consentUpsert.params[3], 'business_unit:bu-1');
  assert.equal(consentUpsert.params[5], SMS_CONSENT_STATUSES.OPTED_OUT);
  assert.equal(consentUpsert.params[6], SMS_CONSENT_SOURCE_TYPES.WEBSITE_FORM);
  assert.equal(consentUpsert.params[7], 'website-lead:refresh-contact-no-sms');
  assert.equal(consentUpsert.params[10], 'website_form_sms_declined');

  const auditInsert = calls.find((call) => call.sql.startsWith('insert into contact_channel_consent_events'));
  assert.equal(auditInsert.params[5], SMS_CONSENT_EVENT_TYPES.OPT_OUT);
  assert.equal(auditInsert.params[6], SMS_CONSENT_STATUSES.OPTED_OUT);
  assert.equal(auditInsert.params[12], 'website-lead:org-1:refresh-contact-no-sms:sms-consent');
  const auditMetadata = JSON.parse(auditInsert.params[14]);
  assert.deepEqual(auditMetadata.communicationConsent, {
    contact: true,
    whatsapp: true,
    sms: false,
  });
  assert.equal(auditMetadata.communicationPreference, 'whatsapp');
});

test('persists refresh-site placement consent contract in audit and task metadata', async () => {
  const { client, calls } = createWebsitePromotionClient();

  const result = await ingestWebsiteLeadSubmission(client, {
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    body: {
      externalId: 'refresh-placement-001',
      submissionType: 'placement_test',
      sourceName: 'AIT USA Refresh Site',
      firstName: 'Lucia',
      lastName: 'Perez',
      email: 'lucia.perez@example.test',
      phone: '(555) 010-9922',
      consent: {
        contact: 'yes',
        whatsapp: 'no',
        sms: 'yes',
      },
      communicationPreference: 'SMS',
      placement: {
        recommendation: 'Start with Level 3',
        score: 74,
        scoreBand: 'A2-B1',
        selectedGoals: ['Travel', 'Work'],
        selectedAnswers: {
          grammar: 'A2',
          speaking: 'B1',
          webhookSecret: 'do-not-store',
        },
        advisorConfirmation: 'Advisor will confirm the level before enrollment.',
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.duplicate, false);

  const auditInsert = calls.find((call) => call.sql.startsWith('insert into import_source_rows'));
  const rawValues = JSON.parse(auditInsert.params[3]);
  assert.equal(rawValues.submission_type, 'placement_test');
  assert.deepEqual(rawValues.communication_consent, {
    contact: true,
    whatsapp: false,
    sms: true,
  });
  assert.equal(rawValues.communication_preference, 'sms');
  assert.equal(rawValues.placement.recommendation, 'Start with Level 3');
  assert.equal(rawValues.raw.placement.selectedAnswers.webhookSecret, '[redacted]');

  const normalizedInsert = calls.find((call) => call.sql.startsWith('insert into import_normalized_records'));
  const proposedLead = JSON.parse(normalizedInsert.params[4]);
  assert.equal(proposedLead.submission_type, 'placement_test');
  assert.deepEqual(proposedLead.communication_consent, {
    contact: true,
    whatsapp: false,
    sms: true,
  });
  assert.equal(proposedLead.communication_preference, 'sms');
  assert.deepEqual(proposedLead.placement.selectedGoals, ['Travel', 'Work']);
  assert.equal(proposedLead.placement.selectedAnswers.webhookSecret, '[redacted]');

  const leadInsert = calls.find((call) => call.sql.startsWith('insert into leads'));
  assert.match(leadInsert.params[7], /communication=contact:yes,whatsapp:no,sms:yes,preference:sms/);
  assert.match(leadInsert.params[7], /placement=recommendation:Start with Level 3,score:74,score_band:A2-B1/);

  const consentUpsert = calls.find((call) => call.sql.startsWith('insert into contact_channel_consents'));
  assert.equal(consentUpsert.params[3], 'business_unit:bu-1');
  assert.equal(consentUpsert.params[5], SMS_CONSENT_STATUSES.OPTED_IN);
  assert.equal(consentUpsert.params[6], SMS_CONSENT_SOURCE_TYPES.WEBSITE_FORM);
  assert.equal(consentUpsert.params[7], 'website-lead:refresh-placement-001');

  const consentAuditInsert = calls.find((call) => call.sql.startsWith('insert into contact_channel_consent_events'));
  assert.equal(consentAuditInsert.params[5], SMS_CONSENT_EVENT_TYPES.OPT_IN);
  assert.equal(consentAuditInsert.params[6], SMS_CONSENT_STATUSES.OPTED_IN);
  assert.equal(consentAuditInsert.params[12], 'website-lead:org-1:refresh-placement-001:sms-consent');
  const consentAuditMetadata = JSON.parse(consentAuditInsert.params[14]);
  assert.equal(consentAuditMetadata.submissionType, 'placement_test');
  assert.equal(consentAuditMetadata.placement.scoreBand, 'A2-B1');

  const notificationInsert = calls.find((call) => call.sql.startsWith('insert into notifications'));
  const notificationMetadata = JSON.parse(notificationInsert.params[10]);
  assert.equal(notificationMetadata.submissionType, 'placement_test');
  assert.deepEqual(notificationMetadata.communicationConsent, {
    contact: true,
    whatsapp: false,
    sms: true,
  });
  assert.equal(notificationMetadata.communicationPreference, 'sms');
  assert.equal(notificationMetadata.placement.advisorConfirmation, 'Advisor will confirm the level before enrollment.');

  const taskInsert = calls.find((call) => call.sql.startsWith('with intake_lock as'));
  const taskMetadata = JSON.parse(taskInsert.params[13]);
  assert.equal(taskMetadata.submissionType, 'placement_test');
  assert.equal(taskMetadata.placement.scoreBand, 'A2-B1');
});

function createDuplicateClient() {
  const calls = [];
  return {
    calls,
    client: {
      async query(sql, params = []) {
        const normalizedSql = String(sql).replace(/\s+/g, ' ').trim();
        calls.push({ sql: normalizedSql, params });

        if (normalizedSql.startsWith('select pg_advisory_xact_lock')) {
          return { rows: [] };
        }
        if (normalizedSql.startsWith('select l.id as lead_id')) {
          return { rows: [{ lead_id: 'lead-existing', contact_id: 'contact-existing' }] };
        }
        if (normalizedSql.startsWith('select id from import_batches where organization_id')) {
          return { rows: [{ id: 'batch-1' }] };
        }
        if (normalizedSql === 'begin' || normalizedSql === 'commit' || normalizedSql === 'rollback') {
          return { rows: [] };
        }
        if (normalizedSql.startsWith('select id from import_batches where id = $1 for update')) {
          return { rows: [{ id: 'batch-1' }] };
        }
        if (normalizedSql.startsWith('select coalesce(max(source_row_number)')) {
          return { rows: [{ max_row: 4 }] };
        }
        if (normalizedSql.startsWith('insert into import_source_rows')) {
          return { rows: [{ id: 'source-row-5' }] };
        }
        if (normalizedSql.startsWith('insert into import_normalized_records')) {
          return { rows: [{ id: 'normalized-5' }] };
        }
        if (normalizedSql.startsWith('insert into import_review_items')) {
          return { rows: [] };
        }

        throw new Error('Unexpected query: ' + normalizedSql);
      },
    },
  };
}

function createWebsitePromotionClient({
  duplicateAfterFirstPromotion = false,
  existingContactId = null,
  opportunityRows = [],
} = {}) {
  const calls = [];
  let promoted = false;
  return {
    calls,
    client: {
      async query(sql, params = []) {
        const normalizedSql = String(sql).replace(/\s+/g, ' ').trim();
        calls.push({ sql: normalizedSql, params });

        if (normalizedSql.startsWith('select pg_advisory_xact_lock')) {
          return { rows: [] };
        }
        if (normalizedSql.startsWith('select l.id as lead_id')) {
          return { rows: duplicateAfterFirstPromotion && promoted ? [{ lead_id: 'lead-1', contact_id: 'contact-1' }] : [] };
        }
        if (normalizedSql.startsWith('select 1 from import_normalized_records')) return { rows: [] };
        if (normalizedSql.startsWith('select id from import_batches where organization_id')) {
          return { rows: [{ id: 'batch-1' }] };
        }
        if (normalizedSql === 'begin' || normalizedSql === 'commit' || normalizedSql === 'rollback') {
          return { rows: [] };
        }
        if (normalizedSql.startsWith('select id from import_batches where id = $1 for update')) {
          return { rows: [{ id: 'batch-1' }] };
        }
        if (normalizedSql.startsWith('select coalesce(max(source_row_number)')) {
          return { rows: [{ max_row: 2 }] };
        }
        if (normalizedSql.startsWith('select u.id, u.name, u.email from users u')) {
          return { rows: [] };
        }
        if (normalizedSql.startsWith('select id, name, email from users')) {
          return { rows: [] };
        }
        if (normalizedSql.startsWith('select id from contacts where organization_id')) {
          return { rows: existingContactId ? [{ id: existingContactId }] : [] };
        }
        if (normalizedSql.startsWith('select id, organization_id, business_unit_id, contact_id, status')) {
          return { rows: opportunityRows };
        }
        if (normalizedSql.startsWith('update contacts')) {
          return { rows: existingContactId ? [{ id: existingContactId }] : [] };
        }
        if (normalizedSql.startsWith('insert into contacts')) {
          return { rows: [{ id: 'contact-1' }] };
        }
        if (normalizedSql.startsWith('insert into leads')) {
          promoted = true;
          return { rows: [{ id: 'lead-1' }] };
        }
        if (normalizedSql.startsWith('insert into activity_events')) {
          return { rows: [] };
        }
        if (normalizedSql.startsWith('insert into notes')) {
          return { rows: [] };
        }
        if (normalizedSql.startsWith('insert into import_source_rows')) {
          return { rows: [{ id: 'source-row-3' }] };
        }
        if (normalizedSql.startsWith('insert into import_normalized_records')) {
          return { rows: [{ id: 'normalized-3' }] };
        }
        if (normalizedSql.startsWith('insert into import_review_items')) {
          return { rows: [] };
        }
        if (normalizedSql.startsWith('select id from contact_channel_consent_events')) {
          return { rows: [] };
        }
        if (normalizedSql.startsWith('insert into contact_channel_consents')) {
          return { rows: [{ id: 'sms-consent-1', consent_status: params[5] }] };
        }
        if (normalizedSql.startsWith('insert into contact_channel_consent_events')) {
          return { rows: [{ id: 'sms-consent-event-1' }] };
        }
        if (normalizedSql.startsWith('insert into notifications')) {
          return { rows: [{ id: 'notification-1' }] };
        }
        if (normalizedSql.startsWith('with intake_lock as')) {
          return { rows: [{ id: 'task-activity-1' }] };
        }
        if (normalizedSql.startsWith('update leads set original_notes')) {
          return { rows: [] };
        }

        throw new Error('Unexpected query: ' + normalizedSql);
      },
    },
  };
}

function createIdentityReviewClient({ emailRows, phoneRows }) {
  const calls = [];
  let reviewPersisted = false;
  return {
    calls,
    client: {
      async query(sql, params = []) {
        const normalizedSql = String(sql).replace(/\s+/g, ' ').trim();
        calls.push({ sql: normalizedSql, params });
        if (normalizedSql.startsWith('select pg_advisory_xact_lock')) return { rows: [] };
        if (normalizedSql.startsWith('select l.id as lead_id')) return { rows: [] };
        if (normalizedSql.startsWith('select 1 from import_normalized_records')) {
          return { rows: reviewPersisted ? [{ exists: 1 }] : [] };
        }
        if (normalizedSql.startsWith('select id from import_batches where organization_id')) return { rows: [{ id: 'batch-1' }] };
        if (normalizedSql === 'begin' || normalizedSql === 'commit' || normalizedSql === 'rollback') return { rows: [] };
        if (normalizedSql.startsWith('select id from import_batches where id = $1 for update')) return { rows: [{ id: 'batch-1' }] };
        if (normalizedSql.startsWith('select coalesce(max(source_row_number)')) return { rows: [{ max_row: 2 }] };
        if (normalizedSql.includes('lower(email)')) return { rows: emailRows };
        if (normalizedSql.includes('regexp_replace(coalesce(phone')) return { rows: phoneRows };
        if (normalizedSql.startsWith('insert into import_source_rows')) return { rows: [{ id: 'source-row-3' }] };
        if (normalizedSql.startsWith('insert into import_normalized_records')) return { rows: [{ id: 'normalized-3' }] };
        if (normalizedSql.startsWith('insert into import_review_items')) {
          reviewPersisted = true;
          return { rows: [] };
        }
        throw new Error('Unexpected query: ' + normalizedSql);
      },
    },
  };
}

function createExactContactMissingClient() {
  const calls = [];
  return {
    calls,
    client: {
      async query(sql, params = []) {
        const normalizedSql = String(sql).replace(/\s+/g, ' ').trim();
        calls.push({ sql: normalizedSql, params });
        if (normalizedSql.startsWith('select pg_advisory_xact_lock')) return { rows: [] };
        if (normalizedSql.startsWith('select l.id as lead_id')) return { rows: [] };
        if (normalizedSql.startsWith('select 1 from import_normalized_records')) return { rows: [] };
        if (normalizedSql.startsWith('select id from import_batches where organization_id')) return { rows: [{ id: 'batch-1' }] };
        if (normalizedSql === 'begin' || normalizedSql === 'commit' || normalizedSql === 'rollback') return { rows: [] };
        if (normalizedSql.startsWith('select id from import_batches where id = $1 for update')) return { rows: [{ id: 'batch-1' }] };
        if (normalizedSql.startsWith('select coalesce(max(source_row_number)')) return { rows: [{ max_row: 2 }] };
        if (normalizedSql.includes('lower(email)')) return { rows: [{ id: 'contact-exact' }] };
        if (normalizedSql.startsWith('update contacts')) return { rows: [] };
        if (normalizedSql.startsWith('insert into import_source_rows')) return { rows: [{ id: 'source-row-3' }] };
        if (normalizedSql.startsWith('insert into import_normalized_records')) return { rows: [{ id: 'normalized-3' }] };
        if (normalizedSql.startsWith('insert into import_review_items')) return { rows: [] };
        throw new Error('Unexpected query: ' + normalizedSql);
      },
    },
  };
}

function createBusinessUnitScopedWebsiteClient() {
  const calls = [];
  const batches = new Map();
  let contactCreated = false;
  let sourceRowCount = 0;
  const historicalNullBusinessUnitBatchId = 'historical-null-bu';
  return {
    calls,
    historicalNullBusinessUnitBatchId,
    client: {
      async query(sql, params = []) {
        const normalizedSql = String(sql).replace(/\s+/g, ' ').trim();
        calls.push({ sql: normalizedSql, params });
        if (normalizedSql.startsWith('select pg_advisory_xact_lock')) return { rows: [] };
        if (normalizedSql.startsWith('select l.id as lead_id')) return { rows: [] };
        if (normalizedSql.startsWith('select 1 from import_normalized_records')) return { rows: [] };
        if (normalizedSql.startsWith('select id from import_batches where organization_id')) {
          return { rows: batches.has(params[1]) ? [{ id: batches.get(params[1]) }] : [] };
        }
        if (normalizedSql.startsWith('insert into import_batches')) {
          const batchId = `batch-${params[1]}`;
          batches.set(params[1], batchId);
          return { rows: [{ id: batchId }] };
        }
        if (normalizedSql === 'begin' || normalizedSql === 'commit' || normalizedSql === 'rollback') return { rows: [] };
        if (normalizedSql.startsWith('select id from import_batches where id = $1 for update')) return { rows: [{ id: params[0] }] };
        if (normalizedSql.startsWith('select coalesce(max(source_row_number)')) return { rows: [{ max_row: 0 }] };
        if (normalizedSql.startsWith('select id from contacts where organization_id')) {
          return { rows: contactCreated ? [{ id: 'contact-shared' }] : [] };
        }
        if (normalizedSql.startsWith('insert into contacts')) {
          contactCreated = true;
          return { rows: [{ id: 'contact-shared' }] };
        }
        if (normalizedSql.startsWith('update contacts')) return { rows: [{ id: 'contact-shared' }] };
        if (normalizedSql.startsWith('select u.id, u.name, u.email from users u')) return { rows: [] };
        if (normalizedSql.startsWith('select id, name, email from users')) return { rows: [] };
        if (normalizedSql.startsWith('insert into leads')) return { rows: [{ id: `lead-${params[1]}` }] };
        if (normalizedSql.startsWith('insert into activity_events')) return { rows: [] };
        if (normalizedSql.startsWith('insert into notes')) return { rows: [] };
        if (normalizedSql.startsWith('insert into import_source_rows')) return { rows: [{ id: `source-row-${++sourceRowCount}` }] };
        if (normalizedSql.startsWith('insert into import_normalized_records')) return { rows: [{ id: `normalized-${sourceRowCount}` }] };
        if (normalizedSql.startsWith('insert into import_review_items')) return { rows: [] };
        if (normalizedSql.startsWith('insert into notifications')) return { rows: [{ id: 'notification-1' }] };
        if (normalizedSql.startsWith('with intake_lock as')) return { rows: [{ id: 'task-1' }] };
        if (normalizedSql.startsWith('update leads set original_notes')) return { rows: [] };
        throw new Error('Unexpected query: ' + normalizedSql);
      },
    },
  };
}
