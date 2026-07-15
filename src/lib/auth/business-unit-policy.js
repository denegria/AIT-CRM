import { ROLE_KEYS } from '../roles.js';

export const AIT_SIGNS_EMPLOYEE_ACCESS_ENV = 'AIT_SIGNS_EMPLOYEE_ACCESS_ENABLED';

function normalizedName(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

export function isAitSignsBusinessUnit(unit = {}) {
  return normalizedName(unit.name) === 'ait signs';
}

export function employeeAitSignsAccessEnabled(env = process.env) {
  return String(env?.[AIT_SIGNS_EMPLOYEE_ACCESS_ENV] || '').trim().toLowerCase() === 'true';
}

export function applyBusinessUnitAccessPolicy({
  roleKeys = [],
  permissionKeys = [],
  allBusinessUnits = [],
  membershipRows = [],
  businessUnitsAllPermission = 'business_units:all',
  aitSignsEmployeeAccessEnabled = employeeAitSignsAccessEnabled(),
} = {}) {
  const isAdmin = roleKeys.includes(ROLE_KEYS.ADMIN);
  const hasAllBusinessUnits = permissionKeys.includes(businessUnitsAllPermission);

  if (isAdmin || aitSignsEmployeeAccessEnabled) {
    return {
      membershipRows,
      businessUnitIds: membershipRows.map((row) => row.businessUnitId),
      canAccessAllBusinessUnits: hasAllBusinessUnits,
      restrictedBusinessUnitIds: [],
    };
  }

  const restrictedBusinessUnitIds = allBusinessUnits
    .filter(isAitSignsBusinessUnit)
    .map((unit) => unit.id);
  const restrictedIds = new Set(restrictedBusinessUnitIds);
  const eligibleUnits = allBusinessUnits.filter((unit) => unit.isActive !== false && !restrictedIds.has(unit.id));
  const membershipsByUnitId = new Map(membershipRows.map((row) => [row.businessUnitId, row]));
  const allowedRows = hasAllBusinessUnits
    ? eligibleUnits.map((unit) => ({
      businessUnitId: unit.id,
      businessUnitName: unit.name || '',
      isPrimary: Boolean(membershipsByUnitId.get(unit.id)?.isPrimary),
    }))
    : membershipRows.filter((row) => !restrictedIds.has(row.businessUnitId));

  return {
    membershipRows: allowedRows,
    businessUnitIds: allowedRows.map((row) => row.businessUnitId),
    canAccessAllBusinessUnits: false,
    restrictedBusinessUnitIds,
  };
}
