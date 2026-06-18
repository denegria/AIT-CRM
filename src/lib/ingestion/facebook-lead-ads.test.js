import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FACEBOOK_LEAD_ADS_SOURCE_SHEET,
  facebookLeadAdsAutoPromotionEnabled,
  facebookLeadgenEventKey,
  ingestFacebookLeadAdsEvents,
  parseFacebookLeadAdsFormBusinessUnitMap,
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
  existingContact = null,
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
          return { rows: existingContact ? [existingContact] : [] };
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
        if (normalized.startsWith('update contacts set')) {
          return { rows: [] };
        }
        if (normalized.startsWith('insert into leads')) {
          return { rows: [{ id: leadId }] };
        }
        if (normalized.startsWith('insert into activity_events')) {
          return { rows: [] };
        }
        if (normalized.startsWith('insert into notifications')) {
          return { rows: [{ id: 'notification-1' }] };
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

test('parses Facebook Lead Ads auto-promotion config safely', () => {
  assert.equal(facebookLeadAdsAutoPromotionEnabled('true'), true);
  assert.equal(facebookLeadAdsAutoPromotionEnabled('ON'), true);
  assert.equal(facebookLeadAdsAutoPromotionEnabled('0'), false);
  assert.deepEqual(parseFacebookLeadAdsFormBusinessUnitMap('{"form-1":"AIT Signs"}'), { 'form-1': 'AIT Signs' });
  assert.deepEqual(parseFacebookLeadAdsFormBusinessUnitMap('{bad'), {});
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

test('queues successful leadgen events for import review without CRM writes', async () => {
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
  assert.equal(result.promoted, 0);
  assert.equal(result.graphFetched, 1);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.eventResults[0], {
    eventKey: 'facebook-leadgen:page-1:leadgen-1',
    leadgenId: 'leadgen-1',
    pageId: 'page-1',
    inserted: true,
    promoted: false,
    graphFetched: true,
    businessUnitId: 'bu-1',
    businessUnitMappingSource: 'page_map',
    sourceRowId: 'source-row-5',
    normalizedRecordId: 'normalized-5',
    contactId: null,
    leadId: null,
    graphFetchReason: null,
    review: true,
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

  assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into activity_events')), false);

  const normalizedInsert = calls.find((call) => call.sql.startsWith('insert into import_normalized_records'));
  const proposedContact = JSON.parse(normalizedInsert.params[2]);
  const proposedLead = JSON.parse(normalizedInsert.params[3]);
  assert.equal(proposedContact.contact_id, null);
  assert.equal(proposedContact.source_label, 'Facebook Ads');
  assert.equal(proposedLead.source_type, 'facebook_webhook');
  assert.equal(proposedLead.lead_id, null);
  assert.equal(proposedLead.assigned_user_id, null);
  assert.equal(proposedLead.notes, 'Webhook captured and Graph fields fetched. Awaiting import review approval before CRM promotion.');
  assert.equal(normalizedInsert.params[4], 0.85);
  assert.equal(normalizedInsert.params[5], 'needs_review');

  const reviewInsert = calls.find((call) => call.sql.startsWith('insert into import_review_items'));
  assert.equal(reviewInsert.params[2], 'Facebook lead captured with Graph fields and queued for import review.');
  assert.equal(reviewInsert.params[3], 'pending');
  assert.deepEqual(JSON.parse(reviewInsert.params[4]), {
    action: 'fetch_graph_lead_fields',
    normalizedRecordId: 'normalized-5',
    contactId: null,
    leadId: null,
    blockedReason: null,
    mappingSource: 'page_map',
  });
});

test('auto-promotes safe mapped leadgen events while preserving import audit rows', async () => {
  const { client, calls } = createServiceClient();
  const graphLead = graphLeadFixture();

  const result = await ingestFacebookLeadAdsEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events: [leadgenFixture()],
    metaConfig: metaConfig(),
    autoPromote: true,
    fetchLeadDetails: async () => ({ ok: true, lead: graphLead }),
  });

  assert.equal(result.received, 1);
  assert.equal(result.inserted, 1);
  assert.equal(result.promoted, 1);
  assert.equal(result.graphFetched, 1);
  assert.equal(result.eventResults[0].review, false);
  assert.equal(result.eventResults[0].contactId, 'contact-1');
  assert.equal(result.eventResults[0].leadId, 'lead-1');
  assert.equal(result.eventResults[0].businessUnitMappingSource, 'page_map');

  assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), true);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), true);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into activity_events')), true);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into notifications')), true);
  assert.equal(calls.filter((call) => call.sql.startsWith('insert into activity_events')).length, 1);

  const notificationInsert = calls.find((call) => call.sql.startsWith('insert into notifications'));
  assert.deepEqual(notificationInsert.params.slice(0, 8), [
    'org-1',
    'bu-1',
    null,
    'inbound_lead',
    'facebook_lead_ads',
    'New Facebook lead',
    'Ada Lovelace - Submitted Facebook form form-1.',
    '/contacts/contact-1?leadId=lead-1',
  ]);
  assert.equal(notificationInsert.params[11], 'facebook_lead_ads:leadgen-1');

  const normalizedInsert = calls.find((call) => call.sql.startsWith('insert into import_normalized_records'));
  const proposedLead = JSON.parse(normalizedInsert.params[3]);
  assert.equal(proposedLead.lead_id, 'lead-1');
  assert.equal(proposedLead.assigned_user_id, null);
  assert.deepEqual(proposedLead.auto_promotion, {
    attempted: true,
    promoted: true,
    blocked_reason: null,
    mapping_source: 'page_map',
  });
  assert.equal(normalizedInsert.params[5], 'promoted');

  const reviewInsert = calls.find((call) => call.sql.startsWith('insert into import_review_items'));
  assert.equal(reviewInsert.params[2], 'Facebook lead auto-promoted to CRM after Graph fetch and mapping checks.');
  assert.equal(reviewInsert.params[3], 'approved');
  assert.deepEqual(JSON.parse(reviewInsert.params[4]), {
    action: 'auto_promote_facebook_lead',
    normalizedRecordId: 'normalized-5',
    contactId: 'contact-1',
    leadId: 'lead-1',
    blockedReason: null,
    mappingSource: 'page_map',
  });
});

