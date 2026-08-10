import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA_BASELINE_ID = 'ait-crm-reconciled-2026-08-10';
export const SCHEMA_BASELINE_SOURCE_COMMIT = '33018dcfa55497a0c74f3217f9938c91db35c20a';
export const SCHEMA_BASELINE_EVIDENCE_SHA256 = '8603737cade4aec086b06f137d77f69db6c04c873971e0efa1f79f4062ffa384';
export const SCHEMA_EXPORT_RAW_STDOUT_SHA256 = '0336c9507c380e03d8ab53d4e00c17f528bb3f9068308193493caf5115eedf25';
export const SCHEMA_MANIFEST_CANONICAL_SHA256 = 'ecd129516f4c87bb8815a76bfc6197b854848cd73cd49cd8b32067417a1bd1fe';
export const SCHEMA_MANIFEST_RELATIVE_PATH = 'drizzle/reconciled-schema-manifest.json';

export const CATALOG_FINGERPRINT_SQL = `
select
  (select count(*)::integer from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') as table_count,
  (select md5(string_agg(table_name, E'\\n' order by table_name)) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') as table_name_md5,
  (select count(*)::integer from information_schema.columns where table_schema = 'public') as column_count,
  (
    select md5(string_agg(concat_ws('|', table_name, ordinal_position, column_name, data_type, udt_name, is_nullable, coalesce(column_default, '')), E'\\n' order by table_name, ordinal_position))
    from information_schema.columns
    where table_schema = 'public'
  ) as column_catalog_md5,
  (select count(*)::integer from pg_indexes where schemaname = 'public') as index_count,
  (
    select md5(string_agg(concat_ws('|', tablename, indexname, indexdef), E'\\n' order by tablename, indexname))
    from pg_indexes
    where schemaname = 'public'
  ) as index_catalog_md5,
  (
    select count(*)::integer
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public'
  ) as constraint_count,
  (
    select md5(string_agg(concat_ws('|', c.conrelid::regclass::text, c.conname, c.contype, pg_get_constraintdef(c.oid, true)), E'\\n' order by c.conrelid::regclass::text, c.conname))
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public'
  ) as constraint_catalog_md5
`;

export const JOURNAL_MANIFEST_SQL = `
select id, hash, created_at
from drizzle.__drizzle_migrations
order by id
`;

export const SQL_ONLY_INDEXES_SQL = `
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public' and indexname = any($1::text[])
order by indexname
`;

const defaultRootDir = fileURLToPath(new URL('../../', import.meta.url));

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

export function canonicalManifestBytes(manifest) {
  return Buffer.from(`${JSON.stringify(canonicalValue(manifest))}\n`, 'utf8');
}

export function canonicalManifestSha256(manifest) {
  return sha256(canonicalManifestBytes(manifest));
}

export async function loadSchemaManifest(rootDir = defaultRootDir) {
  const manifestPath = path.join(rootDir, SCHEMA_MANIFEST_RELATIVE_PATH);
  return JSON.parse(await fs.readFile(manifestPath, 'utf8'));
}

export async function runDrizzleExport(rootDir = defaultRootDir) {
  const executable = path.join(rootDir, 'node_modules', '.bin', 'drizzle-kit');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['export', '--config', 'drizzle.config.mjs'], {
      cwd: rootDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const maxBytes = 16 * 1024 * 1024;

    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBytes) {
        child.kill();
        reject(new Error('drizzle-kit export exceeded the 16 MiB stdout limit'));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= maxBytes) stderr.push(chunk);
    });
    child.on('error', (error) => {
      reject(new Error(`unable to run drizzle-kit export: ${error.message}`));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString('utf8').trim();
        reject(new Error(`drizzle-kit export exited with ${code}${detail ? `: ${detail}` : ''}`));
        return;
      }
      resolve(Buffer.concat(stdout));
    });
  });
}

