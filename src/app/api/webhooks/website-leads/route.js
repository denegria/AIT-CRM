import { NextResponse } from 'next/server';
import { Client } from 'pg';
import {
  WEBSITE_LEAD_ACCEPTED_SECRET_LOCATIONS,
  WEBSITE_LEAD_SECRET_HEADER,
  hasWebsiteLeadContactSignal,
  ingestWebsiteLeadSubmission,
  normalizeWebsiteLeadSubmission,
  resolveSingleOrganizationId,
  resolveWebsiteLeadBusinessUnit,
  verifyWebsiteLeadSecret,
  websiteLeadAuthFailureDiagnostics,
} from '@/lib/ingestion/website-leads.js';
import { externalIoDisabled, externalIoDisabledResponse } from '@/lib/runtime-safety.js';
import {
  AITUSA_CRM_EVENT_SCHEMA_VERSION,
  aitUsaEventToWebsiteLeadBody,
  isAitUsaLeadEvent,
  validateAitUsaCrmEvent,
} from '@/lib/ingestion/aitusa-crm-events.js';
import { ingestAitUsaCrmEvent } from '@/lib/ingestion/aitusa-crm-event-ingestion.js';

const SECRET_ENV = 'WEBSITE_LEADS_WEBHOOK_SECRET';
const AITUSA_SECRET_ENV = 'AITUSA_CRM_WEBHOOK_SECRET';
const BUSINESS_UNIT_MAP_ENV = 'WEBSITE_LEADS_BUSINESS_UNIT_MAP';

function jsonError(message, status) {
  return NextResponse.json({ error: message }, { status });
}

function isConfigured() {
  return Boolean(process.env.DATABASE_URL && process.env[SECRET_ENV]);
}

function isAitUsaConfigured() {
  return Boolean(process.env.DATABASE_URL && process.env[AITUSA_SECRET_ENV]);
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
  return resolveSingleOrganizationId(client);
}

function websiteLeadSecretInputs(request) {
  return {
    authorizationHeader: request.headers.get('authorization') || '',
    headerSecret: request.headers.get(WEBSITE_LEAD_SECRET_HEADER) || '',
  };
}

export async function GET() {
  if (externalIoDisabled(process.env)) {
    return NextResponse.json(externalIoDisabledResponse(), { status: 503 });
  }
  return NextResponse.json({
    ok: true,
    configured: isConfigured(),
    aitUsaEventsConfigured: isAitUsaConfigured(),
    acceptedSecretLocations: WEBSITE_LEAD_ACCEPTED_SECRET_LOCATIONS,
  });
}

