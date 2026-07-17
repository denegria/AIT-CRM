import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export const NEONCTL_VERSION = '2.34.0';
export const VERCEL_CLI_VERSION = '56.3.1';
export const MANIFEST_VERSION = 1;
export const MAX_TTL_HOURS = 72;

const REQUIRED_TABLES = Object.freeze([
  'organizations',
  'business_units',
  'users',
  'contacts',
  'leads',
  'work_orders',
  'estimates',
  'import_batches',
  'class_sections',
  'class_sessions',
  'attendance_records',
]);

const SAFE_PREVIEW_ENV = Object.freeze({
  AIT_CRM_EXTERNAL_IO_DISABLED: 'true',
  FACEBOOK_LEAD_ADS_AUTO_PROMOTE: 'false',
  SMS_CAMPAIGN_LIVE_SEND_ENABLED: 'false',
  SMS_CAMPAIGN_LIVE_SEND_TEST_MODE: 'false',
  SMS_CAMPAIGN_PRODUCTION_SEND_ENABLED: 'false',
});

const PROTECTED_GIT_BRANCHES = new Set(['main', 'master', 'production', 'prod', 'staging']);

function clean(value) {
  return String(value || '').trim();
}

function required(value, name) {
  const result = clean(value);
  if (!result) throw new Error(`${name} is required.`);
  return result;
}

function parsePositiveInteger(value, name, fallback) {
  const candidate = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return candidate;
}

export function parseProtectedBranchIds(value) {
  const values = Array.isArray(value) ? value : clean(value).split(',');
  return [...new Set(values.map(clean).filter(Boolean))];
}

function assertIssue(issue) {
  const normalized = required(issue, 'issue').toUpperCase();
  if (!/^MIS-\d+$/.test(normalized)) {
    throw new Error('issue must use the MIS-123 format.');
  }
  return normalized;
}

function assertPreviewBranch(branch) {
  const normalized = required(branch, 'previewBranch');
  if (PROTECTED_GIT_BRANCHES.has(normalized.toLowerCase())) {
    throw new Error(`Refusing protected Git branch ${normalized}.`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(normalized)) {
    throw new Error('previewBranch contains unsupported characters.');
  }
  return normalized;
}

function slug(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function compactTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'z').toLowerCase();
}

function defaultBranchName(issue, now) {
  return `qa-${slug(issue)}-${compactTimestamp(now)}`;
}

function assertBranchName(branchName) {
  const normalized = required(branchName, 'branchName');
  if (!normalized.startsWith('qa-')) {
    throw new Error('Temporary Neon branch names must start with qa-.');
  }
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(normalized)) {
    throw new Error('branchName must contain lowercase letters, numbers, or hyphens and be at most 63 characters.');
  }
  return normalized;
}

function safeHostSuffix(connectionString) {
  const parsed = new URL(connectionString);
  return parsed.hostname.split('.').slice(-4).join('.');
}

function parseJsonOutput(stdout, commandName) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`${commandName} returned non-JSON output.`);
  }
}

function normalizeCreatedBranch(payload) {
  const branch = payload?.branch || payload?.data?.branch || payload;
  return {
    id: clean(branch?.id || branch?.branch_id),
    name: clean(branch?.name),
    parentId: clean(branch?.parent_id || branch?.parentId),
  };
}

function manifestDirectory(rootDir) {
  return path.join(rootDir, '.qa-branches');
}

export function defaultManifestPath(rootDir, branchName) {
  return path.join(manifestDirectory(rootDir), `${branchName}.json`);
}

async function writeManifest(manifestPath, manifest, deps) {
  const dir = path.dirname(manifestPath);
  await deps.fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const tempPath = `${manifestPath}.tmp-${process.pid}`;
  await deps.fs.writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await deps.fs.rename(tempPath, manifestPath);
}

async function readManifest(manifestPath, deps) {
  const parsed = JSON.parse(await deps.fs.readFile(manifestPath, 'utf8'));
  if (parsed.version !== MANIFEST_VERSION) {
    throw new Error(`Unsupported manifest version ${parsed.version}.`);
  }
  return parsed;
}

