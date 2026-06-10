import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import {
  WORKFLOW_KEYS,
  lifecycleWorkflowForKey,
  workflowKeyForBusinessUnit,
} from '../src/lib/crm/lifecycle.js';
import {
  isPipelineEligibleContact,
  workflowFromLead,
} from '../src/lib/sales-workflow.js';
import { summarizeContactTouch } from '../src/lib/contact-touch.js';
import { buildAitUsaEnrollmentSignals } from '../src/lib/ait-usa-enrollment-signals.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const DOC_PATH = path.join(repoRoot, 'docs/mis-184-status-task-readiness.md');
const JSON_PATH = path.join(repoRoot, 'docs/mis-184-status-task-readiness.json');
const CSV_PATH = path.join(repoRoot, 'docs/mis-184-task-activation-candidates.csv');
const RECENT_FOLLOW_UP_START = '2026-01-01';
const CURRENT_WORK_START = '2025-01-01';
const secretsPath = process.env.AIT_CRM_SECRETS_PATH || '/root/.openclaw/secrets.json';

function clean(value = '') {
  return String(value || '').trim();
}

function isoDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function rowsBy(rows = [], key) {
  const lookup = new Map();
  for (const row of rows) {
    const value = row?.[key];
    if (!value) continue;
    const list = lookup.get(value) || [];
    list.push(row);
    lookup.set(value, list);
  }
  return lookup;
}

function increment(map, key, amount = 1) {
  const normalized = clean(key) || 'None';
  map.set(normalized, (map.get(normalized) || 0) + amount);
}

