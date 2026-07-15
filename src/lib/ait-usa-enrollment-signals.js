import { WORKFLOW_KEYS } from './crm/lifecycle.js';
import { canonicalAitUsaSchoolLocation } from './school-locations.js';

function clean(value) {
  return String(value || '').trim();
}

function normalized(value) {
  return clean(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === null || entry === undefined || entry === '') return false;
      if (Array.isArray(entry) && !entry.length) return false;
      if (typeof entry === 'object' && !Array.isArray(entry) && !Object.keys(entry).length) return false;
      return true;
    }),
  );
}

function unique(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = clean(value);
    const key = normalized(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

export function parseLeadNoteFields(value = '') {
  const fields = {};
  for (const part of clean(value).split('|')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex < 0) continue;
    const key = clean(part.slice(0, separatorIndex));
    const rawValue = clean(part.slice(separatorIndex + 1));
    if (!key || !rawValue || rawValue === 'none' || rawValue === 'unknown') continue;
    fields[key] = rawValue;
  }
  return fields;
}

function parseTags(value = '') {
  return unique(clean(value).split(/[;,]/));
}

function firstPresent(values = []) {
  return values.map(clean).find(Boolean) || '';
}

function fieldValue(fields = {}, aliases = []) {
  for (const key of aliases) {
    const value = clean(fields[key]);
    if (value) return value;
  }
  return '';
}

export function aitUsaCourseMetadataFromFields(fields = {}, fallback = {}) {
  const current = firstPresent([
    fieldValue(fields, ['current_course', 'course']),
    fallback.currentCourse,
    fieldValue(fields, ['enrolled_course']),
    fallback.enrolledCourse,
  ]);
  const completed = firstPresent([
    fieldValue(fields, ['completed_course', 'course_completed', 'finished_course']),
    fallback.completedCourse,
  ]);
  const ended = firstPresent([
    fieldValue(fields, ['ended_course', 'last_course']),
    fallback.endedCourse,
    fieldValue(fields, ['dropped_course', 'quit_course']),
  ]);
  const outcome = firstPresent([
    fieldValue(fields, ['course_outcome', 'outcome', 'completion_outcome', 'end_reason']),
    fallback.courseOutcome,
  ]);
  const resolvedEnded = normalized(ended) === normalized(completed) ? '' : ended;

  return compactObject({
    current,
    completed,
    ended: resolvedEnded,
    outcome,
  });
}

export function aitUsaCourseMetadataForContact(contact = {}) {
  const course = contact.enrollmentSignals?.course || {};
  return aitUsaCourseMetadataFromFields({}, {
    currentCourse: course.current || course.enrolled,
    completedCourse: course.completed,
    endedCourse: course.ended,
    courseOutcome: course.outcome,
  });
}

export function currentAitUsaCourse(contact = {}) {
  const course = aitUsaCourseMetadataForContact(contact);
  return firstPresent([course.current]);
}

export function completedAitUsaCourse(contact = {}) {
  const course = aitUsaCourseMetadataForContact(contact);
  return firstPresent([course.completed]);
}

export function endedAitUsaCourse(contact = {}) {
  const course = aitUsaCourseMetadataForContact(contact);
  return firstPresent([course.ended]);
}

export function aitUsaCourseOutcome(contact = {}) {
  return clean(aitUsaCourseMetadataForContact(contact).outcome);
}

function displaySourceChannel({ sourceName = '', sourceType = '', sourceKey = '' } = {}) {
  const source = normalized(sourceName || sourceKey || sourceType);
  if (source.includes('facebook') || source.includes('messenger')) return 'Facebook Messenger';
  if (source.includes('wix historical') || source.includes('wix history')) return 'Wix Historical Import';
  if (source.includes('wix')) return 'Wix Website Form';
  if (source.includes('wordpress')) return 'WordPress Website Form';
  if (source.includes('website')) return 'Website Form';
  return clean(sourceName || sourceType || sourceKey);
}

function contactabilityForContact(contact = {}) {
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

function qualityDisposition(contactability) {
  if (['do_not_contact', 'wrong_number'].includes(contactability.status)) return 'suppress_from_follow_up';
  if (contactability.status === 'no_contact_channel') return 'needs_review';
  return 'ready_for_follow_up';
}

function buildProcessPills({ workflow = {}, fields = {}, tags = [], contactability = {}, disposition = '' } = {}) {
  const pills = new Set();
  const status = normalized(workflow.status);
  if (status) pills.add(status.replace(/\s+/g, '_'));
  if (workflow.needsFirstOutreach || normalized(fields.outreach_state) === 'never contacted') {
    pills.add('needs_first_outreach');
  }
  if (disposition) pills.add(disposition);
  if (contactability.status && contactability.status !== 'reachable') pills.add(contactability.status);
  if (contactability.hasPhone === false) pills.add('missing_phone');
  if (contactability.hasEmail === false) pills.add('missing_email');
  for (const tag of tags) {
    const tagKey = normalized(tag).replace(/\s+/g, '_');
    if (tagKey) pills.add(tagKey);
  }
  return [...pills];
}

export function buildAitUsaEnrollmentSignals({ contact = {}, lead = null, workflow = {} } = {}) {
  if (workflow.workflowKey && workflow.workflowKey !== WORKFLOW_KEYS.AIT_USA) return null;
  const fields = parseLeadNoteFields(lead?.originalNotes);
  const tags = unique([
    ...parseTags(fields.tags),
    ...(workflow.tags || []),
  ]);
  const sourceChannel = displaySourceChannel({
    sourceName: lead?.sourceName,
    sourceType: lead?.sourceType,
    sourceKey: fields.source_key,
  });
  const contactability = contactabilityForContact(contact);
  const disposition = qualityDisposition(contactability);
  const stage = clean(lead?.currentStage || fields.current_stage || lead?.status || workflow.status);
  const programInterest = clean(fields.service);
  const course = aitUsaCourseMetadataFromFields(fields, {
    programInterest,
    currentCourse: workflow.currentCourse,
    completedCourse: workflow.completedCourse,
    endedCourse: workflow.endedCourse,
    courseOutcome: workflow.courseOutcome,
  });
  const processState = compactObject({
    stage,
    status: clean(workflow.status || lead?.status),
    outreachState: clean(fields.outreach_state || workflow.outreachState),
    priority: clean(fields.priority || workflow.priority),
    nextAction: clean(fields.next_action || workflow.nextAction),
    needsFirstOutreach: Boolean(workflow.needsFirstOutreach || fields.outreach_state === 'never_contacted'),
    pills: buildProcessPills({ workflow, fields, tags, contactability, disposition }),
  });

  return compactObject({
    workflowKey: WORKFLOW_KEYS.AIT_USA,
    source: compactObject({
      channel: sourceChannel,
      sourceType: clean(lead?.sourceType),
      sourceName: clean(lead?.sourceName),
      sourceKey: clean(fields.source_key),
      externalId: clean(fields.external_id),
      sourceRowId: clean(fields.source_row_id),
      tags,
    }),
    inquiry: compactObject({
      service: clean(fields.service),
      programInterest,
      location: clean(lead?.locationPreference || fields.address),
      intendedLearningLocation: canonicalAitUsaSchoolLocation(contact.address),
      age: clean(fields.age),
      formFields: clean(fields.form_fields),
      message: clean(fields.message),
    }),
    course,
    process: processState,
    contactability,
    quality: compactObject({
      disposition,
      flags: processState.pills?.filter((pill) => [
        'missing_phone',
        'missing_email',
        'no_contact_channel',
        'wrong_number',
        'do_not_contact',
      ].includes(pill)) || [],
    }),
  });
}
