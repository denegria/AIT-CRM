import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  attachQaBranch,
  createQaBranch,
  destroyQaBranch,
  listExpiredQaBranches,
  readQaBranchStatus,
  safePreviewEnvironment,
  verifyQaBranch,
} from './lib/qa-db-branch-workflow.mjs';

const NOW = new Date('2026-07-17T18:00:00.000Z');
const BASE_OPTIONS = Object.freeze({
  issue: 'MIS-313',
  owner: 'Alvaro',
  purpose: 'Validate a bounded import',
  projectId: 'project-1',
  parentBranch: 'br-production',
  protectedBranchIds: 'br-production,br-staging',
  previewBranch: 'qa/mis-313-import',
  branchName: 'qa-mis-313-import',
  ttlHours: 24,
});

async function tempRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ait-crm-qa-branch-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function neonCreateResult() {
  return JSON.stringify({
    branch: {
      id: 'br-temporary',
      name: 'qa-mis-313-import',
      parent_id: 'br-production',
    },
  });
}

async function createManifest(t, runOverride) {
  const rootDir = await tempRoot(t);
  const calls = [];
  const run = runOverride || (async (command, args, options = {}) => {
    calls.push({ command, args, options });
    return { stdout: neonCreateResult(), stderr: '', code: 0 };
  });
  const result = await createQaBranch({ ...BASE_OPTIONS, rootDir, execute: true }, {
    now: () => new Date(NOW),
    run,
  });
  return { rootDir, manifestPath: result.manifestPath, calls };
}

test('create is a dry-run by default and requires both protected branch IDs', async () => {
  let called = false;
  const result = await createQaBranch(BASE_OPTIONS, {
    now: () => new Date(NOW),
    run: async () => {
      called = true;
      throw new Error('must not run');
    },
  });

  assert.equal(result.execute, false);
  assert.equal(result.branchName, 'qa-mis-313-import');
  assert.equal(result.expiresAt, '2026-07-18T18:00:00.000Z');
  assert.equal(called, false);

  await assert.rejects(
    () => createQaBranch({ ...BASE_OPTIONS, protectedBranchIds: 'br-production' }),
    /production and persistent staging/,
  );
});

test('create pins Neon CLI, sets provider expiry, and writes no connection string', async (t) => {
  const { manifestPath, calls } = await createManifest(t);
  const manifestText = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'npx');
  assert.equal(calls[0].args.includes('neonctl@2.34.0'), true);
  assert.equal(calls[0].args.includes('--expires-at'), true);
  assert.equal(manifest.neon.branchId, 'br-temporary');
  assert.equal(manifest.neon.parentBranchId, 'br-production');
  assert.equal(manifest.preview.gitBranch, 'qa/mis-313-import');
  assert.equal(manifestText.includes('postgresql://'), false);
});

