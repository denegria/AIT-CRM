#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Client } from 'pg';

const DEFAULT_BUSINESS_UNIT = 'AIT Signs';
const CONTACT_LINK_TABLES = [
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

const LOW_SIGNAL_KEYS = new Set([
  'unknown',
  'unk',
  'none',
  'noname',
  'no name',
  'na',
  'n a',
  'test',
  'customer',
  'client',
  'cash',
  'wrong number',
  'wrongnumber',
  'unknownaitsigns',
  'unknownaitsignscontact',
  'aitsignscontact',
  'ready',
  'do not call',
  'donotcall',
  'dnc',
]);
const LEADING_PARTICLES = new Set(['a', 'an', 'and', 'the', 'la', 'el', 'los', 'las', 'de', 'del']);
const GENERIC_BUSINESS_TOKENS = new Set([
  'auto',
  'bakery',
  'cleaning',
  'company',
  'construction',
  'contractor',
  'contractors',
  'field',
  'fields',
  'floor',
  'floors',
  'fence',
  'gutters',
  'home',
  'improvement',
  'iron',
  'landscaping',
  'market',
  'mechanic',
  'mechanical',
  'mover',
  'movers',
  'painting',
  'restaurant',
  'roofing',
  'service',
  'services',
  'supermarket',
  'tree',
  'works',
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

function normalizeText(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function compactKey(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

function displayNameForContact(row) {
  return cleanText(row.company_name) || cleanText(row.name);
}

function hasUsableAccountLabel(label) {
  const normalized = normalizeText(label);
  const compact = compactKey(label);
  const tokens = normalized.split(' ').filter(Boolean);
  if (!normalized || !compact) return false;
  if (LOW_SIGNAL_KEYS.has(normalized) || LOW_SIGNAL_KEYS.has(compact)) return false;
  if (tokens.length && tokens.every((token) => GENERIC_BUSINESS_TOKENS.has(token))) return false;
  return compact.length >= 3;
}

function mapLinkBreakdown(linkCounts, contactId) {
  const counts = {};
  let total = 0;
  for (const [tableName, tableCounts] of linkCounts.entries()) {
    const count = Number(tableCounts.get(contactId) || 0);
    if (count > 0) counts[tableName] = count;
    total += count;
  }
  return { total, byTable: counts };
}

function levenshteinDistance(left, right) {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const previous = new Array(right.length + 1);
  const current = new Array(right.length + 1);
  for (let j = 0; j <= right.length; j += 1) previous[j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost,
      );
    }
    for (let j = 0; j <= right.length; j += 1) previous[j] = current[j];
  }

  return previous[right.length];
}

function significantBusinessToken(label) {
  const tokens = normalizeText(label).split(' ').filter(Boolean);
  for (const token of tokens) {
    if (LEADING_PARTICLES.has(token)) continue;
    if (token.length === 1) continue;
    if (GENERIC_BUSINESS_TOKENS.has(token)) continue;
    return token;
  }
  return null;
}

function areLikelySameBusinessToken(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const minLength = Math.min(left.length, right.length);
  const distance = levenshteinDistance(left, right);
  if (left.startsWith('us') && right.startsWith('us') && distance <= 2) return true;
  if (minLength < 3) return false;
  if (minLength === 3) return distance <= 1;
  return distance <= 2 && distance / Math.max(left.length, right.length) <= 0.34;
}

function isLikelyNearDuplicateCandidate(leftCandidate, rightCandidate) {
  const left = leftCandidate.normalizedAccountKey;
  const right = rightCandidate.normalizedAccountKey;
  if (left === right || left.length < 8 || right.length < 8) return false;
  const leftToken = significantBusinessToken(leftCandidate.displayName);
  const rightToken = significantBusinessToken(rightCandidate.displayName);
  if (!areLikelySameBusinessToken(leftToken, rightToken)) return false;
  const lengthDelta = Math.abs(left.length - right.length);
  if (lengthDelta > 3) return false;
  const distance = levenshteinDistance(left, right);
  return distance > 0 && distance <= 2 && distance / Math.max(left.length, right.length) <= 0.18;
}

function collectNearDuplicateClusters(singletonGroups) {
  const parent = new Map(singletonGroups.map(({ normalizedAccountKey }) => [normalizedAccountKey, normalizedAccountKey]));
  const find = (key) => {
    let cursor = key;
    while (parent.get(cursor) !== cursor) {
      cursor = parent.get(cursor);
    }
    let compress = key;
    while (parent.get(compress) !== compress) {
      const next = parent.get(compress);
      parent.set(compress, cursor);
      compress = next;
    }
    return cursor;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };

  for (let i = 0; i < singletonGroups.length; i += 1) {
    for (let j = i + 1; j < singletonGroups.length; j += 1) {
      const left = singletonGroups[i];
      const right = singletonGroups[j];
      if (isLikelyNearDuplicateCandidate(left, right)) union(left.normalizedAccountKey, right.normalizedAccountKey);
    }
  }

  const clusters = new Map();
  for (const group of singletonGroups) {
    const root = find(group.normalizedAccountKey);
    const cluster = clusters.get(root) || [];
    cluster.push(group);
    clusters.set(root, cluster);
  }

  return [...clusters.values()].filter((cluster) => cluster.length > 1);
}

function safeDbFingerprint() {
  const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  const hostParts = url?.hostname ? url.hostname.split('.') : [];
  return {
    targetBaseUrl: process.env.AIT_CRM_BASE_URL || null,
    branchLabel: process.env.AIT_CRM_DB_BRANCH_LABEL || null,
    hostSuffix: hostParts.length ? hostParts.slice(-4).join('.') : null,
    neonHostPrefix: hostParts[0] || null,
    database: url?.pathname ? url.pathname.replace(/^\//, '') : null,
  };
}

async function columnExists(client, tableName, columnName) {
  const result = await client.query(
    `
      select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = $1
          and column_name = $2
      ) as exists
    `,
    [tableName, columnName],
  );
  return Boolean(result.rows[0]?.exists);
}

async function loadAitSignsContacts(client, businessUnit) {
  const result = await client.query(
    `
      select
        c.id,
        c.organization_id,
        c.primary_business_unit_id,
        c.name,
        c.company_name,
        c.phone,
        c.email,
        c.address,
        c.source_label,
        c.is_do_not_call,
        c.is_wrong_number,
        c.created_at,
        c.updated_at
      from contacts c
      join business_units bu on bu.id = c.primary_business_unit_id
      where bu.name = $1
      order by c.created_at asc, c.id asc
    `,
    [businessUnit],
  );
  return result.rows;
}

async function loadLinkCounts(client, contactIds) {
  const linkCounts = new Map();
  if (!contactIds.length) return linkCounts;

  for (const tableName of CONTACT_LINK_TABLES) {
    if (!/^[a-z0-9_]+$/.test(tableName)) throw new Error(`Unsafe table name: ${tableName}`);
    if (!(await columnExists(client, tableName, 'contact_id'))) continue;

    const result = await client.query(
      `
        select contact_id, count(*)::int as count
        from ${tableName}
        where contact_id = any($1::uuid[])
        group by contact_id
      `,
      [contactIds],
    );
    linkCounts.set(tableName, new Map(result.rows.map((row) => [row.contact_id, Number(row.count || 0)])));
  }

  return linkCounts;
}

function contactSummary(row, linkBreakdown) {
  return {
    contactId: row.id,
    displayName: displayNameForContact(row),
    sourceContactName: cleanText(row.name),
    sourceCompanyName: cleanText(row.company_name),
    normalizedAccountKey: compactKey(displayNameForContact(row)),
    hasPhone: Boolean(cleanText(row.phone)),
    hasEmail: Boolean(cleanText(row.email)),
    hasAddress: Boolean(cleanText(row.address)),
    isDoNotCall: Boolean(row.is_do_not_call),
    isWrongNumber: Boolean(row.is_wrong_number),
    sourceLabel: cleanText(row.source_label),
    linkedCount: linkBreakdown.total,
    linkBreakdown: linkBreakdown.byTable,
  };
}

function buildReport(rows, linkCounts, options, dbState) {
  const groups = new Map();
  const reviewContacts = [];

  for (const row of rows) {
    const displayName = displayNameForContact(row);
    const key = compactKey(displayName);
    const linkBreakdown = mapLinkBreakdown(linkCounts, row.id);
    const summary = contactSummary(row, linkBreakdown);
    const reasons = [];

    if (!hasUsableAccountLabel(displayName)) {
      reasons.push('low_signal_or_missing_account_label');
    }
    if (summary.isWrongNumber && summary.linkedCount === 0) {
      reasons.push('wrong_number_without_operational_history');
    }

    if (reasons.length) {
      reviewContacts.push({ ...summary, reasons });
      continue;
    }

    const group = groups.get(key) || [];
    group.push({ row, summary });
    groups.set(key, group);
  }

  const oneToOneCandidates = [];
  const duplicateAccountKeyGroups = [];
  const singletonAccountKeyGroups = [];

  for (const [normalizedAccountKey, group] of groups) {
    if (group.length === 1) {
      const { summary } = group[0];
      singletonAccountKeyGroups.push({
        contactId: summary.contactId,
        displayName: summary.displayName,
        normalizedAccountKey,
        suggestedAccount: {
          displayName: summary.displayName,
          normalizedName: normalizeText(summary.displayName),
          status: 'active',
          sourceContactId: summary.contactId,
        },
        contactSnapshot: summary,
      });
      continue;
    }

    duplicateAccountKeyGroups.push({
      normalizedAccountKey,
      displayNameOptions: [...new Set(group.map(({ summary }) => summary.displayName))].sort(),
      contactCount: group.length,
      linkedCount: group.reduce((sum, { summary }) => sum + summary.linkedCount, 0),
      contacts: group.map(({ summary }) => summary),
      disposition: 'hold_for_reviewed_consolidation',
    });
  }

  const nearDuplicateClusters = collectNearDuplicateClusters(singletonAccountKeyGroups);
  const nearDuplicateKeys = new Set(nearDuplicateClusters.flat().map((candidate) => candidate.normalizedAccountKey));
  const nearDuplicateAccountKeyGroups = nearDuplicateClusters.map((cluster) => ({
    normalizedAccountKeys: cluster.map((candidate) => candidate.normalizedAccountKey).sort(),
    displayNameOptions: cluster.map((candidate) => candidate.displayName).sort(),
    contactCount: cluster.length,
    linkedCount: cluster.reduce((sum, candidate) => sum + candidate.contactSnapshot.linkedCount, 0),
    contacts: cluster.map((candidate) => candidate.contactSnapshot),
    disposition: 'hold_for_near_duplicate_review',
  })).sort((a, b) => {
    if (b.contactCount !== a.contactCount) return b.contactCount - a.contactCount;
    return b.linkedCount - a.linkedCount;
  });

  for (const candidate of singletonAccountKeyGroups) {
    if (!nearDuplicateKeys.has(candidate.normalizedAccountKey)) oneToOneCandidates.push(candidate);
  }

  oneToOneCandidates.sort((a, b) => {
    if (b.contactSnapshot.linkedCount !== a.contactSnapshot.linkedCount) {
      return b.contactSnapshot.linkedCount - a.contactSnapshot.linkedCount;
    }
    return a.displayName.localeCompare(b.displayName);
  });

  duplicateAccountKeyGroups.sort((a, b) => {
    if (b.contactCount !== a.contactCount) return b.contactCount - a.contactCount;
    return b.linkedCount - a.linkedCount;
  });

  reviewContacts.sort((a, b) => {
    if (b.linkedCount !== a.linkedCount) return b.linkedCount - a.linkedCount;
    return a.displayName.localeCompare(b.displayName);
  });

  const candidatesWithHistory = oneToOneCandidates.filter((candidate) => candidate.contactSnapshot.linkedCount > 0);

  return {
    generatedAt: new Date().toISOString(),
    dryRun: true,
    target: {
      businessUnit: options.businessUnit,
      db: safeDbFingerprint(),
    },
    dbState,
    rules: {
      accountLabelSource: 'company_name when present, otherwise contact.name',
      oneToOneCriteria: [
        'normalized account label is usable',
        'normalized account label appears on exactly one current AIT Signs contact',
        'wrong-number contacts without operational history are held for review',
      ],
      heldForLaterSlices: [
        'duplicate/shared account keys',
        'low-signal labels',
        'alias/provenance import',
        'reviewed account consolidations',
      ],
    },
    summary: {
      totalContacts: rows.length,
      usableAccountKeys: groups.size,
      oneToOneCandidates: oneToOneCandidates.length,
      oneToOneCandidatesWithOperationalHistory: candidatesWithHistory.length,
      oneToOneCandidatesWithoutOperationalHistory: oneToOneCandidates.length - candidatesWithHistory.length,
      duplicateAccountKeyGroups: duplicateAccountKeyGroups.length,
      duplicateAccountKeyContacts: duplicateAccountKeyGroups.reduce((sum, group) => sum + group.contactCount, 0),
      nearDuplicateAccountKeyGroups: nearDuplicateAccountKeyGroups.length,
      nearDuplicateAccountKeyContacts: nearDuplicateAccountKeyGroups.reduce((sum, group) => sum + group.contactCount, 0),
      reviewContacts: reviewContacts.length,
    },
    samples: {
      oneToOneCandidates: oneToOneCandidates.slice(0, options.sampleLimit),
      duplicateAccountKeyGroups: duplicateAccountKeyGroups.slice(0, options.sampleLimit),
      nearDuplicateAccountKeyGroups: nearDuplicateAccountKeyGroups.slice(0, options.sampleLimit),
      reviewContacts: reviewContacts.slice(0, options.sampleLimit),
    },
    fullResults: {
      oneToOneCandidates,
      duplicateAccountKeyGroups,
      nearDuplicateAccountKeyGroups,
      reviewContacts,
    },
  };
}

function markdownList(items, formatter, emptyText = 'None in sample.') {
  if (!items.length) return [`- ${emptyText}`];
  return items.map(formatter);
}

function toMarkdown(report) {
  const lines = [
    '# MIS-130 AIT Signs Account Backfill Dry Run',
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
    `- Contacts client account column exists in DB: ${report.dbState.contactsClientAccountColumnExists ? 'yes' : 'no'}`,
    '',
    '## Counts',
    '',
    `- Total AIT Signs contacts: ${report.summary.totalContacts}`,
    `- One-to-one account candidates: ${report.summary.oneToOneCandidates}`,
    `- One-to-one candidates with operational history: ${report.summary.oneToOneCandidatesWithOperationalHistory}`,
    `- One-to-one candidates without operational history: ${report.summary.oneToOneCandidatesWithoutOperationalHistory}`,
    `- Duplicate/shared account-key groups held for consolidation: ${report.summary.duplicateAccountKeyGroups}`,
    `- Contacts inside duplicate/shared groups: ${report.summary.duplicateAccountKeyContacts}`,
    `- Near-duplicate account-key groups held for review: ${report.summary.nearDuplicateAccountKeyGroups}`,
    `- Contacts inside near-duplicate groups: ${report.summary.nearDuplicateAccountKeyContacts}`,
    `- Contacts held for review before account creation: ${report.summary.reviewContacts}`,
    '',
    '## Rules',
    '',
    '- Account label source: `company_name` when present, otherwise `contacts.name`.',
    '- A row is one-to-one only when its normalized account key is usable and unique within AIT Signs.',
    '- Exact-unique rows are still held when their account key is a likely near-duplicate of another account key.',
    '- Duplicate/shared keys stay out of this slice and should go through reviewed consolidation.',
    '- This report does not import visible aliases or re-add cleaned misspellings.',
    '',
    '## One-To-One Sample',
    '',
    ...markdownList(report.samples.oneToOneCandidates, (candidate) => (
      `- ${candidate.displayName} (${candidate.contactId}) — linked rows: ${candidate.contactSnapshot.linkedCount}`
    )),
    '',
    '## Duplicate/Consolidation Sample',
    '',
    ...markdownList(report.samples.duplicateAccountKeyGroups, (group) => (
      `- ${group.displayNameOptions.join(' / ')} — contacts: ${group.contactCount}, linked rows: ${group.linkedCount}, key: ${group.normalizedAccountKey}`
    )),
    '',
    '## Near-Duplicate Review Sample',
    '',
    ...markdownList(report.samples.nearDuplicateAccountKeyGroups, (group) => (
      `- ${group.displayNameOptions.join(' / ')} — contacts: ${group.contactCount}, linked rows: ${group.linkedCount}, keys: ${group.normalizedAccountKeys.join(', ')}`
    )),
    '',
    '## Review Sample',
    '',
    ...markdownList(report.samples.reviewContacts, (contact) => (
      `- ${contact.displayName || '(blank)'} (${contact.contactId}) — reasons: ${contact.reasons.join(', ')}, linked rows: ${contact.linkedCount}`
    )),
    '',
    '## Next Step',
    '',
    'Use this report to review the one-to-one candidate count and sample. Applying the schema migration and any account inserts should remain a separate approval-gated DB write.',
    '',
  ];
  return lines.join('\n');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

async function main() {
  const options = parseArgs(process.argv);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query('begin transaction read only');
    const dbState = {
      currentDatabase: (await client.query('select current_database() as name')).rows[0]?.name || null,
      contactsClientAccountColumnExists: await columnExists(client, 'contacts', 'client_account_id'),
    };
    const rows = await loadAitSignsContacts(client, options.businessUnit);
    const linkCounts = await loadLinkCounts(client, rows.map((row) => row.id));
    const report = buildReport(rows, linkCounts, options, dbState);
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

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
