import { isTaskOpen, isTaskOverdue, taskDateKey } from './tasks/visibility.js';

function clean(value = '') {
  return String(value || '').trim();
}

function ownerLabel(task = {}, ownerOptions = []) {
  if (!task.ownerUserId) return 'Unassigned';
  return ownerOptions.find((owner) => owner.id === task.ownerUserId)?.label || 'Assigned employee';
}

function taskHref(contactId = '') {
  const params = new URLSearchParams({
    contactId: clean(contactId),
    taskType: 'follow_up',
  });
  return `/tasks?${params.toString()}`;
}

function logFollowUpHref(contactId = '') {
  return `/contacts/${encodeURIComponent(clean(contactId))}?action=log-follow-up`;
}

function inquiryStatus(contact = {}) {
  return clean(contact.status || contact.currentStage) || 'Not recorded';
}

function inquiryFacts(contact = {}, studentLocation = '') {
  const hasExplicitLeadProfile = Boolean(contact.leadProfile && typeof contact.leadProfile === 'object');
  const program = clean(
    hasExplicitLeadProfile
      ? contact.leadProfile.programInterest
      : contact.programInterest,
  );

  return {
    status: inquiryStatus(contact),
    program: program || 'Not recorded',
    studentLocation: clean(studentLocation) || 'Not recorded',
  };
}

export function scopedOpenFollowUpTasks(payload = {}) {
  return Array.isArray(payload.tasks)
    ? payload.tasks.filter((task) => task.taskType === 'follow_up' && isTaskOpen(task))
    : [];
}

export function buildContactSidebarInquiry({ contact = {}, studentLocation = '' } = {}) {
  const activeInquiryCount = Number(contact.activeOpportunityCount || 0);
  const hasActiveCount = contact.activeOpportunityCount !== undefined && contact.activeOpportunityCount !== null;

  if (contact.opportunityConflict || activeInquiryCount > 1) {
    return {
      kind: 'conflict',
      title: 'Multiple active inquiries',
      detail: 'Review inquiries before treating one status, program, or owner as current.',
    };
  }

  if (!contact.hasLeadStatus) {
    return {
      kind: 'missing',
      heading: 'Inquiry history',
      title: 'Inquiry history unavailable',
      detail: 'This record does not have the inquiry history required by the current data model.',
    };
  }

  if (hasActiveCount && activeInquiryCount === 0) {
    return {
      kind: 'history',
      heading: 'Last inquiry',
      facts: inquiryFacts(contact, studentLocation),
    };
  }

  return {
    kind: 'active',
    heading: 'Current inquiry',
    facts: inquiryFacts(contact, studentLocation),
  };
}

