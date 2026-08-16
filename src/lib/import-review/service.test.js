import test from 'node:test';
import assert from 'node:assert/strict';
import { loadImportReviewDecisionRows, loadImportReviewRows, updateImportReviewStatus } from './service.js';

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
}

function createClient({
  batchSourceType = 'facebook_messenger',
  batchBusinessUnitId = 'bu-1',
  recordStatus = 'pending',
  recordLeadId = null,
  claimWins = true,
  crmLeadId = 'lead-1',
  failureStage = null,
} = {}) {
  const calls = [];
  let failureRaised = false;
  const maybeFail = (stage) => {
    if (failureStage === stage && !failureRaised) {
      failureRaised = true;
      throw new Error(`simulated ${stage} failure`);
    }
  };

  return {
    calls,
    client: {
      async query(sql, params = []) {
        const normalized = normalizeSql(sql);
        calls.push({ sql: normalized, params });

        if (
          normalized === 'begin'
          || normalized === 'commit'
          || normalized === 'rollback'
          || normalized.startsWith('savepoint ')
          || normalized.startsWith('rollback to savepoint ')
        ) {
          return { rows: [] };
        }

        if (
          normalized.startsWith('select pg_advisory_xact_lock')
        ) {
          return { rows: [{ pg_advisory_xact_lock: true }] };
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
              batch_business_unit_id: batchBusinessUnitId,
              record_type: 'lead',
              status: recordStatus,
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
                lead_id: recordLeadId,
                assigned_user_id: null,
              },
            }],
          };
        }

        if (normalized.startsWith('select bu.id from business_units bu')) {
          return { rows: params[2] === 'bu-2' ? [] : [{ id: 'bu-1' }] };
        }

        if (normalized.startsWith('select id, name from business_units')) {
          return { rows: params[1] === 'bu-2' ? [] : [{ id: 'bu-1', name: 'AIT Signs' }] };
        }

        if (normalized.startsWith('update import_normalized_records set status = $1')) {
          return { rows: [{ id: 'record-1', record_type: 'lead', status: params[0] }] };
        }

        if (normalized.startsWith("update import_normalized_records nr set status = 'promoting'")) {
          if (!claimWins) return { rows: [], rowCount: 0 };
          return {
            rowCount: 1,
            rows: [{
              id: 'record-1',
              source_row_id: 'source-row-1',
              source_row_number: 12,
              organization_id: 'org-1',
              record_type: 'lead',
              status: 'promoting',
              claim_token: params[3],
              proposed_contact_json: {
                name: 'Ada Lovelace',
                email: 'ada@example.com',
                phone: '555-0100',
                company_name: 'Analytical Signs',
                address: '123 Loop St',
                business_unit_id: 'bu-1',
              },
              proposed_lead_json: {
                source_type: 'facebook_webhook',
                leadgen_id: 'leadgen-1',
                form_id: 'form-1',
                business_unit_id: 'bu-1',
                lead_id: recordLeadId,
              },
            }],
          };
        }

        if (normalized.startsWith('update import_review_items iri set')) {
          return { rows: [{ id: 'review-item-1', source_row_id: 'source-row-1' }], rowCount: 1 };
        }

        if (normalized.startsWith('update import_review_items')) {
          return { rows: [], rowCount: 1 };
        }

        if (normalized.startsWith('select u.id, u.name, u.email,')) {
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

        if (
          normalized.startsWith('select id, contact_id, assigned_user_id from leads')
          || normalized.startsWith('select l.id, l.contact_id as linked_contact_id')
        ) {
          return { rows: [] };
        }

        if (normalized.startsWith('insert into contacts')) {
          maybeFail('contact');
          return { rows: [{ id: 'contact-1' }] };
        }

        if (normalized.startsWith('insert into leads')) {
          maybeFail('lead');
          return { rows: [{ id: crmLeadId }] };
        }

        if (normalized.startsWith('insert into activity_events')) {
          if (params[4] === 'lead.assigned') maybeFail('assignment');
          if (normalized.includes("'facebook_lead_captured'")) maybeFail('capture_activity');
          return { rows: [] };
        }

        if (normalized.startsWith('insert into notifications')) {
          maybeFail('notification');
          return { rows: [{ id: 'notification-1' }] };
        }

        if (normalized.startsWith('with intake_lock as')) {
          maybeFail('intake_task');
          return { rows: [{ id: 'task-activity-1' }] };
        }

        if (normalized.startsWith('update leads set')) {
          return { rows: [{ id: 'lead-1' }], rowCount: 1 };
        }

        if (normalized.startsWith('update import_normalized_records set proposed_contact_json')) {
          return { rows: [], rowCount: 1 };
        }

        if (normalized.startsWith('update import_normalized_records set proposed_lead_json')) {
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
  assert.deepEqual(calls[0].params, ['batch-1', ['wrong_number', 'disconnected', 'do_not_contact', 'not_current', 'repeated_no_answer']]);
  assert.deepEqual(calls[1].params, ['batch-1', ['wrong_number', 'disconnected', 'do_not_contact', 'not_current', 'repeated_no_answer'], 20, 0]);
});

