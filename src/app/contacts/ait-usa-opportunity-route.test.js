import assert from 'node:assert/strict';
import test from 'node:test';
import { POST } from '../api/contacts/[id]/opportunities/route.js';

const ids = Object.freeze({
  organization: '10000000-0000-4000-8000-000000000001',
  businessUnit: '10000000-0000-4000-8000-000000000002',
  contact: '10000000-0000-4000-8000-000000000003',
  user: '10000000-0000-4000-8000-000000000004',
  otherUser: '10000000-0000-4000-8000-000000000005',
  opportunity: '10000000-0000-4000-8000-000000000006',
});

const session = Object.freeze({
  user: Object.freeze({
    id: ids.user,
    organizationId: ids.organization,
    primaryRoleKey: 'account_coordinator',
    canAccessAllBusinessUnits: false,
    businessUnitIds: [ids.businessUnit],
    businessUnitMemberships: [{ id: ids.businessUnit, name: 'AIT USA Institute' }],
  }),
});

function request(body) {
  return new Request(`http://localhost/api/contacts/${ids.contact}/opportunities`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function dbRows(...rows) {
  let index = 0;
  return {
    select() {
      const result = rows[index++] || [];
      return {
        from() { return this; },
        where() { return this; },
        limit() { return Promise.resolve(result); },
      };
    },
  };
}

const contact = Object.freeze({
  id: ids.contact,
  organizationId: ids.organization,
  primaryBusinessUnitId: ids.businessUnit,
  name: 'Ana Student',
  email: 'ana@example.com',
});
const businessUnit = Object.freeze({ id: ids.businessUnit, name: 'AIT USA Institute', label: 'Division' });

test('Start opportunity validates explicit status before database access', async () => {
  const response = await POST(
    request({ businessUnitId: ids.businessUnit }),
    { params: Promise.resolve({ id: ids.contact }) },
    {
      requirePermissionForRequest: async () => ({ error: null, session }),
      getDbForRequest() { throw new Error('Database must not be loaded.'); },
    },
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /initial Opportunity status/);
});

test('regular Coordinator start is self-assigned and returns an allowlisted Contact/Opportunity shape', async () => {
  let serviceInput = null;
  const response = await POST(
    request({
      businessUnitId: ids.businessUnit,
      status: 'New Lead',
      assignedTo: ids.otherUser,
    }),
    { params: Promise.resolve({ id: ids.contact }) },
    {
      requirePermissionForRequest: async () => ({ error: null, session }),
      getDbForRequest: () => dbRows([contact], [businessUnit], [{ id: ids.user }]),
      startOpportunityForRequest: async (input) => {
        serviceInput = input;
        return {
          status: 'created',
          opportunity: {
            id: ids.opportunity,
            status: 'New Lead',
            currentStage: 'New Lead',
            assignedUserId: ids.user,
            sourceName: 'Manual',
          },
        };
      },
    },
  );
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(serviceInput.assignedUserId, ids.user);
  assert.equal(payload.contact.businessUnitName, 'AIT USA Institute');
  assert.equal(payload.contact.opportunityId, ids.opportunity);
  const serialized = JSON.stringify(payload);
  for (const forbidden of ['candidateIds', 'matchingContactIds', 'importReview', 'auditMetadata', 'secret']) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, 'i'));
  }
  assert.equal(serialized.includes(ids.otherUser), false);
});

test('starting in an AIT USA terminal alias requires an employee reason', async () => {
  const response = await POST(
    request({ businessUnitId: ids.businessUnit, status: 'closed lost' }),
    { params: Promise.resolve({ id: ids.contact }) },
    {
      requirePermissionForRequest: async () => ({ error: null, session }),
      getDbForRequest: () => dbRows([contact], [businessUnit]),
    },
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /reason is required/);
});
