import {
  aitUsaCourseOutcome,
  aitUsaCourseMetadataForContact,
  completedAitUsaCourse,
  currentAitUsaCourse,
  endedAitUsaCourse,
} from './ait-usa-enrollment-signals.js';
import {
  WORKFLOW_KEYS,
  normalizeLifecycleStatus,
} from './crm/lifecycle.js';
import {
  directorySourceText,
  isCurrentLeadDateScope,
  leadDateForDirectoryScope,
} from './contact-directory-view.js';

export const DEFAULT_CONTACT_STATUS_FILTER = 'All';
export const DEFAULT_CONTACT_OWNER_FILTER = 'all';
export const DEFAULT_CONTACT_FACET_FILTER = 'all';
export const DEFAULT_CONTACT_COURSE_FILTER = 'all';
export const DEFAULT_CONTACT_SOURCE_FILTER = 'all';
export const DEFAULT_CONTACT_LEAD_DATE_SCOPE = 'current';
export const CONTACT_LEAD_DATE_SCOPE_QUARTER = 'quarter';
export const CONTACT_LEAD_DATE_SCOPE_ALL = 'all';
export const CONTACT_LEAD_DATE_SCOPE_CUSTOM = 'custom';
export const DEFAULT_CONTACT_LEAD_DATE_FROM = '';
export const DEFAULT_CONTACT_LEAD_DATE_TO = '';

export const DEFAULT_PIPELINE_WORKFLOW_FILTER = 'all';
export const DEFAULT_PIPELINE_STATUS_FILTER = DEFAULT_CONTACT_STATUS_FILTER;
export const DEFAULT_PIPELINE_OWNER_FILTER = 'all';
export const DEFAULT_PIPELINE_SOURCE_FILTER = 'all';
export const DEFAULT_PIPELINE_COURSE_FILTER = DEFAULT_CONTACT_COURSE_FILTER;
export const DEFAULT_PIPELINE_ACTIVITY_FILTER = 'all';
export const DEFAULT_PIPELINE_SEARCH = '';
export const DEFAULT_PIPELINE_COMPACT_MODE = true;

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

function dateOnlyTime(value = '', endOfDay = false) {
  const text = clean(value);
  if (!text) return null;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, year, month, day] = match;
    return Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0,
    );
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  if (!endOfDay) return date.getTime();
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    23,
    59,
    59,
    999,
  );
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
  const value = paramValue(searchParams, 'leadDateScope');
  if (
    value === CONTACT_LEAD_DATE_SCOPE_QUARTER ||
    value === CONTACT_LEAD_DATE_SCOPE_ALL ||
    value === CONTACT_LEAD_DATE_SCOPE_CUSTOM
  ) return value;
  return DEFAULT_CONTACT_LEAD_DATE_SCOPE;
}

export function leadDateFromContactParams(searchParams) {
  return clean(paramValue(searchParams, 'leadDateFrom')) || DEFAULT_CONTACT_LEAD_DATE_FROM;
}

export function leadDateToContactParams(searchParams) {
  return clean(paramValue(searchParams, 'leadDateTo')) || DEFAULT_CONTACT_LEAD_DATE_TO;
}

export function courseFromContactParams(searchParams) {
  return clean(paramValue(searchParams, 'course')) || DEFAULT_CONTACT_COURSE_FILTER;
}

export function sourceFromContactParams(searchParams) {
  return clean(paramValue(searchParams, 'source')) || DEFAULT_CONTACT_SOURCE_FILTER;
}

export function contactFilterStateFromParams(searchParams) {
  return {
    statusFilter: statusFromContactParams(searchParams),
    ownerFilter: ownerFromContactParams(searchParams),
    directoryFacet: facetFromContactParams(searchParams),
    leadDateScope: leadDateScopeFromContactParams(searchParams),
    leadDateFrom: leadDateFromContactParams(searchParams),
    leadDateTo: leadDateToContactParams(searchParams),
    courseFilter: courseFromContactParams(searchParams),
    sourceFilter: sourceFromContactParams(searchParams),
  };
}

