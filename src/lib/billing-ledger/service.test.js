import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BillingLedgerError,
  allocateVerifiedPayment,
  createStudentCharge,
  recordProviderEvent,
} from './service.js';

function fakeClient(handler) {
  const calls = [];
  return {
    calls,
    async query(sql, parameters = []) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalized, parameters });
      return handler(normalized, parameters, calls);
    },
  };
}

const scope = { organizationId: 'org-1', businessUnitId: 'bu-usa' };

test('student charge creation fails closed when the contact belongs to another business unit', async () => {
  const client = fakeClient(async (sql) => {
    if (sql.startsWith('select id from contacts')) return { rows: [] };
    throw new Error(`unexpected query: ${sql}`);
  });
  await assert.rejects(
    () => createStudentCharge(client, {
      ...scope,
      studentContactId: 'contact-signs',
      chargeType: 'tuition_four_week',
      description: 'Four-week tuition',
      amount: '195.00',
      currency: 'USD',
      sourceType: 'registration',
      idempotencyKey: 'charge-1',
    }),
    (error) => error instanceof BillingLedgerError && error.code === 'scope_not_found' && error.status === 404,
  );
  assert.equal(client.calls.some((call) => call.sql.startsWith('insert into student_charges')), false);
});

test('duplicate provider event resolves the existing scoped row without a second insert effect', async () => {
  const existing = { id: 'event-1', idempotency_key: 'dejavoo:event-1' };
  const client = fakeClient(async (sql) => {
    if (sql.startsWith('select id from contacts')) return { rows: [{ id: 'student-1' }] };
    if (sql.startsWith('insert into payment_provider_events')) return { rows: [] };
    if (sql.startsWith('select * from payment_provider_events')) return { rows: [existing] };
    throw new Error(`unexpected query: ${sql}`);
  });
  const result = await recordProviderEvent(client, {
    ...scope,
    studentContactId: 'student-1',
    paymentRequestId: 'request-1',
    provider: 'dejavoo',
    providerEnvironment: 'test',
    providerEventId: 'provider-event-1',
    eventType: 'payment.status',
    payloadSha256: 'a'.repeat(64),
    idempotencyKey: 'dejavoo:event-1',
  });
  assert.deepEqual(result, { record: existing, duplicate: true });
  assert.equal(client.calls.filter((call) => call.sql.startsWith('insert into payment_provider_events')).length, 1);
});

test('duplicate allocation returns before balance mutation', async () => {
  const existing = { id: 'allocation-1', amount: '50.00' };
  const client = fakeClient(async (sql) => {
    if (['begin', 'commit'].includes(sql)) return { rows: [] };
    if (sql.startsWith('select pg_advisory_xact_lock')) return { rows: [{}] };
    if (sql.startsWith('select * from payment_allocations')) return { rows: [existing] };
    throw new Error(`unexpected query: ${sql}`);
  });
  const result = await allocateVerifiedPayment(client, {
    ...scope,
    chargeId: 'charge-1',
    transactionId: 'transaction-1',
    amount: '50.00',
    idempotencyKey: 'allocation-1',
  });
  assert.deepEqual(result, { allocation: existing, duplicate: true });
  assert.equal(client.calls.some((call) => call.sql.startsWith('update student_charges')), false);
  assert.equal(client.calls.at(-1).sql, 'commit');
});

test('allocation locks scoped records, preserves due date, and updates only lifecycle status', async () => {
  const client = fakeClient(async (sql) => {
    if (['begin', 'commit'].includes(sql)) return { rows: [] };
    if (sql.startsWith('select pg_advisory_xact_lock')) return { rows: [{}] };
    if (sql.startsWith('select * from payment_allocations')) return { rows: [] };
    if (sql.startsWith('select * from student_charges')) return { rows: [{
      id: 'charge-1', amount: '195.00', currency: 'USD', status: 'due', original_due_date: '2026-10-10', originalDueDate: '2026-10-10',
    }] };
    if (sql.startsWith('select * from provider_transactions')) return { rows: [{
      id: 'transaction-1', amount: '195.00', currency: 'USD', status: 'verified', transactionKind: 'payment', transaction_kind: 'payment',
    }] };
    if (sql.includes('join provider_transactions')) return { rows: [{ allocated: '0.00' }] };
    if (sql.startsWith('select coalesce(sum(amount)')) return { rows: [{ allocated: '0.00' }] };
    if (sql.startsWith('insert into payment_allocations')) return { rows: [{ id: 'allocation-1', amount: '50.00' }] };
    if (sql.startsWith('update student_charges')) return { rows: [] };
    throw new Error(`unexpected query: ${sql}`);
  });
  const result = await allocateVerifiedPayment(client, {
    ...scope,
    chargeId: 'charge-1',
    transactionId: 'transaction-1',
    amount: '50.00',
    idempotencyKey: 'allocation-1',
    asOf: new Date('2026-09-17T00:00:00Z'),
  });
  assert.equal(result.duplicate, false);
  assert.equal(result.charge.status, 'partially_paid');
  const update = client.calls.find((call) => call.sql.startsWith('update student_charges'));
  assert.equal(update.sql.includes('original_due_date'), false);
  assert.deepEqual(update.parameters, ['partially_paid', 'charge-1', 'org-1', 'bu-usa']);
});
