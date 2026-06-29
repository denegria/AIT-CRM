import { createHash, timingSafeEqual } from 'crypto';
import {
  recordInboundLeadAssignmentActivity,
  resolveDefaultInboundLeadOwnerUserId,
} from '../crm/assignment.js';
import { normalizeLifecycleStatus } from '../crm/lifecycle.js';
import {
  leadProfilePatchFromWebsiteLead,
  leadProfilePatchToDbValues,
} from '../crm/lead-profile.js';
import {
  NOTIFICATION_SOURCES,
  createInboundLeadNotification,
} from '../notifications/service.js';
import { normalizeWorkflowTags } from '../sales-workflow.js';
import { createInboundLeadIntakeTask } from '../tasks/intake.js';

export const WEBSITE_LEAD_SECRET_HEADER = 'x-ait-webhook-secret';
export const WEBSITE_LEAD_SOURCE_TYPE = 'website_form';
export const WEBSITE_LEAD_SOURCE_NAME = 'Website Form';
export const WEBSITE_LEAD_BATCH_SOURCE_NAME = 'Website Leads';
export const WEBSITE_LEAD_BATCH_FILE_NAME = 'website-leads-webhook.json';
export const WEBSITE_LEAD_SOURCE_SHEET = 'Website Leads Webhook';
export const WEBSITE_LEAD_ACCEPTED_SECRET_LOCATIONS = [
  'Authorization: Bearer <secret>',
  'x-ait-webhook-secret header',
  'x-ait-webhook-secret body field',
  'webhookSecret body field',
];

const BODY_SECRET_KEYS = [
  'webhookSecret',
  'webhook_secret',
  WEBSITE_LEAD_SECRET_HEADER,
  'xAitWebhookSecret',
];
const BODY_AUTHORIZATION_KEYS = ['authorization', 'Authorization'];
const AUDIT_REDACTED_KEY_NAMES = new Set([
  'authorization',
  'webhooksecret',
  'webhook-secret',
  WEBSITE_LEAD_SECRET_HEADER,
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
  'first-name',
  'first_name',
  'contactfirstname',
  'contact-first-name',
  'contact_first_name',
  'lastname',
  'last-name',
  'last_name',
  'contactlastname',
  'contact-last-name',
  'contact_last_name',
  'name',
  'fullname',
  'full-name',
  'full_name',
  'contactname',
  'contact-name',
  'contact_name',
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
  'submissiontype',
  'submission-type',
  'eventtype',
  'event-type',
  'leadtype',
  'lead-type',
  'intent',
  'communication',
  'communicationconsent',
  'communication-consent',
  'consent',
  'preferences',
  'contactconsent',
  'contact-consent',
  'consenttocontact',
  'consent-to-contact',
  'cancontact',
  'can-contact',
  'whatsappconsent',
  'whatsapp-consent',
  'whatsappoptin',
  'whatsapp-opt-in',
  'smsconsent',
  'sms-consent',
  'textconsent',
  'text-consent',
  'smsoptin',
  'sms-opt-in',
  'communicationpreference',
  'communication-preference',
  'preferredcontactmethod',
  'preferred-contact-method',
  'preferredchannel',
  'preferred-channel',
  'contactpreference',
  'contact-preference',
  'placement',
  'placementtest',
  'placement-test',
  'placementresult',
  'placement-result',
  'placementrecommendation',
  'placement-recommendation',
  'recommendedlevel',
  'recommended-level',
  'advisorrecommendation',
  'advisor-recommendation',
  'placementscore',
  'placement-score',
  'scoreband',
  'score-band',
  'levelband',
  'level-band',
  'selectedgoals',
  'selected-goals',
  'selectedanswers',
  'selected-answers',
  'advisorconfirmation',
  'advisor-confirmation',
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

const SUBMISSION_TYPES = Object.freeze({
  CONTACT_CTA: 'contact_cta',
  PLACEMENT_TEST: 'placement_test',
  WEBSITE_LEAD: 'website_lead',
});

const COMMUNICATION_PREFERENCES = Object.freeze({
  WHATSAPP: 'whatsapp',
  SMS: 'sms',
  EMAIL: 'email',
  PHONE: 'phone',
  ANY: 'any',
  NONE: 'none',
});

const CONTACT_CONSENT_ALIASES = [
  'contactConsent',
  'contact_consent',
  'consentToContact',
  'consent_to_contact',
  'canContact',
  'can_contact',
  'permissionToContact',
  'permission_to_contact',
  'marketingConsent',
  'marketing_consent',
];
const WHATSAPP_CONSENT_ALIASES = [
  'whatsappConsent',
  'whatsAppConsent',
  'whatsapp_consent',
  'whatsappOptIn',
  'whatsapp_opt_in',
  'consentWhatsapp',
  'consent_whatsapp',
];
const SMS_CONSENT_ALIASES = [
  'smsConsent',
  'sms_consent',
  'textConsent',
  'text_consent',
  'textMessageConsent',
  'text_message_consent',
  'smsOptIn',
  'sms_opt_in',
  'consentSms',
  'consent_sms',
];
const COMMUNICATION_PREFERENCE_ALIASES = [
  'communicationPreference',
  'communication_preference',
  'preferredContactMethod',
  'preferred_contact_method',
  'preferredChannel',
  'preferred_channel',
  'contactPreference',
  'contact_preference',
];
const EXPLICIT_PLACEMENT_FIELD_ALIASES = [
  'placementRecommendation',
  'placement_recommendation',
  'recommendedLevel',
  'recommended_level',
  'advisorRecommendation',
  'advisor_recommendation',
  'placementScore',
  'placement_score',
  'scoreBand',
  'score_band',
  'levelBand',
  'level_band',
  'selectedGoals',
  'selected_goals',
  'selectedAnswers',
  'selected_answers',
  'advisorConfirmation',
  'advisor_confirmation',
];

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

function bodySecrets(body) {
  const secrets = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return secrets;

  for (const key of BODY_SECRET_KEYS) {
    if (body[key]) secrets.push(String(body[key]).trim());
  }
  for (const key of BODY_AUTHORIZATION_KEYS) {
    if (body[key]) secrets.push(authSecretFromValue(body[key]));
  }

  return secrets;
}

export function webhookPayloadFromBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
    return body.data;
  }
  return body;
}

