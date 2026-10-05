import assert from 'node:assert/strict';
import test from 'node:test';
import { followUpDueInputToIso } from './follow-up-due-input.js';

test('optional follow-up time converts browser-local wall time to UTC and preserves date-only behavior', () => {
  assert.equal(followUpDueInputToIso('', ''), null);
  assert.equal(followUpDueInputToIso('2026-06-04', ''), new Date('2026-06-04T09:00').toISOString());
  assert.equal(followUpDueInputToIso('2026-06-04', '14:30'), new Date('2026-06-04T14:30').toISOString());
});

test('DST gaps and repeated local times are rejected instead of silently shifted', () => {
  const original = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    assert.equal(followUpDueInputToIso('2026-07-04', '14:30'), '2026-07-04T18:30:00.000Z');
    assert.throws(() => followUpDueInputToIso('2026-03-08', '02:30'), /does not exist/);
    assert.throws(() => followUpDueInputToIso('2026-11-01', '01:30'), /occurs twice/);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
