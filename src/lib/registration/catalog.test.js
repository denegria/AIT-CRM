import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REGIONAL_COUNTRY_MAP,
  REGISTRATION_ITEM_CODES,
  RegistrationCatalogError,
  TUITION_REGION_RATES_CENTS,
  calculateRegistrationQuote,
  resolveRegionalPricing,
} from './catalog.js';
import { RegistrationPolicyError, authorizeRegistrationRequest } from './policy.js';

test('complete supported-country matrix resolves to the pinned regional rate', () => {
  assert.ok(Object.keys(REGIONAL_COUNTRY_MAP).length > 60);
  for (const [countryCode, region] of Object.entries(REGIONAL_COUNTRY_MAP)) {
    const decision = resolveRegionalPricing({ residenceCountryCode: countryCode });
    assert.equal(decision.status, 'eligible', countryCode);
    assert.equal(decision.region, region, countryCode);
    assert.equal(decision.tuitionRateCents, TUITION_REGION_RATES_CENTS[region], countryCode);
  }
});

test('public pricing ignores browser amounts and returns an immutable non-taxable bundle', () => {
  const quote = calculateRegistrationQuote({
    channel: 'public',
    itemCodes: [REGISTRATION_ITEM_CODES.PUBLIC_BUNDLE],
    residenceCountryCode: 'US',
    submittedAmount: '0.01',
    prices: { registration_book_bundle: '0.01' },
  });
  assert.equal(quote.totalCents, 9500);
  assert.equal(quote.total, '95.00');
  assert.equal(quote.taxCents, 0);
  assert.equal(quote.lines[0].amount, '95.00');
  assert.equal(quote.lines[0].taxable, false);
  assert.equal(Object.isFrozen(quote), true);
  assert.equal(Object.isFrozen(quote.lines), true);
  assert.equal(Object.isFrozen(quote.lines[0]), true);
});

test('regional tuition prepayment is itemized as unapplied credit', () => {
  const expected = new Map([
    ['US', 19500],
    ['FR', 17500],
    ['MX', 14500],
  ]);
  for (const [countryCode, tuitionCents] of expected) {
    const quote = calculateRegistrationQuote({
      channel: 'public',
      itemCodes: [REGISTRATION_ITEM_CODES.PUBLIC_BUNDLE],
      includeTuitionPrepayment: true,
      billingCountryCode: countryCode,
    });
    const tuition = quote.lines.find((line) => line.code === REGISTRATION_ITEM_CODES.TUITION_PREPAYMENT);
    assert.equal(tuition.amountCents, tuitionCents, countryCode);
    assert.equal(tuition.ledgerTreatment, 'unapplied_credit', countryCode);
    assert.equal(quote.totalCents, 9500 + tuitionCents, countryCode);
  }
});

test('unsupported and conflicting residence/billing regions route to advisor handling', () => {
  const unsupported = calculateRegistrationQuote({
    channel: 'public',
    itemCodes: [REGISTRATION_ITEM_CODES.PUBLIC_BUNDLE],
    residenceCountryCode: 'BR',
  });
  assert.equal(unsupported.status, 'advisor_required');
  assert.equal(unsupported.reason, 'unsupported_pricing_country');

  const conflict = calculateRegistrationQuote({
    channel: 'public',
    itemCodes: [REGISTRATION_ITEM_CODES.PUBLIC_BUNDLE],
    residenceCountryCode: 'US',
    billingCountryCode: 'MX',
  });
  assert.equal(conflict.status, 'advisor_required');
  assert.equal(conflict.reason, 'pricing_country_region_conflict');
});

test('public callers cannot select staff-only catalog items', () => {
  assert.throws(
    () => calculateRegistrationQuote({
      channel: 'public',
      itemCodes: [REGISTRATION_ITEM_CODES.REGISTRATION_ONLY],
      residenceCountryCode: 'US',
    }),
    (error) => error instanceof RegistrationCatalogError
      && error.code === 'catalog_item_forbidden'
      && error.status === 403,
  );
});

test('staff may create separate registration and book lines but not double-count the bundle', () => {
  const quote = calculateRegistrationQuote({
    channel: 'staff',
    itemCodes: [REGISTRATION_ITEM_CODES.REGISTRATION_ONLY, REGISTRATION_ITEM_CODES.BOOK_ONLY],
    residenceCountryCode: 'ES',
  });
  assert.equal(quote.totalCents, 11000);
  assert.deepEqual(quote.lines.map((line) => line.amountCents), [5500, 5500]);
  assert.throws(
    () => calculateRegistrationQuote({
      channel: 'staff',
      itemCodes: [REGISTRATION_ITEM_CODES.PUBLIC_BUNDLE, REGISTRATION_ITEM_CODES.BOOK_ONLY],
      residenceCountryCode: 'ES',
    }),
    (error) => error instanceof RegistrationCatalogError && error.code === 'catalog_item_conflict',
  );
});

test('registration policy gates staff permissions and unverified public contact references', () => {
  const base = {
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    idempotencyKey: 'registration:request:123',
    sourceReference: 'public-form-123',
    residenceCountryCode: 'US',
    student: { name: 'Student', email: 'student@example.com' },
  };
  assert.throws(
    () => authorizeRegistrationRequest({ ...base, channel: 'staff' }),
    (error) => error instanceof RegistrationPolicyError && error.code === 'registration_permission_denied',
  );
  assert.throws(
    () => authorizeRegistrationRequest({
      ...base,
      channel: 'public',
      student: { contactId: 'contact-1' },
    }),
    (error) => error instanceof RegistrationPolicyError && error.code === 'unverified_contact_reference',
  );
  assert.throws(
    () => authorizeRegistrationRequest({
      ...base,
      channel: 'staff',
      actor: { canManageRegistrations: true, businessUnitIds: ['other-bu'] },
      itemCodes: [REGISTRATION_ITEM_CODES.REGISTRATION_ONLY],
    }),
    (error) => error instanceof RegistrationPolicyError && error.code === 'business_unit_permission_denied',
  );
});
