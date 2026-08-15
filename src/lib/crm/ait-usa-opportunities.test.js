import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selectAitUsaOpportunityForBootstrap,
  resolveAitUsaActiveOpportunity,
  startAitUsaOpportunity,
  withLockedAitUsaClosedOpportunityReopen,
  withLockedAitUsaOpportunityMutation,
} from './ait-usa-opportunities.js';

const scope = Object.freeze({
  organization: { id: 'org-1' },
  businessUnit: { id: 'bu-usa', name: 'AIT USA Institute' },
  contact: { id: 'contact-1' },
});

function clientFor(rows) {
  const calls = [];
  return {
    calls,
    async query(text, values) {
      calls.push({ text: String(text).replace(/\s+/g, ' ').trim(), values });
      if (String(text).includes('from leads')) return { rows };
      return { rows: [] };
    },
  };
}

test('AIT USA Opportunity resolution ignores closed history and returns none', async () => {
  const client = clientFor([
    { id: 'closed-1', status: 'retargeting only' },
    { id: 'closed-2', status: 'Course Completed' },
  ]);
  const result = await resolveAitUsaActiveOpportunity({ client, ...scope });

  assert.deepEqual(result, { status: 'none', leadId: null, opportunity: null, activeCount: 0 });
  assert.match(client.calls[0].text, /pg_advisory_xact_lock/);
  assert.deepEqual(client.calls[1].values, ['org-1', 'bu-usa', 'contact-1']);
});

test('AIT USA Opportunity resolution returns the sole active record without changing its owner or source', async () => {
  const client = clientFor([
    { id: 'active-1', status: 'followup', assigned_user_id: 'user-1', source_name: 'Original source' },
    { id: 'closed-1', status: 'Dropped / Quit' },
  ]);
  const result = await resolveAitUsaActiveOpportunity({ client, ...scope });

  assert.equal(result.status, 'exact');
  assert.equal(result.leadId, 'active-1');
  assert.equal(result.opportunity.assignedUserId, 'user-1');
  assert.equal(result.opportunity.sourceName, 'Original source');
});

test('AIT USA Opportunity resolution fails closed when aliases classify multiple records as active', async () => {
  const client = clientFor([
    { id: 'active-1', status: 'New Lead' },
    { id: 'active-2', status: 'Enrolled' },
    { id: 'closed-1', status: 'closed lost' },
  ]);
  const result = await resolveAitUsaActiveOpportunity({ client, ...scope });

  assert.deepEqual(result, { status: 'ambiguous', leadId: null, opportunity: null, activeCount: 2 });
});

test('AIT Signs cannot enter the AIT USA Opportunity resolver', async () => {
  await assert.rejects(
    resolveAitUsaActiveOpportunity({
      client: clientFor([]),
      ...scope,
      businessUnit: { id: 'bu-signs', name: 'AIT Signs' },
    }),
    /requires an AIT USA business unit/,
  );
});

test('Start Opportunity locks, creates, and audits the initial status in one transaction', async () => {
  const calls = { transactions: 0, execute: 0, inserts: [] };
  const opportunity = {
    id: 'opportunity-1',
    businessUnitId: 'bu-usa',
    contactId: 'contact-1',
    status: 'Not Interested',
    currentStage: 'Not Interested',
    assignedUserId: 'user-1',
  };
  const tx = {
    async execute() { calls.execute += 1; },
    select() {
      return {
        from() { return this; },
        where() { return Promise.resolve([]); },
      };
    },
    insert() {
      const entry = {};
      calls.inserts.push(entry);
      return {
        values(values) {
          entry.values = values;
          return {
            returning: async () => [opportunity],
            then(resolve) { resolve(); },
          };
        },
      };
    },
  };
  const db = {
    async transaction(handler) {
      calls.transactions += 1;
      return handler(tx);
    },
  };

  const result = await startAitUsaOpportunity({
    db,
    organizationId: 'org-1',
    businessUnit: scope.businessUnit,
    contact: scope.contact,
    actorUserId: 'actor-1',
    assignedUserId: 'user-1',
    status: 'Not Interested',
    reason: 'Student chose another program.',
  });

  assert.equal(result.status, 'created');
  assert.equal(calls.transactions, 1);
  assert.equal(calls.execute, 1);
  assert.equal(calls.inserts.length, 2);
  assert.equal(calls.inserts[1].values.leadId, 'opportunity-1');
  assert.equal(calls.inserts[1].values.reason, 'Student chose another program.');
});

test('bootstrap selects an older sole active AIT USA Opportunity over newer closed history', () => {
  const result = selectAitUsaOpportunityForBootstrap([
    { id: 'closed-newer', status: 'Not Interested', createdAt: '2026-08-15T12:00:00Z' },
    { id: 'active-older', status: 'Follow Up', createdAt: '2026-08-14T12:00:00Z' },
  ], scope.businessUnit);
  assert.equal(result.opportunity.id, 'active-older');
  assert.equal(result.conflict, false);
  assert.equal(result.activeCount, 1);
});

test('bootstrap selects newest closed AIT USA history when no active Opportunity exists', () => {
  const result = selectAitUsaOpportunityForBootstrap([
    { id: 'closed-older', status: 'Course Completed', createdAt: '2026-08-14T12:00:00Z' },
    { id: 'closed-newer', status: 'Not Interested', createdAt: '2026-08-15T12:00:00Z' },
  ], scope.businessUnit);
  assert.equal(result.opportunity.id, 'closed-newer');
  assert.equal(result.conflict, false);
  assert.equal(result.activeCount, 0);
});

