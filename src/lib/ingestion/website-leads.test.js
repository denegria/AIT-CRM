import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectWebsiteLeadSubmittedSecrets,
  ingestWebsiteLeadSubmission,
  normalizeWebsiteLeadSubmission,
  sanitizeWebhookBodyForAudit,
  verifyWebsiteLeadSecret,
} from './website-leads.js';

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
