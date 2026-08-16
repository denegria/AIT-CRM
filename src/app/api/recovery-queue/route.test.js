import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const routeSource = await readFile(new URL('./route.js', import.meta.url), 'utf8');

test('Recovery Queue route keeps organization, business-unit, and regular-owner scope server owned', () => {
  assert.match(routeSource, /requirePermission\(request, PERMISSIONS\.CRM_READ\)/);
  assert.match(routeSource, /isRegularCoordinatorSession\(session\)/);
  assert.match(routeSource, /regularCoordinatorUserId/);
  assert.match(routeSource, /resolveBusinessUnitId/);
  assert.match(routeSource, /session\.user\.organizationId/);
});

test('Recovery Queue route releases its pooled PostgreSQL client', () => {
  assert.match(routeSource, /client = await getPool\(\)\.connect\(\)/);
  assert.match(routeSource, /finally \{/);
  assert.match(routeSource, /client\?\.release\(\)/);
});
