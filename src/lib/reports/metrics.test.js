import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntakeTrend, detailRowsForSelection, reportRate } from './metrics.js';

test('report analytics uses bounded zero-filled intake buckets from canonical lead dates', () => {
  const trend = buildIntakeTrend([
    { leadDate: '2026-01-02T12:00:00.000Z', contacted: true, enrolled: false },
    { leadDate: '2026-01-20T12:00:00.000Z', contacted: false, enrolled: true },
  ], { from: new Date('2026-01-01T00:00:00.000Z'), to: new Date('2026-01-31T23:59:59.999Z') });
  assert.equal(trend.unit, 'day');
  assert.equal(trend.buckets.length, 31);
  assert.equal(trend.buckets[1].incoming, 1);
  assert.equal(trend.buckets[2].contacted, 0);
  assert.equal(trend.buckets[19].enrolled, 1);
});

test('report rate keeps unsupported denominators explicit to callers', () => {
  assert.equal(reportRate(19, 2369), 0.8);
  assert.equal(reportRate(19, 0), 0);
});

test('trend buckets carry their unit so weekly and monthly details reconcile', () => {
  const weeklyRows = [{ id: 'weekly', leadDate: '2026-02-15T12:00:00.000Z', contacted: false, enrolled: false }];
  const weekly = buildIntakeTrend(weeklyRows, { from: new Date('2026-01-01T00:00:00.000Z'), to: new Date('2026-03-31T23:59:59.999Z') });
  const weeklyBucket = weekly.buckets.find((candidate) => candidate.key === '2026-02-09');
  assert.equal(weekly.unit, 'week');
  assert.equal(weeklyBucket.unit, weekly.unit);
  assert.equal(detailRowsForSelection(weeklyRows, { detailType: 'trend', detailKey: weeklyBucket.key, detailUnit: weeklyBucket.unit }).length, weeklyBucket.incoming);
  const monthRows = [{ id: 'monthly', leadDate: '2026-02-15T12:00:00.000Z', contacted: false, enrolled: false }];
  const monthly = buildIntakeTrend(monthRows, { from: new Date('2026-01-01T00:00:00.000Z'), to: new Date('2027-01-01T23:59:59.999Z') });
  const bucket = monthly.buckets.find((candidate) => candidate.key === '2026-02-01');
  assert.equal(monthly.unit, 'month');
  assert.equal(bucket.unit, monthly.unit);
  assert.equal(bucket.incoming, 1);
  assert.equal(detailRowsForSelection(monthRows, { detailType: 'trend', detailKey: bucket.key, detailUnit: bucket.unit }).length, bucket.incoming);
});

test('long intake ranges retain every cohort row with adaptive buckets', () => {
  const rows = [
    { leadDate: '2018-02-01T12:00:00.000Z', contacted: false, enrolled: false },
    { leadDate: '2020-08-11T12:00:00.000Z', contacted: true, enrolled: false },
    { leadDate: '2026-10-14T12:00:00.000Z', contacted: true, enrolled: true },
  ];
  const trend = buildIntakeTrend(rows, { from: new Date('2018-01-01T00:00:00.000Z'), to: new Date('2026-12-31T23:59:59.999Z') });
  assert.equal(trend.unit, 'year');
  assert.ok(trend.buckets.length <= 30);
  assert.equal(trend.buckets.reduce((sum, bucket) => sum + bucket.incoming, 0), rows.length);
  assert.equal(trend.buckets.reduce((sum, bucket) => sum + bucket.contacted, 0), 2);
});
