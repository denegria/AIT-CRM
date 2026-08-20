export const AITUSA_CRM_EVENT_SCHEMA_VERSION = 'aitusa-crm-event-v1';

export const AITUSA_CRM_EVENT_TYPES = Object.freeze([
  'contact_form_submitted',
  'callback_requested',
  'placement_started',
  'placement_completed',
  'result_claimed',
  'portal_account_activated',
  'advisor_handoff_requested',
  'ai_practice_started',
  'ai_practice_completed',
  'ai_practice_escalated',
  'ai_practice_limit_reached',
  'placement_review_created',
  'placement_review_started',
  'placement_review_confirmed',
  'placement_review_adjusted',
  'placement_review_additional_review_required',
]);

export const AITUSA_PLACEMENT_REVIEW_EVENT_TYPES = Object.freeze([
  'placement_review_created',
  'placement_review_started',
  'placement_review_confirmed',
  'placement_review_adjusted',
  'placement_review_additional_review_required',
]);

export const AITUSA_PLACEMENT_REVIEW_EVENT_STATES = Object.freeze({
  placement_review_created: 'pending',
  placement_review_started: 'in_review',
  placement_review_confirmed: 'confirmed',
  placement_review_adjusted: 'adjusted',
  placement_review_additional_review_required: 'additional_review_required',
});

const EVENT_KEYS = new Set([
  'schemaVersion', 'eventId', 'eventType', 'idempotencyKey', 'correlationId',
  'occurredAt', 'source', 'contact', 'consent', 'ageBand', 'goalKeys',
  'lead', 'placement', 'practice', 'utm',
]);
const NESTED_KEYS = Object.freeze({
  source: new Set(['product', 'surface', 'path', 'version']),
  contact: new Set(['firstName', 'email', 'phone']),
  consent: new Set(['email', 'sms', 'whatsapp', 'advisorContactEmail', 'advisorContact', 'serviceSms', 'marketingSms', 'policyVersion', 'smsDisclosureVersion', 'serviceSmsDisclosureVersion', 'whatsappDisclosureVersion', 'consentedAt']),
  lead: new Set(['formType', 'interest', 'preferredMode', 'preferredSchedule', 'location', 'ageGroup', 'message']),
  placement: new Set(['reviewId', 'resultId', 'resultStatus', 'reviewStatus', 'recommendedLevelKey', 'recommendedLevelLabel', 'finalLevelKey', 'communicationPreference', 'verifiedEmail', 'verifiedMobile', 'answeredQuestionCount', 'skippedQuestionCount', 'advisorConfirmationRequired', 'scoringContractVersion']),
  practice: new Set(['sessionId', 'state', 'scenario', 'useCase', 'focusCode', 'outcomeCode', 'limitCode', 'turnCount', 'planVersion']),
  utm: new Set(['source', 'medium', 'campaign', 'term', 'content']),
});
const FORBIDDEN_KEY = /(?:selected[_-]?answers?|raw[_-]?answers?|writing|resume|claim[_-]?token|workos|audio|transcript|conversation|prompt|generated|provider|secret|trace|usage|contact[_-]?id)/i;

