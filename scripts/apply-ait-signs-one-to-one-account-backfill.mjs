#!/usr/bin/env node

import process from 'node:process';
import { Client } from 'pg';
import {
  DEFAULT_BUSINESS_UNIT,
  buildReport,
  columnExists,
  displayNameForContact,
  loadAitSignsContacts,
  loadLinkCounts,
  normalizeText,
  safeDbFingerprint,
  writeJson,
  writeText,
} from './dry-run-ait-signs-account-backfill.mjs';

const APPLY_SOURCE = 'mis-135_safe_one_to_one_account_backfill';
const DEFAULT_EXPECTED_CANDIDATES = 795;

function parseArgs(argv) {
  const options = {
    apply: false,
    confirmStaging: false,
    businessUnit: DEFAULT_BUSINESS_UNIT,
    expectedCandidates: DEFAULT_EXPECTED_CANDIDATES,
    output: null,
    markdown: null,
    sampleLimit: 25,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--confirm-staging') {
      options.confirmStaging = true;
    } else if (arg === '--business-unit') {
      options.businessUnit = argv[i + 1];
      i += 1;
    } else if (arg === '--expected-candidates') {
      options.expectedCandidates = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--output') {
      options.output = argv[i + 1];
      i += 1;
    } else if (arg === '--markdown') {
      options.markdown = argv[i + 1];
      i += 1;
    } else if (arg === '--sample-limit') {
      options.sampleLimit = Number(argv[i + 1]);
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.expectedCandidates) || options.expectedCandidates < 1) {
    throw new Error('--expected-candidates must be a positive number');
  }
  if (!Number.isFinite(options.sampleLimit) || options.sampleLimit < 1) {
    throw new Error('--sample-limit must be a positive number');
  }

  return options;
}

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function phoneDigits(value) {
  return cleanText(value).replace(/\D+/g, '');
}

function emailKey(value) {
  return cleanText(value).toLowerCase();
}

function contactMethodStatus(row) {
  if (row.is_wrong_number) return 'wrong_number';
  if (row.is_do_not_call) return 'do_not_call';
  return 'active';
}

function assertApplyTarget(options, dbFingerprint) {
  if (!options.apply) return;
  if (!options.confirmStaging) {
    throw new Error('Refusing DB write: --confirm-staging is required with --apply.');
  }
  if (dbFingerprint.branchLabel !== 'staging') {
    throw new Error(`Refusing DB write: AIT_CRM_DB_BRANCH_LABEL must be staging, got ${dbFingerprint.branchLabel || 'unset'}.`);
  }
  if (!String(dbFingerprint.targetBaseUrl || '').includes('staging')) {
    throw new Error(`Refusing DB write: AIT_CRM_BASE_URL must point at staging, got ${dbFingerprint.targetBaseUrl || 'unset'}.`);
  }
  if (!String(dbFingerprint.hostSuffix || '').endsWith('neon.tech')) {
    throw new Error(`Refusing DB write: expected Neon host, got ${dbFingerprint.hostSuffix || 'unset'}.`);
  }
}

async function tableExists(client, tableName) {
  const result = await client.query(
    `
      select exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = $1
      ) as exists
    `,
    [tableName],
  );
  return Boolean(result.rows[0]?.exists);
}

async function countRows(client, tableName) {
  if (!/^[a-z0-9_]+$/.test(tableName)) throw new Error(`Unsafe table name: ${tableName}`);
  const result = await client.query(`select count(*)::int as count from ${tableName}`);
  return Number(result.rows[0]?.count || 0);
}

async function loadBusinessUnit(client, businessUnitName) {
  const result = await client.query(
    `
      select id, organization_id, name
      from business_units
      where name = $1
      limit 1
    `,
    [businessUnitName],
  );
  return result.rows[0] || null;
}

async function countLinkedContacts(client, businessUnitId) {
  const result = await client.query(
    `
      select count(*)::int as count
      from contacts
      where primary_business_unit_id = $1
        and client_account_id is not null
    `,
    [businessUnitId],
  );
  return Number(result.rows[0]?.count || 0);
}

async function preflight(client, options) {
  const businessUnit = await loadBusinessUnit(client, options.businessUnit);
  if (!businessUnit) throw new Error(`Business unit not found: ${options.businessUnit}`);

  const requiredTables = [
    'client_accounts',
    'client_account_aliases',
    'client_people',
    'client_contact_methods',
    'client_locations',
  ];
  const tableState = {};
  for (const tableName of requiredTables) {
    tableState[tableName] = await tableExists(client, tableName);
  }
  const missingTables = Object.entries(tableState).filter(([, exists]) => !exists).map(([tableName]) => tableName);
  if (missingTables.length) {
    throw new Error(`Client account schema is not ready. Missing tables: ${missingTables.join(', ')}`);
  }

  const contactsClientAccountColumnExists = await columnExists(client, 'contacts', 'client_account_id');
  if (!contactsClientAccountColumnExists) {
    throw new Error('Client account schema is not ready. Missing contacts.client_account_id.');
  }

  const tableCounts = {
    clientAccounts: await countRows(client, 'client_accounts'),
    clientAccountAliases: await countRows(client, 'client_account_aliases'),
    clientPeople: await countRows(client, 'client_people'),
    clientContactMethods: await countRows(client, 'client_contact_methods'),
    clientLocations: await countRows(client, 'client_locations'),
    linkedAitSignsContacts: await countLinkedContacts(client, businessUnit.id),
  };

  if (options.apply) {
    const dirtyCounts = Object.entries(tableCounts).filter(([, count]) => count !== 0);
    if (dirtyCounts.length) {
      throw new Error(`Refusing DB write: expected empty account layer before first one-to-one backfill, found ${dirtyCounts.map(([key, count]) => `${key}=${count}`).join(', ')}.`);
    }
  }

  return {
    businessUnit,
    contactsClientAccountColumnExists,
    tableState,
    tableCounts,
  };
}

