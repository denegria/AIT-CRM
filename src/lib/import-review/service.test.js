import test from 'node:test';
import assert from 'node:assert/strict';
import { updateImportReviewStatus } from './service.js';

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
}

function createClient() {
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

        if (normalized.startsWith('select id from import_batches where id = $1 and organization_id = $2')) {
          return { rows: params[1] === 'org-1' ? [{ id: params[0] }] : [] };
        }

        if (normalized.startsWith('select nr.id, nr.source_row_id')) {
          return {
            rows: [{
              id: 'record-1',
              source_row_id: 'source-row-1',
              source_row_number: 12,
              organization_id: 'org-1',
              record_type: 'lead',
              proposed_contact_json: {
                name: 'Ada Lovelace',
                email: 'ada@example.com',
                phone: '555-0100',
                company_name: 'Analytical Signs',
                address: '123 Loop St',
                source_label: 'Facebook Ads',
                business_unit_id: 'bu-1',
                contact_id: null,
              },
              proposed_lead_json: {
                source_type: 'facebook_webhook',
                source_name: 'Facebook Ads',
                leadgen_id: 'leadgen-1',
                form_id: 'form-1',
                business_unit_id: 'bu-1',
                contact_id: null,
                lead_id: null,
                assigned_user_id: null,
              },
            }],
          };
        }

        if (normalized.startsWith('update import_normalized_records set status = $1')) {
          return { rows: [{ id: 'record-1', record_type: 'lead', status: params[0] }] };
        }

        if (normalized.startsWith('update import_review_items')) {
          return { rows: [], rowCount: 1 };
        }

        if (normalized.startsWith('select u.id, u.name, u.email from users u')) {
          return { rows: [{ id: 'owner-1', name: 'Owner One', email: 'owner@example.com' }] };
        }

        if (
          normalized.startsWith('select id, primary_business_unit_id from contacts')
          && normalized.includes('lower(email) = lower($2)')
        ) {
          return { rows: [] };
        }

        if (
          normalized.startsWith('select id, primary_business_unit_id from contacts')
          && normalized.includes('phone = $2')
        ) {
          return { rows: [] };
        }

        if (normalized.startsWith('insert into contacts')) {
          return { rows: [{ id: 'contact-1' }] };
        }

        if (normalized.startsWith('insert into leads')) {
          return { rows: [{ id: 'lead-1' }] };
        }

        if (normalized.startsWith('insert into activity_events')) {
          return { rows: [] };
        }

        if (normalized.startsWith('update import_normalized_records set proposed_contact_json')) {
          return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected query: ${normalized}`);
      },
    },
  };
}

test('approving staged Facebook leads promotes them into CRM records', async () => {
  const { client, calls } = createClient();

  const result = await updateImportReviewStatus(client, {
    batchId: 'batch-1',
    status: 'approved',
    recordIds: ['record-1'],
  });

  assert.deepEqual(result.promotedRecords, [{
    id: 'record-1',
    sourceRowId: 'source-row-1',
    contactId: 'contact-1',
    leadId: 'lead-1',
  }]);

  const contactInsert = calls.find((call) => call.sql.startsWith('insert into contacts'));
  assert.deepEqual(contactInsert.params, [
    'org-1',
    'bu-1',
    'Ada Lovelace',
    'Analytical Signs',
    '555-0100',
    'ada@example.com',
    '123 Loop St',
  ]);

  const leadInsert = calls.find((call) => call.sql.startsWith('insert into leads'));
  assert.deepEqual(leadInsert.params, [
    'org-1',
    'bu-1',
    'contact-1',
    'Facebook leadgen_id=leadgen-1 source_row_id=source-row-1',
    'owner-1',
  ]);

  const promotionUpdate = calls.find((call) => (
    call.sql.startsWith('update import_normalized_records set proposed_contact_json')
  ));
  assert.equal(JSON.parse(promotionUpdate.params[2]).contact_id, 'contact-1');
  assert.equal(JSON.parse(promotionUpdate.params[3]).lead_id, 'lead-1');
});


test('organization-scoped approvals constrain batch and staged record lookups', async () => {
  const { client, calls } = createClient();

  await updateImportReviewStatus(client, {
    batchId: 'batch-1',
    status: 'approved',
    recordIds: ['record-1'],
    organizationId: 'org-1',
  });

  const scopedBatch = calls.find((call) => (
    call.sql.startsWith('select id from import_batches where id = $1 and organization_id = $2')
  ));
  assert.deepEqual(scopedBatch.params, ['batch-1', 'org-1']);

  const scopedRecordLookup = calls.find((call) => (
    call.sql.startsWith('select nr.id, nr.source_row_id')
  ));
  assert.match(scopedRecordLookup.sql, /ib\.organization_id = \$3/);
  assert.deepEqual(scopedRecordLookup.params, ['batch-1', ['record-1'], 'org-1']);
});

test('organization-scoped approvals reject batches outside the caller organization', async () => {
  const { client, calls } = createClient();

  await assert.rejects(
    updateImportReviewStatus(client, {
      batchId: 'batch-1',
      status: 'approved',
      recordIds: ['record-1'],
      organizationId: 'org-2',
    }),
    /No import batch found\./,
  );

  assert.equal(calls.some((call) => call.sql === 'begin'), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), false);
});
