#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_SOURCE = 'docs/mis-148-ait-signs-shared-contact-point-review-rule-idempotence.json';
const DEFAULT_OUTPUT = 'docs/mis-149-ait-signs-pass1-cluster-approval.json';
const DEFAULT_MARKDOWN = 'docs/mis-149-ait-signs-pass1-cluster-approval.md';
const DEFAULT_CSV = 'docs/mis-149-ait-signs-pass1-cluster-approval.csv';

const PASS1_CLUSTERS = [
  {
    canonicalClient: 'G&R TREE SERVICE',
    rationale: 'Alvaro previously confirmed the GR/G&R cleanup direction after business-name review.',
  },
  {
    canonicalClient: 'BLUE MOUNTAIN',
    rationale: 'Only direct Blue Mountain misspellings are in scope; Valverde/Great Blue Mountain shared-phone rows stay excluded.',
  },
  {
    canonicalClient: 'LIFETIME CONSTRUCTION',
    rationale: 'Life Time/Life Team/Contruction rows appear to be direct spelling or spacing variants.',
  },
  {
    canonicalClient: 'GREEN 714',
    rationale: 'Green 7/14, 7/15, and LLC rows appear to be direct formatting/suffix variants.',
  },
  {
    canonicalClient: '3 BRIDGE CAFE',
    rationale: 'Only cafe spelling/plural variants are in scope; restaurant wording stays excluded.',
  },
  {
    canonicalClient: 'JCE CONTRACTOR',
    rationale: 'LLC suffix-only variant.',
  },
  {
    canonicalClient: 'BLUE OCEAN POOL LLC',
    rationale: 'LLC suffix-only variant.',
  },
];

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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function peopleSummary(people) {
  return people.map((person) => `${person.name} x${person.evidenceCount}`).join('; ');
}

function sourceRowsSummary(people) {
  return unique(people.flatMap((person) => person.sourceRows || [])).join('; ');
}

function potentialInsertPeople(item) {
  return (item.plannedPeople || []).filter((person) => person.wouldInsert);
}

function aggregatePersonEvidence(rows) {
  const byName = new Map();
  for (const row of rows) {
    for (const value of row.potentialLinkedPeopleToInsert.split('; ').filter(Boolean)) {
      const match = value.match(/^(.*) x(\d+)$/);
      const name = match ? match[1] : value;
      const count = match ? Number(match[2]) : 1;
      byName.set(name, (byName.get(name) || 0) + count);
    }
  }
  return [...byName.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => `${name} x${count}`);
}

function buildApprovalRow(item, cluster) {
  const insertPeople = potentialInsertPeople(item);
  return {
    approvalDecision: '',
    allowedValues: 'approve_listed_people | approve_no_write | reject | needs_research',
    canonicalClient: item.matchedCurrentContact,
    candidateClientName: item.candidateClientName,
    currentDecision: item.decision,
    defaultRecommendation: 'needs_alvaro_approval',
    proposedApplyAction: insertPeople.length
      ? 'later_apply_may_insert_listed_people_only_after_dedupe'
      : 'no_db_write_existing_people_only',
    candidatePeople: peopleSummary(item.plannedPeople || []),
    potentialLinkedPeopleToInsert: peopleSummary(insertPeople),
    phoneHints: (item.phoneHints || []).join('; '),
    sourceRowCount: item.sourceRowCount,
    linkedOperationalRows: item.linkedOperationalRows,
    sourceRows: sourceRowsSummary(item.plannedPeople || []),
    rationale: cluster.rationale,
    guardrail: 'No contact/client names, aliases, merges, remaps, creates, archives, deletes, or consolidations.',
  };
}

function buildPacket(sourceReport) {
  const clusterOrder = new Map(PASS1_CLUSTERS.map((cluster, index) => [cluster.canonicalClient, index]));
  const clusterByName = new Map(PASS1_CLUSTERS.map((cluster) => [cluster.canonicalClient, cluster]));
  const targetNames = new Set(clusterByName.keys());
  const reviewedCandidates = sourceReport.reviewedCandidates || [];
  const pass1SourceRows = reviewedCandidates
    .filter((item) => targetNames.has(item.matchedCurrentContact))
    .sort((a, b) => {
      const clusterDiff = clusterOrder.get(a.matchedCurrentContact) - clusterOrder.get(b.matchedCurrentContact);
      if (clusterDiff) return clusterDiff;
      return a.candidateClientName.localeCompare(b.candidateClientName);
    });
  const approvalRows = pass1SourceRows
    .filter((item) => item.decision === 'hold_spelling_variant_review')
    .map((item) => buildApprovalRow(item, clusterByName.get(item.matchedCurrentContact)));
  const excludedRows = pass1SourceRows
    .filter((item) => item.decision !== 'hold_spelling_variant_review')
    .map((item) => ({
      canonicalClient: item.matchedCurrentContact,
      candidateClientName: item.candidateClientName,
      currentDecision: item.decision,
      reasonExcluded: 'Not a spelling/name/suffix variant row in MIS-148; keep out of Pass 1.',
      candidatePeople: peopleSummary(item.plannedPeople || []),
      phoneHints: (item.phoneHints || []).join('; '),
      sourceRowCount: item.sourceRowCount,
      linkedOperationalRows: item.linkedOperationalRows,
      sourceRows: sourceRowsSummary(item.plannedPeople || []),
    }));
  const clusters = PASS1_CLUSTERS.map((cluster) => {
    const rows = approvalRows.filter((row) => row.canonicalClient === cluster.canonicalClient);
    const excluded = excludedRows.filter((row) => row.canonicalClient === cluster.canonicalClient);
    const potentialLinkedPeopleToInsert = aggregatePersonEvidence(rows);
    return {
      canonicalClient: cluster.canonicalClient,
      rationale: cluster.rationale,
      approvalRowCount: rows.length,
      excludedRowCount: excluded.length,
      candidateClientNames: rows.map((row) => row.candidateClientName),
      potentialLinkedPeopleToInsert,
      sourceRowCount: rows.reduce((sum, row) => sum + Number(row.sourceRowCount || 0), 0),
      linkedOperationalRows: Math.max(...rows.map((row) => Number(row.linkedOperationalRows || 0)), 0),
    };
  });
  const potentialLinkedPeopleAfterDedupe = clusters.reduce(
    (sum, cluster) => sum + cluster.potentialLinkedPeopleToInsert.length,
    0,
  );

  return {
    generatedAt: new Date().toISOString(),
    issue: 'MIS-149',
    sourceIssue: sourceReport.issue || 'MIS-148',
    sourceReport: DEFAULT_SOURCE,
    businessUnit: sourceReport.businessUnit,
    sourceGeneratedAt: sourceReport.generatedAt,
    summary: {
      sourceReviewedCandidates: reviewedCandidates.length,
      pass1Clusters: clusters.length,
      approvalRows: approvalRows.length,
      excludedRows: excludedRows.length,
      potentialLinkedPeopleAfterDedupe,
      dbWritesPlannedByThisPacket: 0,
    },
    guardrails: [
      'Approval packet only; this script performs no database writes.',
      'Each row requires explicit approval before any later apply script may insert linked people.',
      'Approved apply scope is linked-person insertion only, for the listed people only.',
      'Any later apply script must de-dupe by contact plus normalized person name before inserting rows.',
      'If a listed person name looks misspelled, mark that row needs_research instead of approving it.',
      'Do not rename, merge, remap, create, archive, delete, consolidate, or add aliases from this packet.',
      'Separate-business/shared-contact rows stay excluded unless Alvaro explicitly opens a later review.',
    ],
    clusters,
    approvalRows,
    excludedRows,
  };
}

