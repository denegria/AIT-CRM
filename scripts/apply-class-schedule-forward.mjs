import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { CATALOG_FINGERPRINT_SQL, compareCatalogFingerprint, loadSchemaManifest, sha256 } from './lib/schema-readiness.mjs';
import { loadForwardSchemaManifest, verifyForwardSchemaRepository } from './lib/forward-schema.mjs';
import { PRODUCTION_DATABASE_IDENTITY_SQL } from './lib/production-readiness.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const beforeStaging = Object.freeze({
  tableCount: 62, tableNameMd5: '495b7b545ae0aeda85b03bc9329a1b11',
  columnCount: 903, columnCatalogMd5: '47798c91bc58f21180a6680f4c583213',
  logicalColumnCatalogMd5: 'ba3e5475760a84aa8f6b65ea7e5ce63b',
  indexCount: 203, indexCatalogMd5: 'ddb7380eb60b44bc2490eda43f41050d',
  constraintCount: 347, constraintCatalogMd5: '2142b28928c7b936187223e5507e8e61',
});
const beforeProduction = { ...beforeStaging, columnCatalogMd5: '9c10c649d92962ae3a6f69f3144a7bab' };

function connection(raw, baseline, target) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('A valid database URL is required.'); }
  const approved = baseline.database.protectedTargets.find((item) => item.label === target);
  if (!approved || !['postgres:', 'postgresql:'].includes(url.protocol) || url.hash
      || !approved.hosts.includes(url.hostname) || url.hostname.includes('-pooler.')
      || [...url.searchParams.keys()].join(',') !== 'sslmode' || url.searchParams.get('sslmode') !== 'verify-full'
      || decodeURIComponent(url.pathname.slice(1)) !== baseline.database.databaseName || !url.username || !url.password) {
    throw new Error('Direct Neon target does not match the pinned database contract.');
  }
  return { safe: { target, projectId: baseline.database.neonProjectId, branchId: approved.branchId,
    database: baseline.database.databaseName, schema: 'public', hostSuffix: url.hostname.slice(url.hostname.indexOf('.')) },
  config: { connectionString: raw, ssl: { rejectUnauthorized: true } } };
}

async function main() {
  const target = process.env.FORWARD_MIGRATION_TARGET;
  if (!['staging', 'production'].includes(target)) throw new Error('Target must be staging or production.');
  const baseline = await loadSchemaManifest(root);
  const forward = await loadForwardSchemaManifest(root);
  const repository = await verifyForwardSchemaRepository({ rootDir: root, manifest: forward });
  if (!repository.ok) throw new Error('Pinned forward schema repository verification failed.');
  const migration = forward.repository.forwardMigrations.find((entry) => entry.identifier === '0032');
  if (!migration) throw new Error('Migration 0032 is not pinned.');
  const { config, safe } = connection(process.env.FORWARD_MIGRATION_DATABASE_URL, baseline, target);
  const confirmation = `APPLY:0032:${safe.projectId}:${safe.branchId}:${safe.database}`;
  if (process.env.FORWARD_MIGRATION_CONFIRM !== confirmation) throw new Error(`Confirmation must be ${confirmation}.`);
  const execute = process.env.FORWARD_MIGRATION_EXECUTE === '1';
  console.log(JSON.stringify({ fingerprint: safe, targetBaseUrl: process.env.FORWARD_MIGRATION_BASE_URL || null,
    migrationId: '0032', execute }));

  const client = new Client(config);
  await client.connect();
  let transaction = false;
  try {
    await client.query('begin'); transaction = true;
    await client.query("select pg_advisory_xact_lock(hashtextextended('ait-crm-forward-schema', 0))");
    const { rows: [identity] } = await client.query(PRODUCTION_DATABASE_IDENTITY_SQL);
    if (identity.database !== safe.database || identity.neon_project_id !== safe.projectId
      || identity.neon_branch_id !== safe.branchId) throw new Error('Connected Neon identity rejected.');
    const { rows: [before] } = await client.query(CATALOG_FINGERPRINT_SQL);
    if (compareCatalogFingerprint(before, target === 'staging' ? beforeStaging : beforeProduction).length) {
      throw new Error('Pre-migration catalog differs from the pinned baseline.');
    }
    const ledger = forward.repository.migrationLedger;
    const { rows } = await client.query(`select identifier, sha256 from ${ledger.schema}.${ledger.table} order by identifier`);
    const expected = [
      { identifier: ledger.baselineMarker, sha256: forward.priorBaseline.canonicalSha256 },
      ...forward.repository.forwardMigrations.filter((entry) => Number(entry.identifier) < 32
        && (target === 'production' || entry.identifier !== '0029'))
        .map((entry) => ({ identifier: entry.identifier, sha256: entry.sha256 })),
    ].sort((left, right) => left.identifier.localeCompare(right.identifier));
    if (JSON.stringify(rows) !== JSON.stringify(expected)) throw new Error('Forward migration ledger differs from the pinned target.');
    if (!execute) { await client.query('rollback'); transaction = false; console.log(JSON.stringify({ preflight: 'passed', executed: false })); return; }
    const sql = await fs.readFile(path.join(root, migration.path), 'utf8');
    if (sha256(sql) !== migration.sha256) throw new Error('Migration 0032 byte hash mismatch.');
    await client.query(sql);
    await client.query(`insert into ${ledger.schema}.${ledger.table} (identifier, sha256) values ($1, $2)`,
      [migration.identifier, migration.sha256]);
    const { rows: [after] } = await client.query(CATALOG_FINGERPRINT_SQL);
    const expectedAfter = target === 'staging' ? forward.database.catalog.expectedStaging : forward.database.catalog.expectedLive;
    if (compareCatalogFingerprint(after, expectedAfter).length) throw new Error('Post-migration catalog fingerprint rejected.');
    await client.query('commit'); transaction = false;
    console.log(JSON.stringify({ result: 'applied', target, migrationId: '0032' }));
  } finally {
    if (transaction) await client.query('rollback').catch(() => {});
    await client.end();
  }
}

try { await main(); } catch (error) {
  console.error(`Class schedule migration stopped: ${error.message?.startsWith('Confirmation must') ? error.message : 'preflight or execution failed; inspect target and sanitized code.'}`);
  process.exitCode = 1;
}
