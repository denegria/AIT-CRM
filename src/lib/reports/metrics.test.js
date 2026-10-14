import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntakeTrend, reportRate } from './metrics.js';

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
