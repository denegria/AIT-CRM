import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pageSource = await readFile(new URL('./page.js', import.meta.url), 'utf8');

test('Recovery Queue preserves lane, page, and division scope in its URLs', () => {
  assert.match(pageSource, /new URLSearchParams\(\{ lane, page: String\(page\) \}\)/);
  assert.match(pageSource, /params\.set\('businessUnitId', businessUnitId\)/);
  assert.match(pageSource, /pageSize: String\(PAGE_SIZE\)/);
});

test('Recovery Queue opens exact tasks and routes duplicates to filtered review', () => {
  assert.match(pageSource, /if \(item\.task\?\.id\) return `\/tasks\/\$\{encodeURIComponent\(item\.task\.id\)\}`/);
  assert.match(pageSource, /taskType=follow_up&status=open/);
  assert.match(pageSource, /href=\{itemHref\(item\)\} prefetch=\{false\}/);
  assert.doesNotMatch(pageSource, /method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/);
});
