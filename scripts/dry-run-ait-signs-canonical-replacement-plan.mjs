#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'pg';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_WORKBOOK_CANDIDATES = [
  '/root/.openclaw/media/inbound/AiT_15_SIGNS_WORK-ESTIMATES---adcfba27-3c56-4bec-99ab-b5e05165f79d.xlsx',
  '/root/.openclaw/giuseppe-workspace/tmp/ait-usa-profile/AiT.15.SIGNS.WORK-ESTIMATES.1.xlsx',
];
const DEFAULT_OUTPUT = 'docs/mis-145-ait-signs-canonical-replacement-plan-dryrun.json';
const DEFAULT_MARKDOWN = 'docs/mis-145-ait-signs-canonical-replacement-plan-dryrun.md';
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
    sampleLimit: 25,
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

function uniqueBy(items, keyFn) {
  return [...new Map(items.map((item) => [keyFn(item), item])).values()];
}

function sortCounts(counts) {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return sortCounts(counts);
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
      rawClientNames: new Set(),
    };
    group.rawClientNames.add(clientName);
    group.sheets.add(record.sourceSheet);
    group.recordTypes.add(record.recordType);
    const phone = phoneDigits(proposal.phoneHint);
    group.sourceRows.push({
      sheet: record.sourceSheet,
      row: record.sourceRowNumber,
      recordType: record.recordType,
      statusHint: proposal.statusHint || null,
      totalAmountHint: cleanText(proposal.totalAmountHint || proposal.moneyHint) || null,
      contactName: cleanText(proposal.contactName),
      phoneHint: phone,
      workDescription: cleanText(proposal.workDescription),
    });
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
          + (select count(*) from conversation_messages cm where cm.contact_id = c.id)
          + (select count(*) from follow_up_sequence_enrollments fse where fse.contact_id = c.id)
          + (select count(*) from follow_up_sequence_step_runs fssr where fssr.contact_id = c.id)
          + (select count(*) from contact_people cp where cp.contact_id = c.id)
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

async function loadExistingPeople(client, contacts) {
  if (!contacts.length) return new Map();
  const result = await client.query(
    `
      select contact_id, name, phone, email, is_primary
      from contact_people
      where contact_id = any($1::uuid[])
    `,
    [contacts.map((contact) => contact.id)],
  );
  const byContact = new Map();
  for (const row of result.rows) {
    addToMapArray(byContact, row.contact_id, row);
  }
  return byContact;
}

