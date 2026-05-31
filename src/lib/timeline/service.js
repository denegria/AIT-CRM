import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  activityEvents,
  businessUnits,
  leadStatusHistory,
  leads,
  notes,
  taskEvents,
  tasks,
  users,
} from '../../db/schema.js';

export const TIMELINE_TYPES = {
  ACTIVITY: 'activity',
  LEAD: 'lead',
  MESSAGE: 'message',
  NOTE: 'note',
  TASK: 'task',
  WORK_ORDER: 'work_order',
};

const TIMELINE_TYPE_LABELS = {
  [TIMELINE_TYPES.ACTIVITY]: 'Activity',
  [TIMELINE_TYPES.LEAD]: 'Lead',
  [TIMELINE_TYPES.MESSAGE]: 'Message',
  [TIMELINE_TYPES.NOTE]: 'Note',
  [TIMELINE_TYPES.TASK]: 'Task',
  [TIMELINE_TYPES.WORK_ORDER]: 'Work order',
};

const EVENT_TITLE_OVERRIDES = {
  'ait_usa.follow_up': 'Imported follow-up',
  'import.follow_up': 'Imported follow-up',
  imported_follow_up: 'Imported follow-up',
  import_promoted_follow_up: 'Imported follow-up',
  import_promoted_lead: 'Imported lead',
  import_promoted_note: 'Imported note',
};

function isoTimestamp(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function isoDate(value) {
  return isoTimestamp(value).slice(0, 10);
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ''),
  );
}

function byId(rows = []) {
  return new Map(rows.filter((row) => row?.id).map((row) => [row.id, row]));
}

function userPayload(userId, userLookup) {
  if (!userId) return null;
  const user = userLookup.get(userId);
  return compactObject({
    id: userId,
    name: user?.name || user?.email || '',
    email: user?.email || '',
  });
}

function businessUnitPayload(businessUnitId, businessUnitLookup) {
  if (!businessUnitId) return null;
  const unit = businessUnitLookup.get(businessUnitId);
  return compactObject({
    id: businessUnitId,
    name: unit?.name || '',
    label: unit?.label || '',
    color: unit?.color || '',
  });
}

function linkedRecordPayload(row, task = null) {
  const links = [];
  if (row.contactId) links.push({ type: 'contact', id: row.contactId, label: 'Contact' });
  if (row.leadId) links.push({ type: 'lead', id: row.leadId, label: 'Lead' });
  if (row.taskId) {
    links.push({
      type: 'task',
      id: row.taskId,
      label: task?.title ? `Task: ${task.title}` : 'Task',
    });
  }
  if (row.estimateId) links.push({ type: 'estimate', id: row.estimateId, label: 'Estimate' });
  if (row.workOrderId) links.push({ type: 'work_order', id: row.workOrderId, label: 'Work order' });
  return links;
}

function sourcePayload(row, fallbackLabel = '') {
  if (row.sourceSheet || row.sourceRow) {
    return compactObject({
      label: row.sourceSheet || fallbackLabel || 'Imported source',
      row: row.sourceRow || '',
    });
  }
  if (fallbackLabel) return { label: fallbackLabel };
  return null;
}

function titleCaseEventType(eventType) {
  const normalized = String(eventType || '').trim().toLowerCase();
  if (EVENT_TITLE_OVERRIDES[normalized]) return EVENT_TITLE_OVERRIDES[normalized];

  return String(eventType || 'activity')
    .replaceAll('.', ' ')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function timelineTypeForEvent(eventType = '') {
  const type = String(eventType || '').toLowerCase();
  if (type.startsWith('task.')) return TIMELINE_TYPES.TASK;
  if (type.startsWith('work_order.')) return TIMELINE_TYPES.WORK_ORDER;
  if (type.includes('messenger') || type.includes('message') || type.includes('whatsapp')) {
    return TIMELINE_TYPES.MESSAGE;
  }
  if (type.includes('lead')) return TIMELINE_TYPES.LEAD;
  return TIMELINE_TYPES.ACTIVITY;
}

export function normalizeTimelineType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (!type || type === 'all') return '';
  return Object.values(TIMELINE_TYPES).includes(type) ? type : '';
}

export function filterTimelineRowsForBusinessUnit(rows = [], businessUnitIds = null) {
  if (!Array.isArray(businessUnitIds)) return rows;
  const allowed = new Set(businessUnitIds);
  return rows.filter((row) => !row.businessUnitId || allowed.has(row.businessUnitId));
}

