#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_SOURCE = 'docs/mis-148-ait-signs-shared-contact-point-review-rule-idempotence.json';
const DEFAULT_OUTPUT = 'docs/mis-150-ait-signs-remaining-spelling-approval.json';
const DEFAULT_MARKDOWN = 'docs/mis-150-ait-signs-remaining-spelling-approval.md';
const DEFAULT_CSV = 'docs/mis-150-ait-signs-remaining-spelling-approval.csv';

const ISSUE = 'MIS-150';
const PASS1_CANONICAL_CLIENTS = new Set([
  'G&R TREE SERVICE',
  'BLUE MOUNTAIN',
  'LIFETIME CONSTRUCTION',
  'GREEN 714',
  '3 BRIDGE CAFE',
  'JCE CONTRACTOR',
  'BLUE OCEAN POOL LLC',
]);

const STOP_TOKENS = new Set([
  'AND',
  'CO',
  'COMPANY',
  'CONTRACTOR',
  'CONTRACTORS',
  'CONSTRUCTION',
  'DE',
  'DEL',
  'HOME',
  'IMPROVEMENT',
  'INC',
  'LA',
  'LANDSCAPING',
  'LLC',
  'OF',
  'PAINTING',
  'PAITING',
  'ROOFING',
  'SERVICE',
  'SERVICES',
  'SIDING',
  'THE',
]);

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

