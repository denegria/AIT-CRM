export function hasOpportunityMutationRequest(body = {}) {
  return [
    'status',
    'source',
    'assignedTo',
    'businessUnitId',
    'primaryBusinessUnitId',
    'programInterest',
    'preferredDay',
    'preferredSchedule',
    'testInterest',
    'educationLevel',
    'schoolName',
    'locationPreference',
    'profileDetails',
    'sourceDetail',
    'currentCourse',
    'completedCourse',
    'endedCourse',
    'courseOutcome',
  ].some((field) => Object.prototype.hasOwnProperty.call(body, field)) ||
    Boolean(body.leadProfile && typeof body.leadProfile === 'object') ||
    Boolean(body.courseMetadata && typeof body.courseMetadata === 'object');
}

export function buildContactProfilePatch({
  editForm = {},
  contact = {},
  isAitUsa = false,
  lockedOwnerUserId = '',
  isClosedStatusReopen = false,
  isEnteringClosedStatus = false,
} = {}) {
  const patch = { ...editForm };
  delete patch.notes;
  delete patch.timeline;

  if (isAitUsa && !contact.hasLeadStatus) {
    delete patch.status;
    delete patch.currentStage;
    delete patch.opportunityId;
    delete patch.assignedTo;
    delete patch.leadProfile;
    delete patch.courseMetadata;
  }
  if (isAitUsa && contact.opportunityConflict) {
    delete patch.status;
    delete patch.currentStage;
    delete patch.assignedTo;
    delete patch.leadProfile;
    delete patch.courseMetadata;
    delete patch.source;
    delete patch.businessUnitId;
    delete patch.primaryBusinessUnitId;
  }

  const canMutateOpportunity = !(isAitUsa && (!contact.hasLeadStatus || contact.opportunityConflict));
  return {
    ...patch,
    ...(canMutateOpportunity && lockedOwnerUserId ? { assignedTo: lockedOwnerUserId } : {}),
    statusChangeReason: isClosedStatusReopen ? editForm.statusChangeReason : '',
    terminalStatusReason: isEnteringClosedStatus ? editForm.terminalStatusReason : '',
    ...(canMutateOpportunity && editForm.leadProfile ? { leadProfile: editForm.leadProfile } : {}),
  };
}
