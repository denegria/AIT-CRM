import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRecoveryQueuePayload,
  normalizeRecoveryQueueRequest,
} from './model.js';

function row(lane, id, overrides = {}) {
  return {
    lane,
    item_key: `${lane}:${id}`,
    reason: `${lane} reason`,
    contact_id: `contact-${id}`,
    contact_name: `Contact ${id}`,
    lead_id: `lead-${id}`,
    lead_status: 'Follow Up',
    age_days: id,
    ...overrides,
  };
}

test('regular Coordinator queue hides the unassigned lane and rows', () => {
  const payload = buildRecoveryQueuePayload([
    row('first_contact', 1),
    row('unassigned', 2),
    row('overdue', 3, { task_id: 'task-3' }),
  ], {
    lane: 'unassigned',
    canViewUnassigned: false,
  });

  assert.equal(payload.lane, 'first_contact');
  assert.deepEqual(payload.lanes.map((lane) => lane.key), [
    'first_contact',
    'overdue',
    'no_commitment',
    'duplicate_follow_up',
  ]);
  assert.equal(payload.lanes.find((lane) => lane.key === 'first_contact').count, 1);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].key, 'first_contact:1');
});

test('Senior queue counts every visible row and paginates the selected lane exactly', () => {
  const rows = [
    row('unassigned', 1),
    row('unassigned', 2),
    row('unassigned', 3),
    row('no_commitment', 4),
  ];
  const payload = buildRecoveryQueuePayload(rows, {
    lane: 'unassigned',
    page: 2,
    pageSize: 2,
    canViewUnassigned: true,
  });

  assert.equal(payload.lanes.find((lane) => lane.key === 'unassigned').count, 3);
  assert.deepEqual(payload.pagination, { page: 2, pageSize: 2, total: 3, totalPages: 2 });
  assert.deepEqual(payload.items.map((item) => item.key), ['unassigned:3']);
});

test('normalized Senior request keeps unassigned access when payload construction normalizes again', () => {
  const request = normalizeRecoveryQueueRequest({
    lane: 'unassigned',
    canViewUnassigned: true,
  });
  const payload = buildRecoveryQueuePayload(
    [row('unassigned', 1)],
    request,
    { unassigned: 1 },
  );

  assert.equal(request.canViewUnassigned, true);
  assert.equal(payload.lane, 'unassigned');
  assert.equal(payload.lanes.find((lane) => lane.key === 'unassigned').count, 1);
  assert.deepEqual(payload.items.map((item) => item.key), ['unassigned:1']);
});

test('queue request bounds invalid lanes and page sizes', () => {
  const request = normalizeRecoveryQueueRequest({ lane: 'made_up', page: '-4', pageSize: 500, canViewUnassigned: true });
  assert.equal(request.lane, 'first_contact');
  assert.equal(request.page, 1);
  assert.equal(request.pageSize, 100);
  assert.equal(request.canViewUnassigned, true);
  assert.ok(Array.isArray(request.lanes));
});
