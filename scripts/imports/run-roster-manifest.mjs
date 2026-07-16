import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { validateRosterManifest, validateRosterManifestApproval } from '../../src/lib/roster-import/manifest.js';
import { buildRosterImportPlan } from '../../src/lib/roster-import/planner.js';
import { inspectContactMerge } from '../../src/lib/contact-merge/service.js';
import {
  applyRosterImportPlan,
  loadRosterImportSnapshot,
  resolveRosterImportScope,
} from '../../src/lib/roster-import/postgres.js';

function argsFrom(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) args[key.slice(2)] = true;
    else {
      args[key.slice(2)] = value;
      index += 1;
    }
  }
  return args;
}

function sha256File(file) {
  const digest = crypto.createHash('sha256');
  digest.update(fs.readFileSync(file));
  return digest.digest('hex');
}

function writePrivateJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

const args = argsFrom(process.argv.slice(2));
const mode = args.mode || 'dry-run';
if (!['dry-run', 'apply'].includes(mode)) throw new Error('Mode must be dry-run or apply.');
if (!args.manifest || !args['source-workbook'] || !args.output) {
  throw new Error('--manifest, --source-workbook, and --output are required.');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
validateRosterManifest(manifest, {
  maxAgeMs: mode === 'apply' ? 48 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000,
});
if (sha256File(args['source-workbook']) !== manifest.sourceWorkbook?.sha256) {
  throw new Error('Source workbook checksum does not match the execution manifest.');
}

const databaseUrl = new URL(process.env.DATABASE_URL);
if (mode === 'apply' && args['confirm-target-host'] !== databaseUrl.hostname) {
  throw new Error('Apply requires --confirm-target-host to exactly match the database hostname.');
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const scope = await resolveRosterImportScope(client, manifest.sourceProductionFingerprint.businessUnitName);
  const snapshot = await loadRosterImportSnapshot(client, scope);
  const plan = buildRosterImportPlan(manifest, snapshot, {
    maxAgeMs: mode === 'apply' ? 48 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000,
  });
  plan.contactMergeInspections = [];
  for (const action of plan.contactActions.filter((item) => item.operation === 'merge_contacts')) {
    for (const sourceContactId of action.duplicateContactIds) {
      try {
        const inspection = await inspectContactMerge(client, {
          organizationId: scope.organizationId,
          sourceContactId,
          targetContactId: action.targetContactId,
        });
        plan.contactMergeInspections.push({
          idempotencyKey: `${action.idempotencyKey}:merge:${sourceContactId}`,
          sourceContactId,
          targetContactId: action.targetContactId,
          approvalEligible: inspection.approvalEligible,
          relationshipInventory: inspection.inventory,
        });
        if (!inspection.approvalEligible) {
          plan.blockers.push(`Contact merge source ${sourceContactId} is not eligible.`);
        }
      } catch (error) {
        plan.blockers.push(`Contact merge ${sourceContactId} -> ${action.targetContactId}: ${error.message}`);
      }
    }
  }
  plan.approvalEligible = plan.blockers.length === 0;
  const target = {
    host: databaseUrl.hostname,
    database: databaseUrl.pathname.slice(1),
    schema: 'public',
    organizationId: scope.organizationId,
    businessUnitId: scope.businessUnitId,
    businessUnitName: scope.businessUnitName,
  };

  if (mode === 'dry-run') {
    const report = { mode, target, plan };
    writePrivateJson(args.output, report);
    console.log(JSON.stringify({
      mode,
      manifestId: plan.manifestId,
      manifestSha256: plan.manifestSha256,
      lane: plan.lane,
      approvalEligible: plan.approvalEligible,
      blockerCount: plan.blockers.length,
      counts: plan.counts,
      output: args.output,
      dataChanged: false,
    }, null, 2));
  } else {
    if (!args.approval) throw new Error('Apply requires --approval.');
    const approval = JSON.parse(fs.readFileSync(args.approval, 'utf8'));
    validateRosterManifestApproval(manifest, approval, process.env.AIT_CRM_IMPORT_APPROVAL_SECRET);
    const result = await applyRosterImportPlan(client, {
      scope,
      manifest,
      approval,
      plan,
      actorUserId: args['actor-user-id'] || null,
    });
    const report = { mode, target, result };
    writePrivateJson(args.output, report);
    console.log(JSON.stringify({
      mode,
      manifestId: manifest.manifestId,
      status: result.status,
      replay: result.replay,
      output: args.output,
      dataChanged: !result.replay,
    }, null, 2));
  }
} finally {
  await client.end();
}