test('attach passes DATABASE_URL over stdin and installs branch-scoped no-I/O flags', async (t) => {
  const { manifestPath } = await createManifest(t);
  const calls = [];
  const connectionString = 'postgresql://test-role@ep-temp.us-east-2.aws.neon.tech/neondb?sslmode=require';
  const result = await attachQaBranch({ manifestPath, vercelProject: 'ait-crm', execute: true }, {
    now: () => new Date(NOW),
    run: async (command, args, options = {}) => {
      calls.push({ command, args, options });
      if (args.some((arg) => String(arg).startsWith('neonctl@'))) {
        return { stdout: connectionString, stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    },
  });

  assert.equal(result.attached, true);
  const databaseCall = calls.find((call) => call.args.includes('DATABASE_URL'));
  assert.ok(databaseCall);
  assert.equal(databaseCall.args.includes(connectionString), false);
  assert.equal(databaseCall.options.input, `${connectionString}\n`);
  assert.equal(databaseCall.args.includes('preview'), true);
  assert.equal(databaseCall.args.includes('qa/mis-313-import'), true);

  const safety = safePreviewEnvironment();
  for (const [key, value] of Object.entries(safety)) {
    const call = calls.find((candidate) => candidate.args.includes(key));
    assert.ok(call, `missing Vercel env call for ${key}`);
    assert.equal(call.options.input, `${value}\n`);
  }
});

test('partial attach records each applied override for deterministic cleanup', async (t) => {
  const { manifestPath } = await createManifest(t);
  let vercelCalls = 0;
  await assert.rejects(
    () => attachQaBranch({ manifestPath, execute: true }, {
      now: () => new Date(NOW),
      run: async (command, args) => {
        if (args.some((arg) => String(arg).startsWith('neonctl@'))) {
          return {
            stdout: 'postgresql://test-role@ep-temp.us-east-2.aws.neon.tech/neondb?sslmode=require',
            stderr: '',
            code: 0,
          };
        }
        vercelCalls += 1;
        if (vercelCalls === 2) throw new Error('simulated Vercel failure');
        return { stdout: '', stderr: '', code: 0 };
      },
    }),
    /simulated Vercel failure/,
  );

  const status = await readQaBranchStatus({ manifestPath });
  assert.equal(status.status, 'attaching');
  assert.deepEqual(status.preview.environmentKeys, ['AIT_CRM_EXTERNAL_IO_DISABLED']);
  assert.equal(status.preview.externalIoDisabled, true);
});

test('attach refuses a tampered manifest that targets a protected Neon branch', async (t) => {
  const { manifestPath } = await createManifest(t);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.neon.branchId = 'br-production';
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  let called = false;
  await assert.rejects(
    () => attachQaBranch({ manifestPath, execute: true }, {
      now: () => new Date(NOW),
      run: async () => {
        called = true;
        throw new Error('must not run');
      },
    }),
    /protected Neon branch/,
  );
  assert.equal(called, false);
});

test('verify checks branch identity, required tables, RBAC membership, and migration journal', async (t) => {
  const { manifestPath } = await createManifest(t);
  await attachQaBranch({ manifestPath, execute: true }, {
    now: () => new Date(NOW),
    run: async (command, args) => ({
      stdout: args.some((arg) => String(arg).startsWith('neonctl@'))
        ? 'postgresql://test-role@ep-temp.us-east-2.aws.neon.tech/neondb?sslmode=require'
        : '',
      stderr: '',
      code: 0,
    }),
  });

  const queries = [];
  const fakeClient = {
    async connect() {},
    async end() {},
    async query(sql) {
      queries.push(sql);
      if (sql.includes("current_setting('neon.branch_id'")) {
        return { rows: [{ database: 'neondb', neon_branch_id: 'br-temporary', neon_project_id: 'project-1' }], rowCount: 1 };
      }
      if (sql.includes('information_schema.tables')) {
        return {
          rows: [
            'organizations', 'business_units', 'users', 'contacts', 'leads', 'work_orders',
            'estimates', 'import_batches', 'class_sections', 'class_sessions', 'attendance_records',
          ].map((table_name) => ({ table_name })),
          rowCount: 11,
        };
      }
      if (sql.includes('pg_constraint')) return { rows: [{ count: 0 }], rowCount: 1 };
      if (sql.includes('business_unit_memberships')) return { rows: [], rowCount: 0 };
      if (sql.includes('drizzle.__drizzle_migrations')) return { rows: [{ id: 26 }], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const result = await verifyQaBranch({ manifestPath }, {
    now: () => new Date('2026-07-17T18:10:00.000Z'),
    run: async () => ({
      stdout: 'postgresql://test-role@ep-temp.us-east-2.aws.neon.tech/neondb?sslmode=require',
      stderr: '',
      code: 0,
    }),
    clientFactory: () => fakeClient,
  });

  assert.equal(result.verified, true);
  assert.equal(result.verification.neonBranchId, 'br-temporary');
  assert.equal(result.verification.externalIoDisabled, true);
  assert.equal(result.verification.requiredTableCount, 11);
  assert.equal(queries.length, 5);
});

test('destroy requires exact confirmation, removes preview overrides, then deletes only the temporary branch', async (t) => {
  const { manifestPath } = await createManifest(t);
  await attachQaBranch({ manifestPath, execute: true }, {
    now: () => new Date(NOW),
    run: async (command, args) => ({
      stdout: args.some((arg) => String(arg).startsWith('neonctl@'))
        ? 'postgresql://test-role@ep-temp.us-east-2.aws.neon.tech/neondb?sslmode=require'
        : '',
      stderr: '',
      code: 0,
    }),
  });

  await assert.rejects(
    () => destroyQaBranch({ manifestPath, confirmBranch: 'qa-wrong', execute: true }),
    /exactly match/,
  );

  const calls = [];
  const result = await destroyQaBranch({
    manifestPath,
    confirmBranch: 'qa-mis-313-import',
    execute: true,
  }, {
    now: () => new Date('2026-07-17T19:00:00.000Z'),
    run: async (command, args) => {
      calls.push({ command, args });
      return { stdout: '{}', stderr: '', code: 0 };
    },
  });

  assert.equal(result.destroyed, true);
  const deleteCall = calls.at(-1);
  assert.equal(deleteCall.args.includes('branches'), true);
  assert.equal(deleteCall.args.includes('delete'), true);
  assert.equal(deleteCall.args.includes('br-temporary'), true);
  assert.equal(deleteCall.args.includes('br-production'), false);
  assert.equal(calls.slice(0, -1).every((call) => call.args.includes('preview')), true);
});

test('expired reports undeleted manifests after their provider TTL', async (t) => {
  const { rootDir } = await createManifest(t);
  const expired = await listExpiredQaBranches({ rootDir }, {
    now: () => new Date('2026-07-19T18:00:00.000Z'),
  });
  assert.equal(expired.length, 1);
  assert.equal(expired[0].branchName, 'qa-mis-313-import');
});
