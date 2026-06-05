import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  activityEvents,
  businessUnits,
  estimates,
  leadStatusHistory,
  leads,
  notes,
  paymentSnapshots,
  taskEvents,
  tasks,
  users,
  workOrders,
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
  'ait_usa.follow_up': 'Follow-up attempt',
  'follow_up.reached_interested': 'Follow-up completed',
  'follow_up.reached_not_interested': 'Follow-up completed',
  'follow_up.left_voicemail': 'Left voicemail',
  'follow_up.no_answer': 'No answer',
  'follow_up.wrong_number': 'Wrong number',
  'follow_up.do_not_contact': 'Do not contact',
  'follow_up.appointment_scheduled': 'Appointment scheduled',
  'follow_up.enrolled_or_won': 'Enrolled / won',
  'follow_up.needs_next_follow_up': 'Next follow-up needed',
  'import.follow_up': 'Follow-up attempt',
  imported_follow_up: 'Follow-up attempt',
  import_promoted_follow_up: 'Follow-up attempt',
  import_promoted_estimate: 'Estimate history',
  import_promoted_payment_snapshot: 'Payment snapshot',
  import_promoted_work_order: 'Previous work',
  import_promoted_lead: 'Lead history',
  import_promoted_note: 'Imported note',
  'work_order.created': 'Work order created',
  'work_order.updated': 'Work order updated',
  'work_order.deleted': 'Work order deleted',
  'lead.status_changed': 'Status changed',
  'contact.note_added': 'Note added',
};

const TIMELINE_CATEGORIES = {
  ESTIMATE: 'estimate',
  FOLLOW_UP: 'follow_up',
  IMPORT: 'import',
  LEAD: 'lead',
  MESSAGE: 'message',
  NOTE: 'note',
  PAYMENT: 'payment',
  TASK: 'task',
  WORK: 'work',
};

