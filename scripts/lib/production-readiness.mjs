import { verifyDatabaseBaseline } from './schema-readiness.mjs';

export const PRODUCTION_DATABASE_IDENTITY_SQL = `
select
  current_database() as database,
  current_setting('neon.project_id', true) as neon_project_id,
  current_setting('neon.branch_id', true) as neon_branch_id
`;

function productionTarget(manifest) {
  const targets = manifest.database.protectedTargets.filter((target) => target.label === 'production');
  if (targets.length !== 1) throw new Error(`Schema manifest must define exactly one production target; received ${targets.length}.`);
  const [target] = targets;
  if (!target.branchId || !manifest.database.neonProjectId || !manifest.database.databaseName) {
    throw new Error('Schema manifest production project, branch, and database identity must be complete.');
  }
  if (!Array.isArray(target.hosts) || target.hosts.length === 0) {
    throw new Error('Schema manifest production target must define at least one approved host.');
  }
  return target;
}

function decodeUrlComponent(value, field) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`Production DATABASE_URL has invalid percent-encoding in its ${field}.`);
  }
}

function databaseNameFromUrl(url) {
  const encodedDatabase = url.pathname.replace(/^\//, '');
  if (!encodedDatabase || encodedDatabase.includes('/')) {
    throw new Error('Production DATABASE_URL must name exactly one database path segment.');
  }
  const database = decodeUrlComponent(encodedDatabase, 'database name');
  if (!database || database.includes('/') || database.includes('\\') || database.includes('\0')) {
    throw new Error('Production DATABASE_URL must name exactly one database path segment.');
  }
  return database;
}

function validateConnectionQuery(url) {
  const seen = new Set();
  let sslmode;

  for (const [rawKey, value] of url.searchParams) {
    const key = rawKey.toLowerCase();
    if (seen.has(key)) throw new Error(`Production DATABASE_URL must not contain duplicate query parameter ${key}.`);
    seen.add(key);
    if (key !== 'sslmode') {
      throw new Error(`Production DATABASE_URL query may contain only sslmode; refusing ${key || '(empty parameter)'}.`);
    }
    sslmode = value;
  }

  if (seen.size !== 1 || sslmode?.toLowerCase() !== 'verify-full') {
    throw new Error('Production DATABASE_URL must use exactly one sslmode=verify-full query parameter.');
  }
}

export function validateProductionDatabaseUrl(connectionString, manifest) {
  if (!connectionString) throw new Error('DATABASE_URL is required for authoritative production readiness.');

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('Production DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Production DATABASE_URL must use PostgreSQL.');
  if (url.hash) throw new Error('Production DATABASE_URL must not contain a fragment.');
  validateConnectionQuery(url);

  const target = productionTarget(manifest);
  const host = url.hostname.toLowerCase();
  if (host.endsWith('.')) throw new Error('Production DATABASE_URL hostname must not have a trailing dot.');
  const approvedHosts = new Set(target.hosts.map((entry) => entry.toLowerCase()));
  if (!approvedHosts.has(host)) throw new Error(`Production DATABASE_URL host ${host || '(missing)'} is not an approved manifest production host.`);

  const port = url.port ? Number(url.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Production DATABASE_URL port must be an integer from 1 through 65535.');
  }
  const user = decodeUrlComponent(url.username, 'username');
  const password = decodeUrlComponent(url.password, 'password');
  if (!user || !password) throw new Error('Production DATABASE_URL must contain a username and password.');

  const database = databaseNameFromUrl(url);
  if (database !== manifest.database.databaseName) {
    throw new Error(`Production DATABASE_URL database must be ${manifest.database.databaseName}; received ${database}.`);
  }

  return {
    clientConfig: {
      host,
      port,
      user,
      password,
      database,
      ssl: { rejectUnauthorized: true },
    },
    safeTarget: {
      host,
      port,
      database,
      neonProjectId: manifest.database.neonProjectId,
      neonBranchId: target.branchId,
    },
  };
}

export function assertAuthoritativeProductionInvocation(env = process.env) {
  if (env.SKIP_DB === '1') {
    throw new Error('SKIP_DB=1 is forbidden for authoritative verify:production; live production database identity and catalog proof are mandatory.');
  }
}

function compareIdentity(row, manifest) {
  const target = productionTarget(manifest);
  const errors = [];
  if (row.database !== manifest.database.databaseName) {
    errors.push(`database expected ${manifest.database.databaseName}, received ${row.database || '(unknown)'}`);
  }
  if (row.neon_project_id !== manifest.database.neonProjectId) {
    errors.push(`Neon project expected ${manifest.database.neonProjectId}, received ${row.neon_project_id || '(unknown)'}`);
  }
  if (row.neon_branch_id !== target.branchId) {
    errors.push(`Neon branch expected ${target.branchId}, received ${row.neon_branch_id || '(unknown)'}`);
  }
  return errors;
}

export async function verifyProductionDatabaseBaseline(client, manifest, {
  verifyBaseline = verifyDatabaseBaseline,
} = {}) {
  let identity;
  try {
    identity = await client.query(PRODUCTION_DATABASE_IDENTITY_SQL);
  } catch (error) {
    return {
      ok: false,
      checks: [{ name: 'connected database identity matches audited production', ok: false, detail: `query failed: ${error.message}` }],
    };
  }

  const identityErrors = identity.rows.length === 1
    ? compareIdentity(identity.rows[0], manifest)
    : [`identity query returned ${identity.rows.length} rows`];
  const identityCheck = {
    name: 'connected database identity matches audited production',
    ok: identityErrors.length === 0,
    detail: identityErrors.length
      ? identityErrors.join('; ')
      : `project=${manifest.database.neonProjectId}, branch=${productionTarget(manifest).branchId}, database=${manifest.database.databaseName}`,
  };
  if (!identityCheck.ok) return { ok: false, checks: [identityCheck] };

  const baseline = await verifyBaseline(client, manifest);
  return {
    ok: baseline.ok,
    checks: [identityCheck, ...baseline.checks],
  };
}
