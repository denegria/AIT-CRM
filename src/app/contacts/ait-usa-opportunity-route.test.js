import assert from 'node:assert/strict';
import test from 'node:test';
import { POST } from '../api/contacts/[id]/opportunities/route.js';
import { PATCH } from '../api/contacts/route.js';
import {
  buildContactProfilePatch,
  hasOpportunityMutationRequest,
} from '../../lib/crm/contact-profile-patch.js';

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
const policyAllowedRegularSession = Object.freeze({
  user: Object.freeze({ ...session.user, canAccessAllBusinessUnits: true }),
});
const elevatedSession = Object.freeze({
  user: Object.freeze({
    ...session.user,
    primaryRoleKey: 'senior_coordinator',
    roleKeys: ['senior_coordinator'],
  }),
});

function request(body) {
  return new Request(`http://localhost/api/contacts/${ids.contact}/opportunities`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patchRequest(body) {
  return new Request('http://localhost/api/contacts', {
    method: 'PATCH',
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
        innerJoin() { return this; },
        where() { return this; },
        limit() { return Promise.resolve(result); },
        then(resolve) { resolve(result); },
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

function fullBootstrapContactPayload(overrides = {}) {
  return {
    id: ids.contact,
    name: 'Ana Updated',
    email: 'ana@example.com',
    phone: '555-0100',
    address: 'Plainfield',
    status: 'Follow Up',
    currentStage: 'Follow Up',
    opportunityId: ids.opportunity,
    assignedTo: ids.otherUser,
    source: 'Website',
    businessUnitId: ids.businessUnit,
    primaryBusinessUnitId: ids.businessUnit,
    programInterest: 'HVAC',
    preferredDay: 'Monday',
    preferredSchedule: 'Evening',
    testInterest: 'EPA',
    educationLevel: 'High school',
    schoolName: 'AIT USA',
    locationPreference: 'Plainfield',
    profileDetails: 'Full bootstrap payload field',
    sourceDetail: 'Website form',
    currentCourse: 'HVAC',
    completedCourse: 'Electrical',
    endedCourse: 'Plumbing',
    courseOutcome: 'Completed',
    leadProfile: { programInterest: 'HVAC' },
    courseMetadata: { currentCourse: 'HVAC' },
    ...overrides,
  };
}

test('conflicted AIT USA unrelated-name PATCH body is not classified as an Opportunity mutation', () => {
  const body = buildContactProfilePatch({
    editForm: fullBootstrapContactPayload(),
    contact: { hasLeadStatus: true, opportunityConflict: true },
    isAitUsa: true,
    lockedOwnerUserId: ids.user,
  });
  assert.equal(body.name, 'Ana Updated');
  assert.equal(body.opportunityId, ids.opportunity);
  assert.equal(hasOpportunityMutationRequest(body), false);
});

test('regular Coordinator AIT USA profile saves omit assignment fields', () => {
  const body = buildContactProfilePatch({
    editForm: fullBootstrapContactPayload({ assignedTo: ids.user }),
    contact: { hasLeadStatus: true, opportunityConflict: false, assignedTo: ids.user },
    isAitUsa: true,
    lockedOwnerUserId: ids.user,
    canManageAssignments: false,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'assignedTo'), false);
});

test('direct PATCH allows conflict-safe Contact-only edits with no Lead update', async () => {
  const selectedActive = {
    id: ids.opportunity,
    organizationId: ids.organization,
    businessUnitId: ids.businessUnit,
    contactId: ids.contact,
    status: 'Follow Up',
    currentStage: 'Follow Up',
    assignedUserId: ids.otherUser,
  };
  let writeInput = null;
  const contactOnlyBody = buildContactProfilePatch({
    editForm: fullBootstrapContactPayload(),
    contact: { hasLeadStatus: true, opportunityConflict: true },
    isAitUsa: true,
    lockedOwnerUserId: ids.user,
  });
  assert.equal(hasOpportunityMutationRequest(contactOnlyBody), false);
  const response = await PATCH(
    patchRequest(contactOnlyBody),
    {},
    {
      requirePermissionForRequest: async () => ({ error: null, session: elevatedSession }),
      getDbForRequest: () => dbRows([contact]),
      latestLeadForContactForRequest: async () => ({ ...selectedActive, id: '10000000-0000-4000-8000-000000000099' }),
      loadBusinessUnitForRequest: async () => businessUnit,
      resolveActiveOpportunityForRequest: async () => ({ status: 'ambiguous', leadId: null, opportunity: null, activeCount: 3 }),
      loadScopedOpportunityForRequest: async () => selectedActive,
      updateContactForRequest: async (input) => {
        writeInput = input;
        return {
          contact: { ...contact, name: input.contactPatch.name },
          lead: input.existingLead,
          noteRows: [],
          activityEventRows: [],
        };
      },
    },
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.contact.name, 'Ana Updated');
  assert.equal(payload.contact.opportunityConflict, true);
  assert.equal(payload.contact.activeOpportunityCount, 3);
  assert.equal(writeInput.leadPatch, null);
  assert.equal(writeInput.leadStatusChange, null);
});

test('direct closed-to-active PATCH maps a concurrent active-Opportunity conflict to 409 with zero writer calls', async () => {
  const closedOpportunity = {
    id: ids.opportunity,
    organizationId: ids.organization,
    businessUnitId: ids.businessUnit,
    contactId: ids.contact,
    status: 'Not Interested',
    currentStage: 'Not Interested',
    assignedUserId: ids.otherUser,
  };
  let normalWrites = 0;
  let transactionWrites = 0;
  const response = await PATCH(
    patchRequest({
      id: ids.contact,
      opportunityId: ids.opportunity,
      status: 'Follow Up',
      statusChangeReason: 'correction',
    }),
    {},
    {
      requirePermissionForRequest: async () => ({ error: null, session: elevatedSession }),
      getDbForRequest: () => dbRows([contact]),
      latestLeadForContactForRequest: async () => closedOpportunity,
      loadBusinessUnitForRequest: async () => businessUnit,
      resolveActiveOpportunityForRequest: async () => ({ status: 'none', leadId: null, opportunity: null }),
      loadScopedOpportunityForRequest: async () => closedOpportunity,
      updateContactForRequest: async () => { normalWrites += 1; },
      updateContactInTransactionForRequest: async () => { transactionWrites += 1; },
      withLockedMutationForRequest: async () => {
        throw Object.assign(new Error('This Contact already has an active Opportunity.'), { status: 409 });
      },
    },
  );
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /already has an active Opportunity/);
  assert.equal(normalWrites, 0);
  assert.equal(transactionWrites, 0);
});

test('direct unchanged-status full UI PATCH enters the locked expected-opportunity path and rejects stale A', async () => {
  const activeA = {
    id: ids.opportunity,
    organizationId: ids.organization,
    businessUnitId: ids.businessUnit,
    contactId: ids.contact,
    status: 'Follow Up',
    currentStage: 'Follow Up',
    assignedUserId: ids.otherUser,
  };
  let normalWrites = 0;
  let transactionWrites = 0;
  let lockInput = null;
  const response = await PATCH(
    patchRequest(fullBootstrapContactPayload()),
    {},
    {
      requirePermissionForRequest: async () => ({ error: null, session: elevatedSession }),
      getDbForRequest: () => dbRows(
        [contact],
        [{ id: ids.businessUnit }],
        [{ id: ids.otherUser }],
        [{ key: 'account_coordinator' }],
        [{ businessUnitId: ids.businessUnit }],
      ),
      latestLeadForContactForRequest: async () => activeA,
      loadBusinessUnitForRequest: async () => businessUnit,
      resolveActiveOpportunityForRequest: async () => ({ status: 'exact', leadId: ids.opportunity, opportunity: activeA, activeCount: 1 }),
      loadScopedOpportunityForRequest: async () => activeA,
      updateContactForRequest: async () => { normalWrites += 1; },
      updateContactInTransactionForRequest: async () => { transactionWrites += 1; },
      withLockedMutationForRequest: async (input) => {
        lockInput = input;
        throw Object.assign(new Error('The active Opportunity changed while this Contact was open.'), { status: 409 });
      },
    },
  );
  assert.equal(response.status, 409);
  assert.equal(lockInput.expectedOpportunityId, ids.opportunity);
  assert.equal(lockInput.toStatus, 'Follow Up');
  assert.equal(normalWrites, 0);
  assert.equal(transactionWrites, 0);
});

test('direct AIT USA PATCH reports post-write active Opportunity counts', async () => {
  for (const scenario of [
    { from: 'Follow Up', to: 'Not Interested', pre: 'exact', expected: 0 },
    { from: 'Not Interested', to: 'Follow Up', pre: 'none', expected: 1 },
    { from: 'Follow Up', to: 'Follow Up', pre: 'exact', expected: 1 },
  ]) {
    const selected = {
      id: ids.opportunity,
      organizationId: ids.organization,
      businessUnitId: ids.businessUnit,
      contactId: ids.contact,
      status: scenario.from,
      currentStage: scenario.from,
      assignedUserId: ids.otherUser,
    };
    const response = await PATCH(
      patchRequest({
        id: ids.contact,
        opportunityId: ids.opportunity,
        status: scenario.to,
        statusChangeReason: scenario.from === 'Not Interested' ? 'correction' : undefined,
        terminalStatusReason: scenario.to === 'Not Interested' ? 'Student declined.' : undefined,
      }),
      {},
      {
        requirePermissionForRequest: async () => ({ error: null, session: elevatedSession }),
        getDbForRequest: () => dbRows([contact]),
        latestLeadForContactForRequest: async () => selected,
        loadBusinessUnitForRequest: async () => businessUnit,
        resolveActiveOpportunityForRequest: async () => ({
          status: scenario.pre,
          leadId: scenario.pre === 'exact' ? ids.opportunity : null,
          opportunity: scenario.pre === 'exact' ? selected : null,
          activeCount: scenario.pre === 'exact' ? 1 : 0,
        }),
        loadScopedOpportunityForRequest: async () => selected,
        withLockedMutationForRequest: async (input) => {
          await input.authorize({ opportunity: selected });
          return input.write({
            tx: {},
            opportunity: selected,
            transition: {
              allowed: true,
              changed: scenario.from !== scenario.to,
              fromStatus: scenario.from,
              toStatus: scenario.to,
            },
          });
        },
        updateContactInTransactionForRequest: async (input) => ({
          contact,
          lead: { ...input.existingLead, ...input.leadPatch },
          noteRows: [],
          activityEventRows: [],
        }),
      },
    );
    assert.equal(response.status, 200, `${scenario.from} -> ${scenario.to}`);
    assert.equal((await response.json()).contact.activeOpportunityCount, scenario.expected);
  }
});

test('direct AIT USA PATCH rechecks regular Coordinator ownership under the lock', async () => {
  const initiallyOwned = {
    id: ids.opportunity,
    organizationId: ids.organization,
    businessUnitId: ids.businessUnit,
    contactId: ids.contact,
    status: 'Follow Up',
    currentStage: 'Follow Up',
    assignedUserId: ids.user,
  };
  let writes = 0;
  const response = await PATCH(
    patchRequest({ id: ids.contact, opportunityId: ids.opportunity, status: 'Follow Up' }),
    {},
    {
      requirePermissionForRequest: async () => ({ error: null, session }),
      getDbForRequest: () => dbRows([contact]),
      latestLeadForContactForRequest: async () => initiallyOwned,
      loadBusinessUnitForRequest: async () => businessUnit,
      resolveActiveOpportunityForRequest: async () => ({
        status: 'exact', leadId: ids.opportunity, opportunity: initiallyOwned, activeCount: 1,
      }),
      loadScopedOpportunityForRequest: async () => initiallyOwned,
      withLockedMutationForRequest: async (input) => {
        await input.authorize({ opportunity: { ...initiallyOwned, assignedUserId: ids.otherUser } });
        return input.write({ tx: {}, opportunity: initiallyOwned, transition: null });
      },
      updateContactInTransactionForRequest: async () => { writes += 1; },
    },
  );
  assert.equal(response.status, 403);
  assert.equal(writes, 0);
});

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

test('regular Coordinator cannot explicitly claim a new AIT USA Opportunity', async () => {
  let started = false;
  const response = await POST(
    request({
      businessUnitId: ids.businessUnit,
      status: 'New Lead',
      assignedTo: ids.otherUser,
    }),
    { params: Promise.resolve({ id: ids.contact }) },
    {
      requirePermissionForRequest: async () => ({ error: null, session: policyAllowedRegularSession }),
      getDbForRequest: () => dbRows([contact], [businessUnit]),
      startOpportunityForRequest: async () => { started = true; },
    },
  );
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.match(payload.error, /Only Senior Coordinators or administrators/);
  assert.equal(started, false);
});

test('regular Coordinator can record a new AIT USA Opportunity only as unassigned', async () => {
  let serviceInput = null;
  const response = await POST(
    request({ businessUnitId: ids.businessUnit, status: 'New Lead', assignedTo: '' }),
    { params: Promise.resolve({ id: ids.contact }) },
    {
      requirePermissionForRequest: async () => ({ error: null, session: policyAllowedRegularSession }),
      getDbForRequest: () => dbRows([contact], [businessUnit]),
      startOpportunityForRequest: async (input) => {
        serviceInput = input;
        return {
          status: 'created',
          opportunity: {
            id: ids.opportunity,
            status: 'New Lead',
            currentStage: 'New Lead',
            assignedUserId: null,
            sourceName: 'Manual',
          },
        };
      },
    },
  );
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(serviceInput.assignedUserId, null);
  assert.equal(payload.contact.businessUnitName, 'AIT USA Institute');
  assert.equal(payload.contact.opportunityId, ids.opportunity);
  const serialized = JSON.stringify(payload);
  for (const forbidden of ['candidateIds', 'matchingContactIds', 'importReview', 'auditMetadata', 'secret']) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, 'i'));
  }
});

test('starting in an AIT USA terminal alias requires an employee reason', async () => {
  const response = await POST(
    request({ businessUnitId: ids.businessUnit, status: 'closed lost' }),
    { params: Promise.resolve({ id: ids.contact }) },
    {
      requirePermissionForRequest: async () => ({ error: null, session: policyAllowedRegularSession }),
      getDbForRequest: () => dbRows([contact], [businessUnit]),
    },
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /reason is required/);
});

test('owner-scoped regular Coordinator cannot claim an inaccessible no-Lead Contact', async () => {
  let started = false;
  const response = await POST(
    request({ businessUnitId: ids.businessUnit, status: 'New Lead' }),
    { params: Promise.resolve({ id: ids.contact }) },
    {
      requirePermissionForRequest: async () => ({ error: null, session }),
      getDbForRequest: () => dbRows([contact]),
      startOpportunityForRequest: async () => { started = true; },
    },
  );
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /assigned contacts/);
  assert.equal(started, false);
});

