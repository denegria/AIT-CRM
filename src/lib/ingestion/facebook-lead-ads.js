import {
  fetchMetaLeadDetails,
  normalizeMetaLeadFields,
  resolveMetaPageBusinessUnitMapping,
} from '../messaging/providers/meta.js';
import {
  recordInboundLeadAssignmentActivity,
  resolveDefaultInboundLeadOwnerUserId,
} from '../crm/assignment.js';

export const FACEBOOK_LEAD_ADS_BATCH_SOURCE_NAME = 'Facebook Lead Ads';
export const FACEBOOK_LEAD_ADS_BATCH_SOURCE_TYPE = 'facebook_leads';
export const FACEBOOK_LEAD_ADS_SOURCE_SHEET = 'facebook_webhook';
export const FACEBOOK_LEAD_ADS_FILE_PREFIX = 'facebook-webhook';
export const FACEBOOK_LEAD_ADS_AUTO_PROMOTE_ENV = 'FACEBOOK_LEAD_ADS_AUTO_PROMOTE';
export const FACEBOOK_LEAD_ADS_FORM_BUSINESS_UNIT_MAP_ENV = 'FACEBOOK_LEAD_ADS_FORM_BUSINESS_UNIT_MAP';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled']);
const CRM_CONTACT_FIELD_KEYS = new Set([
  'first_name',
  'firstname',
  'last_name',
  'lastname',
  'full_name',
  'name',
  'nombre',
  'contact_name',
  'email',
  'email_address',
  'correo',
  'correo_electronico',
  'phone_number',
  'phone',
  'mobile_phone_number',
  'telefono',
  'celular',
  'company_name',
  'company',
  'business_name',
  'empresa',
  'street_address',
  'address',
  'direccion',
]);
const TECHNICAL_META_FIELD_KEYS = new Set(['inbox_url']);

export function facebookLeadAdsAutoPromotionEnabled(value = '') {
  return TRUE_VALUES.has(String(value || '').trim().toLowerCase());
}

