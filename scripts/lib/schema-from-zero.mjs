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
  verifyRepositoryBaseline,
} from './schema-readiness.mjs';

export const SCHEMA_FROM_ZERO_IDENTITY_SQL = `
select
  current_database() as database,
  current_schema() as schema,
  current_setting('neon.branch_id', true) as neon_branch_id,
  current_setting('neon.project_id', true) as neon_project_id
`;

export const SCHEMA_FROM_ZERO_EMPTY_SQL = `
select
  (
    select count(*)::integer
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname <> 'information_schema'
      and n.nspname !~ '^pg_'
      and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
  ) as user_relation_count,
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname <> 'information_schema' and n.nspname !~ '^pg_'
  ) as user_routine_count,
  (
    select count(*)::integer
    from pg_namespace
    where nspname <> 'public'
      and nspname <> 'information_schema'
      and nspname !~ '^pg_'
  ) as additional_user_schema_count,
  (to_regnamespace('drizzle') is not null) as drizzle_schema_exists
`;

const defaultRootDir = fileURLToPath(new URL('../../', import.meta.url));

function decodeUrlComponent(value, field) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`The disposable target URL has invalid percent-encoding in its ${field}.`);
  }
}

function databaseNameFromUrl(url) {
  const encodedDatabase = url.pathname.replace(/^\//, '');
  if (!encodedDatabase || encodedDatabase.includes('/')) {
    throw new Error('The disposable target URL must name exactly one database path segment.');
  }
  const database = decodeUrlComponent(encodedDatabase, 'database name');
  if (!database || database.includes('/') || database.includes('\\') || database.includes('\0')) {
    throw new Error('The disposable target URL must name exactly one database path segment.');
  }
  return database;
}

function validateConnectionQuery(url) {
  const seen = new Set();
  let sslmode;

  for (const [rawKey, value] of url.searchParams) {
    const key = rawKey.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`The disposable target URL must not contain duplicate query parameter ${key}.`);
    }
    seen.add(key);
    if (key !== 'sslmode') {
      throw new Error(`The disposable target URL query may contain only sslmode; refusing ${key || '(empty parameter)'}.`);
    }
    sslmode = value;
  }

  if (seen.size !== 1 || sslmode?.toLowerCase() !== 'verify-full') {
    throw new Error('The disposable target must use exactly one sslmode=verify-full query parameter.');
  }
}

function validatedClientConfig(url) {
  if (url.hash) throw new Error('The disposable target URL must not contain a fragment.');
  validateConnectionQuery(url);

  const rawHost = url.hostname.toLowerCase();
  if (rawHost.endsWith('.')) throw new Error('The disposable target hostname must not have a trailing dot.');
  if (!/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(rawHost)) {
    throw new Error('Schema reconstruction requires a direct Neon endpoint hostname.');
  }
  if (rawHost.includes('-pooler.')) throw new Error('Schema reconstruction requires a direct, non-pooler disposable endpoint.');

  const port = url.port ? Number(url.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('The disposable target URL port must be an integer from 1 through 65535.');
  }
  const user = decodeUrlComponent(url.username, 'username');
  const password = decodeUrlComponent(url.password, 'password');
  if (!user || !password) throw new Error('The disposable target URL must contain a username and password.');

  return {
    host: rawHost,
    port,
    user,
    password,
    database: databaseNameFromUrl(url),
    ssl: { rejectUnauthorized: true },
  };
}

function protectedBranchIds(manifest) {
  return new Set(manifest.database.protectedTargets.map((target) => target.branchId));
}

function protectedHosts(manifest) {
  return new Set(manifest.database.protectedTargets.flatMap((target) => target.hosts).map((host) => host.toLowerCase()));
}

function expectedConfirmation(branchId, database) {
  return `MIS-380_RECONSTRUCT:${branchId}:${database}`;
}

export function schemaFromZeroOptionsFromEnv(env = process.env) {
  return {
    databaseUrl: env.SCHEMA_FROM_ZERO_DATABASE_URL,
    expectedHost: env.SCHEMA_FROM_ZERO_EXPECTED_HOST,
    expectedBranchId: env.SCHEMA_FROM_ZERO_EXPECTED_BRANCH_ID,
    expectedProjectId: env.SCHEMA_FROM_ZERO_EXPECTED_PROJECT_ID,
    targetLabel: env.SCHEMA_FROM_ZERO_TARGET_LABEL,
    confirmation: env.SCHEMA_FROM_ZERO_CONFIRM,
    execute: env.SCHEMA_FROM_ZERO_EXECUTE === '1',
  };
}

