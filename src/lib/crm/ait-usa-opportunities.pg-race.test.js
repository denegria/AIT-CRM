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
const ALLOWED_NON_PRODUCTION_NEON_BRANCH_IDS = new Set(['br-broad-hill-aptjpyea']);
const ALLOWED_NEON_PROJECT_IDS = new Set(['plain-band-07005942']);
const REFUSED_PRODUCTION_NEON_BRANCH_IDS = new Set(['br-purple-bar-aphafrgp']);

function assertExplicitSafeDatabase(url) {
  if (confirmation !== 'allow-safe-race-writes') {
    throw new Error('Set AIT_USA_OPPORTUNITY_RACE_DATABASE_CONFIRM=allow-safe-race-writes for an explicitly approved safe database.');
  }
  const parsed = new URL(url);
  const urlIdentity = `${parsed.hostname}/${parsed.pathname}`.toLowerCase();
  if (!expectedNeonBranchId || !expectedNeonProjectId) {
    throw new Error('Set exact EXPECTED Neon branch and project ids for the approved safe database.');
  }
  if (
    !ALLOWED_NON_PRODUCTION_NEON_BRANCH_IDS.has(expectedNeonBranchId) ||
    !ALLOWED_NEON_PROJECT_IDS.has(expectedNeonProjectId) ||
    REFUSED_PRODUCTION_NEON_BRANCH_IDS.has(expectedNeonBranchId) ||
    /prod|production/.test(`${urlIdentity}/${expectedNeonBranchId}/${expectedNeonProjectId}`)
  ) {
    throw new Error('Race harness refuses a database identified as production.');
  }
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
}

async function waitForAdvisoryLockWait(observer, processId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await observer.query(
      `select
         exists (
           select 1 from pg_locks
           where pid = $1 and locktype = 'advisory' and granted = false
         ) as waiting,
         coalesce((select query from pg_stat_activity where pid = $1), '') as query`,
      [processId],
    );
    if (result.rows[0]?.waiting && /pg_advisory_xact_lock/i.test(result.rows[0]?.query || '')) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Contender never reached a proven pg_advisory_xact_lock wait barrier.');
}

function transactionDb(client, searchPath) {
  return {
    async transaction(handler) {
      await client.query('begin');
      try {
        await client.query(`set local search_path to ${searchPath}`);
        const result = await handler(client);
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    },
  };
}

test('two PostgreSQL clients serialize reopen versus Start/ingestion creation under the shared advisory lock', {
  skip: !databaseUrl ? 'Set the explicit safe race database URL and confirmation to run this harness.' : false,
}, async () => {
  assertExplicitSafeDatabase(databaseUrl);
  const { Client } = await import('pg');
  const setup = new Client({ connectionString: databaseUrl });
  const firstClient = new Client({ connectionString: databaseUrl });
  const secondClient = new Client({ connectionString: databaseUrl });
  const schema = `ait_usa_race_${randomUUID().replaceAll('-', '')}`;
  const quotedSchema = `"${schema}"`;
  const businessUnit = { id: 'bu-usa', name: 'AIT USA Institute' };
  const contact = { id: 'contact-1' };
  let releaseFirst;
  let firstEntered;
  let schemaCreated = false;
  const firstEnteredPromise = new Promise((resolve) => { firstEntered = resolve; });
  const releaseFirstPromise = new Promise((resolve) => { releaseFirst = resolve; });

  await Promise.all([setup.connect(), firstClient.connect(), secondClient.connect()]);
  try {
    await assertRuntimeDatabaseIdentity(setup);
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

    const first = withLockedAitUsaClosedOpportunityReopen({
      db: transactionDb(firstClient, quotedSchema),
      organizationId: 'org-1',
      businessUnit,
      contact,
      opportunityId: 'closed-1',
      toStatus: 'Follow Up',
      reopenReason: 'correction',
      write: async ({ tx }) => {
        firstEntered();
        await releaseFirstPromise;
        await tx.query("update leads set status = 'Follow Up', current_stage = 'Follow Up' where id = 'closed-1'");
        return 'first-won';
      },
    });
    await firstEnteredPromise;

    let secondSettled = false;
    let secondCreated = false;
    const second = transactionDb(secondClient, quotedSchema).transaction(async (tx) => {
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
    }).finally(() => { secondSettled = true; });

    await waitForAdvisoryLockWait(setup, secondClient.processID);
    assert.equal(secondSettled, false, 'second client must remain blocked at the proven advisory-lock barrier');
    releaseFirst();
    assert.equal(await first, 'first-won');
    const secondResolution = await second;
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

    let releaseReplacement;
    let replacementReady;
    const releaseReplacementPromise = new Promise((resolve) => { releaseReplacement = resolve; });
    const replacementReadyPromise = new Promise((resolve) => { replacementReady = resolve; });
    const replacement = transactionDb(secondClient, quotedSchema).transaction(async (tx) => {
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
      replacementReady();
      await releaseReplacementPromise;
    });
    await replacementReadyPromise;

    let staleWriterCalled = false;
    let staleSettled = false;
    const stalePatch = withLockedAitUsaOpportunityMutation({
      db: transactionDb(firstClient, quotedSchema),
      organizationId: 'org-1',
      businessUnit,
      contact,
      expectedOpportunityId: staleRead.rows[0].id,
      toStatus: staleRead.rows[0].status,
      write: async () => { staleWriterCalled = true; },
    }).finally(() => { staleSettled = true; });
    await waitForAdvisoryLockWait(setup, firstClient.processID);
    assert.equal(staleSettled, false, 'stale PATCH must wait at the proven advisory-lock barrier');
    releaseReplacement();
    await replacement;
    await assert.rejects(stalePatch, (error) => error.status === 409);
    assert.equal(staleWriterCalled, false);
    const finalActive = await setup.query(
      `select id from ${quotedSchema}.leads where status in ('New Lead', 'Follow Up') order by id`,
    );
    assert.deepEqual(finalActive.rows.map((row) => row.id), ['active-b']);
  } finally {
    if (schemaCreated) await setup.query(`drop schema if exists ${quotedSchema} cascade`).catch(() => {});
    await Promise.all([setup.end(), firstClient.end(), secondClient.end()]);
  }
});