export function buildContactSidebarNextStep({
  contact = {},
  tasks = [],
  ownerOptions = [],
  contactability = {},
  canSeeAllTasks = false,
  now = new Date(),
} = {}) {
  const openTasks = (Array.isArray(tasks) ? tasks : [])
    .filter((task) => task.taskType === 'follow_up' && isTaskOpen(task));
  const reviewHref = taskHref(contact.id);
  const activeInquiryCount = Number(contact.activeOpportunityCount || 0);
  const hasActiveCount = contact.activeOpportunityCount !== undefined && contact.activeOpportunityCount !== null;
  const hasActiveInquiry = contact.hasLeadStatus && (!hasActiveCount || activeInquiryCount > 0);
  const status = inquiryStatus(contact);
  const normalizedStatus = status.toLowerCase();

  if (contact.opportunityConflict || activeInquiryCount > 1) {
    return {
      kind: 'inquiry_conflict',
      stateLabel: 'Inquiry conflict',
      title: `${activeInquiryCount || 'Multiple'} active inquiries need review`,
      detail: 'Resolve the conflict before changing stage, owner, or follow-up context.',
      actionLabel: 'Review inquiries',
      actionHref: `/pipeline?q=${encodeURIComponent(clean(contact.name))}`,
      taskCount: openTasks.length,
    };
  }

  const noContactChannel = !clean(contact.phone) && !clean(contact.email);
  if (noContactChannel || contactability.status === 'no_contact_channel') {
    return {
      kind: 'missing_contact',
      stateLabel: 'Contact info needed',
      title: 'Add a phone number or email first',
      detail: 'Outreach cannot be recorded without a usable contact channel.',
      actionLabel: 'Add contact info',
      actionType: 'edit',
      taskCount: openTasks.length,
    };
  }

  if (contactability.canFollowUp === false) {
    const isHardRestriction = contactability.status === 'do_not_contact';
    return {
      kind: 'restricted',
      stateLabel: 'Outreach blocked',
      title: contactability.label || 'Review contact restriction',
      detail: contactability.reason || 'This contact is not currently available for outreach.',
      actionLabel: isHardRestriction ? 'Outreach blocked' : 'Update contact info',
      actionType: isHardRestriction ? 'disabled' : 'edit',
      taskCount: openTasks.length,
      task: openTasks[0] || null,
    };
  }

  if (openTasks.length > 1) {
    return {
      kind: 'multiple',
      stateLabel: 'Needs review',
      title: `${openTasks.length} open follow-ups`,
      detail: 'Review the task queue before recording another commitment.',
      actionLabel: 'Review follow-ups',
      actionHref: reviewHref,
      taskCount: openTasks.length,
    };
  }

  const task = openTasks[0] || null;
  if (task) {
    const dueAt = task.snoozedUntil || task.dueAt || task.dueDate || null;
    const overdue = !task.snoozedUntil && isTaskOverdue(task, taskDateKey(now));
    return {
      kind: overdue ? 'overdue' : 'scheduled',
      stateLabel: overdue ? 'Overdue' : task.snoozedUntil ? 'Snoozed' : dueAt ? 'Scheduled' : 'Needs date',
      title: task.title || 'Follow-up',
      detail: dueAt ? (overdue ? 'Due date has passed' : task.snoozedUntil ? 'Returns to the queue' : 'Next committed outreach') : 'No due date is set',
      dueAt,
      ownerLabel: ownerLabel(task, ownerOptions),
      actionLabel: overdue ? 'Log overdue outcome' : 'Log outcome',
      actionHref: `/tasks?action=log-follow-up&taskId=${encodeURIComponent(task.id)}&contactId=${encodeURIComponent(task.contactId || contact.id || '')}&leadId=${encodeURIComponent(task.leadId || '')}`,
      openHref: `/tasks/${encodeURIComponent(task.id)}`,
      taskCount: 1,
      task,
    };
  }

  if (hasActiveInquiry && contact.needsFirstOutreach) {
    return {
      kind: 'first_outreach',
      stateLabel: 'Needs first outreach',
      title: 'First outreach has not been recorded',
      detail: 'Record the outreach attempt and its outcome.',
      actionLabel: 'Log follow-up',
      actionHref: logFollowUpHref(contact.id),
      taskCount: 0,
    };
  }

  if (!contact.hasLeadStatus) {
    return {
      kind: 'missing_inquiry',
      stateLabel: 'Data issue',
      title: 'Inquiry history unavailable',
      detail: 'Review this record before recording outreach.',
      actionType: 'none',
      taskCount: 0,
    };
  }

  if (!hasActiveInquiry && normalizedStatus === 'retargeting') {
    return {
      kind: 'retargeting',
      stateLabel: 'Ready for retargeting',
      title: 'Renewed outreach may be recorded',
      detail: 'Schedule only when the contact agrees to a specific future commitment.',
      actionLabel: 'Log follow-up',
      actionHref: logFollowUpHref(contact.id),
      taskCount: 0,
    };
  }

  if (!hasActiveInquiry && normalizedStatus === 'not interested') {
    return {
      kind: 'closed_blocked',
      stateLabel: 'Outreach closed',
      title: 'Outreach is closed',
      detail: 'The last inquiry is marked Not Interested.',
      actionType: 'none',
      taskCount: 0,
    };
  }

  if (!hasActiveInquiry) {
    return {
      kind: 'closed',
      stateLabel: 'Inquiry closed',
      title: 'No action scheduled',
      detail: status === 'Not recorded'
        ? 'Review the last inquiry history before recording new outreach.'
        : `The last inquiry ended as ${status}.`,
      actionType: 'none',
      taskCount: 0,
    };
  }

  return {
    kind: 'empty',
    stateLabel: 'No outreach recorded',
    title: canSeeAllTasks ? 'No follow-up recorded' : 'No follow-up assigned to you',
    detail: canSeeAllTasks
      ? 'Record the next outreach attempt and its outcome.'
      : 'Record outreach if you are responsible for the next attempt.',
    actionLabel: 'Log follow-up',
    actionHref: logFollowUpHref(contact.id),
    taskCount: 0,
  };
}