function planForCandidate(candidate, contactRow) {
  const displayName = candidate.suggestedAccount.displayName;
  const sourceLabel = cleanText(contactRow.source_label);
  const phone = cleanText(contactRow.phone);
  const email = cleanText(contactRow.email);
  const address = cleanText(contactRow.address);
  return {
    contactId: candidate.contactId,
    displayName,
    normalizedName: normalizeText(displayName),
    organizationId: contactRow.organization_id,
    businessUnitId: contactRow.primary_business_unit_id,
    source: {
      contactName: cleanText(contactRow.name),
      companyName: cleanText(contactRow.company_name),
      sourceLabel,
    },
    contactMethods: [
      ...(phone ? [{
        methodType: 'phone',
        value: phone,
        normalizedValue: phoneDigits(phone),
        label: 'Primary phone',
        status: contactMethodStatus(contactRow),
        isPrimary: true,
      }] : []),
      ...(email ? [{
        methodType: 'email',
        value: email,
        normalizedValue: emailKey(email),
        label: 'Primary email',
        status: 'active',
        isPrimary: !phone,
      }] : []),
    ],
    locations: address ? [{
      label: 'Primary',
      address,
      isPrimary: true,
    }] : [],
  };
}

async function insertAccountPlan(client, plan) {
  const metadata = {
    source: APPLY_SOURCE,
    sourceContactId: plan.contactId,
    sourceContactName: plan.source.contactName,
    sourceCompanyName: plan.source.companyName,
    sourceLabel: plan.source.sourceLabel,
  };
  const accountResult = await client.query(
    `
      insert into client_accounts (
        organization_id,
        business_unit_id,
        display_name,
        normalized_name,
        status,
        tags_json,
        metadata_json,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, 'active', $5::jsonb, $6::jsonb, now(), now())
      returning id
    `,
    [
      plan.organizationId,
      plan.businessUnitId,
      plan.displayName,
      plan.normalizedName,
      JSON.stringify(['ait_signs_one_to_one_backfill']),
      JSON.stringify(metadata),
    ],
  );
  const accountId = accountResult.rows[0]?.id;
  if (!accountId) throw new Error(`Failed to create account for contact ${plan.contactId}.`);

  const contactResult = await client.query(
    `
      update contacts
      set client_account_id = $2,
          updated_at = now()
      where id = $1
        and client_account_id is null
      returning id
    `,
    [plan.contactId, accountId],
  );
  if (contactResult.rowCount !== 1) {
    throw new Error(`Failed to link contact ${plan.contactId}; it may already be linked.`);
  }

  for (const method of plan.contactMethods) {
    await client.query(
      `
        insert into client_contact_methods (
          client_account_id,
          organization_id,
          business_unit_id,
          method_type,
          value,
          normalized_value,
          label,
          status,
          is_primary,
          source_label,
          metadata_json,
          created_at,
          updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, now(), now())
      `,
      [
        accountId,
        plan.organizationId,
        plan.businessUnitId,
        method.methodType,
        method.value,
        method.normalizedValue,
        method.label,
        method.status,
        method.isPrimary,
        plan.source.sourceLabel || null,
        JSON.stringify({ source: APPLY_SOURCE, sourceContactId: plan.contactId }),
      ],
    );
  }

  for (const location of plan.locations) {
    await client.query(
      `
        insert into client_locations (
          client_account_id,
          organization_id,
          business_unit_id,
          label,
          address,
          is_primary,
          source_label,
          metadata_json,
          created_at,
          updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now(), now())
      `,
      [
        accountId,
        plan.organizationId,
        plan.businessUnitId,
        location.label,
        location.address,
        location.isPrimary,
        plan.source.sourceLabel || null,
        JSON.stringify({ source: APPLY_SOURCE, sourceContactId: plan.contactId }),
      ],
    );
  }

  return accountId;
}

