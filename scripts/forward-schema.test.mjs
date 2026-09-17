import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CATALOG_FINGERPRINT_SQL,
  SQL_ONLY_INDEXES_SQL,
  loadSchemaManifest,
  runDrizzleExport,
} from './lib/schema-readiness.mjs';
import {
  FORWARD_SCHEMA_MANIFEST_CANONICAL_SHA256,
  loadForwardSchemaManifest,
  verifyForwardSchemaRepository,
} from './lib/forward-schema.mjs';
import {
  validateForwardTarget,
  verifyForwardSchemaOnDisposable,
} from './lib/forward-schema-validation.mjs';
import {
  SCHEMA_FROM_ZERO_EMPTY_SQL,
  SCHEMA_FROM_ZERO_IDENTITY_SQL,
} from './lib/schema-from-zero.mjs';

const ROOT_DIR = fileURLToPath(new URL('../', import.meta.url));
const PROJECT_ID = 'polished-dust-24407788';
const BRANCH_ID = 'br-mute-butterfly-au92lb41';
const HOST = 'ep-disposable-proof.c-10.us-east-1.aws.neon.tech';

function options(overrides = {}) {
  return {
    databaseUrl: `postgresql://validator:not-a-real-password@${HOST}/neondb?sslmode=verify-full`,
    expectedHost: HOST,
    expectedProjectId: PROJECT_ID,
    expectedBranchId: BRANCH_ID,
    targetLabel: 'qa-mis-414-ledger',
    confirmation: `MIS-414_FORWARD:${PROJECT_ID}:${BRANCH_ID}:neondb`,
    execute: true,
    capture: false,
    ...overrides,
  };
}

function catalogRow(expected) {
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

function sqlOnlyIndexRows(baseline) {
  return baseline.database.sqlOnlyIndexes.map((entry) => ({
    tablename: entry.table,
    indexname: entry.name,
    indexdef: entry.indexDefinition,
  }));
}

function fakeDisposableClient({ baseline, forward }) {
  const commands = [];
  let emptyChecks = 0;
  return {
    commands,
    async connect() { commands.push('connect'); },
    async end() { commands.push('end'); },
    async query(sql) {
      commands.push(sql);
      if (sql === SCHEMA_FROM_ZERO_IDENTITY_SQL) {
        return { rows: [{ database: 'neondb', schema: 'public', neon_project_id: PROJECT_ID, neon_branch_id: BRANCH_ID }] };
      }
      if (sql === SCHEMA_FROM_ZERO_EMPTY_SQL) {
        emptyChecks += 1;
        return { rows: [{ user_relation_count: '0', user_routine_count: '0', additional_user_schema_count: '0', drizzle_schema_exists: false }] };
      }
      if (sql === CATALOG_FINGERPRINT_SQL) return { rows: [catalogRow(forward.database.catalog.expected)] };
      if (sql === SQL_ONLY_INDEXES_SQL) return { rows: sqlOnlyIndexRows(baseline) };
      return { rows: [] };
    },
    get emptyChecks() { return emptyChecks; },
  };
}

test('forward manifest and current Drizzle export reproduce the pinned lineage', async () => {
  const manifest = await loadForwardSchemaManifest(ROOT_DIR);
  const rawExport = await runDrizzleExport(ROOT_DIR);
  const report = await verifyForwardSchemaRepository({
    rootDir: ROOT_DIR,
    manifest,
    exportRunner: async () => rawExport,
  });
  assert.equal(report.ok, true, report.checks.filter((check) => !check.ok).map((check) => check.detail).join('\n'));
  assert.equal(report.manifestSha256, FORWARD_SCHEMA_MANIFEST_CANONICAL_SHA256);
  assert.deepEqual(manifest.repository.forwardMigrations.map((entry) => entry.identifier), ['0027']);
});

test('forward target guard rejects execution without every exact disposable-target assertion', () => {
  assert.throws(() => validateForwardTarget(options({ execute: false })), /FORWARD_SCHEMA_EXECUTE=1/);
  assert.throws(() => validateForwardTarget(options({ expectedHost: 'ep-wrong.c-10.us-east-1.aws.neon.tech' })), /exactly match/);
  assert.throws(() => validateForwardTarget(options({ targetLabel: 'staging' })), /qa-mis-414/);
  assert.throws(() => validateForwardTarget(options({ confirmation: 'yes' })), /must exactly equal/);
  const accepted = validateForwardTarget(options());
  assert.equal(accepted.safeTarget.expectedProjectId, PROJECT_ID);
  assert.equal(accepted.safeTarget.expectedBranchId, BRANCH_ID);
});

test('disposable validation always rolls back and proves the target is empty afterward', async () => {
  const baseline = await loadSchemaManifest(ROOT_DIR);
  const forward = await loadForwardSchemaManifest(ROOT_DIR);
  const client = fakeDisposableClient({ baseline, forward });
  const result = await verifyForwardSchemaOnDisposable({
    options: options(),
    rootDir: ROOT_DIR,
    baseline,
    forward,
    clientFactory: () => client,
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'validated-and-rolled-back');
  assert.equal(client.commands.filter((command) => command === 'begin').length, 1);
  assert.equal(client.commands.filter((command) => command === 'rollback').length, 1);
  assert.equal(client.emptyChecks, 2);
  assert.equal(client.commands.at(-1), 'end');
});
