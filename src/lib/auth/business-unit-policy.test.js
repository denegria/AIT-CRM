import assert from 'node:assert/strict';
import test from 'node:test';
import { applyBusinessUnitAccessPolicy } from './business-unit-policy.js';

const units = [
  { id: 'usa', name: 'AIT USA Institute', isActive: true },
  { id: 'signs', name: 'AIT Signs', isActive: true },
  { id: 'taxes', name: 'AIT Taxes', isActive: true },
];

const memberships = [
  { businessUnitId: 'usa', businessUnitName: 'AIT USA Institute', isPrimary: true },
  { businessUnitId: 'signs', businessUnitName: 'AIT Signs', isPrimary: false },
];

test('temporarily removes AIT Signs from non-admin memberships', () => {
  const result = applyBusinessUnitAccessPolicy({
    roleKeys: ['account_coordinator'],
    permissionKeys: [],
    allBusinessUnits: units,
    membershipRows: memberships,
    aitSignsEmployeeAccessEnabled: false,
  });

  assert.deepEqual(result.businessUnitIds, ['usa']);
  assert.deepEqual(result.restrictedBusinessUnitIds, ['signs']);
  assert.equal(result.canAccessAllBusinessUnits, false);
});

test('converts all-division employee access into an explicit allowlist without AIT Signs', () => {
  const result = applyBusinessUnitAccessPolicy({
    roleKeys: ['senior_coordinator'],
    permissionKeys: ['business_units:all'],
    allBusinessUnits: units,
    membershipRows: memberships,
    aitSignsEmployeeAccessEnabled: false,
  });

  assert.deepEqual(result.businessUnitIds, ['usa', 'taxes']);
  assert.equal(result.canAccessAllBusinessUnits, false);
});

test('preserves admin AIT Signs access for oversight and QA', () => {
  const result = applyBusinessUnitAccessPolicy({
    roleKeys: ['admin'],
    permissionKeys: ['business_units:all'],
    allBusinessUnits: units,
    membershipRows: memberships,
    aitSignsEmployeeAccessEnabled: false,
  });

  assert.deepEqual(result.businessUnitIds, ['usa', 'signs']);
  assert.equal(result.canAccessAllBusinessUnits, true);
  assert.deepEqual(result.restrictedBusinessUnitIds, []);
});

test('feature flag restores employee AIT Signs access without a code change', () => {
  const result = applyBusinessUnitAccessPolicy({
    roleKeys: ['account_coordinator'],
    permissionKeys: [],
    allBusinessUnits: units,
    membershipRows: memberships,
    aitSignsEmployeeAccessEnabled: true,
  });

  assert.deepEqual(result.businessUnitIds, ['usa', 'signs']);
  assert.deepEqual(result.restrictedBusinessUnitIds, []);
});
