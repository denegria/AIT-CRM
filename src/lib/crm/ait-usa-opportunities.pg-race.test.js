import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  resolveAitUsaActiveOpportunity,
  withLockedAitUsaClosedOpportunityReopen,
} from './ait-usa-opportunities.js';

const databaseUrl = String(process.env.AIT_USA_OPPORTUNITY_RACE_DATABASE_URL || '').trim();
const confirmation = String(process.env.AIT_USA_OPPORTUNITY_RACE_DATABASE_CONFIRM || '').trim();
const databaseIdentity = String(process.env.AIT_USA_OPPORTUNITY_RACE_DATABASE_IDENTITY || '').trim();

function assertExplicitSafeDatabase(url) {
  if (confirmation !== 'allow-safe-race-writes') {
    throw new Error('Set AIT_USA_OPPORTUNITY_RACE_DATABASE_CONFIRM=allow-safe-race-writes for an explicitly approved safe database.');
  }
  const parsed = new URL(url);
  const urlIdentity = `${parsed.hostname}/${parsed.pathname}`.toLowerCase();
  const assertedIdentity = databaseIdentity.toLowerCase();
  if (!assertedIdentity || !/(test|testing|staging|br-broad-hill-aptjpyea)/.test(assertedIdentity)) {
    throw new Error('Set AIT_USA_OPPORTUNITY_RACE_DATABASE_IDENTITY to the verified safe test/staging branch label or id.');
  }
  if (/prod|production|br-purple-bar-aphafrgp/.test(`${urlIdentity}/${assertedIdentity}`)) {
    throw new Error('Race harness refuses a database identified as production.');
  }
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
  const firstEnteredPromise = new Promise((resolve) => { firstEntered = resolve; });
  const releaseFirstPromise = new Promise((resolve) => { releaseFirst = resolve; });

  await Promise.all([setup.connect(), firstClient.connect(), secondClient.connect()]);
  try {
    await setup.query(`create schema ${quotedSchema}`);
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

    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(secondSettled, false, 'second client must wait on the shared scope lock');
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
  } finally {
    await setup.query(`drop schema if exists ${quotedSchema} cascade`).catch(() => {});
    await Promise.all([setup.end(), firstClient.end(), secondClient.end()]);
  }
});