test('import review decision rows use review items as source-row decisions', async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);
      calls.push({ sql: normalized, params });

      if (normalized.startsWith('select count(*)::int as count from import_review_items')) {
        return { rows: [{ count: 1 }] };
      }

      if (normalized.startsWith('select iri.id, iri.source_row_id')) {
        return {
          rows: [{
            id: 'review-item-1',
            source_row_id: 'source-row-1',
            review_type: 'misc_text',
            reason: 'No exact CRM target found.',
            review_status: 'pending',
            proposed_resolution_json: {
              sourceClientNames: ['MARIA JOSE'],
              roughMatchBucket: 'no_rough_match',
            },
            created_at: new Date('2026-06-09T00:00:00.000Z'),
            business_unit_id: 'bu-1',
            business_unit_name: 'AIT Signs',
            source_sheet: '1. INTERESADOS',
            source_row_number: 55,
            raw_text: 'MARIA JOSE | 908 255 8983',
            parse_status: 'needs_review',
            normalized_evidence_json: [{ id: 'record-1', recordType: 'lead', status: 'imported', confidenceScore: '0.70' }],
          }],
        };
      }

      throw new Error(`Unexpected query: ${normalized}`);
    },
  };

  const result = await loadImportReviewDecisionRows(client, 'batch-1', { q: 'Maria', limit: 20, offset: 0 });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].id, 'review-item-1');
  assert.equal(result.rows[0].isDecisionRow, true);
  assert.equal(result.rows[0].decisionReason, 'No exact CRM target found.');
  assert.deepEqual(result.rows[0].normalizedEvidence, [{ id: 'record-1', recordType: 'lead', status: 'imported', confidenceScore: '0.70' }]);
  assert.equal(result.pagination.totalCount, 1);
  assert.match(calls[0].sql, /from import_review_items iri/);
  assert.match(calls[0].sql, /join import_batches ib/);
  assert.match(calls[0].sql, /join import_source_rows sr/);
  assert.match(calls[1].sql, /left join import_normalized_records nr/);
  assert.deepEqual(calls[0].params, [
    'batch-1',
    'pending',
    '(^|[^[:alnum:]])Maria',
    ['1. INTERESADOS', 'WORK ORDER TERMINADOS Y PAGADOS'],
    ['misc_text', 'note'],
  ]);
  assert.deepEqual(calls[1].params, [
    'batch-1',
    'pending',
    '(^|[^[:alnum:]])Maria',
    ['1. INTERESADOS', 'WORK ORDER TERMINADOS Y PAGADOS'],
    ['misc_text', 'note'],
    20,
    0,
  ]);
});