test('uses webhook page id when Graph lead details omit page id', async () => {
  const { client, calls } = createServiceClient();
  const graphLead = graphLeadFixture({ page_id: undefined });

  const result = await ingestFacebookLeadAdsEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events: [leadgenFixture()],
    metaConfig: metaConfig(),
    autoPromote: true,
    fetchLeadDetails: async () => ({ ok: true, lead: graphLead }),
  });

  assert.equal(result.promoted, 1);
  assert.equal(result.eventResults[0].businessUnitMappingSource, 'page_map');

  const sourceRowInsert = calls.find((call) => call.sql.startsWith('insert into import_source_rows'));
  const rawValues = JSON.parse(sourceRowInsert.params[3]);
  assert.equal(rawValues.page_id, 'page-1');

  const normalizedInsert = calls.find((call) => call.sql.startsWith('insert into import_normalized_records'));
  const proposedLead = JSON.parse(normalizedInsert.params[3]);
  assert.equal(proposedLead.page_id, 'page-1');
  assert.equal(proposedLead.lead_id, 'lead-1');
});

test('adds non-core Facebook form answers to promoted lead notes', async () => {
  const { client, calls } = createServiceClient();
  const graphLead = graphLeadFixture({
    field_data: [
      ...graphLeadFixture().field_data,
      { name: 'education_level', values: ['Master degree'] },
      { name: 'inbox_url', values: ['https://business.facebook.com/latest/inbox'] },
    ],
  });

  const result = await ingestFacebookLeadAdsEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events: [leadgenFixture()],
    metaConfig: metaConfig(),
    autoPromote: true,
    fetchLeadDetails: async () => ({ ok: true, lead: graphLead }),
  });

  assert.equal(result.promoted, 1);
  const leadInsert = calls.find((call) => call.sql.startsWith('insert into leads'));
  assert.match(leadInsert.params[3], /Facebook form answers:/);
  assert.match(leadInsert.params[3], /Education Level: Master degree/);
  assert.doesNotMatch(leadInsert.params[3], /inbox_url|Inbox Url|test@meta\.com|Ada Lovelace/);
});

