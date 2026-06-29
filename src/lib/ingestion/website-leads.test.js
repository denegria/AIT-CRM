import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectWebsiteLeadSubmittedSecrets,
  ingestWebsiteLeadSubmission,
  normalizeWebsiteLeadSubmission,
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

  const taskInsert = calls.find((call) => call.sql.startsWith('with new_task as'));
  assert.ok(taskInsert);
  assert.equal(taskInsert.params[6], 'follow_up');
  assert.equal(taskInsert.params[8], 'high');
  assert.equal(taskInsert.params[9], 'automation');
  assert.equal(taskInsert.params[10], 'website:web-001');
  assert.equal(taskInsert.params[11], 'New lead follow-up');
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

  const taskInsert = calls.find((call) => call.sql.startsWith('with new_task as'));
  const taskMetadata = JSON.parse(taskInsert.params[12]);
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

function createWebsitePromotionClient() {
  const calls = [];
  return {
    calls,
    client: {
      async query(sql, params = []) {
        const normalizedSql = String(sql).replace(/\s+/g, ' ').trim();
        calls.push({ sql: normalizedSql, params });

        if (normalizedSql.startsWith('select l.id as lead_id')) {
          return { rows: [] };
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
          return { rows: [{ max_row: 2 }] };
        }
        if (normalizedSql.startsWith('select u.id, u.name, u.email from users u')) {
          return { rows: [] };
        }
        if (normalizedSql.startsWith('select id, name, email from users')) {
          return { rows: [] };
        }
        if (normalizedSql.startsWith('select id from contacts where organization_id')) {
          return { rows: [] };
        }
        if (normalizedSql.startsWith('insert into contacts')) {
          return { rows: [{ id: 'contact-1' }] };
        }
        if (normalizedSql.startsWith('insert into leads')) {
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
        if (normalizedSql.startsWith('with new_task as')) {
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
