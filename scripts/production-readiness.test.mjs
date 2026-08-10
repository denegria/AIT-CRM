import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  PRODUCTION_DATABASE_IDENTITY_SQL,
  validateProductionDatabaseUrl,
  verifyProductionDatabaseBaseline,
} from './lib/production-readiness.mjs';
import { loadSchemaManifest } from './lib/schema-readiness.mjs';
import {
  runProductionDiagnostics,
  runProductionReadiness,
} from './verify-production-readiness.mjs';

const ROOT_DIR = fileURLToPath(new URL('../', import.meta.url));
let manifest;
let production;

test.before(async () => {
  manifest = await loadSchemaManifest(ROOT_DIR);
  production = manifest.database.protectedTargets.find((target) => target.label === 'production');
});

function identityClient(identity) {
  const queries = [];
  return {
    queries,
    async query(sql) {
      queries.push(sql);
      if (sql !== PRODUCTION_DATABASE_IDENTITY_SQL) throw new Error(`unexpected query: ${sql}`);
      return { rows: [identity] };
    },
  };
}

function productionIdentity(overrides = {}) {
  return {
    database: manifest.database.databaseName,
    neon_project_id: manifest.database.neonProjectId,
    neon_branch_id: production.branchId,
    ...overrides,
  };
}

function runNpmScript(script, args = [], env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', script, ...args], {
      cwd: ROOT_DIR,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({
      code,
      output: `${Buffer.concat(stdout).toString('utf8')}\n${Buffer.concat(stderr).toString('utf8')}`,
    }));
  });
}

function fakeResponse(status, body = '') {
  return {
    status,
    async text() { return body; },
  };
}

test('production URL is pinned to manifest authority/database and becomes a sanitized client config', () => {
  const host = production.hosts.find((entry) => entry.includes('-pooler.'));
  const target = validateProductionDatabaseUrl(
    `postgresql://production%2Drole:secret%40value@${host}/${manifest.database.databaseName}?sslmode=verify-full`,
    manifest,
  );
  assert.deepEqual(target.clientConfig, {
    host,
    port: 5432,
    user: 'production-role',
    password: 'secret@value',
    database: manifest.database.databaseName,
    ssl: { rejectUnauthorized: true },
  });
  assert.throws(
    () => validateProductionDatabaseUrl(
      `postgresql://role:secret@ep-muddy-frost-apgwqat1.c-7.us-east-1.aws.neon.tech/${manifest.database.databaseName}?sslmode=verify-full`,
      manifest,
    ),
    /not an approved manifest production host/,
  );
  assert.throws(
    () => validateProductionDatabaseUrl(
      `postgresql://role:secret@${host}/${manifest.database.databaseName}?sslmode=require`,
      manifest,
    ),
    /exactly one sslmode=verify-full/,
  );
  assert.throws(
    () => validateProductionDatabaseUrl(
      `postgresql://role:secret@${host}/lookalike?sslmode=verify-full`,
      manifest,
    ),
    /database must be neondb/,
  );
  assert.throws(
    () => validateProductionDatabaseUrl(
      `postgresql://role:secret@${host}/${manifest.database.databaseName}?sslmode=verify-full&host=ep-muddy-frost-apgwqat1.c-7.us-east-1.aws.neon.tech`,
      manifest,
    ),
    /query may contain only sslmode/,
  );
});

test('audited production identity reaches catalog verification', async () => {
  const client = identityClient(productionIdentity());
  let baselineCalls = 0;
  const report = await verifyProductionDatabaseBaseline(client, manifest, {
    verifyBaseline: async () => {
      baselineCalls += 1;
      return { ok: true, checks: [{ name: 'fixture catalog proof', ok: true, detail: 'exact' }] };
    },
  });

  assert.equal(report.ok, true);
  assert.equal(baselineCalls, 1);
  assert.deepEqual(client.queries, [PRODUCTION_DATABASE_IDENTITY_SQL]);
  assert.equal(report.checks[0].ok, true);
});

test('staging/arbitrary branch, project, and database identities stop before catalog verification', async () => {
  const rejectedIdentities = [
    productionIdentity({ neon_branch_id: 'br-broad-hill-aptjpyea' }),
    productionIdentity({ neon_branch_id: 'br-disposable-lookalike' }),
    productionIdentity({ neon_project_id: 'different-project' }),
    productionIdentity({ database: 'lookalike' }),
  ];

  for (const identity of rejectedIdentities) {
    const client = identityClient(identity);
    let baselineCalls = 0;
    const report = await verifyProductionDatabaseBaseline(client, manifest, {
      verifyBaseline: async () => {
        baselineCalls += 1;
        return { ok: true, checks: [] };
      },
    });
    assert.equal(report.ok, false);
    assert.equal(baselineCalls, 0);
    assert.deepEqual(client.queries, [PRODUCTION_DATABASE_IDENTITY_SQL]);
    assert.match(report.checks[0].detail, /expected/);
  }
});

