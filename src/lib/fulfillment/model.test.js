import assert from 'node:assert/strict';
import test from 'node:test';

import { applyFulfillmentAction, normalizeFulfillmentLane } from './model.js';

const now = new Date('2026-09-18T03:00:00.000Z');

function item(overrides = {}) {
  return {
    status: 'pending',
    deliveryMode: 'shipment',
    digitalStatus: 'pending',
    physicalStatus: 'pending',
    assignedUserId: null,
    ...overrides,
  };
}

test('US online fulfillment stays open after digital delivery until shipment completes', () => {
  const digital = applyFulfillmentAction(item(), {
    action: 'mark_digital_delivered',
    actorUserId: 'user-1',
    now,
  });
  assert.equal(digital.digitalStatus, 'delivered');
  assert.equal(digital.physicalStatus, 'pending');
  assert.equal(digital.status, 'in_progress');
  const shipped = applyFulfillmentAction({ ...item(), ...digital }, {
    action: 'mark_shipped',
    actorUserId: 'user-1',
    carrier: 'UPS',
    trackingReference: '1Z999',
    now,
  });
  assert.equal(shipped.status, 'completed');
  assert.equal(shipped.physicalStatus, 'shipped');
});

test('pickup requires ready before picked up and completes without digital delivery', () => {
  const pickup = item({ deliveryMode: 'pickup', digitalStatus: 'not_required' });
  assert.throws(() => applyFulfillmentAction(pickup, {
    action: 'mark_picked_up',
    actorUserId: 'user-1',
    now,
  }), (error) => error.code === 'pickup_not_ready');
  const ready = applyFulfillmentAction(pickup, { action: 'mark_ready', actorUserId: 'user-1', now });
  assert.equal(ready.physicalStatus, 'ready');
  const complete = applyFulfillmentAction({ ...pickup, ...ready }, {
    action: 'mark_picked_up', actorUserId: 'user-1', now,
  });
  assert.equal(complete.status, 'completed');
});

test('digital-only delivery completes directly and never needs a physical state', () => {
  const result = applyFulfillmentAction(item({
    deliveryMode: 'digital',
    physicalStatus: 'not_required',
  }), { action: 'mark_digital_delivered', actorUserId: 'user-1', now });
  assert.equal(result.status, 'completed');
  assert.equal(result.physicalStatus, 'not_required');
});

test('payment-pending items cannot be worked and shipment requires tracking', () => {
  assert.throws(() => applyFulfillmentAction(item({ status: 'payment_pending' }), {
    action: 'claim', actorUserId: 'user-1', now,
  }), (error) => error.code === 'fulfillment_payment_pending');
  assert.throws(() => applyFulfillmentAction(item(), {
    action: 'mark_shipped', actorUserId: 'user-1', carrier: 'UPS', now,
  }), (error) => error.code === 'fulfillment_input_required');
});

test('lane normalization fails closed to digital', () => {
  assert.equal(normalizeFulfillmentLane('shipment'), 'shipment');
  assert.equal(normalizeFulfillmentLane('private-address-export'), 'digital');
});