export async function POST(request) {
  if (externalIoDisabled(process.env)) {
    return NextResponse.json(externalIoDisabledResponse(), { status: 503 });
  }
  if (!process.env.DATABASE_URL) {
    return jsonError('DATABASE_URL is required for website lead ingestion.', 503);
  }
  const body = await parseWebhookBody(request);
  const isAitUsaEvent = body?.schemaVersion === AITUSA_CRM_EVENT_SCHEMA_VERSION;
  const secretEnvironment = isAitUsaEvent ? AITUSA_SECRET_ENV : SECRET_ENV;
  if (!process.env[secretEnvironment]) {
    return jsonError(secretEnvironment + ' is required for website lead ingestion.', 503);
  }
  const secretInputs = websiteLeadSecretInputs(request);
  if (!verifyWebsiteLeadSecret({
    ...secretInputs,
    body,
    expectedSecret: process.env[secretEnvironment],
  })) {
    console.warn('website_leads_auth_failed', websiteLeadAuthFailureDiagnostics({
      ...secretInputs,
      contentType: request.headers.get('content-type') || '',
      body,
      expectedSecret: process.env[secretEnvironment],
    }));
    return jsonError('Invalid website lead webhook secret.', 401);
  }

  // Legacy AIT USA forms used these source labels before the event protocol.
  // Only the explicit schema marker opts into the strict event branch.
  const aitUsaEvent = isAitUsaEvent
    ? validateAitUsaCrmEvent(body)
    : null;
  if (aitUsaEvent && !aitUsaEvent.ok) {
    return jsonError(`Invalid AIT USA CRM event: ${aitUsaEvent.error}`, 422);
  }
  if (aitUsaEvent?.ok) {
    try {
      return await withClient(async (client) => {
        const organizationId = await getOrganizationId(client);
        if (!organizationId) return jsonError('No CRM organization exists.', 503);
        const leadBody = isAitUsaLeadEvent(aitUsaEvent.event)
          ? aitUsaEventToWebsiteLeadBody(aitUsaEvent.event)
          : null;
        const normalizedLead = leadBody ? normalizeWebsiteLeadSubmission(leadBody) : null;
        const businessUnit = await resolveWebsiteLeadBusinessUnit(client, {
          organizationId,
          lead: normalizedLead?.lead || { sourceKey: 'aitusa_refresh', sourceName: 'AIT USA Refresh' },
          businessUnitMap: parseJsonEnv(BUSINESS_UNIT_MAP_ENV),
        });
        const businessUnitId = businessUnit?.id || null;
        if (!businessUnitId) return jsonError('No active business unit exists for website lead ingestion.', 503);
        if (normalizedLead) {
          if (!hasWebsiteLeadContactSignal(normalizedLead.lead)) {
            return jsonError('At least one of email, phone, or message is required.', 400);
          }
          const result = await ingestWebsiteLeadSubmission(client, {
            organizationId,
            businessUnitId,
            businessUnit,
            body: normalizedLead.payload,
            lead: normalizedLead.lead,
          });
          return NextResponse.json({
            ok: true,
            acknowledged: true,
            duplicate: result.duplicate,
            review: result.review === true,
            contactId: result.contactId,
            leadId: result.leadId,
          }, { status: result.duplicate || result.review ? 202 : 201 });
        }
        const result = await ingestAitUsaCrmEvent(client, { organizationId, businessUnitId, businessUnit, event: aitUsaEvent.event });
        return NextResponse.json({ ok: true, acknowledged: result.acknowledged === true, duplicate: result.duplicate, review: result.review === true, contactId: result.contactId, leadId: result.leadId }, { status: result.duplicate || result.review ? 202 : 201 });
      });
    } catch (error) {
      return jsonError(error.message || 'Failed to ingest AIT USA CRM event.', 500);
    }
  }
  const { payload, lead } = normalizeWebsiteLeadSubmission(body);

  if (!payload || !lead) {
    return jsonError('JSON object body is required.', 400);
  }
  if (!hasWebsiteLeadContactSignal(lead)) {
    return jsonError('At least one of email, phone, or message is required.', 400);
  }

  try {
    return await withClient(async (client) => {
      const organizationId = await getOrganizationId(client);
      if (!organizationId) return jsonError('No CRM organization exists.', 503);

      const businessUnit = await resolveWebsiteLeadBusinessUnit(client, {
        organizationId,
        lead,
        businessUnitMap: parseJsonEnv(BUSINESS_UNIT_MAP_ENV),
      });
      const businessUnitId = businessUnit?.id || null;
      if (!businessUnitId) return jsonError('No active business unit exists for website lead ingestion.', 503);

      const result = await ingestWebsiteLeadSubmission(client, {
        organizationId,
        businessUnitId,
        businessUnit,
        body: payload,
        lead,
      });

      if (result.review) {
        return NextResponse.json({
          ok: true,
          duplicate: result.duplicate === true,
          review: true,
          contactId: null,
          leadId: null,
        }, { status: 202 });
      }

      if (result.duplicate) {
        return NextResponse.json({
          ok: true,
          duplicate: true,
          contactId: result.contactId,
          leadId: result.leadId,
        }, { status: 202 });
      }

      return NextResponse.json({
        ok: true,
        duplicate: false,
        contactId: result.contactId,
        leadId: result.leadId,
        businessUnitId: result.businessUnitId,
      }, { status: 201 });
    });
  } catch (error) {
    return jsonError(error.message || 'Failed to ingest website lead.', 500);
  }
}
