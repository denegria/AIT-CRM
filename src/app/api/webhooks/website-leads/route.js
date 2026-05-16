import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { Client } from 'pg';
import { normalizeWorkflowTags } from '@/lib/sales-workflow';

const SECRET_ENV = 'WEBSITE_LEADS_WEBHOOK_SECRET';
const BUSINESS_UNIT_MAP_ENV = 'WEBSITE_LEADS_BUSINESS_UNIT_MAP';
const SOURCE_TYPE = 'website_form';
const SOURCE_NAME = 'Website Form';
const BATCH_SOURCE_NAME = 'Website Leads';
const BATCH_FILE_NAME = 'website-leads-webhook.json';
const SOURCE_SHEET = 'Website Leads Webhook';

function jsonError(message, status) {
  return NextResponse.json({ error: message }, { status });
}

function isConfigured() {
  return Boolean(process.env.DATABASE_URL && process.env[SECRET_ENV]);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function readSubmittedSecret(request) {
  const authorization = request.headers.get('authorization') || '';
  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }
  return request.headers.get('x-ait-webhook-secret') || '';
}

function verifyRequest(request) {
  return safeEqual(readSubmittedSecret(request), process.env[SECRET_ENV]);
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizePhone(value) {
  return normalizeText(value).replace(/[^\d+]/g, '');
}

function parseJsonEnv(name) {
  const raw = process.env[name];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function firstText(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return '';
}

function sourceKeyForBody(body) {
  return firstText(
    body.sourceKey,
    body.formId,
    body.formName,
    body.domain,
    body.source,
    body.sourceName,
  );
}

function normalizeLeadBody(body) {
  const firstName = normalizeText(body.firstName);
  const lastName = normalizeText(body.lastName);
  const combinedName = [firstName, lastName].filter(Boolean).join(' ');
  const name = firstText(body.name, body.fullName, combinedName, body.contactName, body.email, body.phone, 'Website Lead');
  const sourceKey = sourceKeyForBody(body);

  return {
    name,
    company: firstText(body.company, body.companyName, body.businessName),
    email: normalizeEmail(body.email),
    phone: normalizePhone(body.phone),
    address: firstText(body.address, body.streetAddress),
    message: firstText(body.message, body.notes, body.comments, body.description),
    service: firstText(body.service, body.serviceType, body.interest),
    sourceKey,
    sourceName: firstText(body.sourceName, body.source, body.formName, SOURCE_NAME),
    externalId: firstText(body.externalId, body.submissionId, body.id),
    submittedAt: firstText(body.submittedAt, body.createdAt, body.timestamp),
    businessUnitHint: firstText(body.businessUnitId, body.businessUnit, body.businessUnitName, body.division),
    status: firstText(body.status, 'New Lead'),
    currentStage: firstText(body.currentStage, body.workflowStage, body.stage, body.status, 'New Lead'),
    outreachState: firstText(body.outreachState, body.contactState),
    priority: firstText(body.priority),
    tags: normalizeWorkflowTags(body.workflowTags || body.tags || body.tagList),
    nextAction: firstText(body.nextAction, body.task, body.todo),
  };
}

function parseTimestamp(value) {
  if (!value) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

async function withClient(handler) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await handler(client);
  } finally {
    await client.end();
  }
}

async function getOrganizationId(client) {
  const result = await client.query('select id from organizations order by created_at asc limit 1');
  return result.rows[0]?.id || null;
}

async function resolveBusinessUnitId(client, organizationId, lead) {
  const map = parseJsonEnv(BUSINESS_UNIT_MAP_ENV);
  const mapped = map[lead.sourceKey] || map[lead.sourceName] || map.default || '';
  const requested = lead.businessUnitHint || mapped;

  if (requested) {
    const byId = await client.query(
      'select id from business_units where organization_id = $1 and id::text = $2 and is_active = true limit 1',
      [organizationId, requested],
    );
    if (byId.rows[0]?.id) return byId.rows[0].id;

    const byName = await client.query(
      'select id from business_units where organization_id = $1 and lower(name) = lower($2) and is_active = true limit 1',
      [organizationId, requested],
    );
    if (byName.rows[0]?.id) return byName.rows[0].id;
  }

  const fallback = await client.query(
    'select id from business_units where organization_id = $1 and is_active = true order by name asc limit 1',
    [organizationId],
  );
  return fallback.rows[0]?.id || null;
}

async function findExistingContact(client, organizationId, lead) {
  if (lead.email) {
    const result = await client.query(
      'select id from contacts where organization_id = $1 and lower(email) = lower($2) order by updated_at desc limit 1',
      [organizationId, lead.email],
    );
    if (result.rows[0]) return result.rows[0];
  }

  if (lead.phone) {
    const result = await client.query(
      'select id from contacts where organization_id = $1 and regexp_replace(coalesce(phone, \'\'), \'[^0-9+]\', \'\', \'g\') = $2 order by updated_at desc limit 1',
      [organizationId, lead.phone],
    );
    if (result.rows[0]) return result.rows[0];
  }

  return null;
}

async function findDuplicateSubmission(client, organizationId, externalId) {
  if (!externalId) return null;
  const result = await client.query(
    'select l.id as lead_id, l.contact_id from leads l where l.organization_id = $1 and l.source_type = $2 and l.original_notes like $3 order by l.created_at desc limit 1',
    [organizationId, SOURCE_TYPE, '%external_id=' + externalId + '%'],
  );
  return result.rows[0] || null;
}

async function getOrCreateBatch(client, organizationId) {
  const existing = await client.query(
    'select id from import_batches where organization_id = $1 and source_type = $2 and source_name = $3 order by created_at desc limit 1',
    [organizationId, SOURCE_TYPE, BATCH_SOURCE_NAME],
  );
  if (existing.rows[0]?.id) return existing.rows[0].id;

  const inserted = await client.query(
    'insert into import_batches (organization_id, source_name, source_type, file_name, status) values ($1, $2, $3, $4, $5) returning id',
    [organizationId, BATCH_SOURCE_NAME, SOURCE_TYPE, BATCH_FILE_NAME, 'active'],
  );
  return inserted.rows[0]?.id || null;
}

async function nextSourceRowNumber(client, batchId) {
  const result = await client.query(
    'select coalesce(max(source_row_number), 0)::int as max_row from import_source_rows where import_batch_id = $1',
    [batchId],
  );
  return Number(result.rows[0]?.max_row || 0) + 1;
}

async function upsertContact(client, organizationId, businessUnitId, lead) {
  const existing = await findExistingContact(client, organizationId, lead);
  if (existing?.id) {
    await client.query(
      'update contacts set name = coalesce(nullif($2, \'\'), name), company_name = coalesce(nullif($3, \'\'), company_name), phone = coalesce(nullif($4, \'\'), phone), email = coalesce(nullif($5, \'\'), email), address = coalesce(nullif($6, \'\'), address), source_label = $7, primary_business_unit_id = coalesce(primary_business_unit_id, $8), updated_at = now() where id = $1',
      [existing.id, lead.name, lead.company, lead.phone, lead.email, lead.address, SOURCE_NAME, businessUnitId],
    );
    return existing.id;
  }

  const inserted = await client.query(
    'insert into contacts (organization_id, primary_business_unit_id, name, company_name, phone, email, address, source_label) values ($1, $2, $3, nullif($4, \'\'), nullif($5, \'\'), nullif($6, \'\'), nullif($7, \'\'), $8) returning id',
    [organizationId, businessUnitId, lead.name, lead.company, lead.phone, lead.email, lead.address, SOURCE_NAME],
  );
  return inserted.rows[0]?.id || null;
}

function originalNotesForLead(lead, sourceRowId) {
  const tags = lead.tags?.length ? lead.tags : [];
  return [
    'website_form',
    'external_id=' + (lead.externalId || 'none'),
    'source_key=' + (lead.sourceKey || 'none'),
    'source_row_id=' + (sourceRowId || 'unknown'),
    'current_stage=' + (lead.currentStage || lead.status || 'New Lead'),
    lead.outreachState ? 'outreach_state=' + lead.outreachState : '',
    lead.priority ? 'priority=' + lead.priority : '',
    tags.length ? 'tags=' + tags.join(';') : '',
    lead.nextAction ? 'next_action=' + lead.nextAction : '',
    lead.service ? 'service=' + lead.service : '',
    lead.message ? 'message=' + lead.message : '',
  ].filter(Boolean).join(' | ');
}

async function persistLead(client, organizationId, businessUnitId, contactId, lead, sourceRowId, rowNumber) {
  const inserted = await client.query(
    'insert into leads (organization_id, business_unit_id, contact_id, source_type, source_name, status, current_stage, original_notes) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id',
    [
      organizationId,
      businessUnitId,
      contactId,
      SOURCE_TYPE,
      lead.sourceName || SOURCE_NAME,
      lead.status || 'New Lead',
      lead.currentStage || lead.status || 'New Lead',
      originalNotesForLead(lead, sourceRowId),
    ],
  );
  const leadId = inserted.rows[0]?.id || null;

  await client.query(
    'insert into activity_events (organization_id, business_unit_id, contact_id, lead_id, event_type, message, source_sheet, source_row, occurred_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [
      organizationId,
      businessUnitId,
      contactId,
      leadId,
      'website_lead_captured',
      lead.message || 'Website lead submitted.',
      SOURCE_SHEET,
      rowNumber,
      parseTimestamp(lead.submittedAt),
    ],
  );

  return leadId;
}

