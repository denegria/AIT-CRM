import {
  aitUsaCourseOutcome,
  aitUsaCourseMetadataForContact,
  completedOrEndedAitUsaCourse,
  currentOrEnrolledAitUsaCourse,
} from './ait-usa-enrollment-signals.js';
import {
  WORKFLOW_KEYS,
  normalizeLifecycleStatus,
} from './crm/lifecycle.js';

export const DEFAULT_CONTACT_STATUS_FILTER = 'All';
export const DEFAULT_CONTACT_OWNER_FILTER = 'all';
export const DEFAULT_CONTACT_FACET_FILTER = 'all';
export const DEFAULT_CONTACT_COURSE_FILTER = 'all';
export const DEFAULT_CONTACT_LEAD_DATE_SCOPE = 'current';

function clean(value = '') {
  return String(value || '').trim();
}

function normalized(value = '') {
  return clean(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function titleLabel(value = '') {
  return clean(value)
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function paramValue(searchParams, key) {
  return typeof searchParams?.get === 'function' ? searchParams.get(key) : '';
}

function canonicalStatus(row = {}) {
  const workflowKey = clean(row.workflowKey);
  return normalizeLifecycleStatus(clean(row.currentStage) || clean(row.status), { workflowKey }) ||
    clean(row.currentStage) ||
    clean(row.status);
}

function isAitUsaCourseStatus(row = {}) {
  const status = canonicalStatus(row);
  return row.workflowKey === WORKFLOW_KEYS.AIT_USA &&
    ['Enrolled', 'Course Completed', 'Dropped / Quit'].includes(status);
}

export function statusFromContactParams(searchParams) {
  return clean(paramValue(searchParams, 'status')) || DEFAULT_CONTACT_STATUS_FILTER;
}

export function ownerFromContactParams(searchParams) {
  return clean(paramValue(searchParams, 'owner')) ||
    clean(paramValue(searchParams, 'ownerUserId')) ||
    DEFAULT_CONTACT_OWNER_FILTER;
}

export function facetFromContactParams(searchParams) {
  return clean(paramValue(searchParams, 'facet')) ||
    clean(paramValue(searchParams, 'directoryFacet')) ||
    DEFAULT_CONTACT_FACET_FILTER;
}

export function leadDateScopeFromContactParams(searchParams) {
  return paramValue(searchParams, 'leadDateScope') === 'all' ? 'all' : DEFAULT_CONTACT_LEAD_DATE_SCOPE;
}

export function courseFromContactParams(searchParams) {
  return clean(paramValue(searchParams, 'course')) || DEFAULT_CONTACT_COURSE_FILTER;
}

export function contactFilterStateFromParams(searchParams) {
  return {
    statusFilter: statusFromContactParams(searchParams),
    ownerFilter: ownerFromContactParams(searchParams),
    directoryFacet: facetFromContactParams(searchParams),
    leadDateScope: leadDateScopeFromContactParams(searchParams),
    courseFilter: courseFromContactParams(searchParams),
  };
}

export function contactFilterQuery({
  statusFilter = DEFAULT_CONTACT_STATUS_FILTER,
  ownerFilter = DEFAULT_CONTACT_OWNER_FILTER,
  directoryFacet = DEFAULT_CONTACT_FACET_FILTER,
  leadDateScope = DEFAULT_CONTACT_LEAD_DATE_SCOPE,
  courseFilter = DEFAULT_CONTACT_COURSE_FILTER,
} = {}) {
  const params = new URLSearchParams();
  if (leadDateScope === 'all') params.set('leadDateScope', 'all');
  if (statusFilter && statusFilter !== DEFAULT_CONTACT_STATUS_FILTER) params.set('status', statusFilter);
  if (ownerFilter && ownerFilter !== DEFAULT_CONTACT_OWNER_FILTER) params.set('owner', ownerFilter);
  if (directoryFacet && directoryFacet !== DEFAULT_CONTACT_FACET_FILTER) params.set('facet', directoryFacet);
  if (courseFilter && courseFilter !== DEFAULT_CONTACT_COURSE_FILTER) params.set('course', courseFilter);
  return params.toString();
}

export function courseForContactDirectoryFilter(contact = {}) {
  if (contact.workflowKey !== WORKFLOW_KEYS.AIT_USA) return '';
  const status = canonicalStatus(contact);
  if (status === 'Enrolled') return currentOrEnrolledAitUsaCourse(contact) || completedOrEndedAitUsaCourse(contact);
  if (['Course Completed', 'Dropped / Quit'].includes(status)) {
    return completedOrEndedAitUsaCourse(contact) || currentOrEnrolledAitUsaCourse(contact);
  }
  const course = aitUsaCourseMetadataForContact(contact);
  return clean(course.current) || clean(course.enrolled) || clean(course.completed) || clean(course.ended);
}

export function contactMatchesStatusOwnerCourse(contact = {}, {
  statusFilter = DEFAULT_CONTACT_STATUS_FILTER,
  ownerFilter = DEFAULT_CONTACT_OWNER_FILTER,
  courseFilter = DEFAULT_CONTACT_COURSE_FILTER,
} = {}) {
  const workflowKey = clean(contact.workflowKey);
  const selectedStatus = normalizeLifecycleStatus(statusFilter, { workflowKey }) || clean(statusFilter);
  const statusMatch =
    statusFilter === DEFAULT_CONTACT_STATUS_FILTER ||
    normalized(canonicalStatus(contact)) === normalized(selectedStatus);
  const ownerMatch =
    ownerFilter === DEFAULT_CONTACT_OWNER_FILTER ||
    (ownerFilter === 'unassigned' && !contact.assignedTo) ||
    contact.assignedTo === ownerFilter;
  const courseMatch =
    courseFilter === DEFAULT_CONTACT_COURSE_FILTER ||
    normalized(courseForContactDirectoryFilter(contact)) === normalized(courseFilter);
  return statusMatch && ownerMatch && courseMatch;
}

export function buildCourseFilterOptions(contacts = []) {
  const byKey = new Map();
  for (const contact of contacts) {
    const label = courseForContactDirectoryFilter(contact);
    const key = normalized(label);
    if (!key) continue;
    const existing = byKey.get(key) || { value: label, label, count: 0 };
    existing.count += 1;
    byKey.set(key, existing);
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function courseTagsForDirectoryRow(row = {}) {
  if (!isAitUsaCourseStatus(row)) return [];
  const course = courseForContactDirectoryFilter(row);
  const outcome = aitUsaCourseOutcome(row);
  return [
    course,
    outcome && canonicalStatus(row) !== 'Course Completed' ? titleLabel(outcome) : '',
  ].filter(Boolean);
}
