import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell } from '../../../lib/reports/metrics.js';

test('report CSV escapes formula-leading values and quotes cells', () => {
  assert.equal(csvCell('=HYPERLINK("https://example.test")'), '"\'=HYPERLINK(""https://example.test"")"');
  assert.equal(csvCell('Lead, Jr.'), '"Lead, Jr."');
});