export function validateAitUsaCrmEvent(body) {
  if (!isRecord(body)) return invalid('event_body_required');
  if (AITUSA_PLACEMENT_REVIEW_EVENT_TYPES.includes(body.eventType)) return validatePlacementReviewEvent(body);
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

function validatePlacementReviewEvent(body) {
  const allowed = new Set(['schemaVersion', 'eventId', 'eventType', 'idempotencyKey', 'correlationId', 'occurredAt', 'source', 'placement', 'consent']);
  for (const key of Object.keys(body)) if (!allowed.has(key)) return invalid(`placement_review_field_not_allowed:${key}`);
  if (body.schemaVersion !== AITUSA_CRM_EVENT_SCHEMA_VERSION) return invalid('event_schema_invalid');
  if (!safeIdentifier(body.eventId) || !safeIdentifier(body.idempotencyKey) || !safeIdentifier(body.correlationId)) return invalid('event_identifier_invalid');
  if (!isIsoDate(body.occurredAt)) return invalid('event_occurred_at_invalid');
  const source = body.source;
  if (!isExactRecord(source, ['product', 'surface', 'employeeUrl', 'version'])) return invalid('placement_review_source_invalid');
  if (source.product !== 'aitusa_refresh' || source.surface !== 'staff_tool' || !safeText(source.version, 64)) return invalid('placement_review_source_values_invalid');
  const placement = body.placement;
  if (!isExactRecord(placement, ['reviewId', 'resultId', 'attemptId', 'revision', 'state', 'finalLevel'])) return invalid('placement_review_payload_invalid');
  if (!safeIdentifier(placement.reviewId) || !safeIdentifier(placement.resultId) || !safeIdentifier(placement.attemptId)) return invalid('placement_review_identifier_invalid');
  if (!Number.isInteger(placement.revision) || placement.revision < 1) return invalid('placement_review_revision_invalid');
  const expectedKey = `placement-review:${placement.reviewId}:revision:${placement.revision}:${body.eventType}`;
  if (body.eventId !== expectedKey || body.idempotencyKey !== expectedKey) return invalid('placement_review_event_key_invalid');
  if (placement.state !== AITUSA_PLACEMENT_REVIEW_EVENT_STATES[body.eventType]) return invalid('placement_review_state_invalid');
  if (!safeEmployeeReviewUrl(source.employeeUrl, placement.reviewId)) return invalid('placement_review_employee_url_invalid');
  const requiresFinalLevel = placement.state === 'confirmed' || placement.state === 'adjusted';
  if (requiresFinalLevel !== Object.hasOwn(placement, 'finalLevel')) return invalid('placement_review_final_level_invalid');
  if (requiresFinalLevel && !safeText(placement.finalLevel, 120)) return invalid('placement_review_final_level_invalid');
  const consent = body.consent;
  const consentKeys = ['communicationPreference', 'disclosureVersion', 'disclosureHash', 'sourceUrl', 'optInAction', 'advisorContactEmail', 'serviceSms', 'marketingSms', 'phoneCall', 'whatsappContact', 'verifiedEmail', 'verifiedMobile'];
  if (!isExactRecord(consent, consentKeys)) return invalid('placement_review_consent_invalid');
  if (!(consent.communicationPreference === null || ['email', 'sms', 'whatsapp', 'phone'].includes(consent.communicationPreference))) return invalid('placement_review_preference_invalid');
  for (const key of ['advisorContactEmail', 'serviceSms', 'marketingSms', 'phoneCall', 'whatsappContact', 'verifiedEmail', 'verifiedMobile']) if (typeof consent[key] !== 'boolean') return invalid(`placement_review_consent_${key}_invalid`);
  for (const key of ['disclosureVersion', 'disclosureHash']) if (consent[key] !== undefined && consent[key] !== null && !safeText(consent[key], 160)) return invalid(`placement_review_consent_${key}_invalid`);
  if (consent.sourceUrl !== undefined && consent.sourceUrl !== null && !safeRelativePath(consent.sourceUrl)) return invalid('placement_review_consent_source_url_invalid');
  if (consent.optInAction !== undefined && consent.optInAction !== null && consent.optInAction !== 'explicit_checkbox') return invalid('placement_review_consent_opt_in_action_invalid');
  if (consent.marketingSms && !consent.serviceSms) return invalid('placement_review_marketing_sms_invalid');
  if (findForbiddenKey(body)) return invalid('placement_review_field_forbidden');
  return { ok: true, event: structuredClone(body) };
}

export function aitUsaEventToWebsiteLeadBody(event) {
  const contact = event.contact || {};
  const consent = event.consent || {};
  const lead = event.lead || {};
  const isCallback = event.eventType === 'callback_requested';
  return {
    submissionType: isCallback ? 'contact_cta' : 'website_lead',
    source: 'AIT USA Refresh',
    sourceName: isCallback ? 'AIT USA Request a Call' : 'AIT USA Contact Form',
    sourceKey: 'aitusa_refresh',
    formName: isCallback ? 'AIT USA Request a Call' : 'AIT USA Contact Form',
    externalId: event.idempotencyKey,
    submittedAt: event.occurredAt,
    firstName: contact.firstName,
    email: contact.email,
    phone: contact.phone,
    location: lead.location,
    interest: lead.interest,
    preferredMode: lead.preferredMode,
    preferredSchedule: lead.preferredSchedule,
    age: lead.ageGroup,
    message: lead.message,
    communicationConsent: {
      contact: consent.advisorContact === true,
      ...(typeof consent.sms === 'boolean' ? { sms: consent.sms } : {}),
    },
    communicationPreference: event.placement?.communicationPreference
      || (isCallback ? (contact.phone ? 'phone' : 'email') : 'any'),
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
    for (const key of ['email', 'sms', 'whatsapp', 'advisorContactEmail', 'advisorContact', 'serviceSms', 'marketingSms']) if (body.consent[key] !== undefined && typeof body.consent[key] !== 'boolean') return `event_consent_${key}_invalid`;
    if (body.consent.policyVersion !== undefined && !safeText(body.consent.policyVersion, 80)) return 'event_consent_policy_version_invalid';
    if (body.consent.smsDisclosureVersion !== undefined && !safeText(body.consent.smsDisclosureVersion, 80)) return 'event_consent_sms_disclosure_version_invalid';
    if (body.consent.serviceSmsDisclosureVersion !== undefined && !safeText(body.consent.serviceSmsDisclosureVersion, 80)) return 'event_consent_service_sms_disclosure_version_invalid';
    if (body.consent.whatsappDisclosureVersion !== undefined && !safeText(body.consent.whatsappDisclosureVersion, 80)) return 'event_consent_whatsapp_disclosure_version_invalid';
    if (body.consent.consentedAt !== undefined && !isIsoDate(body.consent.consentedAt)) return 'event_consent_consented_at_invalid';
  }
  if (body.lead !== undefined) {
    const lead = body.lead;
    if (!['contact_form', 'callback_request'].includes(lead.formType)) return 'event_lead_form_type_invalid';
    for (const key of ['interest', 'preferredMode', 'preferredSchedule', 'location', 'ageGroup']) if (lead[key] !== undefined && !safeText(lead[key], 160)) return `event_lead_${key}_invalid`;
    if (lead.message !== undefined && !safeText(lead.message, 800)) return 'event_lead_message_invalid';
  }
  if (isAitUsaLeadEvent(body) && body.lead === undefined) return 'event_lead_required';
  if (isAitUsaLeadEvent(body) && body.consent?.advisorContact !== true) return 'event_lead_advisor_contact_required';
  if (body.ageBand !== undefined && !['under_13', 'age_13_plus'].includes(body.ageBand)) return 'event_age_band_invalid';
  if (body.placement !== undefined) {
    const p = body.placement;
    for (const key of ['reviewId', 'resultId', 'resultStatus', 'reviewStatus', 'recommendedLevelKey', 'recommendedLevelLabel', 'finalLevelKey', 'scoringContractVersion']) if (p[key] !== undefined && !safeText(p[key], key === 'recommendedLevelLabel' ? 120 : 80)) return `event_placement_${key}_invalid`;
    if (p.communicationPreference !== undefined && !['email', 'sms', 'whatsapp', 'phone', 'portal', 'any'].includes(p.communicationPreference)) return 'event_placement_communication_preference_invalid';
    for (const key of ['verifiedEmail', 'verifiedMobile']) if (p[key] !== undefined && typeof p[key] !== 'boolean') return `event_placement_${key}_invalid`;
    for (const key of ['answeredQuestionCount', 'skippedQuestionCount']) if (p[key] !== undefined && (!Number.isInteger(p[key]) || p[key] < 0 || p[key] > 1000)) return `event_placement_${key}_invalid`;
    if (p.advisorConfirmationRequired !== undefined && typeof p.advisorConfirmationRequired !== 'boolean') return 'event_placement_advisor_confirmation_required_invalid';
  }
  if (isAitUsaPlacementReviewEvent(body)) {
    const placement = body.placement || {};
    if (!safeIdentifier(placement.reviewId) || !safeIdentifier(placement.resultId)) return 'event_placement_review_identifier_required';
    const expectedStatus = body.eventType.replace('placement_review_', '');
    if (placement.reviewStatus !== expectedStatus) return 'event_placement_review_status_invalid';
    if (['confirmed', 'adjusted'].includes(expectedStatus) && !safeText(placement.finalLevelKey, 80)) return 'event_placement_final_level_required';
  }
  if (body.practice !== undefined) {
    const p = body.practice;
    for (const key of ['sessionId', 'state', 'scenario', 'useCase', 'focusCode', 'outcomeCode', 'limitCode', 'planVersion']) if (p[key] !== undefined && !safeText(p[key], 80)) return `event_practice_${key}_invalid`;
    if (p.turnCount !== undefined && (!Number.isInteger(p.turnCount) || p.turnCount < 0 || p.turnCount > 5)) return 'event_practice_turn_count_invalid';
  }
  if (body.utm !== undefined) for (const value of Object.values(body.utm)) if (!safeText(value, 160)) return 'event_utm_invalid';
  return null;
}

export function isAitUsaLeadEvent(event) {
  return event?.eventType === 'contact_form_submitted' || event?.eventType === 'callback_requested';
}

export function isAitUsaPlacementReviewEvent(event) {
  return AITUSA_PLACEMENT_REVIEW_EVENT_TYPES.includes(event?.eventType);
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
function isExactRecord(value, allowedKeys) { return isRecord(value) && Object.keys(value).every((key) => allowedKeys.includes(key)); }
function safeIdentifier(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{12,160}$/.test(value); }
function safeText(value, limit) { return typeof value === 'string' && value.length > 0 && value.length <= limit; }
function isIsoDate(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
function safePath(value) { return typeof value === 'string' && value.length > 0 && value.length <= 160 && value.startsWith('/') && !/[?#]/.test(value); }
function safeRelativePath(value) { return typeof value === 'string' && /^\/(?:[A-Za-z0-9_-]+\/?)*$/.test(value) && value.length <= 280; }
function safeEmployeeReviewUrl(value, reviewId) { return value === `/employee/placement-reviews?review=${encodeURIComponent(reviewId)}`; }
function safeEmail(value) { return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function safePhone(value) { return typeof value === 'string' && value.length <= 32 && /^[0-9+(). -]+$/.test(value); }
