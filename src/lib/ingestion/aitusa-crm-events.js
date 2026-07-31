export const AITUSA_CRM_EVENT_SCHEMA_VERSION = 'aitusa-crm-event-v1';

export const AITUSA_CRM_EVENT_TYPES = Object.freeze([
  'placement_started',
  'placement_completed',
  'result_claimed',
  'portal_account_activated',
  'advisor_handoff_requested',
  'ai_practice_started',
  'ai_practice_completed',
  'ai_practice_escalated',
  'ai_practice_limit_reached',
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
  practice: new Set(['sessionId', 'state', 'scenario', 'useCase', 'focusCode', 'outcomeCode', 'limitCode', 'turnCount', 'planVersion']),
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
  const nestedError = validateNestedValues(body);
  if (nestedError) return invalid(nestedError);
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
      // Advisor follow-up approval is purpose-specific. It must never be
      // promoted into a general email-marketing/communication opt-in.
      email: consent.email === true,
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

function validateNestedValues(body) {
  const source = body.source;
  if (!isRecord(source) || !safeText(source.product, 48) || !safeText(source.surface, 48) || !safePath(source.path) || !safeText(source.version, 64)) return 'event_source_values_invalid';
  if (body.contact !== undefined) {
    const contact = body.contact;
    if (contact.firstName !== undefined && !safeText(contact.firstName, 80)) return 'event_contact_first_name_invalid';
    if (contact.email !== undefined && !safeEmail(contact.email)) return 'event_contact_email_invalid';
    if (contact.phone !== undefined && !safePhone(contact.phone)) return 'event_contact_phone_invalid';
  }
  if (body.consent !== undefined) {
    for (const key of ['email', 'sms', 'whatsapp', 'advisorContactEmail']) if (body.consent[key] !== undefined && typeof body.consent[key] !== 'boolean') return `event_consent_${key}_invalid`;
    if (body.consent.policyVersion !== undefined && !safeText(body.consent.policyVersion, 80)) return 'event_consent_policy_version_invalid';
  }
  if (body.ageBand !== undefined && !['under_13', 'age_13_plus'].includes(body.ageBand)) return 'event_age_band_invalid';
  if (body.placement !== undefined) {
    const p = body.placement;
    for (const key of ['resultId', 'resultStatus', 'recommendedLevelKey', 'recommendedLevelLabel', 'scoringContractVersion']) if (p[key] !== undefined && !safeText(p[key], key === 'recommendedLevelLabel' ? 120 : 80)) return `event_placement_${key}_invalid`;
    for (const key of ['answeredQuestionCount', 'skippedQuestionCount']) if (p[key] !== undefined && (!Number.isInteger(p[key]) || p[key] < 0 || p[key] > 1000)) return `event_placement_${key}_invalid`;
    if (p.advisorConfirmationRequired !== undefined && typeof p.advisorConfirmationRequired !== 'boolean') return 'event_placement_advisor_confirmation_required_invalid';
  }
  if (body.practice !== undefined) {
    const p = body.practice;
    for (const key of ['sessionId', 'state', 'scenario', 'useCase', 'focusCode', 'outcomeCode', 'limitCode', 'planVersion']) if (p[key] !== undefined && !safeText(p[key], 80)) return `event_practice_${key}_invalid`;
    if (p.turnCount !== undefined && (!Number.isInteger(p.turnCount) || p.turnCount < 0 || p.turnCount > 5)) return 'event_practice_turn_count_invalid';
  }
  if (body.utm !== undefined) for (const value of Object.values(body.utm)) if (!safeText(value, 160)) return 'event_utm_invalid';
  return null;
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
function safePath(value) { return typeof value === 'string' && value.length > 0 && value.length <= 160 && value.startsWith('/') && !/[?#]/.test(value); }
function safeEmail(value) { return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function safePhone(value) { return typeof value === 'string' && value.length <= 32 && /^[0-9+(). -]+$/.test(value); }
