import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPortalPaymentRequest,
  loadPortalPaymentStatus,
  loadPortalPaymentsSnapshot,
  verifyPortalPaymentsSecret,
} from './service.js';

const scope = {
  organizationId: '33000000-0000-4000-8000-000000000003',
  businessUnitId: '44000000-0000-4000-8000-000000000004',
};
const identity = {
  accountId: '11000000-0000-4000-8000-000000000001',
  email: 'student@example.com',
};
const contact = {
  id: '55000000-0000-4000-8000-000000000005',
  name: 'Portal Student',
  email: 'student@example.com',
};

function clientWith(handler) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalized, params });
      return handler(normalized, params, calls);
    },
  };
}

test('shared secret comparison fails closed', () => {
  assert.equal(verifyPortalPaymentsSecret('secret-value', 'secret-value'), true);
  assert.equal(verifyPortalPaymentsSecret('', ''), false);
  assert.equal(verifyPortalPaymentsSecret('wrong', 'secret-value'), false);
});

test('snapshot is self-scoped and exposes authoritative balance, credit, receipt, and verifying state', async () => {
  const client = clientWith((sql) => {
    if (sql.includes('from contacts')) return { rows: [contact] };
    if (sql.includes('with charge_ledger')) return { rows: [{
      id: '22000000-0000-4000-8000-000000000002', charge_type: 'tuition_four_week',
      description: 'Four-week tuition', amount: '95.00', applied_amount: '10.00', remaining_amount: '85.00',
      currency: 'USD', derived_status: 'partially_paid', original_due_date: '2026-09-01',
      service_period_start: '2026-09-01', service_period_end: '2026-09-28',
    }] };
    if (sql.includes('as unapplied')) return { rows: [{ unapplied: '145.00' }] };
    if (sql.includes('join financial_documents')) return { rows: [{
      id: 'receipt-1', document_number: 'REC-1', issue_date: '2026-09-18', total: '10.00', currency: 'USD',
    }] };
    if (sql.includes("source_type = 'portal_payment'")) return { rows: [{
      id: 'request-1', charge_id: '22000000-0000-4000-8000-000000000002', requested_amount: '25.00',
      currency: 'USD', request_status: 'pending', transaction_status: null,
    }] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const result = await loadPortalPaymentsSnapshot(client, scope, identity);
  assert.equal(result.charges[0].remainingAmount, '85.00');
  assert.equal(result.charges[0].upcomingPeriodStart, '2026-09-29');
  assert.equal(result.unappliedCredit.amount, '145.00');
  assert.equal(result.receipts[0].number, 'REC-1');
  assert.equal(result.paymentRequests[0].state, 'verifying');
  assert.deepEqual(client.calls[0].params, [scope.organizationId, scope.businessUnitId, identity.email]);
});

test('ambiguous CRM email fails closed', async () => {
  const client = clientWith(() => ({ rows: [contact, { ...contact, id: '66000000-0000-4000-8000-000000000006' }] }));
  await assert.rejects(() => loadPortalPaymentsSnapshot(client, scope, identity), (error) => {
    assert.equal(error.code, 'portal_identity_review_required');
    return true;
  });
});

test('payment amount cannot exceed the locked authoritative remainder', async () => {
  const client = clientWith((sql) => {
    if (sql.includes('from contacts')) return { rows: [contact] };
    if (sql === 'begin' || sql === 'rollback' || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.startsWith('select * from student_charges')) return { rows: [{
      id: '22000000-0000-4000-8000-000000000002', amount: '95.00', currency: 'USD',
    }] };
    if (sql.includes('from payment_allocations pa')) return { rows: [{ applied_amount: '10.00' }] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  await assert.rejects(() => createPortalPaymentRequest(client, scope, identity, {
    chargeId: '22000000-0000-4000-8000-000000000002', amount: '85.01', idempotencyKey: 'portal-payment:too-much',
  }), (error) => {
    assert.equal(error.code, 'amount_exceeds_balance');
    assert.equal(error.details.remainingAmount, '85.00');
    return true;
  });
  assert.equal(client.calls.at(-1).sql, 'rollback');
});

test('creates one fixed self-owned request after locking and rechecking the balance', async () => {
  const requestRow = {
    id: '77000000-0000-4000-8000-000000000007',
    requested_amount: '25.00',
    currency: 'USD',
  };
  const client = clientWith((sql, params) => {
    if (sql.includes('from contacts') && sql.includes('lower(email)')) return { rows: [contact] };
    if (sql === 'begin' || sql === 'commit' || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.startsWith('select * from student_charges')) return { rows: [{
      id: '22000000-0000-4000-8000-000000000002', amount: '95.00', currency: 'USD',
      enrollment_id: null, class_section_id: null,
    }] };
    if (sql.includes('from payment_allocations pa')) return { rows: [{ applied_amount: '10.00' }] };
    if (sql.startsWith('select id from contacts')) return { rows: [{ id: params[0] }] };
    if (sql.startsWith('insert into payment_requests')) return { rows: [requestRow] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const result = await createPortalPaymentRequest(client, scope, identity, {
    chargeId: '22000000-0000-4000-8000-000000000002', amount: '25.00', idempotencyKey: 'portal-payment:fixture-success',
  });
  assert.equal(result.amount, '25.00');
  assert.equal(result.duplicate, false);
  const insert = client.calls.find((call) => call.sql.startsWith('insert into payment_requests'));
  assert.equal(insert.params[2], contact.id);
  assert.equal(insert.params[3], contact.id);
  assert.equal(insert.params[7], '25.00');
  assert.equal(insert.params[15], 'portal_payment');
  assert.equal(client.calls.at(-1).sql, 'commit');
});

test('status rejects another student request by returning not found', async () => {
  const client = clientWith((sql) => {
    if (sql.includes('from contacts')) return { rows: [contact] };
    if (sql.includes('from payment_requests')) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  await assert.rejects(
    () => loadPortalPaymentStatus(client, scope, identity, 'other-request'),
    (error) => error.code === 'payment_request_not_found',
  );
});