for (const fixture of [
  {
    name: 'inactive owner',
    user: { id: ids.otherUser, name: 'Inactive', email: 'inactive@aitusa.org', isActive: false },
    roles: [{ key: 'account_coordinator' }],
    memberships: [{ businessUnitId: ids.businessUnit }],
    error: /not active/,
  },
  {
    name: 'nonmember owner',
    user: { id: ids.otherUser, name: 'Other division', email: 'other@aitusa.org', isActive: true },
    roles: [{ key: 'account_coordinator' }],
    memberships: [{ businessUnitId: '10000000-0000-4000-8000-000000000099' }],
    error: /does not belong/,
  },
  {
    name: 'nonassignable owner role',
    user: { id: ids.otherUser, name: 'Student', email: 'student@aitusa.org', isActive: true },
    roles: [{ key: 'student' }],
    memberships: [{ businessUnitId: ids.businessUnit }],
    error: /regular Coordinator/,
  },
]) {
  test(`elevated Start opportunity rejects ${fixture.name}`, async () => {
    const response = await POST(
      request({ businessUnitId: ids.businessUnit, status: 'New Lead', assignedTo: ids.otherUser }),
      { params: Promise.resolve({ id: ids.contact }) },
      {
        requirePermissionForRequest: async () => ({ error: null, session: elevatedSession }),
        getDbForRequest: () => dbRows([contact], [businessUnit], [fixture.user], fixture.roles, fixture.memberships),
      },
    );
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, fixture.error);
  });
}