export function collectWebsiteLeadSubmittedSecrets({
  authorizationHeader = '',
  headerSecret = '',
  body,
} = {}) {
  const secrets = [];
  if (authorizationHeader) secrets.push(authSecretFromValue(authorizationHeader));
  if (headerSecret) secrets.push(String(headerSecret).trim());

  const payload = webhookPayloadFromBody(body);
  const bodies = payload === body ? [body] : [body, payload];
  for (const candidate of bodies) {
    secrets.push(...bodySecrets(candidate));
  }

  return secrets.filter(Boolean);
}

export function verifyWebsiteLeadSecret({
  authorizationHeader = '',
  headerSecret = '',
  body,
  expectedSecret,
} = {}) {
  const expected = String(expectedSecret || '').trim();
  if (!expected) return false;

  return collectWebsiteLeadSubmittedSecrets({ authorizationHeader, headerSecret, body })
    .some((secret) => safeEqual(secret, expected));
}

function secretFingerprint(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  return {
    length: text.length,
    hashPrefix: createHash('sha256').update(text).digest('hex').slice(0, 12),
  };
}

export function websiteLeadAuthFailureDiagnostics({
  contentType = '',
  authorizationHeader = '',
  headerSecret = '',
  body,
  expectedSecret,
} = {}) {
  const payload = webhookPayloadFromBody(body);
  const bodyKeys = body && typeof body === 'object' && !Array.isArray(body)
    ? Object.keys(body)
    : [];
  const payloadKeys = payload && payload !== body && typeof payload === 'object' && !Array.isArray(payload)
    ? Object.keys(payload)
    : [];

  return {
    contentType,
    bodyKeys,
    payloadKeys,
    submittedSecretFingerprints: collectWebsiteLeadSubmittedSecrets({
      authorizationHeader,
      headerSecret,
      body,
    }).map(secretFingerprint).filter(Boolean),
    expectedSecretFingerprint: secretFingerprint(expectedSecret),
  };
}

