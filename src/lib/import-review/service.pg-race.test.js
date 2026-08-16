import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { updateImportReviewStatus } from './service.js';

const databaseUrl = String(process.env.IMPORT_REVIEW_RACE_DATABASE_URL || '').trim();
const confirmation = String(process.env.IMPORT_REVIEW_RACE_DATABASE_CONFIRM || '').trim();
const expectedNeonBranchId = String(process.env.IMPORT_REVIEW_RACE_EXPECTED_NEON_BRANCH_ID || '').trim();
const expectedNeonProjectId = String(process.env.IMPORT_REVIEW_RACE_EXPECTED_NEON_PROJECT_ID || '').trim();
const targetBaseUrl = String(process.env.IMPORT_REVIEW_RACE_TARGET_BASE_URL || '').trim();
const ALLOWED_NON_PRODUCTION_NEON_BRANCH_IDS = new Set(['br-broad-hill-aptjpyea']);
const ALLOWED_NEON_PROJECT_IDS = new Set(['plain-band-07005942']);
const REFUSED_PRODUCTION_NEON_BRANCH_IDS = new Set(['br-purple-bar-aphafrgp']);
const NEON_BRANCH_NAMES = new Map([['br-broad-hill-aptjpyea', 'staging']]);
const DEADLINE_MS = 8_000;

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

async function withDeadline(promise, label, timeoutMs = DEADLINE_MS) {
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

function assertExplicitSafeDatabase(url) {
  if (confirmation !== 'allow-safe-race-writes') {
    throw new Error('Set IMPORT_REVIEW_RACE_DATABASE_CONFIRM=allow-safe-race-writes for an explicitly approved safe database.');
  }
  const parsed = new URL(url);
  const identity = `${parsed.hostname}/${parsed.pathname}/${expectedNeonBranchId}/${expectedNeonProjectId}`.toLowerCase();
  if (!targetBaseUrl) throw new Error('Set nonsecret IMPORT_REVIEW_RACE_TARGET_BASE_URL.');
  const parsedTarget = new URL(targetBaseUrl);
  if (
    !['http:', 'https:'].includes(parsedTarget.protocol)
    || parsedTarget.username
    || parsedTarget.password
    || parsedTarget.search
    || parsedTarget.hash
  ) {
    throw new Error('IMPORT_REVIEW_RACE_TARGET_BASE_URL must be a nonsecret HTTP(S) URL without credentials, query, or fragment.');
  }
  if (
    !ALLOWED_NON_PRODUCTION_NEON_BRANCH_IDS.has(expectedNeonBranchId)
    || !ALLOWED_NEON_PROJECT_IDS.has(expectedNeonProjectId)
    || REFUSED_PRODUCTION_NEON_BRANCH_IDS.has(expectedNeonBranchId)
    || /prod|production/.test(identity)
  ) {
    throw new Error('Import Review race harness refuses a database identified as production.');
  }
  return parsedTarget.toString().replace(/\/$/, '');
}

async function assertRuntimeDatabaseIdentity(client) {
  const result = await client.query(`
    select
      current_setting('neon.branch_id', true) as branch_id,
      current_setting('neon.project_id', true) as project_id
  `);
  const branchId = String(result.rows[0]?.branch_id || '').trim();
  const projectId = String(result.rows[0]?.project_id || '').trim();
  if (REFUSED_PRODUCTION_NEON_BRANCH_IDS.has(branchId)) {
    throw new Error('Import Review race harness refuses the production Neon branch.');
  }
  if (branchId !== expectedNeonBranchId || projectId !== expectedNeonProjectId) {
    throw new Error('Runtime Neon identity does not match the approved staging branch and project.');
  }
  return { branchId, projectId };
}

function safeDatabaseFingerprint(url, schema, safeTargetBaseUrl, runtimeIdentity) {
  const parsed = new URL(url);
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, '').split('/')[0] || '');
  if (!database) throw new Error('Race database URL must identify a database.');
  return {
    targetBaseUrl: safeTargetBaseUrl,
    neonProjectId: runtimeIdentity.projectId,
    neonBranchId: runtimeIdentity.branchId,
    branchName: NEON_BRANCH_NAMES.get(runtimeIdentity.branchId) || 'unknown',
    hostSuffix: parsed.hostname.split('.').filter(Boolean).slice(-3).join('.'),
    database,
    schema,
  };
}

async function setSearchPath(client, quotedSchema) {
  await client.query(`set search_path to ${quotedSchema}, pg_catalog`);
}

async function observeAdvisoryLockWait(observer, processId) {
  let rows = [];
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await observer.query(
      `select locktype, mode, granted
       from pg_locks
       where pid = $1 and locktype = 'advisory'
       order by granted, mode`,
      [processId],
    );
    rows = result.rows;
    if (rows.some((row) => row.granted === false)) return { observed: true, rows };
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return { observed: false, rows };
}

