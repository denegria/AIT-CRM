import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import {
  assertAuthoritativeProductionInvocation,
  validateProductionDatabaseUrl,
  verifyProductionDatabaseBaseline,
} from './lib/production-readiness.mjs';
import {
  loadSchemaManifest,
  verifyRepositoryBaseline,
} from './lib/schema-readiness.mjs';

function defaultClientFactory(clientConfig) {
  return new Client(clientConfig);
}

export async function runProductionChecks({
  authoritative,
  env = process.env,
  fetchImpl = fetch,
  clientFactory = defaultClientFactory,
  loadManifest = loadSchemaManifest,
  verifyRepository = verifyRepositoryBaseline,
  logger = console,
} = {}) {
  if (authoritative) assertAuthoritativeProductionInvocation(env);

  const baseUrl = (env.AIT_CRM_BASE_URL || 'https://ait-crm-pi.vercel.app').replace(/\/$/, '');
  const verifyToken = env.META_WEBHOOK_VERIFY_TOKEN || env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || '';
  const checks = [];
  let verifiedManifest;

  function addCheck(name, ok, detail = '') {
    checks.push({ name, ok, detail });
    logger.log(`${ok ? 'ok' : 'fail'} ${name}${detail ? ` - ${detail}` : ''}`);
  }

  function requireEnv(name, options = {}) {
    const value = env[name];
    const ok = options.anyOf
      ? options.anyOf.some((key) => Boolean(env[key]))
      : Boolean(value);
    addCheck(options.label || `${name} is set`, ok, ok ? '' : 'missing');
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

  async function checkHttp() {
    const root = await fetchImpl(baseUrl, { redirect: 'manual' });
    addCheck('production root responds', root.status >= 200 && root.status < 400, `HTTP ${root.status}`);

    const session = await fetchImpl(new URL('/api/auth/session', baseUrl));
    const sessionBody = await readJson(session);
    addCheck('auth session route responds', session.status === 200, `HTTP ${session.status}`);
    addCheck(
      'auth session route reports anonymous visitors unauthenticated',
      sessionBody.authenticated === false && sessionBody.user === null,
      JSON.stringify(sessionBody),
    );

    const wrongUrl = new URL('/api/webhooks/facebook-leads', baseUrl);
    wrongUrl.searchParams.set('hub.mode', 'subscribe');
    wrongUrl.searchParams.set('hub.verify_token', 'definitely-wrong-token');
    wrongUrl.searchParams.set('hub.challenge', 'readiness-check');
    const wrong = await fetchImpl(wrongUrl);
    addCheck('webhook rejects wrong verify token', wrong.status === 403, `HTTP ${wrong.status}`);

    if (env.SKIP_META_VALID_TOKEN === '1') {
      addCheck('configured verify token check skipped', true, 'SKIP_META_VALID_TOKEN=1');
    } else if (verifyToken) {
      const validUrl = new URL('/api/webhooks/facebook-leads', baseUrl);
      validUrl.searchParams.set('hub.mode', 'subscribe');
      validUrl.searchParams.set('hub.verify_token', verifyToken);
      validUrl.searchParams.set('hub.challenge', 'readiness-check');
      const valid = await fetchImpl(validUrl);
      const body = await valid.text();
      addCheck('webhook accepts configured verify token', valid.status === 200 && body === 'readiness-check', `HTTP ${valid.status}`);
    }
  }

  async function checkRepositorySchema() {
    const report = await verifyRepository();
    verifiedManifest = report.manifest;
    for (const check of report.checks) addCheck(check.name, check.ok, check.detail);
    addCheck('schema manifest fingerprint is reproducible', true, report.manifestSha256);
  }

  async function checkDatabase() {
    const manifest = verifiedManifest || await loadManifest();
    let target;
    try {
      target = validateProductionDatabaseUrl(env.DATABASE_URL, manifest);
      addCheck(
        'DATABASE_URL authority, database, and TLS match the production manifest',
        true,
        `host=${target.safeTarget.host}, database=${target.safeTarget.database}`,
      );
    } catch (error) {
      addCheck('DATABASE_URL authority, database, and TLS match the production manifest', false, error.message);
      return;
    }

    const client = clientFactory(target.clientConfig);
    let connected = false;
    try {
      await client.connect();
      connected = true;
      const report = await verifyProductionDatabaseBaseline(client, manifest);
      for (const check of report.checks) addCheck(check.name, check.ok, check.detail);
    } catch (error) {
      addCheck('production database proof completed', false, error.message);
    } finally {
      if (connected) await client.end();
    }
  }

  await checkRepositorySchema();

  if (authoritative) {
    if (env.SKIP_ENV === '1') {
      addCheck('production env check skipped', true, 'SKIP_ENV=1; live database proof remains mandatory');
    } else {
      requireEnv('AIT_CRM_SESSION_SECRET');
      requireEnv('DATABASE_URL');
      if (env.SKIP_SENSITIVE_ENV === '1') {
        addCheck('sensitive Meta env check skipped', true, 'SKIP_SENSITIVE_ENV=1');
      } else {
        requireEnv('META_WEBHOOK_VERIFY_TOKEN', { anyOf: ['META_WEBHOOK_VERIFY_TOKEN', 'FACEBOOK_WEBHOOK_VERIFY_TOKEN'], label: 'Meta verify token is set' });
        requireEnv('FACEBOOK_APP_SECRET');
        requireEnv('META_PAGE_ACCESS_TOKEN', { anyOf: ['META_PAGE_ACCESS_TOKEN', 'META_PAGE_ACCESS_TOKEN_MAP'], label: 'Meta page token is set' });
      }
    }
  } else {
    addCheck('live production database proof not attempted', true, 'non-authoritative diagnostics only');
  }

  await checkHttp();
  if (authoritative) await checkDatabase();

  const failed = checks.filter((check) => !check.ok);
  return {
    authoritative,
    ok: failed.length === 0,
    productionReady: authoritative && failed.length === 0,
    checks,
  };
}

export function runProductionReadiness(options = {}) {
  return runProductionChecks({ ...options, authoritative: true });
}

export function runProductionDiagnostics(options = {}) {
  return runProductionChecks({ ...options, authoritative: false });
}

async function main() {
  try {
    const report = await runProductionReadiness();
    if (!report.ok) {
      console.error(`\n${report.checks.filter((check) => !check.ok).length} production readiness check(s) failed.`);
      process.exitCode = 1;
      return;
    }
    console.log('\nProduction readiness checks passed.');
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) await main();
