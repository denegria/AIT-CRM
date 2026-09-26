import { timingSafeEqual } from 'node:crypto';

import { resolveBookFulfillmentMode } from '../fulfillment/policy.js';
import { calculateRegistrationQuote, REGISTRATION_CHANNELS, REGISTRATION_ITEM_CODES } from './catalog.js';

const RETURN_STATE_PATTERN = /^[A-Za-z0-9._~-]{20,2048}$/;
const PUBLIC_PROGRAM_CODE = 'english_program';

export class PublicRegistrationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'PublicRegistrationError';
    this.code = code;
    this.status = status;
  }
}

function clean(value) { return String(value || '').trim(); }

export function verifyPublicRegistrationSecret(received, expected) {
  const left = Buffer.from(clean(received));
  const right = Buffer.from(clean(expected));
  return Boolean(left.length && left.length === right.length && timingSafeEqual(left, right));
}

export function createPublicRegistrationQuote(input = {}) {
  const programCode = clean(input.programCode || PUBLIC_PROGRAM_CODE).toLowerCase();
  if (programCode !== PUBLIC_PROGRAM_CODE) {
    return {
      quote: {
        status: 'advisor_required',
        reason: 'program_advisor_required',
        lines: [],
        totalCents: 0,
        total: '0.00',
        currency: 'USD',
      },
      fulfillment: null,
    };
  }
  const quote = calculateRegistrationQuote({
    channel: REGISTRATION_CHANNELS.PUBLIC,
    itemCodes: [REGISTRATION_ITEM_CODES.PUBLIC_BUNDLE],
    includeTuitionPrepayment: input.includeTuitionPrepayment === true,
    residenceCountryCode: input.residenceCountryCode,
    billingCountryCode: input.billingCountryCode,
  });
  if (quote.status !== 'quoted') return { quote, fulfillment: null };
  return {
    quote,
    fulfillment: resolveBookFulfillmentMode({
      residenceCountryCode: quote.regionalPricing.residenceCountryCode,
      learningModality: input.learningModality,
    }),
  };
}

export function assertPublicRegistrationProgram(value) {
  const programCode = clean(value || PUBLIC_PROGRAM_CODE).toLowerCase();
  if (programCode !== PUBLIC_PROGRAM_CODE) {
    throw new PublicRegistrationError(
      'program_advisor_required',
      'This program requires an advisor before payment.',
      409,
    );
  }
  return PUBLIC_PROGRAM_CODE;
}

export function normalizeReturnState(value) {
  const state = clean(value);
  if (!RETURN_STATE_PATTERN.test(state)) {
    throw new PublicRegistrationError('return_state_invalid', 'Payment return state is invalid.');
  }
  return state;
}

export function publicPaymentState(row = {}) {
  const requestStatus = clean(row.request_status || row.requestStatus).toLowerCase();
  const transactionStatus = clean(row.transaction_status || row.transactionStatus).toLowerCase();
  if (requestStatus === 'completed' && transactionStatus === 'verified') return 'confirmed';
  if (['failed', 'declined'].includes(transactionStatus)) return 'failed';
  if (['cancelled', 'canceled'].includes(requestStatus)) return 'cancelled';
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return 'expired';
  return 'verifying';
}

export async function loadPublicRegistrationStatus(client, scope, paymentRequestId) {
  const id = clean(paymentRequestId);
  if (!id) throw new PublicRegistrationError('payment_request_required', 'Payment request is required.');
  const result = await client.query(
    `select pr.id, pr.status as request_status, pr.requested_amount, pr.currency, pr.expires_at,
            pr.metadata_json, transaction.status as transaction_status,
            transaction.verified_at, transaction.receipt_document_id
       from payment_requests pr
       left join lateral (
         select pt.status, pt.verified_at, pt.receipt_document_id
           from provider_transactions pt
          where pt.payment_request_id = pr.id and pt.organization_id = pr.organization_id
          order by pt.created_at desc limit 1
       ) transaction on true
      where pr.id = $1 and pr.organization_id = $2 and pr.business_unit_id = $3
        and pr.source_type = 'registration'
      limit 1`,
    [id, scope.organizationId, scope.businessUnitId],
  );
  const row = result.rows[0];
  if (!row) throw new PublicRegistrationError('payment_request_not_found', 'Registration payment was not found.', 404);
  const metadata = row.metadata_json || {};
  const registration = metadata.registrationResult || {};
  return {
    paymentRequestId: row.id,
    state: publicPaymentState(row),
    amount: String(row.requested_amount),
    currency: row.currency,
    quote: registration.quote || null,
    registration: registration.states || null,
    fulfillment: registration.fulfillmentPolicy || null,
    verifiedAt: row.verified_at || null,
    receiptAvailable: Boolean(row.receipt_document_id),
  };
}

export function createPreviewRegistrationAdapter({ siteOrigin, returnState }) {
  const origin = new URL(siteOrigin).origin;
  return {
    async createHostedPaymentPage(input) {
      const checkoutUrl = `${origin}/inscribete/?payment=return&state=${encodeURIComponent(returnState)}&provider=preview`;
      return {
        ok: true,
        correlationId: input.correlationId,
        checkoutUrl,
        checkout: { origin },
      };
    },
  };
}
