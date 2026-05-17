import { createHash, timingSafeEqual } from 'crypto';
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
const BODY_SECRET_KEYS = [
  'webhookSecret',
  'webhook_secret',
  'x-ait-webhook-secret',
  'xAitWebhookSecret',
];
const BODY_AUTHORIZATION_KEYS = ['authorization', 'Authorization'];
const AUDIT_REDACTED_KEY_NAMES = new Set([
  'authorization',
  'webhooksecret',
  'webhook-secret',
  'x-ait-webhook-secret',
  'xaitwebhooksecret',
]);
const AUDIT_OMITTED_KEY_NAMES = new Set([
  'content-type',
  'contenttype',
]);
const CORE_FORM_FIELD_KEY_NAMES = new Set([
  'sourcekey',
  'formid',
  'formname',
  'domain',
  'source',
  'sourcename',
  'firstname',
  'lastname',
  'name',
  'fullname',
  'contactname',
  'company',
  'companyname',
  'businessname',
  'email',
  'phone',
  'address',
  'streetaddress',
  'location',
  'city',
  'country',
  'countrycity',
  'message',
  'notes',
  'comments',
  'description',
  'service',
  'servicetype',
  'interest',
  'externalid',
  'submissionid',
  'id',
  'submittedat',
  'createdat',
  'timestamp',
  'businessunitid',
  'businessunit',
  'businessunitname',
  'division',
  'status',
  'currentstage',
  'workflowstage',
  'stage',
  'outreachstate',
  'contactstate',
  'priority',
  'workflowtags',
  'tags',
  'taglist',
  'nextaction',
  'task',
  'todo',
  'age',
  'edad',
]);

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

function authSecretFromValue(value) {
  const text = String(value || '').trim();
  if (text.toLowerCase().startsWith('bearer ')) {
    return text.slice(7).trim();
  }
  return text;
}

function readSubmittedSecrets(request, body) {
  const secrets = [];
  const authorization = request.headers.get('authorization') || '';
  if (authorization) secrets.push(authSecretFromValue(authorization));

  const headerSecret = request.headers.get('x-ait-webhook-secret') || '';
  if (headerSecret) secrets.push(headerSecret.trim());

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const key of BODY_SECRET_KEYS) {
      if (body[key]) secrets.push(String(body[key]).trim());
    }
    for (const key of BODY_AUTHORIZATION_KEYS) {
      if (body[key]) secrets.push(authSecretFromValue(body[key]));
    }
  }

  return secrets.filter(Boolean);
}

function webhookPayloadFromBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
    return body.data;
  }
  return body;
}

function verifyRequest(request, body) {
  const payload = webhookPayloadFromBody(body);
  return [...readSubmittedSecrets(request, body), ...readSubmittedSecrets(request, payload)]
    .some((secret) => safeEqual(secret, process.env[SECRET_ENV]));
}

function secretFingerprint(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  return {
    length: text.length,
    hashPrefix: createHash('sha256').update(text).digest('hex').slice(0, 12),
  };
}

function authFailureDiagnostics(request, body) {
  const payload = webhookPayloadFromBody(body);
  const bodyKeys = body && typeof body === 'object' && !Array.isArray(body)
    ? Object.keys(body)
    : [];
  const payloadKeys = payload && payload !== body && typeof payload === 'object' && !Array.isArray(payload)
    ? Object.keys(payload)
    : [];
  return {
    contentType: request.headers.get('content-type') || '',
    bodyKeys,
    payloadKeys,
    submittedSecretFingerprints: [
      ...readSubmittedSecrets(request, body),
      ...readSubmittedSecrets(request, payload),
    ].map(secretFingerprint).filter(Boolean),
    expectedSecretFingerprint: secretFingerprint(process.env[SECRET_ENV]),
  };
}

function formDataToObject(formData) {
  if (!formData) return null;
  const body = {};
  for (const [key, value] of formData.entries()) {
    const nextValue = typeof value === 'string' ? value : value.name || '';
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      body[key] = Array.isArray(body[key]) ? [...body[key], nextValue] : [body[key], nextValue];
    } else {
      body[key] = nextValue;
    }
  }
  return body;
}

async function parseWebhookBody(request) {
  const contentType = (request.headers.get('content-type') || '').toLowerCase();

  if (contentType.includes('application/json') || contentType.includes('+json')) {
    return request.json().catch(() => null);
  }
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    return request.formData().then(formDataToObject).catch(() => null);
  }

  const jsonBody = await request.clone().json().catch(() => null);
  if (jsonBody && typeof jsonBody === 'object') return jsonBody;

  const formBody = await request.clone().formData().then(formDataToObject).catch(() => null);
  if (formBody && typeof formBody === 'object') return formBody;

  return null;
}

function normalizeAuditKeyName(key) {
  return String(key || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function sanitizeWebhookBodyForAudit(value) {
  if (Array.isArray(value)) return value.map(sanitizeWebhookBodyForAudit);
  if (!value || typeof value !== 'object') return value;

  const sanitized = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const normalizedKey = normalizeAuditKeyName(key);
    if (AUDIT_OMITTED_KEY_NAMES.has(normalizedKey)) continue;
    sanitized[key] = AUDIT_REDACTED_KEY_NAMES.has(normalizedKey)
      ? '[redacted]'
      : sanitizeWebhookBodyForAudit(rawValue);
  }
  return sanitized;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeNoteText(value) {
  return normalizeText(value).replace(/\s+/g, ' ').replace(/\|/g, '/');
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

function normalizeFormFieldValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeFormFieldValue).filter(Boolean).join(', ');
  }
  if (value && typeof value === 'object') {
    const sanitized = sanitizeWebhookBodyForAudit(value);
    return normalizeNoteText(JSON.stringify(sanitized));
  }
  return normalizeNoteText(value);
}

