import {
  WORKFLOW_KEYS,
  lifecycleWorkflowForKey,
  normalizeLifecycleStatus,
} from './crm/lifecycle.js';
import {
  aitUsaCourseOutcome,
  completedOrEndedAitUsaCourse,
  currentOrEnrolledAitUsaCourse,
} from './ait-usa-enrollment-signals.js';

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
  return currentOrEnrolledAitUsaCourse(row) ||
    completedOrEndedAitUsaCourse(row) ||
    clean(row.programInterest) ||
    clean(row.enrollmentSignals?.inquiry?.programInterest) ||
    'Program not set';
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

export function directorySourceText(row = {}) {
  return clean(row.sourceCategory) || enrollmentSourceText(row);
}

export function lifecycleBucket(row = {}) {
  const workflowKey = clean(row.workflowKey);
  if (workflowKey === WORKFLOW_KEYS.AIT_SIGNS) {
    if (row.isPipelineEligible === false) {
      return {
        label: 'Source history',
        tone: 'muted',
        detail: 'Hidden from active pipeline',
      };
    }
    if (row.hasRecentFollowUpTouch) {
      return {
        label: '2026 follow-up',
        tone: 'success',
        detail: clean(row.lastFollowUpTouch),
      };
    }
    if (clean(row.lastTouch) >= '2025-01-01') {
      return {
        label: 'Current work',
        tone: 'active',
        detail: clean(row.lastTouch),
      };
    }
    return {
      label: 'Active pipeline',
      tone: 'active',
      detail: '',
    };
  }

  if (workflowKey === WORKFLOW_KEYS.AIT_USA) {
    const status = normalizeLifecycleStatus(clean(row.currentStage) || clean(row.status), { workflowKey });
    const isTerminal = lifecycleWorkflowForKey(workflowKey).terminalStatuses.includes(status);
    if (isTerminal) {
      return {
        label: status,
        tone: 'muted',
        detail: aitUsaCourseOutcome(row) ||
          completedOrEndedAitUsaCourse(row) ||
          clean(row.sourceActivityDate) ||
          clean(row.leadCreatedAt),
      };
    }
    return {
      label: clean(row.currentStage) || clean(row.status) || 'Enrollment',
      tone: 'active',
      detail: clean(row.lastTouch),
    };
  }

  return {
    label: clean(row.status) || 'Active',
    tone: 'active',
    detail: clean(row.lastTouch),
  };
}

export function clientDirectoryColumnMode({ isClientsMode = false, workflowKey = '', isSingleDivisionScope = false } = {}) {
  if (!isClientsMode && !(isSingleDivisionScope && workflowKey === WORKFLOW_KEYS.AIT_USA)) return 'contacts';
  if (workflowKey === WORKFLOW_KEYS.AIT_USA) return 'ait_usa';
  return 'ait_signs';
}

export function leadDateForDirectoryScope(row = {}) {
  if (clean(row.workflowKey) === WORKFLOW_KEYS.AIT_SIGNS) {
    return clean(row.sourceActivityDate);
  }
  return clean(row.submittedAt) ||
    clean(row.leadCreatedAt) ||
    clean(row.contactCreatedAt) ||
    clean(row.createdAt);
}

export function isCurrentLeadDateScope(row = {}, now = new Date()) {
  const workflowKey = clean(row.workflowKey);
  if (
    workflowKey === WORKFLOW_KEYS.AIT_USA &&
    (
      row.isPipelineEligible === false ||
      lifecycleWorkflowForKey(workflowKey).terminalStatuses.includes(
        normalizeLifecycleStatus(clean(row.currentStage) || clean(row.status), { workflowKey }),
      )
    )
  ) {
    return false;
  }
  const rawDate = leadDateForDirectoryScope(row);
  if (!rawDate && clean(row.workflowKey) === WORKFLOW_KEYS.AIT_SIGNS) return false;
  if (!rawDate) return true;
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) return true;
  const currentYear = now.getUTCFullYear();
  const leadYear = date.getUTCFullYear();
  if (clean(row.workflowKey) === WORKFLOW_KEYS.AIT_SIGNS) return leadYear === currentYear || leadYear === currentYear - 1;
  return leadYear === currentYear;
}
