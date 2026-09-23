import { normalizeLifecycleStatus, WORKFLOW_KEYS } from './crm/lifecycle.js';

function clean(value = '') {
  return String(value || '').trim();
}

function normalizedStatus(contact = {}) {
  return normalizeLifecycleStatus(contact.currentStage || contact.status, {
    workflowKey: WORKFLOW_KEYS.AIT_USA,
  }) || clean(contact.currentStage || contact.status);
}

function contactabilityStatus(contact = {}) {
  return clean(
    contact.contactabilityStatus ||
    contact.enrollmentSignals?.contactability?.status,
  ).toLowerCase();
}

function actionable(label, detail, actionLabel) {
  return {
    label,
    detail,
    actionLabel,
    action: 'log_follow_up',
  };
}

export function contactDirectoryNextStep(contact = {}) {
  const coverage = contact.followUpCoverage || {};
  const status = normalizedStatus(contact);
  const contactability = contactabilityStatus(contact);
  const hasContactChannel = Boolean(clean(contact.phone) || clean(contact.email));

  if (contact.opportunityConflict || Number(contact.activeOpportunityCount || 0) > 1) {
    return { label: 'Inquiry conflict', detail: 'Review contact', action: 'none' };
  }

  if (
    contact.isDoNotCall ||
    contact.isWrongNumber ||
    ['do_not_contact', 'wrong_number'].includes(contactability) ||
    status === 'Not Interested'
  ) {
    return { label: 'Contact blocked', detail: 'No outreach action', action: 'none' };
  }

  if (!hasContactChannel || contactability === 'no_contact_channel') {
    return { label: 'Contact info needed', detail: 'Add phone or email', action: 'none' };
  }

  if (coverage.hasActiveDatedCommitment) {
    return { label: 'Follow-up scheduled', detail: 'Commitment on file', action: 'none' };
  }

  if (coverage.needsFirstContact || contact.needsFirstOutreach) {
    return actionable('Needs first outreach', 'No outreach recorded', 'Log outreach');
  }

  if (coverage.needsNextFollowUp) {
    return actionable('Needs next follow-up', 'No commitment on file', 'Log follow-up');
  }

  if (!contact.hasLeadStatus) {
    return { label: 'Data issue', detail: 'Inquiry unavailable', action: 'none' };
  }

  if (Number(contact.activeOpportunityCount || 0) === 0 && status === 'Retargeting') {
    return actionable('Ready for retargeting', 'Outreach may be recorded now', 'Log outreach');
  }

  if (['New Lead', 'Follow Up'].includes(status)) {
    return actionable('No follow-up recorded', 'Record the next outreach', 'Log follow-up');
  }

  if (['Dropped / Quit', 'Course Completed', 'Enrolled'].includes(status)) {
    return { label: 'No active work', detail: status, action: 'none' };
  }

  return { label: 'No active work', detail: status || 'Review contact', action: 'none' };
}