function compareCandidatesToContacts(candidateGroups, contacts, existingPeopleByContact) {
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
  const candidateTargetsByContact = new Map();
  const compared = candidateGroups.map((group) => {
    const exactMatches = uniqueBy(contactsByName.get(group.normalizedClientName) || [], (contact) => contact.id);
    const phoneMatches = group.phoneHints.flatMap((phone) => contactsByPhone.get(phone) || []);
    const dedupedPhoneMatches = uniqueBy(phoneMatches, (contact) => contact.id);
    const matches = exactMatches.length ? exactMatches : dedupedPhoneMatches;
    let action = 'create_new_candidate';
    let confidence = 'medium';
    let reason = 'No current AIT Signs contact matched by exact name or phone.';
    if (exactMatches.length === 1) {
      action = 'safe_reuse_existing_contact';
      confidence = 'high';
      reason = 'One exact normalized current-contact match.';
    } else if (exactMatches.length > 1) {
      action = 'hold_ambiguous_name';
      confidence = 'blocked';
      reason = 'Multiple current contacts share the candidate normalized name.';
    } else if (dedupedPhoneMatches.length === 1) {
      action = 'review_phone_remap';
      confidence = 'review';
      reason = 'One current contact matched by phone only; requires human review before relabel/remap.';
    } else if (dedupedPhoneMatches.length > 1) {
      action = 'hold_ambiguous_phone';
      confidence = 'blocked';
      reason = 'Multiple current contacts share candidate phone evidence.';
    }

    for (const contact of matches) {
      matchedContactIds.add(contact.id);
      addToMapArray(candidateTargetsByContact, contact.id, {
        clientName: group.displayName,
        action,
        sourceRowCount: group.sourceRows.length,
      });
    }

    const targetContactId = matches.length === 1 ? matches[0].id : null;
    const existingPeople = targetContactId
      ? new Set((existingPeopleByContact.get(targetContactId) || []).map((person) => normalizeName(person.name)))
      : new Set();
    const plannedPeople = group.people.map((person, index) => ({
      name: person.name,
      evidenceCount: person.evidenceCount,
      sourceRows: person.sourceRows.slice(0, 12),
      phoneHints: person.phoneHints,
      wouldInsert: !existingPeople.has(normalizeName(person.name)),
      isPrimaryCandidate: index === 0,
    }));

    return {
      clientName: group.displayName,
      normalizedClientName: group.normalizedClientName,
      action,
      confidence,
      reason,
      sourceRowCount: group.sourceRows.length,
      sheets: group.sheets,
      recordTypes: group.recordTypes,
      phoneHints: group.phoneHints,
      rawClientNames: group.rawClientNames,
      plannedPeople,
      currentMatches: matches.map((contact) => ({
        id: contact.id,
        name: contact.name,
        companyName: contact.company_name,
        phonePresent: Boolean(phoneDigits(contact.phone)),
        sourceLabel: contact.source_label,
        linkedOperationalRows: contact.linked_operational_rows,
      })),
      applyPlan: action === 'safe_reuse_existing_contact'
        ? 'Reuse existing contact id; backfill missing linked people/contact points from workbook evidence.'
        : action === 'create_new_candidate'
          ? 'Create new AIT Signs contact/client candidate and attach workbook people after apply approval.'
          : 'Hold for human remap/consolidation decision before any write.',
    };
  });

  const contactTargetCollisions = [...candidateTargetsByContact.entries()]
    .map(([contactId, targets]) => ({
      contactId,
      currentContact: contacts.find((contact) => contact.id === contactId)?.name || '',
      candidateCount: targets.length,
      candidates: targets.slice(0, 15),
    }))
    .filter((item) => item.candidateCount > 1)
    .sort((a, b) => b.candidateCount - a.candidateCount || a.currentContact.localeCompare(b.currentContact));

  const currentContactsWithoutCandidate = contacts.filter((contact) => !matchedContactIds.has(contact.id));
  return { compared, matchedContactIds, currentContactsWithoutCandidate, contactTargetCollisions };
}

function sumPeople(candidates, predicate) {
  return candidates
    .filter(predicate)
    .reduce((sum, candidate) => sum + candidate.plannedPeople.length, 0);
}

function sumSourceRows(candidates, predicate) {
  return candidates
    .filter(predicate)
    .reduce((sum, candidate) => sum + candidate.sourceRowCount, 0);
}

function sumLinkedRows(contacts) {
  return contacts.reduce((sum, contact) => sum + Number(contact.linked_operational_rows || contact.linkedOperationalRows || 0), 0);
}

function exampleGroups(compared) {
  const wanted = [
    ['Blue Mountain', /blue mountain/i],
    ['G&R / RG Tree', /\b(g\s*(and|&)?\s*r|rg)\s*tree/i],
    ['World Supermarket / Market', /world\s+(supermarket|market)|\bwold\b|\bword\b/i],
  ];
  return wanted.map(([label, pattern]) => ({
    label,
    candidates: compared
      .filter((item) => pattern.test(item.clientName) || pattern.test(item.normalizedClientName))
      .slice(0, 10),
  }));
}

function publicCandidate(candidate) {
  return {
    clientName: candidate.clientName,
    action: candidate.action,
    confidence: candidate.confidence,
    sourceRowCount: candidate.sourceRowCount,
    phoneHintCount: candidate.phoneHints.length,
    plannedPeople: candidate.plannedPeople.slice(0, 8),
    currentMatches: candidate.currentMatches,
    reason: candidate.reason,
    applyPlan: candidate.applyPlan,
  };
}

