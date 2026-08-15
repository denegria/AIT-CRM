import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  resolveAitUsaActiveOpportunity,
  withLockedAitUsaClosedOpportunityReopen,
  withLockedAitUsaOpportunityMutation,
} from './ait-usa-opportunities.js';

const databaseUrl = String(process.env.AIT_USA_OPPORTUNITY_RACE_DATABASE_URL || '').trim();
const confirmation = String(process.env.AIT_USA_OPPORTUNITY_RACE_DATABASE_CONFIRM || '').trim();
const expectedNeonBranchId = String(process.env.AIT_USA_OPPORTUNITY_RACE_EXPECTED_NEON_BRANCH_ID || '').trim();
const expectedNeonProjectId = String(process.env.AIT_USA_OPPORTUNITY_RACE_EXPECTED_NEON_PROJECT_ID || '').trim();
const targetBaseUrl = String(process.env.AIT_USA_OPPORTUNITY_RACE_TARGET_BASE_URL || '').trim();
const ALLOWED_NON_PRODUCTION_NEON_BRANCH_IDS = new Set(['br-broad-hill-aptjpyea']);
const ALLOWED_NEON_PROJECT_IDS = new Set(['plain-band-07005942']);
const REFUSED_PRODUCTION_NEON_BRANCH_IDS = new Set(['br-purple-bar-aphafrgp']);
const NEON_BRANCH_NAMES = new Map([['br-broad-hill-aptjpyea', 'staging']]);
const BARRIER_DEADLINE_MS = 5_000;
const CLEANUP_DEADLINE_MS = 3_000;

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  let released = false;
  return {
    promise,
    release(value) {
      if (released) return;
      released = true;
      resolve(value);
    },
  };
}

async function withDeadline(promise, label, timeoutMs = BARRIER_DEADLINE_MS) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function advisoryLockQueryBarrier() {
  const issued = deferred();
  return {
    promise: issued.promise,
    onQuery(query) {
      const text = typeof query === 'string' ? query : query?.text || '';
      if (/pg_advisory_xact_lock/i.test(text)) issued.release({ text });
    },
  };
}

function assertExplicitSafeDatabase(url) {
  if (confirmation !== 'allow-safe-race-writes') {
    throw new Error('Set AIT_USA_OPPORTUNITY_RACE_DATABASE_CONFIRM=allow-safe-race-writes for an explicitly approved safe database.');
  }
  const parsed = new URL(url);
  const urlIdentity = `${parsed.hostname}/${parsed.pathname}`.toLowerCase();
  if (!expectedNeonBranchId || !expectedNeonProjectId) {
    throw new Error('Set exact EXPECTED Neon branch and project ids for the approved safe database.');
  }
  if (!targetBaseUrl) {
    throw new Error('Set nonsecret AIT_USA_OPPORTUNITY_RACE_TARGET_BASE_URL before running the race harness.');
  }
  const parsedTargetBaseUrl = new URL(targetBaseUrl);
  if (
    !['http:', 'https:'].includes(parsedTargetBaseUrl.protocol) ||
    parsedTargetBaseUrl.username ||
    parsedTargetBaseUrl.password ||
    parsedTargetBaseUrl.search ||
    parsedTargetBaseUrl.hash
  ) {
    throw new Error('AIT_USA_OPPORTUNITY_RACE_TARGET_BASE_URL must be a nonsecret HTTP(S) URL without credentials, query, or fragment.');
  }
  if (
    !ALLOWED_NON_PRODUCTION_NEON_BRANCH_IDS.has(expectedNeonBranchId) ||
    !ALLOWED_NEON_PROJECT_IDS.has(expectedNeonProjectId) ||
    REFUSED_PRODUCTION_NEON_BRANCH_IDS.has(expectedNeonBranchId) ||
    /prod|production/.test(`${urlIdentity}/${expectedNeonBranchId}/${expectedNeonProjectId}`)
  ) {
    throw new Error('Race harness refuses a database identified as production.');
  }
  return parsedTargetBaseUrl.toString().replace(/\/$/, '');
}

function safeDatabaseFingerprint(url, schema, safeTargetBaseUrl, runtimeIdentity) {
  const parsed = new URL(url);
  const hostParts = parsed.hostname.split('.').filter(Boolean);
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, '').split('/')[0] || '');
  if (!database) throw new Error('Race harness database URL must identify a database before any schema write.');
  return {
    targetBaseUrl: safeTargetBaseUrl,
    neonProjectId: runtimeIdentity.projectId,
    neonBranchId: runtimeIdentity.branchId,
    branchName: NEON_BRANCH_NAMES.get(runtimeIdentity.branchId) || 'unknown',
    hostSuffix: hostParts.slice(-3).join('.'),
    database,
    schema,
  };
}

