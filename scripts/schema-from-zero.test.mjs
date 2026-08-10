import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CATALOG_FINGERPRINT_SQL,
  SQL_ONLY_INDEXES_SQL,
  loadSchemaManifest,
} from './lib/schema-readiness.mjs';
import {
  SCHEMA_FROM_ZERO_EMPTY_SQL,
  SCHEMA_FROM_ZERO_IDENTITY_SQL,
  validateSchemaFromZeroTarget,
  verifySchemaFromZero,
} from './lib/schema-from-zero.mjs';

const ROOT_DIR = fileURLToPath(new URL('../', import.meta.url));
const DISPOSABLE_HOST = 'ep-disposable-mis380.c-7.us-east-1.aws.neon.tech';
const DISPOSABLE_BRANCH = 'br-disposable-mis380';
let manifest;

test.before(async () => {
  manifest = await loadSchemaManifest(ROOT_DIR);
});

function options(overrides = {}) {
  return {
    databaseUrl: `postgresql://test-role:test-password@${DISPOSABLE_HOST}/neondb?sslmode=verify-full`,
    expectedHost: DISPOSABLE_HOST,
    expectedBranchId: DISPOSABLE_BRANCH,
    expectedProjectId: manifest.database.neonProjectId,
    targetLabel: 'qa-mis-380-fixture',
    confirmation: `MIS-380_RECONSTRUCT:${DISPOSABLE_BRANCH}:neondb`,
    execute: true,
    ...overrides,
  };
}

function repositoryPass() {
  return { ok: true, checks: [{ name: 'fixture repository', ok: true, detail: '' }] };
}

function catalogRow(overrides = {}) {
  const expected = manifest.database.catalog.expected;
  return {
    table_count: expected.tableCount,
    table_name_md5: expected.tableNameMd5,
    column_count: expected.columnCount,
    column_catalog_md5: expected.columnCatalogMd5,
    index_count: expected.indexCount,
    index_catalog_md5: expected.indexCatalogMd5,
    constraint_count: expected.constraintCount,
    constraint_catalog_md5: expected.constraintCatalogMd5,
    ...overrides,
  };
}

function indexRows() {
  return manifest.database.sqlOnlyIndexes.map((entry) => ({
    tablename: entry.table,
    indexname: entry.name,
    indexdef: entry.indexDefinition,
  }));
}

function fakeClient({
  identityBranch = DISPOSABLE_BRANCH,
  catalog = catalogRow(),
  emptyRow = { user_relation_count: 0, user_routine_count: 0, additional_user_schema_count: 0, drizzle_schema_exists: false },
} = {}) {
  const queries = [];
  return {
    queries,
    async connect() {},
    async end() {},
    async query(sql) {
      queries.push(sql);
      if (sql === SCHEMA_FROM_ZERO_IDENTITY_SQL) {
        return { rows: [{ database: 'neondb', schema: 'public', neon_branch_id: identityBranch, neon_project_id: manifest.database.neonProjectId }] };
      }
      if (sql === SCHEMA_FROM_ZERO_EMPTY_SQL) {
        return { rows: [emptyRow] };
      }
      if (sql === CATALOG_FINGERPRINT_SQL) return { rows: [catalog] };
      if (sql === SQL_ONLY_INDEXES_SQL) return { rows: indexRows() };
      return { rows: [] };
    },
  };
}

test('real reconstruction requires explicit execution, target identity, and confirmation', () => {
  assert.throws(() => validateSchemaFromZeroTarget(options({ execute: false }), manifest), /SCHEMA_FROM_ZERO_EXECUTE=1/);
  assert.throws(() => validateSchemaFromZeroTarget(options({ expectedHost: 'different.neon.tech' }), manifest), /must exactly match/);
  assert.throws(() => validateSchemaFromZeroTarget(options({ confirmation: 'wrong' }), manifest), /must exactly equal/);
});

