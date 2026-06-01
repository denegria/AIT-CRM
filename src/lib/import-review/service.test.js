import test from 'node:test';
import assert from 'node:assert/strict';
import { loadImportReviewRows, updateImportReviewStatus } from './service.js';

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
}

function createClient({ batchSourceType = 'facebook_messenger', batchBusinessUnitId = 'bu-1' } = {}) {
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

        if (normalized.startsWith('select ib.id, ib.source_name, ib.source_type')) {
          return {
            rows: [{
              id: params[0],
              source_name: 'Import Review Test',
              source_type: batchSourceType,
              file_name: 'test.xlsx',
              file_hash: 'hash-1',
              sheet_name: null,
              status: 'loaded',
              business_unit_id: batchBusinessUnitId,
              business_unit_name: batchBusinessUnitId ? 'AIT Signs' : null,
              created_at: new Date('2026-05-30T00:00:00.000Z'),
            }],
          };
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

test('import review search matches proposed JSON and lists leads before follow-up activity', async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);
      calls.push({ sql: normalized, params });

      if (normalized.startsWith('select count(*)::int as count')) {
        return { rows: [{ count: 1 }] };
      }

      if (normalized.startsWith('select nr.id, nr.record_type')) {
        return {
          rows: [{
            id: 'record-1',
            record_type: 'lead',
            status: 'pending',
            confidence_score: '0.90',
            proposed_contact_json: { name: 'CARLOS SAULES', nameAliases: ['CARLOS SAULES', 'CARLOS'] },
            proposed_lead_json: { contactHint: 'CARLOS SAULES' },
            proposed_estimate_json: null,
            proposed_work_order_json: null,
            proposed_payment_json: null,
            proposed_note_json: null,
            business_unit_id: 'bu-1',
            business_unit_name: 'AIT USA',
            source_row_id: 'source-row-1',
            source_sheet: '2025',
            source_row_number: 353,
            raw_text: 'CARLOS',
            parse_status: 'parsed',
            created_at: new Date('2026-06-01T00:00:00.000Z'),
          }],
        };
      }

      if (normalized.startsWith('select source_row_id, review_type')) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${normalized}`);
    },
  };

  const result = await loadImportReviewRows(client, 'batch-1', { q: 'Saul', limit: 20, offset: 40 });
  const countQuery = calls[0].sql;
  const searchQuery = calls[1].sql;

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].confidenceScore, 0.9);
  assert.equal(result.pagination.totalCount, 1);
  assert.equal(result.pagination.offset, 40);
  assert.deepEqual(calls[0].params, ['batch-1', '(^|[^[:alnum:]])Saul']);
  assert.deepEqual(calls[1].params, ['batch-1', '(^|[^[:alnum:]])Saul', 20, 40]);
  assert.match(countQuery, /select count\(\*\)::int as count/);
  assert.match(searchQuery, /proposed_contact_json::text/);
  assert.match(searchQuery, /proposed_lead_json::text/);
  assert.match(searchQuery, /proposed_note_json::text, ''\) ~\* \$2/);
  assert.match(searchQuery, /when 'lead' then 0/);
  assert.match(searchQuery, /when 'activity_event' then 6/);
  assert.match(searchQuery, /confidence_score, 0\)::numeric desc/);
  assert.match(searchQuery, /limit \$3/);
  assert.match(searchQuery, /offset \$4/);
});

test('import review can filter by quality disposition and flag buckets', async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);
      calls.push({ sql: normalized, params });

      if (normalized.startsWith('select count(*)::int as count')) {
        return { rows: [{ count: 0 }] };
      }

      if (normalized.startsWith('select nr.id, nr.record_type')) {
        return { rows: [] };
      }

      if (normalized.startsWith('select source_row_id, review_type')) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${normalized}`);
    },
  };

  await loadImportReviewRows(client, 'batch-1', { quality: 'ready_for_follow_up', limit: 20 });
  assert.match(calls[1].sql, /qualitydisposition' = \$2/);
  assert.deepEqual(calls[0].params, ['batch-1', 'ready_for_follow_up']);
  assert.deepEqual(calls[1].params, ['batch-1', 'ready_for_follow_up', 20, 0]);

  calls.length = 0;
  await loadImportReviewRows(client, 'batch-1', { quality: 'dead_contact', limit: 20 });
  assert.match(calls[1].sql, /jsonb_array_elements/);
  assert.match(calls[1].sql, /quality_flag->>'code' = any\(\$2::text\[\]\)/);
  assert.deepEqual(calls[0].params, ['batch-1', ['wrong_number', 'disconnected', 'do_not_contact', 'not_current']]);
  assert.deepEqual(calls[1].params, ['batch-1', ['wrong_number', 'disconnected', 'do_not_contact', 'not_current'], 20, 0]);
});

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

test('operator workbook approvals require a business unit on the batch', async () => {
  const { client, calls } = createClient({ batchSourceType: 'xlsx', batchBusinessUnitId: null });

  await assert.rejects(
    updateImportReviewStatus(client, {
      batchId: 'batch-1',
      status: 'approved',
      recordIds: ['record-1'],
    }),
    /Import batch must have a business unit before approval\./,
  );

  assert.equal(calls.some((call) => call.sql === 'begin'), true);
  assert.equal(calls.some((call) => call.sql === 'rollback'), true);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), false);
});