test('review-item decisions update only import review items', async () => {
  const { client, calls } = createClient();

  const result = await updateImportReviewStatus(client, {
    batchId: 'batch-1',
    status: 'rejected',
    reviewItemIds: ['review-item-1'],
    organizationId: 'org-1',
  });

  assert.deepEqual(result.updatedReviewItemIds, ['review-item-1']);
  assert.deepEqual(result.sourceRowIds, ['source-row-1']);
  assert.equal(result.updatedReviewItems, 1);
  assert.equal(calls.some((call) => call.sql.startsWith('select nr.id, nr.source_row_id')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('update import_normalized_records set status = $1')), false);
  const reviewUpdate = calls.find((call) => call.sql.startsWith('update import_review_items iri set'));
  assert.match(reviewUpdate.sql, /iri.id = any\(\$3::uuid\[\]\)/);
  assert.match(reviewUpdate.sql, /ib.organization_id = \$5/);
  assert.deepEqual(reviewUpdate.params, ['rejected', 'batch-1', ['review-item-1'], null, 'org-1']);
});

test('review-item decisions cannot be marked approved without a CRM action', async () => {
  const { client, calls } = createClient();

  await assert.rejects(
    () => updateImportReviewStatus(client, {
      batchId: 'batch-1',
      status: 'approved',
      reviewItemIds: ['review-item-1'],
      organizationId: 'org-1',
    }),
    /cannot be marked approved without an explicit CRM attach, create, or promotion action/,
  );

  assert.equal(calls.length, 0);
});

test('review-item decisions persist explicit operator action metadata', async () => {
  const { client, calls } = createClient();

  await updateImportReviewStatus(client, {
    batchId: 'batch-1',
    status: 'needs_review',
    reviewItemIds: ['review-item-1'],
    operatorDecisionAction: 'hold_for_future_action',
    organizationId: 'org-1',
  });

  const reviewUpdate = calls.find((call) => call.sql.startsWith('update import_review_items iri set'));
  const metadata = JSON.parse(reviewUpdate.params[3]);
  assert.deepEqual(metadata.operatorDecision.action, 'hold_for_future_action');
  assert.deepEqual(metadata.operatorDecision.status, 'needs_review');
  assert.match(metadata.operatorDecision.recordedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(calls.some((call) => call.sql.startsWith('update import_normalized_records set status = $1')), false);
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
  assert.deepEqual(leadInsert.params.slice(0, 5), [
    'org-1',
    'bu-1',
    'contact-1',
    'Facebook leadgen_id=leadgen-1 source_row_id=source-row-1',
    'owner-1',
  ]);
  assert.equal(leadInsert.params.at(-1), 'Facebook Ads');

  const promotionUpdate = calls.find((call) => (
    call.sql.startsWith('update import_normalized_records set proposed_contact_json')
  ));
  assert.equal(JSON.parse(promotionUpdate.params[2]).contact_id, 'contact-1');
  assert.equal(JSON.parse(promotionUpdate.params[3]).lead_id, 'lead-1');
});

test('a concurrent approval that loses the claim does not write CRM records', async () => {
  const { client, calls } = createClient({ claimWins: false });

  const result = await updateImportReviewStatus(client, {
    batchId: 'batch-1',
    status: 'approved',
    recordIds: ['record-1'],
  });

  assert.deepEqual(result.promotedRecords, []);
  assert.deepEqual(result.promotionFailures, []);
  assert.equal(result.promotionOutcomes[0].outcome, 'already_claimed');
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), false);
});

test('a retry after promotion success returns already-promoted without another CRM write', async () => {
  const { client, calls } = createClient({ recordStatus: 'promoted', recordLeadId: 'lead-1' });

  const result = await updateImportReviewStatus(client, {
    batchId: 'batch-1',
    status: 'approved',
    recordIds: ['record-1'],
  });

  assert.equal(result.promotionOutcomes[0].outcome, 'already_promoted');
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), false);
});

