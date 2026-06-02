import { WORKFLOW_KEYS, workflowKeyForBusinessUnit } from './crm/lifecycle.js';

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const EXCEL_DAY_MS = 24 * 60 * 60 * 1000;
const MIN_EXCEL_SERIAL = 40000;
const MAX_EXCEL_SERIAL = 60000;

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

function excelSerialToTime(serial) {
  const value = Number(serial);
  if (!Number.isFinite(value) || value < MIN_EXCEL_SERIAL || value > MAX_EXCEL_SERIAL) return 0;
  return EXCEL_EPOCH_MS + Math.round(value) * EXCEL_DAY_MS;
}

export function latestExcelDateFromText(value = '') {
  const text = String(value || '');
  if (!text) return 0;
  const matches = text.matchAll(/(^|[^\d])(\d{5})(?:\.0+)?(?=$|[^\d])/g);
  let latest = 0;
  for (const match of matches) {
    latest = Math.max(latest, excelSerialToTime(match[2]));
  }
  return latest;
}

function businessTimeFromText(value, fallback) {
  return latestExcelDateFromText(value) || dateTime(fallback);
}

function isCleanupNote(text = '') {
  return cleanText(text).toLowerCase().startsWith('ait signs cleanup merged duplicate customer contacts');
}

function isAitUsaTouchEvent(eventType = '') {
  const normalized = String(eventType || '').toLowerCase();
  return (
    normalized.includes('follow_up') ||
    normalized.includes('message') ||
    normalized.includes('call') ||
    normalized.includes('sms') ||
    normalized.includes('whatsapp') ||
    normalized.includes('manual_outbound')
  );
}

function addCandidate(candidates, candidate) {
  if (!candidate?.time) return;
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
} = {}) {
  const workflowKey = workflowKeyForBusinessUnit(businessUnit || contact.businessUnitName || contact.divisionLabel || '');
  const latestCommentCandidates = [];
  const touchCandidates = [];

  for (const message of conversationMessages || []) {
    const text = messageText(message);
    const time = dateTime(message.occurredAt || message.createdAt);
    addCandidate(latestCommentCandidates, {
      time,
      text,
      kind: 'message',
      label: 'Message',
    });
    addCandidate(touchCandidates, {
      time,
      text,
      kind: 'message',
      label: 'Message',
    });
  }

  for (const event of activityEvents || []) {
    const text = event.message || event.eventType || '';
    const eventTime = workflowKey === WORKFLOW_KEYS.AIT_SIGNS
      ? businessTimeFromText(text, event.occurredAt || event.createdAt)
      : dateTime(event.occurredAt || event.createdAt);
    const label = String(event.eventType || '').includes('follow_up') ? 'Follow-up' : 'Activity';
    addCandidate(latestCommentCandidates, {
      time: eventTime,
      text,
      kind: 'activity',
      label,
    });

    if (
      workflowKey === WORKFLOW_KEYS.AIT_SIGNS ||
      isAitUsaTouchEvent(event.eventType)
    ) {
      addCandidate(touchCandidates, {
        time: eventTime,
        text,
        kind: 'activity',
        label,
      });
    }
  }

  for (const note of notes || []) {
    const text = note.body || note.text || '';
    if (isCleanupNote(text)) continue;
    const noteTime = workflowKey === WORKFLOW_KEYS.AIT_SIGNS
      ? businessTimeFromText(text, note.createdAt)
      : dateTime(note.createdAt);
    addCandidate(latestCommentCandidates, {
      time: noteTime,
      text,
      kind: 'note',
      label: 'Note',
    });
    if (workflowKey === WORKFLOW_KEYS.AIT_SIGNS) {
      addCandidate(touchCandidates, {
        time: noteTime,
        text,
        kind: 'note',
        label: 'History',
      });
    }
  }

  if (workflowKey === WORKFLOW_KEYS.AIT_SIGNS) {
    for (const order of workOrders || []) {
      const text = order.description || order.title || order.workOrderNumber || 'Work order';
      addCandidate(touchCandidates, {
        time: businessTimeFromText(text, order.deliveryDate),
        text: order.title || order.description || order.workOrderNumber || 'Work order',
        kind: 'work_order',
        label: 'Job',
      });
      addCandidate(latestCommentCandidates, {
        time: businessTimeFromText(text, order.deliveryDate),
        text: order.title || order.description || order.workOrderNumber || 'Work order',
        kind: 'work_order',
        label: 'Job',
      });
    }

    for (const estimate of estimates || []) {
      const amount = moneyText(estimate.total || estimate.subtotal);
      const text = [estimate.estimateNumber || 'Estimate', estimate.status, amount].filter(Boolean).join(' · ');
      addCandidate(touchCandidates, {
        time: dateTime(estimate.approvedAt || estimate.rejectedAt),
        text,
        kind: 'estimate',
        label: 'Estimate',
      });
      addCandidate(latestCommentCandidates, {
        time: dateTime(estimate.approvedAt || estimate.rejectedAt),
        text,
        kind: 'estimate',
        label: 'Estimate',
      });
    }

    for (const payment of paymentSnapshots || []) {
      const amount = moneyText(payment.amount);
      const text = [amount || 'Payment', payment.sourceSheet, payment.sourceRow ? `row ${payment.sourceRow}` : ''].filter(Boolean).join(' · ');
      addCandidate(touchCandidates, {
        time: dateTime(payment.paidAt),
        text,
        kind: 'payment',
        label: 'Payment',
      });
      addCandidate(latestCommentCandidates, {
        time: dateTime(payment.paidAt),
        text,
        kind: 'payment',
        label: 'Payment',
      });
    }
  }

  latestCommentCandidates.sort((a, b) => b.time - a.time);
  touchCandidates.sort((a, b) => b.time - a.time);

  const latestComment = latestCommentCandidates[0] || null;
  const lastTouch = touchCandidates[0] || null;
  const lastEditedTime = dateTime(contact.updatedAt || contact.createdAt);

  return {
    latestComment: latestComment?.text || '',
    latestCommentDate: isoDateFromTime(latestComment?.time || 0),
    latestCommentLabel: latestComment?.label || '',
    lastTouch: isoDateFromTime(lastTouch?.time || 0),
    lastTouchLabel: lastTouch?.label || '',
    lastTouchText: lastTouch?.text || '',
    lastEdited: isoDateFromTime(lastEditedTime),
  };
}