export function normalizeAuditKeyName(key) {
  return String(key || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

export function sanitizeWebhookBodyForAudit(value) {
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

function firstText(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return '';
}

function normalizeAliasKey(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function firstFieldText(body, ...keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      const text = normalizeText(body[key]);
      if (text) return text;
    }
  }
  return '';
}

function valueForAlias(source, aliases = []) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined;
  const normalizedAliases = new Set(aliases.map(normalizeAliasKey));
  for (const [key, value] of Object.entries(source)) {
    if (normalizedAliases.has(normalizeAliasKey(key))) return value;
  }
  return undefined;
}

function firstAliasValue(...sourcesAndAliases) {
  for (const [source, aliases] of sourcesAndAliases) {
    const value = valueForAlias(source, aliases);
    if (value !== undefined && value !== null && normalizeText(value) !== '') return value;
  }
  return undefined;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function rawSubmissionTypeText(body) {
  return firstText(body.submissionType, body.submission_type, body.eventType, body.event_type, body.leadType, body.lead_type, body.intent);
}

function normalizedSubmissionTypeToken(body) {
  return rawSubmissionTypeText(body).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isPlacementSubmissionType(body) {
  return ['placement', 'placementtest', 'placementresult', 'quizresult', 'assessment', 'assessmentresult']
    .includes(normalizedSubmissionTypeToken(body));
}

function placementObjectForBody(body) {
  return objectValue(body.placement)
    || objectValue(body.placementTest)
    || objectValue(body.placement_test)
    || objectValue(body.placementResult)
    || objectValue(body.placement_result)
    || {};
}

function hasExplicitPlacementField(body) {
  return firstAliasValue([body, EXPLICIT_PLACEMENT_FIELD_ALIASES]) !== undefined;
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

function consentObjectForBody(body) {
  const communication = objectValue(body.communication);
  const communicationConsent = objectValue(body.communicationConsent)
    || objectValue(body.communication_consent)
    || objectValue(communication?.consent);
  const consent = objectValue(body.consent);
  const preferences = objectValue(body.preferences);
  return {
    communication,
    communicationConsent,
    consent,
    preferences,
    preferenceSource: objectValue(communication?.preference)
      || objectValue(communication?.preferences)
      || objectValue(preferences?.communication),
  };
}

function normalizeConsentBoolean(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  const text = normalizeText(value).toLowerCase();
  if (!text) return null;
  const compact = text.replace(/[^a-z0-9]+/g, '');
  if (['true', 'yes', 'y', '1', 'on', 'checked', 'agree', 'agreed', 'consent', 'consented', 'optin', 'subscribed'].includes(compact)) {
    return true;
  }
  if (['false', 'no', 'n', '0', 'off', 'unchecked', 'decline', 'declined', 'deny', 'denied', 'optout', 'unsubscribed', 'donotcontact', 'none'].includes(compact)) {
    return false;
  }
  if (/\b(do not|don'?t|no|decline|deny|denied|opt[-\s]?out|unsubscribe)\b/.test(text)) return false;
  if (/\b(yes|agree|agreed|consent|consented|authorize|authorized|opt[-\s]?in|subscribe)\b/.test(text)) return true;
  return null;
}

function normalizeCommunicationPreference(value) {
  const text = normalizeText(value).toLowerCase();
  if (!text) return null;
  const compact = text.replace(/[^a-z0-9]+/g, '');
  if (['whatsapp', 'wa', 'whatsapponly'].includes(compact)) return COMMUNICATION_PREFERENCES.WHATSAPP;
  if (['sms', 'text', 'textmessage', 'texts', 'textme'].includes(compact)) return COMMUNICATION_PREFERENCES.SMS;
  if (['email', 'mail'].includes(compact)) return COMMUNICATION_PREFERENCES.EMAIL;
  if (['phone', 'call', 'voice', 'phonecall'].includes(compact)) return COMMUNICATION_PREFERENCES.PHONE;
  if (['any', 'either', 'nopreference', 'best', 'bestmethod'].includes(compact)) return COMMUNICATION_PREFERENCES.ANY;
  if (['none', 'donotcontact', 'nocontact'].includes(compact)) return COMMUNICATION_PREFERENCES.NONE;
  return text.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || null;
}

export function normalizeWebsiteLeadCommunication(body = {}) {
  const {
    communication,
    communicationConsent,
    consent,
    preferences,
    preferenceSource,
  } = consentObjectForBody(body);

  const contactConsent = normalizeConsentBoolean(firstAliasValue(
    [communicationConsent, ['contact', ...CONTACT_CONSENT_ALIASES]],
    [consent, ['contact', ...CONTACT_CONSENT_ALIASES]],
    [communication, CONTACT_CONSENT_ALIASES],
    [body, CONTACT_CONSENT_ALIASES],
  ));
  const whatsappConsent = normalizeConsentBoolean(firstAliasValue(
    [communicationConsent, ['whatsapp', 'whatsApp', ...WHATSAPP_CONSENT_ALIASES]],
    [consent, ['whatsapp', 'whatsApp', ...WHATSAPP_CONSENT_ALIASES]],
    [communication, WHATSAPP_CONSENT_ALIASES],
    [body, WHATSAPP_CONSENT_ALIASES],
  ));
  const smsConsent = normalizeConsentBoolean(firstAliasValue(
    [communicationConsent, ['sms', 'text', ...SMS_CONSENT_ALIASES]],
    [consent, ['sms', 'text', ...SMS_CONSENT_ALIASES]],
    [communication, SMS_CONSENT_ALIASES],
    [body, SMS_CONSENT_ALIASES],
  ));
  const communicationPreference = normalizeCommunicationPreference(firstAliasValue(
    [preferenceSource, ['channel', 'method', 'preference', ...COMMUNICATION_PREFERENCE_ALIASES]],
    [preferences, COMMUNICATION_PREFERENCE_ALIASES],
    [communication, ['preference', 'preferred', 'preferredMethod', ...COMMUNICATION_PREFERENCE_ALIASES]],
    [body, COMMUNICATION_PREFERENCE_ALIASES],
  ));

  return {
    consent: {
      contact: contactConsent,
      whatsapp: whatsappConsent,
      sms: smsConsent,
    },
    preference: communicationPreference,
  };
}

function normalizeSubmissionType(body, placement) {
  const compact = normalizedSubmissionTypeToken(body);
  if (['contactcta', 'contact', 'contactform', 'contactrequest', 'contactus'].includes(compact)) return SUBMISSION_TYPES.CONTACT_CTA;
  if (isPlacementSubmissionType(body)) return SUBMISSION_TYPES.PLACEMENT_TEST;
  if (placement && Object.keys(placement).length) return SUBMISSION_TYPES.PLACEMENT_TEST;
  return SUBMISSION_TYPES.WEBSITE_LEAD;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeNoteText(item))
      .filter(Boolean);
  }
  const text = normalizeText(value);
  if (!text) return [];
  return text.split(/[;,|]/).map(normalizeNoteText).filter(Boolean);
}

function normalizeSafeMetadataValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeSafeMetadataValue).filter((item) => item !== null && item !== '');
  }
  if (value && typeof value === 'object') {
    const sanitized = sanitizeWebhookBodyForAudit(value);
    return Object.fromEntries(
      Object.entries(sanitized)
        .map(([key, entryValue]) => [normalizeNoteText(key), normalizeSafeMetadataValue(entryValue)])
        .filter(([key, entryValue]) => key && entryValue !== null && entryValue !== ''),
    );
  }
  return normalizeNoteText(value);
}

function normalizePlacementScore(value) {
  if (value === undefined || value === null || normalizeText(value) === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : normalizeNoteText(value);
}

function compactMetadataObject(value) {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => {
        if (Array.isArray(entryValue)) return entryValue.length > 0;
        if (entryValue && typeof entryValue === 'object') return Object.keys(entryValue).length > 0;
        return entryValue !== null && entryValue !== '';
      }),
  );
}

