#!/usr/bin/env node

import fs from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const BUSINESS_UNIT_NAME = 'AIT Signs';
const MISSING_IDENTITY_PREFIX = 'Missing customer/contact/phone identity:';
const CONTACT_BLOCKER_TABLES = [
  'leads',
  'estimates',
  'work_orders',
  'activity_events',
  'notes',
  'tasks',
  'conversations',
  'conversation_messages',
  'follow_up_sequence_enrollments',
  'follow_up_sequence_step_runs',
];

function parseArgs(argv) {
  const options = {
    dryRun: true,
    artifact: null,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.dryRun = false;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--artifact') {
      options.artifact = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!options.artifact) throw new Error('--artifact is required');
  return options;
}

function readArtifact(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').trimStart();
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(0, i + 1));
    }
  }
  throw new Error(`Could not parse artifact JSON from ${filePath}`);
}

export function identitylessRowsFromArtifact(artifact) {
  const rows = [];
  const seen = new Set();
  for (const item of artifact.reviewItems || []) {
    if (!String(item.reason || '').startsWith(MISSING_IDENTITY_PREFIX)) continue;
    const sourceSheet = String(item.sourceSheet || '').trim();
    const sourceRow = Number(item.sourceRowNumber || 0);
    if (!sourceSheet || !sourceRow) continue;
    const key = `${sourceSheet}::${sourceRow}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ sourceSheet, sourceRow });
  }
  return rows;
}

function valuesSql(rows, startIndex = 1) {
  return rows.map((_, index) => `($${startIndex + index * 2}::text, $${startIndex + index * 2 + 1}::int)`).join(', ');
}

function rowParams(rows) {
  return rows.flatMap((row) => [row.sourceSheet, row.sourceRow]);
}

async function contactColumnExists(client, tableName) {
  const result = await client.query(
    `
      select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = $1
          and column_name = 'contact_id'
      ) as exists
    `,
    [tableName],
  );
  return Boolean(result.rows[0]?.exists);
}

async function loadPlan(client, rows) {
  if (!rows.length) {
    return {
      identitylessSourceRows: 0,
      matchedEvents: [],
      contactIds: [],
      estimateIds: [],
      workOrderIds: [],
      deletableContactIds: [],
      blockedContacts: [],
    };
  }

  const params = rowParams(rows);
  const matchedResult = await client.query(
    `
      with bad_rows(source_sheet, source_row) as (values ${valuesSql(rows)})
      select
        ae.id as activity_event_id,
        ae.source_sheet,
        ae.source_row,
        ae.contact_id,
        ae.estimate_id,
        ae.work_order_id,
        c.name as contact_name,
        c.company_name,
        c.phone
      from activity_events ae
      join business_units bu on bu.id = ae.business_unit_id
      join contacts c on c.id = ae.contact_id
      join bad_rows br on br.source_sheet = ae.source_sheet and br.source_row = ae.source_row
      where bu.name = $${params.length + 1}
      order by ae.source_sheet, ae.source_row
    `,
    [...params, BUSINESS_UNIT_NAME],
  );

  const matchedEvents = matchedResult.rows;
  const contactIds = [...new Set(matchedEvents.map((row) => row.contact_id).filter(Boolean))];
  const estimateIds = [...new Set(matchedEvents.map((row) => row.estimate_id).filter(Boolean))];
  const workOrderIds = [...new Set(matchedEvents.map((row) => row.work_order_id).filter(Boolean))];
  const activityEventIds = [...new Set(matchedEvents.map((row) => row.activity_event_id).filter(Boolean))];

  const blockedContacts = [];
  const deletableContactIds = [];
  for (const contactId of contactIds) {
    const linkedResult = await client.query(
      `
        select
          (select count(*)::int from activity_events where contact_id = $1 and id <> all($2::uuid[])) as activity_events,
          (select count(*)::int from estimates where contact_id = $1 and id <> all($3::uuid[])) as estimates,
          (select count(*)::int from work_orders where contact_id = $1 and id <> all($4::uuid[])) as work_orders,
          (select count(*)::int from leads where contact_id = $1) as leads,
          (select count(*)::int from tasks where contact_id = $1) as tasks,
          (select count(*)::int from conversations where contact_id = $1) as conversations,
          (select count(*)::int from conversation_messages where contact_id = $1) as conversation_messages,
          (select count(*)::int from follow_up_sequence_enrollments where contact_id = $1) as follow_up_sequence_enrollments,
          (select count(*)::int from follow_up_sequence_step_runs where contact_id = $1) as follow_up_sequence_step_runs
      `,
      [contactId, activityEventIds, estimateIds, workOrderIds],
    );
    const counts = linkedResult.rows[0] || {};
    const nonBadLinks = Object.entries(counts).reduce((sum, [, value]) => sum + Number(value || 0), 0);
    if (nonBadLinks > 0) {
      blockedContacts.push({ contactId, nonBadLinks: counts });
    } else {
      deletableContactIds.push(contactId);
    }
  }

  return {
    identitylessSourceRows: rows.length,
    matchedEvents,
    activityEventIds,
    contactIds,
    estimateIds,
    workOrderIds,
    deletableContactIds,
    blockedContacts,
  };
}

function summarizePlan(plan) {
  return {
    identitylessSourceRows: plan.identitylessSourceRows,
    matchedPromotedEvents: plan.matchedEvents.length,
    contactsTouched: plan.contactIds.length,
    contactsDeletable: plan.deletableContactIds.length,
    contactsBlockedByNonBadLinks: plan.blockedContacts.length,
    estimatesToDelete: plan.estimateIds.length,
    workOrdersToDelete: plan.workOrderIds.length,
    sampleRows: plan.matchedEvents.slice(0, 12).map((row) => ({
      sourceSheet: row.source_sheet,
      sourceRow: row.source_row,
      contactName: row.contact_name,
      phone: row.phone,
    })),
    blockedContacts: plan.blockedContacts,
  };
}

async function deleteFromContactTable(client, tableName, contactIds) {
  if (!contactIds.length) return 0;
  if (!(await contactColumnExists(client, tableName))) return 0;
  const result = await client.query(
    `delete from ${tableName} where contact_id = any($1::uuid[])`,
    [contactIds],
  );
  return result.rowCount || 0;
}

async function applyPlan(client, rows, plan) {
  const result = {
    paymentSnapshotsDeleted: 0,
    activityEventsDeleted: 0,
    notesDeleted: 0,
    leadStatusHistoryDeleted: 0,
    estimatesDeleted: 0,
    workOrdersDeleted: 0,
    contactsDeleted: 0,
  };

  if (rows.length) {
    const deletePayments = await client.query(
      `
        with bad_rows(source_sheet, source_row) as (values ${valuesSql(rows)})
        delete from payment_snapshots ps
        using bad_rows br
        where ps.source_sheet = br.source_sheet
          and ps.source_row = br.source_row
      `,
      rowParams(rows),
    );
    result.paymentSnapshotsDeleted = deletePayments.rowCount || 0;
  }

  if (plan.activityEventIds.length) {
    const deleteEvents = await client.query(
      'delete from activity_events where id = any($1::uuid[])',
      [plan.activityEventIds],
    );
    result.activityEventsDeleted = deleteEvents.rowCount || 0;
  }

  if (plan.deletableContactIds.length) {
    result.notesDeleted = await deleteFromContactTable(client, 'notes', plan.deletableContactIds);
    result.leadStatusHistoryDeleted = await deleteFromContactTable(client, 'lead_status_history', plan.deletableContactIds);
  }

  if (plan.estimateIds.length) {
    const deleteEstimates = await client.query(
      'delete from estimates where id = any($1::uuid[])',
      [plan.estimateIds],
    );
    result.estimatesDeleted = deleteEstimates.rowCount || 0;
  }

  if (plan.workOrderIds.length) {
    const deleteWorkOrders = await client.query(
      'delete from work_orders where id = any($1::uuid[])',
      [plan.workOrderIds],
    );
    result.workOrdersDeleted = deleteWorkOrders.rowCount || 0;
  }

  for (const tableName of CONTACT_BLOCKER_TABLES) {
    if (tableName === 'notes') continue;
    await contactColumnExists(client, tableName);
  }

  if (plan.deletableContactIds.length) {
    const deleteContacts = await client.query(
      `
        delete from contacts c
        where c.id = any($1::uuid[])
          and not exists (select 1 from leads where contact_id = c.id)
          and not exists (select 1 from estimates where contact_id = c.id)
          and not exists (select 1 from work_orders where contact_id = c.id)
          and not exists (select 1 from activity_events where contact_id = c.id)
          and not exists (select 1 from notes where contact_id = c.id)
          and not exists (select 1 from tasks where contact_id = c.id)
          and not exists (select 1 from conversations where contact_id = c.id)
          and not exists (select 1 from conversation_messages where contact_id = c.id)
          and not exists (select 1 from follow_up_sequence_enrollments where contact_id = c.id)
          and not exists (select 1 from follow_up_sequence_step_runs where contact_id = c.id)
      `,
      [plan.deletableContactIds],
    );
    result.contactsDeleted = deleteContacts.rowCount || 0;
  }

  return result;
}

async function main() {
  const options = parseArgs(process.argv);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const artifact = readArtifact(options.artifact);
  const rows = identitylessRowsFromArtifact(artifact);
  const { Client } = await import('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const plan = await loadPlan(client, rows);
    if (options.dryRun) {
      console.log(JSON.stringify({ dryRun: true, ...summarizePlan(plan) }, null, 2));
      return;
    }
    if (plan.blockedContacts.length) {
      throw new Error(`Refusing cleanup: ${plan.blockedContacts.length} contacts have non-bad linked records.`);
    }
    await client.query('begin');
    const result = await applyPlan(client, rows, plan);
    await client.query('commit');
    console.log(JSON.stringify({ dryRun: false, ...summarizePlan(plan), result }, null, 2));
  } catch (error) {
    try { await client.query('rollback'); } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
