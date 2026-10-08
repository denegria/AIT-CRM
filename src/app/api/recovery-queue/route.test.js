import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const routeSource = await readFile(new URL('./route.js', import.meta.url), 'utf8');

test('Recovery Queue route requires an admin session before querying', () => {
  assert.match(routeSource, /requirePermission\(request, PERMISSIONS\.CRM_READ\)/);
  assert.match(routeSource, /if \(!sessionHasAdminRole\(session\)\)/);
  assert.match(routeSource, /Recovery Queue requires administrator access\.' \}, \{ status: 403 \}/);
  assert.ok(routeSource.indexOf('if (!sessionHasAdminRole(session))') < routeSource.indexOf('getPool().connect()'));
});

test('Recovery Queue route keeps organization and business-unit scope server owned', () => {
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
