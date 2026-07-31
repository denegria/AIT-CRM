export const AITUSA_CRM_EVENT_SCHEMA_VERSION = 'aitusa-crm-event-v1';

export const AITUSA_CRM_EVENT_TYPES = Object.freeze([
  'placement_started',
  'placement_completed',
  'result_claimed',
  'portal_account_activated',
  'advisor_handoff_requested',
  'ai_practice_completed',
]);

const EVENT_KEYS = new Set([
  'schemaVersion', 'eventId', 'eventType', 'idempotencyKey', 'correlationId',
  'occurredAt', 'source', 'contact', 'consent', 'ageBand', 'goalKeys',
  'placement', 'practice', 'utm',
]);
const NESTED_KEYS = Object.freeze({
  source: new Set(['product', 'surface', 'path', 'version']),
  contact: new Set(['firstName', 'email', 'phone']),
  consent: new Set(['email', 'sms', 'whatsapp', 'advisorContactEmail', 'policyVersion']),
  placement: new Set(['resultId', 'resultStatus', 'recommendedLevelKey', 'recommendedLevelLabel', 'answeredQuestionCount', 'skippedQuestionCount', 'advisorConfirmationRequired', 'scoringContractVersion']),
  practice: new Set(['sessionId', 'state', 'scenario', 'focusCode', 'turnCount', 'planVersion']),
  utm: new Set(['source', 'medium', 'campaign', 'term', 'content']),
});
const FORBIDDEN_KEY = /(?:selected[_-]?answers?|raw[_-]?answers?|writing|resume|claim[_-]?token|workos|audio|transcript|conversation|prompt|generated|provider|secret|trace|usage|contact[_-]?id)/i;

export function validateAitUsaCrmEvent(body) {
  if (!isRecord(body)) return invalid('event_body_required');
  for (const key of Object.keys(body)) {
    if (!EVENT_KEYS.has(key)) return invalid(`event_field_not_allowed:${key}`);
  }
  if (body.schemaVersion !== AITUSA_CRM_EVENT_SCHEMA_VERSION) return invalid('event_schema_invalid');
  if (!AITUSA_CRM_EVENT_TYPES.includes(body.eventType)) return invalid('event_type_invalid');
  if (!safeIdentifier(body.eventId) || !safeIdentifier(body.idempotencyKey) || !safeIdentifier(body.correlationId)) {
    return invalid('event_identifier_invalid');
  }
  if (!isIsoDate(body.occurredAt)) return invalid('event_occurred_at_invalid');
  for (const [section, allowed] of Object.entries(NESTED_KEYS)) {
    if (body[section] === undefined) continue;
    if (!isRecord(body[section])) return invalid(`event_${section}_invalid`);
    for (const key of Object.keys(body[section])) {
      if (!allowed.has(key) || FORBIDDEN_KEY.test(key)) return invalid(`event_field_not_allowed:${section}.${key}`);
    }
  }
  if (body.goalKeys !== undefined && (!Array.isArray(body.goalKeys) || body.goalKeys.some((value) => !safeText(value, 80)))) {
    return invalid('event_goal_keys_invalid');
  }
  const forbidden = findForbiddenKey(body);
  if (forbidden) return invalid(`event_field_forbidden:${forbidden}`);
  return { ok: true, event: structuredClone(body) };
}

export function aitUsaEventToWebsiteLeadBody(event) {
  const contact = event.contact || {};
  const consent = event.consent || {};
  return {
    submissionType: 'website_lead',
    source: 'AIT USA Refresh',
    sourceKey: 'aitusa_refresh',
    externalId: event.idempotencyKey,
    submittedAt: event.occurredAt,
    firstName: contact.firstName,
    email: contact.email,
    phone: contact.phone,
    communicationConsent: {
      email: consent.email === true || consent.advisorContactEmail === true,
      sms: consent.sms === true,
      whatsapp: consent.whatsapp === true,
    },
    communicationPreference: consent.advisorContactEmail === true ? 'email' : undefined,
    placement: event.placement,
    status: 'New Lead',
    currentStage: 'New Lead',
    event: {
      eventType: event.eventType,
      eventId: event.eventId,
      correlationId: event.correlationId,
      source: event.source,
      ageBand: event.ageBand,
      goalKeys: event.goalKeys,
      practice: event.practice,
      utm: event.utm,
    },
  };
}

function findForbiddenKey(value, prefix = '') {
  if (Array.isArray(value)) return value.map((item, index) => findForbiddenKey(item, `${prefix}[${index}]`)).find(Boolean) || null;
  if (!isRecord(value)) return null;
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (FORBIDDEN_KEY.test(key)) return path;
    const found = findForbiddenKey(nested, path);
    if (found) return found;
  }
  return null;
}

function invalid(error) { return { ok: false, error }; }
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function safeIdentifier(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{12,160}$/.test(value); }
function safeText(value, limit) { return typeof value === 'string' && value.length > 0 && value.length <= limit; }
function isIsoDate(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