test('bootstrap exposes an explicit conflict when multiple AIT USA Opportunities are active', () => {
  const result = selectAitUsaOpportunityForBootstrap([
    { id: 'active-1', status: 'New Lead', createdAt: '2026-08-14T12:00:00Z' },
    { id: 'active-2', status: 'Follow Up', createdAt: '2026-08-15T12:00:00Z' },
  ], scope.businessUnit);
  assert.equal(result.opportunity.id, 'active-2');
  assert.equal(result.conflict, true);
  assert.equal(result.activeCount, 2);
});

test('closed-to-active update locks and re-resolves before invoking the transactional writer', async () => {
  const calls = [];
  const tx = {
    async query(text) {
      const normalized = String(text).replace(/\s+/g, ' ').trim();
      calls.push(normalized);
      if (normalized.includes('where organization_id = $1 and business_unit_id = $2 and contact_id = $3')) {
        return { rows: [{ id: 'closed-1', status: 'Not Interested' }] };
      }
      if (normalized.includes('where id = $1 and organization_id = $2')) {
        return { rows: [{ id: 'closed-1', status: 'Not Interested' }] };
      }
      return { rows: [] };
    },
  };
  const db = { transaction: (handler) => handler(tx) };
  let writeTx = null;
  const result = await withLockedAitUsaClosedOpportunityReopen({
    db,
    organizationId: 'org-1',
    businessUnit: scope.businessUnit,
    contact: scope.contact,
    opportunityId: 'closed-1',
    toStatus: 'Follow Up',
    reopenReason: 'correction',
    write: ({ tx: transactionClient, opportunity, transition }) => {
      writeTx = transactionClient;
      return { opportunity, transition };
    },
  });
  assert.equal(writeTx, tx);
  assert.equal(result.opportunity.id, 'closed-1');
  assert.equal(result.transition.toStatus, 'Follow Up');
  assert.match(calls[0], /pg_advisory_xact_lock/);
});

test('closed-to-active update returns 409 and performs no writer side effects when an active Opportunity won the race', async () => {
  const tx = {
    async query(text) {
      const normalized = String(text).replace(/\s+/g, ' ').trim();
      if (normalized.includes('from leads') && normalized.includes('order by created_at')) {
        return { rows: [{ id: 'active-winner', status: 'Follow Up' }] };
      }
      return { rows: [] };
    },
  };
  let wrote = false;
  await assert.rejects(
    withLockedAitUsaClosedOpportunityReopen({
      db: { transaction: (handler) => handler(tx) },
      organizationId: 'org-1',
      businessUnit: scope.businessUnit,
      contact: scope.contact,
      opportunityId: 'closed-1',
      toStatus: 'Follow Up',
      reopenReason: 'correction',
      write: () => { wrote = true; },
    }),
    (error) => error.status === 409 && /active Opportunity changed/.test(error.message),
  );
  assert.equal(wrote, false);
});

test('unchanged-status stale PATCH cannot reactivate expected A after replacement B became active', async () => {
  const tx = {
    async query(text) {
      const normalized = String(text).replace(/\s+/g, ' ').trim();
      if (normalized.includes('from leads') && normalized.includes('order by created_at')) {
        return { rows: [{ id: 'active-b', status: 'New Lead' }] };
      }
      return { rows: [] };
    },
  };
  let wrote = false;
  await assert.rejects(
    withLockedAitUsaOpportunityMutation({
      db: { transaction: (handler) => handler(tx) },
      organizationId: 'org-1',
      businessUnit: scope.businessUnit,
      contact: scope.contact,
      expectedOpportunityId: 'active-a',
      toStatus: 'Follow Up',
      write: () => { wrote = true; },
    }),
    (error) => error.status === 409 && /active Opportunity changed/.test(error.message),
  );
  assert.equal(wrote, false);
});

test('locked mutation reevaluates an expected row that became closed and requires a reopen reason', async () => {
  const tx = {
    async query(text) {
      const normalized = String(text).replace(/\s+/g, ' ').trim();
      if (normalized.includes('order by created_at')) {
        return { rows: [{ id: 'active-a', status: 'Not Interested' }] };
      }
      if (normalized.includes('where id = $1 and organization_id = $2')) {
        return { rows: [{ id: 'active-a', status: 'Not Interested' }] };
      }
      return { rows: [] };
    },
  };
  let wrote = false;
  await assert.rejects(
    withLockedAitUsaOpportunityMutation({
      db: { transaction: (handler) => handler(tx) },
      organizationId: 'org-1',
      businessUnit: scope.businessUnit,
      contact: scope.contact,
      expectedOpportunityId: 'active-a',
      toStatus: 'Follow Up',
      write: () => { wrote = true; },
    }),
    (error) => error.status === 403 && /requires a correction or new-course/.test(error.message),
  );
  assert.equal(wrote, false);
});

test('non-status AIT USA Opportunity mutation also uses the shared lock and expected-row binding', async () => {
  const calls = [];
  const tx = {
    async query(text) {
      const normalized = String(text).replace(/\s+/g, ' ').trim();
      calls.push(normalized);
      if (normalized.includes('order by created_at')) {
        return { rows: [{ id: 'active-a', status: 'Follow Up' }] };
      }
      if (normalized.includes('where id = $1 and organization_id = $2')) {
        return { rows: [{ id: 'active-a', status: 'Follow Up' }] };
      }
      return { rows: [] };
    },
  };
  let writeTx;
  await withLockedAitUsaOpportunityMutation({
    db: { transaction: (handler) => handler(tx) },
    organizationId: 'org-1',
    businessUnit: scope.businessUnit,
    contact: scope.contact,
    expectedOpportunityId: 'active-a',
    write: ({ tx: currentTx, transition }) => {
      writeTx = currentTx;
      assert.equal(transition, null);
    },
  });
  assert.equal(writeTx, tx);
  assert.match(calls[0], /pg_advisory_xact_lock/);
});