export function normalizeWebsiteLeadPlacement(body = {}) {
  const placement = placementObjectForBody(body);
  const allowGenericTopLevelPlacementFields = Object.keys(placement).length > 0 || isPlacementSubmissionType(body);
  const hasPlacementSignal = allowGenericTopLevelPlacementFields || hasExplicitPlacementField(body);
  if (!hasPlacementSignal) return {};

  const selectedAnswers = firstAliasValue(
    [placement, ['answers', 'selectedAnswers', 'selected_answers']],
    [body, ['selectedAnswers', 'selected_answers']],
    allowGenericTopLevelPlacementFields ? [body, ['answers']] : [null, []],
  );
  return compactMetadataObject({
    recommendation: firstText(
      placement.recommendation,
      placement.recommendedLevel,
      placement.recommended_level,
      placement.advisorRecommendation,
      placement.advisor_recommendation,
      body.placementRecommendation,
      body.placement_recommendation,
      body.recommendedLevel,
      body.recommended_level,
      allowGenericTopLevelPlacementFields ? body.recommendation : '',
    ),
    score: normalizePlacementScore(firstText(
      placement.score,
      placement.placementScore,
      placement.placement_score,
      body.placementScore,
      body.placement_score,
      allowGenericTopLevelPlacementFields ? body.score : '',
    )),
    scoreBand: firstText(
      placement.scoreBand,
      placement.score_band,
      body.scoreBand,
      body.score_band,
      allowGenericTopLevelPlacementFields ? placement.band : '',
      allowGenericTopLevelPlacementFields ? body.band : '',
    ),
    levelBand: firstText(
      placement.levelBand,
      placement.level_band,
      body.levelBand,
      body.level_band,
      allowGenericTopLevelPlacementFields ? placement.level : '',
      allowGenericTopLevelPlacementFields ? body.level : '',
    ),
    selectedGoals: normalizeStringList(firstAliasValue(
      [placement, ['selectedGoals', 'selected_goals', 'goals']],
      [body, ['selectedGoals', 'selected_goals']],
      allowGenericTopLevelPlacementFields ? [body, ['goals']] : [null, []],
    )),
    selectedAnswers: normalizeSafeMetadataValue(selectedAnswers),
    advisorConfirmation: firstText(
      placement.advisorConfirmation,
      placement.advisor_confirmation,
      body.advisorConfirmation,
      body.advisor_confirmation,
    ),
  });
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

export function normalizeWebsiteLeadBody(body) {
  const communication = normalizeWebsiteLeadCommunication(body);
  const placement = normalizeWebsiteLeadPlacement(body);
  const submissionType = normalizeSubmissionType(body, placement);
  const firstName = firstFieldText(
    body,
    'firstName',
    'first_name',
    'first name',
    'First Name',
    'contactFirstName',
    'contact_first_name',
    'contact first name',
    'Contact first name',
    'Contact First Name',
  );
  const lastName = firstFieldText(
    body,
    'lastName',
    'last_name',
    'last name',
    'Last Name',
    'contactLastName',
    'contact_last_name',
    'contact last name',
    'Contact last name',
    'Contact Last Name',
  );
  const combinedName = [firstName, lastName].filter(Boolean).join(' ');
  const fullName = firstFieldText(
    body,
    'fullName',
    'full_name',
    'full name',
    'Full Name',
    'contactName',
    'contact_name',
    'contact name',
    'Contact name',
    'Contact Name',
  );
  const name = firstText(combinedName, fullName, body.name, body.email, body.phone, 'Website Lead');
  const sourceKey = sourceKeyForBody(body);
  const status = normalizeLifecycleStatus(body.status) || 'New Lead';
  const currentStage = normalizeLifecycleStatus(
    firstText(body.currentStage, body.workflowStage, body.stage, body.status),
  ) || status;

  return {
    submissionType,
    name,
    company: firstText(body.company, body.companyName, body.businessName),
    email: normalizeEmail(body.email),
    phone: normalizePhone(body.phone),
    address: firstText(body.address, body.streetAddress, body.location, body.city, body.countryCity),
    age: firstText(body.age, body.edad, body.Edad),
    message: firstText(body.message, body.notes, body.comments, body.description),
    service: firstText(body.service, body.serviceType, body.interest, submissionType === SUBMISSION_TYPES.PLACEMENT_TEST ? 'Placement test' : ''),
    sourceKey,
    sourceName: firstText(body.sourceName, body.source, body.formName, WEBSITE_LEAD_SOURCE_NAME),
    externalId: firstText(body.externalId, body.submissionId, body.id),
    submittedAt: firstText(body.submittedAt, body.createdAt, body.timestamp),
    businessUnitHint: firstText(body.businessUnitId, body.businessUnit, body.businessUnitName, body.division),
    status,
    currentStage,
    outreachState: firstText(body.outreachState, body.contactState),
    priority: firstText(body.priority),
    tags: normalizeWorkflowTags(body.workflowTags || body.tags || body.tagList),
    nextAction: firstText(body.nextAction, body.task, body.todo),
    communicationConsent: communication.consent,
    communicationPreference: communication.preference,
    placement,
    formFields: collectAdditionalFormFields(body),
  };
}

export function normalizeWebsiteLeadSubmission(body) {
  const payload = webhookPayloadFromBody(body);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { payload, lead: null };
  }
  return {
    payload,
    lead: normalizeWebsiteLeadBody(payload),
  };
}