test('validated target exposes only a sanitized pg client configuration', () => {
  const target = validateSchemaFromZeroTarget(options({
    databaseUrl: `postgresql://test%2Drole:test%40password@${DISPOSABLE_HOST}:5433/neondb?sslmode=verify-full`,
  }), manifest);
  assert.deepEqual(target.clientConfig, {
    host: DISPOSABLE_HOST,
    port: 5433,
    user: 'test-role',
    password: 'test@password',
    database: 'neondb',
    ssl: { rejectUnauthorized: true },
  });
  assert.equal('connectionString' in target, false);
});

test('duplicate and encoded sslmode parameters are refused before client construction', async () => {
  const unsafeQueries = [
    'sslmode=verify-full&sslmode=disable',
    'sslmode=verify-full&SSLMODE=disable',
    'sslmode=verify-full&%73slmode=disable',
    'SSLMODE=verify-full&%53%53%4cmode=verify-full',
  ];

  for (const query of unsafeQueries) {
    let clientCreated = false;
    await assert.rejects(
      () => verifySchemaFromZero({
        options: options({ databaseUrl: `postgresql://test-role:test-password@${DISPOSABLE_HOST}/neondb?${query}` }),
        rootDir: ROOT_DIR,
        manifest,
        verifyRepository: async () => repositoryPass(),
        clientFactory: () => {
          clientCreated = true;
          return fakeClient();
        },
      }),
      /duplicate query parameter sslmode/,
    );
    assert.equal(clientCreated, false, query);
  }
});

test('connection override query parameters and variants are refused before client construction', async () => {
  const unsafeQueries = [
    `sslmode=verify-full&host=${DISPOSABLE_HOST}`,
    `sslmode=verify-full&HOST=${DISPOSABLE_HOST}`,
    `sslmode=verify-full&%68ost=${DISPOSABLE_HOST}`,
    'sslmode=verify-full&hostaddr=127.0.0.1',
    'sslmode=verify-full&port=5432',
    'sslmode=verify-full&user=other',
    'sslmode=verify-full&password=other',
    'sslmode=verify-full&dbname=other',
    'sslmode=verify-full&database=other',
    'sslmode=verify-full&service=other',
    'sslmode=verify-full&options=-csearch_path%3Dother',
    'sslmode=verify-full&sslrootcert=system',
  ];

  for (const query of unsafeQueries) {
    let clientCreated = false;
    await assert.rejects(
      () => verifySchemaFromZero({
        options: options({ databaseUrl: `postgresql://test-role:test-password@${DISPOSABLE_HOST}/neondb?${query}` }),
        rootDir: ROOT_DIR,
        manifest,
        verifyRepository: async () => repositoryPass(),
        clientFactory: () => {
          clientCreated = true;
          return fakeClient();
        },
      }),
      /query may contain only sslmode/,
    );
    assert.equal(clientCreated, false, query);
  }
});

test('trailing-dot URL or expected hosts are refused before client construction', async () => {
  const unsafeOptions = [
    options({
      databaseUrl: `postgresql://test-role:test-password@${DISPOSABLE_HOST}./neondb?sslmode=verify-full`,
      expectedHost: `${DISPOSABLE_HOST}.`,
    }),
    options({ expectedHost: `${DISPOSABLE_HOST}.` }),
  ];

  for (const targetOptions of unsafeOptions) {
    let clientCreated = false;
    await assert.rejects(
      () => verifySchemaFromZero({
        options: targetOptions,
        rootDir: ROOT_DIR,
        manifest,
        verifyRepository: async () => repositoryPass(),
        clientFactory: () => {
          clientCreated = true;
          return fakeClient();
        },
      }),
      /trailing dot|must exactly match/,
    );
    assert.equal(clientCreated, false);
  }
});

test('known staging hosts and both protected branch IDs are refused before connection', () => {
  const staging = manifest.database.protectedTargets.find((target) => target.label === 'staging');
  const stagingHost = staging.hosts.find((host) => !host.includes('-pooler.'));
  assert.throws(
    () => validateSchemaFromZeroTarget(options({
      databaseUrl: `postgresql://test:test@${stagingHost}/neondb?sslmode=verify-full`,
      expectedHost: stagingHost,
    }), manifest),
    /protected production\/staging host/,
  );
  for (const target of manifest.database.protectedTargets) {
    assert.throws(
      () => validateSchemaFromZeroTarget(options({
        expectedBranchId: target.branchId,
        confirmation: `MIS-380_RECONSTRUCT:${target.branchId}:neondb`,
      }), manifest),
      /protected production\/staging branch/,
    );
  }
});

