import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  not,
  or,
  sql,
} from 'drizzle-orm';
import {
  activityEvents as activityEventsTable,
  contactCourseRecords as contactCourseRecordsTable,
  contactPeople as contactPeopleTable,
  conversationMessages as conversationMessagesTable,
  leadStatusHistory as leadStatusHistoryTable,
  notes as notesTable,
  paymentSnapshots as paymentSnapshotsTable,
  tasks as tasksTable,
} from '../db/schema.js';
import { contactBootstrapSummarySelection } from './bootstrap-contract.js';
import { TASK_STATUSES, TASK_TYPES } from './tasks/constants.js';

const SYSTEM_HISTORY_PATTERN = '^mis-[0-9]+[[:space:]]+.*(cleanup|consolidation|correction|merge|merged|backfill|parser|audit|source-row|artifact|data-fix)';
const SYSTEM_APPROVAL_PATTERN = '^mis-[0-9]+[[:space:]]+approved';

function contactIdScope(table, contactIds = []) {
  if (!contactIds.length) return sql`false`;
  return inArray(table.contactId, contactIds);
}

function selectionWithRowId(table, category) {
  return {
    rowId: table.id,
    ...contactBootstrapSummarySelection(table, category),
  };
}

function validCandidateTime(...columns) {
  return sql`coalesce(${sql.join(columns, sql`, `)}) <= now() + interval '1 day'`;
}

function isSystemHistory(column) {
  return sql`(
    coalesce(${column}, '') ilike 'ait signs cleanup merged duplicate customer contacts%'
    or lower(trim(coalesce(${column}, ''))) ~ ${SYSTEM_HISTORY_PATTERN}
    or lower(trim(coalesce(${column}, ''))) ~ ${SYSTEM_APPROVAL_PATTERN}
  )`;
}

function isTouchEventType(column) {
  return or(
    sql`lower(coalesce(${column}, '')) = 'website_lead_captured'`,
    ilike(column, '%follow_up%'),
    ilike(column, '%message%'),
    ilike(column, '%call%'),
    ilike(column, '%sms%'),
    ilike(column, '%whatsapp%'),
    ilike(column, '%manual_outbound%'),
  );
}

function isFollowUpEvent(row) {
  return or(
    ilike(row.eventType, '%follow_up%'),
    ilike(row.eventType, '%manual_outbound%'),
    ilike(row.eventType, '%call%'),
    ilike(row.eventType, '%sms%'),
    ilike(row.eventType, '%whatsapp%'),
    ilike(row.eventType, '%message%'),
  );
}

function isStructuredFollowUpOutcome(row) {
  return sql`lower(coalesce(${row.eventType}, '')) ~ '^follow_up\\.[a-z_]+$'`;
}

function withoutRowId(row = {}) {
  const { rowId: _rowId, ...payload } = row;
  return payload;
}

