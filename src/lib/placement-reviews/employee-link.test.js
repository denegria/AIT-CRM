import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAitUsaEmployeeReviewUrl } from './employee-link.js';

test('resolves only a HTTPS base and one opaque AIT USA employee review parameter', () => {
  assert.equal(
    resolveAitUsaEmployeeReviewUrl({
      employeeBaseUrl: 'https://staging.aitusa.example',
      employeeUrl: '/employee/placement-reviews?review=opaque-review-01',
    }),
    'https://staging.aitusa.example/employee/placement-reviews?review=opaque-review-01',
  );
});

test('rejects non-HTTPS, secret-bearing bases and employee paths with PII or extra query data', () => {
  const validPath = '/employee/placement-reviews?review=opaque-review-01';
  assert.equal(resolveAitUsaEmployeeReviewUrl({ employeeBaseUrl: 'http://aitusa.example', employeeUrl: validPath }), null);
  assert.equal(resolveAitUsaEmployeeReviewUrl({ employeeBaseUrl: 'https://aitusa.example?token=never', employeeUrl: validPath }), null);
  assert.equal(resolveAitUsaEmployeeReviewUrl({ employeeBaseUrl: 'https://aitusa.example', employeeUrl: '/employee/placement-reviews?review=opaque-review-01&email=never@example.com' }), null);
  assert.equal(resolveAitUsaEmployeeReviewUrl({ employeeBaseUrl: 'https://aitusa.example', employeeUrl: '/employee/placement-reviews?review=learner@example.com' }), null);
});
