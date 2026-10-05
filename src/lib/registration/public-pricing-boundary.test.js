import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const service = fs.readFileSync(new URL('./public-service.js', import.meta.url), 'utf8');
const route = fs.readFileSync(new URL('../../app/api/public-registration/route.js', import.meta.url), 'utf8');

test('public status and hosted link are pinned to public-channel registration records', () => {
  assert.match(service, /pr\.metadata_json #>> '\{registrationResult,quote,channel\}' = 'public'/);
  assert.match(route, /requiredRegistrationChannel: 'public'/);
});