export function contactFilterQuery({
  statusFilter = DEFAULT_CONTACT_STATUS_FILTER,
  ownerFilter = DEFAULT_CONTACT_OWNER_FILTER,
  directoryFacet = DEFAULT_CONTACT_FACET_FILTER,
  leadDateScope = DEFAULT_CONTACT_LEAD_DATE_SCOPE,
  leadDateFrom = DEFAULT_CONTACT_LEAD_DATE_FROM,
  leadDateTo = DEFAULT_CONTACT_LEAD_DATE_TO,
  courseFilter = DEFAULT_CONTACT_COURSE_FILTER,
  sourceFilter = DEFAULT_CONTACT_SOURCE_FILTER,
} = {}) {
  const params = new URLSearchParams();
  if (leadDateScope === CONTACT_LEAD_DATE_SCOPE_ALL) params.set('leadDateScope', CONTACT_LEAD_DATE_SCOPE_ALL);
  if (leadDateScope === CONTACT_LEAD_DATE_SCOPE_QUARTER) params.set('leadDateScope', CONTACT_LEAD_DATE_SCOPE_QUARTER);
  if (leadDateScope === CONTACT_LEAD_DATE_SCOPE_CUSTOM) {
    params.set('leadDateScope', CONTACT_LEAD_DATE_SCOPE_CUSTOM);
    if (leadDateFrom) params.set('leadDateFrom', leadDateFrom);
    if (leadDateTo) params.set('leadDateTo', leadDateTo);
  }
  if (ownerFilter && ownerFilter !== DEFAULT_CONTACT_OWNER_FILTER) params.set('owner', ownerFilter);
  if (statusFilter && statusFilter !== DEFAULT_CONTACT_STATUS_FILTER) params.set('status', statusFilter);
  if (sourceFilter && sourceFilter !== DEFAULT_CONTACT_SOURCE_FILTER) params.set('source', sourceFilter);
  if (directoryFacet && directoryFacet !== DEFAULT_CONTACT_FACET_FILTER) params.set('facet', directoryFacet);
  if (courseFilter && courseFilter !== DEFAULT_CONTACT_COURSE_FILTER) params.set('course', courseFilter);
  return params.toString();
}

export function contactMatchesLeadDateScope(contact = {}, {
  leadDateScope = DEFAULT_CONTACT_LEAD_DATE_SCOPE,
  leadDateFrom = DEFAULT_CONTACT_LEAD_DATE_FROM,
  leadDateTo = DEFAULT_CONTACT_LEAD_DATE_TO,
  now = new Date(),
} = {}) {
  if (leadDateScope === CONTACT_LEAD_DATE_SCOPE_ALL) return true;
  if (leadDateScope === CONTACT_LEAD_DATE_SCOPE_QUARTER) {
    const nowDate = now instanceof Date ? now : new Date(now);
    const year = nowDate.getUTCFullYear();
    const quarterStartMonth = Math.floor(nowDate.getUTCMonth() / 3) * 3;
    const fromTime = Date.UTC(year, quarterStartMonth, 1);
    const toTime = Date.UTC(year, quarterStartMonth + 3, 0, 23, 59, 59, 999);
    const contactTime = dateOnlyTime(leadDateForDirectoryScope(contact));
    if (contactTime == null) return false;
    return contactTime >= fromTime && contactTime <= toTime;
  }
  if (leadDateScope !== CONTACT_LEAD_DATE_SCOPE_CUSTOM) return isCurrentLeadDateScope(contact, now);

  const fromTime = dateOnlyTime(leadDateFrom);
  const toTime = dateOnlyTime(leadDateTo, true);
  if (fromTime == null && toTime == null) return true;

  const contactTime = dateOnlyTime(leadDateForDirectoryScope(contact));
  if (contactTime == null) return false;
  if (fromTime != null && contactTime < fromTime) return false;
  if (toTime != null && contactTime > toTime) return false;
  return true;
}

