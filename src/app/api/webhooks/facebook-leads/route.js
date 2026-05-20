import { NextResponse } from 'next/server';
import { Client } from 'pg';
import {
  FB_APP_SECRET_ENV,
  FB_VERIFY_TOKEN_ENV,
  META_PAGE_ACCESS_TOKEN_ENV,
  META_PAGE_ACCESS_TOKEN_MAP_ENV,
  META_PAGE_BUSINESS_UNIT_MAP_ENV,
  META_VERIFY_TOKEN_ENV,
  createMetaProviderConfig,
  fetchMetaLeadDetails,
  fetchMetaMessengerProfile,
  flattenMetaLeadgenChanges,
  flattenMetaMessengerEvents,
  normalizeMetaLeadFields,
  resolveMetaPageBusinessUnitMapping,
  validateMetaAppSecretSignature,
  verifyMetaWebhookChallenge,
} from '@/lib/messaging/providers/meta.js';

const DEFAULT_SOURCE_SHEET = 'facebook_webhook';
const MESSENGER_SOURCE_SHEET = 'facebook_messenger';

function jsonError(message, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getMetaProviderConfig() {
  return createMetaProviderConfig({
    facebookVerifyToken: process.env[FB_VERIFY_TOKEN_ENV],
    metaVerifyToken: process.env[META_VERIFY_TOKEN_ENV],
    appSecret: process.env[FB_APP_SECRET_ENV],
    defaultPageAccessToken: process.env[META_PAGE_ACCESS_TOKEN_ENV],
    pageAccessTokenMapRaw: process.env[META_PAGE_ACCESS_TOKEN_MAP_ENV],
    pageBusinessUnitMapRaw: process.env[META_PAGE_BUSINESS_UNIT_MAP_ENV],
  });
}

function verifyTokenConfigured(metaConfig) {
  return Boolean(metaConfig.verifyToken);
}

function verifyTokenErrorMessage() {
  return `${FB_VERIFY_TOKEN_ENV} or ${META_VERIFY_TOKEN_ENV} is required before Facebook lead webhook verification can run.`;
}

function appSecretConfigured(metaConfig) {
  return Boolean(metaConfig.appSecret);
}

function appSecretErrorMessage() {
  return `${FB_APP_SECRET_ENV} is required before Facebook lead webhook POST processing can run.`;
}

async function withClient(handler) {
  if (!process.env.DATABASE_URL) {
    return { inserted: 0, skipped: 0, received: 0, reason: 'DATABASE_URL missing' };
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await handler(client);
  } finally {
    await client.end();
  }
}

async function resolveOrganizationId(client) {
  const result = await client.query('select id from organizations order by created_at asc limit 1');
  return result.rows[0]?.id || null;
}

async function resolveBusinessUnitId(client, organizationId, pageId, metaConfig) {
  const mapped = resolveMetaPageBusinessUnitMapping(pageId, metaConfig).businessUnit;
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
    if (mappedResult.rows[0]?.id) return mappedResult.rows[0].id;
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
  return result.rows[0]?.id || null;
}

async function findOrCreateBatch(client, organizationId, options = {}) {
  const sourceName = options.sourceName || 'Facebook Lead Ads';
  const sourceType = options.sourceType || 'facebook_leads';
  const filePrefix = options.filePrefix || 'facebook-webhook';
  const sheetName = options.sheetName || DEFAULT_SOURCE_SHEET;
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

function leadgenEventKey(event) {
  if (event.leadgenId) return `facebook-leadgen:${event.pageId || 'unknown'}:${event.leadgenId}`;
  return `facebook-leadgen-fallback:${event.pageId || 'unknown'}:${event.formId || 'unknown'}:${event.createdTime || 'unknown'}`;
}

function messengerEventKey(event) {
  if (event.messageId) return `facebook-messenger-message:${event.pageId || 'unknown'}:${event.messageId}`;
  return [
    'facebook-messenger-fallback',
    event.pageId || 'unknown',
    event.senderId || 'unknown',
    event.timestamp || 'unknown',
    event.postbackPayload || event.text || '[attachment]',
  ].join(':');
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

async function hasMessengerMessageId(client, messageId, pageId) {
  if (!messageId) return false;
  const result = await client.query(
    `
      select 1
      from import_normalized_records
      where record_type = 'lead'
        and coalesce(proposed_lead_json->>'message_id', '') = $1
        and coalesce(proposed_lead_json->>'page_id', '') = $2
      limit 1
    `,
    [messageId, pageId || ''],
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

async function findExistingMessengerLead(client, senderId, pageId) {
  if (!senderId) return null;
  const result = await client.query(
    `
      select proposed_lead_json
      from import_normalized_records
      where record_type = 'lead'
        and coalesce(proposed_lead_json->>'messenger_sender_id', '') = $1
        and coalesce(proposed_lead_json->>'page_id', '') = $2
        and proposed_lead_json ? 'lead_id'
      order by created_at asc
      limit 1
    `,
    [senderId, pageId || ''],
  );
  const lead = result.rows[0]?.proposed_lead_json || null;
  if (!lead?.lead_id) return null;
  return {
    contactId: lead.contact_id || null,
    leadId: lead.lead_id || null,
  };
}

function classifyMessengerEvent(event) {
  if (!event.senderId) return { action: 'ignore', reason: 'Missing Messenger sender id.' };
  if (event.senderId === event.pageId) return { action: 'ignore', reason: 'Ignoring Page self-message.' };

  const text = String(event.text || '').trim();
  const hasPostback = Boolean(event.postbackPayload);
  const hasAttachments = event.attachments.length > 0;
  if (!text && !hasPostback && !hasAttachments) {
    return { action: 'ignore', reason: 'No message text, attachment, or postback payload.' };
  }

  const suspiciousPatterns = [
    /\b(?:crypto|forex|casino|porn|xxx|loan offer|investment opportunity)\b/i,
    /(?:t\.me|telegram\.me|bit\.ly|tinyurl\.com)\//i,
  ];
  if (text.length > 2000 || suspiciousPatterns.some((pattern) => pattern.test(text))) {
    return { action: 'review', reason: 'Message matched basic spam filter.' };
  }

  return { action: 'promote', reason: null };
}

function messengerDisplayName(profile, senderId) {
  const name = String(profile?.name || [profile?.first_name, profile?.last_name].filter(Boolean).join(' ')).trim();
  if (name) return name;
  return `Messenger User ${String(senderId || '').slice(-6) || 'Unknown'}`;
}

async function createMessengerContactAndLead(client, organizationId, businessUnitId, event, profile, sourceRowId) {
  if (!businessUnitId) return { contactId: null, leadId: null, reason: 'No business unit found' };

  const contact = await client.query(
    `
      insert into contacts
      (organization_id, primary_business_unit_id, name, source_label)
      values ($1, $2, $3, 'Facebook Messenger')
      returning id
    `,
    [organizationId, businessUnitId, messengerDisplayName(profile, event.senderId)],
  );
  const contactId = contact.rows[0]?.id || null;

  const lead = await client.query(
    `
      insert into leads
      (organization_id, business_unit_id, contact_id, source_type, source_name, status, current_stage, original_notes)
      values ($1, $2, $3, 'facebook_messenger', 'Facebook Messenger', 'New Lead', 'New Lead', $4)
      returning id
    `,
    [
      organizationId,
      businessUnitId,
      contactId,
      `Messenger sender_id=${event.senderId || 'unknown'} page_id=${event.pageId || 'unknown'} source_row_id=${sourceRowId || 'unknown'}`,
    ],
  );

  return { contactId, leadId: lead.rows[0]?.id || null, reason: null };
}

async function logMessengerActivity(client, organizationId, businessUnitId, event, crmIds, rowNumber) {
  await client.query(
    `
      insert into activity_events
      (organization_id, business_unit_id, contact_id, lead_id, event_type, message, source_sheet, source_row, occurred_at)
      values ($1, $2, $3, $4, 'facebook_messenger_message', $5, $6, $7, $8)
    `,
    [
      organizationId,
      businessUnitId,
      crmIds.contactId || null,
      crmIds.leadId || null,
      event.text || event.postbackPayload || '[Messenger attachment]',
      MESSENGER_SOURCE_SHEET,
      rowNumber,
      event.timestamp ? new Date(Number(event.timestamp)) : new Date(),
    ],
  );
}

async function upsertContactAndLead(client, organizationId, businessUnitId, event, details, sourceRowId, rowNumber) {
  if (!businessUnitId) return { contactId: null, leadId: null, reason: 'No business unit found' };

  const existing = await findExistingContact(client, organizationId, details);
  let contactId = existing?.id || null;
  if (contactId) {
    await client.query(
      `
        update contacts
        set
          name = coalesce(nullif($2, ''), name),
          company_name = coalesce(nullif($3, ''), company_name),
          phone = coalesce(nullif($4, ''), phone),
          email = coalesce(nullif($5, ''), email),
          address = coalesce(nullif($6, ''), address),
          source_label = 'Facebook Ads',
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

  const lead = await client.query(
    `
      insert into leads
      (organization_id, business_unit_id, contact_id, source_type, source_name, status, current_stage, original_notes)
      values ($1, $2, $3, 'facebook_lead_ads', 'Facebook Ads', 'New Lead', 'New Lead', $4)
      returning id
    `,
    [
      organizationId,
      businessUnitId,
      contactId,
      `Facebook leadgen_id=${event.leadgenId || 'unknown'} source_row_id=${sourceRowId || 'unknown'}`,
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
      DEFAULT_SOURCE_SHEET,
      rowNumber,
    ],
  );

  return { contactId, leadId, reason: null };
}

async function persistEvent(client, organizationId, batchId, rowNumber, event, metaConfig) {
  if (event.leadgenId && await hasLeadgenId(client, event.leadgenId)) {
    return { inserted: false, skippedReason: 'duplicate_leadgen_id' };
  }

  const fetched = await fetchMetaLeadDetails({ leadgenId: event.leadgenId, pageId: event.pageId, config: metaConfig });
  const graphLead = fetched.ok ? fetched.lead : null;
  const details = normalizeMetaLeadFields(graphLead?.field_data || []);
  const businessUnitId = await resolveBusinessUnitId(client, organizationId, graphLead?.page_id || event.pageId, metaConfig);

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
    [batchId, DEFAULT_SOURCE_SHEET, rowNumber, JSON.stringify(rawValues), rawText],
  );
  const sourceRowId = sourceRow.rows[0]?.id;
  if (!sourceRowId) return { inserted: false };

  const crmWrite = fetched.ok
    ? await upsertContactAndLead(client, organizationId, businessUnitId, event, details, sourceRowId, rowNumber)
    : { contactId: null, leadId: null, reason: fetched.reason };

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
    notes: fetched.ok
      ? 'Webhook captured, Graph fields fetched, and CRM lead created.'
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

  await client.query(
    `
      insert into import_review_items
      (import_batch_id, source_row_id, review_type, reason, review_status, proposed_resolution_json)
      values ($1, $2, 'facebook_lead_review', $3, 'pending', $4::jsonb)
    `,
    [
      batchId,
      sourceRowId,
      fetched.ok && crmWrite.leadId
        ? 'Facebook lead captured and promoted to CRM contact/lead.'
        : `Facebook lead captured but needs review: ${crmWrite.reason || fetched.reason || 'unknown reason'}.`,
      JSON.stringify({
        action: fetched.ok && crmWrite.leadId ? 'verify_facebook_lead' : 'review_facebook_lead',
        normalizedRecordId: normalizedId || null,
        contactId: crmWrite.contactId,
        leadId: crmWrite.leadId,
      }),
    ],
  );

  return { inserted: true, promoted: Boolean(crmWrite.leadId), graphFetched: fetched.ok };
}

async function persistMessengerEvent(client, organizationId, batchId, rowNumber, event, metaConfig) {
  const classification = classifyMessengerEvent(event);
  if (classification.action === 'ignore') {
    return { inserted: false, promoted: false, skippedReason: classification.reason };
  }
  if (event.messageId && await hasMessengerMessageId(client, event.messageId, event.pageId)) {
    return { inserted: false, promoted: false, skippedReason: 'duplicate_messenger_message_id' };
  }

  const profileFetch = await fetchMetaMessengerProfile({ senderId: event.senderId, pageId: event.pageId, config: metaConfig });
  const profile = profileFetch.ok ? profileFetch.profile : null;
  const businessUnitId = await resolveBusinessUnitId(client, organizationId, event.pageId, metaConfig);
  const existing = await findExistingMessengerLead(client, event.senderId, event.pageId);

  const rawValues = {
    source: 'facebook_messenger',
    messenger_sender_id: event.senderId,
    page_id: event.pageId,
    message_id: event.messageId,
    text: event.text || null,
    attachments: event.attachments,
    postback_payload: event.postbackPayload || null,
    timestamp: event.timestamp,
    profile_fetch: profileFetch.ok ? 'ok' : 'failed',
    profile_fetch_reason: profileFetch.ok ? null : profileFetch.reason,
    profile,
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
    [batchId, MESSENGER_SOURCE_SHEET, rowNumber, JSON.stringify(rawValues), rawText],
  );
  const sourceRowId = sourceRow.rows[0]?.id;
  if (!sourceRowId) return { inserted: false, promoted: false, skippedReason: 'Failed to create source row.' };

  let crmWrite = existing || { contactId: null, leadId: null, reason: null };
  let action = 'linked_message';
  if (!existing && classification.action === 'promote') {
    crmWrite = await createMessengerContactAndLead(client, organizationId, businessUnitId, event, profile, sourceRowId);
    action = crmWrite.leadId ? 'created_messenger_lead' : 'review_messenger_lead';
  } else if (classification.action === 'review') {
    action = 'review_messenger_message';
  }

  if (crmWrite.leadId) {
    await logMessengerActivity(client, organizationId, businessUnitId, event, crmWrite, rowNumber);
  }

  const proposedContact = {
    name: messengerDisplayName(profile, event.senderId),
    source_label: 'Facebook Messenger',
    business_unit_id: businessUnitId,
    contact_id: crmWrite.contactId,
    messenger_sender_id: event.senderId,
    page_id: event.pageId,
    profile,
  };
  const proposedLead = {
    source_type: 'facebook_messenger',
    source_name: 'Facebook Messenger',
    messenger_sender_id: event.senderId,
    page_id: event.pageId,
    message_id: event.messageId,
    status: 'New Lead',
    current_stage: 'New Lead',
    business_unit_id: businessUnitId,
    contact_id: crmWrite.contactId,
    lead_id: crmWrite.leadId,
    first_message: event.text || event.postbackPayload || '[Messenger attachment]',
    profile,
    notes: crmWrite.leadId
      ? 'Messenger message captured and linked to CRM lead.'
      : `Messenger message captured but needs review: ${crmWrite.reason || classification.reason || profileFetch.reason || 'unknown reason'}`,
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
      crmWrite.leadId ? 0.8 : 0.3,
      crmWrite.leadId ? 'promoted' : 'needs_review',
    ],
  );
  const normalizedId = normalized.rows[0]?.id || null;

  await client.query(
    `
      insert into import_review_items
      (import_batch_id, source_row_id, review_type, reason, review_status, proposed_resolution_json)
      values ($1, $2, 'facebook_messenger_review', $3, $4, $5::jsonb)
    `,
    [
      batchId,
      sourceRowId,
      crmWrite.leadId
        ? 'Messenger message captured and linked to CRM.'
        : `Messenger message needs review: ${crmWrite.reason || classification.reason || profileFetch.reason || 'unknown reason'}.`,
      crmWrite.leadId ? 'resolved' : 'pending',
      JSON.stringify({
        action,
        normalizedRecordId: normalizedId,
        contactId: crmWrite.contactId,
        leadId: crmWrite.leadId,
      }),
    ],
  );

  return {
    inserted: true,
    promoted: Boolean(crmWrite.leadId && !existing),
    linked: Boolean(crmWrite.leadId && existing),
    profileFetched: profileFetch.ok,
    review: !crmWrite.leadId,
  };
}

export async function GET(request) {
  const metaConfig = getMetaProviderConfig();
  if (!verifyTokenConfigured(metaConfig)) {
    return jsonError(verifyTokenErrorMessage(), 503);
  }

  const url = new URL(request.url);
  const verification = verifyMetaWebhookChallenge({
    mode: url.searchParams.get('hub.mode'),
    verifyToken: url.searchParams.get('hub.verify_token'),
    challenge: url.searchParams.get('hub.challenge'),
    config: metaConfig,
  });

  if (verification.ok) {
    return new NextResponse(verification.challenge, { status: 200 });
  }

  return jsonError('Verification token mismatch.', 403);
}

export async function POST(request) {
  const metaConfig = getMetaProviderConfig();
  if (!verifyTokenConfigured(metaConfig)) {
    return jsonError(verifyTokenErrorMessage(), 503);
  }
  if (!appSecretConfigured(metaConfig)) {
    return jsonError(appSecretErrorMessage(), 503);
  }

  const signature = request.headers.get('x-hub-signature-256');
  const rawBody = await request.text();
  if (!validateMetaAppSecretSignature({ bodyText: rawBody, signatureHeader: signature, config: metaConfig }).ok) {
    return jsonError('Invalid Facebook webhook signature.', 401);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonError('Invalid JSON payload.', 400);
  }

  const leadgenEvents = flattenMetaLeadgenChanges(payload);
  const messengerEvents = flattenMetaMessengerEvents(payload);
  if (!leadgenEvents.length && !messengerEvents.length) {
    return NextResponse.json({ ok: true, received: 0, inserted: 0, skipped: 0 });
  }

  const result = await withClient(async (client) => {
    const organizationId = await resolveOrganizationId(client);
    const received = leadgenEvents.length + messengerEvents.length;
    if (!organizationId) return { inserted: 0, skipped: received, received, reason: 'No organization found' };

    const leadBatchId = leadgenEvents.length ? await findOrCreateBatch(client, organizationId) : null;
    const messengerBatchId = messengerEvents.length
      ? await findOrCreateBatch(client, organizationId, {
        sourceName: 'Facebook Messenger',
        sourceType: 'facebook_messenger',
        filePrefix: 'facebook-messenger',
        sheetName: MESSENGER_SOURCE_SHEET,
      })
      : null;
    if (leadgenEvents.length && !leadBatchId) return { inserted: 0, skipped: received, received, reason: 'Failed to resolve lead import batch' };
    if (messengerEvents.length && !messengerBatchId) return { inserted: 0, skipped: received, received, reason: 'Failed to resolve messenger import batch' };

    let inserted = 0;
    let promoted = 0;
    let graphFetched = 0;
    let profileFetched = 0;
    let linked = 0;
    let review = 0;
    let skipped = 0;

    for (const event of leadgenEvents) {
      const stored = await withSerializedWebhookEvent(client, leadgenEventKey(event), async () => {
        const rowNumber = await lockedNextRowNumber(client, leadBatchId);
        return persistEvent(client, organizationId, leadBatchId, rowNumber, event, metaConfig);
      });
      if (stored.inserted) {
        inserted += 1;
        if (stored.promoted) promoted += 1;
        if (stored.graphFetched) graphFetched += 1;
      } else {
        skipped += 1;
      }
    }

    for (const event of messengerEvents) {
      const stored = await withSerializedWebhookEvent(client, messengerEventKey(event), async () => {
        const rowNumber = await lockedNextRowNumber(client, messengerBatchId);
        return persistMessengerEvent(client, organizationId, messengerBatchId, rowNumber, event, metaConfig);
      });
      if (stored.inserted) {
        inserted += 1;
        if (stored.promoted) promoted += 1;
        if (stored.profileFetched) profileFetched += 1;
        if (stored.linked) linked += 1;
        if (stored.review) review += 1;
      } else {
        skipped += 1;
      }
    }

    return {
      received,
      inserted,
      promoted,
      linked,
      review,
      graphFetched,
      profileFetched,
      skipped,
      leadBatchId,
      messengerBatchId,
    };
  });

  return NextResponse.json({ ok: true, ...result });
}
