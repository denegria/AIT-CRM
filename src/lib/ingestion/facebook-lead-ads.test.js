import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FACEBOOK_LEAD_ADS_SOURCE_SHEET,
  facebookLeadAdsAutoPromotionEnabled,
  facebookLeadgenEventKey,
  ingestFacebookLeadAdsEvents,
  parseFacebookLeadAdsFormBusinessUnitMap,
  promoteFacebookLeadProposalToCrm,
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
  businessUnitName = 'Main Signs',
  contactId = 'contact-1',
  leadId = 'lead-1',
  sourceRowId = 'source-row-5',
  normalizedId = 'normalized-5',
  existingContact = null,
  existingLead = null,
  leadRepairRows = null,
  activeOpportunities = [],
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
          normalized.startsWith('select id, name from business_units')
          && normalized.includes('(id::text = $2 or lower(name) = lower($2))')
        ) {
          return { rows: businessUnitId ? [{ id: businessUnitId, name: businessUnitName }] : [] };
        }
        if (
          normalized.startsWith('select id, name from business_units')
          && normalized.includes('order by name asc')
        ) {
          return { rows: businessUnitId ? [{ id: businessUnitId, name: businessUnitName }] : [] };
        }
        if (normalized.startsWith('select id, name from business_units') && normalized.includes('id = $2')) {
          return { rows: businessUnitId ? [{ id: businessUnitId, name: businessUnitName }] : [] };
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
        if (normalized.startsWith('select id from contacts where organization_id') && normalized.includes('lower(email)')) {
          return { rows: existingContact ? [{ id: existingContact.id }] : [] };
        }
        if (normalized.startsWith('select id from contacts where organization_id') && normalized.includes('regexp_replace')) {
          return { rows: [] };
        }
        if (normalized.startsWith('insert into import_source_rows')) {
          return { rows: [{ id: sourceRowId }] };
        }
        if (normalized.startsWith('insert into contacts')) {
          return { rows: [{ id: contactId }] };
        }
        if (normalized.startsWith('update contacts set')) {
          return { rows: [{ id: params[0] }], rowCount: 1 };
        }
        if (
          normalized.startsWith('select id, contact_id, assigned_user_id from leads')
          || normalized.startsWith('select l.id, l.contact_id as linked_contact_id')
        ) {
          return { rows: existingLead ? [existingLead] : [] };
        }
        if (normalized.startsWith('select id, organization_id, business_unit_id, contact_id, status')) {
          return { rows: activeOpportunities };
        }
        if (normalized.startsWith('update leads set')) {
          const rows = leadRepairRows ?? [{ id: existingLead?.id || 'lead-existing' }];
          return { rows, rowCount: rows.length };
        }
        if (normalized.startsWith('insert into leads')) {
          return { rows: [{ id: leadId }] };
        }
        if (normalized.startsWith('insert into activity_events')) {
          return { rows: [] };
        }
        if (normalized.startsWith('insert into notes')) return { rows: [] };
        if (normalized.startsWith('insert into notifications')) {
          return { rows: [{ id: 'notification-1' }] };
        }
        if (normalized.startsWith('with intake_lock as')) {
          return { rows: [{ id: 'task-activity-1' }] };
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
  assert.equal(calls.some((call) => call.sql.startsWith('with intake_lock as')), true);
  assert.equal(calls.filter((call) => call.sql.startsWith('insert into activity_events')).length, 2);

  const notificationInsert = calls.find((call) => call.sql.startsWith('insert into notifications'));
  assert.deepEqual(notificationInsert.params.slice(0, 8), [
    'org-1',
    'bu-1',
    null,
    'inbound_lead',
    'facebook_lead_ads',
    'Ada Lovelace - Facebook lead',
    'Submitted Facebook form form-1. Open the contact to assign and follow up.',
    '/contacts/contact-1?leadId=lead-1',
  ]);
  assert.equal(notificationInsert.params[11], 'facebook_lead_ads:leadgen-1');

  const taskInsert = calls.find((call) => call.sql.startsWith('with intake_lock as'));
  assert.equal(taskInsert.params[6], 'follow_up');
  assert.equal(taskInsert.params[8], 'high');
  assert.equal(taskInsert.params[9], 'user-owner-1');
  assert.equal(taskInsert.params[10], 'automation');
  assert.equal(taskInsert.params[11], 'facebook_lead_ads:leadgen-1');
  assert.equal(taskInsert.params[12], 'New lead follow-up');

  const normalizedInsert = calls.find((call) => call.sql.startsWith('insert into import_normalized_records'));
  const proposedLead = JSON.parse(normalizedInsert.params[3]);
  assert.equal(proposedLead.lead_id, 'lead-1');
  assert.equal(proposedLead.assigned_user_id, 'user-owner-1');
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
    'org-1',
  ]);
});

