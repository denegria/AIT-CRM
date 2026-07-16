#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { INBOUND_LEAD_SOURCE_TYPES, isCurrentInboundLeadProvenance } from '../src/lib/crm/lead-provenance.js';

const OPEN_STATUSES = ['open', 'in_progress', 'snoozed'];
const NO_FURTHER_PROSPECTING = new Set(['Enrolled', 'Not Interested']);
const SOURCE_LABEL = 'New lead follow-up';

function parseArgs(argv) {
  const options = { apply: false, fixture: null, limit: 500, organizationId: null, businessUnitId: null };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--apply') options.apply = true;
    else if (value === '--fixture') options.fixture = argv[++index];
    else if (value === '--limit') options.limit = Number(argv[++index]);
    else if (value === '--organization-id') options.organizationId = argv[++index];
    else if (value === '--business-unit-id') options.businessUnitId = argv[++index];
    else throw new Error(`Unknown option: ${value}`);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1000) {
    throw new Error('--limit must be an integer from 1 to 1000.');
  }
  return options;
}

function groupedCounts(rows) {
  return rows.reduce((counts, row) => {
    counts[row.action] = (counts[row.action] || 0) + 1;
    return counts;
  }, { sync_owner: 0, cancel: 0 });
}

function planRow(task, lead) {
  if (!lead || task.contactId !== lead.contactId || !isCurrentInboundLeadProvenance({ sourceType: lead.sourceType })) return null;
  const lifecycleStatus = String(lead?.status || '').trim();
  if (NO_FURTHER_PROSPECTING.has(lifecycleStatus)) {
    return { taskId: task.id, contactId: task.contactId, leadId: task.leadId, action: 'cancel', lifecycleStatus };
  }
  const resolvedOwnerUserId = lead.assignedUserId || null;
  if ((task.ownerUserId || null) !== resolvedOwnerUserId) {
    return { taskId: task.id, contactId: task.contactId, leadId: task.leadId, action: 'sync_owner', ownerUserId: resolvedOwnerUserId };
  }
  return null;
}

function fixtureFingerprint(path, raw) {
  return {
    kind: 'fixture',
    name: path.split('/').pop(),
    sha256: createHash('sha256').update(raw).digest('hex').slice(0, 16),
  };
}

async function fixturePlan(options) {
  const raw = await readFile(options.fixture, 'utf8');
  const fixture = JSON.parse(raw);
  const leads = new Map((fixture.leads || []).map((lead) => [lead.id, lead]));
  const candidates = (fixture.tasks || [])
    .filter((task) => task.taskType === 'follow_up' && task.sourceType === 'automation')
    .filter((task) => task.sourceLabel === SOURCE_LABEL && OPEN_STATUSES.includes(task.status))
    .filter((task) => !options.organizationId || task.organizationId === options.organizationId)
    .filter((task) => !options.businessUnitId || task.businessUnitId === options.businessUnitId)
    .filter((task) => {
      const lead = leads.get(task.leadId);
      return lead && task.contactId === lead.contactId && isCurrentInboundLeadProvenance({ sourceType: lead.sourceType });
    })
    .slice(0, options.limit);
  return {
    fingerprint: fixtureFingerprint(options.fixture, raw),
    rows: candidates.map((task) => planRow(task, leads.get(task.leadId))).filter(Boolean),
  };
}

function safeDatabaseFingerprint(databaseUrl, row) {
  const parsed = new URL(databaseUrl);
  return {
    kind: 'database',
    hostSuffix: parsed.hostname.split('.').slice(-4).join('.'),
    database: row.database,
    schema: row.schema,
    neonBranchId: row.neon_branch_id || null,
    neonProjectId: row.neon_project_id || null,
  };
}

async function databasePlan(client, options, { lock = false } = {}) {
  const fingerprintRow = (await client.query(`select current_database() as database, current_schema() as schema, current_setting('neon.branch_id', true) as neon_branch_id, current_setting('neon.project_id', true) as neon_project_id`)).rows[0];
  const result = await client.query(`
    select t.id, t.organization_id as "organizationId", t.business_unit_id as "businessUnitId", t.contact_id as "contactId", t.lead_id as "leadId", t.owner_user_id as "ownerUserId", l.contact_id as "leadContactId", l.source_type as "leadSourceType", l.assigned_user_id as "assignedUserId", l.status
    from tasks t
    join leads l on l.id = t.lead_id and l.organization_id = t.organization_id and l.business_unit_id = t.business_unit_id and l.contact_id = t.contact_id
    where t.task_type = 'follow_up' and t.source_type = 'automation' and t.source_label = $1
      and t.status = any($2::text[])
      and ($3::uuid is null or t.organization_id = $3)
      and ($4::uuid is null or t.business_unit_id = $4)
      and lower(l.source_type) = any($5::text[])
    order by t.created_at asc, t.id asc
    limit $6
    ${lock ? 'for update' : ''}
  `, [SOURCE_LABEL, OPEN_STATUSES, options.organizationId, options.businessUnitId, INBOUND_LEAD_SOURCE_TYPES, options.limit]);
  return {
    fingerprint: safeDatabaseFingerprint(process.env.DATABASE_URL, fingerprintRow),
    rows: result.rows.map((task) => planRow(task, {
      id: task.leadId,
      contactId: task.leadContactId,
      sourceType: task.leadSourceType,
      assignedUserId: task.assignedUserId,
      status: task.status,
    })).filter(Boolean),
  };
}