function assertSafeManifest(manifest, now, { allowExpired = false } = {}) {
  const branchName = assertBranchName(manifest?.neon?.branchName);
  const branchId = required(manifest?.neon?.branchId, 'manifest neon.branchId');
  const parentBranchId = required(manifest?.neon?.parentBranchId, 'manifest neon.parentBranchId');
  required(manifest?.neon?.projectId, 'manifest neon.projectId');
  const protectedBranchIds = parseProtectedBranchIds(manifest?.neon?.protectedBranchIds || []);
  if (protectedBranchIds.length < 2 || !protectedBranchIds.includes(parentBranchId)) {
    throw new Error('Manifest does not preserve the approved production and staging branch protections.');
  }
  if (protectedBranchIds.includes(branchId)) {
    throw new Error('Manifest resolves to a protected Neon branch.');
  }
  assertPreviewBranch(manifest?.preview?.gitBranch);
  const expiresAt = new Date(required(manifest?.expiresAt, 'manifest expiresAt'));
  if (Number.isNaN(expiresAt.getTime())) throw new Error('Manifest expiresAt is invalid.');
  if (!allowExpired && expiresAt <= now) {
    throw new Error(`Temporary branch ${branchName} has expired; clean it up instead of attaching or verifying it.`);
  }
}

export function runProcess(command, args, { env = process.env, input = '', maxBytes = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let exceeded = false;

    const append = (target, chunk) => {
      const next = target + chunk.toString('utf8');
      if (Buffer.byteLength(next) > maxBytes) {
        exceeded = true;
        child.kill('SIGTERM');
      }
      return next.slice(0, maxBytes);
    };

    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (exceeded) return reject(new Error(`${command} output exceeded ${maxBytes} bytes.`));
      if (code !== 0) {
        const detail = stderr.trim().split('\n').slice(-4).join(' | ');
        return reject(new Error(`${command} exited with ${code}${detail ? `: ${detail}` : ''}`));
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
    });

    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

function defaultDeps() {
  return {
    fs,
    now: () => new Date(),
    run: runProcess,
    clientFactory: async (connectionString) => {
      const { Client } = await import('pg');
      return new Client({ connectionString });
    },
  };
}

function depsWith(overrides = {}) {
  return { ...defaultDeps(), ...overrides };
}

function neonArgs(...args) {
  return ['--yes', `neonctl@${NEONCTL_VERSION}`, ...args];
}

function vercelArgs(...args) {
  return ['--yes', `vercel@${VERCEL_CLI_VERSION}`, ...args];
}

function validateCreateOptions(options, now) {
  const issue = assertIssue(options.issue);
  const owner = required(options.owner, 'owner');
  const purpose = required(options.purpose, 'purpose');
  const projectId = required(options.projectId, 'projectId');
  const parentBranch = required(options.parentBranch, 'parentBranch');
  const previewBranch = assertPreviewBranch(options.previewBranch);
  const protectedBranchIds = parseProtectedBranchIds(options.protectedBranchIds);
  const ttlHours = parsePositiveInteger(options.ttlHours, 'ttlHours', 24);
  if (ttlHours > MAX_TTL_HOURS) {
    throw new Error(`ttlHours must be ${MAX_TTL_HOURS} or less.`);
  }
  if (protectedBranchIds.length < 2) {
    throw new Error('protectedBranchIds must include at least production and persistent staging branch IDs.');
  }
  if (!protectedBranchIds.includes(parentBranch)) {
    throw new Error('parentBranch must be listed in protectedBranchIds. Use the production Neon branch ID, not a guessed name.');
  }
  const branchName = assertBranchName(options.branchName || defaultBranchName(issue, now));
  return {
    issue,
    owner,
    purpose,
    projectId,
    parentBranch,
    previewBranch,
    protectedBranchIds,
    ttlHours,
    branchName,
    databaseName: clean(options.databaseName) || 'neondb',
    roleName: clean(options.roleName) || '',
  };
}

export async function createQaBranch(options, overrides = {}) {
  const deps = depsWith(overrides);
  const now = deps.now();
  const input = validateCreateOptions(options, now);
  const expiresAt = new Date(now.getTime() + input.ttlHours * 60 * 60 * 1000);
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const manifestPath = path.resolve(options.manifestPath || defaultManifestPath(rootDir, input.branchName));
  const plan = {
    action: 'create',
    execute: Boolean(options.execute),
    issue: input.issue,
    branchName: input.branchName,
    parentBranchId: input.parentBranch,
    previewBranch: input.previewBranch,
    expiresAt: expiresAt.toISOString(),
    manifestPath,
  };
  if (!options.execute) return plan;

  const result = await deps.run('npx', neonArgs(
    'branches',
    'create',
    '--project-id', input.projectId,
    '--name', input.branchName,
    '--parent', input.parentBranch,
    '--expires-at', expiresAt.toISOString(),
    '--suspend-timeout', '300',
    '--output', 'json',
    '--no-color',
    '--no-analytics',
  ));
  const created = normalizeCreatedBranch(parseJsonOutput(result.stdout, 'neonctl branches create'));
  if (!created.id || !created.name) throw new Error('Neon did not return the created branch identity.');
  if (created.name !== input.branchName) throw new Error('Neon returned an unexpected branch name.');
  if (input.protectedBranchIds.includes(created.id)) {
    throw new Error('Neon returned a protected branch ID; refusing to continue.');
  }
  if (created.parentId && created.parentId !== input.parentBranch) {
    throw new Error('Created branch parent does not match the approved production parent.');
  }

  const manifest = {
    version: MANIFEST_VERSION,
    status: 'created',
    issue: input.issue,
    owner: input.owner,
    purpose: input.purpose,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    neon: {
      projectId: input.projectId,
      parentBranchId: input.parentBranch,
      protectedBranchIds: input.protectedBranchIds,
      branchId: created.id,
      branchName: created.name,
      databaseName: input.databaseName,
      roleName: input.roleName || null,
    },
    preview: {
      gitBranch: input.previewBranch,
      attachedAt: null,
      environmentKeys: [],
    },
    verification: null,
    destroyedAt: null,
  };
  await writeManifest(manifestPath, manifest, deps);
  return { ...plan, created: true, branchId: created.id };
}

async function connectionStringFor(manifest, deps) {
  const args = [
    'connection-string',
    manifest.neon.branchId,
    '--project-id', manifest.neon.projectId,
    '--database-name', manifest.neon.databaseName,
    '--ssl', 'require',
    '--no-color',
    '--no-analytics',
  ];
  if (manifest.neon.roleName) args.push('--role-name', manifest.neon.roleName);
  const result = await deps.run('npx', neonArgs(...args));
  const connectionString = result.stdout.trim();
  if (!/^postgres(?:ql)?:\/\//.test(connectionString)) {
    throw new Error('Neon did not return a valid Postgres connection string.');
  }
  return connectionString;
}

async function setVercelPreviewEnv({ key, value, previewBranch, sensitive, vercelProject }, deps) {
  const args = ['env', 'add', key, 'preview', previewBranch, '--force', '--yes'];
  args.push(sensitive ? '--sensitive' : '--no-sensitive');
  if (vercelProject) args.push('--project', vercelProject);
  await deps.run('npx', vercelArgs(...args), { input: `${value}\n` });
}

export async function attachQaBranch(options, overrides = {}) {
  const deps = depsWith(overrides);
  const manifestPath = path.resolve(required(options.manifestPath, 'manifestPath'));
  const manifest = await readManifest(manifestPath, deps);
  assertSafeManifest(manifest, deps.now());
  if (manifest.status === 'destroyed') throw new Error('Cannot attach a destroyed QA branch.');
  const plan = {
    action: 'attach',
    execute: Boolean(options.execute),
    branchName: manifest.neon.branchName,
    previewBranch: manifest.preview.gitBranch,
    environmentKeys: ['DATABASE_URL', ...Object.keys(SAFE_PREVIEW_ENV)],
    manifestPath,
  };
  if (!options.execute) return plan;

  manifest.status = 'attaching';
  manifest.preview.environmentKeys = [];
  manifest.preview.externalIoDisabled = false;
  manifest.preview.vercelProject = clean(options.vercelProject) || null;
  await writeManifest(manifestPath, manifest, deps);

  for (const [key, value] of Object.entries(SAFE_PREVIEW_ENV)) {
    await setVercelPreviewEnv({
      key,
      value,
      previewBranch: manifest.preview.gitBranch,
      sensitive: false,
      vercelProject: clean(options.vercelProject),
    }, deps);
    manifest.preview.environmentKeys.push(key);
    if (key === 'AIT_CRM_EXTERNAL_IO_DISABLED') manifest.preview.externalIoDisabled = true;
    await writeManifest(manifestPath, manifest, deps);
  }
  const connectionString = await connectionStringFor(manifest, deps);
  await setVercelPreviewEnv({
    key: 'DATABASE_URL',
    value: connectionString,
    previewBranch: manifest.preview.gitBranch,
    sensitive: true,
    vercelProject: clean(options.vercelProject),
  }, deps);
  manifest.preview.environmentKeys.push('DATABASE_URL');
  await writeManifest(manifestPath, manifest, deps);

  manifest.status = 'attached';
  manifest.preview.attachedAt = deps.now().toISOString();
  await writeManifest(manifestPath, manifest, deps);
  return { ...plan, attached: true };
}

async function databaseVerification(manifest, connectionString, deps) {
  const client = await deps.clientFactory(connectionString);
  await client.connect();
  try {
    const fingerprintResult = await client.query(`
      select current_database() as database,
        current_setting('neon.branch_id', true) as neon_branch_id,
        current_setting('neon.project_id', true) as neon_project_id
    `);
    const fingerprint = fingerprintResult.rows[0] || {};
    if (fingerprint.neon_branch_id !== manifest.neon.branchId) {
      throw new Error('Database fingerprint does not match the manifest branch ID.');
    }
    if (manifest.neon.protectedBranchIds.includes(fingerprint.neon_branch_id)) {
      throw new Error('Database fingerprint resolves to a protected branch.');
    }
    if (fingerprint.neon_project_id && fingerprint.neon_project_id !== manifest.neon.projectId) {
      throw new Error('Database fingerprint does not match the manifest project ID.');
    }

    const tableResult = await client.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[])",
      [REQUIRED_TABLES],
    );
    const found = new Set(tableResult.rows.map((row) => row.table_name));
    const missingTables = REQUIRED_TABLES.filter((table) => !found.has(table));
    if (missingTables.length) throw new Error(`Temporary branch is missing required tables: ${missingTables.join(', ')}.`);

    const constraints = await client.query(`
      select count(*)::int as count
      from pg_constraint
      where contype = 'f' and connamespace = 'public'::regnamespace and not convalidated
    `);
    const unvalidatedForeignKeys = Number(constraints.rows[0]?.count || 0);
    if (unvalidatedForeignKeys > 0) throw new Error('Temporary branch has unvalidated foreign-key constraints.');

    const memberships = await client.query(`
      select u.id
      from users u
      where u.is_active is true
        and exists (
          select 1
          from user_roles ur
          join roles r on r.id = ur.role_id
          where ur.user_id = u.id and r.key <> 'admin'
        )
        and not exists (
          select 1
          from user_roles ur
          join roles r on r.id = ur.role_id
          where ur.user_id = u.id and r.key = 'admin'
        )
        and not exists (
          select 1
          from business_unit_memberships bum
          where bum.user_id = u.id
        )
    `);
    const activeNonAdminWithoutMembership = memberships.rowCount;
    if (activeNonAdminWithoutMembership > 0) {
      throw new Error('Temporary branch contains active non-admin users without business-unit membership.');
    }

    const migration = await client.query(
      'select id, hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1',
    );
    if (!migration.rowCount) throw new Error('Drizzle migration journal is empty or unreadable.');

    return {
      database: fingerprint.database,
      hostSuffix: safeHostSuffix(connectionString),
      neonBranchId: fingerprint.neon_branch_id,
      neonProjectId: fingerprint.neon_project_id,
      requiredTableCount: REQUIRED_TABLES.length,
      unvalidatedForeignKeys,
      activeNonAdminWithoutMembership,
      latestMigrationId: migration.rows[0].id,
    };
  } finally {
    await client.end();
  }
}