async function seedImportRecord(client, {
  businessUnitId,
  batchId,
  sourceRowId,
  recordId,
  reviewItemId,
  suffix,
  rowNumber,
}) {
  await client.query(
    `insert into import_source_rows
      (id, import_batch_id, source_sheet, source_row_number, raw_values_json, raw_text, parse_status)
     values ($1, $2, 'Facebook Lead Ads', $3, '{}'::jsonb, $4, 'parsed')`,
    [sourceRowId, batchId, rowNumber, `import-review-race-${suffix}`],
  );
  await client.query(
    `insert into import_normalized_records
      (id, import_batch_id, source_row_id, record_type, proposed_contact_json, proposed_lead_json, status)
     values ($1, $2, $3, 'lead', $4::jsonb, $5::jsonb, 'pending')`,
    [
      recordId,
      batchId,
      sourceRowId,
      JSON.stringify({
        name: `Import Review Race ${suffix}`,
        email: `import-review-race-${suffix}@example.invalid`,
        business_unit_id: businessUnitId,
      }),
      JSON.stringify({
        source_type: 'facebook_webhook',
        source_name: 'Facebook Ads',
        lead_id: null,
        leadgen_id: `race-${suffix}`,
        form_id: 'import-review-race-gate',
        business_unit_id: businessUnitId,
      }),
    ],
  );
  await client.query(
    `insert into import_review_items
      (id, import_batch_id, source_row_id, review_type, reason, review_status)
     values ($1, $2, $3, 'lead', 'PostgreSQL race gate', 'pending')`,
    [reviewItemId, batchId, sourceRowId],
  );
}

async function verifySinglePromotion(client, { organizationId, sourceRowId, recordId }) {
  const result = await client.query(
    `select
       (select count(*)::int from contacts where organization_id = $1) as contacts,
       (select count(*)::int from leads where organization_id = $1 and original_notes like $2) as leads,
       (select count(*)::int from tasks where organization_id = $1 and lead_id in (
          select id from leads where organization_id = $1 and original_notes like $2
        )) as tasks,
       (select count(*)::int from notifications where organization_id = $1 and lead_id in (
          select id from leads where organization_id = $1 and original_notes like $2
        )) as notifications,
       (select status from import_normalized_records where id = $3) as record_status`,
    [organizationId, `%source_row_id=${sourceRowId}%`, recordId],
  );
  return result.rows[0];
}

async function endClient(client) {
  if (!client) return;
  await client.end().catch(() => {
    client.connection?.stream?.destroy();
  });
}