function renderMarkdown(report) {
  const lines = [
    '# MIS-145 AIT Signs Canonical Replacement Plan Dry Run',
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
    `- Workbook candidate clients: ${report.summary.candidateClients}`,
    `- Workbook target records reviewed: ${report.summary.targetWorkbookRecords}`,
    `- Safe exact-reuse candidates: ${report.summary.actionCounts.safe_reuse_existing_contact || 0}`,
    `- Phone-only remap review candidates: ${report.summary.actionCounts.review_phone_remap || 0}`,
    `- New client/contact candidates: ${report.summary.actionCounts.create_new_candidate || 0}`,
    `- Ambiguous hold candidates: ${(report.summary.actionCounts.hold_ambiguous_name || 0) + (report.summary.actionCounts.hold_ambiguous_phone || 0)}`,
    `- Current contacts with no workbook candidate: ${report.summary.currentContactsWithoutCandidate}`,
    `- Linked operational rows on no-candidate contacts: ${report.summary.linkedRowsWithoutCandidate}`,
    `- Current contacts targeted by multiple workbook candidates: ${report.summary.contactTargetCollisions}`,
    '',
    '## Linked People Plan',
    '',
    `- Safe linked people inserts/updates from exact matches: ${report.summary.peoplePlan.safeExactPeople}`,
    `- Linked people held behind phone-remap review: ${report.summary.peoplePlan.phoneReviewPeople}`,
    `- Linked people for new candidates: ${report.summary.peoplePlan.newCandidatePeople}`,
    `- Linked people blocked by ambiguity: ${report.summary.peoplePlan.ambiguousPeople}`,
    '',
    '## Verdict',
    '',
    ...report.verdict.map((item) => `- ${item}`),
    '',
    '## Phased Apply Recommendation',
    '',
    ...report.applyPhases.map((item) => `- ${item}`),
    '',
    '## Examples',
    '',
  ];

  for (const group of report.examples) {
    lines.push(`### ${group.label}`, '');
    if (!group.candidates.length) {
      lines.push('- No workbook candidate found.', '');
      continue;
    }
    for (const candidate of group.candidates) {
      const matches = candidate.currentMatches.map((match) => `${match.name} (${match.linkedOperationalRows} linked rows)`).join('; ') || 'none';
      const people = candidate.plannedPeople.map((person) => `${person.name} x${person.evidenceCount}`).join(', ') || 'none';
      lines.push(`- ${candidate.clientName}: ${candidate.action}; source rows ${candidate.sourceRowCount}; matches: ${matches}; people: ${people}`);
    }
    lines.push('');
  }

  lines.push('## No Writes', '');
  lines.push('- This command generated a plan only. It did not insert, update, delete, archive, or remap CRM data.');
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
  const existingPeopleByContact = await loadExistingPeople(client, contacts);
  await client.end();

  const comparison = compareCandidatesToContacts(groups, contacts, existingPeopleByContact);
  const compared = comparison.compared;
  const actionCounts = countBy(compared, (candidate) => candidate.action);
  const targetWorkbookRecords = Object.values(sheetStats).reduce((sum, stats) => sum + stats.normalizedRecords, 0);
  const noCandidateContacts = comparison.currentContactsWithoutCandidate.map((contact) => ({
    id: contact.id,
    name: contact.name,
    phonePresent: Boolean(phoneDigits(contact.phone)),
    sourceLabel: contact.source_label,
    linkedOperationalRows: contact.linked_operational_rows,
    recommendation: contact.linked_operational_rows > 0
      ? 'Review before archive/remap; this contact still owns operational history.'
      : 'Archive/delete candidate after export if no employee-visible need remains.',
  }));
  const ambiguousCandidates = compared.filter((candidate) => candidate.action.startsWith('hold_ambiguous'));
  const phoneReviewCandidates = compared.filter((candidate) => candidate.action === 'review_phone_remap');
  const newCandidates = compared.filter((candidate) => candidate.action === 'create_new_candidate');
  const safeCandidates = compared.filter((candidate) => candidate.action === 'safe_reuse_existing_contact');

  const verdict = [
    'Do not run a destructive AIT Signs reset from this dry-run alone.',
    'The safe first apply slice is exact-match linked-people backfill, because it preserves existing contact ids and operational links.',
    'Phone-only remaps need human review before relabeling or consolidating contacts.',
    'No-candidate current contacts must be exported and reviewed before archive/delete because some still own linked operational rows.',
  ];

  const applyPhases = [
    `Phase 1: exact-match repair only - reuse ${safeCandidates.length} current contacts and backfill ${sumPeople(compared, (candidate) => candidate.action === 'safe_reuse_existing_contact')} linked people/contact points.`,
    `Phase 2: phone-remap review - inspect ${phoneReviewCandidates.length} workbook candidates and ${comparison.contactTargetCollisions.length} current contacts targeted by multiple candidates.`,
    `Phase 3: create-new candidates - add ${newCandidates.length} workbook clients that have no current contact match after review.`,
    `Phase 4: archive/remap review - decide what to do with ${noCandidateContacts.length} current contacts that do not appear in the workbook candidate feed.`,
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    issue: 'MIS-145',
    businessUnit: options.businessUnit,
    safeFingerprint: await safeDbFingerprint(),
    workbook: {
      path: workbookPath,
      hash: artifact.workbookFileHash,
      targetSheets: [...TARGET_SHEETS],
    },
    summary: {
      currentContacts: contacts.length,
      candidateClients: groups.length,
      targetWorkbookRecords,
      actionCounts,
      matchedCurrentContacts: comparison.matchedContactIds.size,
      currentContactsWithoutCandidate: noCandidateContacts.length,
      linkedRowsWithoutCandidate: sumLinkedRows(noCandidateContacts),
      contactTargetCollisions: comparison.contactTargetCollisions.length,
      sourceRowsByAction: sortCounts({
        safe_reuse_existing_contact: sumSourceRows(compared, (candidate) => candidate.action === 'safe_reuse_existing_contact'),
        review_phone_remap: sumSourceRows(compared, (candidate) => candidate.action === 'review_phone_remap'),
        create_new_candidate: sumSourceRows(compared, (candidate) => candidate.action === 'create_new_candidate'),
        hold_ambiguous: sumSourceRows(compared, (candidate) => candidate.action.startsWith('hold_ambiguous')),
      }),
      peoplePlan: {
        safeExactPeople: sumPeople(compared, (candidate) => candidate.action === 'safe_reuse_existing_contact'),
        phoneReviewPeople: sumPeople(compared, (candidate) => candidate.action === 'review_phone_remap'),
        newCandidatePeople: sumPeople(compared, (candidate) => candidate.action === 'create_new_candidate'),
        ambiguousPeople: sumPeople(compared, (candidate) => candidate.action.startsWith('hold_ambiguous')),
      },
    },
    sheetStats,
    verdict,
    applyPhases,
    examples: exampleGroups(compared),
    samples: {
      safeExactReuse: safeCandidates.slice(0, options.sampleLimit).map(publicCandidate),
      phoneRemapReview: phoneReviewCandidates.slice(0, options.sampleLimit).map(publicCandidate),
      newCandidates: newCandidates.slice(0, options.sampleLimit).map(publicCandidate),
      ambiguousCandidates: ambiguousCandidates.slice(0, options.sampleLimit).map(publicCandidate),
      currentContactsWithoutCandidate: noCandidateContacts.slice(0, options.sampleLimit),
      contactTargetCollisions: comparison.contactTargetCollisions.slice(0, options.sampleLimit),
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export {
  buildWorkbookCandidates,
  cleanText,
  compareCandidatesToContacts,
  loadCurrentContacts,
  loadExistingPeople,
  loadWorkbookArtifact,
  normalizeName,
  phoneDigits,
  resolveWorkbook,
  safeDbFingerprint,
};
