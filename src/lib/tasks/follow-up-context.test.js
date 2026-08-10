import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveExactFollowUpTaskContext,
  resolveFollowUpLeadContext,
} from './follow-up-context.js';

const adminSession = {
  user: {
    id: 'admin-1',
    organizationId: 'org-1',
    canAccessAllBusinessUnits: true,
    businessUnitIds: [],
    primaryRoleKey: 'admin',
    roleKeys: ['admin'],
  },
};

const regularSession = {
  user: {
    id: 'coordinator-1',
    organizationId: 'org-1',
    canAccessAllBusinessUnits: false,
    businessUnitIds: ['bu-usa'],
    businessUnitNamesById: { 'bu-usa': 'AIT USA Institute' },
    primaryRoleKey: 'account_coordinator',
    roleKeys: ['account_coordinator'],
  },
};

const contact = { id: 'contact-1', primaryBusinessUnitId: 'bu-usa' };
const olderLead = {
  id: 'lead-older',
  contactId: contact.id,
  businessUnitId: 'bu-usa',
  assignedUserId: 'coordinator-1',
};
const newerLead = {
  id: 'lead-newer',
  contactId: contact.id,
  businessUnitId: 'bu-usa',
  assignedUserId: 'coordinator-1',
};

test('generic outreach preserves an explicitly selected older Lead', async () => {
  let listed = false;
  const result = await resolveFollowUpLeadContext({
    session: adminSession,
    contact,
    requestedLeadId: olderLead.id,
    hasRequestedLeadId: true,
    loadLeadById: async (id) => id === olderLead.id ? olderLead : null,
    loadLeadsForContact: async () => {
      listed = true;
      return [olderLead, newerLead];
    },
  });

  assert.equal(result.leadId, olderLead.id);
  assert.equal(result.lead, olderLead);
  assert.equal(listed, false);
});

test('generic outreach rejects multiple eligible Leads instead of guessing newest', async () => {
  await assert.rejects(
    resolveFollowUpLeadContext({
      session: adminSession,
      contact,
      hasRequestedLeadId: false,
      loadLeadById: async () => null,
      loadLeadsForContact: async () => [olderLead, newerLead],
    }),
    (error) => error.status === 409 && error.code === 'follow_up_lead_ambiguous',
  );
});

test('generic outreach resolves the only eligible Lead in the Contact division', async () => {
  const result = await resolveFollowUpLeadContext({
    session: regularSession,
    contact,
    hasRequestedLeadId: false,
    loadLeadById: async () => null,
    loadLeadsForContact: async () => [
      olderLead,
      { ...newerLead, businessUnitId: 'bu-signs', assignedUserId: 'coordinator-2' },
    ],
  });

  assert.equal(result.leadId, olderLead.id);
  assert.equal(result.lead, olderLead);
});

test('generic outreach permits null Lead context only for a bare Contact', async () => {
  const result = await resolveFollowUpLeadContext({
    session: adminSession,
    contact,
    hasRequestedLeadId: false,
    loadLeadById: async () => null,
    loadLeadsForContact: async () => [],
  });
  assert.equal(result.leadId, null);
  assert.equal(result.lead, null);
});

test('task context rejects unauthorized Contact access before a completion write', async () => {
  let writes = 0;
  const task = {
    id: 'task-1',
    contactId: contact.id,
    leadId: olderLead.id,
    businessUnitId: 'bu-usa',
  };
  const unauthorizedLead = { ...olderLead, assignedUserId: 'coordinator-2' };
  const attemptCompletion = async () => {
    const context = await resolveExactFollowUpTaskContext({
      session: regularSession,
      task,
      loadContactById: async () => contact,
      loadLeadById: async () => unauthorizedLead,
    });
    writes += 1;
    return context;
  };

  await assert.rejects(attemptCompletion(), (error) => error.status === 403);
  assert.equal(writes, 0);
});

test('task context rejects a cross-division Lead chain before a completion write', async () => {
  let writes = 0;
  const task = {
    id: 'task-1',
    contactId: contact.id,
    leadId: olderLead.id,
    businessUnitId: 'bu-usa',
  };
  const attemptCompletion = async () => {
    const context = await resolveExactFollowUpTaskContext({
      session: adminSession,
      task,
      loadContactById: async () => contact,
      loadLeadById: async () => ({ ...olderLead, businessUnitId: 'bu-signs' }),
    });
    writes += 1;
    return context;
  };

  await assert.rejects(
    attemptCompletion(),
    (error) => error.status === 409 && error.code === 'follow_up_entity_mismatch',
  );
  assert.equal(writes, 0);
});
