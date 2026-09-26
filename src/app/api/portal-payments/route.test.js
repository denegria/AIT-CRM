import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./route.js', import.meta.url), 'utf8');
const serviceSource = fs.readFileSync(new URL('../../../lib/portal-payments/service.js', import.meta.url), 'utf8');

test('portal payment route is secret protected and no-store', () => {
  assert.match(source, /x-ait-portal-payments-secret/);
  assert.match(source, /verifyPortalPaymentsSecret/);
  assert.match(source, /private, no-store/);
});

test('route exposes only snapshot, fixed request, hosted link, and status operations', () => {
  for (const action of ['snapshot', 'create_request', 'hosted_link', 'status']) {
    assert.match(source, new RegExp(`input\\.action === '${action}'`));
  }
  assert.match(serviceSource, /requiredSourceType: 'portal_payment'/);
});

test('preview payment provider is forbidden in production', () => {
  assert.match(source, /process\.env\.VERCEL_ENV === 'production' && fakeProvider/);
  assert.match(source, /preview_provider_forbidden/);
});