test('promotion failure rolls the claimed row back to recoverable needs_review', async () => {
  const { client, calls } = createClient({ crmLeadId: null });

  const result = await updateImportReviewStatus(client, {
    batchId: 'batch-1',
    status: 'approved',
    recordIds: ['record-1'],
  });

  assert.equal(result.promotionFailures.length, 1);
  assert.equal(result.promotionFailures[0].outcome, 'promotion_failed');
  assert.equal(result.promotionFailures[0].reason, 'CRM promotion returned no lead id.');
  const recoveryUpdate = calls.find((call) => call.sql.startsWith('update import_normalized_records set proposed_lead_json'));
  assert.ok(recoveryUpdate);
  assert.equal(recoveryUpdate.params[0], 'batch-1');
  assert.equal(calls.some((call) => call.sql.includes("status = 'needs_review'")), true);
});

test('stale non-reviewable status is not overwritten by an approval retry', async () => {
  const { client, calls } = createClient({ recordStatus: 'rejected' });

  const result = await updateImportReviewStatus(client, {
    batchId: 'batch-1',
    status: 'approved',
    recordIds: ['record-1'],
  });

  assert.equal(result.promotionOutcomes[0].outcome, 'stale_status');
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), false);
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

function createTwoClientPromotionHarness({ initialStatus = 'pending' } = {}) {
  const state = {
    status: initialStatus,
    contactId: null,
    leadId: null,
    leadCreates: 0,
    blockedClients: 0,
    owner: null,
    firstLockAcquired: null,
    firstLockResolve: null,
    firstReleaseResolve: null,
    blockedResolve: null,
  };
  state.firstLockAcquired = new Promise((resolve) => { state.firstLockResolve = resolve; });
  state.firstRelease = new Promise((resolve) => { state.firstReleaseResolve = resolve; });
  state.blocked = new Promise((resolve) => { state.blockedResolve = resolve; });

  const record = () => ({
    id: 'record-1',
    source_row_id: 'source-row-1',
    source_row_number: 12,
    organization_id: 'org-1',
    batch_business_unit_id: 'bu-1',
    record_type: 'lead',
    status: state.status,
    proposed_contact_json: {
      name: 'Ada Lovelace', email: 'ada@example.com', phone: '555-0100', business_unit_id: 'bu-1',
    },
    proposed_lead_json: {
      source_type: 'facebook_webhook', leadgen_id: 'leadgen-1', form_id: 'form-1',
      business_unit_id: 'bu-1', contact_id: state.contactId, lead_id: state.leadId, assigned_user_id: null,
    },
  });

  function clientFor(clientId, { holdFirstLock = false } = {}) {
    const calls = [];
    let transactionSnapshot = null;
    let savepointSnapshot = null;
    const snapshot = () => ({
      status: state.status,
      contactId: state.contactId,
      leadId: state.leadId,
      leadCreates: state.leadCreates,
    });
    const restore = (stored) => {
      if (!stored) return;
      state.status = stored.status;
      state.contactId = stored.contactId;
      state.leadId = stored.leadId;
      state.leadCreates = stored.leadCreates;
    };
    const releaseTransactionLock = () => {
      if (state.owner === clientId) state.owner = null;
    };
    return {
      calls,
      client: {
        async query(sql, params = []) {
          const normalized = normalizeSql(sql);
          calls.push({ sql: normalized, params });
          if (normalized === 'begin') {
            transactionSnapshot = snapshot();
            savepointSnapshot = null;
            return { rows: [] };
          }
          if (normalized.startsWith('savepoint ')) {
            savepointSnapshot = snapshot();
            return { rows: [] };
          }
          if (normalized.startsWith('rollback to savepoint ')) {
            restore(savepointSnapshot);
            return { rows: [] };
          }
          if (normalized === 'commit') {
            transactionSnapshot = null;
            savepointSnapshot = null;
            releaseTransactionLock();
            return { rows: [] };
          }
          if (normalized === 'rollback') {
            restore(transactionSnapshot);
            transactionSnapshot = null;
            savepointSnapshot = null;
            releaseTransactionLock();
            return { rows: [] };
          }
          if (normalized.startsWith('select pg_advisory_xact_lock')) {
            if (!state.owner) {
              state.owner = clientId;
              if (clientId === 'client-1') {
                state.firstLockResolve();
                if (holdFirstLock) await state.firstRelease;
              }
              return { rows: [] };
            }
            state.blockedClients += 1;
            state.blockedResolve();
            await new Promise((resolve) => {
              const check = () => {
                if (!state.owner) resolve();
                else setTimeout(check, 0);
              };
              check();
            });
            state.owner = clientId;
            return { rows: [] };
          }
          if (normalized.startsWith('select ib.id, ib.source_name, ib.source_type')) {
            return { rows: [{
              id: params[0], source_name: 'Import Review Test', source_type: 'facebook_messenger',
              file_name: 'test.xlsx', file_hash: 'hash-1', sheet_name: null, status: 'loaded',
              business_unit_id: 'bu-1', business_unit_name: 'AIT Signs', created_at: new Date(),
            }] };
          }
          if (normalized.startsWith('select nr.id, nr.source_row_id')) return { rows: [record()] };
          if (normalized.startsWith('select bu.id from business_units bu')) return { rows: [{ id: 'bu-1' }] };
          if (normalized.startsWith('select id, name from business_units')) {
            return { rows: [{ id: 'bu-1', name: 'AIT Signs' }] };
          }
          if (normalized.startsWith("update import_normalized_records nr set status = 'promoting'")) {
            if (!['pending', 'needs_review', 'promoting'].includes(state.status)) return { rows: [], rowCount: 0 };
            state.status = 'promoting';
            return { rows: [{ ...record(), status: 'promoting', claim_token: params[3] }], rowCount: 1 };
          }
          if (normalized.startsWith('update import_review_items')) return { rows: [], rowCount: 1 };
          if (normalized.startsWith('select u.id, u.name, u.email,')) return { rows: [{ id: 'owner-1', name: 'Owner', email: 'owner@example.com' }] };
          if (normalized.startsWith('select id, primary_business_unit_id from contacts')) return { rows: state.contactId ? [{ id: state.contactId, primary_business_unit_id: 'bu-1' }] : [] };
          if (
            normalized.startsWith('select id, contact_id, assigned_user_id from leads')
            || normalized.startsWith('select l.id, l.contact_id as linked_contact_id')
          ) {
            return { rows: state.leadId ? [{ id: state.leadId, contact_id: state.contactId, assigned_user_id: 'owner-1' }] : [] };
          }
          if (normalized.startsWith('insert into contacts')) {
            state.contactId = 'contact-1';
            return { rows: [{ id: state.contactId }] };
          }
          if (normalized.startsWith('insert into leads')) {
            state.leadCreates += 1;
            state.leadId = 'lead-1';
            return { rows: [{ id: state.leadId }] };
          }
          if (normalized.startsWith('update contacts')) return { rows: [] };
          if (normalized.startsWith('update leads')) return { rows: [{ id: state.leadId }], rowCount: 1 };
          if (normalized.startsWith('insert into activity_events')) return { rows: [] };
          if (normalized.startsWith('insert into notifications')) return { rows: [{ id: 'notification-1' }] };
          if (normalized.startsWith('with intake_lock as')) return { rows: [{ id: 'task-1' }] };
          if (normalized.startsWith('update import_normalized_records set proposed_contact_json')) {
            state.status = 'promoted';
            return { rows: [], rowCount: 1 };
          }
          if (normalized.startsWith('update import_normalized_records set proposed_lead_json')) {
            state.status = 'needs_review';
            return { rows: [], rowCount: 1 };
          }
          throw new Error(`Unexpected harness query: ${normalized}`);
        },
      },
    };
  }

  return { state, firstClient: clientFor('client-1', { holdFirstLock: true }), secondClient: clientFor('client-2') };
}

