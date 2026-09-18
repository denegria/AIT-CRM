import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  analyzeDrizzleExport,
  canonicalManifestSha256,
  runDrizzleExport,
  sha256,
} from './schema-readiness.mjs';

export const FORWARD_SCHEMA_MANIFEST_RELATIVE_PATH = 'drizzle/forward-schema-manifest.json';
export const ACCEPTED_RECONCILED_MANIFEST_SHA256 = '92f0bb1dbc8b7afc1dc0af57fb11dda11d7cc05c83b4b16bd3301f7cf23cb675';
export const FORWARD_SCHEMA_MANIFEST_CANONICAL_SHA256 = 'c2dee0fed45ba218bfcd23a3c7ba5a7b2868a3f8097518765f5b7b1dc38fc728';
const defaultRootDir = fileURLToPath(new URL('../../', import.meta.url));

export async function loadForwardSchemaManifest(rootDir = defaultRootDir) {
  return JSON.parse(await fs.readFile(path.join(rootDir, FORWARD_SCHEMA_MANIFEST_RELATIVE_PATH), 'utf8'));
}

function migrationNumber(entry) {
  return Number(entry.identifier);
}

function same(label, expected, actual, errors) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) errors.push(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

export async function verifyForwardSchemaRepository({
  rootDir = defaultRootDir,
  manifest,
  exportRunner = runDrizzleExport,
  requireDatabaseFingerprint = true,
  requireCanonicalManifest = true,
} = {}) {
  const resolved = manifest || await loadForwardSchemaManifest(rootDir);
  const checks = [];
  const contractErrors = [];
  same('formatVersion', 1, resolved.formatVersion, contractErrors);
  same('prior baseline sha256', ACCEPTED_RECONCILED_MANIFEST_SHA256, resolved.priorBaseline?.canonicalSha256, contractErrors);
  same('first forward migration', 27, resolved.priorBaseline?.firstForwardMigration, contractErrors);
  same('migration ledger schema', 'ait_crm_migrations', resolved.repository?.migrationLedger?.schema, contractErrors);
  same('migration ledger table', 'forward_migrations', resolved.repository?.migrationLedger?.table, contractErrors);
  if (requireCanonicalManifest) {
    same('canonical manifest sha256', FORWARD_SCHEMA_MANIFEST_CANONICAL_SHA256, canonicalManifestSha256(resolved), contractErrors);
  }
  if (requireDatabaseFingerprint && !resolved.database?.catalog?.expected) contractErrors.push('database.catalog.expected is not pinned');
  checks.push({
    name: 'forward lineage chains to the accepted reconciled baseline',
    ok: contractErrors.length === 0,
    detail: contractErrors.join('; ') || `${resolved.lineageId} starts at 0027`,
  });

  const migrationErrors = [];
  const migrations = resolved.repository?.forwardMigrations || [];
  for (let index = 0; index < migrations.length; index += 1) {
    const entry = migrations[index];
    const expected = resolved.priorBaseline.firstForwardMigration + index;
    same(`forward migration ${index} number`, expected, migrationNumber(entry), migrationErrors);
    same(`${entry.path} provenance`, 'forward-migration', entry.provenance, migrationErrors);
    if (path.posix.basename(entry.path).slice(0, 4) !== entry.identifier) migrationErrors.push(`${entry.path} does not match identifier ${entry.identifier}`);
  }
  checks.push({
    name: 'forward migration identifiers are unique and contiguous',
    ok: migrationErrors.length === 0,
    detail: migrationErrors.join('; ') || migrations.map((entry) => entry.identifier).join(', '),
  });

  const digestErrors = [];
  for (const entry of [resolved.repository.schema, ...migrations]) {
    try {
      const bytes = await fs.readFile(path.join(rootDir, entry.path));
      same(`${entry.path} sha256`, entry.sha256, sha256(bytes), digestErrors);
    } catch (error) {
      digestErrors.push(`${entry.path}: ${error.code === 'ENOENT' ? 'missing' : error.message}`);
    }
  }
  checks.push({
    name: 'current schema and forward migration bytes match the forward manifest',
    ok: digestErrors.length === 0,
    detail: digestErrors.join('; ') || `${migrations.length + 1} pinned files`,
  });

  const exportErrors = [];
  let rawExport = Buffer.alloc(0);
  try {
    rawExport = await exportRunner(rootDir);
    if (!Buffer.isBuffer(rawExport)) rawExport = Buffer.from(rawExport);
    same('Drizzle raw stdout sha256', resolved.repository.drizzleExport.rawStdoutSha256, sha256(rawExport), exportErrors);
    const shape = analyzeDrizzleExport(rawExport);
    for (const [key, expected] of Object.entries(resolved.repository.drizzleExport.structure)) {
      same(`Drizzle export ${key}`, expected, shape[key], exportErrors);
    }
  } catch (error) {
    exportErrors.push(error.message);
  }
  checks.push({
    name: 'current Drizzle export matches the forward schema fingerprint',
    ok: exportErrors.length === 0,
    detail: exportErrors.join('; ') || resolved.repository.drizzleExport.rawStdoutSha256,
  });

  return {
    ok: checks.every((check) => check.ok),
    checks,
    manifest: resolved,
    manifestSha256: canonicalManifestSha256(resolved),
  };
}
