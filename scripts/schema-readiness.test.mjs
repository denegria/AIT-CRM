import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CATALOG_FINGERPRINT_SQL,
  JOURNAL_MANIFEST_SQL,
  SQL_ONLY_INDEXES_SQL,
  SCHEMA_MANIFEST_CANONICAL_SHA256,
  canonicalManifestBytes,
  canonicalManifestSha256,
  loadSchemaManifest,
  runDrizzleExport,
  verifyDatabaseBaseline,
  verifyRepositoryBaseline,
} from './lib/schema-readiness.mjs';

const ROOT_DIR = fileURLToPath(new URL('../', import.meta.url));
let manifest;
let rawExport;

test.before(async () => {
  manifest = await loadSchemaManifest(ROOT_DIR);
  rawExport = await runDrizzleExport(ROOT_DIR);
});

function allManifestFiles(value = manifest) {
  return [
    value.repository.schema.path,
    value.repository.journal.path,
    ...value.repository.trackedJournalPrefix.flatMap((entry) => [entry.path, entry.snapshot.path]),
    ...value.repository.unjournaledBaselineSql.map((entry) => entry.path),
  ];
}

async function createRepositoryFixture(t) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ait-crm-schema-readiness-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  for (const relativePath of allManifestFiles()) {
    const target = path.join(rootDir, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(ROOT_DIR, relativePath), target);
  }
  return rootDir;
}

function expectedJournalRows(value = manifest) {
  return value.repository.trackedJournalPrefix.map((entry) => ({
    id: entry.databaseId,
    hash: entry.sha256,
    created_at: String(entry.createdAt),
  }));
}

function expectedCatalogRow(value = manifest) {
  const expected = value.database.catalog.expected;
  return {
    table_count: String(expected.tableCount),
    table_name_md5: expected.tableNameMd5,
    column_count: String(expected.columnCount),
    column_catalog_md5: expected.columnCatalogMd5,
    index_count: String(expected.indexCount),
    index_catalog_md5: expected.indexCatalogMd5,
    constraint_count: String(expected.constraintCount),
    constraint_catalog_md5: expected.constraintCatalogMd5,
  };
}

function expectedIndexRows(value = manifest) {
  return value.database.sqlOnlyIndexes.map((entry) => ({
    tablename: entry.table,
    indexname: entry.name,
    indexdef: entry.indexDefinition,
  })).sort((left, right) => left.indexname.localeCompare(right.indexname));
}

