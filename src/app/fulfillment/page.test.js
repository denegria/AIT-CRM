import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const pageSource = await readFile(new URL('./page.js', import.meta.url), 'utf8');
const routeSource = await readFile(new URL('../api/fulfillment/route.js', import.meta.url), 'utf8');

test('fulfillment worklist keeps the locked policy lanes and address privacy boundary', () => {
  assert.match(pageSource, /Digital delivery/);
  assert.match(pageSource, /Pickup/);
  assert.match(pageSource, /Shipment/);
  assert.match(pageSource, /lane === 'shipment'/);
  assert.doesNotMatch(pageSource, /console\.(?:log|info|debug)/);
  assert.match(routeSource, /Cache-Control': 'private, no-store'/);
});

test('fulfillment mutations carry exact scope and stale-write protection', () => {
  assert.match(pageSource, /businessUnitId: item\.businessUnitId/);
  assert.match(pageSource, /expectedUpdatedAt: item\.updatedAt/);
  assert.match(routeSource, /PERMISSIONS\.CRM_WRITE/);
  assert.match(routeSource, /assertAitUsaScope/);
});

test('fulfillment worklist exposes only the supported operational transitions', () => {
  for (const action of ['claim', 'save_note', 'mark_digital_delivered', 'mark_ready', 'mark_picked_up', 'mark_shipped']) {
    assert.match(pageSource, new RegExp(action));
  }
});
