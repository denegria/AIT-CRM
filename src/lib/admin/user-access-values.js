export function buildMembershipRows({ userId, roleId, businessUnitIds = [] }) {
  return businessUnitIds.map((businessUnitId, index) => ({
    userId,
    businessUnitId,
    roleId,
    isPrimary: index === 0,
  }));
}
