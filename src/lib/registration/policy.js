import {
  REGISTRATION_CHANNELS,
  REGISTRATION_ITEM_CODES,
  calculateRegistrationQuote,
} from './catalog.js';
import { resolveBookFulfillmentPlan } from '../fulfillment/policy.js';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{12,160}$/;
const PLACEMENT_REVIEW_STATUSES = new Set(['pending', 'in_review', 'confirmed', 'adjusted', 'additional_review_required']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class RegistrationPolicyError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'RegistrationPolicyError';
    this.code = code;
    this.status = status;
  }
}

function required(value, name) {
  const clean = String(value || '').trim();
  if (!clean) throw new RegistrationPolicyError('invalid_input', `${name} is required.`);
  return clean;
}

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanPhone(value) {
  return String(value || '').replace(/[^0-9+]/g, '');
}

function verifiedPlacementContext(actor, programCode) {
  if (programCode !== 'english_program' || !actor?.placement) return null;
  if (!actor.portalAccountId) {
    throw new RegistrationPolicyError('placement_account_required', 'A verified Portal account is required for placement context.', 403);
  }
  const attemptId = String(actor.placement.attemptId || '').trim();
  const reviewStatus = String(actor.placement.reviewStatus || '').trim();
  const recommendedLevel = String(actor.placement.recommendedLevel || '').trim();
  const finalLevel = String(actor.placement.finalLevel || '').trim();
  if (!UUID_PATTERN.test(attemptId) || !PLACEMENT_REVIEW_STATUSES.has(reviewStatus)
    || !recommendedLevel || recommendedLevel.length > 120 || finalLevel.length > 120
    || (['confirmed', 'adjusted'].includes(reviewStatus) !== Boolean(finalLevel))) {
    throw new RegistrationPolicyError('placement_context_invalid', 'Verified placement context is invalid.', 400);
  }
  return Object.freeze({ attemptId, reviewStatus, recommendedLevel, finalLevel: finalLevel || null });
}

function cleanIdentity(value = {}, { channel, label, verifiedContactIds }) {
  const contactId = String(value.contactId || '').trim() || null;
  if (contactId && channel === REGISTRATION_CHANNELS.PUBLIC && !verifiedContactIds.has(contactId)) {
    throw new RegistrationPolicyError('unverified_contact_reference', `${label} contact reference requires a verified portal link.`, 403);
  }
  const identity = {
    contactId,
    name: String(value.name || '').trim().replace(/\s+/g, ' '),
    email: cleanEmail(value.email),
    phone: cleanPhone(value.phone),
  };
  if (!identity.contactId) {
    if (!identity.name) throw new RegistrationPolicyError('identity_name_required', `${label} name is required.`);
    if (!identity.email && !identity.phone) {
      throw new RegistrationPolicyError('identity_evidence_required', `${label} email or phone is required.`);
    }
  }
  return Object.freeze(identity);
}

export function authorizeRegistrationRequest(input = {}) {
  const organizationId = required(input.organizationId, 'organizationId');
  const businessUnitId = required(input.businessUnitId, 'businessUnitId');
  const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new RegistrationPolicyError('idempotency_key_invalid', 'idempotencyKey must be 12-160 safe characters.');
  }
  const channel = String(input.channel || '').trim().toLowerCase();
  if (!Object.values(REGISTRATION_CHANNELS).includes(channel)) {
    throw new RegistrationPolicyError('registration_channel_invalid', 'Registration channel is not supported.');
  }
  if (channel === REGISTRATION_CHANNELS.STAFF && input.actor?.canManageRegistrations !== true) {
    throw new RegistrationPolicyError('registration_permission_denied', 'Staff registration permission is required.', 403);
  }
  if (channel === REGISTRATION_CHANNELS.STAFF
    && input.actor?.isAdmin !== true
    && !(input.actor?.businessUnitIds || []).includes(businessUnitId)) {
    throw new RegistrationPolicyError('business_unit_permission_denied', 'Staff access to the requested business unit is required.', 403);
  }

  const itemCodes = Array.isArray(input.itemCodes) && input.itemCodes.length
    ? input.itemCodes
    : channel === REGISTRATION_CHANNELS.PUBLIC
      ? [REGISTRATION_ITEM_CODES.PUBLIC_BUNDLE]
      : [];
  const quote = calculateRegistrationQuote({
    channel,
    itemCodes,
    includeTuitionPrepayment: input.includeTuitionPrepayment === true,
    residenceCountryCode: input.residenceCountryCode,
    billingCountryCode: input.billingCountryCode,
  });
  if (quote.status === 'advisor_required') {
    return Object.freeze({
      status: 'advisor_required',
      reason: quote.reason,
      organizationId,
      businessUnitId,
      idempotencyKey,
      quote,
    });
  }

  const verifiedContactIds = new Set(
    channel === REGISTRATION_CHANNELS.PUBLIC
      ? (input.actor?.verifiedCrmContactIds || []).map((value) => String(value || '').trim()).filter(Boolean)
      : [],
  );
  const student = cleanIdentity(input.student, { channel, label: 'Student', verifiedContactIds });
  const payer = input.payer
    ? cleanIdentity(input.payer, { channel, label: 'Payer', verifiedContactIds })
    : null;
  const includesBook = quote.lines.some((line) => (
    [REGISTRATION_ITEM_CODES.PUBLIC_BUNDLE, REGISTRATION_ITEM_CODES.BOOK_ONLY].includes(line.code)
  ));
  const fulfillmentPlan = includesBook
    ? resolveBookFulfillmentPlan({
      residenceCountryCode: quote.regionalPricing.residenceCountryCode,
      learningModality: input.learningModality,
      shippingAddress: input.shippingAddress,
    })
    : null;
  const programCode = String(input.programCode || 'english_program').trim().toLowerCase();
  return Object.freeze({
    status: 'authorized',
    organizationId,
    businessUnitId,
    idempotencyKey,
    channel,
    sourceReference: required(input.sourceReference, 'sourceReference'),
    portalAccountId: channel === REGISTRATION_CHANNELS.PUBLIC
      ? String(input.actor?.portalAccountId || '').trim() || null
      : null,
    placement: channel === REGISTRATION_CHANNELS.PUBLIC
      ? verifiedPlacementContext(input.actor, programCode)
      : null,
    programCode,
    classSectionId: String(input.classSectionId || '').trim() || null,
    student,
    payer,
    quote,
    fulfillmentPlan,
  });
}