async function assertRuntimeDatabaseIdentity(client) {
  const result = await client.query(`
    select
      current_setting('neon.branch_id', true) as branch_id,
      current_setting('neon.project_id', true) as project_id
  `);
  const actualBranchId = String(result.rows[0]?.branch_id || '').trim();
  const actualProjectId = String(result.rows[0]?.project_id || '').trim();
  if (REFUSED_PRODUCTION_NEON_BRANCH_IDS.has(actualBranchId)) {
    throw new Error('Race harness refuses the production Neon branch.');
  }
  if (actualBranchId !== expectedNeonBranchId || actualProjectId !== expectedNeonProjectId) {
    throw new Error('Runtime Neon branch/project identity does not match the exact approved EXPECTED values.');
  }
  return { branchId: actualBranchId, projectId: actualProjectId };
}

async function observeAdvisoryLockWait(observer, processId) {
  let rows = [];
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const result = await observer.query(
        `select locktype, mode, granted, classid::text, objid::text, objsubid::text
         from pg_locks
         where pid = $1 and locktype = 'advisory'
         order by granted, mode`,
        [processId],
      );
      rows = result.rows;
      if (rows.some((row) => row.granted === false)) {
        return { observed: true, rows, error: null };
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { observed: false, rows, error: null };
  } catch (error) {
    return { observed: false, rows, error: error.message };
  }
}

function transactionDb(client, searchPath, {
  onQuery,
  onBackendPid,
  transactionTag = `ait-usa-race-${randomUUID()}`,
} = {}) {
  return {
    async transaction(handler) {
      await client.query('begin');
      try {
        const backend = await client.query(
          "select pg_backend_pid()::int as pid, set_config('application_name', $1, true) as application_name",
          [transactionTag],
        );
        onBackendPid?.({
          pid: backend.rows[0].pid,
          applicationName: backend.rows[0].application_name,
        });
        await client.query(`set local search_path to ${searchPath}`);
        const transactionClient = {
          query(query, values) {
            onQuery?.(query, values);
            return client.query(query, values);
          },
        };
        const result = await handler(transactionClient);
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback').catch(() => {});
        throw error;
      }
    },
  };
}

function trackPromise(promises, promise) {
  promises.push(promise);
  promise.catch(() => {});
  return promise;
}

async function cancelAndTerminateRecordedBackends(observer, backends) {
  await Promise.all([...backends.values()].map(async ({ pid, applicationName }) => {
    const current = await withDeadline(
      observer.query(
        `select pid, application_name, state
         from pg_stat_activity
         where pid = $1 and application_name = $2`,
        [pid, applicationName],
      ),
      `inspect backend ${pid}`,
      CLEANUP_DEADLINE_MS,
    ).catch(() => null);
    if (!current?.rows.length) return;

    await withDeadline(
      observer.query('select pg_cancel_backend($1)', [pid]),
      `cancel backend ${pid}`,
      CLEANUP_DEADLINE_MS,
    ).catch(() => {});
    const stillOwned = await withDeadline(
      observer.query(
        'select exists (select 1 from pg_stat_activity where pid = $1 and application_name = $2) as owned',
        [pid, applicationName],
      ),
      `recheck backend ${pid}`,
      CLEANUP_DEADLINE_MS,
    ).catch(() => null);
    if (stillOwned?.rows[0]?.owned) {
      await withDeadline(
        observer.query('select pg_terminate_backend($1)', [pid]),
        `terminate backend ${pid}`,
        CLEANUP_DEADLINE_MS,
      ).catch(() => {});
    }
  }));
}

async function endClient(client, label) {
  await withDeadline(client.end(), `end ${label}`, CLEANUP_DEADLINE_MS).catch(() => {
    client.connection?.stream?.destroy();
  });
}

