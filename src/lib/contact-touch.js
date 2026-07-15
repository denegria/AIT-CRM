import { WORKFLOW_KEYS, workflowKeyForBusinessUnit } from './crm/lifecycle.js';

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const EXCEL_DAY_MS = 24 * 60 * 60 * 1000;
const MIN_EXCEL_SERIAL = 40000;
const MAX_EXCEL_SERIAL = 60000;
const TOUCH_FUTURE_GRACE_MS = EXCEL_DAY_MS;
const RECENT_FOLLOW_UP_START = '2026-01-01';

function cleanText(value = '') {
  return String(value || '')
    .replace(/\s*\|\s*/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dateTime(value) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

function isoDateFromTime(time) {
  if (!time) return '';
  return new Date(time).toISOString().slice(0, 10);
}

function allowedFutureTime(referenceTime = Date.now()) {
  return referenceTime + TOUCH_FUTURE_GRACE_MS;
}

function isAllowedTouchTime(time, referenceTime = Date.now()) {
  return Boolean(time && time <= allowedFutureTime(referenceTime));
}

function excelSerialToTime(serial, referenceTime = Date.now()) {
  const value = Number(serial);
  if (!Number.isFinite(value) || value < MIN_EXCEL_SERIAL || value > MAX_EXCEL_SERIAL) return 0;
  const time = EXCEL_EPOCH_MS + Math.round(value) * EXCEL_DAY_MS;
  return isAllowedTouchTime(time, referenceTime) ? time : 0;
}

export function latestExcelDateFromText(value = '', { referenceTime = Date.now() } = {}) {
  const text = String(value || '');
  if (!text) return 0;
  const matches = text.matchAll(/(^|[^\d.])(\d{5})(?:\.0+)?(?=$|[^\d])/g);
  let latest = 0;
  for (const match of matches) {
    latest = Math.max(latest, excelSerialToTime(match[2], referenceTime));
  }
  return latest;
}

function businessTimeFromText(value, fallback, referenceTime, { allowFallback = true } = {}) {
  const textTime = latestExcelDateFromText(value, { referenceTime });
  if (textTime) return textTime;
  if (!allowFallback) return 0;
  const fallbackTime = dateTime(fallback);
  return isAllowedTouchTime(fallbackTime, referenceTime) ? fallbackTime : 0;
}

function isSystemHistoryNote(text = '') {
  const normalized = cleanText(text).toLowerCase();
  return (
    normalized.startsWith('ait signs cleanup merged duplicate customer contacts') ||
    /^mis-\d+\s+.*\b(cleanup|consolidation|correction|merge|merged|backfill|parser|audit|source-row|artifact|data-fix)\b/.test(normalized) ||
    /^mis-\d+\s+approved\b/.test(normalized)
  );
}

function isImportedHistoryText(text = '') {
  return String(text || '').split('|').length >= 4;
}

function isImportedHistoryRow(row = {}) {
  return (
    String(row.eventType || '').startsWith('import_') ||
    Boolean(row.sourceSheet || row.sourceRow) ||
    isImportedHistoryText(row.description || row.body || row.text || row.message)
  );
}

function isAitUsaTouchEvent(eventType = '') {
  const normalized = String(eventType || '').toLowerCase();
  return (
    normalized === 'website_lead_captured' ||
    normalized.includes('follow_up') ||
    normalized.includes('message') ||
    normalized.includes('call') ||
    normalized.includes('sms') ||
    normalized.includes('whatsapp') ||
    normalized.includes('manual_outbound')
  );
}

function isFollowUpTouch({ eventType = '', text = '', kind = '' } = {}) {
  const normalizedEvent = String(eventType || '').toLowerCase();
  const normalizedText = cleanText(text).toLowerCase();
  if (kind === 'message') return true;
  if (
    normalizedEvent.includes('follow_up') ||
    normalizedEvent.includes('manual_outbound') ||
    normalizedEvent.includes('call') ||
    normalizedEvent.includes('sms') ||
    normalizedEvent.includes('whatsapp') ||
    normalizedEvent.includes('message')
  ) {
    return true;
  }
  return [
    'follow up',
    'follow-up',
    'seguimiento',
    'llamada',
    'llamo',
    'llamó',
    'called',
    'voicemail',
    'no contesta',
    'no answer',
    'whatsapp',
    'mensaje',
    'texted',
  ].some((needle) => normalizedText.includes(needle));
}

function addCandidate(candidates, candidate, referenceTime) {
  if (!isAllowedTouchTime(candidate?.time, referenceTime)) return;
  candidates.push({
    ...candidate,
    text: cleanText(candidate.text),
  });
}

function messageText(message) {
  return message?.textBody || message?.message || '';
}

function moneyText(value) {
  const number = Number(value || 0);
  if (!number) return '';
  return `$${number.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function summarizeContactTouch({
  contact = {},
  businessUnit = null,
  notes = [],
  activityEvents = [],
  conversationMessages = [],
  workOrders = [],
  estimates = [],
  paymentSnapshots = [],
  referenceTime = Date.now(),
} = {}) {
  const workflowKey = workflowKeyForBusinessUnit(businessUnit || contact.businessUnitName || contact.divisionLabel || '');
  const latestCommentCandidates = [];
  const touchCandidates = [];
  const followUpCandidates = [];

  for (const message of conversationMessages || []) {
    const text = messageText(message);
    const time = dateTime(message.occurredAt || message.createdAt);
    const candidate = {
      time,
      tieTime: dateTime(message.createdAt),
      text,
      kind: 'message',
      label: 'Message',
    };
    addCandidate(latestCommentCandidates, candidate, referenceTime);
    addCandidate(touchCandidates, candidate, referenceTime);
    addCandidate(followUpCandidates, candidate, referenceTime);
  }

  for (const event of activityEvents || []) {
    const text = event.message || event.eventType || '';
    if (isSystemHistoryNote(text)) continue;
    const allowFallback = workflowKey !== WORKFLOW_KEYS.AIT_SIGNS || !isImportedHistoryRow(event);
    const eventTime = workflowKey === WORKFLOW_KEYS.AIT_SIGNS
      ? businessTimeFromText(text, event.occurredAt || event.createdAt, referenceTime, { allowFallback })
      : dateTime(event.occurredAt || event.createdAt);
    const normalizedEventType = String(event.eventType || '').toLowerCase();
    const label = normalizedEventType === 'website_lead_captured'
      ? 'Submission'
      : normalizedEventType.includes('follow_up')
        ? 'Follow-up'
        : 'Activity';
    const candidate = {
      time: eventTime,
      tieTime: dateTime(event.createdAt),
      text,
      kind: 'activity',
      label,
      eventType: event.eventType || '',
    };
    addCandidate(latestCommentCandidates, candidate, referenceTime);

    if (
      workflowKey === WORKFLOW_KEYS.AIT_SIGNS ||
      isAitUsaTouchEvent(event.eventType)
    ) {
      addCandidate(touchCandidates, candidate, referenceTime);
    }
    if (isFollowUpTouch(candidate)) {
      addCandidate(followUpCandidates, candidate, referenceTime);
    }
  }

  for (const note of notes || []) {
    const text = note.body || note.text || '';
    if (isSystemHistoryNote(text)) continue;
    const allowFallback = workflowKey !== WORKFLOW_KEYS.AIT_SIGNS || !isImportedHistoryRow(note);
    const noteTime = workflowKey === WORKFLOW_KEYS.AIT_SIGNS
      ? businessTimeFromText(text, note.createdAt, referenceTime, { allowFallback })
      : dateTime(note.createdAt);
    const candidate = {
      time: noteTime,
      tieTime: dateTime(note.createdAt),
      text,
      kind: 'note',
      label: 'Note',
    };
    addCandidate(latestCommentCandidates, candidate, referenceTime);
    if (workflowKey === WORKFLOW_KEYS.AIT_SIGNS) {
      addCandidate(touchCandidates, {
        ...candidate,
        label: 'History',
      }, referenceTime);
    }
    if (isFollowUpTouch(candidate)) {
      addCandidate(followUpCandidates, candidate, referenceTime);
    }
  }

  if (workflowKey === WORKFLOW_KEYS.AIT_SIGNS) {
    for (const order of workOrders || []) {
      const text = order.description || order.title || order.workOrderNumber || 'Work order';
      const orderTime = businessTimeFromText(text, order.deliveryDate || order.createdAt, referenceTime, {
        allowFallback: !isImportedHistoryRow(order),
      });
      addCandidate(touchCandidates, {
        time: orderTime,
        tieTime: dateTime(order.createdAt || order.updatedAt),
        text: order.title || order.description || order.workOrderNumber || 'Work order',
        kind: 'work_order',
        label: 'Job',
      }, referenceTime);
      addCandidate(latestCommentCandidates, {
        time: orderTime,
        tieTime: dateTime(order.createdAt || order.updatedAt),
        text: order.title || order.description || order.workOrderNumber || 'Work order',
        kind: 'work_order',
        label: 'Job',
      }, referenceTime);
    }

    for (const estimate of estimates || []) {
      const amount = moneyText(estimate.total || estimate.subtotal);
      const text = [estimate.estimateNumber || 'Estimate', estimate.status, amount].filter(Boolean).join(' · ');
      addCandidate(touchCandidates, {
        time: dateTime(estimate.approvedAt || estimate.rejectedAt),
        tieTime: dateTime(estimate.createdAt || estimate.updatedAt),
        text,
        kind: 'estimate',
        label: 'Estimate',
      }, referenceTime);
      addCandidate(latestCommentCandidates, {
        time: dateTime(estimate.approvedAt || estimate.rejectedAt),
        tieTime: dateTime(estimate.createdAt || estimate.updatedAt),
        text,
        kind: 'estimate',
        label: 'Estimate',
      }, referenceTime);
    }

    for (const payment of paymentSnapshots || []) {
      const amount = moneyText(payment.amount);
      const text = [amount || 'Payment', payment.sourceSheet, payment.sourceRow ? `row ${payment.sourceRow}` : ''].filter(Boolean).join(' · ');
      addCandidate(touchCandidates, {
        time: dateTime(payment.paidAt),
        tieTime: dateTime(payment.createdAt || payment.updatedAt),
        text,
        kind: 'payment',
        label: 'Payment',
      }, referenceTime);
      addCandidate(latestCommentCandidates, {
        time: dateTime(payment.paidAt),
        tieTime: dateTime(payment.createdAt || payment.updatedAt),
        text,
        kind: 'payment',
        label: 'Payment',
      }, referenceTime);
    }
  }

  const newestCandidateFirst = (left, right) =>
    right.time - left.time ||
    (right.tieTime || 0) - (left.tieTime || 0) ||
    String(right.text || '').localeCompare(String(left.text || ''));
  latestCommentCandidates.sort(newestCandidateFirst);
  touchCandidates.sort(newestCandidateFirst);
  followUpCandidates.sort(newestCandidateFirst);

  const latestComment = latestCommentCandidates[0] || null;
  const lastFollowUpTouch = followUpCandidates[0] || null;
  const lastTouch = workflowKey === WORKFLOW_KEYS.AIT_USA
    ? lastFollowUpTouch || touchCandidates[0] || null
    : touchCandidates[0] || null;
  const lastEditedTime = dateTime(contact.updatedAt || contact.createdAt);

  return {
    latestComment: latestComment?.text || '',
    latestCommentDate: isoDateFromTime(latestComment?.time || 0),
    latestCommentLabel: latestComment?.label || '',
    lastTouch: isoDateFromTime(lastTouch?.time || 0),
    lastTouchLabel: lastTouch?.label || '',
    lastTouchText: lastTouch?.text || '',
    lastFollowUpTouch: isoDateFromTime(lastFollowUpTouch?.time || 0),
    lastFollowUpTouchText: lastFollowUpTouch?.text || '',
    hasRecentFollowUpTouch: isoDateFromTime(lastFollowUpTouch?.time || 0) >= RECENT_FOLLOW_UP_START,
    lastEdited: isoDateFromTime(lastEditedTime),
  };
}