async function persistImportAudit(client, batchId, rowNumber, body, lead, businessUnitId, contactId, leadId, duplicate) {
  const rawValues = {
    source: SOURCE_TYPE,
    source_key: lead.sourceKey || null,
    source_name: lead.sourceName || SOURCE_NAME,
    external_id: lead.externalId || null,
    business_unit_id: businessUnitId,
    raw: body,
  };

  const sourceRow = await client.query(
    'insert into import_source_rows (import_batch_id, source_sheet, source_row_number, raw_values_json, raw_text, parse_status) values ($1, $2, $3, $4::jsonb, $5, $6) returning id',
    [batchId, SOURCE_SHEET, rowNumber, JSON.stringify(rawValues), JSON.stringify(rawValues), 'parsed'],
  );
  const sourceRowId = sourceRow.rows[0]?.id || null;

  const proposedContact = {
    name: lead.name,
    email: lead.email || null,
    phone: lead.phone || null,
    company_name: lead.company || null,
    address: lead.address || null,
    source_label: SOURCE_NAME,
    business_unit_id: businessUnitId,
    contact_id: contactId,
  };
  const proposedLead = {
    source_type: SOURCE_TYPE,
    source_name: lead.sourceName || SOURCE_NAME,
    source_key: lead.sourceKey || null,
    external_id: lead.externalId || null,
    service: lead.service || null,
    message: lead.message || null,
    status: lead.status || 'New Lead',
    current_stage: lead.currentStage || lead.status || 'New Lead',
    outreach_state: lead.outreachState || null,
    priority: lead.priority || null,
    tags: lead.tags?.length ? lead.tags : null,
    next_action: lead.nextAction || null,
    business_unit_id: businessUnitId,
    contact_id: contactId,
    lead_id: leadId,
    duplicate_lead_id: duplicate?.lead_id || null,
  };

  const normalized = await client.query(
    'insert into import_normalized_records (import_batch_id, source_row_id, record_type, proposed_contact_json, proposed_lead_json, confidence_score, status) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7) returning id',
    [
      batchId,
      sourceRowId,
      'lead',
      JSON.stringify(proposedContact),
      JSON.stringify(proposedLead),
      duplicate ? 0.5 : 0.85,
      duplicate ? 'needs_review' : 'promoted',
    ],
  );

  await client.query(
    'insert into import_review_items (import_batch_id, source_row_id, review_type, reason, review_status, proposed_resolution_json) values ($1, $2, $3, $4, $5, $6::jsonb)',
    [
      batchId,
      sourceRowId,
      'website_lead_review',
      duplicate ? 'Website lead matched an existing external submission id.' : 'Website lead captured and promoted to CRM.',
      duplicate ? 'pending' : 'resolved',
      JSON.stringify({
        action: duplicate ? 'review_duplicate_website_lead' : 'verify_website_lead',
        normalizedRecordId: normalized.rows[0]?.id || null,
        contactId,
        leadId,
        duplicateLeadId: duplicate?.lead_id || null,
      }),
    ],
  );

  return sourceRowId;
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: isConfigured(),
    requiredSecretHeader: 'Authorization: Bearer <secret> or x-ait-webhook-secret',
  });
}