test('real PostgreSQL Import Review promotion serializes concurrent approvals and recovers after a committed-session crash', {
  skip: !databaseUrl
    ? 'Set the explicit safe Import Review race database URL, confirmation, identity, and target base URL.'
    : false,
  timeout: 45_000,
}, async () => {
  const safeTargetBaseUrl = assertExplicitSafeDatabase(databaseUrl);
  const { Client } = await import('pg');
  const setup = new Client({ connectionString: databaseUrl });
  const observer = new Client({ connectionString: databaseUrl });
  const firstClient = new Client({ connectionString: databaseUrl });
  const secondClient = new Client({ connectionString: databaseUrl });
  const crashClient = new Client({ connectionString: databaseUrl });
  const retryClient = new Client({ connectionString: databaseUrl });
  const schema = `import_review_race_${randomUUID().replaceAll('-', '')}`;
  const quotedSchema = `"${schema}"`;
  const organizationId = randomUUID();
  const businessUnitId = randomUUID();
  const userId = randomUUID();
  const batchId = randomUUID();
  const raceRecord = {
    sourceRowId: randomUUID(),
    recordId: randomUUID(),
    reviewItemId: randomUUID(),
  };
  const crashRecord = {
    sourceRowId: randomUUID(),
    recordId: randomUUID(),
    reviewItemId: randomUUID(),
  };
  let schemaCreated = false;
  const releaseFirst = deferred();

  try {
    await withDeadline(
      Promise.all([
        setup.connect(), observer.connect(), firstClient.connect(), secondClient.connect(),
        crashClient.connect(), retryClient.connect(),
      ]),
      'connect Import Review race clients',
      12_000,
    );
    const runtimeIdentity = await assertRuntimeDatabaseIdentity(setup);
    console.info(
      'Import Review race harness SAFE database fingerprint:',
      JSON.stringify(safeDatabaseFingerprint(databaseUrl, schema, safeTargetBaseUrl, runtimeIdentity)),
    );

    await setup.query(`create schema ${quotedSchema}`);
    schemaCreated = true;
    const tables = [
      'organizations', 'business_units', 'users', 'business_unit_memberships',
      'import_batches', 'import_source_rows', 'import_normalized_records', 'import_review_items',
      'contacts', 'leads', 'activity_events', 'notifications', 'tasks', 'task_events', 'notes',
    ];
    for (const table of tables) {
      await setup.query(`create table ${quotedSchema}."${table}" (like public."${table}" including all)`);
    }
    await Promise.all([
      setSearchPath(setup, quotedSchema),
      setSearchPath(firstClient, quotedSchema),
      setSearchPath(secondClient, quotedSchema),
      setSearchPath(crashClient, quotedSchema),
      setSearchPath(retryClient, quotedSchema),
    ]);
    await setup.query(
      `insert into organizations (id, name, slug) values ($1, 'Import Review Race Gate', $2)`,
      [organizationId, `import-review-race-${organizationId}`],
    );
    await setup.query(
      `insert into business_units (id, organization_id, name, label, is_active)
       values ($1, $2, 'AIT USA Institute', 'Divisions', true)`,
      [businessUnitId, organizationId],
    );
    await setup.query(
      `insert into users (id, organization_id, name, email, is_active)
       values ($1, $2, 'Race Gate Owner', $3, true)`,
      [userId, organizationId, `race-owner-${userId}@example.invalid`],
    );
    await setup.query(
      `insert into business_unit_memberships (business_unit_id, user_id, is_primary)
       values ($1, $2, true)`,
      [businessUnitId, userId],
    );
    await setup.query(
      `insert into import_batches
        (id, organization_id, business_unit_id, source_name, source_type, file_name, status)
       values ($1, $2, $3, 'Import Review Race Gate', 'facebook_lead_ads', 'race-gate.json', 'loaded')`,
      [batchId, organizationId, businessUnitId],
    );
    await seedImportRecord(setup, {
      businessUnitId, batchId, ...raceRecord, suffix: 'concurrent', rowNumber: 1,
    });
    await seedImportRecord(setup, {
      businessUnitId, batchId, ...crashRecord, suffix: 'crash', rowNumber: 2,
    });

    const firstCommitted = deferred();
    const request = { batchId, status: 'approved', recordIds: [raceRecord.recordId], organizationId };
    const first = updateImportReviewStatus(firstClient, {
      ...request,
      afterCrmCommit: async () => {
        firstCommitted.resolve();
        await releaseFirst.promise;
      },
    });
    await withDeadline(firstCommitted.promise, 'first promotion commit barrier');

    const secondPid = Number((await secondClient.query('select pg_backend_pid()::int as pid')).rows[0].pid);
    let secondSettled = false;
    const second = updateImportReviewStatus(secondClient, request).finally(() => { secondSettled = true; });
    const lockObservation = await withDeadline(
      observeAdvisoryLockWait(observer, secondPid),
      'observe second Import Review advisory lock wait',
    );
    assert.equal(lockObservation.observed, true, `second session did not wait on the server advisory lock: ${JSON.stringify(lockObservation)}`);
    assert.equal(secondSettled, false, 'second approval settled before the first session released the advisory lock');
    releaseFirst.resolve();

    const [firstResult, secondResult] = await withDeadline(
      Promise.all([first, second]),
      'concurrent Import Review approvals',
      12_000,
    );
    assert.deepEqual(
      [firstResult.promotionOutcomes[0].outcome, secondResult.promotionOutcomes[0].outcome].sort(),
      ['already_promoted', 'promoted'],
    );
    assert.deepEqual(
      await verifySinglePromotion(setup, {
        organizationId,
        sourceRowId: raceRecord.sourceRowId,
        recordId: raceRecord.recordId,
      }),
      { contacts: 1, leads: 1, tasks: 1, notifications: 1, record_status: 'promoted' },
    );

    await assert.rejects(
      updateImportReviewStatus(crashClient, {
        batchId,
        status: 'approved',
        recordIds: [crashRecord.recordId],
        organizationId,
        afterCrmCommit: async () => {
          await crashClient.end();
          throw new Error('simulated process crash after committed CRM promotion');
        },
      }),
      /simulated process crash after committed CRM promotion/,
    );
    const afterCrash = await verifySinglePromotion(setup, {
      organizationId,
      sourceRowId: crashRecord.sourceRowId,
      recordId: crashRecord.recordId,
    });
    assert.deepEqual(afterCrash, {
      contacts: 2,
      leads: 1,
      tasks: 1,
      notifications: 1,
      record_status: 'promoting',
    });

    const retry = await updateImportReviewStatus(retryClient, {
      batchId,
      status: 'approved',
      recordIds: [crashRecord.recordId],
      organizationId,
    });
    assert.equal(retry.promotionOutcomes[0].outcome, 'already_promoted');
    assert.deepEqual(
      await verifySinglePromotion(setup, {
        organizationId,
        sourceRowId: crashRecord.sourceRowId,
        recordId: crashRecord.recordId,
      }),
      { contacts: 2, leads: 1, tasks: 1, notifications: 1, record_status: 'promoted' },
    );
  } finally {
    releaseFirst.resolve();
    if (schemaCreated) {
      await withDeadline(
        observer.query(`drop schema if exists ${quotedSchema} cascade`),
        `drop Import Review race schema ${schema}`,
        12_000,
      );
    }
    await Promise.all([
      endClient(firstClient), endClient(secondClient), endClient(crashClient), endClient(retryClient),
      endClient(setup), endClient(observer),
    ]);
  }
});
