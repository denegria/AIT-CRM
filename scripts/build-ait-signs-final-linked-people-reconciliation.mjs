#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { safeDbFingerprint } from './dry-run-ait-signs-canonical-replacement-plan.mjs';

const DEFAULT_OUTPUT = 'docs/mis-152-ait-signs-final-linked-people-reconciliation.json';
const DEFAULT_MARKDOWN = 'docs/mis-152-ait-signs-final-linked-people-reconciliation.md';
const ISSUE = 'MIS-152';
const SOURCE_LABELS = [
  'ait_signs_estimate_exact_backfill',
  'ait_signs_pass1_latest_source_linked_people',
  'ait_signs_remaining_spelling_latest_source_linked_people',
  'ait_signs_business_held_latest_source_linked_people',
];

const INPUTS = {
  exactCurrent: 'docs/mis-152-ait-signs-exact-linked-people-current-idempotence.json',
  pass1Current: 'docs/mis-152-ait-signs-pass1-current-idempotence.json',
  remainingSpellingCurrent: 'docs/mis-152-ait-signs-remaining-spelling-current-idempotence.json',
  businessHeldCurrent: 'docs/mis-151-ait-signs-business-held-linked-people-idempotence.json',
  sharedCurrent: 'docs/mis-152-ait-signs-shared-contact-current-review.json',
  remainingSpellingApprovalCurrent: 'docs/mis-152-ait-signs-remaining-spelling-current-approval.json',
};