test('elevated Start opportunity allows an active assignable member of the target business unit', async () => {
  let serviceInput;
  const response = await POST(
    request({ businessUnitId: ids.businessUnit, status: 'New Lead', assignedTo: ids.otherUser }),
    { params: Promise.resolve({ id: ids.contact }) },
    {
      requirePermissionForRequest: async () => ({ error: null, session: elevatedSession }),
      getDbForRequest: () => dbRows(
        [contact],
        [businessUnit],
        [{ id: ids.otherUser, name: 'Owner', email: 'owner@aitusa.org', isActive: true }],
        [{ key: 'account_coordinator' }],
        [{ businessUnitId: ids.businessUnit }],
      ),
      startOpportunityForRequest: async (input) => {
        serviceInput = input;
        return { status: 'created', opportunity: { id: ids.opportunity, status: 'New Lead', currentStage: 'New Lead', assignedUserId: ids.otherUser } };
      },
    },
  );
  assert.equal(response.status, 201);
  assert.equal(serviceInput.assignedUserId, ids.otherUser);
});

test('Senior Coordinator can assign a new AIT USA Opportunity to themself', async () => {
  let serviceInput;
  const response = await POST(
    request({ businessUnitId: ids.businessUnit, status: 'New Lead', assignedTo: ids.user }),
    { params: Promise.resolve({ id: ids.contact }) },
    {
      requirePermissionForRequest: async () => ({ error: null, session: elevatedSession }),
      getDbForRequest: () => dbRows(
        [contact],
        [businessUnit],
        [{ id: ids.user, name: 'Lili', email: 'lili@aitusa.org', isActive: true }],
        [{ key: 'senior_coordinator' }],
        [{ businessUnitId: ids.businessUnit }],
      ),
      startOpportunityForRequest: async (input) => {
        serviceInput = input;
        return {
          status: 'created',
          opportunity: {
            id: ids.opportunity,
            status: 'New Lead',
            currentStage: 'New Lead',
            assignedUserId: ids.user,
          },
        };
      },
    },
  );
  assert.equal(response.status, 201);
  assert.equal(serviceInput.assignedUserId, ids.user);
});