export async function verifyQaBranch(options, overrides = {}) {
  const deps = depsWith(overrides);
  const manifestPath = path.resolve(required(options.manifestPath, 'manifestPath'));
  const manifest = await readManifest(manifestPath, deps);
  assertSafeManifest(manifest, deps.now());
  if (manifest.status === 'destroyed') throw new Error('Cannot verify a destroyed QA branch.');
  if (!options.databaseOnly && manifest.preview.externalIoDisabled !== true) {
    throw new Error('Attach the branch-scoped preview safety variables before full verification.');
  }
  const connectionString = await connectionStringFor(manifest, deps);
  const database = await databaseVerification(manifest, connectionString, deps);

  manifest.status = options.databaseOnly ? manifest.status : 'verified';
  manifest.verification = {
    verifiedAt: deps.now().toISOString(),
    databaseOnly: Boolean(options.databaseOnly),
    externalIoDisabled: manifest.preview.externalIoDisabled === true,
    ...database,
  };
  await writeManifest(manifestPath, manifest, deps);
  return {
    action: 'verify',
    verified: true,
    branchName: manifest.neon.branchName,
    previewBranch: manifest.preview.gitBranch,
    verification: manifest.verification,
    manifestPath,
  };
}

async function removeVercelPreviewEnv({ key, previewBranch, vercelProject }, deps) {
  const args = ['env', 'rm', key, 'preview', previewBranch, '--yes'];
  if (vercelProject) args.push('--project', vercelProject);
  await deps.run('npx', vercelArgs(...args));
}

