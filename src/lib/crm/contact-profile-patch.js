export function hasOpportunityMutationRequest(body = {}) {
  return [
    'status',
    'inquirySource',
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
  canManageAssignments = true,
  editScope = 'combined',
  isClosedStatusReopen = false,
  isEnteringClosedStatus = false,
} = {}) {
  let patch = { ...editForm };
  delete patch.notes;
  delete patch.timeline;

  if (editScope === 'contact') {
    return Object.fromEntries(
      ['id', 'name', 'email', 'phone', 'address', 'contactSource']
        .filter((field) => Object.prototype.hasOwnProperty.call(editForm, field))
        .map((field) => [field, editForm[field]]),
    );
  }
  if (editScope === 'inquiry') {
    patch = Object.fromEntries(
      [
        'id', 'opportunityId', 'updatedAt', 'status', 'assignedTo', 'businessUnitId', 'primaryBusinessUnitId',
        'inquirySource', 'leadProfile', 'courseMetadata', 'programInterest', 'preferredDay',
        'preferredSchedule', 'testInterest', 'educationLevel', 'schoolName', 'locationPreference',
        'profileDetails', 'sourceDetail', 'currentCourse', 'completedCourse', 'endedCourse',
        'courseOutcome', 'statusChangeReason', 'terminalStatusReason',
      ]
        .filter((field) => Object.prototype.hasOwnProperty.call(editForm, field))
        .map((field) => [field, editForm[field]]),
    );
  }

  if (isAitUsa && contact.opportunityConflict) {
    return Object.fromEntries(
      ['id', 'name', 'email', 'phone', 'address', 'contactSource', 'opportunityId']
        .filter((field) => Object.prototype.hasOwnProperty.call(editForm, field))
        .map((field) => [field, editForm[field]]),
    );
  }

  if (isAitUsa && !contact.hasLeadStatus) {
    delete patch.status;
    delete patch.currentStage;
    delete patch.opportunityId;
    delete patch.assignedTo;
    delete patch.leadProfile;
    delete patch.courseMetadata;
  }
  if (isAitUsa && !canManageAssignments) {
    delete patch.assignedTo;
  } else if (isAitUsa && patch.assignedTo === contact.assignedTo) {
    delete patch.assignedTo;
  }
  const canMutateOpportunity = !(isAitUsa && (!contact.hasLeadStatus || contact.opportunityConflict));
  const canApplyLockedOwner = canMutateOpportunity && lockedOwnerUserId && (!isAitUsa || canManageAssignments);
  return {
    ...patch,
    ...(canApplyLockedOwner ? { assignedTo: lockedOwnerUserId } : {}),
    statusChangeReason: isClosedStatusReopen ? editForm.statusChangeReason : '',
    terminalStatusReason: isEnteringClosedStatus ? editForm.terminalStatusReason : '',
    ...(canMutateOpportunity && editForm.leadProfile ? { leadProfile: editForm.leadProfile } : {}),
  };
}
