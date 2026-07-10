import test from 'node:test';
import assert from 'node:assert/strict';

import {
  routeBusinessUnitFilterForGlobalScope,
  syncRouteBusinessUnitFilter,
} from './division-scope.js';

test('route division filter follows a specific global division', () => {
  assert.equal(routeBusinessUnitFilterForGlobalScope('ait-usa'), 'ait-usa');
  assert.equal(routeBusinessUnitFilterForGlobalScope('ait-signs'), 'ait-signs');
});

test('route division filter uses all when global scope is broad', () => {
  assert.equal(routeBusinessUnitFilterForGlobalScope('all'), 'all');
  assert.equal(routeBusinessUnitFilterForGlobalScope('unassigned'), 'all');
  assert.equal(routeBusinessUnitFilterForGlobalScope(''), 'all');
});

test('syncRouteBusinessUnitFilter replaces stale route-local division scope', () => {
  const filters = {
    due: 'work',
    ownerUserId: 'all',
    businessUnitId: 'ait-usa',
    taskType: 'all',
    status: 'all',
    link: 'all',
  };

  const signsFilters = syncRouteBusinessUnitFilter(filters, 'ait-signs');
  assert.equal(signsFilters.businessUnitId, 'ait-signs');
  assert.equal(signsFilters.due, 'work');

  const usaFilters = syncRouteBusinessUnitFilter(signsFilters, 'ait-usa');
  assert.equal(usaFilters.businessUnitId, 'ait-usa');
});

test('syncRouteBusinessUnitFilter preserves identity when already synced', () => {
  const filters = { businessUnitId: 'ait-signs', due: 'work' };
  assert.equal(syncRouteBusinessUnitFilter(filters, 'ait-signs'), filters);
});
