import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FACEBOOK_LEAD_ADS_SOURCE_SHEET,
  facebookLeadgenEventKey,
  ingestFacebookLeadAdsEvents,
} from './facebook-lead-ads.js';
import {
  createMetaProviderConfig,
  flattenMetaLeadgenChanges,
} from '../messaging/providers/meta.js';

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
}

function leadgenFixture(overrides = {}) {
  const payload = {
    object: 'page',
    entry: [
      {
        id: overrides.entryId || 'page-1',
        time: 1779275460,
        changes: [
          {
            field: 'leadgen',
            value: {
              leadgen_id: 'leadgen-1',
              page_id: 'page-1',
              form_id: 'form-1',
              ad_id: 'ad-1',
              created_time: 1779275460,
              ...overrides.value,
            },
          },
        ],
      },
    ],
  };

  return flattenMetaLeadgenChanges(payload)[0];
}

function createServiceClient({
  duplicateLeadgen = false,
  businessUnitId = 'bu-1',
  contactId = 'contact-1',
  leadId = 'lead-1',
  sourceRowId = 'source-row-5',
  normalizedId = 'normalized-5',
} = {}) {
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
        if (normalized.startsWith('select pg_advisory_xact_lock')) {
          return { rows: [] };
        }
        if (normalized.startsWith('select id from import_batches where id = $1 for update')) {
          return { rows: [{ id: params[0] }] };
        }
        if (normalized.startsWith('select coalesce(max(source_row_number)')) {
          return { rows: [{ max_row: 4 }] };
        }
        if (normalized.startsWith('select 1 from import_normalized_records')) {
          return { rows: duplicateLeadgen ? [{ exists: 1 }] : [] };
        }
        if (
          normalized.startsWith('select id from business_units')
          && normalized.includes('(id::text = $2 or lower(name) = lower($2))')
        ) {
          return { rows: businessUnitId ? [{ id: businessUnitId }] : [] };
        }
        if (
          normalized.startsWith('select id from business_units')
          && normalized.includes('order by name asc')
        ) {
          return { rows: businessUnitId ? [{ id: businessUnitId }] : [] };
        }
        if (normalized.startsWith('select u.id, u.name, u.email from users u')) {
          return { rows: [{ id: 'user-owner-1', name: 'Owner One', email: 'owner@example.com' }] };
        }
        if (normalized.startsWith('select id, name, email from users')) {
          return { rows: [{ id: 'user-owner-fallback', name: 'Fallback Owner', email: 'fallback@example.com' }] };
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
        if (normalized.startsWith('insert into import_source_rows')) {
          return { rows: [{ id: sourceRowId }] };
        }
        if (normalized.startsWith('insert into contacts')) {
          return { rows: [{ id: contactId }] };
        }
        if (normalized.startsWith('insert into leads')) {
          return { rows: [{ id: leadId }] };
        }
        if (normalized.startsWith('insert into activity_events')) {
          return { rows: [] };
        }
        if (normalized.startsWith('insert into import_normalized_records')) {
          return { rows: [{ id: normalizedId }] };
        }
        if (normalized.startsWith('insert into import_review_items')) {
          return { rows: [] };
        }

        throw new Error('Unexpected query: ' + normalized);
      },
    },
  };
}

function metaConfig() {
  return createMetaProviderConfig({
    defaultPageAccessToken: 'page-token',
    pageBusinessUnitMapRaw: JSON.stringify({ 'page-1': 'Main Signs' }),
  });
}

function graphLeadFixture(overrides = {}) {
  return {
    id: 'leadgen-1',
    page_id: 'page-1',
    form_id: 'form-graph',
    ad_id: 'ad-graph',
    created_time: '2026-05-20T11:00:00+0000',
    field_data: [
      { name: 'full_name', values: ['Ada Lovelace'] },
      { name: 'email', values: ['ada@example.com'] },
      { name: 'phone_number', values: ['555-0100'] },
      { name: 'company_name', values: ['Analytical Signs'] },
      { name: 'street_address', values: ['123 Loop St'] },
    ],
    ...overrides,
  };
}

test('builds stable Facebook leadgen event keys', () => {
  assert.equal(
    facebookLeadgenEventKey(leadgenFixture()),
    'facebook-leadgen:page-1:leadgen-1',
  );
  assert.equal(
    facebookLeadgenEventKey({ pageId: 'page-1', formId: 'form-1', createdTime: 1779275460 }),
    'facebook-leadgen-fallback:page-1:form-1:1779275460',
  );
});

test('skips duplicate leadgen events without fetching Graph or writing audit rows', async () => {
  const { client, calls } = createServiceClient({ duplicateLeadgen: true });
  let graphCalled = false;

  const result = await ingestFacebookLeadAdsEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events: [leadgenFixture()],
    metaConfig: metaConfig(),
    fetchLeadDetails: async () => {
      graphCalled = true;
      throw new Error('Graph should not be called for duplicate leadgen ids');
    },
  });

  assert.equal(graphCalled, false);
  assert.equal(result.received, 1);
  assert.equal(result.inserted, 0);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.eventResults[0], {
    eventKey: 'facebook-leadgen:page-1:leadgen-1',
    leadgenId: 'leadgen-1',
    pageId: 'page-1',
    inserted: false,
    promoted: false,
    graphFetched: false,
    skippedReason: 'duplicate_leadgen_id',
  });
  assert.equal(calls.some((call) => call.sql.startsWith('insert into import_source_rows')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), false);
});