function normalizeName(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function normalizeBusinessName(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function businessTokens(value) {
  return normalizeBusinessName(value).split(' ').filter(Boolean);
}

function contentTokens(value) {
  return businessTokens(value).filter((token) => !STOP_TOKENS.has(token));
}

function compactBusinessName(value) {
  return normalizeBusinessName(value).replace(/\s+/g, '');
}

function levenshteinSimilarity(left, right) {
  const a = compactBusinessName(left);
  const b = compactBusinessName(right);
  if (!a.length && !b.length) return 1;
  const dp = Array.from({ length: a.length + 1 }, (_, index) => [index]);
  for (let index = 1; index <= b.length; index += 1) dp[0][index] = index;
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      dp[row][column] = Math.min(
        dp[row - 1][column] + 1,
        dp[row][column - 1] + 1,
        dp[row - 1][column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
  }
  return 1 - (dp[a.length][b.length] / Math.max(a.length, b.length, 1));
}

function isInitialToken(value) {
  return /^[A-Z]$/.test(value || '');
}

function businessMatchReview(candidateClientName, canonicalClient) {
  const candidateTokens = businessTokens(candidateClientName);
  const canonicalTokens = businessTokens(canonicalClient);
  const candidateContent = contentTokens(candidateClientName);
  const canonicalContent = contentTokens(canonicalClient);
  const intersection = candidateContent.filter((token) => canonicalContent.includes(token));
  const compactCandidate = compactBusinessName(candidateClientName);
  const compactCanonical = compactBusinessName(canonicalClient);
  const compactContains = compactCandidate.includes(compactCanonical) || compactCanonical.includes(compactCandidate);
  const lengthRatio = Math.min(compactCandidate.length, compactCanonical.length) / Math.max(compactCandidate.length, compactCanonical.length, 1);
  const editSimilarity = levenshteinSimilarity(candidateClientName, canonicalClient);
  const firstTokenMismatch = candidateTokens[0]
    && canonicalTokens[0]
    && candidateTokens[0] !== canonicalTokens[0]
    && !STOP_TOKENS.has(candidateTokens[0])
    && !STOP_TOKENS.has(canonicalTokens[0]);
  const initialMismatch = isInitialToken(candidateTokens[0])
    && isInitialToken(canonicalTokens[0])
    && candidateTokens[0] !== canonicalTokens[0];

  if (firstTokenMismatch || initialMismatch) {
    return {
      safeForApply: false,
      status: 'hold_needs_business_review',
      reason: 'first-token-mismatch',
      editSimilarity,
      tokenOverlap: intersection.length / Math.max(candidateContent.length, canonicalContent.length, 1),
      intersectionCount: intersection.length,
    };
  }

  if (editSimilarity >= 0.9) {
    return {
      safeForApply: true,
      status: 'safe_latest_source_apply',
      reason: 'very-high-edit-similarity',
      editSimilarity,
      tokenOverlap: intersection.length / Math.max(candidateContent.length, canonicalContent.length, 1),
      intersectionCount: intersection.length,
    };
  }

  if (compactContains && lengthRatio >= 0.8 && intersection.length >= 1) {
    return {
      safeForApply: true,
      status: 'safe_latest_source_apply',
      reason: 'compact-contains-high-ratio',
      editSimilarity,
      tokenOverlap: intersection.length / Math.max(candidateContent.length, canonicalContent.length, 1),
      intersectionCount: intersection.length,
    };
  }

  if (intersection.length >= 2 && (intersection.length / Math.max(candidateContent.length, canonicalContent.length, 1)) >= 0.67) {
    return {
      safeForApply: true,
      status: 'safe_latest_source_apply',
      reason: 'strong-token-overlap',
      editSimilarity,
      tokenOverlap: intersection.length / Math.max(candidateContent.length, canonicalContent.length, 1),
      intersectionCount: intersection.length,
    };
  }

  return {
    safeForApply: false,
    status: 'hold_needs_business_review',
    reason: 'weak-or-ambiguous-business-match',
    editSimilarity,
    tokenOverlap: intersection.length / Math.max(candidateContent.length, canonicalContent.length, 1),
    intersectionCount: intersection.length,
  };
}

function peopleSummary(people) {
  return people.map((person) => `${person.name} x${person.evidenceCount}`).join('; ');
}

function sourceRowsSummary(people) {
  return unique(people.flatMap((person) => person.sourceRows || [])).join('; ');
}

function sheetPriority(sheetName) {
  const normalized = String(sheetName || '').toUpperCase();
  if (normalized.includes('WORK ORDER TERMINADOS Y PAGADOS')) return 30;
  if (normalized.includes('SIGNS WORK ORDER')) return 20;
  if (normalized.includes('ESTIMADOS')) return 10;
  return 0;
}

function sourceRowPosition(sourceRow) {
  const [sheet, rowValue] = String(sourceRow || '').split('#');
  const row = Number(rowValue);
  return (sheetPriority(sheet) * 100000) + (Number.isFinite(row) ? row : 0);
}

function latestSourceRow(sourceRows) {
  return [...(sourceRows || [])].sort((left, right) => sourceRowPosition(right) - sourceRowPosition(left))[0] || '';
}

function phoneKeysForPerson(item, person) {
  const phones = person.phoneHints?.length ? person.phoneHints : item.phoneHints;
  return phones.length ? phones.map((phone) => `${item.matchedCurrentContact}|${phone}`) : [`${item.matchedCurrentContact}|unknown`];
}

function buildLatestPersonByPhone(items) {
  const latestByPhone = new Map();
  for (const item of items) {
    for (const person of item.plannedPeople || []) {
      const latestRow = latestSourceRow(person.sourceRows || []);
      const position = sourceRowPosition(latestRow);
      for (const key of phoneKeysForPerson(item, person)) {
        const current = latestByPhone.get(key);
        if (!current || position > current.position) {
          latestByPhone.set(key, {
            name: person.name,
            normalizedName: normalizeName(person.name),
            sourceRow: latestRow,
            position,
          });
        }
      }
    }
  }
  return latestByPhone;
}

function latestReferencesForItem(item, latestByPhone) {
  const refs = [];
  const phones = item.phoneHints?.length ? item.phoneHints : ['unknown'];
  for (const phone of phones) {
    const ref = latestByPhone.get(`${item.matchedCurrentContact}|${phone}`);
    if (ref) refs.push(`${phone}: ${ref.name} from ${ref.sourceRow}`);
  }
  return unique(refs);
}

function isLatestPersonForAnyPhone(item, person, latestByPhone) {
  const normalized = normalizeName(person.name);
  return phoneKeysForPerson(item, person).some((key) => latestByPhone.get(key)?.normalizedName === normalized);
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || 'unknown';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function buildApprovalRow(item, latestByPhone) {
  const matchReview = businessMatchReview(item.candidateClientName, item.matchedCurrentContact);
  const rawInsertPeople = (item.plannedPeople || []).filter((person) => person.wouldInsert);
  const latestInsertPeople = rawInsertPeople.filter((person) => isLatestPersonForAnyPhone(item, person, latestByPhone));
  const supersededPeople = rawInsertPeople.filter((person) => !isLatestPersonForAnyPhone(item, person, latestByPhone));
  const defaultRecommendation = matchReview.safeForApply
    ? (latestInsertPeople.length ? 'approve_latest_source_linked_people' : 'approve_no_write_existing_or_superseded')
    : 'hold_needs_business_review';

  return {
    approvalDecision: '',
    allowedValues: 'approve_latest_source_linked_people | approve_no_write_existing_or_superseded | hold_needs_business_review | reject',
    canonicalClient: item.matchedCurrentContact,
    candidateClientName: item.candidateClientName,
    currentDecision: item.decision,
    defaultRecommendation,
    businessMatchStatus: matchReview.status,
    businessMatchReason: matchReview.reason,
    editSimilarity: Number(matchReview.editSimilarity.toFixed(3)),
    tokenOverlap: Number(matchReview.tokenOverlap.toFixed(3)),
    intersectionCount: matchReview.intersectionCount,
    proposedApplyAction: defaultRecommendation === 'approve_latest_source_linked_people'
      ? 'guarded_apply_may_insert_latest_source_people_only_after_dedupe'
      : 'no_db_write',
    candidatePeople: peopleSummary(item.plannedPeople || []),
    potentialLinkedPeopleToInsert: matchReview.safeForApply ? peopleSummary(latestInsertPeople) : '',
    heldPotentialPeople: matchReview.safeForApply ? '' : peopleSummary(latestInsertPeople),
    supersededPotentialPeople: peopleSummary(supersededPeople),
    latestSourceReference: latestReferencesForItem(item, latestByPhone).join('; '),
    phoneHints: (item.phoneHints || []).join('; '),
    sourceRowCount: item.sourceRowCount,
    linkedOperationalRows: item.linkedOperationalRows,
    sourceRows: sourceRowsSummary(item.plannedPeople || []),
    guardrail: 'No contact/client names, aliases, merges, remaps, creates, archives, deletes, consolidations, or primary-person changes.',
  };
}

function aggregatePeople(rows, field) {
  const byName = new Map();
  for (const row of rows) {
    for (const value of String(row[field] || '').split(';').map((entry) => entry.trim()).filter(Boolean)) {
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

function buildPacket(sourceReport) {
  const reviewedCandidates = sourceReport.reviewedCandidates || [];
  const approvalSourceRows = reviewedCandidates
    .filter((item) => item.decision === 'hold_spelling_variant_review')
    .filter((item) => !PASS1_CANONICAL_CLIENTS.has(item.matchedCurrentContact))
    .sort((left, right) => {
      const clientDiff = left.matchedCurrentContact.localeCompare(right.matchedCurrentContact);
      if (clientDiff) return clientDiff;
      return left.candidateClientName.localeCompare(right.candidateClientName);
    });

  const latestByPhone = buildLatestPersonByPhone(approvalSourceRows);
  const approvalRows = approvalSourceRows.map((item) => buildApprovalRow(item, latestByPhone));
  const safeApplyRows = approvalRows.filter((row) => row.defaultRecommendation === 'approve_latest_source_linked_people');
  const noWriteRows = approvalRows.filter((row) => row.defaultRecommendation === 'approve_no_write_existing_or_superseded');
  const heldRows = approvalRows.filter((row) => row.defaultRecommendation === 'hold_needs_business_review');
  const clients = [...new Set(approvalRows.map((row) => row.canonicalClient))].sort();

  return {
    generatedAt: new Date().toISOString(),
    issue: ISSUE,
    businessUnit: sourceReport.businessUnit || 'AIT Signs',
    sourceReport: DEFAULT_SOURCE,
    sourceGeneratedAt: sourceReport.generatedAt,
    summary: {
      sourceReviewedCandidates: reviewedCandidates.length,
      remainingSpellingRows: approvalRows.length,
      distinctCanonicalClients: clients.length,
      recommendedApplyRows: safeApplyRows.length,
      recommendedNoWriteRows: noWriteRows.length,
      heldBusinessReviewRows: heldRows.length,
      potentialLinkedPeopleAfterDedupe: aggregatePeople(safeApplyRows, 'potentialLinkedPeopleToInsert').length,
      heldPotentialPeopleAfterDedupe: aggregatePeople(heldRows, 'heldPotentialPeople').length,
      recommendationCounts: countBy(approvalRows, 'defaultRecommendation'),
      dbWritesPlannedByThisPacket: 0,
    },
    guardrails: [
      'Packet only; this script performs no database writes.',
      'The latest work-item/contact-point source row is temporary person-name truth until a newer edit/input replaces it.',
      'Safe apply rows are limited to strong business-name spelling/suffix matches.',
      'Held rows are not blocked by person-name uncertainty; they are blocked by business-name ambiguity.',
      'Any later apply must de-dupe by contact plus normalized person name.',
      'Do not rename, merge, remap, create, archive, delete, consolidate, or add aliases from this packet.',
      'Do not change primary linked-person flags from this packet.',
    ],
    clients,
    potentialLinkedPeopleToInsert: aggregatePeople(safeApplyRows, 'potentialLinkedPeopleToInsert'),
    heldPotentialPeople: aggregatePeople(heldRows, 'heldPotentialPeople'),
    approvalRows,
  };
}

function renderMarkdown(packet) {
  const lines = [
    '# MIS-150 AIT Signs Remaining Spelling Approval Packet',
    '',
    `- Generated at: ${packet.generatedAt}`,
    `- Source report: ${packet.sourceReport}`,
    `- Source generated at: ${packet.sourceGeneratedAt}`,
    `- Business unit: ${packet.businessUnit}`,
    '',
    '## Summary',
    '',
    `- Source reviewed candidates: ${packet.summary.sourceReviewedCandidates}`,
    `- Remaining spelling rows: ${packet.summary.remainingSpellingRows}`,
    `- Distinct canonical clients: ${packet.summary.distinctCanonicalClients}`,
    `- Recommended apply rows: ${packet.summary.recommendedApplyRows}`,
    `- Recommended no-write rows: ${packet.summary.recommendedNoWriteRows}`,
    `- Held business-review rows: ${packet.summary.heldBusinessReviewRows}`,
    `- Potential linked people after de-dupe: ${packet.summary.potentialLinkedPeopleAfterDedupe}`,
    `- Held potential people after de-dupe: ${packet.summary.heldPotentialPeopleAfterDedupe}`,
    `- DB writes planned by this packet: ${packet.summary.dbWritesPlannedByThisPacket}`,
    '',
    '## Guardrails',
    '',
    ...packet.guardrails.map((guardrail) => `- ${guardrail}`),
    '',
    '## Potential Linked People',
    '',
  ];

  if (packet.potentialLinkedPeopleToInsert.length) {
    for (const person of packet.potentialLinkedPeopleToInsert) lines.push(`- ${person}`);
  } else {
    lines.push('- none');
  }

  lines.push('', '## Held Potential People', '');
  if (packet.heldPotentialPeople.length) {
    for (const person of packet.heldPotentialPeople) lines.push(`- ${person}`);
  } else {
    lines.push('- none');
  }

  lines.push('', '## Recommended Apply Rows', '');
  for (const row of packet.approvalRows.filter((item) => item.defaultRecommendation === 'approve_latest_source_linked_people')) {
    lines.push(`- ${row.candidateClientName} -> ${row.canonicalClient}: ${row.potentialLinkedPeopleToInsert || 'none'}; ${row.businessMatchReason}; latest ${row.latestSourceReference || 'unknown'}`);
  }
  if (!packet.approvalRows.some((item) => item.defaultRecommendation === 'approve_latest_source_linked_people')) lines.push('- none');

  lines.push('', '## Held Business Review Rows', '');
  for (const row of packet.approvalRows.filter((item) => item.defaultRecommendation === 'hold_needs_business_review')) {
    lines.push(`- ${row.candidateClientName} -> ${row.canonicalClient}: ${row.heldPotentialPeople || 'no missing person'}; ${row.businessMatchReason}`);
  }
  if (!packet.approvalRows.some((item) => item.defaultRecommendation === 'hold_needs_business_review')) lines.push('- none');

  return `${lines.join('\n')}\n`;
}

function renderCsv(packet) {
  const headers = [
    'approvalDecision',
    'allowedValues',
    'canonicalClient',
    'candidateClientName',
    'currentDecision',
    'defaultRecommendation',
    'businessMatchStatus',
    'businessMatchReason',
    'editSimilarity',
    'tokenOverlap',
    'intersectionCount',
    'proposedApplyAction',
    'candidatePeople',
    'potentialLinkedPeopleToInsert',
    'heldPotentialPeople',
    'supersededPotentialPeople',
    'latestSourceReference',
    'phoneHints',
    'sourceRowCount',
    'linkedOperationalRows',
    'sourceRows',
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
