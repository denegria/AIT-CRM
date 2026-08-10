import {
  assertCanAccessContactLead,
  canAccessContactLead,
} from '../crm/access.js';
import {
  createFollowUpSelectionError,
  FOLLOW_UP_SELECTION_ERROR_CODES,
} from './follow-up-selection.js';

function entityMismatch(message) {
  return createFollowUpSelectionError(
    message,
    FOLLOW_UP_SELECTION_ERROR_CODES.ENTITY_MISMATCH,
  );
}

function assertContactDivision(contact, businessUnitId) {
  if (contact?.primaryBusinessUnitId && businessUnitId && contact.primaryBusinessUnitId !== businessUnitId) {
    throw entityMismatch('The selected follow-up task no longer matches the Contact division. Refresh the task queue and select it again.');
  }
}

function assertLeadChain({ lead, contact, businessUnitId }) {
  if (!lead) return;
  if (lead.contactId !== contact.id || (businessUnitId && lead.businessUnitId !== businessUnitId)) {
    throw entityMismatch('The selected Lead no longer matches the Contact or division. Refresh before logging a follow-up.');
  }
}

function selectUnambiguousAccessibleLead({ leadRows, session, contact, businessUnitId }) {
  const divisionRows = businessUnitId
    ? leadRows.filter((lead) => lead.businessUnitId === businessUnitId)
    : leadRows;
  if (!divisionRows.length) {
    if (leadRows.length) {
      throw entityMismatch('The Contact has Lead records in a different division. Select the correct Contact context before logging outreach.');
    }
    assertCanAccessContactLead(session, null, contact);
    return null;
  }

  const accessibleRows = divisionRows.filter((lead) => canAccessContactLead(session, lead, contact));
  if (!accessibleRows.length) {
    assertCanAccessContactLead(session, divisionRows[0], contact);
  }
  if (accessibleRows.length > 1) {
    throw createFollowUpSelectionError(
      'Multiple eligible Leads match this Contact and division. Select a specific Lead before recording outreach.',
      FOLLOW_UP_SELECTION_ERROR_CODES.LEAD_AMBIGUOUS,
    );
  }
  return accessibleRows[0] || null;
}

export async function resolveFollowUpLeadContext({
  session,
  contact,
  task = null,
  requestedLeadId = null,
  hasRequestedLeadId = false,
  loadLeadById,
  loadLeadsForContact,
}) {
  const businessUnitId = task?.businessUnitId || contact.primaryBusinessUnitId || null;
  assertContactDivision(contact, businessUnitId);

  if (task) {
    const lead = task.leadId ? await loadLeadById(task.leadId) : null;
    if (task.leadId && !lead) {
      throw entityMismatch('The selected follow-up task points to a Lead that no longer exists. Refresh the task queue and select it again.');
    }
    assertLeadChain({ lead, contact, businessUnitId });
    assertCanAccessContactLead(session, lead, contact);
    return { contact, lead, leadId: task.leadId || null, businessUnitId };
  }

  if (hasRequestedLeadId && requestedLeadId) {
    const lead = await loadLeadById(requestedLeadId);
    if (!lead) {
      throw createFollowUpSelectionError(
        'The selected Lead no longer exists. Refresh the Contact before recording outreach.',
        FOLLOW_UP_SELECTION_ERROR_CODES.NOT_FOUND,
        404,
      );
    }
    assertLeadChain({ lead, contact, businessUnitId });
    assertCanAccessContactLead(session, lead, contact);
    return { contact, lead, leadId: requestedLeadId, businessUnitId: businessUnitId || lead.businessUnitId };
  }

  const leadRows = await loadLeadsForContact(contact.id);
  if (hasRequestedLeadId && leadRows.length) {
    throw createFollowUpSelectionError(
      'This Contact has Lead context. Select a specific Lead before recording outreach.',
      FOLLOW_UP_SELECTION_ERROR_CODES.MISSING_IDENTIFIERS,
    );
  }
  const lead = selectUnambiguousAccessibleLead({
    leadRows,
    session,
    contact,
    businessUnitId,
  });
  return {
    contact,
    lead,
    leadId: lead?.id || null,
    businessUnitId: businessUnitId || lead?.businessUnitId || null,
  };
}

export async function resolveExactFollowUpTaskContext({
  session,
  task,
  loadContactById,
  loadLeadById,
}) {
  if (!task.contactId) {
    throw entityMismatch('The selected follow-up task is not linked to a Contact. Refresh the task queue and correct the task before completion.');
  }
  const contact = await loadContactById(task.contactId);
  return resolveFollowUpLeadContext({
    session,
    contact,
    task,
    loadLeadById,
    loadLeadsForContact: async () => [],
  });
}