function fakeClient({ journalRows, catalogRow, indexRows } = {}) {
  return {
    async query(sql, parameters) {
      if (sql === JOURNAL_MANIFEST_SQL) return { rows: journalRows || expectedJournalRows() };
      if (sql === CATALOG_FINGERPRINT_SQL) return { rows: [catalogRow || expectedCatalogRow()] };
      if (sql === SQL_ONLY_INDEXES_SQL) {
        assert.deepEqual(parameters, [manifest.database.sqlOnlyIndexes.map((entry) => entry.name)]);
        return { rows: indexRows || expectedIndexRows() };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test('canonical manifest serialization is key-order independent and LF terminated', () => {
  const left = { beta: [3, { y: 2, x: 1 }], alpha: true };
  const right = { alpha: true, beta: [3, { x: 1, y: 2 }] };
  assert.equal(canonicalManifestSha256(left), canonicalManifestSha256(right));
  assert.equal(canonicalManifestBytes(left).at(-1), 10);
  assert.notEqual(canonicalManifestSha256(left), canonicalManifestSha256({ ...left, alpha: false }));
  assert.equal(canonicalManifestSha256(manifest), SCHEMA_MANIFEST_CANONICAL_SHA256);
});

test('pinned repository baseline and Drizzle export structure reproduce exactly', async () => {
  const report = await verifyRepositoryBaseline({
    rootDir: ROOT_DIR,
    manifest,
    exportRunner: async () => rawExport,
  });
  assert.equal(report.ok, true, report.checks.filter((check) => !check.ok).map((check) => check.detail).join('\n'));
  assert.equal(report.checks.find((check) => check.name.includes('export structure')).ok, true);
  assert.match(report.checks.find((check) => check.name.includes('unjournaled migration provenance')).detail, /13 verified journal rows; 15 explicitly unjournaled files/);
});

test('repository fixture fails clearly when a required baseline file is missing', async (t) => {
  const rootDir = await createRepositoryFixture(t);
  await fs.rm(path.join(rootDir, 'drizzle/0026_attendance_sessions.sql'));
  const report = await verifyRepositoryBaseline({ rootDir, manifest, exportRunner: async () => rawExport });
  assert.equal(report.ok, false);
  assert.match(report.checks.find((check) => check.name.includes('file sets')).detail, /missing drizzle\/0026_attendance_sessions\.sql/);
  assert.match(report.checks.find((check) => check.name.includes('bytes match')).detail, /drizzle\/0026_attendance_sessions\.sql: missing/);
});

test('repository fixture fails clearly when migration bytes or journal provenance change', async (t) => {
  const rootDir = await createRepositoryFixture(t);
  await fs.appendFile(path.join(rootDir, 'drizzle/0015_contact_archive_and_ait_usa_lifecycle.sql'), '\n-- altered\n');
  const journalPath = path.join(rootDir, 'drizzle/meta/_journal.json');
  const journal = JSON.parse(await fs.readFile(journalPath, 'utf8'));
  journal.entries[12].when += 1;
  await fs.writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);

  const report = await verifyRepositoryBaseline({ rootDir, manifest, exportRunner: async () => rawExport });
  assert.equal(report.ok, false);
  assert.match(report.checks.find((check) => check.name.includes('bytes match')).detail, /0015_contact_archive_and_ait_usa_lifecycle\.sql sha256/);
  assert.match(report.checks.find((check) => check.name.includes('exact 0000-0012 prefix')).detail, /journal\[12\]\.when/);
});

test('repository fixture rejects a new duplicate migration identifier', async (t) => {
  const rootDir = await createRepositoryFixture(t);
  await fs.writeFile(path.join(rootDir, 'drizzle/0026_duplicate.sql'), '-- duplicate\n');

  const report = await verifyRepositoryBaseline({ rootDir, manifest, exportRunner: async () => rawExport });
  assert.equal(report.ok, false);
  assert.match(report.checks.find((check) => check.name.includes('unapproved duplicates')).detail, /duplicate migration identifier 0026/);
});

test('database fixture accepts the exact catalog, journal, and SQL-only indexes', async () => {
  const report = await verifyDatabaseBaseline(fakeClient(), manifest);
  assert.equal(report.ok, true, report.checks.filter((check) => !check.ok).map((check) => check.detail).join('\n'));
  assert.equal(report.checks.length, 3);
});

test('database fixture rejects missing or altered catalog objects', async () => {
  const alteredCatalog = expectedCatalogRow();
  alteredCatalog.column_catalog_md5 = '00000000000000000000000000000000';
  const withoutSqlOnlyIndex = expectedIndexRows().slice(1);
  const report = await verifyDatabaseBaseline(fakeClient({
    catalogRow: alteredCatalog,
    indexRows: withoutSqlOnlyIndex,
  }), manifest);

  assert.equal(report.ok, false);
  assert.match(report.checks.find((check) => check.name.includes('public catalog')).detail, /catalog\.columnCatalogMd5/);
  assert.match(report.checks.find((check) => check.name.includes('SQL-only production indexes')).detail, /missing SQL-only index/);
});

test('database fixture rejects altered or fabricated journal provenance', async () => {
  const rows = expectedJournalRows();
  rows[4] = { ...rows[4], hash: 'altered' };
  rows.push({ id: 14, hash: 'fabricated', created_at: '1781000000000' });
  const report = await verifyDatabaseBaseline(fakeClient({ journalRows: rows }), manifest);

  assert.equal(report.ok, false);
  const detail = report.checks.find((check) => check.name.includes('journal matches')).detail;
  assert.match(detail, /journal row count/);
  assert.match(detail, /journal row 5/);
});