export function hasWebsiteLeadContactSignal(lead) {
  return Boolean(lead?.email || lead?.phone || lead?.message);
}

function parseTimestamp(value) {
  if (!value) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export async function resolveWebsiteLeadBusinessUnitId(client, { organizationId, lead, businessUnitMap = {} }) {
  const mapped = businessUnitMap[lead.sourceKey] || businessUnitMap[lead.sourceName] || businessUnitMap.default || '';
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

export async function findDuplicateWebsiteLeadSubmission(client, { organizationId, externalId }) {
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
    [organizationId, WEBSITE_LEAD_SOURCE_TYPE, externalId],
  );
  return result.rows[0]?.lead_id ? result.rows[0] : null;
}

async function getOrCreateBatch(client, organizationId) {
  const existing = await client.query(
    'select id from import_batches where organization_id = $1 and source_type = $2 and source_name = $3 order by created_at desc limit 1',
    [organizationId, WEBSITE_LEAD_SOURCE_TYPE, WEBSITE_LEAD_BATCH_SOURCE_NAME],
  );
  if (existing.rows[0]?.id) return existing.rows[0].id;

  const inserted = await client.query(
    'insert into import_batches (organization_id, source_name, source_type, file_name, status) values ($1, $2, $3, $4, $5) returning id',
    [organizationId, WEBSITE_LEAD_BATCH_SOURCE_NAME, WEBSITE_LEAD_SOURCE_TYPE, WEBSITE_LEAD_BATCH_FILE_NAME, 'active'],
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
      [existing.id, lead.name, lead.company, lead.phone, lead.email, lead.address, WEBSITE_LEAD_SOURCE_NAME, businessUnitId],
    );
    return existing.id;
  }

  const inserted = await client.query(
    'insert into contacts (organization_id, primary_business_unit_id, name, company_name, phone, email, address, source_label) values ($1, $2, $3, nullif($4, \'\'), nullif($5, \'\'), nullif($6, \'\'), nullif($7, \'\'), $8) returning id',
    [organizationId, businessUnitId, lead.name, lead.company, lead.phone, lead.email, lead.address, WEBSITE_LEAD_SOURCE_NAME],
  );
  return inserted.rows[0]?.id || null;
}

