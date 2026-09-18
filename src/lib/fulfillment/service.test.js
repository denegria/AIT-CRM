import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activateBookFulfillmentForVerifiedPayment,
  loadBookFulfillmentQueue,
  transitionBookFulfillment,
} from './service.js';

const address = Object.freeze({
  recipientName: 'Ana Student',
  addressLine1: '100 Main Street',
  addressLine2: '',
  city: 'Miami',
  state: 'FL',
  postalCode: '33101',
  countryCode: 'US',
});

function fulfillment(overrides = {}) {
  return {
    id: 'fulfillment-1',
    organization_id: 'org-1',
    business_unit_id: 'bu-usa',
    student_contact_id: 'student-1',
    enrollment_id: 'enrollment-1',
    payment_request_id: 'request-1',
    provider_transaction_id: null,
    delivery_mode: 'shipment',
    status: 'pending',
    digital_status: 'pending',
    physical_status: 'pending',
    shipping_address_snapshot_json: address,
    assigned_user_id: null,
    carrier: null,
    tracking_reference: null,
    notes: null,
    ready_at: null,
    digital_sent_at: null,
    shipped_at: null,
    picked_up_at: null,
    created_at: new Date('2026-09-18T02:00:00.000Z'),
    updated_at: new Date('2026-09-18T02:00:00.000Z'),
    ...overrides,
  };
}

test('queue returns address snapshots only for the authorized shipment lane', async () => {
  const client = {
    async query(sql, parameters) {
      const statement = String(sql);
      if (statement.includes('count(*) filter')) return { rows: [{ digital: 1, pickup: 0, shipment: 1 }] };
      const row = fulfillment({
        student_name: 'Ana Student',
        assigned_user_name: null,
        payment_verified_at: new Date('2026-09-18T01:00:00.000Z'),
        visible_shipping_address: parameters[2] === 'shipment' ? address : {},
        total: 1,
      });
      return { rows: [row] };
    },
  };
  const digital = await loadBookFulfillmentQueue(client, {
    organizationId: 'org-1', businessUnitIds: ['bu-usa'], lane: 'digital',
  });
  const shipment = await loadBookFulfillmentQueue(client, {
    organizationId: 'org-1', businessUnitIds: ['bu-usa'], lane: 'shipment',
  });
  assert.deepEqual(digital.items[0].shippingAddressSnapshot, {});
  assert.equal(shipment.items[0].shippingAddressSnapshot.postalCode, '33101');
  assert.deepEqual(shipment.counts, { digital: 1, pickup: 0, shipment: 1 });
});

test('verified payment activation is idempotent and links one existing obligation', async () => {
  const row = fulfillment({ status: 'payment_pending' });
  const client = {
    async query(sql, parameters) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      if (statement.startsWith('update book_fulfillments')) {
        row.provider_transaction_id ||= parameters[0];
        if (row.status === 'payment_pending') row.status = 'pending';
        return { rows: [row] };
      }
      throw new Error(`Unexpected query: ${statement}`);
    },
  };
  const first = await activateBookFulfillmentForVerifiedPayment(client, {
    organizationId: 'org-1', businessUnitId: 'bu-usa', paymentRequestId: 'request-1', providerTransactionId: 'transaction-1',
  });
  const replay = await activateBookFulfillmentForVerifiedPayment(client, {
    organizationId: 'org-1', businessUnitId: 'bu-usa', paymentRequestId: 'request-1', providerTransactionId: 'transaction-1',
  });
  assert.equal(first.id, replay.id);
  assert.equal(replay.status, 'pending');
  assert.equal(replay.providerTransactionId, 'transaction-1');
});

test('transition rejects stale writes before changing the fulfillment record', async () => {
  const row = fulfillment();
  const commands = [];
  const client = {
    async query(sql) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      commands.push(statement);
      if (['begin', 'rollback'].includes(statement)) return { rows: [] };
      if (statement.startsWith('select pg_advisory_xact_lock')) return { rows: [{}] };
      if (statement.startsWith('select * from book_fulfillments')) return { rows: [row] };
      throw new Error(`Unexpected query: ${statement}`);
    },
  };
  await assert.rejects(() => transitionBookFulfillment(client, {
    organizationId: 'org-1',
    businessUnitId: 'bu-usa',
    fulfillmentId: 'fulfillment-1',
    actorUserId: 'user-1',
    expectedUpdatedAt: '2026-09-18T02:01:00.000Z',
    action: 'claim',
  }), (error) => error.code === 'fulfillment_stale_write' && error.status === 409);
  assert.equal(commands.at(-1), 'rollback');
  assert.equal(commands.some((command) => command.startsWith('update book_fulfillments')), false);
});