export function buildContactTimeline({
  notes: noteRows = [],
  activityEvents: activityRows = [],
  taskEvents: taskEventRows = [],
  leadStatusHistory: leadStatusRows = [],
  tasks: taskRows = [],
  leads: leadRows = [],
  users: userRows = [],
  businessUnits: businessUnitRows = [],
  type = '',
} = {}) {
  const normalizedType = normalizeTimelineType(type);
  const userLookup = byId(userRows);
  const businessUnitLookup = byId(businessUnitRows);
  const taskLookup = byId(taskRows);
  const hasCanonicalTaskEvents = taskEventRows.length > 0;

  const entries = [];

  for (const note of noteRows) {
    entries.push({
      id: `note:${note.id}`,
      type: TIMELINE_TYPES.NOTE,
      typeLabel: TIMELINE_TYPE_LABELS[TIMELINE_TYPES.NOTE],
      eventType: 'note.created',
      title: 'Note',
      text: note.body,
      timestamp: isoTimestamp(note.createdAt),
      date: isoDate(note.createdAt),
      actor: userPayload(note.authorUserId, userLookup),
      businessUnit: businessUnitPayload(note.businessUnitId, businessUnitLookup),
      linkedRecords: linkedRecordPayload(note),
    });
  }

  for (const event of activityRows) {
    if (hasCanonicalTaskEvents && String(event.eventType || '').startsWith('task.')) continue;
    const entryType = timelineTypeForEvent(event.eventType);
    entries.push({
      id: `activity:${event.id}`,
      type: entryType,
      typeLabel: TIMELINE_TYPE_LABELS[entryType],
      eventType: event.eventType,
      title: titleCaseEventType(event.eventType),
      text: event.message || titleCaseEventType(event.eventType),
      timestamp: isoTimestamp(event.occurredAt || event.createdAt),
      date: isoDate(event.occurredAt || event.createdAt),
      actor: userPayload(event.actorUserId, userLookup),
      source: sourcePayload(event),
      businessUnit: businessUnitPayload(event.businessUnitId, businessUnitLookup),
      linkedRecords: linkedRecordPayload(event),
    });
  }

  for (const taskEvent of taskEventRows) {
    const task = taskLookup.get(taskEvent.taskId);
    entries.push({
      id: `task:${taskEvent.id}`,
      type: TIMELINE_TYPES.TASK,
      typeLabel: TIMELINE_TYPE_LABELS[TIMELINE_TYPES.TASK],
      eventType: `task.${taskEvent.eventType}`,
      title: task?.title || titleCaseEventType(taskEvent.eventType),
      text: taskEvent.message || titleCaseEventType(taskEvent.eventType),
      timestamp: isoTimestamp(taskEvent.occurredAt || taskEvent.createdAt),
      date: isoDate(taskEvent.occurredAt || taskEvent.createdAt),
      actor: userPayload(taskEvent.actorUserId, userLookup),
      businessUnit: businessUnitPayload(taskEvent.businessUnitId, businessUnitLookup),
      linkedRecords: linkedRecordPayload({ ...taskEvent, contactId: task?.contactId, leadId: task?.leadId, workOrderId: task?.workOrderId }, task),
      taskStatus: compactObject({
        from: taskEvent.fromStatus,
        to: taskEvent.toStatus,
      }),
      ownerChange: compactObject({
        from: userPayload(taskEvent.fromOwnerUserId, userLookup),
        to: userPayload(taskEvent.toOwnerUserId, userLookup),
      }),
    });
  }

  for (const statusEvent of leadStatusRows) {
    entries.push({
      id: `lead_status:${statusEvent.id}`,
      type: TIMELINE_TYPES.LEAD,
      typeLabel: TIMELINE_TYPE_LABELS[TIMELINE_TYPES.LEAD],
      eventType: 'lead.status_changed',
      title: 'Lead status changed',
      text: statusEvent.fromStatus
        ? `Lead status changed from ${statusEvent.fromStatus} to ${statusEvent.toStatus}.`
        : `Lead status set to ${statusEvent.toStatus}.`,
      timestamp: isoTimestamp(statusEvent.occurredAt || statusEvent.createdAt),
      date: isoDate(statusEvent.occurredAt || statusEvent.createdAt),
      actor: userPayload(statusEvent.actorUserId, userLookup),
      businessUnit: businessUnitPayload(statusEvent.businessUnitId, businessUnitLookup),
      linkedRecords: linkedRecordPayload(statusEvent),
      leadStatus: compactObject({
        from: statusEvent.fromStatus,
        to: statusEvent.toStatus,
      }),
    });
  }

  for (const lead of leadRows) {
    entries.push({
      id: `lead:${lead.id}`,
      type: TIMELINE_TYPES.LEAD,
      typeLabel: TIMELINE_TYPE_LABELS[TIMELINE_TYPES.LEAD],
      eventType: 'lead.created',
      title: lead.sourceName || titleCaseEventType(lead.sourceType || 'lead'),
      text: lead.originalNotes || `Lead status: ${lead.status || 'New Lead'}`,
      timestamp: isoTimestamp(lead.createdAt),
      date: isoDate(lead.createdAt),
      actor: userPayload(lead.assignedUserId, userLookup),
      source: sourcePayload(lead, lead.sourceName || lead.sourceType || 'Lead'),
      businessUnit: businessUnitPayload(lead.businessUnitId, businessUnitLookup),
      linkedRecords: linkedRecordPayload(lead),
    });
  }

  return entries
    .filter((entry) => !normalizedType || entry.type === normalizedType)
    .sort((left, right) => (right.timestamp || '').localeCompare(left.timestamp || ''));
}