function formatFormFieldsForNotes(fields) {
  if (!fields || typeof fields !== 'object') return '';
  return Object.entries(fields)
    .map(([key, value]) => [normalizeNoteText(key), normalizeNoteText(value)])
    .filter(([key, value]) => key && value)
    .map(([key, value]) => key + ': ' + value)
    .join('; ');
}

function hasExplicitCommunicationMetadata(lead) {
  const consent = lead.communicationConsent || {};
  return consent.contact === true
    || consent.contact === false
    || consent.whatsapp === true
    || consent.whatsapp === false
    || consent.sms === true
    || consent.sms === false
    || Boolean(lead.communicationPreference);
}

function consentLabel(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'not_provided';
}

function communicationSummary(lead) {
  if (!hasExplicitCommunicationMetadata(lead)) return '';
  const consent = lead.communicationConsent || {};
  return [
    'contact:' + consentLabel(consent.contact),
    'whatsapp:' + consentLabel(consent.whatsapp),
    'sms:' + consentLabel(consent.sms),
    lead.communicationPreference ? 'preference:' + lead.communicationPreference : '',
  ].filter(Boolean).join(',');
}

function placementSummary(placement = {}) {
  if (!placement || typeof placement !== 'object' || !Object.keys(placement).length) return '';
  return [
    placement.recommendation ? 'recommendation:' + normalizeNoteText(placement.recommendation) : '',
    placement.score !== null && placement.score !== undefined ? 'score:' + normalizeNoteText(placement.score) : '',
    placement.scoreBand ? 'score_band:' + normalizeNoteText(placement.scoreBand) : '',
    placement.levelBand ? 'level_band:' + normalizeNoteText(placement.levelBand) : '',
    placement.selectedGoals?.length ? 'goals:' + placement.selectedGoals.map(normalizeNoteText).join(';') : '',
    placement.advisorConfirmation ? 'advisor_confirmation:' + normalizeNoteText(placement.advisorConfirmation) : '',
  ].filter(Boolean).join(',');
}

function websiteLeadMetadata(lead) {
  return compactMetadataObject({
    submissionType: lead.submissionType || SUBMISSION_TYPES.WEBSITE_LEAD,
    communicationConsent: hasExplicitCommunicationMetadata(lead) ? lead.communicationConsent : null,
    communicationPreference: lead.communicationPreference || null,
    placement: lead.placement || null,
  });
}

