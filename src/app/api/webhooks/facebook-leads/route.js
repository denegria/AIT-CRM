import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { Client } from 'pg';

const FB_VERIFY_TOKEN_ENV = 'FACEBOOK_WEBHOOK_VERIFY_TOKEN';
const META_VERIFY_TOKEN_ENV = 'META_WEBHOOK_VERIFY_TOKEN';
const FB_APP_SECRET_ENV = 'FACEBOOK_APP_SECRET';
const META_PAGE_ACCESS_TOKEN_ENV = 'META_PAGE_ACCESS_TOKEN';
const GRAPH_API_VERSION = 'v24.0';
const DEFAULT_SOURCE_SHEET = 'facebook_webhook';

function jsonError(message, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getVerifyToken() {
  return process.env[FB_VERIFY_TOKEN_ENV] || process.env[META_VERIFY_TOKEN_ENV] || '';
}

function verifyTokenConfigured() {
  return Boolean(getVerifyToken());
}

function verifyTokenErrorMessage() {
  return `${FB_VERIFY_TOKEN_ENV} or ${META_VERIFY_TOKEN_ENV} is required before Facebook lead webhook verification can run.`;
}

function signatureIsValid(bodyText, signatureHeader) {
  const appSecret = process.env[FB_APP_SECRET_ENV];
  if (!appSecret) return true;
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

  const signature = signatureHeader.slice('sha256='.length);
  const expected = createHmac('sha256', appSecret).update(bodyText).digest('hex');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
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

async function resolveBusinessUnitId(client, organizationId) {
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

async function findOrCreateBatch(client, organizationId) {
  const day = new Date().toISOString().slice(0, 10);
  const fileName = `facebook-webhook-${day}`;

  const existing = await client.query(
    `
      select id
      from import_batches
      where organization_id = $1 and source_type = 'facebook_leads' and file_name = $2
      order by created_at desc
      limit 1
    `,
    [organizationId, fileName],
  );
  if (existing.rows[0]?.id) return existing.rows[0].id;

  const inserted = await client.query(
    `
      insert into import_batches
      (organization_id, source_name, source_type, file_name, sheet_name, status)
      values ($1, 'Facebook Lead Ads', 'facebook_leads', $2, $3, 'staging')
      returning id
    `,
    [organizationId, fileName, DEFAULT_SOURCE_SHEET],
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

function flattenLeadgenChanges(payload) {
  if (payload?.object !== 'page') return [];
  const events = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change?.field !== 'leadgen') continue;
      const value = change.value || {};
      events.push({
        entryId: entry.id || '',
        leadgenId: value.leadgen_id || '',
        pageId: value.page_id || entry.id || '',
        formId: value.form_id || '',
        adId: value.ad_id || '',
        createdTime: value.created_time || null,
        raw: { entry, change },
      });
    }
  }
  return events;
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

function firstField(fields, names) {
  for (const name of names) {
    const field = fields.find((item) => item.key === name);
    const value = field?.values?.[0];
    if (value) return String(value).trim();
  }
  return '';
}

function normalizeLeadFields(fieldData = []) {
  const fields = fieldData.map((field) => ({
    key: String(field?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
    values: Array.isArray(field?.values) ? field.values : [],
  }));

  const firstName = firstField(fields, ['first_name', 'firstname']);
  const lastName = firstField(fields, ['last_name', 'lastname']);
  const fullName = firstField(fields, ['full_name', 'name', 'nombre', 'contact_name']) || [firstName, lastName].filter(Boolean).join(' ');
  const email = firstField(fields, ['email', 'email_address', 'correo', 'correo_electronico']);
  const phone = firstField(fields, ['phone_number', 'phone', 'mobile_phone_number', 'telefono', 'celular']);
  const company = firstField(fields, ['company_name', 'company', 'business_name', 'empresa']);
  const address = firstField(fields, ['street_address', 'address', 'direccion']);

  return {
    name: fullName || email || phone || 'Facebook Lead',
    email,
    phone,
    company,
    address,
    field_data: fieldData,
  };
}

async function fetchLeadDetails(leadgenId) {
  const accessToken = process.env[META_PAGE_ACCESS_TOKEN_ENV];
  if (!leadgenId || !accessToken) {
    return { ok: false, reason: `${META_PAGE_ACCESS_TOKEN_ENV} missing` };
  }

  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(leadgenId)}`);
  url.searchParams.set('fields', 'id,created_time,ad_id,form_id,page_id,field_data');
  url.searchParams.set('access_token', accessToken);

  const response = await fetch(url, { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      reason: body?.error?.message || `Graph API returned ${response.status}`,
      graphStatus: response.status,
    };
  }

  return { ok: true, lead: body };
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

async function persistEvent(client, organizationId, batchId, rowNumber, event) {
  if (event.leadgenId && await hasLeadgenId(client, event.leadgenId)) {
    return { inserted: false, skippedReason: 'duplicate_leadgen_id' };
  }

  const fetched = await fetchLeadDetails(event.leadgenId);
  const graphLead = fetched.ok ? fetched.lead : null;
  const details = normalizeLeadFields(graphLead?.field_data || []);
  const businessUnitId = await resolveBusinessUnitId(client, organizationId);

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

export async function GET(request) {
  if (!verifyTokenConfigured()) {
    return jsonError(verifyTokenErrorMessage(), 503);
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const verifyToken = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && verifyToken === getVerifyToken()) {
    return new NextResponse(challenge || '', { status: 200 });
  }

  return jsonError('Verification token mismatch.', 403);
}

export async function POST(request) {
  if (!verifyTokenConfigured()) {
    return jsonError(verifyTokenErrorMessage(), 503);
  }

  const signature = request.headers.get('x-hub-signature-256');
  const rawBody = await request.text();
  if (!signatureIsValid(rawBody, signature)) {
    return jsonError('Invalid Facebook webhook signature.', 401);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonError('Invalid JSON payload.', 400);
  }

  const events = flattenLeadgenChanges(payload);
  if (!events.length) {
    return NextResponse.json({ ok: true, received: 0, inserted: 0, skipped: 0 });
  }

  const result = await withClient(async (client) => {
    const organizationId = await resolveOrganizationId(client);
    if (!organizationId) return { inserted: 0, skipped: events.length, received: events.length, reason: 'No organization found' };

    const batchId = await findOrCreateBatch(client, organizationId);
    if (!batchId) return { inserted: 0, skipped: events.length, received: events.length, reason: 'Failed to resolve import batch' };

    let rowNumber = await nextRowNumber(client, batchId);
    let inserted = 0;
    let promoted = 0;
    let graphFetched = 0;
    let skipped = 0;

    for (const event of events) {
      const stored = await persistEvent(client, organizationId, batchId, rowNumber, event);
      if (stored.inserted) {
        inserted += 1;
        if (stored.promoted) promoted += 1;
        if (stored.graphFetched) graphFetched += 1;
        rowNumber += 1;
      } else {
        skipped += 1;
      }
    }

    return { received: events.length, inserted, promoted, graphFetched, skipped, batchId };
  });

  return NextResponse.json({ ok: true, ...result });
}