test('ingests successful leadgen events into CRM and import review audit tables', async () => {
  const { client, calls } = createServiceClient();
  const graphLead = graphLeadFixture();

  const result = await ingestFacebookLeadAdsEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events: [leadgenFixture()],
    metaConfig: metaConfig(),
    fetchLeadDetails: async ({ leadgenId, pageId, config }) => {
      assert.equal(leadgenId, 'leadgen-1');
      assert.equal(pageId, 'page-1');
      assert.equal(config.defaultPageAccessToken, 'page-token');
      return { ok: true, lead: graphLead };
    },
  });

  assert.equal(result.received, 1);
  assert.equal(result.inserted, 1);
  assert.equal(result.promoted, 1);
  assert.equal(result.graphFetched, 1);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.eventResults[0], {
    eventKey: 'facebook-leadgen:page-1:leadgen-1',
    leadgenId: 'leadgen-1',
    pageId: 'page-1',
    inserted: true,
    promoted: true,
    graphFetched: true,
    businessUnitId: 'bu-1',
    sourceRowId: 'source-row-5',
    normalizedRecordId: 'normalized-5',
    contactId: 'contact-1',
    leadId: 'lead-1',
    graphFetchReason: null,
    review: false,
  });

  const sourceRowInsert = calls.find((call) => call.sql.startsWith('insert into import_source_rows'));
  assert.equal(sourceRowInsert.params[1], FACEBOOK_LEAD_ADS_SOURCE_SHEET);
  assert.equal(sourceRowInsert.params[2], 5);
  const rawValues = JSON.parse(sourceRowInsert.params[3]);
  assert.equal(rawValues.source, 'facebook_lead_ads');
  assert.equal(rawValues.leadgen_id, 'leadgen-1');
  assert.equal(rawValues.form_id, 'form-graph');
  assert.equal(rawValues.graph_fetch, 'ok');
  assert.deepEqual(rawValues.field_data, graphLead.field_data);

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
    'Facebook leadgen_id=leadgen-1 source_row_id=source-row-5',
    'user-owner-1',
  ]);

  const activityInsert = calls.find((call) => call.sql.startsWith('insert into activity_events'));
  assert.equal(activityInsert.params[4], 'Facebook lead captured from form form-1.');
  assert.equal(activityInsert.params[5], FACEBOOK_LEAD_ADS_SOURCE_SHEET);
  assert.equal(activityInsert.params[6], 5);

  const normalizedInsert = calls.find((call) => call.sql.startsWith('insert into import_normalized_records'));
  const proposedContact = JSON.parse(normalizedInsert.params[2]);
  const proposedLead = JSON.parse(normalizedInsert.params[3]);
  assert.equal(proposedContact.contact_id, 'contact-1');
  assert.equal(proposedLead.source_type, 'facebook_webhook');
  assert.equal(proposedLead.lead_id, 'lead-1');
  assert.equal(proposedLead.assigned_user_id, 'user-owner-1');
  assert.equal(proposedLead.notes, 'Webhook captured, Graph fields fetched, and CRM lead created.');
  assert.equal(normalizedInsert.params[4], 0.85);
  assert.equal(normalizedInsert.params[5], 'promoted');

  const reviewInsert = calls.find((call) => call.sql.startsWith('insert into import_review_items'));
  assert.equal(reviewInsert.params[2], 'Facebook lead captured and promoted to CRM contact/lead.');
  assert.deepEqual(JSON.parse(reviewInsert.params[3]), {
    action: 'verify_facebook_lead',
    normalizedRecordId: 'normalized-5',
    contactId: 'contact-1',
    leadId: 'lead-1',
  });
});

test('records Graph failures for review without creating CRM rows', async () => {
  const { client, calls } = createServiceClient();

  const result = await ingestFacebookLeadAdsEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events: [leadgenFixture()],
    metaConfig: metaConfig(),
    fetchLeadDetails: async () => ({
      ok: false,
      code: 'GRAPH_RESPONSE_ERROR',
      reason: 'Invalid lead id',
      graphStatus: 400,
      graphError: { message: 'Invalid lead id' },
    }),
  });

  assert.equal(result.received, 1);
  assert.equal(result.inserted, 1);
  assert.equal(result.promoted, 0);
  assert.equal(result.graphFetched, 0);
  assert.equal(result.skipped, 0);
  assert.equal(result.eventResults[0].graphFetchReason, 'Invalid lead id');
  assert.equal(result.eventResults[0].review, true);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into activity_events')), false);

  const sourceRowInsert = calls.find((call) => call.sql.startsWith('insert into import_source_rows'));
  const rawValues = JSON.parse(sourceRowInsert.params[3]);
  assert.equal(rawValues.graph_fetch, 'failed');
  assert.equal(rawValues.graph_fetch_reason, 'Invalid lead id');
  assert.equal(rawValues.field_data, null);

  const normalizedInsert = calls.find((call) => call.sql.startsWith('insert into import_normalized_records'));
  const proposedLead = JSON.parse(normalizedInsert.params[3]);
  assert.equal(proposedLead.lead_id, null);
  assert.equal(proposedLead.notes, 'Webhook captured, but Graph field fetch failed: Invalid lead id');
  assert.equal(normalizedInsert.params[4], 0.35);
  assert.equal(normalizedInsert.params[5], 'needs_review');

  const reviewInsert = calls.find((call) => call.sql.startsWith('insert into import_review_items'));
  assert.equal(reviewInsert.params[2], 'Facebook lead captured but needs review: Invalid lead id.');
  assert.deepEqual(JSON.parse(reviewInsert.params[3]), {
    action: 'review_facebook_lead',
    normalizedRecordId: 'normalized-5',
    contactId: null,
    leadId: null,
  });
});