async function applyDatabasePlan(client, rows, actorUserId = null) {
  for (const row of rows) {
    if (row.action === 'sync_owner') {
      await client.query(`
        with candidate as (
          select t.*, l.assigned_user_id as resolved_owner_user_id
          from tasks t
          join leads l on l.id = t.lead_id and l.organization_id = t.organization_id and l.business_unit_id = t.business_unit_id and l.contact_id = t.contact_id
          where t.id = $1
            and t.task_type = 'follow_up'
            and t.source_type = 'automation'
            and t.source_label = $2
            and t.status = any($3::text[])
            and lower(l.source_type) = any($4::text[])
            and l.status not in ('Enrolled', 'Not Interested')
            and t.owner_user_id is distinct from l.assigned_user_id
          for update
        ), changed as (
          update tasks t set owner_user_id = c.resolved_owner_user_id, updated_at = now()
          from candidate c where t.id = c.id returning t.*
        )
        insert into task_events (task_id, organization_id, business_unit_id, event_type, from_status, to_status, from_owner_user_id, to_owner_user_id, from_due_at, to_due_at, actor_user_id, message, metadata_json, occurred_at)
        select changed.id, changed.organization_id, changed.business_unit_id, 'assigned', candidate.status, changed.status, candidate.owner_user_id, changed.owner_user_id, candidate.due_at, changed.due_at, $5, 'Synchronized automated inbound follow-up owner with contact assignment.', jsonb_build_object('source', 'backlog_reconciliation', 'reason', 'contact_owner_changed', 'contactId', changed.contact_id, 'leadId', changed.lead_id), now() from changed join candidate on candidate.id = changed.id
      `, [row.taskId, SOURCE_LABEL, OPEN_STATUSES, INBOUND_LEAD_SOURCE_TYPES, actorUserId]);
    } else {
      await client.query(`
        with candidate as (
          select t.*, l.status as lifecycle_status
          from tasks t
          join leads l on l.id = t.lead_id and l.organization_id = t.organization_id and l.business_unit_id = t.business_unit_id and l.contact_id = t.contact_id
          where t.id = $1
            and t.task_type = 'follow_up'
            and t.source_type = 'automation'
            and t.source_label = $2
            and t.status = any($3::text[])
            and lower(l.source_type) = any($4::text[])
            and l.status in ('Enrolled', 'Not Interested')
          for update
        ), changed as (
          update tasks t set status = 'canceled', canceled_at = now(), completed_at = null, snoozed_until = null, updated_at = now()
          from candidate c where t.id = c.id returning t.*
        )
        insert into task_events (task_id, organization_id, business_unit_id, event_type, from_status, to_status, from_owner_user_id, to_owner_user_id, from_due_at, to_due_at, actor_user_id, message, metadata_json, occurred_at)
        select changed.id, changed.organization_id, changed.business_unit_id, 'canceled', candidate.status, changed.status, candidate.owner_user_id, changed.owner_user_id, candidate.due_at, changed.due_at, $5, 'Canceled automated inbound follow-up because the contact no longer needs prospecting.', jsonb_build_object('source', 'backlog_reconciliation', 'reason', 'no_further_prospecting_lifecycle', 'lifecycleStatus', candidate.lifecycle_status, 'contactId', changed.contact_id, 'leadId', changed.lead_id), now() from changed join candidate on candidate.id = changed.id
      `, [row.taskId, SOURCE_LABEL, OPEN_STATUSES, INBOUND_LEAD_SOURCE_TYPES, actorUserId]);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.fixture && options.apply) throw new Error('Fixture mode is dry-run only; omit --apply.');
  if (!options.fixture && !process.env.DATABASE_URL) throw new Error('Use --fixture for a local dry-run or provide DATABASE_URL for a database target.');
  if (!options.fixture && !options.organizationId) throw new Error('--organization-id is required for database reconciliation.');
  if (options.apply && !process.env.EXPECTED_NEON_BRANCH_ID) throw new Error('EXPECTED_NEON_BRANCH_ID is required with --apply.');

  if (options.fixture) {
    const plan = await fixturePlan(options);
    console.log(JSON.stringify({ mode: 'dry-run', fingerprint: plan.fingerprint, groupedCounts: groupedCounts(plan.rows), candidates: plan.rows }, null, 2));
    return;
  }

  const { Client } = await import('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(options.apply ? 'begin' : 'begin read only');
    const plan = await databasePlan(client, options, { lock: options.apply });
    if (options.apply && plan.fingerprint.neonBranchId !== process.env.EXPECTED_NEON_BRANCH_ID) {
      throw new Error(`Refusing write: expected Neon branch ${process.env.EXPECTED_NEON_BRANCH_ID}, received ${plan.fingerprint.neonBranchId || '(unknown)'}.`);
    }
    console.log(JSON.stringify({ mode: options.apply ? 'apply' : 'dry-run', fingerprint: plan.fingerprint, groupedCounts: groupedCounts(plan.rows), candidateCount: plan.rows.length }, null, 2));
    if (options.apply) await applyDatabasePlan(client, plan.rows, process.env.RECONCILIATION_ACTOR_USER_ID || null);
    await client.query(options.apply ? 'commit' : 'rollback');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
