import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchGlobalSearch } from './loader.js';

test('global search loader skips short input and requests a scoped query', async () => {
  assert.deepEqual(await fetchGlobalSearch({ query: 'a' }), []);
  const requests = [];
  const results = await fetchGlobalSearch({
    query: 'Alvaro SMS',
    businessUnitId: 'bu-usa',
    fetcher: async (...args) => {
      requests.push(args);
      return { ok: true, async json() { return { results: [{ id: 'contact-1' }] }; } };
    },
  });
  assert.equal(requests[0][0], '/api/search?q=Alvaro+SMS&businessUnitId=bu-usa');
  assert.equal(results.length, 1);
});

test('global search loader surfaces route errors', async () => {
  await assert.rejects(
    fetchGlobalSearch({
      query: 'error',
      fetcher: async () => ({ ok: false, async json() { return { error: 'Access denied.' }; } }),
    }),
    /Access denied/,
  );
});