test('auto-promotion fails closed when page and form business-unit mapping is missing', async () => {
  const { client, calls } = createServiceClient();

  const result = await ingestFacebookLeadAdsEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events: [leadgenFixture()],
    metaConfig: createMetaProviderConfig({ defaultPageAccessToken: 'page-token' }),
    autoPromote: true,
    fetchLeadDetails: async () => ({ ok: true, lead: graphLeadFixture() }),
  });

  assert.equal(result.received, 1);
  assert.equal(result.inserted, 1);
  assert.equal(result.promoted, 0);
  assert.equal(result.eventResults[0].review, true);
  assert.equal(result.eventResults[0].businessUnitId, null);
  assert.equal(result.eventResults[0].businessUnitMappingSource, null);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), false);

  const normalizedInsert = calls.find((call) => call.sql.startsWith('insert into import_normalized_records'));
  const proposedLead = JSON.parse(normalizedInsert.params[3]);
  assert.equal(proposedLead.business_unit_id, null);
  assert.deepEqual(proposedLead.auto_promotion, {
    attempted: true,
    promoted: false,
    blocked_reason: 'business_unit_mapping_required',
    mapping_source: null,
  });
  assert.equal(normalizedInsert.params[5], 'needs_review');

  const reviewInsert = calls.find((call) => call.sql.startsWith('insert into import_review_items'));
  assert.match(reviewInsert.params[2], /auto-promotion is blocked/);
  assert.equal(reviewInsert.params[3], 'pending');
  assert.deepEqual(JSON.parse(reviewInsert.params[4]), {
    action: 'review_auto_promotion_blocked',
    normalizedRecordId: 'normalized-5',
    contactId: null,
    leadId: null,
    blockedReason: 'business_unit_mapping_required',
    mappingSource: null,
  });
});

test('auto-promotion links existing contacts without overwriting populated PII', async () => {
  const { client, calls } = createServiceClient({
    existingContact: { id: 'existing-contact-1', primary_business_unit_id: 'bu-old' },
  });

  const result = await ingestFacebookLeadAdsEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events: [leadgenFixture()],
    metaConfig: metaConfig(),
    autoPromote: true,
    fetchLeadDetails: async () => ({ ok: true, lead: graphLeadFixture() }),
  });

  assert.equal(result.promoted, 1);
  assert.equal(result.eventResults[0].contactId, 'existing-contact-1');
  assert.equal(calls.some((call) => call.sql.startsWith('insert into contacts')), false);

  const contactUpdate = calls.find((call) => call.sql.startsWith('update contacts set'));
  assert.equal(contactUpdate.sql.includes("name = coalesce(nullif(name, ''), nullif($2, ''))"), true);
  assert.equal(contactUpdate.sql.includes("email = coalesce(nullif(email, ''), nullif($5, ''))"), true);
  assert.deepEqual(contactUpdate.params, [
    'existing-contact-1',
    'Ada Lovelace',
    'Analytical Signs',
    '555-0100',
    'ada@example.com',
    '123 Loop St',
    'bu-1',
  ]);
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
  assert.equal(reviewInsert.params[3], 'pending');
  assert.deepEqual(JSON.parse(reviewInsert.params[4]), {
    action: 'review_facebook_lead',
    normalizedRecordId: 'normalized-5',
    contactId: null,
    leadId: null,
    blockedReason: 'Invalid lead id',
    mappingSource: 'page_map',
  });
});
