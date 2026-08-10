import { Client } from 'pg';
import { databaseSslMode, databaseUrlUsesFullVerification } from '../src/db/database-url.js';
import {
  loadSchemaManifest,
  verifyDatabaseBaseline,
  verifyRepositoryBaseline,
} from './lib/schema-readiness.mjs';

const baseUrl = (process.env.AIT_CRM_BASE_URL || 'https://ait-crm-pi.vercel.app').replace(/\/$/, '');
const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || '';
const skipDb = process.env.SKIP_DB === '1';
const skipEnv = process.env.SKIP_ENV === '1';
const skipSensitiveEnv = process.env.SKIP_SENSITIVE_ENV === '1';
const skipMetaValidToken = process.env.SKIP_META_VALID_TOKEN === '1';

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

  const session = await fetch(new URL('/api/auth/session', baseUrl));
  const sessionBody = await readJson(session);
  addCheck('auth session route responds', session.status === 200, 'HTTP ' + session.status);
  addCheck(
    'auth session route reports anonymous visitors unauthenticated',
    sessionBody.authenticated === false && sessionBody.user === null,
    JSON.stringify(sessionBody),
  );

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

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
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
    const manifest = await loadSchemaManifest();
    const report = await verifyDatabaseBaseline(client, manifest);
    for (const check of report.checks) addCheck(check.name, check.ok, check.detail);
  } finally {
    await client.end();
  }
}

async function checkRepositorySchema() {
  const report = await verifyRepositoryBaseline();
  for (const check of report.checks) addCheck(check.name, check.ok, check.detail);
  addCheck('schema manifest fingerprint is reproducible', true, report.manifestSha256);
}

async function main() {
  await checkRepositorySchema();

  if (skipEnv) {
    addCheck('production env check skipped', true, 'SKIP_ENV=1');
  } else {
    requireEnv('AIT_CRM_SESSION_SECRET');
    requireEnv('DATABASE_URL');
    const sslMode = databaseSslMode(process.env.DATABASE_URL);
    addCheck(
      'DATABASE_URL enforces full TLS verification',
      databaseUrlUsesFullVerification(process.env.DATABASE_URL),
      sslMode ? `sslmode=${sslMode}` : 'sslmode missing or invalid',
    );
    if (skipSensitiveEnv) {
      addCheck('sensitive Meta env check skipped', true, 'SKIP_SENSITIVE_ENV=1');
    } else {
      requireEnv('META_WEBHOOK_VERIFY_TOKEN', { anyOf: ['META_WEBHOOK_VERIFY_TOKEN', 'FACEBOOK_WEBHOOK_VERIFY_TOKEN'], label: 'Meta verify token is set' });
      requireEnv('FACEBOOK_APP_SECRET');
      requireEnv('META_PAGE_ACCESS_TOKEN', { anyOf: ['META_PAGE_ACCESS_TOKEN', 'META_PAGE_ACCESS_TOKEN_MAP'], label: 'Meta page token is set' });
    }
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
