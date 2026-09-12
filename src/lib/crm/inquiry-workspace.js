function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function timestamp(value) {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

export function defaultInquiryId(items = []) {
  const active = items.find((item) => item.isActive);
  return active?.id || items[0]?.id || '';
}

// This is deliberately a whitelist. The database lead/task rows carry source
// provenance and placement metadata that are not a CRM workspace payload.
export function inquiryWorkspaceItem({ lead = {}, owner = null, placement = null, lastActivityAt = null } = {}) {
  return {
    id: text(lead.id),
    program: text(lead.programInterest),
    status: text(lead.status || lead.currentStage) || 'Unknown',
    owner: owner ? { id: text(owner.id), label: text(owner.name) || text(owner.email) || 'Unassigned' } : null,
    openedAt: timestamp(lead.createdAt),
    updatedAt: timestamp(lead.updatedAt),
    source: text(lead.sourceName),
    lastActivityAt: timestamp(lastActivityAt),
    isActive: Boolean(lead.isActive),
    editable: {
      status: text(lead.status || lead.currentStage),
      assignedTo: text(lead.assignedUserId),
      programInterest: text(lead.programInterest),
      preferredDay: text(lead.preferredDay),
      preferredSchedule: text(lead.preferredSchedule),
      locationPreference: text(lead.locationPreference),
      sourceName: text(lead.sourceName),
      sourceDetail: text(lead.sourceDetail),
    },
    placement: placement ? {
      state: text(placement.state) || 'Pending review',
      finalLevel: text(placement.finalLevel),
      finalStatus: text(placement.finalStatus),
      updatedAt: timestamp(placement.updatedAt),
      reviewPath: text(placement.reviewPath),
    } : null,
  };
}