test('two approval clients block on the transaction lock and converge with one CRM lead', async () => {
  const harness = createTwoClientPromotionHarness();
  const request = { batchId: 'batch-1', status: 'approved', recordIds: ['record-1'] };
  const first = updateImportReviewStatus(harness.firstClient.client, request);
  await harness.state.firstLockAcquired;
  const second = updateImportReviewStatus(harness.secondClient.client, request);
  await harness.state.blocked;
  assert.equal(harness.state.blockedClients, 1);
  harness.state.firstReleaseResolve();

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(harness.state.leadCreates, 1);
  assert.equal(harness.state.status, 'promoted');
  assert.deepEqual(
    [firstResult.promotionOutcomes[0].outcome, secondResult.promotionOutcomes[0].outcome].sort(),
    ['already_promoted', 'promoted'],
  );
});

test('a crash before the atomic promotion commit rolls back and retries without a duplicate lead', async () => {
  const harness = createTwoClientPromotionHarness();
  harness.state.firstReleaseResolve();
  await assert.rejects(
    updateImportReviewStatus(harness.firstClient.client, {
      batchId: 'batch-1', status: 'approved', recordIds: ['record-1'],
      afterCrmCommit: async () => { throw new Error('simulated process crash before promotion commit'); },
    }),
    /simulated process crash before promotion commit/,
  );
  assert.equal(harness.state.status, 'pending');
  assert.equal(harness.state.leadCreates, 0);

  const retry = await updateImportReviewStatus(harness.secondClient.client, {
    batchId: 'batch-1', status: 'approved', recordIds: ['record-1'],
  });
  assert.equal(harness.state.status, 'promoted');
  assert.equal(harness.state.leadCreates, 1);
  assert.equal(retry.promotionOutcomes[0].outcome, 'promoted');
});

