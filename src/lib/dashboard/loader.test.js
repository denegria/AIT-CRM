import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchDashboardSummary } from './loader.js';

test('dashboard loader requests one scoped summary without broad collections', async () => {
  const requests = [];
  const payload = await fetchDashboardSummary({
    businessUnitId: 'bu-usa',
    employeeIds: ['user-1', 'user-2'],
    fetcher: async (...args) => {
      requests.push(args);
      return {
        ok: true,
        async json() {
          return { businessUnitId: 'bu-usa', kpis: { activeContacts: 286 } };
        },
      };
    },
  });

  assert.deepEqual(requests, [[
    '/api/dashboard-summary?businessUnitId=bu-usa&employeeIds=user-1%2Cuser-2',
    { cache: 'no-store' },
  ]]);
  assert.equal(payload.kpis.activeContacts, 286);
  assert.equal(Object.hasOwn(payload, 'contacts'), false);
  assert.equal(Object.hasOwn(payload, 'workOrders'), false);
  assert.equal(Object.hasOwn(payload, 'financials'), false);
});

test('dashboard loader rejects missing scope and route failures', async () => {
  await assert.rejects(fetchDashboardSummary({}), /Select a division/);
  await assert.rejects(
    fetchDashboardSummary({
      businessUnitId: 'bu-usa',
      fetcher: async () => ({ ok: false, async json() { return { error: 'Access denied.' }; } }),
    }),
    /Access denied/,
  );
});
