#!/usr/bin/env node

import { createHash } from 'node:crypto';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import {
  DEFAULT_BUSINESS_UNIT,
  buildReport,
  loadAitSignsContacts,
  loadLinkCounts,
  normalizeText,
  safeDbFingerprint,
  writeJson,
  writeText,
} from './dry-run-ait-signs-account-backfill.mjs';

const PROTECTED_SEPARATION_NAMES = ['G&R TREE SERVICE', 'RG TREE SERVICE'];
const FAKE_PHONE_KEYS = new Set([
  '0000000000',
  '1111111111',
  '1234567890',
  '0123456789',
  '9999999999',
]);
const GENERIC_NAME_TOKENS = new Set([
  'customer',
  'client',
  'cash',
  'unknown',
  'test',
  'none',
  'na',
  'ready',
]);

function parseArgs(argv) {
  const options = {
    businessUnit: DEFAULT_BUSINESS_UNIT,
    output: null,
    markdown: null,
    sampleLimit: 25,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--business-unit') {
      options.businessUnit = argv[i + 1];
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

function phoneEvidence(value) {
  const digits = phoneDigits(value);
  if (!digits) return { status: 'no_phone', masked: '', fingerprint: '' };
  const normalized = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  const isFake =
    normalized.length < 7 ||
    FAKE_PHONE_KEYS.has(normalized) ||
    /^(\d)\1+$/.test(normalized);
  return {
    status: isFake ? 'fake_or_invalid_phone' : 'real_phone',
    masked: normalized.length >= 4 ? `***${normalized.slice(-4)}` : '***',
    fingerprint: createHash('sha256').update(normalized).digest('hex').slice(0, 12),
  };
}

function emailKey(value) {
  return cleanText(value).toLowerCase();
}

function isGenericName(value) {
  const tokens = normalizeText(value).split(' ').filter(Boolean);
  return Boolean(tokens.length) && tokens.every((token) => GENERIC_NAME_TOKENS.has(token));
}

async function loadContactDetails(client, contactIds) {
  if (!contactIds.length) return new Map();
  const result = await client.query(
    `
      select
        c.id,
        c.name,
        c.company_name,
        c.phone,
        c.email,
        c.address,
        c.source_label,
        c.client_account_id,
        ca.display_name as existing_account_name
      from contacts c
      left join client_accounts ca on ca.id = c.client_account_id
      where c.id = any($1::uuid[])
    `,
    [contactIds],
  );
  return new Map(result.rows.map((row) => [row.id, row]));
}

async function loadProtectedSeparations(client, businessUnit) {
  const result = await client.query(
    `
      select
        c.id,
        c.name,
        c.company_name,
        c.phone,
        c.client_account_id,
        ca.display_name as account_name
      from contacts c
      join business_units bu on bu.id = c.primary_business_unit_id
      left join client_accounts ca on ca.id = c.client_account_id
      where bu.name = $1
        and upper(coalesce(c.company_name, c.name)) = any($2::text[])
      order by upper(coalesce(c.company_name, c.name))
    `,
    [businessUnit, PROTECTED_SEPARATION_NAMES],
  );
  return result.rows.map((row) => {
    const phone = phoneEvidence(row.phone);
    return {
      contactId: row.id,
      displayName: cleanText(row.company_name) || cleanText(row.name),
      existingAccountId: row.client_account_id,
      existingAccountName: row.account_name,
      phoneStatus: phone.status,
      phoneMasked: phone.masked,
      phoneFingerprint: phone.fingerprint,
      disposition: 'keep_separate_without_new_evidence',
    };
  });
}

function detailFor(summary, detailByContactId) {
  const detail = detailByContactId.get(summary.contactId) || {};
  const phone = phoneEvidence(detail.phone);
  return {
    ...summary,
    emailPresent: Boolean(emailKey(detail.email)),
    addressPresent: Boolean(cleanText(detail.address)),
    existingAccountId: detail.client_account_id || null,
    existingAccountName: detail.existing_account_name || null,
    phoneStatus: phone.status,
    phoneMasked: phone.masked,
    phoneFingerprint: phone.fingerprint,
  };
}

function chooseTargetContact(contacts) {
  return [...contacts].sort((a, b) => {
    if (b.linkedCount !== a.linkedCount) return b.linkedCount - a.linkedCount;
    if ((b.sourceLabel === 'work_order') !== (a.sourceLabel === 'work_order')) {
      return b.sourceLabel === 'work_order' ? 1 : -1;
    }
    if ((b.phoneStatus === 'real_phone') !== (a.phoneStatus === 'real_phone')) {
      return b.phoneStatus === 'real_phone' ? 1 : -1;
    }
    return a.displayName.localeCompare(b.displayName);
  })[0];
}

function phoneGroups(contacts) {
  const groups = new Map();
  for (const contact of contacts) {
    if (contact.phoneStatus !== 'real_phone' || !contact.phoneFingerprint) continue;
    const group = groups.get(contact.phoneFingerprint) || {
      fingerprint: contact.phoneFingerprint,
      masked: contact.phoneMasked,
      contacts: [],
    };
    group.contacts.push(contact.contactId);
    groups.set(contact.phoneFingerprint, group);
  }
  return [...groups.values()].sort((a, b) => b.contacts.length - a.contacts.length || a.masked.localeCompare(b.masked));
}

function sourceAliasesForTarget(contacts, target) {
  const targetName = normalizeText(target.displayName);
  const seen = new Set();
  return contacts
    .filter((contact) => normalizeText(contact.displayName) !== targetName)
    .map((contact) => ({
      value: contact.displayName,
      normalizedValue: normalizeText(contact.displayName),
      sourceContactId: contact.contactId,
      visibility: 'hidden',
      searchable: true,
    }))
    .filter((alias) => {
      if (seen.has(alias.normalizedValue)) return false;
      seen.add(alias.normalizedValue);
      return true;
    });
}

function classifyGroup(group, kind, detailByContactId) {
  const contacts = group.contacts.map((contact) => detailFor(contact, detailByContactId));
  const target = chooseTargetContact(contacts);
  const phones = phoneGroups(contacts);
  const sharedPhones = phones.filter((phone) => phone.contacts.length > 1);
  const hasWorkbookSupport = contacts.some((contact) => cleanText(contact.sourceLabel).startsWith('mis_97_'));
  const hasGenericName = contacts.some((contact) => isGenericName(contact.displayName));
  const hasConflictingPhones = phones.length > 1 && !sharedPhones.length;
  const allNoPhone = contacts.every((contact) => contact.phoneStatus !== 'real_phone');
  const sourceAliases = sourceAliasesForTarget(contacts, target);

  let evidenceClass = kind === 'exact_duplicate'
    ? 'exact_normalized_name'
    : 'near_duplicate_name_similarity';
  if (sharedPhones.length) evidenceClass = `${evidenceClass}+shared_real_phone`;
  if (hasWorkbookSupport) evidenceClass = `${evidenceClass}+workbook_supported`;

  let disposition = 'candidate_needs_human_approval';
  const holdReasons = [];
  if (hasGenericName) holdReasons.push('generic_name');
  if (allNoPhone) holdReasons.push('no_real_phone');
  if (hasConflictingPhones) holdReasons.push('conflicting_real_phone_evidence');
  if (kind === 'near_duplicate' && !sharedPhones.length && !hasWorkbookSupport) {
    holdReasons.push('near_duplicate_name_only');
  }
  if (holdReasons.length) disposition = 'hold_for_manual_review';

  return {
    groupKind: kind,
    evidenceClass,
    disposition,
    holdReasons,
    targetAccountCandidate: {
      displayName: target.displayName,
      sourceContactId: target.contactId,
      reason: 'highest_operational_history_then_source_quality',
    },
    sourceContactCandidates: contacts.map((contact) => ({
      contactId: contact.contactId,
      displayName: contact.displayName,
      sourceLabel: contact.sourceLabel,
      linkedCount: contact.linkedCount,
      linkBreakdown: contact.linkBreakdown,
      phoneStatus: contact.phoneStatus,
      phoneMasked: contact.phoneMasked,
      phoneFingerprint: contact.phoneFingerprint,
      emailPresent: contact.emailPresent,
      addressPresent: contact.addressPresent,
      existingAccountId: contact.existingAccountId,
      existingAccountName: contact.existingAccountName,
    })),
    evidence: {
      displayNameOptions: group.displayNameOptions,
      normalizedAccountKeys: group.normalizedAccountKeys || [group.normalizedAccountKey],
      contactCount: group.contactCount,
      linkedOperationalRows: group.linkedCount,
      phoneGroups: phones,
      sharedRealPhoneGroups: sharedPhones,
      hasWorkbookSupport,
      hasGenericName,
    },
    applyPacketShape: {
      createOrUseTargetAccount: target.displayName,
      contactsToLink: contacts.length,
      operationalRowsCarriedByContactLinks: group.linkedCount,
      hiddenSourceAliasesToCreate: sourceAliases,
      contactMethodsToCreate: phones.length,
      peopleToCreate: 0,
      locationsToCreate: contacts.filter((contact) => contact.addressPresent).length,
    },
    rollbackPlan: [
      'export target account, source contacts, aliases, contact methods, people, locations, and affected contact ids before apply',
      'restore contacts.client_account_id to previous values for affected contacts',
      'delete aliases/contact methods/people/locations created by the consolidation source tag',
      'delete target account only when it was created by the consolidation and has no unrelated links',
    ],
  };
}

function summarizeClassifications(classifications) {
  const byDisposition = new Map();
  const byEvidenceClass = new Map();
  const holdReasonCounts = new Map();
  for (const item of classifications) {
    byDisposition.set(item.disposition, (byDisposition.get(item.disposition) || 0) + 1);
    byEvidenceClass.set(item.evidenceClass, (byEvidenceClass.get(item.evidenceClass) || 0) + 1);
    for (const reason of item.holdReasons) {
      holdReasonCounts.set(reason, (holdReasonCounts.get(reason) || 0) + 1);
    }
  }
  const toRows = (map) => [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => ({ key, count }));
  return {
    byDisposition: toRows(byDisposition),
    byEvidenceClass: toRows(byEvidenceClass),
    holdReasonCounts: toRows(holdReasonCounts),
  };
}

async function buildConsolidationReport(client, options) {
  const rows = await loadAitSignsContacts(client, options.businessUnit);
  const linkCounts = await loadLinkCounts(client, rows.map((row) => row.id));
  const dryRunReport = buildReport(rows, linkCounts, options, {
    currentDatabase: (await client.query('select current_database() as name')).rows[0]?.name || null,
    contactsClientAccountColumnExists: true,
  });
  const heldGroups = [
    ...dryRunReport.fullResults.duplicateAccountKeyGroups.map((group) => ({ group, kind: 'exact_duplicate' })),
    ...dryRunReport.fullResults.nearDuplicateAccountKeyGroups.map((group) => ({ group, kind: 'near_duplicate' })),
  ];
  const contactIds = heldGroups.flatMap(({ group }) => group.contacts.map((contact) => contact.contactId));
  const detailByContactId = await loadContactDetails(client, contactIds);
  const protectedSeparations = await loadProtectedSeparations(client, options.businessUnit);
  const classifications = heldGroups
    .map(({ group, kind }) => classifyGroup(group, kind, detailByContactId))
    .sort((a, b) => {
      if (a.disposition !== b.disposition) return a.disposition.localeCompare(b.disposition);
      return b.evidence.linkedOperationalRows - a.evidence.linkedOperationalRows;
    });
  const candidateGroups = classifications.filter((item) => item.disposition === 'candidate_needs_human_approval');
  const heldForReviewGroups = classifications.filter((item) => item.disposition !== 'candidate_needs_human_approval');

  return {
    generatedAt: new Date().toISOString(),
    dryRun: true,
    target: {
      businessUnit: options.businessUnit,
      db: safeDbFingerprint(),
    },
    rules: {
      noAutomaticMerge: true,
      reviewedApplyRequired: true,
      candidateCriteria: [
        'exact normalized duplicate account key',
        'near duplicate with shared real phone evidence',
        'near duplicate with explicit workbook-supported correction evidence',
      ],
      holdCriteria: [
        'near-duplicate name-only evidence',
        'conflicting real phone evidence',
        'no real phone evidence',
        'generic or low-signal names',
      ],
      protectedSeparations: 'G&R TREE SERVICE and RG TREE SERVICE remain separate without new evidence',
    },
    summary: {
      totalAitSignsContacts: rows.length,
      heldExactDuplicateGroups: dryRunReport.summary.duplicateAccountKeyGroups,
      heldNearDuplicateGroups: dryRunReport.summary.nearDuplicateAccountKeyGroups,
      reviewedGroups: classifications.length,
      candidateGroups: candidateGroups.length,
      candidateGroupsWithSharedRealPhone: candidateGroups.filter((item) => item.evidence.sharedRealPhoneGroups.length > 0).length,
      candidateGroupsWithWorkbookSupport: candidateGroups.filter((item) => item.evidence.hasWorkbookSupport).length,
      candidateExactDuplicateGroups: candidateGroups.filter((item) => item.groupKind === 'exact_duplicate').length,
      heldForReviewGroups: heldForReviewGroups.length,
      candidateContacts: candidateGroups.reduce((sum, item) => sum + item.evidence.contactCount, 0),
      candidateOperationalRows: candidateGroups.reduce((sum, item) => sum + item.evidence.linkedOperationalRows, 0),
      heldContacts: heldForReviewGroups.reduce((sum, item) => sum + item.evidence.contactCount, 0),
      heldOperationalRows: heldForReviewGroups.reduce((sum, item) => sum + item.evidence.linkedOperationalRows, 0),
      protectedSeparations: protectedSeparations.length,
      ...summarizeClassifications(classifications),
    },
    samples: {
      candidateGroups: candidateGroups.slice(0, options.sampleLimit),
      heldForReviewGroups: heldForReviewGroups.slice(0, options.sampleLimit),
      protectedSeparations,
    },
    fullResults: {
      candidateGroups,
      heldForReviewGroups,
      protectedSeparations,
    },
  };
}

function markdownList(items, formatter, emptyText = 'None in sample.') {
  if (!items.length) return [`- ${emptyText}`];
  return items.map(formatter);
}

function summarizeGroupForMarkdown(group) {
  const phones = group.evidence.sharedRealPhoneGroups.length
    ? group.evidence.sharedRealPhoneGroups.map((phone) => `${phone.masked} (${phone.contacts.length} contacts)`).join(', ')
    : 'none';
  return `- ${group.targetAccountCandidate.displayName} — ${group.evidenceClass}; contacts: ${group.evidence.contactCount}; operational rows: ${group.evidence.linkedOperationalRows}; shared phones: ${phones}; aliases to create: ${group.applyPacketShape.hiddenSourceAliasesToCreate.length}; hold reasons: ${group.holdReasons.join(', ') || 'none'}`;
}

function toMarkdown(report) {
  const lines = [
    '# MIS-134 AIT Signs Reviewed Consolidation Dry Run',
    '',
    '## Summary',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Dry run: ${report.dryRun ? 'yes' : 'no'}`,
    `- Business unit: ${report.target.businessUnit}`,
    `- Target base URL: ${report.target.db.targetBaseUrl || 'not provided'}`,
    `- DB branch label: ${report.target.db.branchLabel || 'not provided'}`,
    `- DB host suffix: ${report.target.db.hostSuffix || 'not provided'}`,
    `- DB name: ${report.target.db.database || 'not provided'}`,
    '',
    '## Counts',
    '',
    `- AIT Signs contacts scanned: ${report.summary.totalAitSignsContacts}`,
    `- Held exact duplicate groups: ${report.summary.heldExactDuplicateGroups}`,
    `- Held near-duplicate groups: ${report.summary.heldNearDuplicateGroups}`,
    `- Reviewed held groups: ${report.summary.reviewedGroups}`,
    `- Candidate groups needing human approval: ${report.summary.candidateGroups}`,
    `- Candidate groups with shared real phone evidence: ${report.summary.candidateGroupsWithSharedRealPhone}`,
    `- Candidate groups with workbook support: ${report.summary.candidateGroupsWithWorkbookSupport}`,
    `- Candidate exact duplicate groups: ${report.summary.candidateExactDuplicateGroups}`,
    `- Held-for-review groups: ${report.summary.heldForReviewGroups}`,
    `- Candidate contacts: ${report.summary.candidateContacts}`,
    `- Candidate operational rows: ${report.summary.candidateOperationalRows}`,
    `- Held contacts: ${report.summary.heldContacts}`,
    `- Held operational rows: ${report.summary.heldOperationalRows}`,
    '',
    '## Rules',
    '',
    '- No automatic consolidation happens in this dry run.',
    '- Candidate groups still require human approval before any apply script links contacts or creates account records.',
    '- Near-duplicate name-only groups stay held.',
    '- Conflicting real-phone groups stay held.',
    '- G&R TREE SERVICE and RG TREE SERVICE stay separate unless new evidence overturns the current rule.',
    '',
    '## Disposition Counts',
    '',
    ...markdownList(report.summary.byDisposition, (item) => `- ${item.key}: ${item.count}`),
    '',
    '## Hold Reason Counts',
    '',
    ...markdownList(report.summary.holdReasonCounts, (item) => `- ${item.key}: ${item.count}`),
    '',
    '## Candidate Sample',
    '',
    ...markdownList(report.samples.candidateGroups, summarizeGroupForMarkdown),
    '',
    '## Held Sample',
    '',
    ...markdownList(report.samples.heldForReviewGroups, summarizeGroupForMarkdown),
    '',
    '## Protected Separations',
    '',
    ...markdownList(report.samples.protectedSeparations, (item) => (
      `- ${item.displayName}: account ${item.existingAccountName || 'none'}, phone ${item.phoneMasked || 'none'}, disposition ${item.disposition}`
    )),
    '',
    '## Apply/Rollback Shape',
    '',
    '- Apply would export affected rows first, create or use a target account, link reviewed contacts, create hidden aliases for source names, add contact methods/locations, and tag all created records with the consolidation source.',
    '- Rollback would restore prior `contacts.client_account_id` values and delete records created by the consolidation source tag.',
    '',
  ];
  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query('begin transaction read only');
    const report = await buildConsolidationReport(client, options);
    await client.query('commit');

    if (options.output) writeJson(options.output, report);
    if (options.markdown) writeText(options.markdown, toMarkdown(report));

    console.log(JSON.stringify({
      dryRun: true,
      output: options.output,
      markdown: options.markdown,
      summary: report.summary,
    }, null, 2));
  } catch (error) {
    try { await client.query('rollback'); } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
