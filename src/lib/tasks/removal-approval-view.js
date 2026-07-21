export function canReviewTaskRemovalApprovals(user = {}) {
  const roleKeys = [
    user.primaryRoleKey,
    ...(Array.isArray(user.roleKeys) ? user.roleKeys : []),
  ].filter(Boolean);
  return roleKeys.includes('admin') || roleKeys.includes('senior_coordinator');
}
export function taskRemovalApprovalState(task = {}) {
  return task?.metadataJson?.removalApproval || null;
}
