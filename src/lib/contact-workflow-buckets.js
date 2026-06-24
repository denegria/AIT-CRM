import { WORKFLOW_KEYS } from './crm/lifecycle.js';
import { isWorkflowContactActive } from './sales-workflow.js';

function clean(value) {
  return String(value || '').trim();
}

function normalized(value) {
  return clean(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function token(value) {
  return normalized(value).replace(/\s+/g, '_');
}

function tokensFor(values = []) {
  return new Set((Array.isArray(values) ? values : [values]).map(token).filter(Boolean));
}

export function contactTokens(contact = {}) {
  return [
    ...(contact.tags || []),
    ...(contact.processPills || []),
    contact.contactabilityStatus,
    contact.qualityDisposition,
    contact.outreachState,
  ];
}

export function hasContactToken(values = [], candidates = []) {
  const tokens = tokensFor(values);
  return candidates.some((candidate) => tokens.has(token(candidate)));
}

export function contactBusinessUnit(contact = {}, businessUnitById = new Map()) {
  return businessUnitById.get(contact.businessUnitId || contact.primaryBusinessUnitId) || null;
}

export function contactHasStatus(contact = {}, status = '') {
  return normalized(contact.status) === normalized(status) || normalized(contact.currentStage) === normalized(status);
}

export function isAitSignsContact(contact = {}) {
  return contact.workflowKey === WORKFLOW_KEYS.AIT_SIGNS;
}

export function isAitUsaContact(contact = {}) {
  return contact.workflowKey === WORKFLOW_KEYS.AIT_USA;
}

export function isActiveContactBucket(contact = {}, options = {}) {
  return isWorkflowContactActive(contact, contactBusinessUnit(contact, options.businessUnitById));
}

export function isNeedsFirstOutreachBucket(contact = {}) {
  return Boolean(contact.needsFirstOutreach);
}

export function isUnassignedBucket(contact = {}) {
  return !contact.assignedTo;
}

export function isAitUsaReadyForFollowUp(contact = {}) {
  return isAitUsaContact(contact) && hasContactToken(contactTokens(contact), ['ready_for_follow_up']);
}

export function isAitUsaFollowUpSuppressed(contact = {}) {
  return isAitUsaContact(contact) && (
    contact.isDoNotCall ||
    contact.isWrongNumber ||
    hasContactToken(contactTokens(contact), ['suppress_from_follow_up', 'do_not_contact', 'wrong_number', 'disconnected'])
  );
}

export function isContactDoNotContactBucket(contact = {}) {
  return contact.isDoNotCall || hasContactToken(contactTokens(contact), ['do_not_contact', 'do_not_call', 'dnc']);
}

export function isAitUsaWrongOrDisconnected(contact = {}) {
  return isAitUsaContact(contact) && (
    contact.isWrongNumber ||
    hasContactToken(contactTokens(contact), ['wrong_number', 'disconnected', 'invalid_number'])
  );
}

export function isAitUsaBadContactChannel(contact = {}) {
  return isAitUsaFollowUpSuppressed(contact) ||
    isAitUsaWrongOrDisconnected(contact) ||
    isContactDoNotContactBucket(contact) ||
    hasContactToken(contactTokens(contact), ['no_contact_channel']);
}

export function isAitUsaNewLeadBucket(contact = {}) {
  return isAitUsaContact(contact) && contactHasStatus(contact, 'New Lead');
}

export function isAitUsaFollowUpBucket(contact = {}) {
  return isAitUsaContact(contact) &&
    !isAitUsaFollowUpSuppressed(contact) &&
    (contactHasStatus(contact, 'Follow Up') || isAitUsaReadyForFollowUp(contact));
}

export function isAitUsaRetargetingBucket(contact = {}) {
  return isAitUsaContact(contact) && contactHasStatus(contact, 'Retargeting');
}

export const CORE_CONTACT_BUCKETS = [
  { id: 'active', label: 'Active', matches: isActiveContactBucket },
  { id: 'needs_first_outreach', label: 'Needs First Outreach', matches: isNeedsFirstOutreachBucket },
  { id: 'unassigned', label: 'Unassigned', matches: isUnassignedBucket },
];

export const AIT_USA_CONTACT_BUCKETS = [
  { id: 'usa_new_lead', label: 'New Lead', matches: isAitUsaNewLeadBucket },
  { id: 'usa_follow_up', label: 'Follow Up', matches: isAitUsaFollowUpBucket },
  { id: 'usa_enrolled', label: 'Enrolled', matches: (contact) => isAitUsaContact(contact) && contactHasStatus(contact, 'Enrolled') },
  { id: 'usa_retargeting', label: 'Retargeting', matches: isAitUsaRetargetingBucket },
  { id: 'usa_not_interested', label: 'Not Interested', matches: (contact) => isAitUsaContact(contact) && contactHasStatus(contact, 'Not Interested') },
  { id: 'usa_course_completed', label: 'Course Completed', matches: (contact) => isAitUsaContact(contact) && contactHasStatus(contact, 'Course Completed') },
  { id: 'usa_bad_contact_channel', label: 'Bad Contact Channel', matches: isAitUsaBadContactChannel },
];

export function isPipelineNewLeadBucket(contact = {}) {
  if (isAitUsaContact(contact)) return isAitUsaNewLeadBucket(contact);
  return /new lead|intake/i.test(String(contact.status || contact.currentStage || ''));
}

export function matchesPipelineQuickFilter(contact = {}, filterId = 'all', options = {}) {
  if (!filterId || filterId === 'all') return true;
  if (filterId === 'new_leads') return isPipelineNewLeadBucket(contact);
  if (filterId === 'needs_first_outreach') return isNeedsFirstOutreachBucket(contact);
  if (filterId === 'active') return isActiveContactBucket(contact, options);
  if (filterId === 'unassigned') return isUnassignedBucket(contact);
  return true;
}
