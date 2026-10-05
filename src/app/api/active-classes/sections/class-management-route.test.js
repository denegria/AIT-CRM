import assert from 'node:assert/strict';
import test from 'node:test';
import { classManagementAccess } from './access.js';

const usa = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const user = (roleKeys, businessUnitIds = [usa]) => ({ roleKeys, businessUnitIds });

test('same AIT USA section allows senior/admin writes but denies regular coordinator', () => {
  assert.equal(classManagementAccess(user(['senior_coordinator']), usa, true), null);
  assert.equal(classManagementAccess(user(['admin']), usa, true), null);
  assert.equal(classManagementAccess(user(['account_coordinator']), usa, false), null);
  assert.equal(classManagementAccess(user(['account_coordinator']), usa, true).status, 403);
});

test('cross-unit and unassigned actor fail closed before any database write', () => {
  assert.equal(classManagementAccess(user(['senior_coordinator']), other, true).status, 403);
  assert.equal(classManagementAccess(user(['admin'], []), usa, true).status, 403);
  assert.equal(classManagementAccess(user(['admin'], []), usa, false).status, 403);
  assert.equal(classManagementAccess(user([]), usa, true).status, 403);
});
