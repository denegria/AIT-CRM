import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const pageSource = fs.readFileSync(new URL('./page.js', import.meta.url), 'utf8');
const tableSource = fs.readFileSync(new URL('../../components/DataTable.js', import.meta.url), 'utf8');
const loaderSource = fs.readFileSync(new URL('../../lib/contacts/directory-loader.js', import.meta.url), 'utf8');
const serviceSource = fs.readFileSync(new URL('../../lib/contact-directory/service.js', import.meta.url), 'utf8');

test('Contacts delegates header sorting to the deferred server directory', () => {
  assert.match(pageSource, /sortKey=\{contactDirectoryIsDeferred \? directorySort\.key : undefined\}/);
  assert.match(pageSource, /sortDirection=\{contactDirectoryIsDeferred \? directorySort\.direction : undefined\}/);
  assert.match(pageSource, /onSortChange=\{contactDirectoryIsDeferred \? setDirectorySort : undefined\}/);
  assert.match(pageSource, /params\.set\('sort', nextSort\.key\);\s+params\.set\('direction', nextSort\.direction\);/s);
  assert.match(pageSource, /preservedDirectorySort\.key/);
});

test('controlled DataTable sorting does not reorder the loaded page locally', () => {
  assert.match(tableSource, /const controlledSort = typeof onSortChange === 'function';/);
  assert.match(tableSource, /if \(!controlledSort && sortKey\) \{/);
  assert.match(tableSource, /onSortChange\(\{ key, direction \}\);/);
  assert.match(tableSource, /aria-sort=\{sortKey === c\.key/);
});

test('directory requests carry route kind, sort state, and page without broad client hydration', () => {
  assert.match(loaderSource, /params\.set\('view', 'directory'\);/);
  assert.match(loaderSource, /params\.set\('page', String\(page\)\);/);
  assert.match(loaderSource, /params\.set\('pageSize', '50'\);/);
  assert.match(loaderSource, /params\.set\('directoryKind', directoryKind\);/);
});

test('server ordering happens before pagination with stable id ties', () => {
  const orderIndex = serviceSource.indexOf('.orderBy(...contactDirectoryOrderBy({ sort, latestLead, businessUnitRows, touchAggregates }))');
  const limitIndex = serviceSource.indexOf('.limit(pageSize)', orderIndex);
  const offsetIndex = serviceSource.indexOf('.offset(offset)', limitIndex);
  assert.ok(orderIndex >= 0, 'server orderBy is present');
  assert.ok(limitIndex > orderIndex, 'limit follows server orderBy');
  assert.ok(offsetIndex > limitIndex, 'offset follows limit');
  assert.match(serviceSource, /return \[orderedExpression, asc\(contacts\.id\)\];/);
  assert.match(serviceSource, /desc nulls last/);
  assert.match(serviceSource, /asc nulls last/);
});

test('Last Touch joins only the current touch aggregate shape', () => {
  assert.match(serviceSource, /touchAggregates\.messages/);
  assert.match(serviceSource, /touchAggregates\.activities/);
  assert.doesNotMatch(serviceSource, /touchAggregates\.followUpNotes/);
});
