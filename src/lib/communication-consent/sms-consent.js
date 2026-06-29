export const SMS_CHANNEL = 'sms';

export const SMS_CONSENT_STATUSES = Object.freeze({
  UNKNOWN: 'unknown',
  OPTED_IN: 'opted_in',
  OPTED_OUT: 'opted_out',
});

export const SMS_CONSENT_EVENT_TYPES = Object.freeze({
  OPT_IN: 'opt_in',
  OPT_OUT: 'opt_out',
  HELP: 'help',
  MANUAL_UPDATE: 'manual_update',
  IMPORT_SYNC: 'import_sync',
});

export const SMS_CONSENT_SOURCE_TYPES = Object.freeze({
  WEBSITE_FORM: 'website_form',
  PROVIDER_WEBHOOK: 'provider_webhook',
  MANUAL: 'manual',
  IMPORT: 'import',
  CAMPAIGN: 'campaign',
});

export const SMS_ELIGIBILITY_BLOCK_CODES = Object.freeze({
  PHONE_MISSING: 'phone_missing',
  CONTACT_BLOCKED: 'contact_blocked',
  SMS_CONSENT_MISSING: 'sms_consent_missing',
  SMS_OPTED_OUT: 'sms_opted_out',
});

const OPT_OUT_KEYWORDS = new Set(['stop', 'stopall', 'stop all', 'unsubscribe', 'cancel', 'end', 'quit']);
const OPT_IN_KEYWORDS = new Set(['start', 'unstop', 'yes']);
const HELP_KEYWORDS = new Set(['help', 'info']);
const MUTATING_STATUSES = new Set([
  SMS_CONSENT_STATUSES.OPTED_IN,
  SMS_CONSENT_STATUSES.OPTED_OUT,
]);

function cleanText(value) {
  return String(value || '').trim();
}

function cleanLower(value) {
  return cleanText(value).toLowerCase();
}

function cleanNullableText(value) {
  const text = cleanText(value);
  return text || null;
}

function cleanJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeDate(value, fallback = new Date()) {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function normalizeKeywordText(value) {
  return cleanLower(value).replace(/\s+/g, ' ');
}

function isKnownStatus(value) {
  return Object.values(SMS_CONSENT_STATUSES).includes(cleanLower(value));
}

function statusForEventType(eventType, fallback = SMS_CONSENT_STATUSES.UNKNOWN) {
  if (eventType === SMS_CONSENT_EVENT_TYPES.OPT_IN) return SMS_CONSENT_STATUSES.OPTED_IN;
  if (eventType === SMS_CONSENT_EVENT_TYPES.OPT_OUT) return SMS_CONSENT_STATUSES.OPTED_OUT;
  return fallback;
}

export function smsConsentScopeKey({ businessUnitId = null } = {}) {
  const unitId = cleanNullableText(businessUnitId);
  return unitId ? `business_unit:${unitId}` : 'organization';
}

export function classifySmsKeyword(value) {
  const keyword = normalizeKeywordText(value);
  if (!keyword) return { eventType: null, keyword: '' };
  if (OPT_OUT_KEYWORDS.has(keyword)) return { eventType: SMS_CONSENT_EVENT_TYPES.OPT_OUT, keyword };
  if (OPT_IN_KEYWORDS.has(keyword)) return { eventType: SMS_CONSENT_EVENT_TYPES.OPT_IN, keyword };
  if (HELP_KEYWORDS.has(keyword)) return { eventType: SMS_CONSENT_EVENT_TYPES.HELP, keyword };
  return { eventType: null, keyword };
}

export function normalizeSmsConsentEvent(input = {}) {
  const organizationId = cleanText(input.organizationId);
  const contactId = cleanText(input.contactId);
  const businessUnitId = cleanNullableText(input.businessUnitId);
  const keyword = classifySmsKeyword(input.keyword || input.text || '');
  const eventType = cleanLower(input.eventType || keyword.eventType);
  const fallbackStatus = cleanLower(input.consentStatus || input.status);
  const consentStatus = isKnownStatus(fallbackStatus)
    ? fallbackStatus
    : statusForEventType(eventType);

  if (!organizationId) throw new Error('organizationId is required for SMS consent events.');
  if (!contactId) throw new Error('contactId is required for SMS consent events.');
  if (!Object.values(SMS_CONSENT_EVENT_TYPES).includes(eventType)) {
    throw new Error('Unsupported SMS consent event type.');
  }
  if (!isKnownStatus(consentStatus)) {
    throw new Error('Unsupported SMS consent status.');
  }

  return {
    organizationId,
    contactId,
    businessUnitId,
    scopeKey: smsConsentScopeKey({ businessUnitId }),
    channel: SMS_CHANNEL,
    eventType,
    consentStatus,
    sourceType: cleanNullableText(input.sourceType),
    sourceReference: cleanNullableText(input.sourceReference),
    actorUserId: cleanNullableText(input.actorUserId),
    provider: cleanNullableText(input.provider),
    providerEventId: cleanNullableText(input.providerEventId),
    idempotencyKey: cleanNullableText(input.idempotencyKey),
    disclosureText: cleanNullableText(input.disclosureText),
    optOutReason: cleanNullableText(input.optOutReason || keyword.keyword),
    metadataJson: cleanJsonObject(input.metadataJson),
    occurredAt: normalizeDate(input.occurredAt),
  };
}

function consentEventPayload(event) {
  return [
    event.organizationId,
    event.contactId,
    event.businessUnitId,
    event.scopeKey,
    event.channel,
    event.eventType,
    event.consentStatus,
    event.sourceType,
    event.sourceReference,
    event.actorUserId,
    event.provider,
    event.providerEventId,
    event.idempotencyKey,
    event.disclosureText,
    JSON.stringify(event.metadataJson),
    event.occurredAt,
  ];
}

async function findDuplicateConsentEvent(client, event) {
  if (!event.idempotencyKey) return null;
  const result = await client.query(
    `
      select id
      from contact_channel_consent_events
      where organization_id = $1 and idempotency_key = $2
      limit 1
    `,
    [event.organizationId, event.idempotencyKey],
  );
  return result.rows[0]?.id || null;
}

async function upsertSmsConsent(client, event) {
  if (!MUTATING_STATUSES.has(event.consentStatus)) return null;

  const result = await client.query(
    `
      insert into contact_channel_consents (
        organization_id,
        contact_id,
        business_unit_id,
        scope_key,
        channel,
        consent_status,
        opt_in_source,
        opt_in_reference,
        opt_in_disclosure_text,
        opt_in_occurred_at,
        opt_out_source,
        opt_out_reference,
        opt_out_reason,
        opt_out_occurred_at,
        metadata_json
      )
      values (
        $1, $2, $3, $4, $5, $6,
        case when $6 = 'opted_in' then $7 else null end,
        case when $6 = 'opted_in' then $8 else null end,
        case when $6 = 'opted_in' then $9 else null end,
        case when $6 = 'opted_in' then $10::timestamptz else null end,
        case when $6 = 'opted_out' then $7 else null end,
        case when $6 = 'opted_out' then $8 else null end,
        case when $6 = 'opted_out' then $11 else null end,
        case when $6 = 'opted_out' then $10::timestamptz else null end,
        $12::jsonb
      )
      on conflict (organization_id, contact_id, channel, scope_key)
      do update set
        business_unit_id = excluded.business_unit_id,
        consent_status = excluded.consent_status,
        opt_in_source = case when excluded.consent_status = 'opted_in' then excluded.opt_in_source else contact_channel_consents.opt_in_source end,
        opt_in_reference = case when excluded.consent_status = 'opted_in' then excluded.opt_in_reference else contact_channel_consents.opt_in_reference end,
        opt_in_disclosure_text = case when excluded.consent_status = 'opted_in' then excluded.opt_in_disclosure_text else contact_channel_consents.opt_in_disclosure_text end,
        opt_in_occurred_at = case when excluded.consent_status = 'opted_in' then excluded.opt_in_occurred_at else contact_channel_consents.opt_in_occurred_at end,
        opt_out_source = case when excluded.consent_status = 'opted_out' then excluded.opt_out_source when excluded.consent_status = 'opted_in' then null else contact_channel_consents.opt_out_source end,
        opt_out_reference = case when excluded.consent_status = 'opted_out' then excluded.opt_out_reference when excluded.consent_status = 'opted_in' then null else contact_channel_consents.opt_out_reference end,
        opt_out_reason = case when excluded.consent_status = 'opted_out' then excluded.opt_out_reason when excluded.consent_status = 'opted_in' then null else contact_channel_consents.opt_out_reason end,
        opt_out_occurred_at = case when excluded.consent_status = 'opted_out' then excluded.opt_out_occurred_at when excluded.consent_status = 'opted_in' then null else contact_channel_consents.opt_out_occurred_at end,
        metadata_json = contact_channel_consents.metadata_json || excluded.metadata_json,
        updated_at = now()
      returning id, consent_status
    `,
    [
      event.organizationId,
      event.contactId,
      event.businessUnitId,
      event.scopeKey,
      event.channel,
      event.consentStatus,
      event.sourceType,
      event.sourceReference,
      event.disclosureText,
      event.occurredAt,
      event.optOutReason,
      JSON.stringify(event.metadataJson),
    ],
  );

  return result.rows[0] || null;
}

async function insertSmsConsentEvent(client, event) {
  const result = await client.query(
    `
      insert into contact_channel_consent_events (
        organization_id,
        contact_id,
        business_unit_id,
        scope_key,
        channel,
        event_type,
        consent_status,
        source_type,
        source_reference,
        actor_user_id,
        provider,
        provider_event_id,
        idempotency_key,
        disclosure_text,
        metadata_json,
        occurred_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16)
      returning id
    `,
    consentEventPayload(event),
  );
  return result.rows[0]?.id || null;
}

export async function recordSmsConsentEvent(client, input = {}, options = {}) {
  const event = normalizeSmsConsentEvent(input);
  const useTransaction = options.useTransaction !== false;

  if (useTransaction) await client.query('begin');
  try {
    const duplicateEventId = await findDuplicateConsentEvent(client, event);
    if (duplicateEventId) {
      if (useTransaction) await client.query('commit');
      return {
        duplicate: true,
        eventId: duplicateEventId,
        consentId: null,
        consentStatus: event.consentStatus,
        eventType: event.eventType,
      };
    }

    const consent = await upsertSmsConsent(client, event);
    const eventId = await insertSmsConsentEvent(client, event);
    if (useTransaction) await client.query('commit');
    return {
      duplicate: false,
      eventId,
      consentId: consent?.id || null,
      consentStatus: consent?.consent_status || event.consentStatus,
      eventType: event.eventType,
    };
  } catch (error) {
    if (useTransaction) await client.query('rollback');
    throw error;
  }
}

export async function loadSmsConsentForContact(client, {
  organizationId,
  contactId,
  businessUnitId = null,
} = {}) {
  const orgId = cleanText(organizationId);
  const id = cleanText(contactId);
  if (!orgId) throw new Error('organizationId is required to load SMS consent.');
  if (!id) throw new Error('contactId is required to load SMS consent.');

  const scopeKeys = businessUnitId
    ? [smsConsentScopeKey({ businessUnitId }), smsConsentScopeKey()]
    : [smsConsentScopeKey()];
  const result = await client.query(
    `
      select
        id,
        organization_id,
        contact_id,
        business_unit_id,
        scope_key,
        channel,
        consent_status,
        opt_in_source,
        opt_in_reference,
        opt_in_disclosure_text,
        opt_in_occurred_at,
        opt_out_source,
        opt_out_reference,
        opt_out_reason,
        opt_out_occurred_at,
        metadata_json,
        updated_at
      from contact_channel_consents
      where organization_id = $1
        and contact_id = $2
        and channel = 'sms'
        and scope_key = any($3::text[])
      order by case when scope_key = $4 then 0 else 1 end, updated_at desc
      limit 1
    `,
    [orgId, id, scopeKeys, scopeKeys[0]],
  );
  return result.rows[0] || null;
}

export function evaluateSmsEligibility({ contact = {}, consent = null } = {}) {
  const reasons = [];
  if (!cleanText(contact.phone)) {
    reasons.push({
      code: SMS_ELIGIBILITY_BLOCK_CODES.PHONE_MISSING,
      message: 'Contact must have a phone number before SMS can be sent.',
    });
  }
  if (
    contact.is_do_not_call
    || contact.isDoNotCall
    || contact.is_wrong_number
    || contact.isWrongNumber
  ) {
    reasons.push({
      code: SMS_ELIGIBILITY_BLOCK_CODES.CONTACT_BLOCKED,
      message: 'Contact is marked do-not-call or wrong number.',
    });
  }

  const status = cleanLower(consent?.consent_status || consent?.consentStatus);
  if (status === SMS_CONSENT_STATUSES.OPTED_OUT) {
    reasons.push({
      code: SMS_ELIGIBILITY_BLOCK_CODES.SMS_OPTED_OUT,
      message: 'Contact has opted out of SMS.',
    });
  } else if (status !== SMS_CONSENT_STATUSES.OPTED_IN) {
    reasons.push({
      code: SMS_ELIGIBILITY_BLOCK_CODES.SMS_CONSENT_MISSING,
      message: 'Explicit SMS opt-in is required before SMS can be sent.',
    });
  }

  return {
    ok: reasons.length === 0,
    blocked: reasons.length > 0,
    reasons,
  };
}