export function parseFacebookLeadAdsFormBusinessUnitMap(raw = '') {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function facebookLeadgenEventKey(event) {
  if (event.leadgenId) return `facebook-leadgen:${event.pageId || 'unknown'}:${event.leadgenId}`;
  return `facebook-leadgen-fallback:${event.pageId || 'unknown'}:${event.formId || 'unknown'}:${event.createdTime || 'unknown'}`;
}

function normalizeMetaFieldKey(name = '') {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function metaFieldLabel(key = '') {
  return String(key || '')
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatFacebookLeadExtraFieldNotes(fieldData = []) {
  const lines = [];
  for (const field of fieldData || []) {
    const key = normalizeMetaFieldKey(field?.name);
    if (!key || CRM_CONTACT_FIELD_KEYS.has(key) || TECHNICAL_META_FIELD_KEYS.has(key)) continue;

    const values = Array.isArray(field?.values)
      ? field.values.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    if (!values.length) continue;

    lines.push(`${metaFieldLabel(key)}: ${values.join(', ')}`);
  }
  return lines;
}

export async function findOrCreateFacebookLeadAdsBatch(client, organizationId, options = {}) {
  const sourceName = options.sourceName || FACEBOOK_LEAD_ADS_BATCH_SOURCE_NAME;
  const sourceType = options.sourceType || FACEBOOK_LEAD_ADS_BATCH_SOURCE_TYPE;
  const filePrefix = options.filePrefix || FACEBOOK_LEAD_ADS_FILE_PREFIX;
  const sheetName = options.sheetName || FACEBOOK_LEAD_ADS_SOURCE_SHEET;
  const day = new Date().toISOString().slice(0, 10);
  const fileName = `${filePrefix}-${day}`;

  const existing = await client.query(
    `
      select id
      from import_batches
      where organization_id = $1 and source_type = $2 and file_name = $3
      order by created_at desc
      limit 1
    `,
    [organizationId, sourceType, fileName],
  );
  if (existing.rows[0]?.id) return existing.rows[0].id;

  const inserted = await client.query(
    `
      insert into import_batches
      (organization_id, source_name, source_type, file_name, sheet_name, status)
      values ($1, $2, $3, $4, $5, 'staging')
      returning id
    `,
    [organizationId, sourceName, sourceType, fileName, sheetName],
  );
  return inserted.rows[0]?.id || null;
}

async function nextRowNumber(client, batchId) {
  const result = await client.query(
    'select coalesce(max(source_row_number), 0)::int as max_row from import_source_rows where import_batch_id = $1',
    [batchId],
  );
  return Number(result.rows[0]?.max_row || 0) + 1;
}

async function lockedNextRowNumber(client, batchId) {
  await client.query('select id from import_batches where id = $1 for update', [batchId]);
  return nextRowNumber(client, batchId);
}

async function lockWebhookEvent(client, eventKey) {
  if (!eventKey) return;
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [eventKey]);
}

async function withSerializedWebhookEvent(client, eventKey, handler) {
  await client.query('begin');
  try {
    await lockWebhookEvent(client, eventKey);
    const result = await handler();
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

function resolveLeadAdsBusinessUnitMapping({ pageId = '', formId = '', metaConfig = {}, formBusinessUnitMap = {} } = {}) {
  const mappedForm = formBusinessUnitMap?.[formId];
  if (mappedForm) return { businessUnit: mappedForm, source: 'form_map' };

  const mappedPage = resolveMetaPageBusinessUnitMapping(pageId, metaConfig).businessUnit;
  if (mappedPage) return { businessUnit: mappedPage, source: 'page_map' };

  return { businessUnit: null, source: null };
}

async function resolveBusinessUnitId(
  client,
  organizationId,
  { pageId, formId, metaConfig, formBusinessUnitMap = {}, allowFallback = true } = {},
) {
  const mapping = resolveLeadAdsBusinessUnitMapping({ pageId, formId, metaConfig, formBusinessUnitMap });
  const mapped = mapping.businessUnit;
  if (mapped) {
    const mappedResult = await client.query(
      `
        select id
        from business_units
        where organization_id = $1
          and is_active = true
          and (id::text = $2 or lower(name) = lower($2))
        limit 1
      `,
      [organizationId, String(mapped)],
    );
    if (mappedResult.rows[0]?.id) {
      return {
        businessUnitId: mappedResult.rows[0].id,
        mappingSource: mapping.source,
        explicitMapping: true,
      };
    }
    return {
      businessUnitId: null,
      mappingSource: mapping.source,
      explicitMapping: true,
      reason: `Mapped business unit "${mapped}" was not found.`,
    };
  }

  if (!allowFallback) {
    return {
      businessUnitId: null,
      mappingSource: null,
      explicitMapping: false,
      reason: 'Facebook Lead Ads auto-promotion requires an explicit page or form business-unit mapping.',
    };
  }

  const result = await client.query(
    `
      select id
      from business_units
      where organization_id = $1 and is_active = true
      order by name asc
      limit 1
    `,
    [organizationId],
  );
  return {
    businessUnitId: result.rows[0]?.id || null,
    mappingSource: result.rows[0]?.id ? 'fallback' : null,
    explicitMapping: false,
    reason: result.rows[0]?.id ? null : 'No business unit found',
  };
}

async function hasLeadgenId(client, leadgenId) {
  if (!leadgenId) return false;
  const result = await client.query(
    `
      select 1
      from import_normalized_records
      where record_type = 'lead'
        and coalesce(proposed_lead_json->>'leadgen_id', '') = $1
      limit 1
    `,
    [leadgenId],
  );
  return Boolean(result.rows.length);
}

async function findExistingContact(client, organizationId, details) {
  if (details.email) {
    const byEmail = await client.query(
      `
        select id, primary_business_unit_id
        from contacts
        where organization_id = $1 and lower(email) = lower($2)
        order by updated_at desc
        limit 1
      `,
      [organizationId, details.email],
    );
    if (byEmail.rows[0]) return byEmail.rows[0];
  }

  if (details.phone) {
    const byPhone = await client.query(
      `
        select id, primary_business_unit_id
        from contacts
        where organization_id = $1 and phone = $2
        order by updated_at desc
        limit 1
      `,
      [organizationId, details.phone],
    );
    if (byPhone.rows[0]) return byPhone.rows[0];
  }

  return null;
}

async function upsertContactAndLead(client, organizationId, businessUnitId, event, details, sourceRowId, rowNumber) {
  if (!businessUnitId) return { contactId: null, leadId: null, reason: 'No business unit found' };
  const assignedUserId = await resolveDefaultInboundLeadOwnerUserId(client, {
    organizationId,
    businessUnitId,
    sourceType: 'facebook_lead_ads',
    sourceKey: event.leadgenId || event.formId || String(rowNumber),
  });

  const existing = await findExistingContact(client, organizationId, details);
  let contactId = existing?.id || null;
  if (contactId) {
    await client.query(
      `
        update contacts
        set
          name = coalesce(nullif(name, ''), nullif($2, '')),
          company_name = coalesce(nullif(company_name, ''), nullif($3, '')),
          phone = coalesce(nullif(phone, ''), nullif($4, '')),
          email = coalesce(nullif(email, ''), nullif($5, '')),
          address = coalesce(nullif(address, ''), nullif($6, '')),
          source_label = coalesce(nullif(source_label, ''), 'Facebook Ads'),
          primary_business_unit_id = coalesce(primary_business_unit_id, $7),
          updated_at = now()
        where id = $1
      `,
      [contactId, details.name, details.company, details.phone, details.email, details.address, businessUnitId],
    );
  } else {
    const inserted = await client.query(
      `
        insert into contacts
        (organization_id, primary_business_unit_id, name, company_name, phone, email, address, source_label)
        values ($1, $2, $3, nullif($4, ''), nullif($5, ''), nullif($6, ''), nullif($7, ''), 'Facebook Ads')
        returning id
      `,
      [organizationId, businessUnitId, details.name, details.company, details.phone, details.email, details.address],
    );
    contactId = inserted.rows[0]?.id || null;
  }

  const extraFieldNotes = formatFacebookLeadExtraFieldNotes(details.field_data);
  const originalNotes = [
    `Facebook leadgen_id=${event.leadgenId || 'unknown'} source_row_id=${sourceRowId || 'unknown'}`,
    extraFieldNotes.length ? `Facebook form answers:\n${extraFieldNotes.map((line) => `- ${line}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  const lead = await client.query(
    `
      insert into leads
      (organization_id, business_unit_id, contact_id, source_type, source_name, status, current_stage, original_notes, assigned_user_id)
      values ($1, $2, $3, 'facebook_lead_ads', 'Facebook Ads', 'New Lead', 'New Lead', $4, $5)
      returning id
    `,
    [
      organizationId,
      businessUnitId,
      contactId,
      originalNotes,
      assignedUserId,
    ],
  );
  const leadId = lead.rows[0]?.id || null;

  await client.query(
    `
      insert into activity_events
      (organization_id, business_unit_id, contact_id, lead_id, event_type, message, source_sheet, source_row, occurred_at)
      values ($1, $2, $3, $4, 'facebook_lead_captured', $5, $6, $7, now())
    `,
    [
      organizationId,
      businessUnitId,
      contactId,
      leadId,
      `Facebook lead captured from form ${event.formId || 'unknown'}.`,
      FACEBOOK_LEAD_ADS_SOURCE_SHEET,
      rowNumber,
    ],
  );
  await recordInboundLeadAssignmentActivity(client, {
    organizationId,
    businessUnitId,
    contactId,
    leadId,
    ownerUserId: assignedUserId,
  });

  return { contactId, leadId, assignedUserId, reason: null };
}

export async function promoteFacebookLeadProposalToCrm(
  client,
  organizationId,
  { proposedContact = {}, proposedLead = {}, sourceRowId = null, rowNumber = null } = {},
) {
  const businessUnitId = proposedLead.business_unit_id || proposedContact.business_unit_id || null;
  const details = {
    name: proposedContact.name || proposedLead.email || proposedLead.phone || 'Facebook Lead',
    company: proposedContact.company_name || proposedContact.company || '',
    phone: proposedContact.phone || '',
    email: proposedContact.email || '',
    address: proposedContact.address || '',
    field_data: proposedLead.field_data || [],
  };
  const event = {
    leadgenId: proposedLead.leadgen_id || '',
    formId: proposedLead.form_id || '',
  };

  return upsertContactAndLead(client, organizationId, businessUnitId, event, details, sourceRowId, rowNumber);
}

function hasUsableContactMethod(details = {}) {
  return Boolean(details.email || details.phone);
}

async function maybeAutoPromoteFacebookLead(client, {
  organizationId,
  autoPromote,
  fetched,
  details,
  businessUnit,
  event,
  sourceRowId,
  rowNumber,
}) {
  if (!fetched.ok) {
    return {
      contactId: null,
      leadId: null,
      assignedUserId: null,
      reason: fetched.reason,
      blockedReason: fetched.reason,
    };
  }

  if (!autoPromote) {
    return {
      contactId: null,
      leadId: null,
      assignedUserId: null,
      reason: 'Awaiting import review approval before CRM promotion.',
      blockedReason: null,
    };
  }

  if (!businessUnit.explicitMapping || !businessUnit.businessUnitId) {
    return {
      contactId: null,
      leadId: null,
      assignedUserId: null,
      reason: businessUnit.reason || 'Facebook Lead Ads auto-promotion requires an explicit business-unit mapping.',
      blockedReason: 'business_unit_mapping_required',
    };
  }

  if (!hasUsableContactMethod(details)) {
    return {
      contactId: null,
      leadId: null,
      assignedUserId: null,
      reason: 'Facebook Lead Ads auto-promotion requires an email or phone number.',
      blockedReason: 'contact_method_required',
    };
  }

  const crmWrite = await upsertContactAndLead(
    client,
    organizationId,
    businessUnit.businessUnitId,
    event,
    details,
    sourceRowId,
    rowNumber,
  );

  return {
    ...crmWrite,
    blockedReason: crmWrite.leadId ? null : 'crm_write_failed',
  };
}

export async function persistFacebookLeadAdsEvent(
  client,
  {
    organizationId,
    batchId,
    rowNumber,
    event,
    metaConfig,
    fetchLeadDetails = fetchMetaLeadDetails,
    autoPromote = false,
    formBusinessUnitMap = {},
  },
) {
  const eventKey = facebookLeadgenEventKey(event);
  if (event.leadgenId && await hasLeadgenId(client, event.leadgenId)) {
    return {
      eventKey,
      leadgenId: event.leadgenId || null,
      pageId: event.pageId || null,
      inserted: false,
      promoted: false,
      graphFetched: false,
      skippedReason: 'duplicate_leadgen_id',
    };
  }

  const fetched = await fetchLeadDetails({ leadgenId: event.leadgenId, pageId: event.pageId, config: metaConfig });
  const graphLead = fetched.ok ? fetched.lead : null;
  const details = normalizeMetaLeadFields(graphLead?.field_data || []);
  const businessUnit = await resolveBusinessUnitId(client, organizationId, {
    pageId: graphLead?.page_id || event.pageId,
    formId: graphLead?.form_id || event.formId,
    metaConfig,
    formBusinessUnitMap,
    allowFallback: !autoPromote,
  });
  const businessUnitId = businessUnit.businessUnitId;

  const rawValues = {
    source: 'facebook_lead_ads',
    leadgen_id: event.leadgenId,
    page_id: graphLead?.page_id || event.pageId,
    form_id: graphLead?.form_id || event.formId,
    ad_id: graphLead?.ad_id || event.adId,
    created_time: graphLead?.created_time || event.createdTime,
    graph_fetch: fetched.ok ? 'ok' : 'failed',
    graph_fetch_reason: fetched.ok ? null : fetched.reason,
    field_data: graphLead?.field_data || null,
    raw: event.raw,
  };
  const rawText = JSON.stringify(rawValues);

  const sourceRow = await client.query(
    `
      insert into import_source_rows
      (import_batch_id, source_sheet, source_row_number, raw_values_json, raw_text, parse_status)
      values ($1, $2, $3, $4::jsonb, $5, 'parsed')
      returning id
    `,
    [batchId, FACEBOOK_LEAD_ADS_SOURCE_SHEET, rowNumber, JSON.stringify(rawValues), rawText],
  );
  const sourceRowId = sourceRow.rows[0]?.id;
  if (!sourceRowId) {
    return {
      eventKey,
      leadgenId: event.leadgenId || null,
      pageId: event.pageId || null,
      inserted: false,
      promoted: false,
      graphFetched: fetched.ok,
      skippedReason: 'source_row_insert_failed',
    };
  }

  const crmWrite = await maybeAutoPromoteFacebookLead(client, {
    organizationId,
    autoPromote,
    fetched,
    details,
    businessUnit,
    event,
    sourceRowId,
    rowNumber,
  });

  const proposedContact = {
    name: details.name,
    email: details.email || null,
    phone: details.phone || null,
    company_name: details.company || null,
    address: details.address || null,
    source_label: 'Facebook Ads',
    business_unit_id: businessUnitId,
    contact_id: crmWrite.contactId,
  };
  const proposedLead = {
    source_type: 'facebook_webhook',
    source_name: 'Facebook Ads',
    leadgen_id: event.leadgenId,
    page_id: graphLead?.page_id || event.pageId,
    form_id: graphLead?.form_id || event.formId,
    ad_id: graphLead?.ad_id || event.adId,
    created_time: graphLead?.created_time || event.createdTime,
    status: 'New Lead',
    current_stage: 'New Lead',
    field_data: graphLead?.field_data || null,
    business_unit_id: businessUnitId,
    contact_id: crmWrite.contactId,
    lead_id: crmWrite.leadId,
    assigned_user_id: crmWrite.assignedUserId || null,
    auto_promotion: autoPromote ? {
      attempted: true,
      promoted: Boolean(crmWrite.leadId),
      blocked_reason: crmWrite.leadId ? null : crmWrite.blockedReason,
      mapping_source: businessUnit.mappingSource,
    } : { attempted: false },
    notes: crmWrite.leadId
      ? 'Webhook captured, Graph fields fetched, and lead auto-promoted to CRM.'
      : fetched.ok
        ? `Webhook captured and Graph fields fetched. ${crmWrite.reason}`
        : `Webhook captured, but Graph field fetch failed: ${fetched.reason}`,
  };

  const normalized = await client.query(
    `
      insert into import_normalized_records
      (import_batch_id, source_row_id, record_type, proposed_contact_json, proposed_lead_json, confidence_score, status)
      values ($1, $2, 'lead', $3::jsonb, $4::jsonb, $5, $6)
      returning id
    `,
    [
      batchId,
      sourceRowId,
      JSON.stringify(proposedContact),
      JSON.stringify(proposedLead),
      fetched.ok ? 0.85 : 0.35,
      fetched.ok && crmWrite.leadId ? 'promoted' : 'needs_review',
    ],
  );
  const normalizedId = normalized.rows[0]?.id;

  const reviewStatus = crmWrite.leadId ? 'approved' : 'pending';
  const reviewReason = crmWrite.leadId
    ? 'Facebook lead auto-promoted to CRM after Graph fetch and mapping checks.'
    : fetched.ok
      ? autoPromote
        ? `Facebook lead captured with Graph fields but auto-promotion is blocked: ${crmWrite.reason}`
        : 'Facebook lead captured with Graph fields and queued for import review.'
      : `Facebook lead captured but needs review: ${crmWrite.reason || fetched.reason || 'unknown reason'}.`;
  const reviewAction = crmWrite.leadId
    ? 'auto_promote_facebook_lead'
    : fetched.ok
      ? autoPromote ? 'review_auto_promotion_blocked' : 'fetch_graph_lead_fields'
      : 'review_facebook_lead';

  await client.query(
    `
      insert into import_review_items
      (import_batch_id, source_row_id, review_type, reason, review_status, reviewed_at, proposed_resolution_json)
      values ($1, $2, 'facebook_lead_review', $3, $4, ${crmWrite.leadId ? 'now()' : 'null'}, $5::jsonb)
    `,
    [
      batchId,
      sourceRowId,
      reviewReason,
      reviewStatus,
      JSON.stringify({
        action: reviewAction,
        normalizedRecordId: normalizedId || null,
        contactId: crmWrite.contactId,
        leadId: crmWrite.leadId,
        blockedReason: crmWrite.blockedReason || null,
        mappingSource: businessUnit.mappingSource || null,
      }),
    ],
  );

  return {
    eventKey,
    leadgenId: event.leadgenId || null,
    pageId: graphLead?.page_id || event.pageId || null,
    inserted: true,
    promoted: Boolean(crmWrite.leadId),
    graphFetched: fetched.ok,
    businessUnitId,
    businessUnitMappingSource: businessUnit.mappingSource || null,
    sourceRowId,
    normalizedRecordId: normalizedId || null,
    contactId: crmWrite.contactId,
    leadId: crmWrite.leadId,
    graphFetchReason: fetched.ok ? null : fetched.reason,
    review: !crmWrite.leadId,
  };
}

function emptyFacebookLeadAdsResult(batchId = null) {
  return {
    received: 0,
    inserted: 0,
    promoted: 0,
    graphFetched: 0,
    skipped: 0,
    batchId,
    eventResults: [],
  };
}

export async function ingestFacebookLeadAdsEvents(
  client,
  {
    organizationId,
    batchId: preparedBatchId = null,
    events = [],
    metaConfig,
    fetchLeadDetails = fetchMetaLeadDetails,
    autoPromote = false,
    formBusinessUnitMap = {},
  },
) {
  if (!events.length) return emptyFacebookLeadAdsResult(preparedBatchId);

  const batchId = preparedBatchId || await findOrCreateFacebookLeadAdsBatch(client, organizationId);
  if (!batchId) {
    return {
      ...emptyFacebookLeadAdsResult(null),
      received: events.length,
      skipped: events.length,
      reason: 'Failed to resolve lead import batch',
    };
  }

  let inserted = 0;
  let promoted = 0;
  let graphFetched = 0;
  let skipped = 0;
  const eventResults = [];

  for (const event of events) {
    const eventKey = facebookLeadgenEventKey(event);
    const stored = await withSerializedWebhookEvent(client, eventKey, async () => {
      const rowNumber = await lockedNextRowNumber(client, batchId);
      return persistFacebookLeadAdsEvent(client, {
        organizationId,
        batchId,
        rowNumber,
        event,
        metaConfig,
        fetchLeadDetails,
        autoPromote,
        formBusinessUnitMap,
      });
    });
    eventResults.push(stored);

    if (stored.inserted) {
      inserted += 1;
      if (stored.promoted) promoted += 1;
      if (stored.graphFetched) graphFetched += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    received: events.length,
    inserted,
    promoted,
    graphFetched,
    skipped,
    batchId,
    eventResults,
  };
}
