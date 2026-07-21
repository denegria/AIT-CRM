import { WORKFLOW_KEYS, normalizeLifecycleStatus } from './crm/lifecycle.js';
import { isAitUsaFollowUpSuppressed } from './contact-workflow-buckets.js';

export const FOLLOW_UP_COVERAGE_FILTERS = Object.freeze({
  ALL: 'all',
  NEEDS_FIRST_CONTACT: 'needs_first_contact',
  NEEDS_NEXT_FOLLOW_UP: 'needs_next_follow_up',
});

export const FOLLOW_UP_COVERAGE_OPTIONS = Object.freeze([
  Object.freeze({
    id: FOLLOW_UP_COVERAGE_FILTERS.NEEDS_FIRST_CONTACT,
    label: 'Needs first contact',
    description: 'No genuine interaction and no dated next commitment',
  }),
  Object.freeze({
    id: FOLLOW_UP_COVERAGE_FILTERS.NEEDS_NEXT_FOLLOW_UP,
    label: 'Needs next follow-up',
    description: 'Prior interaction but no dated next commitment',
  }),
]);

function clean(value = '') {
  return String(value || '').trim();
}

function normalized(value = '') {
  return clean(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

export function isGenuineHumanActivityEvent(event = {}) {
  const rawType = clean(event.eventType).toLowerCase();
  const type = normalized(rawType);
  if (!rawType || rawType === 'website_lead_captured') return false;
  return /^follow_up\.[a-z_]+$/.test(rawType) ||
    type.includes('manual outbound') ||
    type.includes('call') ||
    type.includes('sms') ||
    type.includes('whatsapp') ||
    type.includes('message');
}

export function isFollowUpCoverageEligible(contact = {}) {
  if (contact.workflowKey !== WORKFLOW_KEYS.AIT_USA) return false;
  if (contact.archivedAt || contact.isDoNotCall || contact.isWrongNumber) return false;
  if (isAitUsaFollowUpSuppressed(contact)) return false;
  const status = normalizeLifecycleStatus(contact.currentStage || contact.status, {
    workflowKey: WORKFLOW_KEYS.AIT_USA,
  }) || contact.currentStage || contact.status;
  return ['New Lead', 'Follow Up'].includes(status);
}

export function followUpCoverageForContact(contact = {}, evidence = {}) {
  const eligible = isFollowUpCoverageEligible(contact);
  const hasHumanInteraction = Boolean(
    evidence.hasHumanInteraction ??
    contact.followUpCoverage?.hasHumanInteraction ??
    contact.hasHumanInteraction,
  );
  const hasActiveDatedCommitment = Boolean(
    evidence.hasActiveDatedCommitment ??
    contact.followUpCoverage?.hasActiveDatedCommitment ??
    contact.hasActiveDatedCommitment,
  );
  return {
    eligible,
    hasHumanInteraction,
    hasActiveDatedCommitment,
    needsFirstContact: eligible && !hasHumanInteraction && !hasActiveDatedCommitment,
    needsNextFollowUp: eligible && hasHumanInteraction && !hasActiveDatedCommitment,
  };
}

export function contactMatchesFollowUpCoverage(contact = {}, filter = FOLLOW_UP_COVERAGE_FILTERS.ALL) {
  if (!filter || filter === FOLLOW_UP_COVERAGE_FILTERS.ALL) return true;
  const coverage = contact.followUpCoverage || followUpCoverageForContact(contact);
  if (filter === FOLLOW_UP_COVERAGE_FILTERS.NEEDS_FIRST_CONTACT) return Boolean(coverage.needsFirstContact);
  if (filter === FOLLOW_UP_COVERAGE_FILTERS.NEEDS_NEXT_FOLLOW_UP) return Boolean(coverage.needsNextFollowUp);
  return true;
}

export function followUpCoverageLabel(contact = {}) {
  const coverage = contact.followUpCoverage || followUpCoverageForContact(contact);
  if (coverage.needsFirstContact) return 'Needs first contact';
  if (coverage.needsNextFollowUp) return 'Needs next follow-up';
  return '';
}
