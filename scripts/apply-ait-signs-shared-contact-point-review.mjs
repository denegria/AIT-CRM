#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import {
  buildWorkbookCandidates,
  compareCandidatesToContacts,
  loadCurrentContacts,
  loadExistingPeople,
  loadWorkbookArtifact,
  normalizeName,
  resolveWorkbook,
  safeDbFingerprint,
} from './dry-run-ait-signs-canonical-replacement-plan.mjs';

const DEFAULT_OUTPUT = 'docs/mis-147-ait-signs-shared-contact-point-review-apply.json';
const DEFAULT_MARKDOWN = 'docs/mis-147-ait-signs-shared-contact-point-review-apply.md';
const DEFAULT_CSV = 'docs/mis-147-ait-signs-shared-contact-point-review-apply.csv';
const SOURCE_LABEL = 'ait_signs_shared_contact_variant_backfill';
const EXPECTED_STAGING_BRANCH_ID = 'br-broad-hill-aptjpyea';

function parseArgs(argv) {
  const options = {
    workbook: null,
    output: DEFAULT_OUTPUT,
    markdown: DEFAULT_MARKDOWN,
    csv: DEFAULT_CSV,
    businessUnit: 'AIT Signs',
    apply: false,
    confirmStaging: false,
    sampleLimit: 30,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workbook') {
      options.workbook = argv[index + 1];
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
    } else if (arg === '--business-unit') {
      options.businessUnit = argv[index + 1];
      index += 1;
    } else if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--confirm-staging') {
      options.confirmStaging = true;
    } else if (arg === '--sample-limit') {
      options.sampleLimit = Number(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.sampleLimit) || options.sampleLimit < 1) {
    throw new Error('--sample-limit must be a positive number');
  }
  return options;
}

function compact(value) {
  return normalizeName(value).replace(/\s+/g, '');
}

function words(value) {
  return normalizeName(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (word === 'free') return 'tree';
      if (word === 'servce' || word === 'servic' || word === 'servece') return 'service';
      if (word === 'landscping' || word === 'lanscaping' || word === 'landscope') return 'landscaping';
      if (word === 'detaling' || word === 'detalling' || word === 'detailing') return 'detailing';
      return word;
    })
    .filter((word) => !['llc', 'inc', 'corp', 'co'].includes(word));
}

function levenshtein(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[left.length][right.length];
}

function editSimilarity(a, b) {
  const left = compact(a);
  const right = compact(b);
  const longest = Math.max(left.length, right.length);
  if (!longest) return 0;
  return 1 - (levenshtein(left, right) / longest);
}

function tokenOverlap(a, b) {
  const left = new Set(words(a));
  const right = new Set(words(b));
  const union = new Set([...left, ...right]);
  if (!union.size) return 0;
  const intersection = [...left].filter((word) => right.has(word));
  return intersection.length / union.size;
}

function leadingAcronym(tokens) {
  const letters = [];
  for (const token of tokens) {
    if (token.length !== 1) break;
    if (token === 'and') continue;
    letters.push(token);
  }
  return letters.join('');
}

function firstTokenCompatible(a, b) {
  const left = words(a);
  const right = words(b);
  if (!left.length || !right.length) return false;
  if (left[0] === right[0]) return true;
  const leftAcronym = leadingAcronym(left);
  const rightAcronym = leadingAcronym(right);
  if (left[0].length <= 3 && rightAcronym && left[0] === rightAcronym) return true;
  if (right[0].length <= 3 && leftAcronym && right[0] === leftAcronym) return true;
  return left[0].length > 3 && right[0].length > 3;
}

function businessSimilarity(a, b) {
  const leftWords = words(a);
  const rightWords = words(b);
  const edit = editSimilarity(words(a).join(''), words(b).join(''));
  const overlap = tokenOverlap(a, b);
  const intersectionCount = leftWords.filter((word) => rightWords.includes(word)).length;
  const left = leftWords.join('');
  const right = rightWords.join('');
  const contains = left && right && (left.includes(right) || right.includes(left));
  const lengthRatio = left && right ? Math.min(left.length, right.length) / Math.max(left.length, right.length) : 0;
  const compatibleStart = firstTokenCompatible(a, b);
  const similar = edit >= 0.68 || overlap >= 0.6 || (contains && lengthRatio >= 0.5);
  return { edit, overlap, intersectionCount, contains, lengthRatio, compatibleStart, similar };
}

