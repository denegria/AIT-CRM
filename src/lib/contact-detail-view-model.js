import { WORKFLOW_KEYS, workflowKeyForBusinessUnit } from './crm/lifecycle.js';
import {
  aitUsaCourseOutcome,
  completedAitUsaCourse,
  currentAitUsaCourse,
  endedAitUsaCourse,
} from './ait-usa-enrollment-signals.js';
import { lifecycleBucket } from './contact-directory-view.js';
import { schoolLocationForContact, studentLocationForContact } from './school-locations.js';

function clean(value) {
  return String(value || '').trim();
}

function titleLabel(value = '') {
  return clean(value)
    .replaceAll('_', ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalized(value = '') {
  return clean(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function firstPresent(values = []) {
  return values.map(clean).find(Boolean) || '';
}

function compactArray(values = []) {
  return values.filter((value) => value !== undefined && value !== null && value !== '');
}

function uniqueLabels(values = []) {
  const seen = new Set();
  const labels = [];
  for (const value of values) {
    const label = clean(value);
    const key = normalized(label);
    if (!label || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels;
}

function countFor(counts = {}, key = '') {
  return Number(counts[key] || 0);
}

function contactabilityFor(contact = {}) {
  const signals = contact.enrollmentSignals?.contactability;
  if (signals?.status) return signals;
  const hasPhone = Boolean(clean(contact.phone));
  const hasEmail = Boolean(clean(contact.email));
  if (contact.isDoNotCall) {
    return {
      status: 'do_not_contact',
      label: 'Do Not Contact',
      reason: 'Contact is marked do-not-call.',
      canFollowUp: false,
      hasPhone,
      hasEmail,
    };
  }
  if (contact.isWrongNumber) {
    return {
      status: 'wrong_number',
      label: 'Wrong Number',
      reason: 'Primary phone is marked wrong number.',
      canFollowUp: hasEmail,
      hasPhone,
      hasEmail,
    };
  }
  if (!hasPhone && !hasEmail) {
    return {
      status: 'no_contact_channel',
      label: 'Needs Contact Info',
      reason: 'No phone or email is captured.',
      canFollowUp: false,
      hasPhone,
      hasEmail,
    };
  }
  if (!hasPhone) {
    return {
      status: 'missing_phone',
      label: 'Missing Phone',
      reason: 'Email is available, but no phone is captured.',
      canFollowUp: true,
      hasPhone,
      hasEmail,
    };
  }
  if (!hasEmail) {
    return {
      status: 'missing_email',
      label: 'Missing Email',
      reason: 'Phone is available, but no email is captured.',
      canFollowUp: true,
      hasPhone,
      hasEmail,
    };
  }
  return {
    status: 'reachable',
    label: 'Reachable',
    canFollowUp: true,
    hasPhone,
    hasEmail,
  };
}

const COMMON_FILTERS = {
  all: { value: 'all', label: 'All history', empty: 'No activity recorded yet.' },
  follow_up: { value: 'follow_up', label: 'Follow-ups', empty: 'No follow-up attempts recorded yet.' },
  work: { value: 'work', label: 'Previous work', empty: 'No previous work recorded yet.' },
  estimate: { value: 'estimate', label: 'Estimates', empty: 'No estimate history recorded yet.' },
  payment: { value: 'payment', label: 'Payments', empty: 'No payment snapshots recorded yet.' },
  lead: { value: 'lead', label: 'Enrollment leads', empty: 'No enrollment lead history recorded yet.' },
  note: { value: 'note', label: 'Notes', empty: 'No notes recorded yet.' },
  task: { value: 'task', label: 'Tasks', empty: 'No tasks recorded yet.' },
  message: { value: 'message', label: 'Messages', empty: 'No messages recorded yet.' },
  import: { value: 'import', label: 'Source details', empty: 'No standalone source details recorded yet.' },
};

const SIGNS_SNAPSHOT_ITEMS = [
  { key: 'work', label: 'Previous work', icon: 'work', tone: 'work', empty: 'No previous work yet' },
  { key: 'payment', label: 'Payments', icon: 'payment', tone: 'payment', empty: 'No payment history yet' },
  { key: 'estimate', label: 'Estimates', icon: 'estimate', tone: 'estimate', empty: 'No estimates yet' },
  { key: 'follow_up', label: 'Follow-ups', icon: 'follow_up', tone: 'follow_up', empty: 'No follow-ups yet' },
];

const INSTITUTE_BASE_SNAPSHOT_ITEMS = [
  { key: 'lead', label: 'Inquiry', icon: 'lead', tone: 'lead', empty: 'No inquiry record yet' },
  { key: 'follow_up', label: 'Outreach', icon: 'follow_up', tone: 'follow_up', empty: 'No outreach yet' },
  { key: 'message', label: 'Messages', icon: 'message', tone: 'message', empty: 'No messages yet' },
  { key: 'task', label: 'Tasks', icon: 'task', tone: 'task', empty: 'No tasks yet' },
];

function signsFilters() {
  return [
    COMMON_FILTERS.all,
    COMMON_FILTERS.work,
    COMMON_FILTERS.payment,
    COMMON_FILTERS.estimate,
    COMMON_FILTERS.follow_up,
    COMMON_FILTERS.message,
    COMMON_FILTERS.note,
    COMMON_FILTERS.task,
    COMMON_FILTERS.import,
  ];
}

function instituteFilters(counts = {}) {
  const optionalOperationalFilters = [
    countFor(counts, 'work') > 0 ? { ...COMMON_FILTERS.work, label: 'Related work' } : null,
    countFor(counts, 'payment') > 0 ? { ...COMMON_FILTERS.payment, label: 'Receipts', empty: 'No receipt history recorded yet.' } : null,
  ];
  return compactArray([
    COMMON_FILTERS.all,
    COMMON_FILTERS.lead,
    COMMON_FILTERS.follow_up,
    COMMON_FILTERS.message,
    COMMON_FILTERS.task,
    COMMON_FILTERS.note,
    ...optionalOperationalFilters,
    COMMON_FILTERS.import,
  ]);
}

function instituteSnapshotItems(counts = {}) {
  const optionalOperationalItems = [
    countFor(counts, 'work') > 0 ? { ...SIGNS_SNAPSHOT_ITEMS[0], label: 'Related work' } : null,
    countFor(counts, 'payment') > 0 ? { ...SIGNS_SNAPSHOT_ITEMS[1], label: 'Receipts', empty: 'No receipts yet' } : null,
  ];
  return compactArray([...INSTITUTE_BASE_SNAPSHOT_ITEMS, ...optionalOperationalItems]);
}

function buildInstituteHighlights(contact = {}) {
  const signals = contact.enrollmentSignals || {};
  const inquiry = signals.inquiry || {};
  const source = signals.source || {};
  const process = signals.process || {};
  const contactability = contactabilityFor(contact);
  const program = firstPresent([contact.programInterest, inquiry.programInterest, inquiry.service]);
  const currentCourse = currentAitUsaCourse(contact);
  const completedCourse = completedAitUsaCourse(contact);
  const endedCourse = endedAitUsaCourse(contact);
  const courseOutcome = aitUsaCourseOutcome(contact);
  const sourceChannel = firstPresent([source.channel, contact.inquirySource, contact.source]);
  const sourceSummary = source.detail
    ? [sourceChannel, source.detail].filter(Boolean).join(' · ')
    : firstPresent([contact.sourceDetail, sourceChannel]);
  return compactArray([
    {
      label: 'Inquiry source',
      value: sourceSummary,
    },
    {
      label: 'Program',
      value: program,
    },
    { label: 'Current course', value: normalized(currentCourse) === normalized(program) ? '' : currentCourse },
    { label: 'Completed course', value: completedCourse },
    { label: 'Ended course', value: endedCourse },
    { label: 'Course outcome', value: courseOutcome },
    { label: 'Preferred day', value: firstPresent([contact.preferredDay, inquiry.preferredDay]) },
    { label: 'Schedule', value: firstPresent([contact.preferredSchedule, inquiry.preferredSchedule]) },
    { label: 'Test', value: firstPresent([contact.testInterest, inquiry.testInterest]) },
    { label: 'Level', value: firstPresent([contact.educationLevel, inquiry.level, inquiry.age ? `Age ${inquiry.age}` : '']) },
    { label: 'School', value: firstPresent([contact.schoolName, inquiry.school]) },
    { label: 'Student location', value: studentLocationForContact(contact) },
    { label: 'Intended learning location', value: schoolLocationForContact(contact) },
    {
      label: 'Enrollment stage',
      value: firstPresent([process.stage, contact.currentStage, contact.status]),
    },
    {
      label: 'Contactability',
      value: contactability.label || titleLabel(contactability.status),
      tone: contactability.canFollowUp === false ? 'warning' : contactability.status === 'reachable' ? 'success' : 'default',
    },
  ]).filter((item) => item.value);
}

function buildSignsHighlights(contact = {}, businessUnit = null) {
  const companyName = clean(contact.companyName);
  const accountName = companyName || clean(contact.name);
  const contactPerson = companyName && clean(contact.name) && clean(contact.name).toLowerCase() !== companyName.toLowerCase()
    ? clean(contact.name)
    : '';
  const bucket = lifecycleBucket(contact);
  return compactArray([
    { label: 'Account', value: accountName },
    { label: 'Contact person', value: contactPerson },
    { label: 'Division', value: firstPresent([businessUnit?.name, contact.businessUnitName, contact.workflowLabel]) },
    { label: 'Stage', value: firstPresent([contact.currentStage, contact.status]) },
    { label: 'Bucket', value: bucket.label, tone: bucket.tone === 'muted' ? 'default' : bucket.tone },
    { label: 'Last touch', value: firstPresent([contact.lastTouchLabel, contact.lastTouch, contact.lastContact, 'None']) },
    { label: 'Last edited', value: firstPresent([contact.lastEdited, 'None']) },
  ]).filter((item) => item.value);
}

function instituteActionChip(contact = {}, process = {}, contactability = {}) {
  if (contactability.canFollowUp === false) return 'Needs Contact Info';
  const outreachState = normalized(process.outreachState || contact.outreachState);
  if (contact.needsFirstOutreach || process.needsFirstOutreach || outreachState === 'never contacted') {
    return 'Needs First Outreach';
  }
  if (process.nextAction || contact.nextAction) return 'Needs Follow-up';
  return '';
}

export function buildContactDetailViewModel({
  contact = {},
  businessUnit = null,
  counts = {},
} = {}) {
  const workflowKey = contact.workflowKey || workflowKeyForBusinessUnit(
    businessUnit || contact.businessUnitName || contact.divisionLabel || '',
  );
  const isInstitute = workflowKey === WORKFLOW_KEYS.AIT_USA;
  const isSigns = workflowKey === WORKFLOW_KEYS.AIT_SIGNS;
  const contactability = contactabilityFor(contact);
  const signals = contact.enrollmentSignals || {};
  const process = signals.process || {};
  const source = signals.source || {};

  const hasWorkOrders = countFor(counts, 'work') > 0;

  if (isInstitute) {
    const workflowChips = uniqueLabels([
      instituteActionChip(contact, process, contactability),
    ]);
    return {
      workflowKey,
      profileTitle: 'Enrollment Profile',
      sourceEyebrow: firstPresent([source.channel, contact.inquirySource, contact.source, 'AIT USA Institute']),
      workflowTitle: firstPresent([process.stage, contact.currentStage, contact.status, 'New Lead']),
      workflowNext: firstPresent([
        process.nextAction,
        contact.nextAction,
        contactability.canFollowUp === false ? contactability.reason : '',
      ]),
      workflowChips,
      contactability,
      highlights: buildInstituteHighlights(contact),
      timelineFilters: instituteFilters(counts),
      snapshotItems: instituteSnapshotItems(counts),
      tabs: {
        showWorkOrders: hasWorkOrders,
        showFinancials: countFor(counts, 'payment') > 0,
        financialLabel: 'Receipts',
        workOrdersLabel: 'Work Orders',
      },
    };
  }

  return {
    workflowKey,
    profileTitle: isSigns ? 'Customer Account' : 'Contact Profile',
    sourceEyebrow: firstPresent([businessUnit?.name, contact.businessUnitName, contact.workflowLabel, contact.source]),
    workflowTitle: firstPresent([contact.currentStage, contact.status]),
    workflowNext: contact.nextAction || '',
    workflowChips: contact.tags || [],
    contactability,
    highlights: isSigns ? buildSignsHighlights(contact, businessUnit) : [],
    timelineFilters: isSigns ? signsFilters() : Object.values(COMMON_FILTERS),
    snapshotItems: isSigns ? SIGNS_SNAPSHOT_ITEMS : SIGNS_SNAPSHOT_ITEMS,
    tabs: {
      showWorkOrders: true,
      showFinancials: true,
      financialLabel: 'Financials',
      workOrdersLabel: 'Work Orders',
    },
  };
}