test('a protected actual branch is rejected before BEGIN or any migration SQL', async () => {
  const client = fakeClient({ identityBranch: 'br-purple-bar-aphafrgp' });
  await assert.rejects(
    () => verifySchemaFromZero({
      options: options(),
      rootDir: ROOT_DIR,
      manifest,
      verifyRepository: async () => repositoryPass(),
      clientFactory: () => client,
      readFile: async () => '-- should not be read',
    }),
    /actual branch br-purple-bar-aphafrgp is protected/,
  );
  assert.equal(client.queries.includes('begin'), false);
  assert.equal(client.queries.some((query) => query === '-- should not be read'), false);
});

test('altered reconstructed inputs fail before a database client is created', async () => {
  let clientCreated = false;
  await assert.rejects(
    () => verifySchemaFromZero({
      options: options(),
      rootDir: ROOT_DIR,
      manifest,
      verifyRepository: async () => ({
        ok: false,
        checks: [{ name: 'baseline bytes', ok: false, detail: 'altered 0015 hash' }],
      }),
      clientFactory: () => {
        clientCreated = true;
        return fakeClient();
      },
    }),
    /failed before database connection.*altered 0015 hash/,
  );
  assert.equal(clientCreated, false);
});

test('a non-empty disposable target is rejected before BEGIN', async () => {
  const client = fakeClient({
    emptyRow: { user_relation_count: 1, user_routine_count: 0, additional_user_schema_count: 0, drizzle_schema_exists: false },
  });
  await assert.rejects(
    () => verifySchemaFromZero({
      options: options(),
      rootDir: ROOT_DIR,
      manifest,
      verifyRepository: async () => repositoryPass(),
      clientFactory: () => client,
      readFile: async () => '-- should not be read',
    }),
    /Preflight target is not empty/,
  );
  assert.equal(client.queries.includes('begin'), false);
});

test('disposable reconstruction applies all pinned SQL in one rolled-back transaction', async () => {
  const client = fakeClient();
  let receivedClientConfig;
  const result = await verifySchemaFromZero({
    options: options(),
    rootDir: ROOT_DIR,
    manifest,
    verifyRepository: async () => repositoryPass(),
    clientFactory: (clientConfig) => {
      receivedClientConfig = clientConfig;
      return client;
    },
    readFile: async (filePath) => `-- fixture ${filePath}`,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'validated-and-rolled-back');
  assert.equal(result.appliedFileCount, 28);
  assert.deepEqual(receivedClientConfig, {
    host: DISPOSABLE_HOST,
    port: 5432,
    user: 'test-role',
    password: 'test-password',
    database: 'neondb',
    ssl: { rejectUnauthorized: true },
  });
  assert.equal(client.queries.filter((query) => String(query).startsWith('-- fixture ')).length, 28);
  assert.ok(client.queries.indexOf('begin') < client.queries.indexOf('rollback'));
  assert.equal(client.queries.filter((query) => query === SCHEMA_FROM_ZERO_EMPTY_SQL).length, 2);
});

test('catalog mismatch still rolls back and leaves the disposable target empty', async () => {
  const client = fakeClient({ catalog: catalogRow({ index_catalog_md5: 'altered' }) });
  await assert.rejects(
    () => verifySchemaFromZero({
      options: options(),
      rootDir: ROOT_DIR,
      manifest,
      verifyRepository: async () => repositoryPass(),
      clientFactory: () => client,
      readFile: async (filePath) => `-- fixture ${filePath}`,
    }),
    /Reconstructed catalog mismatch/,
  );
  assert.equal(client.queries.includes('rollback'), true);
  assert.equal(client.queries.filter((query) => query === SCHEMA_FROM_ZERO_EMPTY_SQL).length, 2);
});
