import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import {
  CATALOG_FINGERPRINT_SQL,
  SQL_ONLY_INDEXES_SQL,
  compareCatalogFingerprint,
  compareSqlOnlyIndexes,
  loadSchemaManifest,
  sha256,
} from './schema-readiness.mjs';
import { SCHEMA_FROM_ZERO_EMPTY_SQL, SCHEMA_FROM_ZERO_IDENTITY_SQL } from './schema-from-zero.mjs';
import { loadForwardSchemaManifest, verifyForwardSchemaRepository } from './forward-schema.mjs';

const defaultRootDir = fileURLToPath(new URL('../../', import.meta.url));

function decode(value, label) {
  try { return decodeURIComponent(value); } catch { throw new Error(`Invalid percent-encoding in ${label}.`); }
}

function clientConfigFromUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('FORWARD_SCHEMA_DATABASE_URL must be a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Forward validation requires PostgreSQL.');
  if (url.hash) throw new Error('Forward validation URL must not contain a fragment.');
  const host = url.hostname.toLowerCase();
  if (!/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(host) || host.includes('-pooler.') || host.endsWith('.')) {
    throw new Error('Forward validation requires a direct, non-pooler Neon endpoint.');
  }
  const database = decode(url.pathname.replace(/^\//, ''), 'database');
  if (!database || database.includes('/') || database.includes('\\') || database.includes('\0')) throw new Error('Forward validation URL must name one database.');
  const queryKeys = [...url.searchParams.keys()].map((key) => key.toLowerCase());
  if (queryKeys.length !== 1 || queryKeys[0] !== 'sslmode' || url.searchParams.get('sslmode')?.toLowerCase() !== 'verify-full') {
    throw new Error('Forward validation requires exactly one sslmode=verify-full query parameter.');
  }
  return {
    host,
    port: url.port ? Number(url.port) : 5432,
    user: decode(url.username, 'username'),
    password: decode(url.password, 'password'),
    database,
    ssl: { rejectUnauthorized: true },
  };
}

export function forwardValidationOptionsFromEnv(env = process.env) {
  return {
    databaseUrl: env.FORWARD_SCHEMA_DATABASE_URL,
    expectedHost: env.FORWARD_SCHEMA_EXPECTED_HOST,
    expectedProjectId: env.FORWARD_SCHEMA_EXPECTED_PROJECT_ID,
    expectedBranchId: env.FORWARD_SCHEMA_EXPECTED_BRANCH_ID,
    targetLabel: env.FORWARD_SCHEMA_TARGET_LABEL,
    confirmation: env.FORWARD_SCHEMA_CONFIRM,
    execute: env.FORWARD_SCHEMA_EXECUTE === '1',
    capture: env.FORWARD_SCHEMA_CAPTURE === '1',
  };
}

export function validateForwardTarget(options) {
  if (!options.execute) throw new Error('Forward validation requires FORWARD_SCHEMA_EXECUTE=1.');
  const clientConfig = clientConfigFromUrl(options.databaseUrl);
  if (options.expectedHost?.toLowerCase() !== clientConfig.host) throw new Error('FORWARD_SCHEMA_EXPECTED_HOST must exactly match the connection hostname.');
  if (!/^[a-z][a-z0-9-]*-[a-z0-9-]+$/.test(options.expectedProjectId || '')) {
    throw new Error('FORWARD_SCHEMA_EXPECTED_PROJECT_ID is required.');
  }
  if (!/^br-[a-z0-9-]+$/.test(options.expectedBranchId || '')) throw new Error('FORWARD_SCHEMA_EXPECTED_BRANCH_ID is required.');
  if (!/^qa-mis-[0-9]+-[a-z0-9-]+$/.test(options.targetLabel || '')) {
    throw new Error('FORWARD_SCHEMA_TARGET_LABEL must start with qa-mis-<issue-number>-.');
  }
  const expectedConfirmation = `FORWARD_SCHEMA:${options.expectedProjectId}:${options.expectedBranchId}:${clientConfig.database}`;
  if (options.confirmation !== expectedConfirmation) throw new Error(`FORWARD_SCHEMA_CONFIRM must exactly equal ${expectedConfirmation}.`);
  return {
    clientConfig,
    safeTarget: {
      label: options.targetLabel,
      host: clientConfig.host,
      database: clientConfig.database,
      expectedProjectId: options.expectedProjectId,
      expectedBranchId: options.expectedBranchId,
    },
  };
}

async function verifyBaselineFiles(rootDir, baseline) {
  const entries = [
    baseline.repository.journal,
    ...baseline.repository.trackedJournalPrefix.flatMap((entry) => [entry, entry.snapshot]),
    ...baseline.repository.unjournaledBaselineSql,
  ];
  const errors = [];
  for (const entry of entries) {
    try {
      const digest = sha256(await fs.readFile(path.join(rootDir, entry.path)));
      if (digest !== entry.sha256) errors.push(`${entry.path} sha256 mismatch`);
    } catch (error) {
      errors.push(`${entry.path}: ${error.code === 'ENOENT' ? 'missing' : error.message}`);
    }
  }
  if (errors.length) throw new Error(`Accepted baseline inputs changed: ${errors.join('; ')}.`);
}

function assertEmpty(row, phase) {
  const values = [row?.user_relation_count, row?.user_routine_count, row?.additional_user_schema_count].map(Number);
  if (values.some((value) => value !== 0) || row?.drizzle_schema_exists === true) {
    throw new Error(`${phase} disposable target is not empty.`);
  }
}

function assertIdentity(row, target) {
  const errors = [];
  if (row.database !== target.database) errors.push(`database expected ${target.database}, received ${row.database}`);
  if (row.schema !== 'public') errors.push(`schema expected public, received ${row.schema}`);
  if (row.neon_project_id !== target.expectedProjectId) errors.push(`project expected ${target.expectedProjectId}, received ${row.neon_project_id}`);
  if (row.neon_branch_id !== target.expectedBranchId) errors.push(`branch expected ${target.expectedBranchId}, received ${row.neon_branch_id}`);
  if (errors.length) throw new Error(`Disposable target identity rejected: ${errors.join('; ')}.`);
}

function migrationLedgerSql(forward) {
  const ledger = forward.repository.migrationLedger;
  return [
    `create schema if not exists ${ledger.schema}`,
    `create table ${ledger.schema}.${ledger.table} (identifier text primary key, sha256 text not null, applied_at timestamptz not null default now())`,
    `insert into ${ledger.schema}.${ledger.table} (identifier, sha256) values ('${ledger.baselineMarker}', '${forward.priorBaseline.canonicalSha256}')`,
  ];
}

export async function verifyForwardSchemaOnDisposable({
  options,
  rootDir = defaultRootDir,
  baseline,
  forward,
  clientFactory = (config) => new Client(config),
} = {}) {
  const resolvedBaseline = baseline || await loadSchemaManifest(rootDir);
  const resolvedForward = forward || await loadForwardSchemaManifest(rootDir);
  const target = validateForwardTarget(options || {});
  await verifyBaselineFiles(rootDir, resolvedBaseline);
  const repository = await verifyForwardSchemaRepository({
    rootDir,
    manifest: resolvedForward,
    requireDatabaseFingerprint: !options?.capture,
    requireCanonicalManifest: !options?.capture,
  });
  const failures = repository.checks.filter((check) => !check.ok);
  if (failures.length) throw new Error(`Forward repository validation failed: ${failures.map((check) => `${check.name}: ${check.detail}`).join('; ')}`);

  const client = clientFactory(target.clientConfig);
  let connected = false;
  let transactionStarted = false;
  let transactionOpened = false;
  let result;
  let failure;
  try {
    await client.connect();
    connected = true;
    const identity = await client.query(SCHEMA_FROM_ZERO_IDENTITY_SQL);
    if (identity.rows.length !== 1) throw new Error(`Identity query returned ${identity.rows.length} rows.`);
    assertIdentity(identity.rows[0], target.safeTarget);
    const before = await client.query(SCHEMA_FROM_ZERO_EMPTY_SQL);
    if (before.rows.length !== 1) throw new Error(`Emptiness query returned ${before.rows.length} rows.`);
    assertEmpty(before.rows[0], 'Preflight');
    await client.query('begin');
    transactionStarted = true;
    transactionOpened = true;
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '120s'");
    for (const relativePath of resolvedBaseline.repository.reconstructedBaseline.applyOrder) {
      await client.query(await fs.readFile(path.join(rootDir, relativePath), 'utf8'));
    }
    for (const sql of migrationLedgerSql(resolvedForward)) await client.query(sql);
    for (const entry of resolvedForward.repository.forwardMigrations) {
      await client.query(await fs.readFile(path.join(rootDir, entry.path), 'utf8'));
      const ledger = resolvedForward.repository.migrationLedger;
      await client.query(
        `insert into ${ledger.schema}.${ledger.table} (identifier, sha256) values ($1, $2)`,
        [entry.identifier, entry.sha256],
      );
    }
    const catalog = await client.query(CATALOG_FINGERPRINT_SQL);
    if (catalog.rows.length !== 1) throw new Error(`Catalog query returned ${catalog.rows.length} rows.`);
    if (resolvedForward.database.catalog.expected) {
      const errors = compareCatalogFingerprint(catalog.rows[0], resolvedForward.database.catalog.expected);
      if (errors.length) throw new Error(`Forward catalog mismatch: ${errors.join('; ')}.`);
    }
    const expectedIndexes = resolvedBaseline.database.sqlOnlyIndexes;
    const indexes = await client.query(SQL_ONLY_INDEXES_SQL, [expectedIndexes.map((entry) => entry.name)]);
    const indexErrors = compareSqlOnlyIndexes(indexes.rows, expectedIndexes);
    if (indexErrors.length) throw new Error(`SQL-only index mismatch: ${indexErrors.join('; ')}.`);
    result = {
      ok: true,
      status: options?.capture ? 'captured-and-rolled-back' : 'validated-and-rolled-back',
      target: target.safeTarget,
      catalogFingerprint: catalog.rows[0],
      baselineFileCount: resolvedBaseline.repository.reconstructedBaseline.applyOrder.length,
      forwardMigrationCount: resolvedForward.repository.forwardMigrations.length,
      forwardManifestSha256: repository.manifestSha256,
    };
  } catch (error) {
    failure = error;
  } finally {
    if (transactionStarted) {
      try { await client.query('rollback'); transactionStarted = false; }
      catch (error) { failure = new Error(`Rollback failed: ${error.message}${failure ? `; original error: ${failure.message}` : ''}`); }
    }
  }
  try {
    if (connected && transactionOpened && !transactionStarted) {
      const after = await client.query(SCHEMA_FROM_ZERO_EMPTY_SQL);
      if (after.rows.length !== 1) throw new Error(`Post-rollback emptiness query returned ${after.rows.length} rows.`);
      assertEmpty(after.rows[0], 'Post-rollback');
    }
  } catch (error) {
    failure = failure ? new Error(`${failure.message}; post-rollback verification failed: ${error.message}`) : error;
  } finally {
    if (connected) await client.end();
  }
  if (failure) throw failure;
  return result;
}
