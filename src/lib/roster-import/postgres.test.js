import assert from 'node:assert/strict';
import test from 'node:test';
import { applyRosterSection } from './postgres.js';

const scope = { organizationId: 'org', businessUnitId: 'usa' };
const action = { targetSectionId: 'new-section', idempotencyKey: 'manifest:section:1', section: {
  sectionKey: 'ENG-1', courseName: 'English', teacher: 'Ana', courseLocation: 'Bound Brook',
  modality: 'in person', classDays: 'Monday, Wednesday', classTime: '9:00 AM - 10:00 AM',
  scheduledDaysPerWeek: 2,
} };

function clientWith(responses) {
  const calls = [];
  return { calls, async query(sql, values) {
    calls.push({ sql, values });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected query: ${sql}`);
    return { rows: next };
  } };
}

test('new imported section gets a same-day New York version in the apply transaction', async () => {
  const client = clientWith([[{ id: 'new-section' }], []]);
  assert.equal(await applyRosterSection(client, scope, action), 'new-section');
  assert.match(client.calls[0].sql, /on conflict .* do nothing/i);
  assert.doesNotMatch(client.calls[0].sql, /do update/i);
  assert.match(client.calls[1].sql, /insert into class_section_versions/i);
  assert.match(client.calls[1].sql, /America\/New_York/);
  assert.match(client.calls[1].sql, /roster_import_created/);
  assert.deepEqual(client.calls[1].values, ['new-section', action.idempotencyKey, 'org', 'usa']);
});

test('re-import of unchanged section preserves both base and version history', async () => {
  const existing = { id: 'original-section', course_name: 'English', teacher: 'Ana',
    course_location: 'Bound Brook', modality: 'in_person', schedule_days_json: ['Monday', 'Wednesday'],
    start_time: '09:00', end_time: '10:00', scheduled_days_per_week: 2, status: 'active' };
  const client = clientWith([[], [existing], [{ id: 'version-1' }]]);
  assert.equal(await applyRosterSection(client, scope, { ...action, targetSectionId: 'original-section' }), 'original-section');
  assert.match(client.calls[1].sql, /for update/i);
  assert.match(client.calls[2].sql, /class_section_versions/i);
  assert.equal(client.calls.length, 3);
});

test('changed re-import fails closed without updating the base or version', async () => {
  const existing = { id: 'original-section', course_name: 'English', teacher: 'Different teacher',
    course_location: 'Bound Brook', modality: 'in_person', schedule_days_json: ['Monday', 'Wednesday'],
    start_time: '09:00', end_time: '10:00', scheduled_days_per_week: 2, status: 'active' };
  const client = clientWith([[], [existing], [{ id: 'version-1' }]]);
  await assert.rejects(applyRosterSection(client, scope, { ...action, targetSectionId: 'original-section' }), /managed effective-dated change/);
  assert.equal(client.calls.length, 3);
  assert.doesNotMatch(client.calls[0].sql, /do update/i);
});

test('existing section without effective-dated history cannot be silently accepted', async () => {
  const client = clientWith([[], [{ id: 'original-section' }], []]);
  await assert.rejects(applyRosterSection(client, scope, { ...action, targetSectionId: 'original-section' }), /no effective-dated version/);
});


test('stale plan cannot attach course actions to a newly claimed section key', async () => {
  const client = clientWith([[], [{ id: 'different-section' }]]);
  await assert.rejects(applyRosterSection(client, scope, action), /changed identity since planning/);
  assert.equal(client.calls.length, 2);
});