function splitSourceRow(sourceRow) {
  const [sheet, row] = String(sourceRow || '').split('#');
  return {
    sourceSheet: sheet || null,
    sourceRow: Number.isFinite(Number(row)) ? Number(row) : null,
  };
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function csvLine(values) {
  return values.map(csvEscape).join(',');
}

async function loadBusinessUnit(client, businessUnit) {
  const result = await client.query(
    `
      select id, organization_id, name
      from business_units
      where name = $1
      limit 1
    `,
    [businessUnit],
  );
  if (!result.rows[0]) throw new Error(`Missing business unit: ${businessUnit}`);
  return result.rows[0];
}

async function stagingRuntimeFingerprint(client) {
  const currentDb = await client.query('select current_database() as database');
  const secrets = await safeDbFingerprint();
  return {
    ...secrets,
    currentDatabase: currentDb.rows[0]?.database || null,
  };
}

function assertStagingApplyAllowed(options, fingerprint) {
  if (!options.apply) return;
  if (!options.confirmStaging) throw new Error('Refusing to apply without --confirm-staging.');
  if (fingerprint?.expectedNeonBranchId !== EXPECTED_STAGING_BRANCH_ID) {
    throw new Error(`Refusing to apply: expected staging branch ${EXPECTED_STAGING_BRANCH_ID}, received ${fingerprint?.expectedNeonBranchId || 'unknown'}.`);
  }
}

function classifySharedContactCandidate(candidate) {
  const match = candidate.currentMatches[0] || null;
  if (!match) {
    return {
      decision: 'hold_no_single_match',
      confidence: 'blocked',
      reason: 'No single current CRM contact was available for linked-person backfill.',
      similarity: null,
    };
  }

  const similarity = businessSimilarity(candidate.clientName, match.name);
  const highConfidence = (
    (similarity.edit >= 0.8 && similarity.overlap >= 0.25 && similarity.compatibleStart)
    || (similarity.overlap >= 0.75 && similarity.intersectionCount >= 2)
    || (similarity.contains && similarity.lengthRatio >= 0.65 && similarity.compatibleStart)
  );
  if (highConfidence) {
    return {
      decision: 'apply_to_existing_spelling_variant',
      confidence: 'high',
      reason: 'Workbook candidate appears to be a spelling/format variant of the current cleaned client name.',
      similarity,
    };
  }

  if (similarity.similar) {
    return {
      decision: 'hold_spelling_variant_review',
      confidence: 'review',
      reason: 'Candidate may be a spelling/format variant, but similarity is not strong enough for automatic linked-person writes.',
      similarity,
    };
  }

  return {
    decision: 'hold_shared_contact_separate_business',
    confidence: 'review',
    reason: 'Phone indicates shared owner/contact point, not shared client identity.',
    similarity,
  };
}

function primaryCandidateFor(contactId, existingPeopleByContact, insertedByContact) {
  const existing = existingPeopleByContact.get(contactId) || [];
  if (existing.some((person) => person.is_primary)) return false;
  return !insertedByContact.has(contactId);
}

function buildPlan(compared, existingPeopleByContact) {
  const phoneCandidates = compared.filter((candidate) => candidate.action === 'review_phone_remap');
  const reviewed = [];
  const inserts = [];
  const skippedExisting = [];
  const insertedByContact = new Set();

  for (const candidate of phoneCandidates) {
    const classification = classifySharedContactCandidate(candidate);
    const match = candidate.currentMatches[0] || null;
    const existingNames = match
      ? new Set((existingPeopleByContact.get(match.id) || []).map((person) => normalizeName(person.name)))
      : new Set();
    const plannedInsertCountBefore = inserts.length;

    if (classification.decision === 'apply_to_existing_spelling_variant' && match) {
      for (const person of candidate.plannedPeople) {
        const normalizedPerson = normalizeName(person.name);
        if (existingNames.has(normalizedPerson)) {
          skippedExisting.push({
            contactId: match.id,
            contactName: match.name,
            candidateClientName: candidate.clientName,
            personName: person.name,
            reason: 'Existing linked person with same normalized name.',
          });
          continue;
        }
        const { sourceSheet, sourceRow } = splitSourceRow(person.sourceRows[0]);
        const isPrimary = primaryCandidateFor(match.id, existingPeopleByContact, insertedByContact);
        inserts.push({
          contactId: match.id,
          contactName: match.name,
          candidateClientName: candidate.clientName,
          name: person.name,
          phone: person.phoneHints[0] || null,
          email: null,
          notes: null,
          isPrimary,
          sourceLabel: SOURCE_LABEL,
          sourceSheet,
          sourceRow,
          metadataJson: {
            issue: 'MIS-147',
            candidateClientName: candidate.clientName,
            matchedClientName: match.name,
            evidenceCount: person.evidenceCount,
            sourceRows: person.sourceRows,
            phoneHints: person.phoneHints,
            classification: classification.decision,
            similarity: classification.similarity,
          },
        });
        insertedByContact.add(match.id);
      }
    }

    reviewed.push({
      candidateClientName: candidate.clientName,
      matchedCurrentContact: match?.name || '',
      matchedContactId: match?.id || '',
      phoneHints: candidate.phoneHints,
      sourceRowCount: candidate.sourceRowCount,
      linkedOperationalRows: match?.linkedOperationalRows || 0,
      plannedPeople: candidate.plannedPeople,
      decision: classification.decision,
      confidence: classification.confidence,
      reason: classification.reason,
      similarity: classification.similarity,
      plannedInserts: inserts.length - plannedInsertCountBefore,
    });
  }

  return { phoneCandidates, reviewed, inserts, skippedExisting };
}

async function applyPlan(client, businessUnit, inserts, apply) {
  if (!apply || !inserts.length) return [];
  const applied = [];
  await client.query('begin');
  try {
    for (const item of inserts) {
      const result = await client.query(
        `
          insert into contact_people (
            organization_id,
            business_unit_id,
            contact_id,
            name,
            role,
            phone,
            email,
            notes,
            is_primary,
            source_label,
            source_sheet,
            source_row,
            metadata_json
          )
          values ($1, $2, $3, $4, null, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
          returning id, contact_id, name, is_primary
        `,
        [
          businessUnit.organization_id,
          businessUnit.id,
          item.contactId,
          item.name,
          item.phone,
          item.email,
          item.notes,
          item.isPrimary,
          item.sourceLabel,
          item.sourceSheet,
          item.sourceRow,
          JSON.stringify(item.metadataJson),
        ],
      );
      applied.push(result.rows[0]);
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
  return applied;
}

function renderMarkdown(report) {
  const lines = [
    '# MIS-147 AIT Signs Shared Contact-Point Review',
    '',
    `- Generated at: ${report.generatedAt}`,
    `- Mode: ${report.mode}`,
    `- Workbook: ${report.workbook.path}`,
    `- Workbook hash: ${report.workbook.hash}`,
    `- Business unit: ${report.businessUnit}`,
    `- Target base URL: ${report.safeFingerprint?.targetBaseUrl || 'unknown'}`,
    `- Neon branch id: ${report.safeFingerprint?.expectedNeonBranchId || 'unknown'}`,
    `- Current database: ${report.safeFingerprint?.currentDatabase || 'unknown'}`,
    '',
    '## Summary',
    '',
    `- Phone/shared-contact candidates reviewed: ${report.summary.reviewedCandidates}`,
    `- Spelling variants eligible for existing-client linked people: ${report.summary.decisionCounts.apply_to_existing_spelling_variant || 0}`,
    `- Spelling variants held for review: ${report.summary.decisionCounts.hold_spelling_variant_review || 0}`,
    `- Separate-business/shared-contact holds: ${report.summary.decisionCounts.hold_shared_contact_separate_business || 0}`,
    `- Planned linked people inserts: ${report.summary.plannedInserts}`,
    `- Applied linked people inserts: ${report.summary.appliedInserts}`,
    `- Existing linked people skipped: ${report.summary.skippedExisting}`,
    `- Distinct contacts affected: ${report.summary.distinctContactsAffected}`,
    '',
    '## Guardrails',
    '',
    '- Same phone is treated as shared contact-point evidence, not client identity evidence.',
    '- This script does not merge, rename, remap, create, archive, delete, or consolidate contacts.',
    '- Current cleaned CRM names remain canonical.',
    `- Rows inserted by apply mode are tagged with source_label=${SOURCE_LABEL}.`,
    '',
    '## Decision Samples',
    '',
  ];

  for (const item of report.samples.reviewed) {
    lines.push(`- ${item.candidateClientName} -> ${item.matchedCurrentContact || 'none'}: ${item.decision}; people ${item.plannedPeople.map((person) => person.name).join(', ') || 'none'}; ${item.reason}`);
  }
  return `${lines.join('\n')}\n`;
}

function renderCsv(reviewed) {
  const rows = [
    csvLine([
      'decision',
      'confidence',
      'candidate_client_name',
      'matched_current_contact',
      'phone_hints',
      'source_row_count',
      'linked_operational_rows',
      'people',
      'planned_inserts',
      'reason',
      'edit_similarity',
      'token_overlap',
    ]),
  ];
  for (const item of reviewed) {
    rows.push(csvLine([
      item.decision,
      item.confidence,
      item.candidateClientName,
      item.matchedCurrentContact,
      item.phoneHints.join('; '),
      item.sourceRowCount,
      item.linkedOperationalRows,
      item.plannedPeople.map((person) => `${person.name} x${person.evidenceCount}`).join('; '),
      item.plannedInserts,
      item.reason,
      item.similarity ? item.similarity.edit.toFixed(3) : '',
      item.similarity ? item.similarity.overlap.toFixed(3) : '',
    ]));
  }
  return `${rows.join('\n')}\n`;
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || 'unknown';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

async function main() {
  const options = parseArgs(process.argv);
  const workbookPath = resolveWorkbook(options.workbook);
  const artifact = loadWorkbookArtifact(workbookPath);
  const { groups } = buildWorkbookCandidates(artifact);

  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const businessUnit = await loadBusinessUnit(client, options.businessUnit);
  const fingerprint = await stagingRuntimeFingerprint(client);
  assertStagingApplyAllowed(options, fingerprint);
  const contacts = await loadCurrentContacts(client, options.businessUnit);
  const existingPeopleByContact = await loadExistingPeople(client, contacts);
  const comparison = compareCandidatesToContacts(groups, contacts, existingPeopleByContact);
  const plan = buildPlan(comparison.compared, existingPeopleByContact);
  const applied = await applyPlan(client, businessUnit, plan.inserts, options.apply);
  await client.end();

  const affectedContactIds = new Set(plan.inserts.map((item) => item.contactId));
  const report = {
    generatedAt: new Date().toISOString(),
    issue: 'MIS-147',
    mode: options.apply ? 'apply' : 'dry-run',
    businessUnit: options.businessUnit,
    safeFingerprint: fingerprint,
    workbook: {
      path: workbookPath,
      hash: artifact.workbookFileHash,
    },
    summary: {
      reviewedCandidates: plan.reviewed.length,
      decisionCounts: countBy(plan.reviewed, 'decision'),
      plannedInserts: plan.inserts.length,
      appliedInserts: applied.length,
      skippedExisting: plan.skippedExisting.length,
      distinctContactsAffected: affectedContactIds.size,
    },
    samples: {
      reviewed: plan.reviewed.slice(0, options.sampleLimit),
      inserts: plan.inserts.slice(0, options.sampleLimit),
      skippedExisting: plan.skippedExisting.slice(0, options.sampleLimit),
    },
    reviewedCandidates: plan.reviewed,
  };

  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(options.markdown, renderMarkdown(report));
  await writeFile(options.csv, renderCsv(plan.reviewed));
  console.log(JSON.stringify({
    output: options.output,
    markdown: options.markdown,
    csv: options.csv,
    summary: report.summary,
    mode: report.mode,
    safeFingerprint: report.safeFingerprint,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
