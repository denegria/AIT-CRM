import { WORKFLOW_KEYS } from './crm/lifecycle.js';

function clean(value = '') {
  return String(value || '').trim();
}

function titleLabel(value = '') {
  return clean(value)
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function processPillLabel(row = {}, names = []) {
  const pills = new Set(row.processPills || []);
  return names.find((name) => pills.has(name)) || '';
}

export function enrollmentStageText(row = {}) {
  return clean(row.currentStage) || clean(row.status) || 'Unstaged';
}

export function programText(row = {}) {
  return clean(row.programInterest) || clean(row.enrollmentSignals?.inquiry?.programInterest) || 'Program not set';
}

export function contactabilityText(row = {}) {
  const status = clean(row.contactabilityStatus) || clean(row.enrollmentSignals?.contactability?.status);
  const matchedPill = processPillLabel(row, [
    'wrong_number',
    'do_not_contact',
    'no_contact_channel',
    'missing_phone',
    'missing_email',
    'repeated_no_answer',
  ]);
  return titleLabel(matchedPill || status || 'reachable');
}

export function enrollmentSourceText(row = {}) {
  return clean(row.inquirySource) ||
    clean(row.enrollmentSignals?.source?.channel) ||
    clean(row.sourceLabel) ||
    clean(row.source) ||
    'Source not set';
}

export function clientDirectoryColumnMode({ isClientsMode = false, workflowKey = '', isSingleDivisionScope = false } = {}) {
  if (!isClientsMode && !(isSingleDivisionScope && workflowKey === WORKFLOW_KEYS.AIT_USA)) return 'contacts';
  if (workflowKey === WORKFLOW_KEYS.AIT_USA) return 'ait_usa';
  return 'ait_signs';
}