function renderCsv(packet) {
  const headers = [
    'approval_decision',
    'allowed_values',
    'canonical_client',
    'candidate_client_name',
    'current_decision',
    'default_recommendation',
    'proposed_apply_action',
    'candidate_people',
    'potential_linked_people_to_insert',
    'phone_hints',
    'source_row_count',
    'linked_operational_rows',
    'source_rows',
    'rationale',
    'guardrail',
  ];
  return `${[
    csvLine(headers),
    ...packet.approvalRows.map((row) => csvLine(headers.map((header) => row[header.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())]))),
  ].join('\n')}\n`;
}

function renderMarkdown(packet) {
  const lines = [
    '# MIS-149 AIT Signs Pass 1 Cluster Approval Packet',
    '',
    `- Generated at: ${packet.generatedAt}`,
    `- Source report: ${packet.sourceReport}`,
    `- Source generated at: ${packet.sourceGeneratedAt}`,
    `- Business unit: ${packet.businessUnit}`,
    '',
    '## Summary',
    '',
    `- Source reviewed candidates: ${packet.summary.sourceReviewedCandidates}`,
    `- Pass 1 clusters: ${packet.summary.pass1Clusters}`,
    `- Approval rows: ${packet.summary.approvalRows}`,
    `- Excluded same-cluster rows: ${packet.summary.excludedRows}`,
    `- Potential linked people after de-dupe: ${packet.summary.potentialLinkedPeopleAfterDedupe}`,
    `- DB writes planned by this packet: ${packet.summary.dbWritesPlannedByThisPacket}`,
    '',
    '## Guardrails',
    '',
    ...packet.guardrails.map((guardrail) => `- ${guardrail}`),
    '',
    '## Approval Values',
    '',
    '- approve_listed_people: approved for a later guarded apply script to insert only the listed missing linked people after de-dupe.',
    '- approve_no_write: approved as same-client evidence, but no linked-person insert should be made.',
    '- reject: do not apply linked-person inserts for this row.',
    '- needs_research: keep held for manual/business-name research.',
    '',
    '## Clusters',
    '',
  ];

  for (const cluster of packet.clusters) {
    lines.push(`### ${cluster.canonicalClient}`);
    lines.push('');
    lines.push(`- Rationale: ${cluster.rationale}`);
    lines.push(`- Approval rows: ${cluster.approvalRowCount}`);
    lines.push(`- Excluded same-cluster rows: ${cluster.excludedRowCount}`);
    lines.push(`- Candidate variants: ${cluster.candidateClientNames.join('; ') || 'none'}`);
    lines.push(`- Potential linked people: ${cluster.potentialLinkedPeopleToInsert.join('; ') || 'none'}`);
    lines.push('');
  }

  lines.push('## Approval Rows');
  lines.push('');
  for (const row of packet.approvalRows) {
    lines.push(`- ${row.candidateClientName} -> ${row.canonicalClient}`);
    lines.push(`  - Decision: ${row.approvalDecision || '(blank)'}`);
    lines.push(`  - Allowed values: ${row.allowedValues}`);
    lines.push(`  - Proposed apply action: ${row.proposedApplyAction}`);
    lines.push(`  - Candidate people: ${row.candidatePeople || 'none'}`);
    lines.push(`  - Potential linked people to insert: ${row.potentialLinkedPeopleToInsert || 'none'}`);
    lines.push(`  - Phones: ${row.phoneHints || 'none'}`);
    lines.push(`  - Source rows: ${row.sourceRows || 'none'}`);
    lines.push('');
  }

  lines.push('## Excluded From Pass 1');
  lines.push('');
  for (const row of packet.excludedRows) {
    lines.push(`- ${row.candidateClientName} -> ${row.canonicalClient}: ${row.currentDecision}; ${row.reasonExcluded}`);
  }
  lines.push('');

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
