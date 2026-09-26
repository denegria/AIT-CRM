import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pageSource = await readFile(new URL('./page.js', import.meta.url), 'utf8');

test('Recovery Queue preserves lane, page, and division scope in its URLs', () => {
  assert.match(pageSource, /new URLSearchParams\(\{ lane, page: String\(page\) \}\)/);
  assert.match(pageSource, /params\.set\('businessUnitId', businessUnitId\)/);
  assert.match(pageSource, /pageSize: String\(PAGE_SIZE\)/);
});

test('Recovery Queue opens exact tasks without invoking the create-task contactId route', () => {
  assert.match(pageSource, /item\.lane === 'overdue' && item\.task\?\.id/);
  assert.match(pageSource, /item\.relatedTasks\.map\(\(task\) =>/);
  assert.match(pageSource, /href=\{`\/tasks\/\$\{encodeURIComponent\(task\.id\)\}`\}/);
  assert.doesNotMatch(pageSource, /\/tasks\?contactId=/);
  assert.match(pageSource, /action=assign-inquiry-owner/);
  assert.doesNotMatch(pageSource, /method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/);
});
