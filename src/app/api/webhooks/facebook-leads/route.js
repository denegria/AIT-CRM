import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { Client } from 'pg';

const FB_VERIFY_TOKEN_ENV = 'FACEBOOK_WEBHOOK_VERIFY_TOKEN';
const META_VERIFY_TOKEN_ENV = 'META_WEBHOOK_VERIFY_TOKEN';
const FB_APP_SECRET_ENV = 'FACEBOOK_APP_SECRET';
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

async function hasLeadgenId(client, batchId, leadgenId) {
  if (!leadgenId) return false;
  const result = await client.query(
    `
      select 1
      from import_normalized_records
      where import_batch_id = $1
        and record_type = 'lead'
        and coalesce(proposed_lead_json->>'leadgen_id', '') = $2
      limit 1
    `,
    [batchId, leadgenId],
  );
  return Boolean(result.rows.length);
}

async function persistEvent(client, batchId, rowNumber, event) {
  if (event.leadgenId && await hasLeadgenId(client, batchId, event.leadgenId)) {
    return { inserted: false };
  }

  const rawValues = {
    source: 'facebook_lead_ads',
    leadgen_id: event.leadgenId,
    page_id: event.pageId,
    form_id: event.formId,
    ad_id: event.adId,
    created_time: event.createdTime,
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

  const proposedLead = {
    source_type: 'facebook_webhook',
    source_name: 'Facebook Ads',
    leadgen_id: event.leadgenId,
    page_id: event.pageId,
    form_id: event.formId,
    ad_id: event.adId,
    created_time: event.createdTime,
    status: 'New Lead',
    current_stage: 'New Lead',
    notes: 'Webhook captured. Pull full lead fields with page token workflow.',
  };

  const normalized = await client.query(
    `
      insert into import_normalized_records
      (import_batch_id, source_row_id, record_type, proposed_lead_json, confidence_score, status)
      values ($1, $2, 'lead', $3::jsonb, 0.35, 'needs_review')
      returning id
    `,
    [batchId, sourceRowId, JSON.stringify(proposedLead)],
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
      'Lead captured from webhook. Fetch field_data via Graph API before promotion.',
      JSON.stringify({ action: 'fetch_graph_lead_fields', normalizedRecordId: normalizedId || null }),
    ],
  );

  return { inserted: true };
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
    let skipped = 0;

    for (const event of events) {
      const stored = await persistEvent(client, batchId, rowNumber, event);
      if (stored.inserted) {
        inserted += 1;
        rowNumber += 1;
      } else {
        skipped += 1;
      }
    }

    return { received: events.length, inserted, skipped, batchId };
  });

  return NextResponse.json({ ok: true, ...result });
}
