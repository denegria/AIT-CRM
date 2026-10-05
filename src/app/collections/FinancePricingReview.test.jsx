import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RegistrationPricingReview, TuitionPricingReview } from './FinancePricingReview.js';
import { calculateRegistrationQuote } from '../../lib/registration/catalog.js';
import { adjustStaffQuote } from '../../lib/registration/pricing.js';

const standard = calculateRegistrationQuote({ channel: 'staff', itemCodes: ['registration_only'], includeTuitionPrepayment: true, residenceCountryCode: 'US' });

test('actual registration review component shows standard, discount, final and privileged reason', () => {
  const adjusted = adjustStaffQuote(standard, { finalAmounts: { registration_only: '45', tuition_prepayment_four_week: '175' }, reason: 'Scholarship' }, { canOverridePricing: true, userId: 'admin-1' });
  const html = renderToStaticMarkup(React.createElement(RegistrationPricingReview, { quote: adjusted, canOverridePricing: true }));
  assert.match(html, /Standard \$55\.00 · Discount \$10\.00 · Final \$45\.00/);
  assert.match(html, /Standard \$195\.00 · Discount \$20\.00 · Final \$175\.00/);
  assert.match(html, /Scholarship/);
  const regular = renderToStaticMarkup(React.createElement(RegistrationPricingReview, { quote: standard, canOverridePricing: false }));
  assert.match(regular, /Standard \$195\.00 · Discount \$0\.00 · Final \$195\.00/);
  assert.doesNotMatch(regular, /Adjustment reason|Scholarship/);
});

test('actual payment review component exposes audit only to privileged role', () => {
  const charge = { amount: '175.00', pricing: { standardAmount: '195.00', discount: '20.00', history: [{ eventType: 'adjusted', oldAmount: '195.00', newAmount: '175.00', reason: 'Aid', actorUserId: 'admin-1', createdAt: '2026-10-05T12:00:00Z' }] } };
  const admin = renderToStaticMarkup(React.createElement(TuitionPricingReview, { charge, canOverridePricing: true }));
  assert.match(admin, /Standard \$195\.00 · Discount \$20\.00 · Final \$175\.00/);
  assert.match(admin, /Adjustment audit/);
  assert.match(admin, /Aid/);
  const regular = renderToStaticMarkup(React.createElement(TuitionPricingReview, { charge, canOverridePricing: false }));
  assert.match(regular, /Final \$175\.00/);
  assert.doesNotMatch(regular, /Adjustment audit|Aid|admin-1/);
});
