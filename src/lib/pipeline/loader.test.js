import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPipelineSummary, pipelineSummaryQuery } from './loader.js';

test('pipeline loader scopes the request to one division and timeframe', async () => {
  assert.equal(
    pipelineSummaryQuery({ businessUnitId: 'bu-usa', leadDateScope: 'custom', leadDateFrom: '2026-01-01', leadDateTo: '2026-02-01' }),
    'businessUnitId=bu-usa&leadDateScope=custom&leadDateFrom=2026-01-01&leadDateTo=2026-02-01',
  );
  const requests = [];
  const payload = await fetchPipelineSummary({
    businessUnitId: 'bu-usa',
    leadDateScope: 'current',
    fetcher: async (...args) => {
      requests.push(args);
      return {
        ok: true,
        async json() {
          return { contacts: [{ id: 'contact-1' }], timeframeCounts: { current: 1 } };
        },
      };
    },
  });

  assert.deepEqual(requests, [[
    '/api/pipeline-summary?businessUnitId=bu-usa&leadDateScope=current',
    { cache: 'no-store' },
  ]]);
  assert.equal(payload.contacts.length, 1);
  assert.equal(payload.queryKey, 'businessUnitId=bu-usa&leadDateScope=current');
});

test('pipeline loader fails closed on missing scope and access errors', async () => {
  await assert.rejects(fetchPipelineSummary({}), /Select a division/);
  await assert.rejects(
    fetchPipelineSummary({
      businessUnitId: 'signs',
      fetcher: async () => ({ ok: false, async json() { return { error: 'Insufficient business-unit access.' }; } }),
    }),
    /Insufficient business-unit access/,
  );
});
