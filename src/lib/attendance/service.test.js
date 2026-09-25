import assert from 'node:assert/strict';
import test from 'node:test';
import { listAttendanceClasses } from './service.js';

function classListDb(rows) {
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ orderBy: async () => rows }),
        }),
      }),
    }),
  };
}

test('next-class guidance uses only authorized AIT USA schedules', async () => {
  const rows = [
    { businessUnitId: 'authorized', businessUnitName: 'AIT USA Institute', scheduleDaysJson: ['Wednesday'] },
    { businessUnitId: 'other', businessUnitName: 'AIT USA Institute', scheduleDaysJson: ['Friday'] },
    { businessUnitId: 'authorized', businessUnitName: 'AIT Signs', scheduleDaysJson: ['Friday'] },
  ];
  const session = { user: { organizationId: 'org', businessUnitIds: ['authorized'] } };
  const result = await listAttendanceClasses({ db: classListDb(rows), session, date: '2026-09-24' });
  assert.deepEqual(result, {
    date: '2026-09-24',
    classes: [],
    hasActiveSchedules: true,
    nextScheduledDate: '2026-09-30',
  });

  const noAccess = await listAttendanceClasses({
    db: classListDb(rows),
    session: { user: { organizationId: 'org', businessUnitIds: [] } },
    date: '2026-09-24',
  });
  assert.equal(noAccess.hasActiveSchedules, false);
  assert.equal(noAccess.nextScheduledDate, null);
});
