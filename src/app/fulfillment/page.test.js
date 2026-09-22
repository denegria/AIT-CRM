import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const pageSource = await readFile(new URL('./page.js', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('./FulfillmentPage.module.css', import.meta.url), 'utf8');
const routeSource = await readFile(new URL('../api/fulfillment/route.js', import.meta.url), 'utf8');
const presentationSource = await readFile(new URL('../../lib/fulfillment/presentation.js', import.meta.url), 'utf8');

test('fulfillment worklist keeps the locked policy lanes and address privacy boundary', () => {
  assert.match(pageSource, /Manual digital delivery/);
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
  const uiSource = `${pageSource}\n${presentationSource}`;
  for (const action of ['save_note', 'mark_digital_delivered', 'mark_ready', 'mark_picked_up', 'mark_shipped']) {
    assert.match(uiSource, new RegExp(action));
  }
  assert.doesNotMatch(pageSource, />Claim</);
});

test('fulfillment shell uses compact accessible lane navigation and one all-clear state', () => {
  assert.match(pageSource, /role="tablist"/);
  assert.match(pageSource, /role="tab"/);
  assert.match(pageSource, /aria-selected=/);
  assert.match(pageSource, /All book fulfillment is complete/);
  assert.match(pageSource, /allFulfillmentLanesClear/);
  assert.match(pageSource, /Visible only in Shipment/);
  assert.doesNotMatch(pageSource, /className=\{s\.scopeLine\}/);
  assert.match(styleSource, /\.scrollCue/);
});

test('refresh belongs to the fulfillment workspace toolbar', () => {
  const toolbarIndex = pageSource.indexOf('className={s.workspaceToolbar}');
  const refreshIndex = pageSource.indexOf('className={`btn ${s.refreshButton}`}');
  const panelIndex = pageSource.indexOf('id="fulfillment-workspace"');
  assert.ok(toolbarIndex >= 0);
  assert.ok(refreshIndex > toolbarIndex);
  assert.ok(panelIndex > refreshIndex);
});

test('populated fulfillment uses one selectable queue and one focused work item', () => {
  assert.match(pageSource, /className=\{`\$\{s\.workArea\}/);
  assert.match(pageSource, /aria-pressed=\{selected\}/);
  assert.match(pageSource, /aria-controls="fulfillment-selected-item"/);
  assert.match(pageSource, /Back to queue/);
  assert.match(pageSource, /Contact Detail/);
  assert.match(pageSource, /fulfillmentStage\(item, lane\)/);
  assert.doesNotMatch(pageSource, /digital \{item\.digitalStatus/);
});

test('completion actions state their queue consequence before mutation', () => {
  assert.match(presentationSource, /Confirm access sent/);
  assert.match(pageSource, /Only continue after access has been sent or granted outside the CRM/);
  assert.match(pageSource, /removes the item from the active Digital access queue/);
  assert.match(pageSource, /removes it from the active Pickup queue/);
  assert.match(pageSource, /removes the item from the active Shipment queue/);
  assert.match(pageSource, /open=\{Boolean\(confirmation\)\}/);
  assert.match(pageSource, /variant="dialog"/);
  assert.match(pageSource, /if \(!stage\.completion\)/);
});

test('manual digital delivery is explicit and ownership stays automatic', () => {
  assert.match(pageSource, /Manual digital delivery/);
  assert.match(pageSource, /Manual delivery requirement/);
  assert.match(pageSource, /Before confirming:/);
  assert.match(pageSource, /approved external channel/);
  assert.doesNotMatch(pageSource, /assignedUserName/);
  assert.doesNotMatch(pageSource, /UserRoundCheck/);
});

test('selected work keeps one canonical home for status, action, and privacy context', () => {
  assert.doesNotMatch(pageSource, /detailEyebrow/);
  assert.doesNotMatch(pageSource, /queueAction/);
  assert.doesNotMatch(styleSource, /\.detailEyebrow/);
  assert.doesNotMatch(styleSource, /\.queueAction/);
  assert.match(pageSource, /lane === 'pickup' && <span className=\{s\.stageBadge\}/);
  assert.doesNotMatch(pageSource, /Payment verified \{formatDateTime/);
  assert.match(pageSource, /lane === 'shipment'/);
  assert.match(pageSource, /className=\{s\.addressPrivacy\}/);
});

test('operational note is progressively disclosed in the selected work item', () => {
  assert.match(pageSource, /<details className=\{s\.noteDisclosure\}/);
  assert.match(pageSource, /Operational note/);
  assert.match(styleSource, /\.mobileDetailOpen \.queuePane/);
  assert.match(styleSource, /\.mobileDetailOpen \.detailPane/);
});