test('two PostgreSQL clients serialize reopen versus Start/ingestion creation under the shared advisory lock', {
  skip: !databaseUrl
    ? 'Set the explicit safe race database URL, confirmation, identity, and nonsecret target base URL to run this harness.'
    : false,
  timeout: 30_000,
}, async () => {
  const safeTargetBaseUrl = assertExplicitSafeDatabase(databaseUrl);
  const { Client } = await import('pg');
  const setup = new Client({ connectionString: databaseUrl });
  const observer = new Client({ connectionString: databaseUrl });
  const firstClient = new Client({ connectionString: databaseUrl });
  const secondClient = new Client({ connectionString: databaseUrl });
  const schema = `ait_usa_race_${randomUUID().replaceAll('-', '')}`;
  const quotedSchema = `"${schema}"`;
  const businessUnit = { id: 'bu-usa', name: 'AIT USA Institute' };
  const contact = { id: 'contact-1' };
  const firstEntered = deferred();
  const releaseFirst = deferred();
  const replacementReady = deferred();
  const releaseReplacement = deferred();
  const inFlight = [];
  const backends = new Map();
  const recordBackend = (backend) => backends.set(backend.applicationName, backend);
  let schemaCreated = false;

  try {
    await withDeadline(
      Promise.all([setup.connect(), observer.connect(), firstClient.connect(), secondClient.connect()]),
      'connect race harness clients',
      10_000,
    );
    const runtimeIdentity = await assertRuntimeDatabaseIdentity(setup);
    console.info(
      'AIT USA race harness SAFE database fingerprint:',
      JSON.stringify(safeDatabaseFingerprint(databaseUrl, schema, safeTargetBaseUrl, runtimeIdentity)),
    );
    await setup.query(`create schema ${quotedSchema}`);
    schemaCreated = true;
    await setup.query(`
      create table ${quotedSchema}.leads (
        id text primary key,
        organization_id text not null,
        business_unit_id text not null,
        contact_id text not null,
        status text not null,
        current_stage text,
        assigned_user_id text,
        source_type text,
        source_name text,
        created_at timestamptz not null default now()
      )
    `);
    await setup.query(
      `insert into ${quotedSchema}.leads (id, organization_id, business_unit_id, contact_id, status, current_stage)
       values ('closed-1', 'org-1', 'bu-usa', 'contact-1', 'Not Interested', 'Not Interested')`,
    );

    const first = trackPromise(inFlight, withLockedAitUsaClosedOpportunityReopen({
      db: transactionDb(firstClient, quotedSchema, {
        onBackendPid: recordBackend,
        transactionTag: `${schema}:reopen`,
      }),
      organizationId: 'org-1',
      businessUnit,
      contact,
      opportunityId: 'closed-1',
      toStatus: 'Follow Up',
      reopenReason: 'correction',
      write: async ({ tx }) => {
        firstEntered.release();
        await releaseFirst.promise;
        await tx.query("update leads set status = 'Follow Up', current_stage = 'Follow Up' where id = 'closed-1'");
        return 'first-won';
      },
    }));
    await withDeadline(firstEntered.promise, 'first transaction write barrier');

    let secondSettled = false;
    let secondCreated = false;
    const secondLockIssued = advisoryLockQueryBarrier();
    const secondTag = `${schema}:create`;
    const second = trackPromise(inFlight, transactionDb(secondClient, quotedSchema, {
      onQuery: secondLockIssued.onQuery,
      onBackendPid: recordBackend,
      transactionTag: secondTag,
    }).transaction(async (tx) => {
      const resolution = await resolveAitUsaActiveOpportunity({
        client: tx,
        organization: 'org-1',
        businessUnit,
        contact,
      });
      if (resolution.status === 'none') {
        secondCreated = true;
        await tx.query(
          "insert into leads (id, organization_id, business_unit_id, contact_id, status, current_stage) values ('new-contender', 'org-1', 'bu-usa', 'contact-1', 'New Lead', 'New Lead')",
        );
      }
      return resolution;
    }).finally(() => { secondSettled = true; }));

    await withDeadline(secondLockIssued.promise, 'second advisory-lock query issuance');
    const secondBackend = backends.get(secondTag);
    assert.ok(secondBackend?.pid, 'second transaction must expose its transaction-pinned PostgreSQL backend PID');
    const secondObservation = await withDeadline(
      observeAdvisoryLockWait(observer, secondBackend.pid),
      'observe second advisory-lock wait',
    );
    assert.equal(
      secondObservation.observed,
      true,
      `observer did not see the second transaction waiting on a server advisory lock; observer=${JSON.stringify(secondObservation)}`,
    );
    assert.equal(
      secondSettled,
      false,
      `second transaction settled after issuing the advisory lock; observer=${JSON.stringify(secondObservation)}`,
    );
    releaseFirst.release();
    assert.equal(await withDeadline(first, 'first transaction completion'), 'first-won');
    const secondResolution = await withDeadline(second, 'second transaction completion');
    assert.equal(secondResolution.status, 'exact');
    assert.equal(secondResolution.leadId, 'closed-1');
    assert.equal(secondCreated, false);
    const active = await setup.query(
      `select count(*)::int as count from ${quotedSchema}.leads where status = 'Follow Up'`,
    );
    assert.equal(active.rows[0].count, 1);

    await setup.query(`truncate ${quotedSchema}.leads`);
    await setup.query(
      `insert into ${quotedSchema}.leads (id, organization_id, business_unit_id, contact_id, status, current_stage)
       values ('active-a', 'org-1', 'bu-usa', 'contact-1', 'Follow Up', 'Follow Up')`,
    );
    const staleRead = await setup.query(`select id, status from ${quotedSchema}.leads where id = 'active-a'`);
    assert.equal(staleRead.rows[0].status, 'Follow Up');

    const replacementTag = `${schema}:replace`;
    const replacement = trackPromise(inFlight, transactionDb(secondClient, quotedSchema, {
      onBackendPid: recordBackend,
      transactionTag: replacementTag,
    }).transaction(async (tx) => {
      const before = await resolveAitUsaActiveOpportunity({
        client: tx,
        organization: 'org-1',
        businessUnit,
        contact,
      });
      assert.equal(before.leadId, 'active-a');
      await tx.query("update leads set status = 'Not Interested', current_stage = 'Not Interested' where id = 'active-a'");
      await tx.query(
        "insert into leads (id, organization_id, business_unit_id, contact_id, status, current_stage) values ('active-b', 'org-1', 'bu-usa', 'contact-1', 'New Lead', 'New Lead')",
      );
      replacementReady.release();
      await releaseReplacement.promise;
    }));
    await withDeadline(replacementReady.promise, 'replacement transaction write barrier');

    let staleWriterCalled = false;
    let staleSettled = false;
    const staleLockIssued = advisoryLockQueryBarrier();
    const staleTag = `${schema}:stale`;
    const stalePatch = trackPromise(inFlight, withLockedAitUsaOpportunityMutation({
      db: transactionDb(firstClient, quotedSchema, {
        onQuery: staleLockIssued.onQuery,
        onBackendPid: recordBackend,
        transactionTag: staleTag,
      }),
      organizationId: 'org-1',
      businessUnit,
      contact,
      expectedOpportunityId: staleRead.rows[0].id,
      toStatus: staleRead.rows[0].status,
      write: async () => { staleWriterCalled = true; },
    }).finally(() => { staleSettled = true; }));
    await withDeadline(staleLockIssued.promise, 'stale PATCH advisory-lock query issuance');
    const staleBackend = backends.get(staleTag);
    assert.ok(staleBackend?.pid, 'stale transaction must expose its transaction-pinned PostgreSQL backend PID');
    const staleObservation = await withDeadline(
      observeAdvisoryLockWait(observer, staleBackend.pid),
      'observe stale PATCH advisory-lock wait',
    );
    assert.equal(
      staleObservation.observed,
      true,
      `observer did not see the stale PATCH waiting on a server advisory lock; observer=${JSON.stringify(staleObservation)}`,
    );
    assert.equal(
      staleSettled,
      false,
      `stale PATCH settled after issuing the advisory lock; observer=${JSON.stringify(staleObservation)}`,
    );
    releaseReplacement.release();
    await withDeadline(replacement, 'replacement transaction completion');
    await withDeadline(
      assert.rejects(stalePatch, (error) => error.status === 409),
      'stale PATCH rejection',
    );
    assert.equal(staleWriterCalled, false);
    const finalActive = await setup.query(
      `select id from ${quotedSchema}.leads where status in ('New Lead', 'Follow Up') order by id`,
    );
    assert.deepEqual(finalActive.rows.map((row) => row.id), ['active-b']);
  } finally {
    releaseFirst.release();
    releaseReplacement.release();

    await withDeadline(
      Promise.allSettled(inFlight),
      'settle released race transactions',
      1_000,
    ).catch(() => {});
    await cancelAndTerminateRecordedBackends(observer, backends);
    await withDeadline(
      Promise.allSettled(inFlight),
      'settle cancelled race transactions',
      CLEANUP_DEADLINE_MS,
    ).catch(() => {});

    let cleanupError = null;
    if (schemaCreated) {
      try {
        await withDeadline(
          observer.query(`drop schema if exists ${quotedSchema} cascade`),
          `drop schema ${schema}`,
          BARRIER_DEADLINE_MS,
        );
      } catch (error) {
        cleanupError = error;
      }
    }
    await Promise.all([
      endClient(firstClient, 'first race client'),
      endClient(secondClient, 'second race client'),
    ]);
    await Promise.all([
      endClient(setup, 'setup client'),
      endClient(observer, 'observer client'),
    ]);
    if (cleanupError) throw cleanupError;
  }
});
