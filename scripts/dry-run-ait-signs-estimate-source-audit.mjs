#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_WORKBOOK_CANDIDATES = [
  '/root/.openclaw/media/inbound/AiT_15_SIGNS_WORK-ESTIMATES---adcfba27-3c56-4bec-99ab-b5e05165f79d.xlsx',
  '/root/.openclaw/giuseppe-workspace/tmp/ait-usa-profile/AiT.15.SIGNS.WORK-ESTIMATES.1.xlsx',
];
const DEFAULT_OUTPUT = 'docs/mis-142-ait-signs-estimate-source-audit.json';
const DEFAULT_MARKDOWN = 'docs/mis-142-ait-signs-estimate-source-audit.md';
const TARGET_SHEETS = new Set([
  '2. ESTIMADOS',
  '3. 15 SIGNS WORK ORDER',
  'WORK ORDER TERMINADOS Y PAGADOS',
]);
const TARGET_RECORD_TYPES = new Set(['estimate', 'work_order']);

function parseArgs(argv) {
  const options = {
    workbook: null,
    output: DEFAULT_OUTPUT,
    markdown: DEFAULT_MARKDOWN,
    businessUnit: 'AIT Signs',
    sampleLimit: 20,
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
    } else if (arg === '--business-unit') {
      options.businessUnit = argv[index + 1];
      index += 1;
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

function resolveWorkbook(explicitPath) {
  if (explicitPath) return explicitPath;
  const candidate = DEFAULT_WORKBOOK_CANDIDATES.find((item) => existsSync(item));
  if (!candidate) {
    throw new Error(`No workbook found. Pass --workbook or restore one of: ${DEFAULT_WORKBOOK_CANDIDATES.join(', ')}`);
  }
  return candidate;
}

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeName(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compactKey(value) {
  return normalizeName(value).replace(/\s+/g, '');
}

function phoneDigits(value) {
  const digits = cleanText(value).replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return '';
}

function proposalFor(record) {
  return (
    record.proposedEstimateJson
    || record.proposedWorkOrderJson
    || record.proposedPaymentJson
    || record.proposedLeadJson
    || record.proposedContactJson
    || record.proposedNoteJson
    || {}
  );
}

function invalidPersonReason(name, clientName) {
  const value = cleanText(name);
  if (!value) return 'missing';
  if (value.length < 2 || value.length > 80) return 'out_of_range';
  if (/[0-9@$]/.test(value)) return 'contains_non_name_token';
  const key = compactKey(value);
  if (!key || key.length < 2) return 'empty_normalized_name';
  if (key === compactKey(clientName)) return 'same_as_client';
  const lower = normalizeName(value);
  const blocked = new Set([
    'cliente',
    'customer',
    'contacto',
    'owner',
    'manager',
    'persona',
    'pendiente',
    'unknown',
    'desconocido',
    'sin nombre',
    'na',
    'n a',
  ]);
  if (blocked.has(lower)) return 'generic_token';
  if (/(llamar|contest|entreg|pagad|estimate|estimado|work order|invoice|balance|deposit|truck|sign|banner|card|printing)/i.test(value)) {
    return 'looks_like_status_or_work_description';
  }
  return '';
}

function loadWorkbookArtifact(workbookPath) {
  const python = `
import json
import sys
from ait_signs_xlsx import load_workbook_profile, build_staging_artifact
workbook_path = sys.argv[1]
report = load_workbook_profile(workbook_path)
payload = build_staging_artifact(report, workbook_path)
print(json.dumps(payload))
`;
  const stdout = execFileSync('python3', ['-c', python, workbookPath], {
    cwd: REPO_ROOT,
    env: { ...process.env, PYTHONPATH: SCRIPT_DIR },
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function addToMapArray(map, key, value) {
  const list = map.get(key) || [];
  list.push(value);
  map.set(key, list);
}

function uniqueContacts(contacts) {
  return [...new Map(contacts.map((contact) => [contact.id, contact])).values()];
}

function buildWorkbookCandidates(artifact) {
  const groups = new Map();
  const sheetStats = new Map();

  for (const record of artifact.normalizedRecords || []) {
    if (!TARGET_SHEETS.has(record.sourceSheet) || !TARGET_RECORD_TYPES.has(record.recordType)) continue;
    const proposal = proposalFor(record);
    const clientName = cleanText(proposal.customerName || proposal.contactHint);
    const sheet = sheetStats.get(record.sourceSheet) || {
      normalizedRecords: 0,
      rowsWithClientName: 0,
      rowsWithContactColumn: 0,
      rowsWithValidPerson: 0,
      rowsWithPhone: 0,
    };
    sheet.normalizedRecords += 1;
    if (clientName) sheet.rowsWithClientName += 1;
    if (cleanText(proposal.contactName)) sheet.rowsWithContactColumn += 1;
    if (!invalidPersonReason(proposal.contactName, clientName)) sheet.rowsWithValidPerson += 1;
    if (phoneDigits(proposal.phoneHint)) sheet.rowsWithPhone += 1;
    sheetStats.set(record.sourceSheet, sheet);
    if (!clientName) continue;

    const normalizedClientName = normalizeName(clientName);
    if (!normalizedClientName) continue;
    const group = groups.get(normalizedClientName) || {
      normalizedClientName,
      displayName: clientName,
      sourceRows: [],
      sheets: new Set(),
      recordTypes: new Set(),
      phoneHints: new Set(),
      people: new Map(),
      totalAmountHints: [],
      rawClientNames: new Set(),
    };
    group.rawClientNames.add(clientName);
    group.sheets.add(record.sourceSheet);
    group.recordTypes.add(record.recordType);
    group.sourceRows.push({
      sheet: record.sourceSheet,
      row: record.sourceRowNumber,
      recordType: record.recordType,
      statusHint: proposal.statusHint || null,
      totalAmountHint: proposal.totalAmountHint || proposal.moneyHint || null,
      contactName: cleanText(proposal.contactName),
      phoneHint: phoneDigits(proposal.phoneHint),
      workDescription: cleanText(proposal.workDescription),
    });
    const phone = phoneDigits(proposal.phoneHint);
    if (phone) group.phoneHints.add(phone);
    const personName = cleanText(proposal.contactName);
    if (!invalidPersonReason(personName, clientName)) {
      const personKey = normalizeName(personName);
      const person = group.people.get(personKey) || {
        name: personName,
        evidenceCount: 0,
        sourceRows: [],
        phoneHints: new Set(),
      };
      person.evidenceCount += 1;
      person.sourceRows.push(`${record.sourceSheet}#${record.sourceRowNumber}`);
      if (phone) person.phoneHints.add(phone);
      group.people.set(personKey, person);
    }
    const amount = cleanText(proposal.totalAmountHint || proposal.moneyHint);
    if (amount) group.totalAmountHints.push(amount);
    groups.set(normalizedClientName, group);
  }

  return {
    groups: [...groups.values()].map((group) => ({
      ...group,
      sheets: [...group.sheets].sort(),
      recordTypes: [...group.recordTypes].sort(),
      phoneHints: [...group.phoneHints].sort(),
      people: [...group.people.values()].map((person) => ({
        ...person,
        phoneHints: [...person.phoneHints].sort(),
      })).sort((a, b) => b.evidenceCount - a.evidenceCount || a.name.localeCompare(b.name)),
      rawClientNames: [...group.rawClientNames].sort(),
    })).sort((a, b) => b.sourceRows.length - a.sourceRows.length || a.displayName.localeCompare(b.displayName)),
    sheetStats: Object.fromEntries([...sheetStats.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

async function safeDbFingerprint() {
  let secretFingerprint = null;
  try {
    const secrets = JSON.parse(await readFile('/root/.openclaw/secrets.json', 'utf8'));
    const staging = secrets.aitCrm?.staging;
    if (staging) {
      const url = new URL(staging.databaseUrl);
      secretFingerprint = {
        targetBaseUrl: staging.baseUrl,
        expectedNeonBranchId: staging.neonBranchId,
        hostPrefix: url.hostname.split('.')[0],
        hostSuffix: url.hostname.split('.').slice(-3).join('.'),
        databaseParam: url.pathname.replace(/^\//, ''),
      };
    }
  } catch {
    secretFingerprint = null;
  }
  return secretFingerprint;
}

async function loadCurrentContacts(client, businessUnit) {
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
        c.created_at,
        c.updated_at,
        (
          (select count(*) from leads l where l.contact_id = c.id)
          + (select count(*) from estimates e where e.contact_id = c.id)
          + (select count(*) from work_orders wo where wo.contact_id = c.id)
          + (
            select count(*)
            from payment_snapshots ps
            left join estimates pse on pse.id = ps.estimate_id
            left join work_orders pswo on pswo.id = ps.work_order_id
            where pse.contact_id = c.id or pswo.contact_id = c.id
          )
          + (select count(*) from tasks t where t.contact_id = c.id)
          + (select count(*) from activity_events ae where ae.contact_id = c.id)
          + (select count(*) from notes n where n.contact_id = c.id)
          + (select count(*) from conversations conv where conv.contact_id = c.id)
        )::int as linked_operational_rows
      from contacts c
      join business_units bu on bu.id = c.primary_business_unit_id
      where bu.name = $1
      order by c.name, c.id
    `,
    [businessUnit],
  );
  return result.rows;
}

function compareCandidatesToContacts(candidateGroups, contacts) {
  const contactsByName = new Map();
  const contactsByPhone = new Map();
  for (const contact of contacts) {
    for (const name of [contact.name, contact.company_name]) {
      const key = normalizeName(name);
      if (key) addToMapArray(contactsByName, key, contact);
    }
    const phone = phoneDigits(contact.phone);
    if (phone) addToMapArray(contactsByPhone, phone, contact);
  }

  const matchedContactIds = new Set();
  const compared = candidateGroups.map((group) => {
    const exactMatches = uniqueContacts(contactsByName.get(group.normalizedClientName) || []);
    const phoneMatches = group.phoneHints.flatMap((phone) => contactsByPhone.get(phone) || []);
    const dedupedPhoneMatches = uniqueContacts(phoneMatches);
    const matches = exactMatches.length ? exactMatches : dedupedPhoneMatches;
    for (const contact of matches) matchedContactIds.add(contact.id);
    let matchClass = 'unmatched';
    if (exactMatches.length === 1) matchClass = 'exact_name';
    else if (exactMatches.length > 1) matchClass = 'ambiguous_name';
    else if (dedupedPhoneMatches.length === 1) matchClass = 'phone_only';
    else if (dedupedPhoneMatches.length > 1) matchClass = 'ambiguous_phone';
    return {
      clientName: group.displayName,
      normalizedClientName: group.normalizedClientName,
      matchClass,
      sourceRowCount: group.sourceRows.length,
      sheets: group.sheets,
      phoneHints: group.phoneHints,
      people: group.people.slice(0, 8),
      currentMatches: matches.map((contact) => ({
        id: contact.id,
        name: contact.name,
        phonePresent: Boolean(phoneDigits(contact.phone)),
        sourceLabel: contact.source_label,
        linkedOperationalRows: contact.linked_operational_rows,
      })),
    };
  });

  const currentContactsWithoutCandidate = contacts.filter((contact) => !matchedContactIds.has(contact.id));
  const matchCounts = compared.reduce((acc, item) => {
    acc[item.matchClass] = (acc[item.matchClass] || 0) + 1;
    return acc;
  }, {});

  return {
    compared,
    matchCounts,
    matchedCurrentContacts: matchedContactIds.size,
    currentContactsWithoutCandidate: currentContactsWithoutCandidate.map((contact) => ({
      id: contact.id,
      name: contact.name,
      phonePresent: Boolean(phoneDigits(contact.phone)),
      sourceLabel: contact.source_label,
      linkedOperationalRows: contact.linked_operational_rows,
    })),
  };
}

function exampleGroups(compared) {
  const wanted = [
    ['Blue Mountain', /blue mountain/i],
    ['G&R / RG Tree', /\b(g\s*(and|&)?\s*r|rg)\s*tree/i],
    ['World Supermarket / Market', /world\s+(supermarket|market)/i],
  ];
  return wanted.map(([label, pattern]) => ({
    label,
    candidates: compared
      .filter((item) => pattern.test(item.clientName) || pattern.test(item.normalizedClientName))
      .slice(0, 8),
  }));
}

function renderMarkdown(report) {
  const lines = [
    '# MIS-142 AIT Signs Estimate Source Audit',
    '',
    `- Generated at: ${report.generatedAt}`,
    `- Workbook: ${report.workbook.path}`,
    `- Workbook hash: ${report.workbook.hash}`,
    `- Business unit: ${report.businessUnit}`,
    `- Target base URL: ${report.safeFingerprint?.targetBaseUrl || 'unknown'}`,
    `- Neon branch id: ${report.safeFingerprint?.expectedNeonBranchId || 'unknown'}`,
    '',
    '## Summary',
    '',
    `- Current AIT Signs contacts: ${report.summary.currentContacts}`,
    `- Target workbook records reviewed: ${report.summary.targetWorkbookRecords}`,
    `- Candidate clients from target sheets: ${report.summary.candidateClients}`,
    `- Candidate linked people from contact column: ${report.summary.candidatePeople}`,
    `- Candidate clients with exact current contact match: ${report.summary.matchCounts.exact_name || 0}`,
    `- Candidate clients with phone-only match: ${report.summary.matchCounts.phone_only || 0}`,
    `- Candidate clients unmatched in current contacts: ${report.summary.matchCounts.unmatched || 0}`,
    `- Ambiguous candidate matches: ${(report.summary.matchCounts.ambiguous_name || 0) + (report.summary.matchCounts.ambiguous_phone || 0)}`,
    `- Current contacts without workbook candidate match: ${report.summary.currentContactsWithoutCandidate}`,
    '',
    '## Sheet Contact Column Signal',
    '',
  ];

  for (const [sheet, stats] of Object.entries(report.sheetStats)) {
    lines.push(
      `- ${sheet}: ${stats.normalizedRecords} target records; ` +
      `${stats.rowsWithClientName} with customer; ${stats.rowsWithContactColumn} with contact column; ` +
      `${stats.rowsWithValidPerson} valid person candidates; ${stats.rowsWithPhone} with phone.`,
    );
  }

  lines.push('', '## Interpretation', '');
  lines.push(...report.interpretation.map((item) => `- ${item}`));
  lines.push('', '## Examples', '');
  for (const group of report.examples) {
    lines.push(`### ${group.label}`, '');
    if (!group.candidates.length) {
      lines.push('- No workbook candidate found.', '');
      continue;
    }
    for (const candidate of group.candidates) {
      const matches = candidate.currentMatches.map((match) => `${match.name} (${match.linkedOperationalRows} linked rows)`).join('; ') || 'none';
      const people = candidate.people.map((person) => `${person.name} x${person.evidenceCount}`).join(', ') || 'none';
      lines.push(`- ${candidate.clientName}: ${candidate.matchClass}; source rows ${candidate.sourceRowCount}; matches: ${matches}; people: ${people}`);
    }
    lines.push('');
  }

  lines.push('## Next Step', '');
  lines.push('- Use this report to decide whether the estimate/work-order workbook should repair current AIT Signs contacts or drive a staging-only canonical replacement dry-run.');
  lines.push('- No data was written by this audit.');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv);
  const workbookPath = resolveWorkbook(options.workbook);
  const artifact = loadWorkbookArtifact(workbookPath);
  const { groups, sheetStats } = buildWorkbookCandidates(artifact);

  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const contacts = await loadCurrentContacts(client, options.businessUnit);
  await client.end();

  const comparison = compareCandidatesToContacts(groups, contacts);
  const candidatePeople = groups.reduce((sum, group) => sum + group.people.length, 0);
  const targetWorkbookRecords = Object.values(sheetStats).reduce((sum, stats) => sum + stats.normalizedRecords, 0);
  const currentContactsWithoutCandidate = comparison.currentContactsWithoutCandidate.length;
  const linkedRowsWithoutCandidate = comparison.currentContactsWithoutCandidate.reduce((sum, contact) => sum + contact.linkedOperationalRows, 0);
  const interpretation = [
    'Paid/finished and work-order sheets have enough structure to become the source-of-truth candidate feed.',
    'The workbook contact column should feed linked people/contact points, not replace the client display name.',
    'Do not delete current AIT Signs data from this report alone; use a replacement/remap dry-run so operational rows stay attached.',
  ];
  if (currentContactsWithoutCandidate > 0) {
    interpretation.push(`${currentContactsWithoutCandidate} current AIT Signs contacts do not have an exact/phone candidate match yet, covering ${linkedRowsWithoutCandidate} linked operational rows. These need remap/archive decisions before replacement.`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    issue: 'MIS-142',
    businessUnit: options.businessUnit,
    safeFingerprint: await safeDbFingerprint(),
    workbook: {
      path: workbookPath,
      hash: artifact.workbookFileHash,
      targetSheets: [...TARGET_SHEETS],
    },
    summary: {
      currentContacts: contacts.length,
      targetWorkbookRecords,
      candidateClients: groups.length,
      candidatePeople,
      matchCounts: comparison.matchCounts,
      matchedCurrentContacts: comparison.matchedCurrentContacts,
      currentContactsWithoutCandidate,
      linkedRowsWithoutCandidate,
    },
    sheetStats,
    interpretation,
    examples: exampleGroups(comparison.compared),
    samples: {
      unmatchedCandidates: comparison.compared.filter((item) => item.matchClass === 'unmatched').slice(0, options.sampleLimit),
      ambiguousCandidates: comparison.compared.filter((item) => item.matchClass.startsWith('ambiguous')).slice(0, options.sampleLimit),
      currentContactsWithoutCandidate: comparison.currentContactsWithoutCandidate.slice(0, options.sampleLimit),
      highEvidencePeople: groups
        .flatMap((group) => group.people.map((person) => ({
          clientName: group.displayName,
          personName: person.name,
          evidenceCount: person.evidenceCount,
          sourceRows: person.sourceRows.slice(0, 8),
        })))
        .sort((a, b) => b.evidenceCount - a.evidenceCount || a.clientName.localeCompare(b.clientName))
        .slice(0, options.sampleLimit),
    },
  };

  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(options.markdown, renderMarkdown(report));
  console.log(JSON.stringify({
    output: options.output,
    markdown: options.markdown,
    summary: report.summary,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
