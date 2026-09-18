import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./route.js', import.meta.url), 'utf8');

test('collections routes enforce separate read and write permissions', () => {
  assert.match(source, /requirePermission\(request, PERMISSIONS\.FINANCIALS_READ\)/);
  assert.match(source, /requirePermission\(request, PERMISSIONS\.FINANCIALS_WRITE\)/);
});

test('all collections operations resolve an AIT USA business-unit scope', () => {
  assert.match(source, /resolveBusinessUnitId/);
  assert.match(source, /isAitUsaBusinessUnit/);
  assert.match(source, /Collections is limited to AIT USA/);
});

test('route exposes checkout, hosted-link, and non-card payment actions', () => {
  assert.match(source, /body\.action === 'create_checkout'/);
  assert.match(source, /body\.action === 'create_hosted_link'/);
  assert.match(source, /body\.action === 'record_manual_payment'/);
  assert.match(source, /channel: 'staff'/);
});

test('queue and setup reads do not overlap on one pooled PostgreSQL client', () => {
  assert.doesNotMatch(source, /Promise\.all\(\[\s*loadCollectionsQueue/);
  assert.match(source, /const queue = await loadCollectionsQueue/);
  assert.match(source, /const setup = await loadCollectionsSetup/);
});