function originalNotesForLead(lead, sourceRowId) {
  const tags = lead.tags?.length ? lead.tags : [];
  const formFields = formatFormFieldsForNotes(lead.formFields);
  const communication = communicationSummary(lead);
  const placement = placementSummary(lead.placement);
  return [
    WEBSITE_LEAD_SOURCE_TYPE,
    'submission_type=' + (lead.submissionType || SUBMISSION_TYPES.WEBSITE_LEAD),
    'external_id=' + (lead.externalId || 'none'),
    'source_key=' + (lead.sourceKey || 'none'),
    'source_row_id=' + (sourceRowId || 'unknown'),
    'current_stage=' + (lead.currentStage || lead.status || 'New Lead'),
    communication ? 'communication=' + communication : '',
    placement ? 'placement=' + placement : '',
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

function leadFormDetailsNote(lead) {
  const rows = [];
  const communication = communicationSummary(lead);
  const placement = placementSummary(lead.placement);
  if (communication) rows.push('Communication: ' + communication);
  if (placement) rows.push('Placement: ' + placement);
  if (lead.age) rows.push('Age: ' + normalizeNoteText(lead.age));
  if (lead.address) rows.push('Location: ' + normalizeNoteText(lead.address));
  if (lead.service) rows.push('Interest: ' + normalizeNoteText(lead.service));
  const formFields = formatFormFieldsForNotes(lead.formFields);
  if (formFields) rows.push('Additional form fields: ' + formFields);
  if (!rows.length) return '';
  return ['Website form details:', ...rows.map((row) => '- ' + row)].join('\n');
}

async function persistLead(client, organizationId, businessUnitId, contactId, lead, sourceRowId, rowNumber, ownerUserId = null) {
  const profileValues = leadProfilePatchToDbValues(leadProfilePatchFromWebsiteLead(lead));
  const inserted = await client.query(
    `
      insert into leads (
        organization_id, business_unit_id, contact_id, source_type, source_name, status, current_stage,
        original_notes, assigned_user_id, program_interest, preferred_day, preferred_schedule,
        test_interest, education_level, school_name, location_preference, profile_details, source_detail
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      returning id
    `,
    [
      organizationId,
      businessUnitId,
      contactId,
      WEBSITE_LEAD_SOURCE_TYPE,
      lead.sourceName || WEBSITE_LEAD_SOURCE_NAME,
      lead.status || 'New Lead',
      lead.currentStage || lead.status || 'New Lead',
      originalNotesForLead(lead, sourceRowId),
      ownerUserId,
      profileValues.program_interest || null,
      profileValues.preferred_day || null,
      profileValues.preferred_schedule || null,
      profileValues.test_interest || null,
      profileValues.education_level || null,
      profileValues.school_name || null,
      profileValues.location_preference || null,
      profileValues.profile_details || null,
      profileValues.source_detail || null,
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
      WEBSITE_LEAD_SOURCE_SHEET,
      rowNumber,
      parseTimestamp(lead.submittedAt),
    ],
  );
  await recordInboundLeadAssignmentActivity(client, {
    organizationId,
    businessUnitId,
    contactId,
    leadId,
    ownerUserId,
  });

  const detailsNote = leadFormDetailsNote(lead);
  if (detailsNote) {
    await client.query(
      'insert into notes (organization_id, business_unit_id, contact_id, lead_id, body) values ($1, $2, $3, $4, $5)',
      [organizationId, businessUnitId, contactId, leadId, detailsNote],
    );
  }

  return leadId;
}

export async function persistWebsiteLeadImportAudit(
  client,
  { batchId, rowNumber, body, lead, businessUnitId, contactId, leadId, assignedUserId = null, duplicate = null },
) {
  const rawValues = {
    source: WEBSITE_LEAD_SOURCE_TYPE,
    submission_type: lead.submissionType || SUBMISSION_TYPES.WEBSITE_LEAD,
    source_key: lead.sourceKey || null,
    source_name: lead.sourceName || WEBSITE_LEAD_SOURCE_NAME,
    external_id: lead.externalId || null,
    business_unit_id: businessUnitId,
    communication_consent: hasExplicitCommunicationMetadata(lead) ? lead.communicationConsent : null,
    communication_preference: lead.communicationPreference || null,
    placement: lead.placement && Object.keys(lead.placement).length ? lead.placement : null,
    raw: sanitizeWebhookBodyForAudit(body),
  };

  const sourceRow = await client.query(
    'insert into import_source_rows (import_batch_id, source_sheet, source_row_number, raw_values_json, raw_text, parse_status) values ($1, $2, $3, $4::jsonb, $5, $6) returning id',
    [batchId, WEBSITE_LEAD_SOURCE_SHEET, rowNumber, JSON.stringify(rawValues), JSON.stringify(rawValues), 'parsed'],
  );
  const sourceRowId = sourceRow.rows[0]?.id || null;

  const proposedContact = {
    name: lead.name,
    email: lead.email || null,
    phone: lead.phone || null,
    company_name: lead.company || null,
    address: lead.address || null,
    source_label: WEBSITE_LEAD_SOURCE_NAME,
    business_unit_id: businessUnitId,
    contact_id: contactId,
  };
  const proposedLead = {
    source_type: WEBSITE_LEAD_SOURCE_TYPE,
    submission_type: lead.submissionType || SUBMISSION_TYPES.WEBSITE_LEAD,
    source_name: lead.sourceName || WEBSITE_LEAD_SOURCE_NAME,
    source_key: lead.sourceKey || null,
    external_id: lead.externalId || null,
    service: lead.service || null,
    lead_profile: leadProfilePatchFromWebsiteLead(lead),
    message: lead.message || null,
    address: lead.address || null,
    age: lead.age || null,
    communication_consent: hasExplicitCommunicationMetadata(lead) ? lead.communicationConsent : null,
    communication_preference: lead.communicationPreference || null,
    placement: lead.placement && Object.keys(lead.placement).length ? lead.placement : null,
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
    assigned_user_id: assignedUserId,
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

export async function ingestWebsiteLeadSubmission(client, {
  organizationId,
  businessUnitId,
  body,
  lead: preparedLead = null,
}) {
  const { payload, lead } = preparedLead
    ? { payload: webhookPayloadFromBody(body), lead: preparedLead }
    : normalizeWebsiteLeadSubmission(body);

  if (!payload || !lead) {
    throw new Error('JSON object body is required.');
  }

  const duplicate = await findDuplicateWebsiteLeadSubmission(client, {
    organizationId,
    externalId: lead.externalId,
  });
  const batchId = await getOrCreateBatch(client, organizationId);

  await client.query('begin');
  try {
    await client.query('select id from import_batches where id = $1 for update', [batchId]);
    const rowNumber = await nextSourceRowNumber(client, batchId);
    if (duplicate) {
      await persistWebsiteLeadImportAudit(client, {
        batchId,
        rowNumber,
        body: payload,
        lead,
        businessUnitId,
        contactId: duplicate.contact_id,
        leadId: duplicate.lead_id,
        duplicate,
      });
      await client.query('commit');
      return {
        ok: true,
        duplicate: true,
        contactId: duplicate.contact_id,
        leadId: duplicate.lead_id,
      };
    }

    const assignedUserId = await resolveDefaultInboundLeadOwnerUserId(client, {
      organizationId,
      businessUnitId,
      sourceType: WEBSITE_LEAD_SOURCE_TYPE,
      sourceKey: lead.externalId || lead.sourceKey || String(rowNumber),
    });
    const contactId = await upsertContact(client, organizationId, businessUnitId, lead);
    const leadId = await persistLead(client, organizationId, businessUnitId, contactId, lead, 'pending', rowNumber, assignedUserId);
    const sourceRowId = await persistWebsiteLeadImportAudit(client, {
      batchId,
      rowNumber,
      body: payload,
      lead,
      businessUnitId,
      contactId,
      leadId,
      assignedUserId,
    });
    const inboundLeadIdempotencyKey = `website:${lead.externalId || sourceRowId || leadId}`;
    const inboundLeadMetadata = {
      sourceKey: lead.sourceKey || null,
      externalId: lead.externalId || null,
      sourceRowId,
      ...websiteLeadMetadata(lead),
    };
    const inboundLeadDetail = lead.service
      ? `Interested in ${lead.service}.`
      : lead.message || 'Website lead submitted.';
    await createInboundLeadNotification(client, {
      organizationId,
      businessUnitId,
      contactId,
      leadId,
      sourceType: NOTIFICATION_SOURCES.WEBSITE,
      sourceName: lead.sourceName || WEBSITE_LEAD_SOURCE_NAME,
      contactName: lead.name,
      detail: inboundLeadDetail,
      idempotencyKey: inboundLeadIdempotencyKey,
      metadata: inboundLeadMetadata,
    });
    await createInboundLeadIntakeTask(client, {
      organizationId,
      businessUnitId,
      contactId,
      leadId,
      sourceType: NOTIFICATION_SOURCES.WEBSITE,
      sourceName: lead.sourceName || WEBSITE_LEAD_SOURCE_NAME,
      contactName: lead.name,
      detail: inboundLeadDetail,
      idempotencyKey: inboundLeadIdempotencyKey,
      metadata: inboundLeadMetadata,
    });
    await client.query(
      'update leads set original_notes = replace(original_notes, $1, $2), updated_at = now() where id = $3',
      ['source_row_id=pending', 'source_row_id=' + sourceRowId, leadId],
    );
    await client.query('commit');

    return {
      ok: true,
      duplicate: false,
      contactId,
      leadId,
      businessUnitId,
      assignedUserId,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}
