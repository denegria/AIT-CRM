import { WORKFLOW_KEYS } from './crm/lifecycle.js';
import { isWorkflowStatusClosed } from './sales-workflow.js';

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

function hasToken(values = [], candidates = []) {
  const tokens = new Set((Array.isArray(values) ? values : [values]).map(token).filter(Boolean));
  return candidates.some((candidate) => tokens.has(token(candidate)));
}

function contactTokens(contact = {}) {
  return [
    ...(contact.tags || []),
    ...(contact.processPills || []),
    contact.contactabilityStatus,
    contact.qualityDisposition,
    contact.outreachState,
  ];
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
  return isWorkflowStatusClosed(contact.status, contactBusinessUnit(contact, options.businessUnitById));
}

function isActive(contact = {}, options = {}) {
  return contact.isPipelineEligible !== false && !isClosed(contact, options);
}

function assignedToCurrentUser(contact = {}, options = {}) {
  return Boolean(options.currentUserId) && contact.assignedTo === options.currentUserId;
}

function isAitSigns(contact = {}) {
  return contact.workflowKey === WORKFLOW_KEYS.AIT_SIGNS;
}

function isAitUsa(contact = {}) {
  return contact.workflowKey === WORKFLOW_KEYS.AIT_USA;
}

function hasStatus(contact = {}, status = '') {
  return normalized(contact.status) === normalized(status) || normalized(contact.currentStage) === normalized(status);
}

function hasBalanceOrPayment(contact = {}) {
  return isAitSigns(contact) && (
    Number(contact.relatedPaymentCount || 0) > 0 ||
    hasStatus(contact, 'Invoice / Payment') ||
    hasToken(contactTokens(contact), ['balance_due', 'open_payment', 'pending_collection', 'invoice_payment'])
  );
}

function hasLinkedPeople(contact = {}) {
  return isAitSigns(contact) && Number(contact.linkedPeopleCount || 0) > 0;
}

function isSourceReview(contact = {}) {
  return isAitSigns(contact) && (
    contact.isPipelineEligible === false ||
    hasToken(contactTokens(contact), ['source_review', 'import_artifact', 'source_history', 'source_only'])
  );
}

function readyForFollowUp(contact = {}) {
  return isAitUsa(contact) && hasToken(contactTokens(contact), ['ready_for_follow_up']);
}

function suppressFromFollowUp(contact = {}) {
  return isAitUsa(contact) && (
    contact.isDoNotCall ||
    contact.isWrongNumber ||
    hasToken(contactTokens(contact), ['suppress_from_follow_up', 'do_not_contact', 'wrong_number', 'disconnected'])
  );
}

function wrongOrDisconnected(contact = {}) {
  return isAitUsa(contact) && (
    contact.isWrongNumber ||
    hasToken(contactTokens(contact), ['wrong_number', 'disconnected', 'invalid_number'])
  );
}

function doNotContact(contact = {}) {
  return contact.isDoNotCall || hasToken(contactTokens(contact), ['do_not_contact', 'do_not_call', 'dnc']);
}

function hasBadContactChannel(contact = {}) {
  return suppressFromFollowUp(contact) ||
    wrongOrDisconnected(contact) ||
    doNotContact(contact) ||
    hasToken(contactTokens(contact), ['no_contact_channel']);
}

export const CONTACT_DIRECTORY_FACET_GROUPS = [
  {
    id: 'core',
    label: 'Core',
    alwaysVisible: true,
    facets: [
      { id: 'all', label: 'All', matches: () => true },
      { id: 'mine', label: 'Mine', matches: assignedToCurrentUser },
      { id: 'active', label: 'Active', matches: isActive },
      { id: 'needs_first_outreach', label: 'Needs First Outreach', matches: (contact) => Boolean(contact.needsFirstOutreach) },
      { id: 'unassigned', label: 'Unassigned', matches: (contact) => !contact.assignedTo },
      { id: 'no_recent_touch', label: 'No Recent Touch', matches: (contact, options = {}) => isNoRecentTouch(contact, options.now) },
      { id: 'needs_contact_info', label: 'Needs Contact Info', matches: needsContactInfo },
      { id: 'invalid_phone', label: 'Invalid Phone', matches: hasInvalidPhone },
      { id: 'closed', label: 'Closed / Completed', matches: isClosed },
    ],
  },
  {
    id: WORKFLOW_KEYS.AIT_SIGNS,
    label: 'AIT Signs',
    workflowKey: WORKFLOW_KEYS.AIT_SIGNS,
    facets: [
      { id: 'signs_intake', label: 'Intake', matches: (contact) => isAitSigns(contact) && hasStatus(contact, 'Intake') },
      { id: 'signs_estimate', label: 'Estimate', matches: (contact) => isAitSigns(contact) && hasStatus(contact, 'Estimate') },
      { id: 'signs_work_order', label: 'Work Order', matches: (contact) => isAitSigns(contact) && hasStatus(contact, 'Work Order') },
      { id: 'signs_fulfillment', label: 'Fulfillment', matches: (contact) => isAitSigns(contact) && hasStatus(contact, 'Fulfillment') },
      { id: 'signs_invoice_payment', label: 'Invoice / Payment', matches: (contact) => isAitSigns(contact) && hasStatus(contact, 'Invoice / Payment') },
      { id: 'signs_linked_people', label: 'Has Linked People', matches: hasLinkedPeople },
      { id: 'signs_payment_balance', label: 'Balance / Payment', matches: hasBalanceOrPayment },
    ],
  },
  {
    id: WORKFLOW_KEYS.AIT_USA,
    label: 'AIT USA Institute',
    workflowKey: WORKFLOW_KEYS.AIT_USA,
    facets: [
      { id: 'usa_new_lead', label: 'New Lead', matches: (contact) => isAitUsa(contact) && hasStatus(contact, 'New Lead') },
      { id: 'usa_follow_up', label: 'Needs Follow-up', matches: (contact) => isAitUsa(contact) && (hasStatus(contact, 'Follow Up') || readyForFollowUp(contact)) },
      { id: 'usa_enrolled', label: 'Enrolled', matches: (contact) => isAitUsa(contact) && hasStatus(contact, 'Enrolled') },
      { id: 'usa_not_interested', label: 'Not Interested', matches: (contact) => isAitUsa(contact) && hasStatus(contact, 'Not Interested') },
      {
        id: 'usa_course_completed',
        label: 'Course Completed',
        matches: (contact) => isAitUsa(contact) && hasStatus(contact, 'Course Completed'),
      },
      {
        id: 'usa_bad_contact_channel',
        label: 'Bad Contact Channel',
        matches: (contact) => isAitUsa(contact) && hasBadContactChannel(contact),
      },
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

  if (contact.needsFirstOutreach) add('First Outreach');
  if (!hasPhone(contact)) add('Missing Phone');
  if (hasInvalidPhone(contact)) add('Invalid Phone');
  if (!hasEmail(contact)) add('Missing Email');
  if (doNotContact(contact)) add('Do Not Contact');
  if (contact.isWrongNumber) add('Wrong Number');
  if (isSourceReview(contact)) add('Source Review');
  if (hasBalanceOrPayment(contact)) add('Balance / Payment');
  for (const pill of contact.processPills || []) add(labelForContactProcessPill(pill));

  return signals.slice(0, 5);
}