test('Senior Coordinator cannot assign a new AIT USA Opportunity to another Senior Coordinator', async () => {
  const response = await POST(
    request({ businessUnitId: ids.businessUnit, status: 'New Lead', assignedTo: ids.otherUser }),
    { params: Promise.resolve({ id: ids.contact }) },
    {
      requirePermissionForRequest: async () => ({ error: null, session: elevatedSession }),
      getDbForRequest: () => dbRows(
        [contact],
        [businessUnit],
        [{ id: ids.otherUser, name: 'Other Senior', email: 'senior@aitusa.org', isActive: true }],
        [{ key: 'senior_coordinator' }],
        [{ businessUnitId: ids.businessUnit }],
      ),
    },
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /acting Senior Coordinator/);
});

test('elevated Start opportunity permits null owner consistently with manual Contact create', async () => {
  let serviceInput;
  const response = await POST(
    request({ businessUnitId: ids.businessUnit, status: 'New Lead', assignedTo: '' }),
    { params: Promise.resolve({ id: ids.contact }) },
    {
      requirePermissionForRequest: async () => ({ error: null, session: elevatedSession }),
      getDbForRequest: () => dbRows([contact], [businessUnit]),
      startOpportunityForRequest: async (input) => {
        serviceInput = input;
        return { status: 'created', opportunity: { id: ids.opportunity, status: 'New Lead', currentStage: 'New Lead', assignedUserId: null } };
      },
    },
  );
  assert.equal(response.status, 201);
  assert.equal(serviceInput.assignedUserId, null);
});