test('authoritative readiness rejects a staging URL before client or catalog work', async () => {
  let clientCreated = false;
  const report = await runProductionReadiness({
    env: {
      AIT_CRM_BASE_URL: 'https://production.example.test',
      DATABASE_URL: `postgresql://role:secret@ep-muddy-frost-apgwqat1.c-7.us-east-1.aws.neon.tech/${manifest.database.databaseName}?sslmode=verify-full`,
      SKIP_ENV: '1',
      SKIP_META_VALID_TOKEN: '1',
    },
    verifyRepository: async () => ({
      checks: [{ name: 'fixture repository', ok: true, detail: 'exact' }],
      manifestSha256: 'fixture-sha',
    }),
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname === '/') return fakeResponse(200);
      if (url.pathname === '/api/auth/session') return fakeResponse(200, JSON.stringify({ authenticated: false, user: null }));
      if (url.pathname === '/api/webhooks/facebook-leads') return fakeResponse(403);
      throw new Error(`unexpected URL ${url}`);
    },
    loadManifest: async () => manifest,
    clientFactory: () => {
      clientCreated = true;
      throw new Error('wrong host must fail before client construction');
    },
    logger: { log() {} },
  });

  assert.equal(report.ok, false);
  assert.equal(report.productionReady, false);
  assert.equal(clientCreated, false);
  assert.match(
    report.checks.find((check) => check.name.includes('authority, database, and TLS')).detail,
    /not an approved manifest production host/,
  );
  assert.equal(report.checks.some((check) => check.name.includes('catalog')), false);
});

test('authoritative readiness refuses SKIP_DB before repository, HTTP, or client work', async () => {
  let dependencyReached = false;
  await assert.rejects(
    () => runProductionReadiness({
      env: { SKIP_DB: '1' },
      verifyRepository: async () => {
        dependencyReached = true;
        return { checks: [] };
      },
      fetchImpl: async () => {
        dependencyReached = true;
        return fakeResponse(200);
      },
      clientFactory: () => {
        dependencyReached = true;
      },
    }),
    /SKIP_DB=1 is forbidden.*live production database identity and catalog proof are mandatory/,
  );
  assert.equal(dependencyReached, false);

  const cli = await runNpmScript('verify:production', [], { SKIP_DB: '1' });
  assert.equal(cli.code, 1, cli.output);
  assert.match(cli.output, /SKIP_DB=1 is forbidden/);
  assert.doesNotMatch(cli.output, /production root responds/);
  assert.doesNotMatch(cli.output, /Production readiness checks passed/);
});

test('diagnose:production is explicitly non-authoritative and never creates a database client', async () => {
  let clientCreated = false;
  const report = await runProductionDiagnostics({
    env: {
      AIT_CRM_BASE_URL: 'https://production.example.test',
      SKIP_META_VALID_TOKEN: '1',
    },
    verifyRepository: async () => ({
      checks: [{ name: 'fixture repository', ok: true, detail: 'exact' }],
      manifestSha256: 'fixture-sha',
    }),
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname === '/') return fakeResponse(200);
      if (url.pathname === '/api/auth/session') return fakeResponse(200, JSON.stringify({ authenticated: false, user: null }));
      if (url.pathname === '/api/webhooks/facebook-leads') return fakeResponse(403);
      throw new Error(`unexpected URL ${url}`);
    },
    loadManifest: async () => {
      throw new Error('diagnostics must not load the database manifest');
    },
    clientFactory: () => {
      clientCreated = true;
      throw new Error('diagnostics must not construct a database client');
    },
    logger: { log() {} },
  });

  assert.equal(report.ok, true);
  assert.equal(report.authoritative, false);
  assert.equal(report.productionReady, false);
  assert.equal(clientCreated, false);
  assert.match(report.checks.find((check) => check.name.includes('not attempted')).detail, /non-authoritative/);

  const help = await runNpmScript('diagnose:production', ['--', '--help']);
  assert.equal(help.code, 0, help.output);
  assert.match(help.output, /non-authoritative.*does not prove production readiness/i);
  assert.doesNotMatch(help.output, /Production readiness checks passed/);
});
