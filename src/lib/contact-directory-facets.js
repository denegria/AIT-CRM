import { WORKFLOW_KEYS } from './crm/lifecycle.js';
import { isWorkflowStatusClosed } from './sales-workflow.js';
import {
  AIT_USA_CONTACT_BUCKETS,
  CORE_CONTACT_BUCKETS,
  contactHasStatus,
  contactTokens,
  hasContactToken,
  isAitSignsContact,
  isContactDoNotContactBucket,
} from './contact-workflow-buckets.js';
import {
  contactMatchesFollowUpCoverage,
  FOLLOW_UP_COVERAGE_FILTERS,
} from './follow-up-coverage.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_TOUCH_WINDOW_DAYS = 30;

function clean(value) {
  return String(value || '').trim();
}

function normalized(value) {
  return clean(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function token(value) {
  return normalized(value).replace(/\s+/g, '_');
}

function contactBusinessUnit(contact = {}, businessUnitById = new Map()) {
  return businessUnitById.get(contact.businessUnitId || contact.primaryBusinessUnitId) || null;
}

function hasPhone(contact = {}) {
  return Boolean(clean(contact.phone));
}

function phoneDigits(contact = {}) {
  return clean(contact.phone).replace(/\D+/g, '');
}

function hasValidUsPhone(contact = {}) {
  const digits = phoneDigits(contact);
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
}

function hasInvalidPhone(contact = {}) {
  return hasPhone(contact) && !hasValidUsPhone(contact);
}

function hasEmail(contact = {}) {
  return Boolean(clean(contact.email));
}

function needsContactInfo(contact = {}) {
  return !hasPhone(contact) && !hasEmail(contact);
}

function lastTouchTime(contact = {}) {
  const value = clean(contact.lastTouch);
  if (!value || value.toLowerCase() === 'none') return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function isNoRecentTouch(contact = {}, now = Date.now()) {
  const time = lastTouchTime(contact);
  if (!time) return true;
  return now - time > RECENT_TOUCH_WINDOW_DAYS * DAY_MS;
}

function isClosed(contact = {}, options = {}) {
  return isWorkflowStatusClosed(contact.status || contact.currentStage, contactBusinessUnit(contact, options.businessUnitById));
}

function assignedToCurrentUser(contact = {}, options = {}) {
  return Boolean(options.currentUserId) && contact.assignedTo === options.currentUserId;
}

function hasBalanceOrPayment(contact = {}) {
  return isAitSignsContact(contact) && (
    Number(contact.relatedPaymentCount || 0) > 0 ||
    contactHasStatus(contact, 'Invoice / Payment') ||
    hasContactToken(contactTokens(contact), ['balance_due', 'open_payment', 'pending_collection', 'invoice_payment'])
  );
}

function hasLinkedPeople(contact = {}) {
  return isAitSignsContact(contact) && Number(contact.linkedPeopleCount || 0) > 0;
}

function isSourceReview(contact = {}) {
  return isAitSignsContact(contact) && (
    contact.isPipelineEligible === false ||
    hasContactToken(contactTokens(contact), ['source_review', 'import_artifact', 'source_history', 'source_only'])
  );
}

export const CONTACT_DIRECTORY_FACET_GROUPS = [
  {
    id: 'core',
    label: 'Follow-up',
    alwaysVisible: true,
    facets: [
      { id: 'all', label: 'All', matches: () => true },
      { id: 'mine', label: 'Mine', matches: assignedToCurrentUser },
      ...CORE_CONTACT_BUCKETS.filter((facet) => !['unassigned', 'needs_first_outreach'].includes(facet.id)),
      { id: 'no_recent_touch', label: 'No Recent Touch', matches: (contact, options = {}) => isNoRecentTouch(contact, options.now) },
      { id: 'needs_contact_info', label: 'Needs Contact Info', matches: needsContactInfo },
      { id: 'invalid_phone', label: 'Invalid Phone', matches: hasInvalidPhone },
      { id: 'closed', label: 'Closed / Completed', matches: isClosed },
    ],
  },
  {
    id: WORKFLOW_KEYS.AIT_SIGNS,
    label: 'Signs Work',
    workflowKey: WORKFLOW_KEYS.AIT_SIGNS,
    facets: [
      { id: 'signs_intake', label: 'Intake', matches: (contact) => isAitSignsContact(contact) && contactHasStatus(contact, 'Intake') },
      { id: 'signs_estimate', label: 'Estimate', matches: (contact) => isAitSignsContact(contact) && contactHasStatus(contact, 'Estimate') },
      { id: 'signs_work_order', label: 'Work Order', matches: (contact) => isAitSignsContact(contact) && contactHasStatus(contact, 'Work Order') },
      { id: 'signs_fulfillment', label: 'Fulfillment', matches: (contact) => isAitSignsContact(contact) && contactHasStatus(contact, 'Fulfillment') },
      { id: 'signs_invoice_payment', label: 'Invoice / Payment', matches: (contact) => isAitSignsContact(contact) && contactHasStatus(contact, 'Invoice / Payment') },
      { id: 'signs_linked_people', label: 'Has Linked People', matches: hasLinkedPeople },
      { id: 'signs_payment_balance', label: 'Balance / Payment', matches: hasBalanceOrPayment },
    ],
  },
  {
    id: WORKFLOW_KEYS.AIT_USA,
    label: 'Enrollment',
    workflowKey: WORKFLOW_KEYS.AIT_USA,
    facets: [
      {
        id: FOLLOW_UP_COVERAGE_FILTERS.NEEDS_FIRST_CONTACT,
        label: 'Needs first contact',
        matches: (contact) => contactMatchesFollowUpCoverage(contact, FOLLOW_UP_COVERAGE_FILTERS.NEEDS_FIRST_CONTACT),
      },
      {
        id: FOLLOW_UP_COVERAGE_FILTERS.NEEDS_NEXT_FOLLOW_UP,
        label: 'Needs next follow-up',
        matches: (contact) => contactMatchesFollowUpCoverage(contact, FOLLOW_UP_COVERAGE_FILTERS.NEEDS_NEXT_FOLLOW_UP),
      },
      ...AIT_USA_CONTACT_BUCKETS,
    ],
  },
];

function visibleGroup(group, contacts = []) {
  if (group.alwaysVisible) return true;
  return contacts.some((contact) => contact.workflowKey === group.workflowKey);
}

export function buildContactDirectoryFacetGroups(contacts = [], options = {}) {
  return CONTACT_DIRECTORY_FACET_GROUPS
    .filter((group) => visibleGroup(group, contacts))
    .map((group) => ({
      ...group,
      facets: group.facets.map((facet) => ({
        id: facet.id,
        label: facet.label,
        count: contacts.filter((contact) => facet.matches(contact, options)).length,
      })),
    }));
}

export function filterContactsByDirectoryFacet(contacts = [], facetId = 'all', options = {}) {
  if (!facetId || facetId === 'all') return contacts;
  const facet = CONTACT_DIRECTORY_FACET_GROUPS
    .flatMap((group) => group.facets)
    .find((candidate) => candidate.id === facetId);
  if (!facet) return contacts;
  return contacts.filter((contact) => facet.matches(contact, options));
}

export function labelForContactProcessPill(value = '') {
  const labels = {
    active_work: 'Active Work',
    balance_due: 'Balance Due',
    do_not_contact: 'Do Not Contact',
    invalid_phone: 'Invalid Phone',
    missing_email: 'Missing Email',
    missing_phone: 'Missing Phone',
    needs_first_outreach: 'First Outreach',
    needs_review: 'Needs Review',
    no_contact_channel: 'Needs Contact Info',
    open_payment: 'Open Payment',
    ready_for_follow_up: 'Ready Follow-up',
    repeated_no_answer: 'Repeated No Answer',
    retargeting_only: 'Retargeting',
    source_review: 'Source Review',
    suppress_from_follow_up: 'Suppress Follow-up',
    wrong_number: 'Wrong Number',
  };
  const key = token(value);
  if (labels[key]) return labels[key];
  return clean(value)
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function contactDirectorySignalLabels(contact = {}, options = {}) {
  const signals = [];
  const add = (label) => {
    const text = clean(label);
    if (text && !signals.includes(text)) signals.push(text);
  };

  if (!hasPhone(contact)) add('Missing Phone');
  if (hasInvalidPhone(contact)) add('Invalid Phone');
  if (!hasEmail(contact)) add('Missing Email');
  if (isContactDoNotContactBucket(contact)) add('Do Not Contact');
  if (contact.isWrongNumber) add('Wrong Number');
  if (isSourceReview(contact)) add('Source Review');
  if (hasBalanceOrPayment(contact)) add('Balance / Payment');
  for (const pill of contact.processPills || []) {
    if (token(pill) === 'needs_first_outreach') continue;
    add(labelForContactProcessPill(pill));
  }

  return signals.slice(0, 5);
}
