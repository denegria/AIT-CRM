#!/usr/bin/env node

import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createWorkOSAuthProvider } from '../src/lib/auth/workos-provider.js';
import { getWorkOSAuthConfig } from '../src/lib/auth/workos-runtime.js';

function parseArgs(argv) {
  const flags = new Set(argv);
  const known = new Set(['--apply', '--canary', '--confirm-staging']);
  for (const flag of flags) {
    if (!known.has(flag)) throw new Error(`Unknown argument: ${flag}`);
  }
  return {
    apply: flags.has('--apply'),
    canary: flags.has('--canary'),
    confirmStaging: flags.has('--confirm-staging'),
  };
}

function databaseFingerprint(connectionString) {
  const url = new URL(connectionString);
  const hostParts = url.hostname.split('.');
  return {
    endpoint: hostParts[0] || 'unknown',
    hostSuffix: hostParts.slice(1).join('.'),
    database: decodeURIComponent(url.pathname.replace(/^\//u, '')),
    schema: url.searchParams.get('options') || 'public',
    targetBaseUrl: process.env.AIT_CRM_BASE_URL || '(not configured)',
  };
}

function requireStagingConfirmation(options) {
  if ((options.apply || options.canary) && !options.confirmStaging) {
    throw new Error('External writes require --confirm-staging.');
  }
}

async function readCandidates(client) {
  const result = await client.query(`
    select
      u.id,
      u.name,
      lower(u.email) as email,
      u.workos_user_id,
      c.password_hash,
      c.password_salt,
      c.password_iterations
    from users u
    join user_password_credentials c on c.user_id = u.id
    where u.is_active = true and u.email is not null
    order by u.created_at asc
  `);
  return result.rows;
}

function credentialFor(row) {
  return {
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    passwordIterations: row.password_iterations,
    passwordDigest: 'sha512',
  };
}

async function planMigration(provider, rows) {
  const plan = [];
  for (const row of rows) {
    if (row.workos_user_id) {
      plan.push({ row, action: 'already_linked', providerUserId: row.workos_user_id });
      continue;
    }
    const existing = await provider.findUserByEmail(row.email);
    if (!existing) {
      plan.push({ row, action: 'create' });
      continue;
    }
    if (existing.externalId === row.id || existing.metadata?.crm_user_id === row.id) {
      plan.push({ row, action: 'link_existing', providerUserId: existing.id });
      continue;
    }
    plan.push({ row, action: 'conflict', providerUserId: existing.id });
  }
  return plan;
}

async function applyMigration(client, provider, plan) {
  const results = [];
  for (const item of plan) {
    if (item.action === 'already_linked') {
      results.push({ userId: item.row.id, status: 'already_linked' });
      continue;
    }
    let providerUserId = item.providerUserId || null;
    if (item.action === 'create') {
      const providerUser = await provider.createUserWithImportedPassword({
        userId: item.row.id,
        name: item.row.name,
        email: item.row.email,
        credential: credentialFor(item.row),
      });
      providerUserId = providerUser.id;
    }
    await provider.ensureOrganizationMembership(providerUserId);
    const update = await client.query(
      `
        update users
        set workos_user_id = $1, auth_migrated_at = now(), updated_at = now()
        where id = $2 and workos_user_id is null
        returning id
      `,
      [providerUserId, item.row.id],
    );
    if (update.rowCount !== 1) throw new Error(`Concurrent migration conflict for local user ${item.row.id}.`);
    results.push({ userId: item.row.id, status: item.action, providerUserId });
  }
  return results;
}

async function runCanary(provider) {
  const localId = randomUUID();
  const email = `ait-crm-auth-canary+${Date.now()}@example.com`;
  const password = randomBytes(24).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  const passwordHash = pbkdf2Sync(password, salt, 310000, 64, 'sha512').toString('base64');
  let providerUserId = null;
  try {
    const user = await provider.createUserWithImportedPassword({
      userId: localId,
      name: 'AIT CRM auth canary',
      email,
      credential: {
        passwordHash,
        passwordSalt: salt,
        passwordIterations: 310000,
        passwordDigest: 'sha512',
      },
    });
    providerUserId = user.id;
    await provider.ensureOrganizationMembership(providerUserId);
    const authenticated = await provider.authenticatePassword({ email, password });
    if (authenticated.identity.providerUserId !== providerUserId || authenticated.identity.email !== email) {
      throw new Error('WorkOS canary identity did not round-trip exactly.');
    }
    const maintained = await provider.maintainSession(authenticated.sessionData);
    if (maintained.identity.sessionId) await provider.revokeSession(maintained.identity.sessionId);
    return { ok: true, passwordPreserved: true };
  } finally {
    if (providerUserId) await provider.deleteUser(providerUserId);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  requireStagingConfirmation(options);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const provider = createWorkOSAuthProvider(getWorkOSAuthConfig());
  const fingerprint = databaseFingerprint(connectionString);
  console.log(JSON.stringify({ target: fingerprint, mutationMode: options.apply || options.canary }, null, 2));

  if (options.canary) {
    const canary = await runCanary(provider);
    console.log(JSON.stringify({ canary }, null, 2));
    return;
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const rows = await readCandidates(client);
    const plan = await planMigration(provider, rows);
    const counts = Object.fromEntries(
      ['create', 'link_existing', 'already_linked', 'conflict'].map((action) => [
        action,
        plan.filter((item) => item.action === action).length,
      ]),
    );
    console.log(JSON.stringify({ candidates: rows.length, plan: counts }, null, 2));
    if (counts.conflict) {
      throw new Error('WorkOS identity conflicts detected; no migration writes were performed.');
    }
    if (!options.apply) {
      console.log('Dry run complete. Re-run with --apply --confirm-staging after the canary passes.');
      return;
    }
    const results = await applyMigration(client, provider, plan);
    console.log(JSON.stringify({ migrated: results.length, statuses: counts }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