export function validateSchemaFromZeroTarget(options, manifest) {
  if (options.execute !== true) {
    throw new Error('Real Postgres reconstruction requires SCHEMA_FROM_ZERO_EXECUTE=1. No database connection was attempted.');
  }
  if (!options.databaseUrl) throw new Error('SCHEMA_FROM_ZERO_DATABASE_URL is required; DATABASE_URL is intentionally ignored.');

  let url;
  try {
    url = new URL(options.databaseUrl);
  } catch {
    throw new Error('SCHEMA_FROM_ZERO_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('The disposable target must use a PostgreSQL URL.');
  const clientConfig = validatedClientConfig(url);

  if (!options.expectedHost || options.expectedHost.endsWith('.') || options.expectedHost.toLowerCase() !== clientConfig.host) {
    throw new Error('SCHEMA_FROM_ZERO_EXPECTED_HOST must exactly match the connection URL hostname.');
  }
  if (protectedHosts(manifest).has(clientConfig.host)) throw new Error(`Refusing protected production/staging host ${clientConfig.host}.`);

  if (!options.targetLabel || !/^qa-mis-380-[a-z0-9-]+$/.test(options.targetLabel)) {
    throw new Error('SCHEMA_FROM_ZERO_TARGET_LABEL must start with qa-mis-380- and contain only lowercase letters, digits, and hyphens.');
  }
  if (!options.expectedBranchId?.startsWith('br-')) throw new Error('SCHEMA_FROM_ZERO_EXPECTED_BRANCH_ID is required.');
  if (protectedBranchIds(manifest).has(options.expectedBranchId)) {
    throw new Error(`Refusing protected production/staging branch ${options.expectedBranchId}.`);
  }
  if (options.expectedProjectId !== manifest.database.neonProjectId) {
    throw new Error(`SCHEMA_FROM_ZERO_EXPECTED_PROJECT_ID must equal the audited project ${manifest.database.neonProjectId}.`);
  }

  const database = clientConfig.database;
  const requiredConfirmation = expectedConfirmation(options.expectedBranchId, database);
  if (options.confirmation !== requiredConfirmation) {
    throw new Error(`SCHEMA_FROM_ZERO_CONFIRM must exactly equal ${requiredConfirmation}.`);
  }

  return {
    clientConfig,
    safeTarget: {
      label: options.targetLabel,
      host: clientConfig.host,
      port: clientConfig.port,
      database,
      expectedBranchId: options.expectedBranchId,
      expectedProjectId: options.expectedProjectId,
    },
  };
}

function validateIdentity(row, target, manifest) {
  const errors = [];
  if (protectedBranchIds(manifest).has(row.neon_branch_id)) {
    errors.push(`actual branch ${row.neon_branch_id} is protected production/staging`);
  }
  if (row.neon_branch_id !== target.expectedBranchId) errors.push(`expected branch ${target.expectedBranchId}, received ${row.neon_branch_id || '(unknown)'}`);
  if (row.neon_project_id !== target.expectedProjectId) errors.push(`expected project ${target.expectedProjectId}, received ${row.neon_project_id || '(unknown)'}`);
  if (row.database !== target.database) errors.push(`expected database ${target.database}, received ${row.database || '(unknown)'}`);
  if (row.schema !== 'public') errors.push(`expected schema public, received ${row.schema || '(unknown)'}`);
  if (errors.length) throw new Error(`Disposable target identity rejected: ${errors.join('; ')}.`);
}

function validateEmptyTarget(row, phase) {
  const relationCount = Number(row?.user_relation_count);
  const routineCount = Number(row?.user_routine_count);
  const additionalSchemaCount = Number(row?.additional_user_schema_count);
  const drizzleSchemaExists = row?.drizzle_schema_exists === true;
  if (relationCount !== 0 || routineCount !== 0 || additionalSchemaCount !== 0 || drizzleSchemaExists) {
    throw new Error(`${phase} target is not empty: user relations=${relationCount}, user routines=${routineCount}, additional user schemas=${additionalSchemaCount}, drizzle schema=${drizzleSchemaExists}.`);
  }
}

function defaultClientFactory(clientConfig) {
  return new Client(clientConfig);
}

export async function verifySchemaFromZero({
  options,
  rootDir = defaultRootDir,
  manifest,
  verifyRepository = verifyRepositoryBaseline,
  clientFactory = defaultClientFactory,
  readFile = fs.readFile,
} = {}) {
  const resolvedManifest = manifest || await loadSchemaManifest(rootDir);
  const target = validateSchemaFromZeroTarget(options || {}, resolvedManifest);
  const repositoryReport = await verifyRepository({ rootDir, manifest: resolvedManifest });
  const repositoryFailures = repositoryReport.checks.filter((check) => !check.ok);
  if (repositoryFailures.length) {
    throw new Error(`Reconstructed baseline inputs failed before database connection: ${repositoryFailures.map((check) => `${check.name}: ${check.detail}`).join('; ')}`);
  }

  const client = clientFactory(target.clientConfig);
  let connected = false;
  let transactionStarted = false;
  let transactionOpened = false;
  let validationError;
  let catalogFingerprint;

  try {
    await client.connect();
    connected = true;

    const identity = await client.query(SCHEMA_FROM_ZERO_IDENTITY_SQL);
    if (identity.rows.length !== 1) throw new Error(`Disposable target identity query returned ${identity.rows.length} rows.`);
    validateIdentity(identity.rows[0], target.safeTarget, resolvedManifest);

    const before = await client.query(SCHEMA_FROM_ZERO_EMPTY_SQL);
    if (before.rows.length !== 1) throw new Error(`Disposable target emptiness query returned ${before.rows.length} rows.`);
    validateEmptyTarget(before.rows[0], 'Preflight');

    await client.query('begin');
    transactionStarted = true;
    transactionOpened = true;
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '120s'");

    for (const relativePath of resolvedManifest.repository.reconstructedBaseline.applyOrder) {
      try {
        const sql = await readFile(path.join(rootDir, relativePath), 'utf8');
        await client.query(sql);
      } catch (error) {
        throw new Error(`Baseline application failed at ${relativePath}: ${error.message}`);
      }
    }

    const catalog = await client.query(CATALOG_FINGERPRINT_SQL);
    if (catalog.rows.length !== 1) throw new Error(`Catalog query returned ${catalog.rows.length} rows.`);
    const catalogErrors = compareCatalogFingerprint(catalog.rows[0], resolvedManifest.database.catalog.expected);
    if (catalogErrors.length) throw new Error(`Reconstructed catalog mismatch: ${catalogErrors.join('; ')}.`);
    catalogFingerprint = catalog.rows[0];

    const expectedIndexes = resolvedManifest.database.sqlOnlyIndexes;
    const indexes = await client.query(SQL_ONLY_INDEXES_SQL, [expectedIndexes.map((entry) => entry.name)]);
    const indexErrors = compareSqlOnlyIndexes(indexes.rows, expectedIndexes);
    if (indexErrors.length) throw new Error(`Reconstructed SQL-only index mismatch: ${indexErrors.join('; ')}.`);
  } catch (error) {
    validationError = error;
  } finally {
    if (transactionStarted) {
      try {
        await client.query('rollback');
        transactionStarted = false;
      } catch (error) {
        validationError = new Error(`Disposable target rollback failed: ${error.message}${validationError ? `; original error: ${validationError.message}` : ''}`);
      }
    }
  }

  try {
    if (connected && transactionOpened && !transactionStarted) {
      const after = await client.query(SCHEMA_FROM_ZERO_EMPTY_SQL);
      if (after.rows.length !== 1) throw new Error(`Post-rollback emptiness query returned ${after.rows.length} rows.`);
      validateEmptyTarget(after.rows[0], 'Post-rollback');
    }
  } catch (error) {
    validationError = validationError
      ? new Error(`${validationError.message}; rollback verification failed: ${error.message}`)
      : error;
  } finally {
    if (connected) await client.end();
  }

  if (validationError) throw validationError;
  return {
    ok: true,
    status: 'validated-and-rolled-back',
    target: target.safeTarget,
    appliedFileCount: resolvedManifest.repository.reconstructedBaseline.applyOrder.length,
    catalogFingerprint,
  };
}