export async function POST(request) {
  if (!process.env.DATABASE_URL) {
    return jsonError('DATABASE_URL is required for website lead ingestion.', 503);
  }
  if (!process.env[SECRET_ENV]) {
    return jsonError(SECRET_ENV + ' is required for website lead ingestion.', 503);
  }
  if (!verifyRequest(request)) {
    return jsonError('Invalid website lead webhook secret.', 401);
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonError('JSON object body is required.', 400);
  }

  const lead = normalizeLeadBody(body);
  if (!lead.email && !lead.phone && !lead.message) {
    return jsonError('At least one of email, phone, or message is required.', 400);
  }

  try {
    return await withClient(async (client) => {
      const organizationId = await getOrganizationId(client);
      if (!organizationId) return jsonError('No CRM organization exists.', 503);

      const businessUnitId = await resolveBusinessUnitId(client, organizationId, lead);
      if (!businessUnitId) return jsonError('No active business unit exists for website lead ingestion.', 503);

      const duplicate = await findDuplicateSubmission(client, organizationId, lead.externalId);
      const batchId = await getOrCreateBatch(client, organizationId);
      const rowNumber = await nextSourceRowNumber(client, batchId);

      await client.query('begin');
      try {
        if (duplicate) {
          await persistImportAudit(client, batchId, rowNumber, body, lead, businessUnitId, duplicate.contact_id, duplicate.lead_id, duplicate);
          await client.query('commit');
          return NextResponse.json({
            ok: true,
            duplicate: true,
            contactId: duplicate.contact_id,
            leadId: duplicate.lead_id,
          }, { status: 202 });
        }

        const contactId = await upsertContact(client, organizationId, businessUnitId, lead);
        const leadId = await persistLead(client, organizationId, businessUnitId, contactId, lead, 'pending', rowNumber);
        const sourceRowId = await persistImportAudit(client, batchId, rowNumber, body, lead, businessUnitId, contactId, leadId, null);
        await client.query(
          'update leads set original_notes = replace(original_notes, $1, $2), updated_at = now() where id = $3',
          ['source_row_id=pending', 'source_row_id=' + sourceRowId, leadId],
        );
        await client.query('commit');

        return NextResponse.json({
          ok: true,
          duplicate: false,
          contactId,
          leadId,
          businessUnitId,
        }, { status: 201 });
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    });
  } catch (error) {
    return jsonError(error.message || 'Failed to ingest website lead.', 500);
  }
}
