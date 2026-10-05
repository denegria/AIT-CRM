import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateRegistrationQuote } from './catalog.js';
import { adjustStaffQuote } from './pricing.js';
import { authorizeRegistrationRequest } from './policy.js';

const quote = calculateRegistrationQuote({ channel: 'staff', itemCodes: ['registration_only'], includeTuitionPrepayment: true, residenceCountryCode: 'US', billingCountryCode: 'US' });
const actor = { canOverridePricing: true, userId: 'admin-1' };

test('staff quote reconciles item-level charge and prepayment discounts in exact cents', () => {
  const adjusted = adjustStaffQuote(quote, { finalAmounts: { registration_only: '45', tuition_prepayment_four_week: '175.00' }, reason: 'Approved scholarship' }, actor);
  assert.equal(adjusted.standardTotal, '250.00');
  assert.equal(adjusted.discount, '30.00');
  assert.equal(adjusted.total, '220.00');
  assert.deepEqual(adjusted.lines.map((line) => [line.standardAmount, line.discount, line.amount, line.ledgerTreatment]), [
    ['55.00', '10.00', '45.00', 'charge'], ['195.00', '20.00', '175.00', 'unapplied_credit'],
  ]);
  assert.equal(quote.total, '250.00');
});

test('total final adjustment distributes only positive line amounts and no surcharge', () => {
  const adjusted = adjustStaffQuote(quote, { finalTotal: '175.00', reason: 'Aid' }, actor);
  assert.equal(adjusted.totalCents, 17500);
  assert.ok(adjusted.lines.every((line) => line.amountCents > 0 && line.amountCents <= line.standardAmountCents));
  assert.throws(() => adjustStaffQuote(quote, { finalTotal: '250.01', reason: 'Aid' }, actor), /cannot exceed/);
  assert.throws(() => adjustStaffQuote(quote, { finalTotal: '0', reason: 'Aid' }, actor), /greater than zero/);
});

test('regular coordinator and public registration cannot override, regardless of client actor fields', () => {
  assert.throws(() => adjustStaffQuote(quote, { finalTotal: '220', reason: 'Aid' }, { userId: 'coordinator-1' }), (error) => error.status === 403);
  const base = { organizationId: 'org-1', businessUnitId: 'bu-1', idempotencyKey: 'registration:custom:fixture', sourceReference: 'fixture', residenceCountryCode: 'US', student: { name: 'Student', email: 'student@example.com' }, pricingAdjustment: { finalTotal: '50', reason: 'Aid' } };
  assert.throws(() => authorizeRegistrationRequest({ ...base, channel: 'public' }), (error) => error.code === 'pricing_override_denied');
  assert.throws(() => authorizeRegistrationRequest({ ...base, channel: 'staff', itemCodes: ['registration_only'], actor: { canManageRegistrations: true, businessUnitIds: ['bu-1'], userId: 'coordinator-1' } }), (error) => error.code === 'pricing_override_denied');
});

test('missing reason, zero, over-standard, and unselected line fail closed', () => {
  for (const adjustment of [
    { finalTotal: '175' },
    { finalAmounts: { registration_only: '0' }, reason: 'Aid' },
    { finalAmounts: { registration_only: '56' }, reason: 'Aid' },
    { finalAmounts: { book_only: '5' }, reason: 'Aid' },
  ]) assert.throws(() => adjustStaffQuote(quote, adjustment, actor));
});
