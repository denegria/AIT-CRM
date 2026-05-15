import { Client } from 'pg';

const baseUrl = (process.env.AIT_CRM_BASE_URL || 'https://ait-crm-pi.vercel.app').replace(/\/$/, '');
const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || '';
const skipDb = process.env.SKIP_DB === '1';
const skipEnv = process.env.SKIP_ENV === '1';
const skipMetaValidToken = process.env.SKIP_META_VALID_TOKEN === '1';
const requiredTables = [
  'organizations',
  'business_units',
  'users',
  'contacts',
  'leads',
  'work_orders',
  'estimates',
  'import_batches',
  'import_source_rows',
  'import_normalized_records',
  'import_review_items',
];
const requiredWorkOrderColumns = ['title', 'description', 'estimated_cost'];

const checks = [];

function addCheck(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  const marker = ok ? 'ok' : 'fail';
  console.log(marker + ' ' + name + (detail ? ' - ' + detail : ''));
}

function requireEnv(name, options = {}) {
  const value = process.env[name];
  const ok = options.anyOf
    ? options.anyOf.some((key) => Boolean(process.env[key]))
    : Boolean(value);
  addCheck(options.label || name + ' is set', ok, ok ? '' : 'missing');
}

async function checkHttp() {
  const root = await fetch(baseUrl, { redirect: 'manual' });
  addCheck('production root responds', root.status >= 200 && root.status < 400, 'HTTP ' + root.status);

  const wrongUrl = new URL('/api/webhooks/facebook-leads', baseUrl);
  wrongUrl.searchParams.set('hub.mode', 'subscribe');
  wrongUrl.searchParams.set('hub.verify_token', 'definitely-wrong-token');
  wrongUrl.searchParams.set('hub.challenge', 'readiness-check');
  const wrong = await fetch(wrongUrl);
  addCheck('webhook rejects wrong verify token', wrong.status === 403, 'HTTP ' + wrong.status);

  if (skipMetaValidToken) {
    addCheck('configured verify token check skipped', true, 'SKIP_META_VALID_TOKEN=1');
  } else if (verifyToken) {
    const validUrl = new URL('/api/webhooks/facebook-leads', baseUrl);
    validUrl.searchParams.set('hub.mode', 'subscribe');
    validUrl.searchParams.set('hub.verify_token', verifyToken);
    validUrl.searchParams.set('hub.challenge', 'readiness-check');
    const valid = await fetch(validUrl);
    const body = await valid.text();
    addCheck('webhook accepts configured verify token', valid.status === 200 && body === 'readiness-check', 'HTTP ' + valid.status);
  }
}

async function checkDatabase() {
  if (skipDb) {
    addCheck('database schema check skipped', true, 'SKIP_DB=1');
    return;
  }
  if (!process.env.DATABASE_URL) {
    addCheck('DATABASE_URL is set', false, 'missing');
    return;
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const tables = await client.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[])",
      [requiredTables],
    );
    const foundTables = new Set(tables.rows.map((row) => row.table_name));
    const missingTables = requiredTables.filter((table) => !foundTables.has(table));
    addCheck('required CRM tables exist', missingTables.length === 0, missingTables.length ? 'missing ' + missingTables.join(', ') : '');

    const columns = await client.query(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'work_orders' and column_name = any($1::text[])",
      [requiredWorkOrderColumns],
    );
    const foundColumns = new Set(columns.rows.map((row) => row.column_name));
    const missingColumns = requiredWorkOrderColumns.filter((column) => !foundColumns.has(column));
    addCheck('work order v1 columns exist', missingColumns.length === 0, missingColumns.length ? 'missing ' + missingColumns.join(', ') : '');

    const journal = await client.query(
      'select tag from drizzle.__drizzle_migrations order by created_at desc limit 1',
    ).catch(() => ({ rows: [] }));
    addCheck('drizzle migration journal readable', journal.rows.length > 0, journal.rows[0]?.tag || 'no rows');
  } finally {
    await client.end();
  }
}

async function main() {
  if (skipEnv) {
    addCheck('production env check skipped', true, 'SKIP_ENV=1');
  } else {
    requireEnv('AIT_CRM_SESSION_SECRET');
    requireEnv('DATABASE_URL');
    requireEnv('META_WEBHOOK_VERIFY_TOKEN', { anyOf: ['META_WEBHOOK_VERIFY_TOKEN', 'FACEBOOK_WEBHOOK_VERIFY_TOKEN'], label: 'Meta verify token is set' });
    requireEnv('FACEBOOK_APP_SECRET');
    requireEnv('META_PAGE_ACCESS_TOKEN', { anyOf: ['META_PAGE_ACCESS_TOKEN', 'META_PAGE_ACCESS_TOKEN_MAP'], label: 'Meta page token is set' });
  }

  await checkHttp();
  await checkDatabase();

  const failed = checks.filter((check) => !check.ok);
  if (failed.length) {
    console.error('\n' + failed.length + ' production readiness check(s) failed.');
    process.exit(1);
  }
  console.log('\nProduction readiness checks passed.');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
