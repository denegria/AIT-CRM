import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntakeTrend, detailRowsForSelection, reportRate, summarizeReportRows } from './metrics.js';

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
  assert.equal(reportRate(19, 0), null);
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

const row = (overrides = {}) => ({
  contacted: false,
  enrolled: false,
  enrollmentSupported: true,
  contactEvidenceAvailable: true,
  ...overrides,
});

test('contacted enrollment is the supported intersection, not all enrollments', () => {
  const summary = summarizeReportRows([
    row({ contacted: true, enrolled: true }),
    row({ contacted: true }),
    row({ enrolled: true }),
    row({ contacted: true, enrolled: true, enrollmentSupported: false }),
  ], true);
  assert.equal(summary.contactedEnrolled, 1);
  assert.equal(summary.contactedEnrollmentEligible, 2);
  assert.equal(summary.contactedEnrollmentRate, 50);

  const selected = [
    { ...row({ contacted: true, enrolled: true }), id: 'yes' },
    { ...row({ enrolled: true }), id: 'no-contact' },
    { ...row({ contacted: true, enrolled: true, enrollmentSupported: false }), id: 'unsupported' },
  ];
  assert.deepEqual(
    detailRowsForSelection(selected, { detailType: 'metric', detailKey: 'contacted-enrolled' }).map(({ id }) => id),
    ['yes'],
  );
});

test('zero denominators are explicitly unavailable', () => {
  assert.equal(reportRate(0, 0), null);
  const summary = summarizeReportRows([], false);
  assert.equal(summary.contactedEnrollmentRate, null);
  assert.equal(summary.contactRate, null);
  assert.equal(summary.enrollmentRate, null);
});

test('mixed or unsupported scope keeps enrollment comparisons unavailable', () => {
  const summary = summarizeReportRows([
    row({ enrolled: true }),
    row({ enrolled: true, enrollmentSupported: false }),
  ], false);
  assert.equal(summary.enrollmentRate, null);
  assert.equal(summary.contactedEnrollmentRate, null);
});