function createdAtTime(row = {}) {
  const time = row.createdAt instanceof Date
    ? row.createdAt.getTime()
    : new Date(row.createdAt || '').getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function mergeContactSummaryCandidateRows(...groups) {
  const rowsById = new Map();
  for (const row of groups.flat()) {
    if (!row?.rowId) continue;
    rowsById.set(row.rowId, withoutRowId(row));
  }
  return [...rowsById.values()];
}

async function latestNoteCandidates(db, contactIds) {
  if (!contactIds.length) return [];
  const selection = selectionWithRowId(notesTable, 'notes');
  const baseWhere = and(
    contactIdScope(notesTable, contactIds),
    validCandidateTime(notesTable.createdAt),
    not(isSystemHistory(notesTable.body)),
  );

  const latestRows = await db
    .selectDistinctOn([notesTable.contactId], selection)
    .from(notesTable)
    .where(baseWhere)
    .orderBy(notesTable.contactId, desc(notesTable.createdAt), desc(notesTable.body));

  return latestRows.map(withoutRowId);
}

async function latestActivityCandidates(db, contactIds) {
  if (!contactIds.length) return [];
  const selection = selectionWithRowId(activityEventsTable, 'activityEvents');
  const eventTime = sql`coalesce(${activityEventsTable.occurredAt}, ${activityEventsTable.createdAt})`;
  const baseWhere = and(
    contactIdScope(activityEventsTable, contactIds),
    validCandidateTime(activityEventsTable.occurredAt, activityEventsTable.createdAt),
    not(isSystemHistory(activityEventsTable.message)),
  );

  const [latestRows, touchRows, followUpRows, structuredFollowUpRows, submissionRows] = await Promise.all([
    db
      .selectDistinctOn([activityEventsTable.contactId], selection)
      .from(activityEventsTable)
      .where(baseWhere)
      .orderBy(activityEventsTable.contactId, desc(eventTime), desc(activityEventsTable.createdAt), desc(activityEventsTable.message)),
    db
      .selectDistinctOn([activityEventsTable.contactId], selection)
      .from(activityEventsTable)
      .where(and(baseWhere, isTouchEventType(activityEventsTable.eventType)))
      .orderBy(activityEventsTable.contactId, desc(eventTime), desc(activityEventsTable.createdAt), desc(activityEventsTable.message)),
    db
      .selectDistinctOn([activityEventsTable.contactId], selection)
      .from(activityEventsTable)
      .where(and(baseWhere, isFollowUpEvent(activityEventsTable)))
      .orderBy(activityEventsTable.contactId, desc(eventTime), desc(activityEventsTable.createdAt), desc(activityEventsTable.message)),
    db
      .selectDistinctOn([activityEventsTable.contactId], selection)
      .from(activityEventsTable)
      .where(and(baseWhere, isStructuredFollowUpOutcome(activityEventsTable)))
      .orderBy(activityEventsTable.contactId, desc(eventTime), desc(activityEventsTable.createdAt), desc(activityEventsTable.message)),
    db
      .selectDistinctOn([activityEventsTable.contactId, activityEventsTable.leadId], selection)
      .from(activityEventsTable)
      .where(and(
        contactIdScope(activityEventsTable, contactIds),
        sql`lower(${activityEventsTable.eventType}) = 'website_lead_captured'`,
      ))
      .orderBy(
        activityEventsTable.contactId,
        activityEventsTable.leadId,
        asc(eventTime),
        asc(activityEventsTable.createdAt),
      ),
  ]);

  return mergeContactSummaryCandidateRows(latestRows, touchRows, followUpRows, structuredFollowUpRows, submissionRows)
    .sort((left, right) => createdAtTime(right) - createdAtTime(left));
}

async function latestConversationCandidates(db, contactIds) {
  if (!contactIds.length) return [];
  const selection = selectionWithRowId(conversationMessagesTable, 'conversationMessages');
  const rows = await db
    .selectDistinctOn([conversationMessagesTable.contactId], selection)
    .from(conversationMessagesTable)
    .where(and(
      contactIdScope(conversationMessagesTable, contactIds),
      validCandidateTime(conversationMessagesTable.occurredAt, conversationMessagesTable.createdAt),
    ))
    .orderBy(
      conversationMessagesTable.contactId,
      desc(conversationMessagesTable.occurredAt),
      desc(conversationMessagesTable.createdAt),
      desc(conversationMessagesTable.textBody),
    );
  return rows.map(withoutRowId);
}

async function allSummaryRows(db, table, category, contactIds, orderBy = []) {
  if (!contactIds.length) return [];
  return db
    .select(contactBootstrapSummarySelection(table, category))
    .from(table)
    .where(contactIdScope(table, contactIds))
    .orderBy(...orderBy);
}

export async function loadContactBootstrapSummaryRows({
  db,
  visibleContactIds = [],
  signsContactIds = [],
}) {
  const signsIds = new Set(signsContactIds);
  const nonSignsContactIds = visibleContactIds.filter((contactId) => !signsIds.has(contactId));

  const [
    signsNoteRows,
    noteCandidateRows,
    signsActivityRows,
    activityCandidateRows,
    conversationMessageRows,
    contactPeopleRows,
    contactCourseRecordRows,
    leadStatusHistoryRows,
    paymentLinkRows,
    followUpCommitmentRows,
  ] = await Promise.all([
    allSummaryRows(db, notesTable, 'notes', signsContactIds, [desc(notesTable.createdAt)]),
    latestNoteCandidates(db, nonSignsContactIds),
    allSummaryRows(db, activityEventsTable, 'activityEvents', signsContactIds, [desc(activityEventsTable.createdAt)]),
    latestActivityCandidates(db, nonSignsContactIds),
    latestConversationCandidates(db, visibleContactIds),
    allSummaryRows(db, contactPeopleTable, 'contactPeople', visibleContactIds, [
      desc(contactPeopleTable.isPrimary),
      asc(contactPeopleTable.name),
    ]),
    allSummaryRows(db, contactCourseRecordsTable, 'courseRecords', visibleContactIds, [
      desc(contactCourseRecordsTable.createdAt),
    ]),
    visibleContactIds.length
      ? db
          .select(contactBootstrapSummarySelection(leadStatusHistoryTable, 'leadStatusHistory'))
          .from(leadStatusHistoryTable)
          .where(and(
            contactIdScope(leadStatusHistoryTable, visibleContactIds),
            inArray(leadStatusHistoryTable.toStatus, ['Enrolled', 'Dropped / Quit']),
          ))
          .orderBy(desc(leadStatusHistoryTable.occurredAt), desc(leadStatusHistoryTable.createdAt))
      : Promise.resolve([]),
    visibleContactIds.length
      ? db
          .selectDistinct({
            contactId: activityEventsTable.contactId,
            sourceSheet: activityEventsTable.sourceSheet,
            sourceRow: activityEventsTable.sourceRow,
          })
          .from(activityEventsTable)
          .innerJoin(paymentSnapshotsTable, and(
            eq(paymentSnapshotsTable.organizationId, activityEventsTable.organizationId),
            eq(paymentSnapshotsTable.sourceRow, activityEventsTable.sourceRow),
            sql`lower(trim(coalesce(${paymentSnapshotsTable.sourceSheet}, ''))) = lower(trim(coalesce(${activityEventsTable.sourceSheet}, '')))`,
          ))
          .where(contactIdScope(activityEventsTable, visibleContactIds))
      : Promise.resolve([]),
    visibleContactIds.length
      ? db
          .selectDistinctOn([tasksTable.contactId], {
            contactId: tasksTable.contactId,
            taskType: tasksTable.taskType,
            status: tasksTable.status,
            dueAt: tasksTable.dueAt,
          })
          .from(tasksTable)
          .where(and(
            contactIdScope(tasksTable, visibleContactIds),
            inArray(tasksTable.taskType, [
              TASK_TYPES.FIRST_OUTREACH,
              TASK_TYPES.FOLLOW_UP,
              TASK_TYPES.APPOINTMENT,
            ]),
            inArray(tasksTable.status, [
              TASK_STATUSES.OPEN,
              TASK_STATUSES.IN_PROGRESS,
              TASK_STATUSES.SNOOZED,
            ]),
            isNotNull(tasksTable.dueAt),
          ))
          .orderBy(tasksTable.contactId, asc(tasksTable.dueAt), desc(tasksTable.createdAt))
      : Promise.resolve([]),
  ]);

  return {
    noteRows: [...signsNoteRows, ...noteCandidateRows],
    eventRows: [...signsActivityRows, ...activityCandidateRows],
    conversationMessageRows,
    contactPeopleRows,
    contactCourseRecordRows,
    leadStatusHistoryRows,
    paymentLinkRows,
    followUpCommitmentRows,
  };
}