export function courseForContactDirectoryFilter(contact = {}) {
  if (contact.workflowKey !== WORKFLOW_KEYS.AIT_USA) return '';
  const status = canonicalStatus(contact);
  if (status === 'Enrolled') return currentAitUsaCourse(contact) || completedAitUsaCourse(contact) || endedAitUsaCourse(contact);
  if (status === 'Course Completed') return completedAitUsaCourse(contact) || endedAitUsaCourse(contact) || currentAitUsaCourse(contact);
  if (status === 'Dropped / Quit') return endedAitUsaCourse(contact) || currentAitUsaCourse(contact) || completedAitUsaCourse(contact);
  const course = aitUsaCourseMetadataForContact(contact);
  return clean(course.current) || clean(course.completed) || clean(course.ended);
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

export function sourceForContactFilter(contact = {}) {
  return directorySourceText(contact);
}

export function contactMatchesSource(contact = {}, {
  sourceFilter = DEFAULT_CONTACT_SOURCE_FILTER,
} = {}) {
  return sourceFilter === DEFAULT_CONTACT_SOURCE_FILTER ||
    normalized(sourceForContactFilter(contact)) === normalized(sourceFilter);
}

export function buildSourceFilterOptions(contacts = []) {
  const byKey = new Map();
  for (const contact of contacts) {
    const label = sourceForContactFilter(contact);
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

export function pipelineFilterStateFromParams(searchParams) {
  return {
    workflowFilter: DEFAULT_PIPELINE_WORKFLOW_FILTER,
    statusFilter: statusFromContactParams(searchParams) || DEFAULT_PIPELINE_STATUS_FILTER,
    ownerFilter: ownerFromContactParams(searchParams) || DEFAULT_PIPELINE_OWNER_FILTER,
    sourceFilter: clean(paramValue(searchParams, 'source')) || DEFAULT_PIPELINE_SOURCE_FILTER,
    courseFilter: courseFromContactParams(searchParams) || DEFAULT_PIPELINE_COURSE_FILTER,
    activityFilter: clean(paramValue(searchParams, 'activity')) || DEFAULT_PIPELINE_ACTIVITY_FILTER,
    search: clean(paramValue(searchParams, 'q')) || DEFAULT_PIPELINE_SEARCH,
    leadDateScope: leadDateScopeFromContactParams(searchParams),
    leadDateFrom: leadDateFromContactParams(searchParams),
    leadDateTo: leadDateToContactParams(searchParams),
    compactMode: paramValue(searchParams, 'compact') === '0' ? false : DEFAULT_PIPELINE_COMPACT_MODE,
  };
}

export function pipelineFilterQuery({
  statusFilter = DEFAULT_PIPELINE_STATUS_FILTER,
  ownerFilter = DEFAULT_PIPELINE_OWNER_FILTER,
  sourceFilter = DEFAULT_PIPELINE_SOURCE_FILTER,
  courseFilter = DEFAULT_PIPELINE_COURSE_FILTER,
  activityFilter = DEFAULT_PIPELINE_ACTIVITY_FILTER,
  search = DEFAULT_PIPELINE_SEARCH,
  leadDateScope = DEFAULT_CONTACT_LEAD_DATE_SCOPE,
  leadDateFrom = DEFAULT_CONTACT_LEAD_DATE_FROM,
  leadDateTo = DEFAULT_CONTACT_LEAD_DATE_TO,
  compactMode = DEFAULT_PIPELINE_COMPACT_MODE,
} = {}) {
  const params = new URLSearchParams();
  if (leadDateScope === CONTACT_LEAD_DATE_SCOPE_ALL) params.set('leadDateScope', CONTACT_LEAD_DATE_SCOPE_ALL);
  if (leadDateScope === CONTACT_LEAD_DATE_SCOPE_QUARTER) params.set('leadDateScope', CONTACT_LEAD_DATE_SCOPE_QUARTER);
  if (leadDateScope === CONTACT_LEAD_DATE_SCOPE_CUSTOM) {
    params.set('leadDateScope', CONTACT_LEAD_DATE_SCOPE_CUSTOM);
    if (leadDateFrom) params.set('leadDateFrom', leadDateFrom);
    if (leadDateTo) params.set('leadDateTo', leadDateTo);
  }
  if (ownerFilter && ownerFilter !== DEFAULT_PIPELINE_OWNER_FILTER) params.set('owner', ownerFilter);
  if (statusFilter && statusFilter !== DEFAULT_PIPELINE_STATUS_FILTER) params.set('status', statusFilter);
  if (sourceFilter && sourceFilter !== DEFAULT_PIPELINE_SOURCE_FILTER) params.set('source', sourceFilter);
  if (courseFilter && courseFilter !== DEFAULT_PIPELINE_COURSE_FILTER) params.set('course', courseFilter);
  if (activityFilter && activityFilter !== DEFAULT_PIPELINE_ACTIVITY_FILTER) params.set('activity', activityFilter);
  if (search) params.set('q', search);
  if (compactMode !== DEFAULT_PIPELINE_COMPACT_MODE) params.set('compact', compactMode ? '1' : '0');
  return params.toString();
}