export async function destroyQaBranch(options, overrides = {}) {
  const deps = depsWith(overrides);
  const manifestPath = path.resolve(required(options.manifestPath, 'manifestPath'));
  const manifest = await readManifest(manifestPath, deps);
  assertSafeManifest(manifest, deps.now(), { allowExpired: true });
  if (manifest.status === 'destroyed') {
    return { action: 'destroy', destroyed: true, alreadyDestroyed: true, manifestPath };
  }
  if (manifest.neon.protectedBranchIds.includes(manifest.neon.branchId)) {
    throw new Error('Refusing to delete a protected Neon branch.');
  }
  const confirmation = required(options.confirmBranch, 'confirmBranch');
  if (confirmation !== manifest.neon.branchName) {
    throw new Error('confirmBranch must exactly match the temporary Neon branch name.');
  }
  const plan = {
    action: 'destroy',
    execute: Boolean(options.execute),
    branchName: manifest.neon.branchName,
    previewBranch: manifest.preview.gitBranch,
    removeEnvironmentKeys: manifest.preview.environmentKeys || [],
    branchAlreadyExpired: Boolean(options.branchAlreadyExpired),
    manifestPath,
  };
  if (!options.execute) return plan;

  for (const key of manifest.preview.environmentKeys || []) {
    await removeVercelPreviewEnv({
      key,
      previewBranch: manifest.preview.gitBranch,
      vercelProject: manifest.preview.vercelProject || clean(options.vercelProject),
    }, deps);
  }
  if (!options.branchAlreadyExpired) {
    await deps.run('npx', neonArgs(
      'branches',
      'delete',
      manifest.neon.branchId,
      '--project-id', manifest.neon.projectId,
      '--output', 'json',
      '--no-color',
      '--no-analytics',
    ));
  }

  manifest.status = 'destroyed';
  manifest.destroyedAt = deps.now().toISOString();
  manifest.preview.environmentKeys = [];
  await writeManifest(manifestPath, manifest, deps);
  return { ...plan, destroyed: true };
}

export async function readQaBranchStatus(options, overrides = {}) {
  const deps = depsWith(overrides);
  const manifestPath = path.resolve(required(options.manifestPath, 'manifestPath'));
  const manifest = await readManifest(manifestPath, deps);
  return { manifestPath, ...manifest };
}

export async function listExpiredQaBranches(options = {}, overrides = {}) {
  const deps = depsWith(overrides);
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const dir = manifestDirectory(rootDir);
  let names = [];
  try {
    names = await deps.fs.readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const now = deps.now();
  const expired = [];
  for (const name of names.filter((entry) => entry.endsWith('.json')).sort()) {
    const manifestPath = path.join(dir, name);
    const manifest = await readManifest(manifestPath, deps);
    if (manifest.status !== 'destroyed' && new Date(manifest.expiresAt) <= now) {
      expired.push({
        manifestPath,
        issue: manifest.issue,
        owner: manifest.owner,
        branchName: manifest.neon.branchName,
        previewBranch: manifest.preview.gitBranch,
        expiresAt: manifest.expiresAt,
        status: manifest.status,
      });
    }
  }
  return expired;
}

export function safePreviewEnvironment() {
  return { ...SAFE_PREVIEW_ENV };
}