test('promotion rolls back the CRM transaction after every CRM side-effect stage', async () => {
  for (const failureStage of ['contact', 'lead', 'assignment', 'capture_activity', 'notification', 'intake_task']) {
    const { client, calls } = createClient({ failureStage });
    const result = await updateImportReviewStatus(client, {
      batchId: 'batch-1', status: 'approved', recordIds: ['record-1'],
    });
    assert.equal(result.promotionFailures[0].outcome, 'promotion_failed', failureStage);
    const failedStageIndex = calls.findIndex((call) => (
      (failureStage === 'contact' && call.sql.startsWith('insert into contacts'))
      || (failureStage === 'lead' && call.sql.startsWith('insert into leads'))
      || (failureStage === 'assignment' && call.params[4] === 'lead.assigned')
      || (failureStage === 'capture_activity' && call.sql.includes("'facebook_lead_captured'"))
      || (failureStage === 'notification' && call.sql.startsWith('insert into notifications'))
      || (failureStage === 'intake_task' && call.sql.startsWith('with intake_lock as'))
    ));
    const rollbackIndex = calls.findIndex((call, index) => (
      index > failedStageIndex && call.sql === 'rollback to savepoint import_review_crm_write'
    ));
    assert.ok(failedStageIndex >= 0, failureStage);
    assert.ok(rollbackIndex > failedStageIndex, failureStage);
  }
});

test('business-unit mismatch fails closed before any CRM mutation', async () => {
  const { client, calls } = createClient({ batchBusinessUnitId: 'bu-2' });
  const result = await updateImportReviewStatus(client, {
    batchId: 'batch-1', status: 'approved', recordIds: ['record-1'],
  });
  assert.equal(result.promotionFailures[0].outcome, 'promotion_failed');
  assert.match(result.promotionFailures[0].reason, /not active, allowed, or in the import batch scope/);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), false);
});