export function analyzeDrizzleExport(rawExport) {
  const sql = Buffer.isBuffer(rawExport) ? rawExport.toString('utf8') : String(rawExport);
  return {
    tableCount: (sql.match(/CREATE TABLE /g) || []).length,
    explicitIndexCount: (sql.match(/CREATE (?:UNIQUE )?INDEX /g) || []).length,
    foreignKeyCount: (sql.match(/FOREIGN KEY/g) || []).length,
    checkConstraintCount: (sql.match(/ CHECK \(/g) || []).length,
  };
}

function compareValue(label, expected, actual, errors) {
  if (expected !== actual) errors.push(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

function formatErrors(errors, successDetail) {
  return errors.length ? errors.join('; ') : successDetail;
}

async function digestFile(rootDir, relativePath) {
  try {
    return { digest: sha256(await fs.readFile(path.join(rootDir, relativePath))) };
  } catch (error) {
    return { error: `${relativePath}: ${error.code === 'ENOENT' ? 'missing' : error.message}` };
  }
}

async function listFiles(rootDir, relativeDir, matcher) {
  try {
    return (await fs.readdir(path.join(rootDir, relativeDir), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && matcher(entry.name))
      .map((entry) => path.posix.join(relativeDir, entry.name))
      .sort();
  } catch (error) {
    return { error: `${relativeDir}: ${error.code === 'ENOENT' ? 'missing' : error.message}` };
  }
}

function comparePathSets(label, expected, actual, errors) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((item) => !actualSet.has(item));
  const unexpected = actual.filter((item) => !expectedSet.has(item));
  if (missing.length) errors.push(`${label} missing ${missing.join(', ')}`);
  if (unexpected.length) errors.push(`${label} unexpected ${unexpected.join(', ')}`);
}

function migrationIdentifier(relativePath) {
  const match = path.posix.basename(relativePath).match(/^(\d{4})_[a-z0-9_]+\.sql$/);
  return match?.[1] || null;
}

function verifyDuplicateMigrationIdentifiers(sqlPaths, manifest) {
  const errors = [];
  const groups = new Map();
  for (const migrationPath of sqlPaths) {
    const identifier = migrationIdentifier(migrationPath);
    if (!identifier) {
      errors.push(`invalid migration filename ${migrationPath}`);
      continue;
    }
    groups.set(identifier, [...(groups.get(identifier) || []), migrationPath].sort());
  }

  const allowed = new Map(
    manifest.repository.legacyDuplicateMigrationIds.map((entry) => [entry.identifier, [...entry.paths].sort()]),
  );
  for (const [identifier, paths] of groups) {
    if (paths.length < 2) continue;
    const expectedPaths = allowed.get(identifier);
    if (!expectedPaths || JSON.stringify(expectedPaths) !== JSON.stringify(paths)) {
      errors.push(`duplicate migration identifier ${identifier}: ${paths.join(', ')}`);
    }
  }
  for (const [identifier, expectedPaths] of allowed) {
    const actualPaths = groups.get(identifier) || [];
    if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) {
      errors.push(`reconciled legacy duplicate ${identifier} changed: expected ${expectedPaths.join(', ')}, received ${actualPaths.join(', ') || '(none)'}`);
    }
  }
  return errors;
}

function validateManifestContract(manifest) {
  const errors = [];
  compareValue('formatVersion', 1, manifest.formatVersion, errors);
  compareValue('baselineId', SCHEMA_BASELINE_ID, manifest.baselineId, errors);
  compareValue('source.repositoryCommit', SCHEMA_BASELINE_SOURCE_COMMIT, manifest.source?.repositoryCommit, errors);
  compareValue('source.acceptedEvidenceSha256', SCHEMA_BASELINE_EVIDENCE_SHA256, manifest.source?.acceptedEvidenceSha256, errors);
  compareValue('serialization.canonicalManifest', 'recursive-key-sort-json-utf8-lf-v1', manifest.serialization?.canonicalManifest, errors);
  compareValue('serialization.fileDigest', 'sha256-raw-bytes-v1', manifest.serialization?.fileDigest, errors);
  compareValue('serialization.drizzleExport', 'sha256-raw-stdout-including-final-newline-v1', manifest.serialization?.drizzleExport, errors);
  compareValue('canonical manifest sha256', SCHEMA_MANIFEST_CANONICAL_SHA256, canonicalManifestSha256(manifest), errors);
  compareValue('repository.drizzleExport.rawStdoutSha256', SCHEMA_EXPORT_RAW_STDOUT_SHA256, manifest.repository?.drizzleExport?.rawStdoutSha256, errors);
  compareValue('database.catalog.contract', 'postgres-public-catalog-lf-pipe-v1', manifest.database?.catalog?.contract, errors);
  compareValue('repository.unjournaledBaselineSql.length', 15, manifest.repository?.unjournaledBaselineSql?.length, errors);
  compareValue('repository.drizzleMutation.allowed', false, manifest.repository?.drizzleMutation?.allowed, errors);
  compareValue('repository.drizzleMutation.blockedOperations', JSON.stringify(['generate', 'migrate', 'push']), JSON.stringify(manifest.repository?.drizzleMutation?.blockedOperations), errors);
  compareValue('repository.reconstructedBaseline.historicalProvenance', false, manifest.repository?.reconstructedBaseline?.historicalProvenance, errors);
  compareValue('repository.reconstructedBaseline.transaction', 'single-transaction-always-rollback', manifest.repository?.reconstructedBaseline?.transaction, errors);
  return errors;
}

export async function verifyRepositoryBaseline({
  rootDir = defaultRootDir,
  manifest,
  exportRunner = runDrizzleExport,
} = {}) {
  const resolvedManifest = manifest || await loadSchemaManifest(rootDir);
  const checks = [];

  const contractErrors = validateManifestContract(resolvedManifest);
  checks.push({
    name: 'schema manifest contract is pinned to accepted MIS-379 evidence',
    ok: contractErrors.length === 0,
    detail: formatErrors(contractErrors, `baseline=${resolvedManifest.baselineId}`),
  });

  const tracked = resolvedManifest.repository.trackedJournalPrefix;
  const unjournaled = resolvedManifest.repository.unjournaledBaselineSql;
  const expectedSqlPaths = [...tracked.map((entry) => entry.path), ...unjournaled.map((entry) => entry.path)].sort();
  const expectedSnapshotPaths = tracked.map((entry) => entry.snapshot.path).sort();
  const actualSqlPaths = await listFiles(rootDir, 'drizzle', (name) => name.endsWith('.sql'));
  const actualSnapshotPaths = await listFiles(rootDir, 'drizzle/meta', (name) => name.endsWith('_snapshot.json'));

  const setErrors = [];
  if (Array.isArray(actualSqlPaths)) comparePathSets('migration SQL set', expectedSqlPaths, actualSqlPaths, setErrors);
  else setErrors.push(actualSqlPaths.error);
  if (Array.isArray(actualSnapshotPaths)) comparePathSets('snapshot set', expectedSnapshotPaths, actualSnapshotPaths, setErrors);
  else setErrors.push(actualSnapshotPaths.error);
  checks.push({
    name: 'migration and snapshot file sets match the reconciled baseline',
    ok: setErrors.length === 0,
    detail: formatErrors(setErrors, `${expectedSqlPaths.length} SQL files; ${expectedSnapshotPaths.length} snapshots`),
  });

  const reconstructedOrderErrors = [];
  comparePathSets(
    'reconstructed baseline apply order',
    expectedSqlPaths,
    [...resolvedManifest.repository.reconstructedBaseline.applyOrder].sort(),
    reconstructedOrderErrors,
  );
  compareValue(
    'reconstructed baseline apply order length',
    expectedSqlPaths.length,
    resolvedManifest.repository.reconstructedBaseline.applyOrder.length,
    reconstructedOrderErrors,
  );
  checks.push({
    name: 'disposable-target reconstruction order covers the exact baseline once',
    ok: reconstructedOrderErrors.length === 0,
    detail: formatErrors(reconstructedOrderErrors, `${expectedSqlPaths.length} validation-only SQL inputs; not historical provenance`),
  });

  const duplicateErrors = Array.isArray(actualSqlPaths)
    ? verifyDuplicateMigrationIdentifiers(actualSqlPaths, resolvedManifest)
    : [actualSqlPaths.error];
  checks.push({
    name: 'migration identifiers contain no unapproved duplicates',
    ok: duplicateErrors.length === 0,
    detail: formatErrors(duplicateErrors, 'known 0016 collision is pinned by exact paths and hashes; no other duplicates'),
  });

  const fileEntries = [
    resolvedManifest.repository.schema,
    resolvedManifest.repository.journal,
    ...tracked.flatMap((entry) => [entry, entry.snapshot]),
    ...unjournaled,
  ];
  const digestErrors = [];
  for (const entry of fileEntries) {
    const result = await digestFile(rootDir, entry.path);
    if (result.error) digestErrors.push(result.error);
    else compareValue(`${entry.path} sha256`, entry.sha256, result.digest, digestErrors);
  }
  checks.push({
    name: 'schema, journal, migration, and snapshot bytes match the manifest',
    ok: digestErrors.length === 0,
    detail: formatErrors(digestErrors, `${fileEntries.length} pinned files`),
  });

  const provenanceErrors = [];
  for (const entry of tracked) {
    compareValue(`${entry.path} provenance`, 'verified-production-journal', entry.provenance, provenanceErrors);
    compareValue(`${entry.path} databaseId`, entry.journalIndex + 1, entry.databaseId, provenanceErrors);
    compareValue(`${entry.path} tag`, path.posix.basename(entry.path, '.sql'), entry.tag, provenanceErrors);
  }
  for (const entry of unjournaled) {
    compareValue(`${entry.path} provenance`, 'repository-sql-baseline-only', entry.provenance, provenanceErrors);
    compareValue(`${entry.path} journaled`, false, entry.journaled, provenanceErrors);
  }
  compareValue('repository.futureMigrationMinimum', 27, resolvedManifest.repository.futureMigrationMinimum, provenanceErrors);
  checks.push({
    name: 'tracked and unjournaled migration provenance remains explicit',
    ok: provenanceErrors.length === 0,
    detail: formatErrors(provenanceErrors, `${tracked.length} verified journal rows; ${unjournaled.length} explicitly unjournaled files`),
  });

  const journalErrors = [];
  try {
    const journal = JSON.parse(await fs.readFile(path.join(rootDir, resolvedManifest.repository.journal.path), 'utf8'));
    compareValue('journal entry count', tracked.length, journal.entries?.length, journalErrors);
    for (let index = 0; index < tracked.length; index += 1) {
      const expected = tracked[index];
      const actual = journal.entries?.[index];
      if (!actual) continue;
      compareValue(`journal[${index}].idx`, expected.journalIndex, actual.idx, journalErrors);
      compareValue(`journal[${index}].version`, expected.journalVersion, actual.version, journalErrors);
      compareValue(`journal[${index}].when`, expected.createdAt, actual.when, journalErrors);
      compareValue(`journal[${index}].tag`, expected.tag, actual.tag, journalErrors);
      compareValue(`journal[${index}].breakpoints`, true, actual.breakpoints, journalErrors);
    }
    const journalTags = new Set(journal.entries?.map((entry) => entry.tag) || []);
    const fabricated = unjournaled.filter((entry) => journalTags.has(path.posix.basename(entry.path, '.sql')));
    if (fabricated.length) journalErrors.push(`unjournaled baseline appeared in journal: ${fabricated.map((entry) => entry.path).join(', ')}`);
  } catch (error) {
    journalErrors.push(`journal parse failed: ${error.message}`);
  }
  checks.push({
    name: 'Drizzle journal metadata matches the exact 0000-0012 prefix',
    ok: journalErrors.length === 0,
    detail: formatErrors(journalErrors, `${tracked.length} exact entries ending at ${tracked.at(-1)?.tag}`),
  });

  const exportErrors = [];
  let rawExport = Buffer.alloc(0);
  try {
    rawExport = await exportRunner(rootDir);
    if (!Buffer.isBuffer(rawExport)) rawExport = Buffer.from(rawExport);
    compareValue('Drizzle raw stdout sha256', resolvedManifest.repository.drizzleExport.rawStdoutSha256, sha256(rawExport), exportErrors);
  } catch (error) {
    exportErrors.push(error.message);
  }
  checks.push({
    name: 'Drizzle schema-from-empty export reproduces the raw stdout fingerprint',
    ok: exportErrors.length === 0,
    detail: formatErrors(exportErrors, resolvedManifest.repository.drizzleExport.rawStdoutSha256),
  });

  const structureErrors = [];
  const exportShape = analyzeDrizzleExport(rawExport);
  for (const [key, expected] of Object.entries(resolvedManifest.repository.drizzleExport.structure)) {
    compareValue(`Drizzle export ${key}`, expected, exportShape[key], structureErrors);
  }
  checks.push({
    name: 'Drizzle export structure matches the expected schema declaration',
    ok: structureErrors.length === 0,
    detail: formatErrors(structureErrors, Object.entries(exportShape).map(([key, value]) => `${key}=${value}`).join(', ')),
  });

  const sqlOnlyErrors = [];
  const exportText = rawExport.toString('utf8');
  for (const expectedIndex of resolvedManifest.database.sqlOnlyIndexes) {
    if (exportText.includes(expectedIndex.name)) {
      sqlOnlyErrors.push(`${expectedIndex.name} unexpectedly appeared in the Drizzle export; review baseline classification`);
    }
    try {
      const sourceSql = await fs.readFile(path.join(rootDir, expectedIndex.sourcePath), 'utf8');
      if (!sourceSql.includes(`\"${expectedIndex.name}\"`)) {
        sqlOnlyErrors.push(`${expectedIndex.name} is missing from ${expectedIndex.sourcePath}`);
      }
    } catch (error) {
      sqlOnlyErrors.push(`${expectedIndex.sourcePath}: ${error.code === 'ENOENT' ? 'missing' : error.message}`);
    }
  }
  checks.push({
    name: 'SQL-only production indexes remain explicit reconciliation inputs',
    ok: sqlOnlyErrors.length === 0,
    detail: formatErrors(sqlOnlyErrors, resolvedManifest.database.sqlOnlyIndexes.map((entry) => entry.name).join(', ')),
  });

  return {
    ok: checks.every((check) => check.ok),
    manifest: resolvedManifest,
    manifestSha256: canonicalManifestSha256(resolvedManifest),
    checks,
  };
}

function normalizedCatalogRow(row = {}) {
  return {
    tableCount: Number(row.table_count),
    tableNameMd5: row.table_name_md5,
    columnCount: Number(row.column_count),
    columnCatalogMd5: row.column_catalog_md5,
    indexCount: Number(row.index_count),
    indexCatalogMd5: row.index_catalog_md5,
    constraintCount: Number(row.constraint_count),
    constraintCatalogMd5: row.constraint_catalog_md5,
  };
}

function normalizedJournalRow(row = {}) {
  return {
    id: Number(row.id),
    hash: row.hash,
    createdAt: Number(row.created_at),
  };
}

export function compareCatalogFingerprint(actualRow, expected) {
  const actual = normalizedCatalogRow(actualRow);
  const errors = [];
  for (const [key, expectedValue] of Object.entries(expected)) {
    compareValue(`catalog.${key}`, expectedValue, actual[key], errors);
  }
  return errors;
}

export function compareJournalManifest(actualRows, trackedPrefix) {
  const expectedRows = trackedPrefix.map((entry) => ({
    id: entry.databaseId,
    hash: entry.sha256,
    createdAt: entry.createdAt,
  }));
  const actual = actualRows.map(normalizedJournalRow);
  const errors = [];
  compareValue('journal row count', expectedRows.length, actual.length, errors);
  const length = Math.min(expectedRows.length, actual.length);
  for (let index = 0; index < length; index += 1) {
    compareValue(`journal row ${index + 1}`, JSON.stringify(expectedRows[index]), JSON.stringify(actual[index]), errors);
  }
  return errors;
}

export function compareSqlOnlyIndexes(actualRows, expectedIndexes) {
  const actualByName = new Map(actualRows.map((row) => [row.indexname, row]));
  const expectedNames = new Set(expectedIndexes.map((entry) => entry.name));
  const errors = [];
  for (const entry of expectedIndexes) {
    const actual = actualByName.get(entry.name);
    if (!actual) {
      errors.push(`missing SQL-only index ${entry.name}`);
      continue;
    }
    compareValue(`${entry.name} table`, entry.table, actual.tablename, errors);
    compareValue(`${entry.name} definition`, entry.indexDefinition, actual.indexdef, errors);
  }
  const unexpected = actualRows.filter((row) => !expectedNames.has(row.indexname));
  if (unexpected.length) errors.push(`unexpected SQL-only index rows ${unexpected.map((row) => row.indexname).join(', ')}`);
  return errors;
}

export async function verifyDatabaseBaseline(client, manifest) {
  const checks = [];

  try {
    const result = await client.query(JOURNAL_MANIFEST_SQL);
    const errors = compareJournalManifest(result.rows, manifest.repository.trackedJournalPrefix);
    checks.push({
      name: 'database Drizzle journal matches the exact expected manifest',
      ok: errors.length === 0,
      detail: formatErrors(errors, `${result.rows.length} exact rows`),
    });
  } catch (error) {
    checks.push({ name: 'database Drizzle journal matches the exact expected manifest', ok: false, detail: `query failed: ${error.message}` });
  }

  try {
    const result = await client.query(CATALOG_FINGERPRINT_SQL);
    const errors = result.rows.length === 1
      ? compareCatalogFingerprint(result.rows[0], manifest.database.catalog.expected)
      : [`catalog query returned ${result.rows.length} rows`];
    checks.push({
      name: 'database public catalog matches the reconciled fingerprint',
      ok: errors.length === 0,
      detail: formatErrors(errors, `tables=${manifest.database.catalog.expected.tableCount}, columns=${manifest.database.catalog.expected.columnCount}, indexes=${manifest.database.catalog.expected.indexCount}, constraints=${manifest.database.catalog.expected.constraintCount}`),
    });
  } catch (error) {
    checks.push({ name: 'database public catalog matches the reconciled fingerprint', ok: false, detail: `query failed: ${error.message}` });
  }

  try {
    const expectedIndexes = manifest.database.sqlOnlyIndexes;
    const result = await client.query(SQL_ONLY_INDEXES_SQL, [expectedIndexes.map((entry) => entry.name)]);
    const errors = compareSqlOnlyIndexes(result.rows, expectedIndexes);
    checks.push({
      name: 'database preserves the two SQL-only production indexes',
      ok: errors.length === 0,
      detail: formatErrors(errors, expectedIndexes.map((entry) => entry.name).join(', ')),
    });
  } catch (error) {
    checks.push({ name: 'database preserves the two SQL-only production indexes', ok: false, detail: `query failed: ${error.message}` });
  }

  return { ok: checks.every((check) => check.ok), checks };
}
