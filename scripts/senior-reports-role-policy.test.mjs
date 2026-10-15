import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
function objectAfter(path, start, end, context = {}) {
  const source = readFileSync(new URL(path, root), 'utf8');
  const body = source.split(start)[1]?.split(end)[0];
  assert.ok(body, `Missing permission declaration in ${path}`);
  return vm.runInNewContext(`(${body.trim().replace(/;$/, '')})`, context);
}
const permissions = objectAfter('src/lib/auth.js', 'export const PERMISSIONS = ', 'export const DEFAULT_ROLE_PERMISSIONS');
const defaults = objectAfter('src/lib/auth.js', 'export const DEFAULT_ROLE_PERMISSIONS = ', 'const COOKIE_OPTIONS', {
  PERMISSIONS: permissions,
  ROLE_KEYS: { ADMIN:'admin', DESIGNER:'designer', ACCOUNT_COORDINATOR:'account_coordinator', SENIOR_COORDINATOR:'senior_coordinator', SALES_MANAGER:'sales_manager' },
});
const bootstrap = objectAfter('scripts/bootstrap-auth-user.mjs', 'const PERMISSIONS = ', 'const ROLE_NAMES');
const verifier = objectAfter('scripts/verify-rbac-boundaries.mjs', 'const EXPECTED_ROLE_PERMISSIONS = ', 'const FORBIDDEN_NON_ADMIN_PERMISSIONS');

test('senior reporting grant stays aligned across runtime defaults, provisioning and RBAC audit', () => {
  for (const map of [defaults, bootstrap, verifier]) {
    assert.ok(map.senior_coordinator.includes('reports:read'));
    assert.deepEqual([...map.senior_coordinator].sort(), ['crm:read','crm:write','financials:read','financials:write','reports:read','work_orders:write']);
  }
});
test('reporting access does not leak to regular coordinators or designers', () => {
  for (const map of [defaults, bootstrap, verifier]) {
    assert.equal(map.account_coordinator.includes('reports:read'), false);
    assert.equal(map.designer.includes('reports:read'), false);
    assert.equal(map.admin.includes('reports:read'), true);
    assert.equal(map.sales_manager.includes('reports:read'), true);
  }
});
test('senior report access does not grant global-division or administrator permissions', () => {
  for (const map of [defaults, bootstrap, verifier]) {
    for (const key of ['business_units:all','settings:read','settings:write','import_review:read','import_review:write']) assert.equal(map.senior_coordinator.includes(key), false);
  }
});
