import assert from 'node:assert/strict';
import test from 'node:test';

import { allFulfillmentLanesClear, fulfillmentStage } from './presentation.js';

test('all-clear requires every fulfillment lane to be empty', () => {
  assert.equal(allFulfillmentLanesClear(), false);
  assert.equal(allFulfillmentLanesClear({ digital: 0, pickup: 0, shipment: 0 }), true);
  assert.equal(allFulfillmentLanesClear({ digital: 0, pickup: 0 }), false);
  assert.equal(allFulfillmentLanesClear({ digital: 0, pickup: 1, shipment: 0 }), false);
  assert.equal(allFulfillmentLanesClear({ digital: 0, pickup: 0, shipment: '2' }), false);
});

test('fulfillment stages use human workflow language and one canonical next action', () => {
  assert.deepEqual(fulfillmentStage({}, 'digital'), {
    label: 'Needs manual delivery',
    nextAction: 'Confirm access sent',
    action: 'mark_digital_delivered',
    completion: true,
  });
  assert.equal(fulfillmentStage({ physicalStatus: 'pending' }, 'pickup').label, 'Preparing for pickup');
  assert.equal(fulfillmentStage({ physicalStatus: 'pending' }, 'pickup').completion, false);
  assert.equal(fulfillmentStage({ physicalStatus: 'ready' }, 'pickup').nextAction, 'Mark picked up');
  assert.equal(fulfillmentStage({}, 'shipment').action, 'mark_shipped');
});
