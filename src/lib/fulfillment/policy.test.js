import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveBookFulfillmentMode, resolveBookFulfillmentPlan } from './policy.js';

const usAddress = Object.freeze({
  recipientName: 'Ana Student',
  addressLine1: '100 Main Street',
  addressLine2: 'Apt 2',
  city: 'Miami',
  state: 'fl',
  postalCode: '33101',
  countryCode: 'us',
});

test('fulfillment policy locks US in-person registration to physical pickup', () => {
  assert.deepEqual(resolveBookFulfillmentPlan({
    residenceCountryCode: 'US',
    learningModality: 'in_person',
  }), {
    policyVersion: '2026-09-18.v1',
    residenceCountryCode: 'US',
    learningModality: 'in_person',
    deliveryMode: 'pickup',
    requiresDigitalDelivery: false,
    requiresPhysicalDelivery: true,
    shippingAddressSnapshot: null,
  });
});

test('fulfillment policy requires a validated address for US online shipment and keeps digital access', () => {
  const result = resolveBookFulfillmentPlan({
    residenceCountryCode: 'US',
    learningModality: 'online',
    shippingAddress: usAddress,
  });
  assert.equal(result.deliveryMode, 'shipment');
  assert.equal(result.requiresDigitalDelivery, true);
  assert.equal(result.requiresPhysicalDelivery, true);
  assert.equal(result.shippingAddressSnapshot.state, 'FL');
  assert.equal(result.shippingAddressSnapshot.countryCode, 'US');
});

test('fulfillment policy sends students outside the US to digital fulfillment without address collection', () => {
  const result = resolveBookFulfillmentPlan({
    residenceCountryCode: 'MX',
    learningModality: 'online',
  });
  assert.equal(result.deliveryMode, 'digital');
  assert.equal(result.requiresDigitalDelivery, true);
  assert.equal(result.requiresPhysicalDelivery, false);
  assert.equal(result.shippingAddressSnapshot, null);
});

test('fulfillment policy rejects unnecessary address PII for pickup or digital delivery', () => {
  assert.throws(() => resolveBookFulfillmentPlan({
    residenceCountryCode: 'US',
    learningModality: 'in_person',
    shippingAddress: usAddress,
  }), (error) => error.code === 'shipping_address_not_allowed');
  assert.throws(() => resolveBookFulfillmentPlan({
    residenceCountryCode: 'MX',
    learningModality: 'online',
    shippingAddress: usAddress,
  }), (error) => error.code === 'shipping_address_not_allowed');
});

test('fulfillment policy rejects incomplete or non-US shipping snapshots', () => {
  assert.throws(() => resolveBookFulfillmentPlan({
    residenceCountryCode: 'US',
    learningModality: 'online',
    shippingAddress: { ...usAddress, postalCode: '' },
  }), (error) => error.code === 'shipping_address_incomplete');
  assert.throws(() => resolveBookFulfillmentPlan({
    residenceCountryCode: 'US',
    learningModality: 'online',
    shippingAddress: { ...usAddress, countryCode: 'CA' },
  }), (error) => error.code === 'shipping_country_invalid');
});

test('fulfillment mode can be quoted without collecting address PII', () => {
  assert.equal(resolveBookFulfillmentMode({
    residenceCountryCode: 'US',
    learningModality: 'online',
  }).deliveryMode, 'shipment');
  assert.equal(resolveBookFulfillmentMode({
    residenceCountryCode: 'US',
    learningModality: 'in_person',
  }).deliveryMode, 'pickup');
  assert.equal(resolveBookFulfillmentMode({
    residenceCountryCode: 'CO',
    learningModality: 'online',
  }).deliveryMode, 'digital');
});