test('AIT USA Facebook auto-promotion reuses the sole active Opportunity and preserves its owner', async () => {
  const { client, calls } = createServiceClient({
    businessUnitId: 'bu-usa',
    businessUnitName: 'AIT USA Institute',
    existingContact: { id: 'contact-existing', primary_business_unit_id: 'bu-usa' },
    activeOpportunities: [{
      id: 'opportunity-existing',
      status: 'Follow Up',
      assigned_user_id: 'owner-existing',
      source_name: 'Original source',
    }],
  });
  const result = await ingestFacebookLeadAdsEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events: [leadgenFixture()],
    metaConfig: metaConfig(),
    fetchLeadDetails: async () => ({ ok: true, lead: graphLeadFixture() }),
    autoPromote: true,
  });

  assert.equal(result.eventResults[0].leadId, 'opportunity-existing');
  assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), false);
  const task = calls.find((call) => call.sql.startsWith('with intake_lock as'));
  assert.equal(task.params.includes('owner-existing'), true);
});

test('AIT USA Facebook auto-promotion sends multiple active Opportunities to review without CRM mutation', async () => {
  const { client, calls } = createServiceClient({
    businessUnitId: 'bu-usa',
    businessUnitName: 'AIT USA Institute',
    existingContact: { id: 'contact-existing', primary_business_unit_id: 'bu-usa' },
    activeOpportunities: [
      { id: 'active-1', status: 'New Lead' },
      { id: 'active-2', status: 'Enrolled' },
    ],
  });
  const result = await ingestFacebookLeadAdsEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events: [leadgenFixture()],
    metaConfig: metaConfig(),
    fetchLeadDetails: async () => ({ ok: true, lead: graphLeadFixture() }),
    autoPromote: true,
  });

  assert.equal(result.promoted, 0);
  assert.equal(result.eventResults[0].review, true);
  assert.equal(result.eventResults[0].contactId, null);
  assert.equal(result.eventResults[0].leadId, null);
  assert.equal(calls.some((call) => call.sql.startsWith('update contacts')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), false);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into notifications')), false);
  const review = calls.find((call) => call.sql.startsWith('insert into import_review_items'));
  assert.match(review.params[2], /multiple active Opportunities/);
});

