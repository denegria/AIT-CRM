#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_SOURCE = 'docs/mis-150-ait-signs-remaining-spelling-approval.json';
const DEFAULT_OUTPUT = 'docs/mis-151-ait-signs-business-held-people-approval.json';
const DEFAULT_MARKDOWN = 'docs/mis-151-ait-signs-business-held-people-approval.md';
const DEFAULT_CSV = 'docs/mis-151-ait-signs-business-held-people-approval.csv';

const ISSUE = 'MIS-151';

function parseArgs(argv) {
  const options = {
    source: DEFAULT_SOURCE,
    output: DEFAULT_OUTPUT,
    markdown: DEFAULT_MARKDOWN,
    csv: DEFAULT_CSV,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source') {
      options.source = argv[index + 1];
      index += 1;
    } else if (arg === '--output') {
      options.output = argv[index + 1];
      index += 1;
    } else if (arg === '--markdown') {
      options.markdown = argv[index + 1];
      index += 1;
    } else if (arg === '--csv') {
      options.csv = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function csvLine(values) {
  return values.map(csvEscape).join(',');
}

function normalizeBusiness(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function compactBusiness(value) {
  return normalizeBusiness(value).replace(/\s+/g, '');
}

function parsePeople(value) {
  return String(value || '')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const match = entry.match(/^(.*) x(\d+)$/);
      return {
        name: match ? match[1].trim() : entry,
        evidenceCount: match ? Number(match[2]) : 1,
      };
    });
}

function peopleSummary(people) {
  return people.map((person) => `${person.name} x${person.evidenceCount}`).join('; ');
}

function confidenceBucket(row) {
  const candidate = normalizeBusiness(row.candidateClientName);
  const canonical = normalizeBusiness(row.canonicalClient);
  const compactCandidate = compactBusiness(candidate);
  const compactCanonical = compactBusiness(canonical);
  const editSimilarity = Number(row.editSimilarity || 0);

  if (compactCandidate === compactCanonical) return 'format_only';
  if (editSimilarity >= 0.9) return 'high_spelling_similarity';
  if (candidate.replace(/\b(LLC|INC)\b/g, '').trim() === canonical.replace(/\b(LLC|INC)\b/g, '').trim()) {
    return 'suffix_only';
  }
  if (candidate.includes(canonical) || canonical.includes(candidate)) return 'prefix_or_suffix_variant';
  if (editSimilarity >= 0.84) return 'near_spelling_similarity';
  return 'needs_business_direction';
}

function defaultApprovalGuidance(row) {
  const bucket = confidenceBucket(row);
  if (['format_only', 'high_spelling_similarity', 'suffix_only'].includes(bucket)) {
    return 'approve_if_business_match';
  }
  if (bucket === 'prefix_or_suffix_variant' && Number(row.tokenOverlap || 0) >= 0.5) {
    return 'approve_if_prefix_suffix_is_same_business';
  }
  return 'hold_for_business_identity_direction';
}

function buildPacket(sourceReport) {
  const approvalRows = (sourceReport.approvalRows || [])
    .filter((row) => row.defaultRecommendation === 'hold_needs_business_review')
    .filter((row) => String(row.heldPotentialPeople || '').trim())
    .map((row) => {
      const heldPeople = parsePeople(row.heldPotentialPeople);
      return {
        approvalDecision: '',
        allowedValues: 'approve_business_match_link_latest_people | approve_no_write | hold | reject',
        canonicalClient: row.canonicalClient,
        candidateClientName: row.candidateClientName,
        defaultApprovalGuidance: defaultApprovalGuidance(row),
        confidenceBucket: confidenceBucket(row),
        businessMatchReason: row.businessMatchReason,
        editSimilarity: row.editSimilarity,
        tokenOverlap: row.tokenOverlap,
        intersectionCount: row.intersectionCount,
        linkedOperationalRows: row.linkedOperationalRows,
        latestSourceReference: row.latestSourceReference,
        phoneHints: row.phoneHints,
        heldPeople,
        heldPeopleSummary: peopleSummary(heldPeople),
        sourceRows: row.sourceRows,
        proposedApplyAction: 'only_after_explicit_business_match_approval_insert_non_primary_latest_source_people',
        guardrail: 'No client/contact renames, aliases, merges, remaps, creates, archives, deletes, consolidations, or primary-person changes.',
      };
    })
    .sort((left, right) => {
      const guidanceDiff = left.defaultApprovalGuidance.localeCompare(right.defaultApprovalGuidance);
      if (guidanceDiff) return guidanceDiff;
      const canonicalDiff = left.canonicalClient.localeCompare(right.canonicalClient);
      if (canonicalDiff) return canonicalDiff;
      return left.candidateClientName.localeCompare(right.candidateClientName);
    });

  const heldSourceRows = (sourceReport.approvalRows || [])
    .filter((row) => row.defaultRecommendation === 'hold_needs_business_review');
  const noPersonHeldRows = heldSourceRows.filter((row) => !String(row.heldPotentialPeople || '').trim());
  const likelyApprovalRows = approvalRows.filter((row) => row.defaultApprovalGuidance !== 'hold_for_business_identity_direction');
  const hardDirectionRows = approvalRows.filter((row) => row.defaultApprovalGuidance === 'hold_for_business_identity_direction');
  const linkedPeople = [...new Set(approvalRows.flatMap((row) => row.heldPeople.map((person) => person.name)))].sort();

  return {
    generatedAt: new Date().toISOString(),
    issue: ISSUE,
    sourceReport: DEFAULT_SOURCE,
    sourceIssue: sourceReport.issue || 'MIS-150',
    sourceGeneratedAt: sourceReport.generatedAt,
    businessUnit: sourceReport.businessUnit || 'AIT Signs',
    summary: {
      sourceHeldBusinessReviewRows: heldSourceRows.length,
      noPersonHeldRows: noPersonHeldRows.length,
      approvalRows: approvalRows.length,
      likelyApprovalRows: likelyApprovalRows.length,
      hardDirectionRows: hardDirectionRows.length,
      distinctCanonicalClients: new Set(approvalRows.map((row) => row.canonicalClient)).size,
      linkedPeopleAfterDedupe: linkedPeople.length,
      dbWritesPlannedByThisPacket: 0,
    },
    guardrails: [
      'Packet only; this script performs no database writes.',
      'Source workbook/latest work item or contact point remains temporary person-name truth.',
      'Every row still needs explicit business-match approval before a future apply.',
      'Shared phone/contact point is not client identity evidence.',
      'Any future apply must insert only non-primary linked people and de-dupe by contact plus normalized person name.',
      'Do not rename, merge, remap, create, archive, delete, consolidate, add aliases, or change primary linked-person flags from this packet.',
    ],
    linkedPeople,
    approvalRows,
  };
}

function renderMarkdown(packet) {
  const lines = [
    '# MIS-151 AIT Signs Business-Held People Approval Packet',
    '',
    `- Generated at: ${packet.generatedAt}`,
    `- Source report: ${packet.sourceReport}`,
    `- Source issue: ${packet.sourceIssue}`,
    `- Source generated at: ${packet.sourceGeneratedAt}`,
    `- Business unit: ${packet.businessUnit}`,
    '',
    '## Summary',
    '',
    `- Source held business-review rows: ${packet.summary.sourceHeldBusinessReviewRows}`,
    `- No-person held rows deferred: ${packet.summary.noPersonHeldRows}`,
    `- Approval rows in this packet: ${packet.summary.approvalRows}`,
    `- Likely approval rows: ${packet.summary.likelyApprovalRows}`,
    `- Hard business-direction rows: ${packet.summary.hardDirectionRows}`,
    `- Distinct canonical clients: ${packet.summary.distinctCanonicalClients}`,
    `- Linked people after de-dupe: ${packet.summary.linkedPeopleAfterDedupe}`,
    `- DB writes planned by this packet: ${packet.summary.dbWritesPlannedByThisPacket}`,
    '',
    '## Guardrails',
    '',
    ...packet.guardrails.map((guardrail) => `- ${guardrail}`),
    '',
    '## Linked People In Scope',
    '',
  ];

  if (packet.linkedPeople.length) {
    for (const person of packet.linkedPeople) lines.push(`- ${person}`);
  } else {
    lines.push('- none');
  }

  lines.push('', '## Approval Rows', '');
  for (const row of packet.approvalRows) {
    lines.push(
      `- ${row.candidateClientName} -> ${row.canonicalClient}: ${row.heldPeopleSummary}; ${row.defaultApprovalGuidance}; ${row.confidenceBucket}; latest ${row.latestSourceReference || 'unknown'}`,
    );
  }
  if (!packet.approvalRows.length) lines.push('- none');

  return `${lines.join('\n')}\n`;
}

function renderCsv(packet) {
  const headers = [
    'approvalDecision',
    'allowedValues',
    'canonicalClient',
    'candidateClientName',
    'defaultApprovalGuidance',
    'confidenceBucket',
    'businessMatchReason',
    'editSimilarity',
    'tokenOverlap',
    'intersectionCount',
    'linkedOperationalRows',
    'heldPeopleSummary',
    'latestSourceReference',
    'phoneHints',
    'sourceRows',
    'proposedApplyAction',
    'guardrail',
  ];
  const lines = [csvLine(headers)];
  for (const row of packet.approvalRows) lines.push(csvLine(headers.map((header) => row[header])));
  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv);
  const sourceReport = JSON.parse(await readFile(options.source, 'utf8'));
  const packet = buildPacket(sourceReport);

  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(packet, null, 2)}\n`);
  await writeFile(options.markdown, renderMarkdown(packet));
  await writeFile(options.csv, renderCsv(packet));

  console.log(JSON.stringify({
    output: options.output,
    markdown: options.markdown,
    csv: options.csv,
    summary: packet.summary,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