test('elevated Start opportunity rejects an administrator as the target owner', async () => {
  const response = await POST(
    request({ businessUnitId: ids.businessUnit, status: 'New Lead', assignedTo: ids.otherUser }),
    { params: Promise.resolve({ id: ids.contact }) },
    {
      requirePermissionForRequest: async () => ({ error: null, session: elevatedSession }),
      getDbForRequest: () => dbRows(
        [contact],
        [businessUnit],
        [{ id: ids.otherUser, name: 'Admin', email: 'admin@aitusa.org', isActive: true }],
        [{ key: 'admin' }],
        [],
      ),
    },
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /regular Coordinator/);
});

test('new AIT USA terminal status forwards the UI/API outcome reason into the audit service', async () => {
  let serviceInput;
  const response = await POST(
    request({ businessUnitId: ids.businessUnit, status: 'closed lost', reason: 'Student selected another school.' }),
    { params: Promise.resolve({ id: ids.contact }) },
    {
      requirePermissionForRequest: async () => ({ error: null, session: elevatedSession }),
      getDbForRequest: () => dbRows([contact], [businessUnit]),
      startOpportunityForRequest: async (input) => {
        serviceInput = input;
        return { status: 'created', opportunity: { id: ids.opportunity, status: 'Not Interested', currentStage: 'Not Interested', assignedUserId: null } };
      },
    },
  );
  assert.equal(response.status, 201);
  assert.equal(serviceInput.status, 'Not Interested');
  assert.equal(serviceInput.reason, 'Student selected another school.');
});
