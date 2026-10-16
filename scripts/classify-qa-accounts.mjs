import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const QA_EMAILS = Object.freeze([
  'aitusa@outlook.com',
  'openclawagent.giuseppe@gmail.com',
]);

function arg(name) { return process.argv.includes(name); }
function clean(value) { return String(value || '').trim(); }
function safeFingerprint(url) {
  const parsed = new URL(url);
  return {
    hostSuffix: parsed.hostname.split('.').slice(-2).join('.'),
    database: parsed.pathname.slice(1),
    sslmode: parsed.searchParams.get('sslmode') || '',
  };
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
const expectedProject = clean(process.env.EXPECTED_NEON_PROJECT_ID);
const expectedBranch = clean(process.env.EXPECTED_NEON_BRANCH_ID);
if (!expectedProject || !expectedBranch) throw new Error('EXPECTED_NEON_PROJECT_ID and EXPECTED_NEON_BRANCH_ID are required for the target identity assertion.');
const execute = arg('--execute');
const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const fingerprint = safeFingerprint(databaseUrl);
  const catalog = await client.query(`
    select current_database() as database_name,
           current_schema() as schema_name,
           current_setting('neon.project_id', true) as project_id,
           current_setting('neon.branch_id', true) as branch_id
  `);
  const target = catalog.rows[0];
  if (expectedProject && target.project_id && target.project_id !== expectedProject) throw new Error('Neon project fingerprint mismatch.');
  if (expectedBranch && target.branch_id && target.branch_id !== expectedBranch) throw new Error('Neon branch fingerprint mismatch.');
  const rows = await client.query(`
    select id, organization_id, email, name, account_type
    from users
    where lower(email) = any($1::text[])
    order by lower(email)
  `, [QA_EMAILS]);
  if (rows.rowCount !== QA_EMAILS.length) throw new Error(`Expected exactly ${QA_EMAILS.length} canonical QA identities, found ${rows.rowCount}.`);
  const found = new Set(rows.rows.map((row) => clean(row.email).toLowerCase()));
  for (const email of QA_EMAILS) if (!found.has(email)) throw new Error(`Canonical QA identity not found: ${email}`);
  const organizations = new Set(rows.rows.map((row) => row.organization_id));
  if (organizations.size !== 1) throw new Error('Canonical QA identities must belong to one organization.');
  const changed = rows.rows.filter((row) => row.account_type !== 'qa');
  console.log(JSON.stringify({
    mode: execute ? 'execute' : 'dry-run',
    target: { ...fingerprint, databaseName: target.database_name, schemaName: target.schema_name, projectId: target.project_id || null, branchId: target.branch_id || null },
    identities: rows.rows.map((row) => ({ id: row.id, organizationId: row.organization_id, email: row.email, accountType: row.account_type })),
    wouldClassify: changed.map((row) => row.id),
  }, null, 2));
  if (execute) {
    await client.query('begin');
    const result = await client.query(`
    update users
    set account_type = 'qa', updated_at = now()
    where lower(email) = any($1::text[])
      and organization_id = $2
      and account_type <> 'qa'
  `, [QA_EMAILS, rows.rows[0].organization_id]);
    if (result.rowCount !== changed.length) throw new Error('Classification row count changed during apply; rolling back.');
    await client.query('commit');
    console.log(JSON.stringify({ applied: result.rowCount }));
  }
} catch (error) {
  try { await client.query('rollback'); } catch {}
  throw error;
} finally {
  await client.end();
}