function collectAdditionalFormFields(body) {
  const fields = {};
  const sanitized = sanitizeWebhookBodyForAudit(body);
  for (const [key, value] of Object.entries(sanitized)) {
    const normalizedKey = normalizeAuditKeyName(key);
    if (
      CORE_FORM_FIELD_KEY_NAMES.has(normalizedKey) ||
      AUDIT_REDACTED_KEY_NAMES.has(normalizedKey) ||
      AUDIT_OMITTED_KEY_NAMES.has(normalizedKey)
    ) {
      continue;
    }

    const normalizedValue = normalizeFormFieldValue(value);
    if (normalizedValue) fields[key] = normalizedValue;
  }
  return fields;
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
    address: firstText(body.address, body.streetAddress, body.location, body.city, body.countryCity),
    age: firstText(body.age, body.edad, body.Edad),
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
    formFields: collectAdditionalFormFields(body),
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
    `
      select l.id as lead_id, l.contact_id
      from import_normalized_records nr
      join import_batches ib on ib.id = nr.import_batch_id
      left join leads l on l.id::text = nullif(nr.proposed_lead_json->>'lead_id', '')
      where ib.organization_id = $1
        and ib.source_type = $2
        and nr.record_type = 'lead'
        and coalesce(nr.proposed_lead_json->>'source_type', '') = $2
        and coalesce(nr.proposed_lead_json->>'external_id', '') = $3
        and nullif(nr.proposed_lead_json->>'lead_id', '') is not null
      order by nr.created_at desc
      limit 1
    `,
    [organizationId, SOURCE_TYPE, externalId],
  );
  return result.rows[0]?.lead_id ? result.rows[0] : null;
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
  const formFields = formatFormFieldsForNotes(lead.formFields);
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
    lead.address ? 'address=' + normalizeNoteText(lead.address) : '',
    lead.age ? 'age=' + normalizeNoteText(lead.age) : '',
    formFields ? 'form_fields=' + formFields : '',
    lead.message ? 'message=' + lead.message : '',
  ].filter(Boolean).join(' | ');
}

function formatFormFieldsForNotes(fields) {
  if (!fields || typeof fields !== 'object') return '';
  return Object.entries(fields)
    .map(([key, value]) => [normalizeNoteText(key), normalizeNoteText(value)])
    .filter(([key, value]) => key && value)
    .map(([key, value]) => key + ': ' + value)
    .join('; ');
}

function leadFormDetailsNote(lead) {
  const rows = [];
  if (lead.age) rows.push('Age: ' + normalizeNoteText(lead.age));
  if (lead.address) rows.push('Location: ' + normalizeNoteText(lead.address));
  if (lead.service) rows.push('Interest: ' + normalizeNoteText(lead.service));
  const formFields = formatFormFieldsForNotes(lead.formFields);
  if (formFields) rows.push('Additional form fields: ' + formFields);
  if (!rows.length) return '';
  return ['Website form details:', ...rows.map((row) => '- ' + row)].join('\n');
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

  const detailsNote = leadFormDetailsNote(lead);
  if (detailsNote) {
    await client.query(
      'insert into notes (organization_id, business_unit_id, contact_id, lead_id, body) values ($1, $2, $3, $4, $5)',
      [organizationId, businessUnitId, contactId, leadId, detailsNote],
    );
  }

  return leadId;
}

async function persistImportAudit(client, batchId, rowNumber, body, lead, businessUnitId, contactId, leadId, duplicate) {
  const rawValues = {
    source: SOURCE_TYPE,
    source_key: lead.sourceKey || null,
    source_name: lead.sourceName || SOURCE_NAME,
    external_id: lead.externalId || null,
    business_unit_id: businessUnitId,
    raw: sanitizeWebhookBodyForAudit(body),
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
    address: lead.address || null,
    age: lead.age || null,
    form_fields: lead.formFields && Object.keys(lead.formFields).length ? lead.formFields : null,
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
    acceptedSecretLocations: [
      'Authorization: Bearer <secret>',
      'x-ait-webhook-secret header',
      'x-ait-webhook-secret body field',
      'webhookSecret body field',
    ],
  });
}

export async function POST(request) {
  if (!process.env.DATABASE_URL) {
    return jsonError('DATABASE_URL is required for website lead ingestion.', 503);
  }
  if (!process.env[SECRET_ENV]) {
    return jsonError(SECRET_ENV + ' is required for website lead ingestion.', 503);
  }
  const body = await parseWebhookBody(request);
  if (!verifyRequest(request, body)) {
    console.warn('website_leads_auth_failed', authFailureDiagnostics(request, body));
    return jsonError('Invalid website lead webhook secret.', 401);
  }

  const payload = webhookPayloadFromBody(body);

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return jsonError('JSON object body is required.', 400);
  }

  const lead = normalizeLeadBody(payload);
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

      await client.query('begin');
      try {
        await client.query('select id from import_batches where id = $1 for update', [batchId]);
        const rowNumber = await nextSourceRowNumber(client, batchId);
        if (duplicate) {
          await persistImportAudit(client, batchId, rowNumber, payload, lead, businessUnitId, duplicate.contact_id, duplicate.lead_id, duplicate);
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
        const sourceRowId = await persistImportAudit(client, batchId, rowNumber, payload, lead, businessUnitId, contactId, leadId, null);
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