function uniqueIds(rows, columnNames) {
  const ids = new Set();
  for (const row of rows) {
    for (const columnName of columnNames) {
      if (row?.[columnName]) ids.add(row[columnName]);
    }
  }
  return [...ids];
}

export async function listContactTimeline({
  db,
  organizationId,
  contactId,
  businessUnitIds = null,
  type = '',
}) {
  const [noteRowsRaw, activityRowsRaw, leadRowsRaw, taskRowsRaw, leadStatusRowsRaw] = await Promise.all([
    db
      .select()
      .from(notes)
      .where(and(eq(notes.organizationId, organizationId), eq(notes.contactId, contactId)))
      .orderBy(desc(notes.createdAt)),
    db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.organizationId, organizationId), eq(activityEvents.contactId, contactId)))
      .orderBy(desc(activityEvents.occurredAt), desc(activityEvents.createdAt)),
    db
      .select()
      .from(leads)
      .where(and(eq(leads.organizationId, organizationId), eq(leads.contactId, contactId)))
      .orderBy(desc(leads.createdAt)),
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.organizationId, organizationId), eq(tasks.contactId, contactId)))
      .orderBy(desc(tasks.createdAt)),
    db
      .select()
      .from(leadStatusHistory)
      .where(and(eq(leadStatusHistory.organizationId, organizationId), eq(leadStatusHistory.contactId, contactId)))
      .orderBy(desc(leadStatusHistory.occurredAt), desc(leadStatusHistory.createdAt)),
  ]);

  const noteRows = filterTimelineRowsForBusinessUnit(noteRowsRaw, businessUnitIds);
  const activityRows = filterTimelineRowsForBusinessUnit(activityRowsRaw, businessUnitIds);
  const leadRows = filterTimelineRowsForBusinessUnit(leadRowsRaw, businessUnitIds);
  const taskRows = filterTimelineRowsForBusinessUnit(taskRowsRaw, businessUnitIds);
  const leadStatusRows = filterTimelineRowsForBusinessUnit(leadStatusRowsRaw, businessUnitIds);
  const taskIds = taskRows.map((task) => task.id);

  const taskEventRows = taskIds.length
    ? await db
        .select()
        .from(taskEvents)
        .where(and(eq(taskEvents.organizationId, organizationId), inArray(taskEvents.taskId, taskIds)))
        .orderBy(desc(taskEvents.occurredAt), desc(taskEvents.createdAt))
    : [];

  const userIds = uniqueIds(
    [...noteRows, ...activityRows, ...leadRows, ...taskEventRows, ...leadStatusRows],
    ['authorUserId', 'actorUserId', 'assignedUserId', 'fromOwnerUserId', 'toOwnerUserId'],
  );
  const businessUnitLookupIds = uniqueIds(
    [...noteRows, ...activityRows, ...leadRows, ...taskRows, ...taskEventRows, ...leadStatusRows],
    ['businessUnitId'],
  );

  const [userRows, businessUnitRows] = await Promise.all([
    userIds.length
      ? db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(and(eq(users.organizationId, organizationId), inArray(users.id, userIds)))
      : [],
    businessUnitLookupIds.length
      ? db
          .select({ id: businessUnits.id, name: businessUnits.name, label: businessUnits.label, color: businessUnits.color })
          .from(businessUnits)
          .where(and(eq(businessUnits.organizationId, organizationId), inArray(businessUnits.id, businessUnitLookupIds)))
      : [],
  ]);

  return buildContactTimeline({
    notes: noteRows,
    activityEvents: activityRows,
    taskEvents: taskEventRows,
    leadStatusHistory: leadStatusRows,
    tasks: taskRows,
    leads: leadRows,
    users: userRows,
    businessUnits: businessUnitRows,
    type,
  });
}