function topEntries(map, limit = 20) {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function bucketForContact(contact) {
  if (contact.workflowKey === WORKFLOW_KEYS.AIT_SIGNS) {
    if (contact.isPipelineEligible === false) return 'Source history';
    if (contact.hasRecentFollowUpTouch) return '2026 follow-up';
    if (contact.lastTouch >= CURRENT_WORK_START) return 'Current work';
    return 'Active pipeline';
  }
  if (contact.workflowKey === WORKFLOW_KEYS.AIT_USA) {
    return contact.currentStage || contact.status || 'Enrollment';
  }
  return contact.status || 'Active';
}

function contactability(contact) {
  if (contact.isDoNotCall) return 'do_not_contact';
  if (contact.isWrongNumber) return 'wrong_number';
  if (!clean(contact.phone) && !clean(contact.email)) return 'no_contact_channel';
  if (!clean(contact.phone)) return 'missing_phone';
  if (!clean(contact.email)) return 'missing_email';
  return 'reachable';
}

function csvCell(value) {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function csvLine(values = []) {
  return values.map(csvCell).join(',');
}

function candidateReason(contact) {
  if (contact.workflowKey === WORKFLOW_KEYS.AIT_SIGNS) {
    if (contact.bucket === '2026 follow-up') return 'AIT Signs active record with 2026 follow-up touch';
    return 'AIT Signs active record with current non-closed work stage';
  }
  if (contact.workflowKey === WORKFLOW_KEYS.AIT_USA) {
    if (!contact.lastTouch) return 'AIT USA enrollment contact with no recorded touch';
    return 'AIT USA enrollment contact still in active outreach stage';
  }
  return 'Active CRM contact';
}

function taskTypeForCandidate(contact) {
  if (contact.workflowKey === WORKFLOW_KEYS.AIT_SIGNS) return 'follow_up';
  if (contact.workflowKey === WORKFLOW_KEYS.AIT_USA && !contact.lastTouch) return 'first_outreach';
  return 'follow_up';
}

function safeFingerprint(databaseUrl, baseUrl, row) {
  const parsed = new URL(databaseUrl);
  return {
    targetBaseUrl: baseUrl,
    hostSuffix: parsed.hostname.split('.').slice(-4).join('.'),
    database: row.database,
    neonBranchId: row.neon_branch_id,
    neonProjectId: row.neon_project_id,
  };
}

async function queryAll(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows;
}

async function main() {
  const secrets = JSON.parse(await fs.readFile(secretsPath, 'utf8'));
  const databaseUrl = secrets.aitCrm?.staging?.databaseUrl || process.env.DATABASE_URL;
  const baseUrl = secrets.aitCrm?.staging?.baseUrl || '';
  if (!databaseUrl) throw new Error('Missing AIT CRM staging database URL.');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const [fingerprintRow] = await queryAll(client, `
      select current_database() as database,
        current_setting('neon.branch_id', true) as neon_branch_id,
        current_setting('neon.project_id', true) as neon_project_id
    `);
    const fingerprint = safeFingerprint(databaseUrl, baseUrl, fingerprintRow);

    const businessUnits = await queryAll(client, `
      select id, name, label, is_active as "isActive"
      from business_units
      where is_active is true
      order by name
    `);
    const targetUnits = businessUnits.filter((unit) => (
      workflowKeyForBusinessUnit(unit) === WORKFLOW_KEYS.AIT_SIGNS ||
      workflowKeyForBusinessUnit(unit) === WORKFLOW_KEYS.AIT_USA
    ));
    const targetIds = targetUnits.map((unit) => unit.id);

    const contacts = await queryAll(client, `
        select id, primary_business_unit_id as "primaryBusinessUnitId", name, company_name as "companyName",
          phone, email, source_label as "sourceLabel", is_do_not_call as "isDoNotCall",
          is_wrong_number as "isWrongNumber", created_at as "createdAt", updated_at as "updatedAt"
        from contacts
        where primary_business_unit_id = any($1::uuid[])
        order by name
      `, [targetIds]);
    const leads = await queryAll(client, `
        select id, business_unit_id as "businessUnitId", contact_id as "contactId", source_type as "sourceType",
          source_name as "sourceName", status, current_stage as "currentStage",
          assigned_user_id as "assignedUserId", original_notes as "originalNotes",
          created_at as "createdAt", updated_at as "updatedAt"
        from leads
        where business_unit_id = any($1::uuid[])
        order by created_at desc
      `, [targetIds]);
    const workOrders = await queryAll(client, `
        select id, business_unit_id as "businessUnitId", contact_id as "contactId", work_order_number as "workOrderNumber",
          title, status, description, delivery_date as "deliveryDate", created_at as "createdAt", updated_at as "updatedAt"
        from work_orders
        where business_unit_id = any($1::uuid[])
      `, [targetIds]);
    const estimates = await queryAll(client, `
        select id, business_unit_id as "businessUnitId", contact_id as "contactId", estimate_number as "estimateNumber",
          status, total, subtotal, approved_at as "approvedAt", rejected_at as "rejectedAt",
          created_at as "createdAt", updated_at as "updatedAt"
        from estimates
        where business_unit_id = any($1::uuid[])
      `, [targetIds]);
    const paymentSnapshots = await queryAll(client, `
        select ps.id, ps.business_unit_id as "businessUnitId",
          coalesce(wo.contact_id, est.contact_id) as "contactId",
          ps.amount, ps.paid_at as "paidAt", ps.source_sheet as "sourceSheet", ps.source_row as "sourceRow",
          ps.created_at as "createdAt", ps.updated_at as "updatedAt"
        from payment_snapshots ps
        left join work_orders wo on wo.id = ps.work_order_id
        left join estimates est on est.id = ps.estimate_id
        where ps.business_unit_id = any($1::uuid[])
      `, [targetIds]);
    const notes = await queryAll(client, `
        select id, business_unit_id as "businessUnitId", contact_id as "contactId", body,
          created_at as "createdAt", updated_at as "updatedAt"
        from notes
        where business_unit_id = any($1::uuid[])
      `, [targetIds]);
    const activityEvents = await queryAll(client, `
        select id, business_unit_id as "businessUnitId", contact_id as "contactId", event_type as "eventType",
          message, metadata_json as "metadataJson", occurred_at as "occurredAt", created_at as "createdAt"
        from activity_events
        where business_unit_id = any($1::uuid[])
      `, [targetIds]);
    const conversationMessages = await queryAll(client, `
        select cm.id, c.business_unit_id as "businessUnitId", c.contact_id as "contactId",
          cm.text_body as "textBody", cm.occurred_at as "occurredAt", cm.created_at as "createdAt"
        from conversation_messages cm
        join conversations c on c.id = cm.conversation_id
        where c.business_unit_id = any($1::uuid[])
      `, [targetIds]);
    const tasks = await queryAll(client, `
        select business_unit_id as "businessUnitId", contact_id as "contactId", status, task_type as "taskType",
          due_at as "dueAt", completed_at as "completedAt"
        from tasks
        where business_unit_id = any($1::uuid[])
      `, [targetIds]);

    const businessUnitById = new Map(targetUnits.map((unit) => [unit.id, unit]));
    const leadByContactId = new Map();
    for (const lead of leads) {
      if (!lead.contactId || leadByContactId.has(lead.contactId)) continue;
      leadByContactId.set(lead.contactId, lead);
    }
    const workOrdersByContact = rowsBy(workOrders, 'contactId');
    const estimatesByContact = rowsBy(estimates, 'contactId');
    const paymentsByContact = rowsBy(paymentSnapshots, 'contactId');
    const notesByContact = rowsBy(notes, 'contactId');
    const eventsByContact = rowsBy(activityEvents, 'contactId');
    const messagesByContact = rowsBy(conversationMessages, 'contactId');

    const enrichedContacts = contacts.map((contact) => {
      const businessUnit = businessUnitById.get(contact.primaryBusinessUnitId);
      const lead = leadByContactId.get(contact.id);
      const contactWorkOrders = workOrdersByContact.get(contact.id) || [];
      const contactEstimates = estimatesByContact.get(contact.id) || [];
      const contactPayments = paymentsByContact.get(contact.id) || [];
      const workflow = workflowFromLead(lead, {
        businessUnit,
        workOrders: contactWorkOrders,
        estimates: contactEstimates,
        paymentSnapshots: contactPayments,
      });
      const touch = summarizeContactTouch({
        contact,
        businessUnit,
        notes: notesByContact.get(contact.id) || [],
        activityEvents: eventsByContact.get(contact.id) || [],
        conversationMessages: messagesByContact.get(contact.id) || [],
        workOrders: contactWorkOrders,
        estimates: contactEstimates,
        paymentSnapshots: contactPayments,
      });
      const isPipelineEligible = isPipelineEligibleContact({
        ...contact,
        source: lead?.sourceName || lead?.sourceType || contact.sourceLabel || '',
        hasLeadStatus: Boolean(lead),
        leadId: lead?.id || '',
      }, {
        businessUnit,
        workOrders: contactWorkOrders,
        estimates: contactEstimates,
        paymentSnapshots: contactPayments,
        activityEvents: eventsByContact.get(contact.id) || [],
        lastTouch: touch.lastTouch,
        lastFollowUpTouch: touch.lastFollowUpTouch,
      });
      const enrollmentSignals = buildAitUsaEnrollmentSignals({ contact, lead, workflow });
      return {
        ...contact,
        businessUnitName: businessUnit?.name || '',
        workflowKey: workflow.workflowKey,
        status: workflow.status,
        currentStage: workflow.currentStage,
        source: lead?.sourceName || lead?.sourceType || contact.sourceLabel || '',
        leadStatus: lead?.status || '',
        leadCurrentStage: lead?.currentStage || '',
        leadSourceType: lead?.sourceType || '',
        assignedUserId: lead?.assignedUserId || '',
        lastTouch: touch.lastTouch,
        lastTouchLabel: touch.lastTouchLabel,
        lastFollowUpTouch: touch.lastFollowUpTouch,
        hasRecentFollowUpTouch: touch.hasRecentFollowUpTouch,
        isPipelineEligible,
        contactability: enrollmentSignals?.contactability?.status || contactability(contact),
        bucket: bucketForContact({
          workflowKey: workflow.workflowKey,
          status: workflow.status,
          currentStage: workflow.currentStage,
          lastTouch: touch.lastTouch,
          lastFollowUpTouch: touch.lastFollowUpTouch,
          hasRecentFollowUpTouch: touch.hasRecentFollowUpTouch,
          isPipelineEligible,
        }),
      };
    });

    const summaries = {};
    const taskCandidateRows = [];
    for (const unit of targetUnits) {
      const unitContacts = enrichedContacts.filter((contact) => contact.primaryBusinessUnitId === unit.id);
      const workflowKey = workflowKeyForBusinessUnit(unit);
      const workflow = lifecycleWorkflowForKey(workflowKey);
      const statusCounts = new Map();
      const stageCounts = new Map();
      const bucketCounts = new Map();
      const rawLeadStatuses = new Map();
      const rawLeadStages = new Map();
      const contactabilityCounts = new Map();
      const taskCounts = new Map();
      for (const contact of unitContacts) {
        increment(statusCounts, contact.status);
        increment(stageCounts, contact.currentStage);
        increment(bucketCounts, contact.bucket);
        increment(contactabilityCounts, contact.contactability);
        if (contact.leadStatus) increment(rawLeadStatuses, contact.leadStatus);
        if (contact.leadCurrentStage) increment(rawLeadStages, contact.leadCurrentStage);
      }
      for (const task of tasks.filter((row) => row.businessUnitId === unit.id)) {
        increment(taskCounts, `${task.status} / ${task.taskType}`);
      }

      const activeContacts = unitContacts.filter((contact) => (
        workflowKey !== WORKFLOW_KEYS.AIT_SIGNS ||
        contact.isPipelineEligible !== false
      ));
      const taskReady = activeContacts.filter((contact) => (
        !['do_not_contact', 'wrong_number', 'no_contact_channel'].includes(contact.contactability) &&
        !workflow.closedStatuses.includes(contact.status)
      ));
      const needsFirstOutreach = taskReady.filter((contact) => (
        contact.workflowKey === WORKFLOW_KEYS.AIT_USA
          ? contact.currentStage === 'New Lead' || !contact.lastTouch
          : contact.bucket === 'Current work' || contact.bucket === '2026 follow-up'
      ));

      summaries[unit.name] = {
        workflowKey,
        contacts: unitContacts.length,
        leads: leads.filter((lead) => lead.businessUnitId === unit.id).length,
        tasks: tasks.filter((task) => task.businessUnitId === unit.id).length,
        workflowStatuses: workflow.statuses,
        statusCounts: topEntries(statusCounts),
        stageCounts: topEntries(stageCounts),
        bucketCounts: topEntries(bucketCounts),
        rawLeadStatuses: topEntries(rawLeadStatuses),
        rawLeadStages: topEntries(rawLeadStages),
        contactabilityCounts: topEntries(contactabilityCounts),
        taskCounts: topEntries(taskCounts),
        taskReadyCount: taskReady.length,
        firstOutreachOrFollowUpCandidates: needsFirstOutreach.length,
        manualReviewCount: unitContacts.filter((contact) => (
          contact.bucket === 'Source history' ||
          ['do_not_contact', 'wrong_number', 'no_contact_channel'].includes(contact.contactability)
        )).length,
      };

      for (const contact of taskReady) {
        taskCandidateRows.push({
          contactId: contact.id,
          name: contact.name,
          companyName: contact.companyName || '',
          businessUnit: unit.name,
          workflowKey,
          status: contact.status,
          currentStage: contact.currentStage,
          bucket: contact.bucket,
          contactability: contact.contactability,
          lastTouch: contact.lastTouch,
          lastTouchLabel: contact.lastTouchLabel,
          lastFollowUpTouch: contact.lastFollowUpTouch,
          assignedUserId: contact.assignedUserId || '',
          recommendedTaskType: taskTypeForCandidate(contact),
          reason: candidateReason(contact),
        });
      }
    }

    const packet = {
      generatedAt: new Date().toISOString(),
      fingerprint,
      assumptions: [
        `AIT Signs active pipeline remains runtime-classified by current work since ${CURRENT_WORK_START} or follow-up touch since ${RECENT_FOLLOW_UP_START}.`,
        'Source/history-only AIT Signs rows stay searchable but should not generate employee tasks.',
        'No task backfill should run until the first batch is reviewed by division and contactability.',
      ],
      totals: {
        contacts: contacts.length,
        leads: leads.length,
        tasks: tasks.length,
        taskCandidates: taskCandidateRows.length,
      },
      summaries,
      taskCandidateSample: taskCandidateRows.slice(0, 20),
      recommendation: {
        nextIssueTitle: '[AIT CRM Data] Build task activation approval packet from normalized statuses',
        nextIssueScope: [
          'Use current runtime lifecycle buckets instead of mutating contact statuses first.',
          'Generate a read-only candidate list for AIT Signs current-work/2026-follow-up rows and AIT USA New Lead/Follow Up rows with at least one usable contact channel.',
          'Group candidates by division, owner, status, contactability, and reason.',
          'Keep source-history, DNC/wrong-number/no-channel, closed/completed, and low-evidence records out of the first task batch.',
          'Only after approval, add idempotent task creation using sourceType=system/sourceId policy keys.',
        ],
      },
    };

    await fs.mkdir(path.dirname(DOC_PATH), { recursive: true });
    await fs.writeFile(JSON_PATH, `${JSON.stringify(packet, null, 2)}\n`);
    await fs.writeFile(CSV_PATH, renderCsv(taskCandidateRows));
    await fs.writeFile(DOC_PATH, renderMarkdown(packet));
    console.log(`Wrote ${path.relative(repoRoot, DOC_PATH)}`);
    console.log(`Wrote ${path.relative(repoRoot, JSON_PATH)}`);
    console.log(`Wrote ${path.relative(repoRoot, CSV_PATH)}`);
  } finally {
    await client.end();
  }
}

function renderCsv(rows = []) {
  const headers = [
    'contactId',
    'name',
    'companyName',
    'businessUnit',
    'workflowKey',
    'status',
    'currentStage',
    'bucket',
    'contactability',
    'lastTouch',
    'lastTouchLabel',
    'lastFollowUpTouch',
    'assignedUserId',
    'recommendedTaskType',
    'reason',
  ];
  return [
    csvLine(headers),
    ...rows.map((row) => csvLine(headers.map((header) => row[header]))),
    '',
  ].join('\n');
}

function renderCountList(entries = []) {
  if (!entries.length) return '- None\n';
  return entries.map((entry) => `- ${entry.label}: ${entry.count}`).join('\n') + '\n';
}

function renderMarkdown(packet) {
  const lines = [];
  lines.push('# MIS-184 Status And Task Readiness Packet');
  lines.push('');
  lines.push(`Generated: ${packet.generatedAt}`);
  lines.push('');
  lines.push('## Safe DB Fingerprint');
  lines.push('');
  lines.push(`- Target base URL: ${packet.fingerprint.targetBaseUrl}`);
  lines.push(`- Host suffix: ${packet.fingerprint.hostSuffix}`);
  lines.push(`- Database: ${packet.fingerprint.database}`);
  lines.push(`- Neon branch id: ${packet.fingerprint.neonBranchId}`);
  lines.push(`- Neon project id: ${packet.fingerprint.neonProjectId}`);
  lines.push('');
  lines.push('## Assumptions');
  lines.push('');
  for (const assumption of packet.assumptions) lines.push(`- ${assumption}`);
  lines.push('');
  lines.push('## Totals');
  lines.push('');
  lines.push(`- Contacts: ${packet.totals.contacts}`);
  lines.push(`- Leads: ${packet.totals.leads}`);
  lines.push(`- Tasks: ${packet.totals.tasks}`);
  lines.push(`- Candidate task rows in CSV: ${packet.totals.taskCandidates}`);
  lines.push('');
  for (const [name, summary] of Object.entries(packet.summaries)) {
    lines.push(`## ${name}`);
    lines.push('');
    lines.push(`- Workflow: ${summary.workflowKey}`);
    lines.push(`- Contacts: ${summary.contacts}`);
    lines.push(`- Leads: ${summary.leads}`);
    lines.push(`- Existing tasks: ${summary.tasks}`);
    lines.push(`- Task-ready records before explicit approval: ${summary.taskReadyCount}`);
    lines.push(`- First outreach/follow-up candidates before explicit approval: ${summary.firstOutreachOrFollowUpCandidates}`);
    lines.push(`- Manual/skip records before task generation: ${summary.manualReviewCount}`);
    lines.push('');
    lines.push('### Computed Statuses');
    lines.push('');
    lines.push(renderCountList(summary.statusCounts).trimEnd());
    lines.push('');
    lines.push('### Computed Stages');
    lines.push('');
    lines.push(renderCountList(summary.stageCounts).trimEnd());
    lines.push('');
    lines.push('### Buckets');
    lines.push('');
    lines.push(renderCountList(summary.bucketCounts).trimEnd());
    lines.push('');
    lines.push('### Raw Lead Statuses');
    lines.push('');
    lines.push(renderCountList(summary.rawLeadStatuses).trimEnd());
    lines.push('');
    lines.push('### Contactability');
    lines.push('');
    lines.push(renderCountList(summary.contactabilityCounts).trimEnd());
    lines.push('');
  }
  lines.push('## Recommendation');
  lines.push('');
  lines.push(`Next issue: ${packet.recommendation.nextIssueTitle}`);
  lines.push('');
  for (const item of packet.recommendation.nextIssueScope) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Candidate CSV');
  lines.push('');
  lines.push('- `docs/mis-184-task-activation-candidates.csv` contains the read-only candidate list for review.');
  lines.push('- Columns include contact id, division, computed status/stage, bucket, contactability, touch evidence, proposed task type, and reason.');
  lines.push('');
  lines.push('No database writes were performed by this packet generator.');
  lines.push('');
  return lines.join('\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