test('closed AIT USA Facebook Opportunity history allows one new Opportunity', async () => {
  const { client, calls } = createServiceClient({
    businessUnitId: 'bu-usa',
    businessUnitName: 'AIT USA Institute',
    existingContact: { id: 'contact-existing', primary_business_unit_id: 'bu-usa' },
    activeOpportunities: [
      { id: 'closed-1', status: 'Dropped / Quit' },
      { id: 'closed-2', status: 'Course Completed' },
    ],
  });
  const result = await ingestFacebookLeadAdsEvents(client, {
    organizationId: 'org-1',
    batchId: 'batch-1',
    events: [leadgenFixture()],
    metaConfig: metaConfig(),
    fetchLeadDetails: async () => ({ ok: true, lead: graphLeadFixture() }),
    autoPromote: true,
  });

  assert.equal(result.eventResults[0].leadId, 'lead-1');
  assert.equal(calls.filter((call) => call.sql.startsWith('insert into leads')).length, 1);
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

test('replaying an existing imported lead repairs side effects without inserting another lead', async () => {
  const { client, calls } = createServiceClient({
    existingLead: {
      id: 'lead-existing',
      linked_contact_id: 'contact-existing',
      contact_id: 'contact-existing',
      assigned_user_id: 'user-owner-1',
    },
    existingContact: { id: 'contact-existing', primary_business_unit_id: 'bu-1' },
  });

  const result = await promoteFacebookLeadProposalToCrm(client, 'org-1', {
    proposedContact: { name: 'Ada Lovelace', email: 'ada@example.com', business_unit_id: 'bu-1' },
    proposedLead: { source_type: 'facebook_webhook', leadgen_id: 'leadgen-1', form_id: 'form-1', business_unit_id: 'bu-1' },
    sourceRowId: 'source-row-5',
    rowNumber: 12,
  });

  assert.equal(result.leadId, 'lead-existing');
  assert.equal(result.alreadyExists, true);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into leads')), false);
  assert.equal(calls.some((call) => call.sql.includes("'facebook_lead_captured'")), true);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into notifications')), true);
  assert.equal(calls.some((call) => call.sql.startsWith('with intake_lock as')), true);
});

test('dirty cross-tenant lead links never update or return the foreign contact', async () => {
  const { client, calls } = createServiceClient({
    contactId: 'contact-in-org',
    existingLead: {
      id: 'lead-existing',
      linked_contact_id: 'contact-foreign',
      contact_id: null,
      assigned_user_id: 'user-owner-1',
    },
  });

  const result = await promoteFacebookLeadProposalToCrm(client, 'org-1', {
    proposedContact: { name: 'Ada Lovelace', email: 'ada@example.com', business_unit_id: 'bu-1' },
    proposedLead: { source_type: 'facebook_webhook', leadgen_id: 'leadgen-1', form_id: 'form-1', business_unit_id: 'bu-1' },
    sourceRowId: 'source-row-5',
    rowNumber: 12,
  });

  const leadLookup = calls.find((call) => call.sql.startsWith('select l.id, l.contact_id as linked_contact_id'));
  assert.match(leadLookup.sql, /left join contacts c/);
  assert.match(leadLookup.sql, /c\.organization_id = l\.organization_id/);
  assert.equal(calls.some((call) => call.sql.startsWith('update contacts set') && call.params[0] === 'contact-foreign'), false);
  const leadRepair = calls.find((call) => call.sql.startsWith('update leads set'));
  assert.match(leadRepair.sql, /returning id/);
  assert.equal(leadRepair.params[1], 'contact-in-org');
  assert.equal(result.contactId, 'contact-in-org');
  assert.notEqual(result.contactId, 'contact-foreign');
});

test('zero-row organization-scoped Lead repair fails and rolls back the CRM transaction', async () => {
  const { client, calls } = createServiceClient({
    contactId: 'contact-in-org',
    existingLead: {
      id: 'lead-existing',
      linked_contact_id: 'contact-foreign',
      contact_id: null,
      assigned_user_id: 'user-owner-1',
    },
    leadRepairRows: [],
  });

  await client.query('begin');
  await assert.rejects(
    () => promoteFacebookLeadProposalToCrm(client, 'org-1', {
      proposedContact: { name: 'Ada Lovelace', email: 'ada@example.com', business_unit_id: 'bu-1' },
      proposedLead: { source_type: 'facebook_webhook', leadgen_id: 'leadgen-1', form_id: 'form-1', business_unit_id: 'bu-1' },
      sourceRowId: 'source-row-5',
      rowNumber: 12,
    }),
    /Organization-scoped Facebook lead repair did not affect the expected Lead/,
  );
  await client.query('rollback');

  const leadRepair = calls.find((call) => call.sql.startsWith('update leads set'));
  assert.match(leadRepair.sql, /returning id/);
  assert.equal(calls.at(-1).sql, 'rollback');
  assert.equal(calls.some((call) => call.sql.startsWith('insert into notifications')), false);
});
