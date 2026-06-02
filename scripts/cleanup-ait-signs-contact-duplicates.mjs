#!/usr/bin/env node

import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

const BUSINESS_UNIT_NAME = 'AIT Signs';
const CONTACT_TABLES = [
  'leads',
  'lead_status_history',
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

const COMPANY_ALIASES = new Map([
  ['delimiddlesex', "SAL'S DELI"],
  ['salsdeli', "SAL'S DELI"],
]);

function parseArgs(argv) {
  const options = {
    dryRun: true,
    company: null,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.dryRun = false;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--company') {
      options.company = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function normalizeIdentityKey(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function canonicalCompanyName(value) {
  const label = cleanText(value);
  return COMPANY_ALIASES.get(normalizeIdentityKey(label)) || label;
}

function companyLabel(row) {
  return canonicalCompanyName(row.company_name || row.name);
}

function choosePrimary(rows) {
  return [...rows].sort((a, b) => {
    const aHasPhone = cleanText(a.phone) ? 0 : 1;
    const bHasPhone = cleanText(b.phone) ? 0 : 1;
    if (aHasPhone !== bHasPhone) return aHasPhone - bHasPhone;
    const linkedDelta = Number(b.linked_count || 0) - Number(a.linked_count || 0);
    if (linkedDelta) return linkedDelta;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  })[0];
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

async function loadAitSignsContacts(client) {
  const result = await client.query(
    `
      select
        c.id,
        c.organization_id,
        c.primary_business_unit_id,
        c.name,
        c.company_name,
        c.phone,
        c.source_label,
        c.created_at,
        (
          (select count(*) from leads where contact_id = c.id)
          + (select count(*) from estimates where contact_id = c.id)
          + (select count(*) from work_orders where contact_id = c.id)
          + (select count(*) from activity_events where contact_id = c.id)
          + (select count(*) from notes where contact_id = c.id)
          + (select count(*) from tasks where contact_id = c.id)
        )::int as linked_count
      from contacts c
      join business_units bu on bu.id = c.primary_business_unit_id
      where bu.name = $1
        and nullif(trim(coalesce(c.company_name, '')), '') is not null
      order by c.created_at asc
    `,
    [BUSINESS_UNIT_NAME],
  );
  return result.rows;
}

export function buildPlan(rows, { company = null } = {}) {
  const requestedCompanyKey = company ? normalizeIdentityKey(canonicalCompanyName(company)) : null;
  const groups = new Map();
  for (const row of rows) {
    const key = normalizeIdentityKey(companyLabel(row));
    if (key.length < 4) continue;
    if (requestedCompanyKey && key !== requestedCompanyKey) continue;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }

  const mergeGroups = [];
  const displayUpdates = [];
  for (const [companyKey, group] of groups) {
    const primary = choosePrimary(group);
    const duplicates = group.filter((row) => row.id !== primary.id);
    const displayName = companyLabel(primary);
    if (cleanText(primary.name) !== displayName) {
      displayUpdates.push({ contactId: primary.id, from: primary.name, to: displayName });
    }
    for (const duplicate of duplicates) {
      const duplicateDisplayName = companyLabel(duplicate);
      if (cleanText(duplicate.name) !== duplicateDisplayName) {
        displayUpdates.push({ contactId: duplicate.id, from: duplicate.name, to: duplicateDisplayName });
      }
    }
    if (duplicates.length) {
      mergeGroups.push({
        companyKey,
        displayName,
        primary,
        duplicates,
      });
    }
  }
  return { mergeGroups, displayUpdates };
}

function duplicateMergeNote(group) {
  const lines = [
    'AIT Signs cleanup merged duplicate customer contacts into this account.',
    'Merged duplicate contacts:',
  ];
  for (const duplicate of group.duplicates) {
    const parts = [
      cleanText(duplicate.name) || 'Unnamed contact',
      cleanText(duplicate.company_name) ? `company: ${cleanText(duplicate.company_name)}` : null,
      cleanText(duplicate.phone) ? `phone: ${cleanText(duplicate.phone)}` : null,
      `linked rows: ${Number(duplicate.linked_count || 0)}`,
    ].filter(Boolean);
    lines.push(`- ${parts.join(' | ')}`);
  }
  return lines.join('\n');
}

async function applyPlan(client, plan) {
  const tableAvailability = new Map();
  for (const tableName of CONTACT_TABLES) {
    tableAvailability.set(tableName, await contactColumnExists(client, tableName));
  }

  let reassignedRows = 0;
  let deletedContacts = 0;
  let renamedContacts = 0;
  const mergedContactIds = new Set();
  for (const group of plan.mergeGroups) {
    mergedContactIds.add(group.primary.id);
    for (const duplicate of group.duplicates) mergedContactIds.add(duplicate.id);

    await client.query(
      `
        update contacts
        set name = $2,
            company_name = coalesce(nullif(company_name, ''), $2),
            phone = coalesce(nullif(phone, ''), nullif($3, '')),
            updated_at = now()
        where id = $1
      `,
      [group.primary.id, group.displayName, group.primary.phone || ''],
    );
    renamedContacts += 1;

    if (group.duplicates.length) {
      await client.query(
        `
          insert into notes (
            organization_id,
            business_unit_id,
            contact_id,
            body
          )
          values ($1, $2, $3, $4)
        `,
        [
          group.primary.organization_id,
          group.primary.primary_business_unit_id,
          group.primary.id,
          duplicateMergeNote(group),
        ],
      );
    }

    const duplicateIds = group.duplicates.map((row) => row.id);
    for (const tableName of CONTACT_TABLES) {
      if (!tableAvailability.get(tableName)) continue;
      const result = await client.query(
        `update ${tableName} set contact_id = $1 where contact_id = any($2::uuid[])`,
        [group.primary.id, duplicateIds],
      );
      reassignedRows += result.rowCount || 0;
    }

    const deleteResult = await client.query(
      'delete from contacts where id = any($1::uuid[])',
      [duplicateIds],
    );
    deletedContacts += deleteResult.rowCount || 0;
  }

  for (const update of plan.displayUpdates) {
    if (mergedContactIds.has(update.contactId)) continue;
    const result = await client.query(
      'update contacts set name = $2, updated_at = now() where id = $1 and name <> $2',
      [update.contactId, update.to],
    );
    renamedContacts += result.rowCount || 0;
  }

  return { reassignedRows, deletedContacts, renamedContacts };
}

function summarizePlan(plan) {
  return {
    mergeGroups: plan.mergeGroups.length,
    duplicateContacts: plan.mergeGroups.reduce((sum, group) => sum + group.duplicates.length, 0),
    displayUpdates: plan.displayUpdates.length,
    groups: plan.mergeGroups.map((group) => ({
      company: group.displayName,
      primary: {
        id: group.primary.id,
        name: group.primary.name,
        companyName: group.primary.company_name,
        phone: group.primary.phone,
        linkedCount: Number(group.primary.linked_count || 0),
      },
      duplicates: group.duplicates.map((row) => ({
        id: row.id,
        name: row.name,
        companyName: row.company_name,
        phone: row.phone,
        linkedCount: Number(row.linked_count || 0),
      })),
    })),
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const rows = await loadAitSignsContacts(client);
    const plan = buildPlan(rows, options);
    if (options.dryRun) {
      console.log(JSON.stringify({ dryRun: true, ...summarizePlan(plan) }, null, 2));
      return;
    }

    await client.query('begin');
    const result = await applyPlan(client, plan);
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
