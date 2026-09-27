import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertPublicRegistrationProgram,
  createPreviewRegistrationAdapter,
  createPublicRegistrationQuote,
  loadPublicRegistrationStatus,
  normalizeReturnState,
  publicPaymentState,
  verifyPublicRegistrationSecret,
} from './public-service.js';

test('public quote is authoritative and applies the locked fulfillment policy', () => {
  const shipment = createPublicRegistrationQuote({
    programCode: 'english_program',
    residenceCountryCode: 'US',
    billingCountryCode: 'US',
    learningModality: 'online',
    includeTuitionPrepayment: true,
  });
  assert.equal(shipment.quote.total, '290.00');
  assert.equal(shipment.fulfillment.deliveryMode, 'shipment');

  const pickup = createPublicRegistrationQuote({
    residenceCountryCode: 'US', billingCountryCode: 'US', learningModality: 'in_person',
  });
  assert.equal(pickup.quote.total, '95.00');
  assert.equal(pickup.fulfillment.deliveryMode, 'pickup');

  const digital = createPublicRegistrationQuote({
    residenceCountryCode: 'CO', billingCountryCode: 'CO', learningModality: 'online',
  });
  assert.equal(digital.fulfillment.deliveryMode, 'digital');
});

test('unsupported public program remains advisor-led and cannot create payment', () => {
  const result = createPublicRegistrationQuote({ programCode: 'medical_assistant' });
  assert.equal(result.quote.status, 'advisor_required');
  assert.equal(result.quote.reason, 'program_advisor_required');
  assert.throws(() => assertPublicRegistrationProgram('medical_assistant'),
    (error) => error.code === 'program_advisor_required' && error.status === 409);
  assert.equal(assertPublicRegistrationProgram(), 'english_program');
});

test('all approved US courses use the same server-owned public bundle and optional tuition', () => {
  const courses = [
    'english_program', 'espanol-extranjeros', 'ged', 'tutorias-matematicas',
    'computacion-basica', 'computacion-oficina',
  ];
  for (const programCode of courses) {
    assert.equal(assertPublicRegistrationProgram(programCode), programCode);
    const result = createPublicRegistrationQuote({
      programCode, residenceCountryCode: 'US', billingCountryCode: 'US',
      learningModality: 'in_person', includeTuitionPrepayment: true,
    });
    assert.equal(result.quote.status, 'quoted', programCode);
    assert.deepEqual(result.quote.lines.map((line) => line.amount), ['95.00', '195.00'], programCode);
    assert.equal(result.quote.total, '290.00', programCode);
    assert.equal(result.fulfillment.deliveryMode, 'pickup', programCode);
  }
});

test('US Hybrid uses the shared quote and physical book pickup', () => {
  const result = createPublicRegistrationQuote({
    programCode: 'english_program', residenceCountryCode: 'US', billingCountryCode: 'US',
    learningModality: 'hybrid',
  });
  assert.equal(result.quote.total, '95.00');
  assert.equal(result.fulfillment.deliveryMode, 'pickup');
});

test('new courses fail closed outside the US or with an unoffered modality', () => {
  const nonUs = createPublicRegistrationQuote({
    programCode: 'ged', residenceCountryCode: 'MX', billingCountryCode: 'MX',
    learningModality: 'in_person',
  });
  assert.equal(nonUs.quote.status, 'advisor_required');
  assert.equal(nonUs.quote.reason, 'program_country_advisor_required');
  const wrongMode = createPublicRegistrationQuote({
    programCode: 'ged', residenceCountryCode: 'US', billingCountryCode: 'US',
    learningModality: 'online',
  });
  assert.equal(wrongMode.quote.reason, 'program_modality_advisor_required');
  const nonUsHybrid = createPublicRegistrationQuote({
    programCode: 'english_program', residenceCountryCode: 'CO', billingCountryCode: 'CO',
    learningModality: 'hybrid',
  });
  assert.equal(nonUsHybrid.quote.reason, 'program_country_advisor_required');
  const nonUsEnglishInPerson = createPublicRegistrationQuote({
    programCode: 'english_program', residenceCountryCode: 'CO', billingCountryCode: 'CO',
    learningModality: 'in_person',
  });
  assert.equal(nonUsEnglishInPerson.quote.reason, 'program_country_advisor_required');
});

test('shared secret comparison and return-state validation fail closed', () => {
  assert.equal(verifyPublicRegistrationSecret('same-secret', 'same-secret'), true);
  assert.equal(verifyPublicRegistrationSecret('same-secret', 'different-secret'), false);
  assert.equal(verifyPublicRegistrationSecret('', ''), false);
  assert.equal(normalizeReturnState('opaque_state-token.1234567890'), 'opaque_state-token.1234567890');
  assert.throws(() => normalizeReturnState('short'), (error) => error.code === 'return_state_invalid');
});

test('public payment state never trusts a redirect and requires verified ledger state', () => {
  assert.equal(publicPaymentState({ request_status: 'pending' }), 'verifying');
  assert.equal(publicPaymentState({ request_status: 'completed', transaction_status: 'pending' }), 'verifying');
  assert.equal(publicPaymentState({ request_status: 'completed', transaction_status: 'verified' }), 'confirmed');
  assert.equal(publicPaymentState({ request_status: 'pending', transaction_status: 'declined' }), 'failed');
  assert.equal(publicPaymentState({ request_status: 'cancelled' }), 'cancelled');
  assert.equal(publicPaymentState({ request_status: 'pending', expires_at: '2000-01-01T00:00:00.000Z' }), 'expired');
});

test('status lookup is scoped to registration payments and returns a safe projection', async () => {
  let query;
  const client = { async query(sql, params) {
    query = { sql: String(sql), params };
    return { rows: [{
      id: 'request-1', request_status: 'completed', transaction_status: 'verified',
      requested_amount: '240.00', currency: 'USD', verified_at: '2026-09-18T00:00:00Z',
      receipt_document_id: 'receipt-1', enrollment_metadata: { placementState: 'recommended' }, metadata_json: { registrationResult: {
        quote: { total: '240.00' }, states: { registration: 'payment_pending', placement: 'not_started' },
        fulfillmentPolicy: { deliveryMode: 'digital' },
      } },
    }] };
  } };
  const result = await loadPublicRegistrationStatus(client, {
    organizationId: 'org-1', businessUnitId: 'bu-1',
  }, 'request-1');
  assert.match(query.sql, /source_type = 'registration'/);
  assert.deepEqual(query.params, ['request-1', 'org-1', 'bu-1']);
  assert.equal(result.state, 'confirmed');
  assert.equal(result.receiptAvailable, true);
  assert.equal(result.registration.placement, 'recommended');
  assert.equal(result.fulfillment.deliveryMode, 'digital');
});

test('preview adapter returns only to the registration origin and does not call a provider', async () => {
  const adapter = createPreviewRegistrationAdapter({
    siteOrigin: 'https://staging.example.com/path',
    returnState: 'opaque_state-token.1234567890',
  });
  const result = await adapter.createHostedPaymentPage({ correlationId: 'corr-1' });
  assert.equal(result.ok, true);
  assert.equal(result.checkout.origin, 'https://staging.example.com');
  assert.match(result.checkoutUrl, /^https:\/\/staging\.example\.com\/inscribete\//);
});