function parseArgs(argv) {
  const options = {
    output: DEFAULT_OUTPUT,
    markdown: DEFAULT_MARKDOWN,
    businessUnit: 'AIT Signs',
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') {
      options.output = argv[index + 1];
      index += 1;
    } else if (arg === '--markdown') {
      options.markdown = argv[index + 1];
      index += 1;
    } else if (arg === '--business-unit') {
      options.businessUnit = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function stagingRuntimeFingerprint(client) {
  const currentDb = await client.query('select current_database() as database');
  const secrets = await safeDbFingerprint();
  return {
    ...secrets,
    currentDatabase: currentDb.rows[0]?.database || null,
  };
}

async function loadSourceLabelCounts(client) {
  const result = await client.query(
    `
      select
        cp.source_label,
        count(*)::int as rows,
        count(distinct cp.contact_id)::int as contacts,
        count(*) filter (where cp.is_primary)::int as primary_rows
      from contact_people cp
      where cp.source_label = any($1::text[])
      group by cp.source_label
      order by cp.source_label
    `,
    [SOURCE_LABELS],
  );
  const counts = Object.fromEntries(SOURCE_LABELS.map((label) => [label, {
    rows: 0,
    contacts: 0,
    primaryRows: 0,
  }]));
  for (const row of result.rows) {
    counts[row.source_label] = {
      rows: row.rows,
      contacts: row.contacts,
      primaryRows: row.primary_rows,
    };
  }
  return counts;
}

async function loadJclState(client) {
  const result = await client.query(
    `
      select id, name
      from contacts
      where name in ('JCL LANSCAPING', 'JC AND L LANDSCAPING', 'JC&L LANDSCAPING')
      order by name, id
    `,
  );
  return result.rows;
}

function passSummary(report) {
  return {
    mode: report.mode,
    summary: report.summary,
    safeFingerprint: report.safeFingerprint,
  };
}

function renderMarkdown(report) {
  const lines = [
    '# MIS-152 AIT Signs Final Linked-People Reconciliation',
    '',
    `- Generated at: ${report.generatedAt}`,
    `- Business unit: ${report.businessUnit}`,
    `- Target base URL: ${report.safeFingerprint?.targetBaseUrl || 'unknown'}`,
    `- Neon branch id: ${report.safeFingerprint?.expectedNeonBranchId || 'unknown'}`,
    `- Current database: ${report.safeFingerprint?.currentDatabase || 'unknown'}`,
    '',
    '## Verdict',
    '',
    `- Missing latest-source linked people: ${report.verdict.missingLatestSourceLinkedPeople}`,
    `- Remaining held business-review rows with person inserts at stake: ${report.verdict.heldRowsWithPeopleAtStake}`,
    `- Remaining no-person business-name holds: ${report.verdict.remainingNoPersonBusinessNameHolds}`,
    `- Recommended next action: ${report.verdict.recommendedNextAction}`,
    '',
    '## Current Source Passes',
    '',
    `- Exact linked people: ${report.sourcePasses.exactCurrent.summary.plannedInserts} planned, ${report.sourcePasses.exactCurrent.summary.skippedExisting} existing skipped, ${report.sourcePasses.exactCurrent.summary.appliedInserts} applied in dry-run.`,
    `- Pass 1 linked people: ${report.sourcePasses.pass1Current.summary.plannedInserts} planned, ${report.sourcePasses.pass1Current.summary.skippedExisting} existing skipped, ${report.sourcePasses.pass1Current.summary.blocked} blocked.`,
    `- Remaining spelling linked people: ${report.sourcePasses.remainingSpellingCurrent.summary.plannedInserts} planned, ${report.sourcePasses.remainingSpellingCurrent.summary.skippedExisting} existing skipped, ${report.sourcePasses.remainingSpellingCurrent.summary.blocked} blocked.`,
    `- Business-held linked people: ${report.sourcePasses.businessHeldCurrent.summary.plannedInserts} planned, ${report.sourcePasses.businessHeldCurrent.summary.skippedExisting} existing skipped, ${report.sourcePasses.businessHeldCurrent.summary.blockedPeople} blocked.`,
    `- Shared-contact current review: ${report.sourcePasses.sharedCurrent.summary.plannedInserts} planned inserts across ${report.sourcePasses.sharedCurrent.summary.reviewedCandidates} reviewed candidates.`,
    `- Current remaining-spelling approval view: ${report.sourcePasses.remainingSpellingApprovalCurrent.summary.recommendedApplyRows} recommended apply rows, ${report.sourcePasses.remainingSpellingApprovalCurrent.summary.heldPotentialPeopleAfterDedupe} held potential people after de-dupe.`,
    '',
    '## DB Source Labels',
    '',
  ];

  for (const [label, counts] of Object.entries(report.db.sourceLabelCounts)) {
    lines.push(`- ${label}: ${counts.rows} rows, ${counts.contacts} contacts, ${counts.primaryRows} primary rows.`);
  }

  lines.push('', '## JCL State', '');
  if (report.db.jclState.length) {
    for (const row of report.db.jclState) lines.push(`- ${row.name} (${row.id})`);
  } else {
    lines.push('- No JCL/JC&L variant contact found.');
  }

  lines.push('', '## Artifacts', '');
  for (const [key, filePath] of Object.entries(report.inputs)) lines.push(`- ${key}: ${filePath}`);
  lines.push('- Current remaining no-person business holds CSV: docs/mis-152-ait-signs-remaining-spelling-current-approval.csv');

  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const [
    exactCurrent,
    pass1Current,
    remainingSpellingCurrent,
    businessHeldCurrent,
    sharedCurrent,
    remainingSpellingApprovalCurrent,
  ] = await Promise.all(Object.values(INPUTS).map(readJson));

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const safeFingerprint = await stagingRuntimeFingerprint(client);
  const sourceLabelCounts = await loadSourceLabelCounts(client);
  const jclState = await loadJclState(client);
  await client.end();

  const missingLatestSourceLinkedPeople = (
    exactCurrent.summary.plannedInserts
    + pass1Current.summary.plannedInserts
    + remainingSpellingCurrent.summary.plannedInserts
    + businessHeldCurrent.summary.plannedInserts
    + sharedCurrent.summary.plannedInserts
    + remainingSpellingApprovalCurrent.summary.recommendedApplyRows
    + remainingSpellingApprovalCurrent.summary.heldPotentialPeopleAfterDedupe
  );
  const remainingNoPersonBusinessNameHolds = remainingSpellingApprovalCurrent.summary.heldBusinessReviewRows;

  const report = {
    generatedAt: new Date().toISOString(),
    issue: ISSUE,
    businessUnit: options.businessUnit,
    safeFingerprint,
    inputs: INPUTS,
    verdict: {
      missingLatestSourceLinkedPeople,
      heldRowsWithPeopleAtStake: remainingSpellingApprovalCurrent.summary.heldPotentialPeopleAfterDedupe,
      remainingNoPersonBusinessNameHolds,
      recommendedNextAction: missingLatestSourceLinkedPeople === 0
        ? 'Stop linked-person data writes and return to MIS-124 account/client-layer design work.'
        : 'Review remaining linked-person rows before any additional apply.',
    },
    sourcePasses: {
      exactCurrent: passSummary(exactCurrent),
      pass1Current: passSummary(pass1Current),
      remainingSpellingCurrent: passSummary(remainingSpellingCurrent),
      businessHeldCurrent: passSummary(businessHeldCurrent),
      sharedCurrent: passSummary(sharedCurrent),
      remainingSpellingApprovalCurrent: passSummary(remainingSpellingApprovalCurrent),
    },
    db: {
      sourceLabelCounts,
      totalTaggedRows: Object.values(sourceLabelCounts).reduce((sum, counts) => sum + counts.rows, 0),
      jclState,
    },
  };

  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(options.markdown, renderMarkdown(report));
  console.log(JSON.stringify({
    output: options.output,
    markdown: options.markdown,
    verdict: report.verdict,
    sourceLabelCounts: report.db.sourceLabelCounts,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