const TIMELINE_CATEGORY_LABELS = {
  [TIMELINE_CATEGORIES.ESTIMATE]: 'Estimate',
  [TIMELINE_CATEGORIES.FOLLOW_UP]: 'Follow-up',
  [TIMELINE_CATEGORIES.IMPORT]: 'Source details',
  [TIMELINE_CATEGORIES.LEAD]: 'Lead',
  [TIMELINE_CATEGORIES.MESSAGE]: 'Message',
  [TIMELINE_CATEGORIES.NOTE]: 'Note',
  [TIMELINE_CATEGORIES.PAYMENT]: 'Payment',
  [TIMELINE_CATEGORIES.TASK]: 'Task',
  [TIMELINE_CATEGORIES.WORK]: 'Work',
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

function compactArray(values = []) {
  return values.filter((value) => value !== undefined && value !== null && value !== '');
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
  const metadata = row.metadataJson || row.metadata_json || {};
  if (row.contactId) links.push({ type: 'contact', id: row.contactId, label: 'Contact' });
  if (row.leadId) links.push({ type: 'lead', id: row.leadId, label: 'Lead' });
  if (row.taskId || metadata.taskId) {
    links.push({
      type: 'task',
      id: row.taskId || metadata.taskId,
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

function sourceKey(sourceSheet, sourceRow) {
  if (!sourceSheet || !sourceRow) return '';
  return `${sourceSheet}::${sourceRow}`;
}

function moneyLabel(value) {
  if (value === undefined || value === null || value === '') return '';
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(numeric) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

function normalizedStatus(value = '') {
  return String(value || '').trim().toLowerCase();
}

function statusLabel(value = '') {
  const status = String(value || '').trim();
  if (!status) return '';
  return status
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isCompletedStage(status = '', source = {}) {
  const normalized = normalizedStatus(status);
  const sourceText = `${source?.label || ''} ${source?.sourceKind || ''}`.toLowerCase();
  return [
    'completed',
    'complete',
    'delivered',
    'paid',
    'delivered_paid',
    'terminado',
    'pagado',
    'entregado',
  ].some((token) => normalized.includes(token) || sourceText.includes(token));
}

function stageStepsForRecord(kind, status, source) {
  const completed = isCompletedStage(status, source);
  if (kind === 'estimate') {
    return [
      { label: 'Estimate', state: 'complete' },
      { label: 'Approved', state: completed ? 'complete' : 'pending' },
      { label: 'Completed', state: completed ? 'complete' : 'pending' },
    ];
  }
  if (kind === 'work_order') {
    return [
      { label: 'Work order', state: 'complete' },
      { label: completed ? 'Delivered' : 'In progress', state: completed ? 'complete' : 'current' },
      { label: 'Completed', state: completed ? 'complete' : 'pending' },
    ];
  }
  return [];
}

function readableLine(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+·\s+/g, ' · ')
    .trim();
}

function parsePipeKeyValues(value = '') {
  const fields = {};
  for (const part of String(value || '').split('|')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex < 0) continue;
    const key = part.slice(0, separatorIndex).trim();
    const rawValue = part.slice(separatorIndex + 1).trim();
    if (!key || !rawValue || rawValue === 'none' || rawValue === 'unknown') continue;
    fields[key] = rawValue;
  }
  return fields;
}

function fieldChip(label, value) {
  const text = readableLine(value);
  if (!text) return '';
  return `${label} ${text}`;
}

function websiteLeadRecordPayload(lead) {
  const sourceType = String(lead?.sourceType || '').toLowerCase();
  const sourceName = String(lead?.sourceName || '');
  if (sourceType !== 'website_form' && !sourceName.toLowerCase().includes('wix')) return null;
  const fields = parsePipeKeyValues(lead.originalNotes);
  const stage = readableLine(fields.current_stage || lead.currentStage || lead.status || 'New Lead');
  const meta = compactArray([
    stage ? fieldChip('Stage', stage) : '',
    fields.service ? fieldChip('Interest', fields.service) : '',
    fields.address ? fieldChip('Location', fields.address) : '',
    fields.age ? fieldChip('Age', fields.age) : '',
    fields.source_key ? fieldChip('Source', fields.source_key) : '',
    fields.external_id ? fieldChip('Submission', fields.external_id) : '',
  ]);

  return compactObject({
    kind: 'website_lead',
    label: 'Website lead',
    title: sourceName || 'Website form lead',
    status: lead.status,
    stageLabel: stage,
    meta,
    fields,
  });
}

function websiteLeadText(lead, record) {
  const message = readableLine(record?.fields?.message || lead.originalNotes);
  if (message && !message.includes('external_id=') && !message.includes('source_key=')) return message;
  return 'Website lead submitted.';
}

function websiteFormDetailsNote(value = '') {
  const text = String(value || '').trim();
  if (!/^Website form details:/i.test(text)) return null;
  const rows = text
    .split(/\r?\n/)
    .map((row) => row.replace(/^-\s*/, '').trim())
    .filter((row) => row && !/^Website form details:/i.test(row))
    .map((row) => {
      const separatorIndex = row.indexOf(':');
      if (separatorIndex < 0) return readableLine(row);
      return fieldChip(row.slice(0, separatorIndex).trim(), row.slice(separatorIndex + 1).trim());
    })
    .filter(Boolean);
  if (!rows.length) return null;
  return {
    title: 'Website form details',
    text: rows.join(' · '),
    hint: {
      category: TIMELINE_CATEGORIES.NOTE,
      categoryLabel: 'Note',
      priority: 'primary',
      isImported: true,
      sourceKind: 'Website form details',
      rawText: text,
    },
  };
}

function workbookLikeText(value = '') {
  const text = String(value || '');
  if (!text) return false;
  const pipeCount = (text.match(/\|/g) || []).length;
  const moneyCount = (text.match(/\$\s*\d|\d+\.\d{2,}/g) || []).length;
  const excelSerialCount = (text.match(/\b4[3-6]\d{3}(?:\.0)?\b/g) || []).length;
  return pipeCount >= 4 || (pipeCount >= 2 && moneyCount >= 2) || excelSerialCount >= 2;
}

function cleanupMergeNoteText(value = '') {
  const text = String(value || '').trim();
  return (
    text.startsWith('AIT Signs cleanup merged duplicate customer contacts') ||
    text.startsWith('MIS-97 staging duplicate cleanup') ||
    text.startsWith('MIS-125 approved invalid-phone collision merge') ||
    text.startsWith('MIS-125 approved multi-phone primary correction') ||
    text.startsWith('MIS-125 staging phone backfill')
  );
}

function cleanupAuditSummary(value = '') {
  const text = String(value || '').trim();
  const canonical = text.match(/Canonical retained as:\s*([^\n.]+)/i)?.[1];
  const contact = text.match(/Contact retained as:\s*([^\n.]+)/i)?.[1];
  const primaryPhone = text.match(/Primary phone set (?:from|to):\s*([^\n.]+)/i)?.[1];
  const alternatePhones = text.match(/Alternate source phone\(s\)[^:]*:\s*([^\n.]+)/i)?.[1];
  const mergedNames = [...text.matchAll(/(?:^|\n)-\s*name=([^|\n]+)/g)]
    .map((match) => readableLine(match[1]))
    .filter(Boolean);
  const legacyMergedNames = mergedNames.length ? [] : [...text.matchAll(/(?:^|\n)-\s*([^|\n]+)/g)]
    .map((match) => readableLine(match[1]))
    .filter((value) => value && !value.includes(':'));

  const retained = canonical || contact;
  const lines = compactArray([
    retained ? `Retained ${retained}.` : '',
    primaryPhone ? `Primary phone ${primaryPhone}.` : '',
    alternatePhones ? `Alternate source phone(s): ${alternatePhones}.` : '',
    (mergedNames.length || legacyMergedNames.length)
      ? `Merged aliases: ${(mergedNames.length ? mergedNames : legacyMergedNames).slice(0, 4).join(', ')}${(mergedNames.length || legacyMergedNames.length) > 4 ? ', ...' : ''}.`
      : '',
  ]);
  return lines.join(' ');
}

function importedNoteInterpretation(value = '') {
  const text = String(value || '').trim();
  if (!text) return null;
  const websiteDetails = websiteFormDetailsNote(text);
  if (websiteDetails) return websiteDetails;
  if (cleanupMergeNoteText(text)) {
    return {
      title: 'Audit / Source Cleanup',
      text: cleanupAuditSummary(text) || 'Duplicate customer/contact rows were folded into this account.',
      hint: {
        category: TIMELINE_CATEGORIES.NOTE,
        categoryLabel: 'Audit / Source Cleanup',
        priority: 'primary',
        isImported: false,
        sourceKind: 'Cleanup audit',
        rawText: text,
      },
    };
  }
  if (workbookLikeText(text)) {
    return {
      title: 'Imported workbook note',
      text: 'Workbook note captured for audit. Expand source details for the original imported row.',
      hint: {
        category: TIMELINE_CATEGORIES.IMPORT,
        categoryLabel: 'Source details',
        priority: 'secondary',
        isImported: true,
        sourceKind: 'Imported workbook note',
        rawText: text,
      },
    };
  }
  return null;
}

function workOrderRecordPayload(row, source) {
  if (!row) return null;
  const amount = moneyLabel(row.estimatedCost);
  const status = statusLabel(row.status);
  return compactObject({
    kind: 'work_order',
    label: 'Work order',
    href: row.id ? `/work-orders/${row.id}` : '',
    number: row.workOrderNumber,
    title: readableLine(row.title) || 'AIT Signs work order',
    status,
    amount,
    stageLabel: isCompletedStage(row.status, source) ? 'Completed' : status || 'In progress',
    stages: stageStepsForRecord('work_order', row.status, source),
    meta: compactArray([
      row.workOrderNumber,
      status,
      amount,
      row.deliveryDate ? `Due ${row.deliveryDate}` : '',
    ]),
  });
}

function estimateRecordPayload(row, source) {
  if (!row) return null;
  const amount = moneyLabel(row.total || row.subtotal);
  const balance = moneyLabel(row.balanceDue);
  const status = statusLabel(row.status);
  return compactObject({
    kind: 'estimate',
    label: 'Estimate',
    number: row.estimateNumber,
    title: row.estimateNumber ? `Estimate ${row.estimateNumber}` : 'AIT Signs estimate',
    status,
    amount,
    balance,
    stageLabel: isCompletedStage(row.status, source) ? 'Completed' : status || 'Estimate',
    stages: stageStepsForRecord('estimate', row.status, source),
    meta: compactArray([
      row.estimateNumber,
      status,
      amount,
      balance ? `Balance ${balance}` : '',
    ]),
  });
}

function paymentRecordPayload(row) {
  if (!row) return null;
  const amount = moneyLabel(row.amount);
  const balance = moneyLabel(row.balanceAfter);
  return compactObject({
    kind: 'payment_snapshot',
    label: 'Payment',
    title: amount ? `Payment snapshot ${amount}` : 'Payment snapshot',
    status: balance ? 'Balance recorded' : 'Payment recorded',
    amount,
    balance,
    stageLabel: balance ? 'Balance recorded' : 'Payment recorded',
    meta: compactArray([
      amount,
      balance ? `Balance ${balance}` : '',
      row.paymentMethod,
      row.checkNumber ? `Check ${row.checkNumber}` : '',
    ]),
  });
}

function interpretedImportText(event, record) {
  const eventType = String(event.eventType || '').toLowerCase();
  if (record?.kind === 'work_order') {
    return compactArray([
      record.number,
      record.amount,
      record.stageLabel,
    ]).join(' · ') || 'Work order imported from AIT Signs history.';
  }
  if (record?.kind === 'estimate') {
    return compactArray([
      record.amount,
      record.balance ? `Balance ${record.balance}` : '',
      record.stageLabel,
    ]).join(' · ') || 'Estimate imported from AIT Signs history.';
  }
  if (record?.kind === 'payment_snapshot') {
    return compactArray([
      record.amount,
      record.balance ? `Balance ${record.balance}` : '',
    ]).join(' · ') || 'Payment details imported from AIT Signs history.';
  }
  if (eventType === 'import_promoted_note' && workbookLikeText(event.message)) {
    return 'Workbook note captured for audit. Expand source details for the original imported row.';
  }
  return event.message || titleCaseEventType(event.eventType);
}

function titleCaseEventType(eventType) {
  const normalized = String(eventType || '').trim().toLowerCase();
  if (EVENT_TITLE_OVERRIDES[normalized]) return EVENT_TITLE_OVERRIDES[normalized];

  return String(eventType || 'activity')
    .replaceAll('.', ' ')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function sourceKindLabel(source = {}) {
  if (!source) return '';
  const sheet = String(source.label || '').toLowerCase();
  if (sheet.includes('termin') || sheet.includes('pagad')) return 'Completed work source';
  if (sheet.includes('work order') || sheet.includes('15 signs')) return 'Active work source';
  if (sheet.includes('estim')) return 'Estimate source';
  if (sheet.includes('interes') || sheet.includes('prospect')) return 'Prospect source';
  return source.label ? 'Import source' : '';
}

export function presentationForTimelineEntry(entry) {
  const eventType = String(entry.eventType || '').toLowerCase();
  const text = String(entry.text || '').toLowerCase();
  const linkedTypes = new Set((entry.linkedRecords || []).map((record) => record.type));
  const hasSource = Boolean(entry.source?.label || entry.source?.row);
  const hint = entry.presentationHint || {};
  const isImport = eventType.includes('import') || hasSource;
  const isFollowUp = eventType.includes('follow_up') || text.includes('volver a llamar') || text.includes('llamar de nuevo');

  let category = TIMELINE_CATEGORIES.IMPORT;
  if (isFollowUp) category = TIMELINE_CATEGORIES.FOLLOW_UP;
  else if (eventType.includes('payment') || linkedTypes.has('payment')) category = TIMELINE_CATEGORIES.PAYMENT;
  else if (eventType.includes('estimate') || linkedTypes.has('estimate')) category = TIMELINE_CATEGORIES.ESTIMATE;
  else if (eventType.includes('work_order') || linkedTypes.has('work_order') || entry.type === TIMELINE_TYPES.WORK_ORDER) category = TIMELINE_CATEGORIES.WORK;
  else if (entry.type === TIMELINE_TYPES.TASK) category = TIMELINE_CATEGORIES.TASK;
  else if (entry.type === TIMELINE_TYPES.MESSAGE) category = TIMELINE_CATEGORIES.MESSAGE;
  else if (entry.type === TIMELINE_TYPES.NOTE) category = TIMELINE_CATEGORIES.NOTE;
  else if (entry.type === TIMELINE_TYPES.LEAD) category = TIMELINE_CATEGORIES.LEAD;
  else if (!isImport) category = TIMELINE_CATEGORIES.NOTE;

  const provenance = compactObject({
    eventType: entry.eventType || '',
    sourceLabel: entry.source?.label || '',
    sourceRow: entry.source?.row || '',
    sourceKind: hint.sourceKind || sourceKindLabel(entry.source),
    rawText: entry.rawText || hint.rawText || '',
  });
  const categoryOverride = hint.category || '';
  const categoryLabelOverride = hint.categoryLabel || '';
  const priorityOverride = hint.priority || '';
  const importedOverride = hint.isImported || false;
  const finalCategory = categoryOverride || category;

  const presentation = {
    category: finalCategory,
    categoryLabel: categoryLabelOverride || TIMELINE_CATEGORY_LABELS[finalCategory],
    priority: priorityOverride || (finalCategory === TIMELINE_CATEGORIES.IMPORT ? 'secondary' : 'primary'),
    provenance: Object.keys(provenance).length ? provenance : null,
    isImported: importedOverride || isImport,
  };
  if (hint.sourceGroupLabel) presentation.sourceGroupLabel = hint.sourceGroupLabel;
  return presentation;
}

function withPresentation(entry) {
  return {
    ...entry,
    presentation: presentationForTimelineEntry(entry),
  };
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
  estimates: estimateRows = [],
  workOrders: workOrderRows = [],
  paymentSnapshots: paymentSnapshotRows = [],
  users: userRows = [],
  businessUnits: businessUnitRows = [],
  type = '',
} = {}) {
  const normalizedType = normalizeTimelineType(type);
  const userLookup = byId(userRows);
  const businessUnitLookup = byId(businessUnitRows);
  const taskLookup = byId(taskRows);
  const estimateLookup = byId(estimateRows);
  const workOrderLookup = byId(workOrderRows);
  const paymentSnapshotLookup = new Map(
    paymentSnapshotRows
      .map((row) => [sourceKey(row.sourceSheet, row.sourceRow), row])
      .filter(([key]) => key),
  );
  const importedSourceCounts = new Map();
  for (const row of activityRows) {
    const key = sourceKey(row.sourceSheet, row.sourceRow);
    if (!key || !String(row.eventType || '').toLowerCase().startsWith('import_promoted_')) continue;
    importedSourceCounts.set(key, (importedSourceCounts.get(key) || 0) + 1);
  }
  const hasCanonicalTaskEvents = taskEventRows.length > 0;

  const entries = [];

  for (const note of noteRows) {
    const importedNote = importedNoteInterpretation(note.body);
    entries.push(withPresentation({
      id: `note:${note.id}`,
      type: TIMELINE_TYPES.NOTE,
      typeLabel: TIMELINE_TYPE_LABELS[TIMELINE_TYPES.NOTE],
      eventType: 'note.created',
      title: importedNote?.title || 'Note',
      text: importedNote?.text || note.body,
      rawText: importedNote?.hint?.rawText || '',
      presentationHint: importedNote?.hint || null,
      timestamp: isoTimestamp(note.createdAt),
      date: isoDate(note.createdAt),
      actor: userPayload(note.authorUserId, userLookup),
      businessUnit: businessUnitPayload(note.businessUnitId, businessUnitLookup),
      linkedRecords: linkedRecordPayload(note),
    }));
  }

  for (const event of activityRows) {
    if (hasCanonicalTaskEvents && String(event.eventType || '').startsWith('task.')) continue;
    const entryType = timelineTypeForEvent(event.eventType);
    const source = sourcePayload(event);
    const metadataJson = event.metadataJson || {};
    const linkedTask = metadataJson.taskId ? taskLookup.get(metadataJson.taskId) : null;
    const linkedWorkOrder = event.workOrderId ? workOrderLookup.get(event.workOrderId) : null;
    const linkedEstimate = event.estimateId ? estimateLookup.get(event.estimateId) : null;
    const linkedPayment = paymentSnapshotLookup.get(sourceKey(event.sourceSheet, event.sourceRow));
    const record = workOrderRecordPayload(linkedWorkOrder, source)
      || estimateRecordPayload(linkedEstimate, source)
      || (String(event.eventType || '').toLowerCase().includes('payment') ? paymentRecordPayload(linkedPayment) : null);
    const rawImportedText = String(event.eventType || '').toLowerCase().startsWith('import_promoted_')
      ? event.message || ''
      : '';
    const importedWorkbookNote = String(event.eventType || '').toLowerCase() === 'import_promoted_note' && workbookLikeText(rawImportedText);
    const eventSourceKey = sourceKey(event.sourceSheet, event.sourceRow);
    const sourceGroupCount = eventSourceKey ? importedSourceCounts.get(eventSourceKey) || 0 : 0;
    const eventPresentationHint = compactObject({
      rawText: rawImportedText && (record || workbookLikeText(rawImportedText)) ? rawImportedText : '',
      sourceGroupLabel: sourceGroupCount > 1 && event.sourceRow
        ? `Workbook row ${event.sourceRow}: ${sourceGroupCount} imported records`
        : '',
    });
    entries.push(withPresentation({
      id: `activity:${event.id}`,
      type: entryType,
      typeLabel: TIMELINE_TYPE_LABELS[entryType],
      eventType: event.eventType,
      title: record?.title || (importedWorkbookNote ? 'Imported workbook note' : titleCaseEventType(event.eventType)),
      text: interpretedImportText(event, record),
      rawText: eventPresentationHint.rawText || '',
      timestamp: isoTimestamp(event.occurredAt || event.createdAt),
      date: isoDate(event.occurredAt || event.createdAt),
      actor: userPayload(event.actorUserId, userLookup),
      source,
      businessUnit: businessUnitPayload(event.businessUnitId, businessUnitLookup),
      linkedRecords: linkedRecordPayload({ ...event, taskId: metadataJson.taskId }, linkedTask),
      record,
      metadataJson,
      presentationHint: Object.keys(eventPresentationHint).length ? eventPresentationHint : null,
    }));
  }

  for (const taskEvent of taskEventRows) {
    const task = taskLookup.get(taskEvent.taskId);
    entries.push(withPresentation({
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
    }));
  }

  for (const statusEvent of leadStatusRows) {
    entries.push(withPresentation({
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
    }));
  }

  for (const lead of leadRows) {
    const record = websiteLeadRecordPayload(lead);
    const rawImportedText = record && lead.originalNotes ? lead.originalNotes : '';
    entries.push(withPresentation({
      id: `lead:${lead.id}`,
      type: TIMELINE_TYPES.LEAD,
      typeLabel: TIMELINE_TYPE_LABELS[TIMELINE_TYPES.LEAD],
      eventType: 'lead.created',
      title: record?.title || lead.sourceName || titleCaseEventType(lead.sourceType || 'lead'),
      text: record ? websiteLeadText(lead, record) : (lead.originalNotes || `Lead status: ${lead.status || 'New Lead'}`),
      rawText: rawImportedText,
      timestamp: isoTimestamp(lead.createdAt),
      date: isoDate(lead.createdAt),
      actor: userPayload(lead.assignedUserId, userLookup),
      source: sourcePayload(lead, lead.sourceName || lead.sourceType || 'Lead'),
      businessUnit: businessUnitPayload(lead.businessUnitId, businessUnitLookup),
      linkedRecords: linkedRecordPayload(lead),
      record,
      presentationHint: rawImportedText ? {
        rawText: rawImportedText,
        isImported: true,
        sourceKind: 'Website form row',
      } : null,
    }));
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
  const linkedWorkOrderIds = uniqueIds([...noteRows, ...activityRows, ...taskRows], ['workOrderId']);
  const linkedEstimateIds = uniqueIds([...noteRows, ...activityRows, ...leadRows], ['estimateId']);
  const paymentSourceRows = [...new Set(activityRows
    .filter((row) => String(row.eventType || '').toLowerCase().includes('payment') && row.sourceRow)
    .map((row) => row.sourceRow))];

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

  const [userRows, businessUnitRows, workOrderRows, estimateRows, paymentSnapshotRowsRaw] = await Promise.all([
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
    linkedWorkOrderIds.length
      ? db
          .select()
          .from(workOrders)
          .where(and(eq(workOrders.organizationId, organizationId), inArray(workOrders.id, linkedWorkOrderIds)))
      : [],
    linkedEstimateIds.length
      ? db
          .select()
          .from(estimates)
          .where(and(eq(estimates.organizationId, organizationId), inArray(estimates.id, linkedEstimateIds)))
      : [],
    paymentSourceRows.length
      ? db
          .select()
          .from(paymentSnapshots)
          .where(and(eq(paymentSnapshots.organizationId, organizationId), inArray(paymentSnapshots.sourceRow, paymentSourceRows)))
      : [],
  ]);
  const paymentSourceKeys = new Set(activityRows.map((row) => sourceKey(row.sourceSheet, row.sourceRow)).filter(Boolean));
  const paymentSnapshotRows = paymentSnapshotRowsRaw.filter((row) => paymentSourceKeys.has(sourceKey(row.sourceSheet, row.sourceRow)));

  return buildContactTimeline({
    notes: noteRows,
    activityEvents: activityRows,
    taskEvents: taskEventRows,
    leadStatusHistory: leadStatusRows,
    tasks: taskRows,
    leads: leadRows,
    estimates: estimateRows,
    workOrders: workOrderRows,
    paymentSnapshots: paymentSnapshotRows,
    users: userRows,
    businessUnits: businessUnitRows,
    type,
  });
}
