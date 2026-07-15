import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchTaskContactOptions } from './contact-options-loader.js';

test('task contact loader requests a compact scoped search', async () => {
  const requests = [];
  const contacts = await fetchTaskContactOptions({
    businessUnitId: 'bu-usa',
    query: 'Ada',
    fetcher: async (...args) => {
      requests.push(args);
      return { ok: true, async json() { return { contacts: [{ id: 'contact-1', name: 'Ada' }] }; } };
    },
  });

  assert.deepEqual(requests, [[
    '/api/tasks/contact-options?businessUnitId=bu-usa&q=Ada',
    { cache: 'no-store' },
  ]]);
  assert.deepEqual(contacts, [{ id: 'contact-1', name: 'Ada' }]);
});

test('task contact loader supports exact route-prefill lookup and route errors', async () => {
  const requests = [];
  await fetchTaskContactOptions({
    contactId: 'contact-1',
    fetcher: async (...args) => {
      requests.push(args);
      return { ok: true, async json() { return { contacts: [] }; } };
    },
  });
  assert.equal(requests[0][0], '/api/tasks/contact-options?contactId=contact-1');

  await assert.rejects(
    fetchTaskContactOptions({ fetcher: async () => ({ ok: false, async json() { return { error: 'Denied.' }; } }) }),
    /Denied/,
  );
});