function toMarkdown(result) {
  const lines = [
    '# MIS-135 AIT Signs Safe One-To-One Account Backfill Plan',
    '',
    '## Summary',
    '',
    `- Generated: ${result.generatedAt}`,
    `- Apply mode: ${result.apply ? 'yes' : 'no'}`,
    `- Business unit: ${result.target.businessUnit}`,
    `- Target base URL: ${result.target.db.targetBaseUrl || 'not provided'}`,
    `- DB branch label: ${result.target.db.branchLabel || 'not provided'}`,
    `- DB host suffix: ${result.target.db.hostSuffix || 'not provided'}`,
    `- Existing client accounts before run: ${result.preflight.tableCounts.clientAccounts}`,
    `- Existing linked AIT Signs contacts before run: ${result.preflight.tableCounts.linkedAitSignsContacts}`,
    '',
    '## Counts',
    '',
    `- Planned accounts: ${result.summary.plannedAccounts}`,
    `- Planned contact links: ${result.summary.plannedContactLinks}`,
    `- Planned contact methods: ${result.summary.plannedContactMethods}`,
    `- Planned locations: ${result.summary.plannedLocations}`,
    `- Applied accounts: ${result.summary.appliedAccounts}`,
    '',
    '## Held Out',
    '',
    `- Duplicate/shared account-key groups: ${result.sourceSummary.duplicateAccountKeyGroups}`,
    `- Contacts inside duplicate/shared groups: ${result.sourceSummary.duplicateAccountKeyContacts}`,
    `- Near-duplicate account-key groups: ${result.sourceSummary.nearDuplicateAccountKeyGroups}`,
    `- Contacts inside near-duplicate groups: ${result.sourceSummary.nearDuplicateAccountKeyContacts}`,
    `- Review contacts: ${result.sourceSummary.reviewContacts}`,
    '',
    '## Sample',
    '',
    ...(result.samples.plans.length
      ? result.samples.plans.map((plan) => (
        `- ${plan.displayName} (${plan.contactId}) — methods: ${plan.contactMethods.length}, locations: ${plan.locations.length}`
      ))
      : ['- None.']),
    '',
    '## Guardrail',
    '',
    result.apply
      ? '- This report was generated in apply mode.'
      : '- This was a read-only planning run. Run again with `--apply --confirm-staging` only after explicit approval.',
    '',
  ];
  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const dbFingerprint = safeDbFingerprint();
  assertApplyTarget(options, dbFingerprint);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query(options.apply ? 'begin' : 'begin transaction read only');
    const preflightResult = await preflight(client, options);
    const rows = await loadAitSignsContacts(client, options.businessUnit);
    const contactRowsById = new Map(rows.map((row) => [row.id, row]));
    const linkCounts = await loadLinkCounts(client, rows.map((row) => row.id));
    const dbState = {
      currentDatabase: (await client.query('select current_database() as name')).rows[0]?.name || null,
      contactsClientAccountColumnExists: preflightResult.contactsClientAccountColumnExists,
    };
    const sourceReport = buildReport(rows, linkCounts, options, dbState);

    if (sourceReport.summary.oneToOneCandidates !== options.expectedCandidates) {
      throw new Error(`Candidate count changed: expected ${options.expectedCandidates}, got ${sourceReport.summary.oneToOneCandidates}.`);
    }

    const plans = sourceReport.fullResults.oneToOneCandidates.map((candidate) => {
      const contactRow = contactRowsById.get(candidate.contactId);
      if (!contactRow) throw new Error(`Missing source contact row for ${candidate.contactId}.`);
      return planForCandidate(candidate, contactRow);
    });

    const appliedAccountIds = [];
    if (options.apply) {
      for (const plan of plans) {
        appliedAccountIds.push(await insertAccountPlan(client, plan));
      }
      await client.query('commit');
    } else {
      await client.query('commit');
    }

    const result = {
      generatedAt: new Date().toISOString(),
      apply: options.apply,
      target: {
        businessUnit: options.businessUnit,
        db: dbFingerprint,
      },
      preflight: {
        currentDatabase: dbState.currentDatabase,
        contactsClientAccountColumnExists: preflightResult.contactsClientAccountColumnExists,
        tableState: preflightResult.tableState,
        tableCounts: preflightResult.tableCounts,
      },
      sourceSummary: sourceReport.summary,
      summary: {
        plannedAccounts: plans.length,
        plannedContactLinks: plans.length,
        plannedContactMethods: plans.reduce((sum, plan) => sum + plan.contactMethods.length, 0),
        plannedLocations: plans.reduce((sum, plan) => sum + plan.locations.length, 0),
        appliedAccounts: appliedAccountIds.length,
      },
      samples: {
        plans: plans.slice(0, options.sampleLimit),
      },
      appliedAccountIds: options.apply ? appliedAccountIds : [],
    };

    if (options.output) writeJson(options.output, result);
    if (options.markdown) writeText(options.markdown, toMarkdown(result));

    console.log(JSON.stringify({
      apply: options.apply,
      output: options.output,
      markdown: options.markdown,
      summary: result.summary,
      heldOut: {
        duplicateAccountKeyGroups: sourceReport.summary.duplicateAccountKeyGroups,
        nearDuplicateAccountKeyGroups: sourceReport.summary.nearDuplicateAccountKeyGroups,
        reviewContacts: sourceReport.summary.reviewContacts,
      },
    }, null, 2));
  } catch (error) {
    try { await client.query('rollback'); } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
