import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { loadSchemaManifest, CATALOG_FINGERPRINT_SQL, compareCatalogFingerprint, sha256 } from './lib/schema-readiness.mjs';
import { loadForwardSchemaManifest, verifyForwardSchemaRepository } from './lib/forward-schema.mjs';
import { PRODUCTION_DATABASE_IDENTITY_SQL } from './lib/production-readiness.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const PRE_CLASS_PRICING_CATALOG = Object.freeze({
  tableCount: 59,
  tableNameMd5: 'eafbb3ee2a8f09904a27ea8340550546',
  columnCount: 860,
  logicalColumnCatalogMd5: '600dc84843192b9731b66398c6d95477',
  indexCount: 194,
  indexCatalogMd5: '91fef6aa16fa079f75f8d333bf64ad3a',
  constraintCount: 329,
  constraintCatalogMd5: '4eec57fa87be62e56c96e66c4f6ac3ec',
});

function connectionConfig(raw, baseline, target) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('A valid forward migration database URL is required.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hash) throw new Error('Forward migration URL format rejected.');
  const names = [...url.searchParams.keys()];
  if (names.length !== 1 || names[0] !== 'sslmode' || url.searchParams.get('sslmode') !== 'verify-full') {
    throw new Error('Forward migration requires only sslmode=verify-full.');
  }
  const approved = baseline.database.protectedTargets.find((item) => item.label === target);
  if (!approved || !approved.hosts.includes(url.hostname) || url.hostname.includes('-pooler.')) throw new Error('Direct Neon host is not approved for this target.');
  const database = decodeURIComponent(url.pathname.slice(1));
  if (database !== baseline.database.databaseName || !url.username || !url.password) throw new Error('Forward migration database or credentials rejected.');
  return {
    config: { host: url.hostname, port: url.port ? Number(url.port) : 5432,
      database, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
      ssl: { rejectUnauthorized: true } },
    safe: { target, host: url.hostname, projectId: baseline.database.neonProjectId,
      branchId: approved.branchId, database, schema: 'public' },
  };
}

function assertExactLedger(rows, expected) {
  const actual = rows.map(({ identifier, sha256: digest }) => ({ identifier, sha256: digest }));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Existing forward ledger does not match the pinned target baseline.');
}

async function main() {
  const target = process.env.FORWARD_MIGRATION_TARGET;
  if (!['staging', 'production'].includes(target)) throw new Error('FORWARD_MIGRATION_TARGET must be staging or production.');
  const baseline = await loadSchemaManifest(root);
  const forward = await loadForwardSchemaManifest(root);
  const repository = await verifyForwardSchemaRepository({ rootDir: root, manifest: forward });
  if (!repository.ok) throw new Error('Pinned forward schema repository verification failed.');
  const { config, safe } = connectionConfig(process.env.FORWARD_MIGRATION_DATABASE_URL, baseline, target);
  const confirm = `APPLY:0030-0031:${safe.projectId}:${safe.branchId}:${safe.database}`;
  if (process.env.FORWARD_MIGRATION_CONFIRM !== confirm) throw new Error(`Confirmation must be ${confirm}.`);
  console.log(JSON.stringify({ fingerprint: safe, targetBaseUrl: process.env.FORWARD_MIGRATION_BASE_URL || null,
    migrationIds: ['0030', '0031'], execute: process.env.FORWARD_MIGRATION_EXECUTE === '1' }));
  const client = new Client(config);
  await client.connect();
  let inTransaction = false;
  try {
    await client.query('begin');
    inTransaction = true;
    await client.query("select pg_advisory_xact_lock(hashtextextended('ait-crm-forward-schema', 0))");
    const { rows: [identity] } = await client.query(PRODUCTION_DATABASE_IDENTITY_SQL);
    if (identity.database !== safe.database || identity.neon_project_id !== safe.projectId || identity.neon_branch_id !== safe.branchId) {
      throw new Error('Connected Neon project, branch, or database identity rejected.');
    }
    const { rows: [before] } = await client.query(CATALOG_FINGERPRINT_SQL);
    const drift = compareCatalogFingerprint(before, PRE_CLASS_PRICING_CATALOG);
    if (drift.length) throw new Error(`Pre-migration catalog mismatch: ${drift.join('; ')}`);
    const ledger = forward.repository.migrationLedger;
    const { rows } = await client.query(`select identifier, sha256 from ${ledger.schema}.${ledger.table} order by identifier`);
    const expected = [
      { identifier: ledger.baselineMarker, sha256: forward.priorBaseline.canonicalSha256 },
      ...forward.repository.forwardMigrations.filter((entry) => target === 'production' ? Number(entry.identifier) <= 29 : Number(entry.identifier) <= 28)
        .map(({ identifier, sha256: digest }) => ({ identifier, sha256: digest })),
    ].sort((a, b) => a.identifier.localeCompare(b.identifier));
    assertExactLedger(rows, expected);
    if (process.env.FORWARD_MIGRATION_EXECUTE !== '1') {
      console.log(JSON.stringify({ preflight: 'passed', executed: false, staging0029LedgerGap: target === 'staging' }));
      await client.query('rollback');
      inTransaction = false;
      return;
    }
    for (const entry of forward.repository.forwardMigrations.filter(({ identifier }) => ['0030', '0031'].includes(identifier))) {
      const sql = await fs.readFile(path.join(root, entry.path), 'utf8');
      if (sha256(sql) !== entry.sha256) throw new Error(`Migration ${entry.identifier} byte hash mismatch.`);
      await client.query(sql);
      await client.query(`insert into ${ledger.schema}.${ledger.table} (identifier, sha256) values ($1, $2)`, [entry.identifier, entry.sha256]);
    }
    const { rows: [after] } = await client.query(CATALOG_FINGERPRINT_SQL);
    const expectedAfter = target === 'staging' ? forward.database.catalog.expectedStaging : forward.database.catalog.expectedLive;
    const afterDrift = compareCatalogFingerprint(after, expectedAfter);
    if (afterDrift.length) throw new Error(`Post-migration catalog mismatch: ${afterDrift.join('; ')}`);
    await client.query('commit');
    inTransaction = false;
    console.log(JSON.stringify({ result: 'applied', target, migrations: ['0030', '0031'], staging0029LedgerGap: target === 'staging' }));
  } finally {
    if (inTransaction) await client.query('rollback').catch(() => {});
    await client.end();
  }
}

try { await main(); } catch (error) {
  // Never render connection strings or driver exceptions; a DB error can contain SQL parameters.
  console.error(`Forward migration stopped: ${error.message?.startsWith('Pre-migration catalog mismatch:') || error.message?.startsWith('Post-migration catalog mismatch:') ? error.message : 'preflight or execution failed; inspect the sanitized code and target state.'}`);
  process.exitCode = 1;
}
