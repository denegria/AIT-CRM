export const ALL_BUSINESS_UNITS = 'all';
export const UNASSIGNED_BUSINESS_UNIT = 'unassigned';

export function recordBusinessUnitId(record = {}) {
  return record?.businessUnitId || record?.primaryBusinessUnitId || '';
}

export function recordMatchesBusinessUnitScope(record = {}, scopeId = ALL_BUSINESS_UNITS) {
  if (scopeId === ALL_BUSINESS_UNITS) return true;
  const businessUnitId = recordBusinessUnitId(record);
  if (scopeId === UNASSIGNED_BUSINESS_UNIT) return !businessUnitId;
  return businessUnitId === scopeId;
}
