import { deterministicImportUuid, validateRosterManifest } from './manifest.js';

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const INACTIVE_LIFECYCLE_PROTECTIONS = new Set(['Enrolled', 'Follow Up', 'Not Interested', 'Course Completed']);

function cleanText(value = '') {
  return String(value || '').trim();
}

function normalizedName(value = '') {
  return cleanText(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizedPhone(value = '') {
  const digits = cleanText(value).replace(/\D+/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function splitIds(value = '') {
  return cleanText(value).split(';').map((item) => item.trim()).filter(Boolean);
}

function contactActionName(row) {
  return cleanText(row.final_contact_action || row.contact_action);
}

function courseActionName(row) {
  return cleanText(row.proposed_course_action || row.proposed_enrollment_action);
}

function isUuid(value) {
  return UUID_PATTERN.test(cleanText(value));
}

function plannedReference(row) {
  return cleanText(row.planned_contact_reference);
}

function currentStatus(snapshot, contactId) {
  return cleanText(snapshot.latestLeadStatusByContact?.[contactId]);
}

function lifecyclePlan(manifest, row, contactId, snapshot) {
  const liveStatus = currentStatus(snapshot, contactId);
  if (manifest.lane !== 'inactive') {
    return liveStatus
      ? { operation: 'preserve', liveStatus, reason: 'active lane preserves an existing lifecycle' }
      : { operation: 'set_enrolled', liveStatus: '', reason: 'new active student needs an enrolled lifecycle' };
  }
  if (cleanText(row.active_roster_overlap).toLowerCase() === 'yes' || INACTIVE_LIFECYCLE_PROTECTIONS.has(liveStatus)) {
    return { operation: 'preserve', liveStatus, reason: 'active roster or newer CRM lifecycle is protected' };
  }
  return { operation: 'set_dropped_quit', liveStatus, reason: 'inactive manifest requires dropped/quit after live recheck' };
}

function contactIdentity(row) {
  return {
    name: cleanText(row.student_name),
    phone: cleanText(row.primary_phone),
    normalizedName: normalizedName(row.student_name),
    normalizedPhone: normalizedPhone(row.primary_phone),
  };
}

function findLateExactContact(snapshot, identity) {
  if (!identity.normalizedName || !identity.normalizedPhone) return null;
  return snapshot.contacts.find((contact) => (
    normalizedName(contact.name) === identity.normalizedName &&
    normalizedPhone(contact.phone) === identity.normalizedPhone &&
    !contact.archivedAt
  )) || null;
}

function contactTarget(row, snapshot) {
  const reference = plannedReference(row);
  const directId = cleanText(row.target_contact_id) || (isUuid(reference) ? reference : '');
  if (directId) return { id: directId, kind: 'existing' };
  const lateMatch = findLateExactContact(snapshot, contactIdentity(row));
  if (lateMatch) return { id: lateMatch.id, kind: 'late_exact_match' };
  return { id: deterministicImportUuid(row.idempotencyKey), kind: 'planned_new' };
}

function planContactAction(manifest, row, snapshot, resolvedReferences) {
  const action = contactActionName(row);
  if (snapshot.appliedActionKeys.has(row.idempotencyKey)) {
    return { idempotencyKey: row.idempotencyKey, entity: 'contact', state: 'skip', operation: 'replay', reason: 'idempotency key already applied' };
  }
  if (action.startsWith('defer') || action.startsWith('hold')) {
    return { idempotencyKey: row.idempotencyKey, entity: 'contact', state: 'held', operation: 'none', reason: action };
  }
  const identity = contactIdentity(row);
  if (!identity.name || !identity.normalizedPhone) {
    return { idempotencyKey: row.idempotencyKey, entity: 'contact', state: 'error', operation: 'none', reason: 'resolved Contact action lacks usable name or phone' };
  }
  const target = contactTarget(row, snapshot);
  const liveTarget = snapshot.contacts.find((contact) => contact.id === target.id) || null;
  if (target.kind === 'existing' && !liveTarget) {
    return { idempotencyKey: row.idempotencyKey, entity: 'contact', state: 'error', operation: 'none', targetContactId: target.id, reason: 'manifest target Contact no longer exists' };
  }
  const duplicateIds = splitIds(row.duplicate_contact_ids).filter((id) => id !== target.id);
  const missingDuplicateIds = duplicateIds.filter((id) => !snapshot.contacts.some((contact) => contact.id === id));
  if (missingDuplicateIds.length) {
    return { idempotencyKey: row.idempotencyKey, entity: 'contact', state: 'error', operation: 'none', targetContactId: target.id, reason: `duplicate Contact missing: ${missingDuplicateIds.join(', ')}` };
  }
  const reference = plannedReference(row);
  if (reference) resolvedReferences.set(reference, target.id);
  if (row.identity_key) resolvedReferences.set(cleanText(row.identity_key), target.id);

  const phoneChanged = Boolean(liveTarget && normalizedPhone(liveTarget.phone) !== identity.normalizedPhone);
  const result = {
    idempotencyKey: row.idempotencyKey,
    entity: 'contact',
    state: duplicateIds.length ? 'blocked' : 'ready',
    operation: duplicateIds.length ? 'merge_contacts' : (liveTarget ? 'reuse_contact' : 'create_contact'),
    targetContactId: target.id,
    duplicateContactIds: duplicateIds,
    identity,
    historicalPhones: splitIds(row.historical_phone_options),
    primaryPhoneOperation: phoneChanged ? 'replace_primary_preserve_previous' : 'ensure_primary_history',
    lifecycle: lifecyclePlan(manifest, row, target.id, snapshot),
    reason: duplicateIds.length
      ? 'physical Contact merge needs a separately verified relationship-reparent plan'
      : target.kind,
  };
  return result;
}

function planSectionAction(row, snapshot) {
  if (snapshot.appliedActionKeys.has(row.idempotencyKey)) {
    return { idempotencyKey: row.idempotencyKey, entity: 'class_section', state: 'skip', operation: 'replay', reason: 'idempotency key already applied' };
  }
  if (!cleanText(row.sectionKey) || !cleanText(row.courseName)) {
    return { idempotencyKey: row.idempotencyKey, entity: 'class_section', state: 'held', operation: 'none', reason: 'section definition is incomplete' };
  }
  const existing = snapshot.classSections.find((section) => section.sectionKey === row.sectionKey);
  return {
    idempotencyKey: row.idempotencyKey,
    entity: 'class_section',
    state: 'ready',
    operation: existing ? 'upsert_section' : 'create_section',
    targetSectionId: existing?.id || deterministicImportUuid(row.idempotencyKey),
    section: row,
    reason: existing ? 'stable section key exists and will be reconciled' : 'new stable section key',
  };
}

function resolveCourseContact(row, resolvedReferences) {
  const reference = plannedReference(row);
  if (isUuid(reference)) return reference;
  return resolvedReferences.get(reference) || resolvedReferences.get(cleanText(row.identity_key)) || '';
}

function planCourseAction(manifest, row, snapshot, resolvedReferences, sectionPlans) {
  const action = courseActionName(row);
  if (snapshot.appliedActionKeys.has(row.idempotencyKey)) {
    return { idempotencyKey: row.idempotencyKey, entity: manifest.lane === 'active' ? 'enrollment' : 'course', state: 'skip', operation: 'replay', reason: 'idempotency key already applied' };
  }
  if (!action.startsWith('insert')) {
    return { idempotencyKey: row.idempotencyKey, entity: manifest.lane === 'active' ? 'enrollment' : 'course', state: 'held', operation: 'none', reason: action };
  }
  const contactId = resolveCourseContact(row, resolvedReferences);
  if (!contactId) {
    return { idempotencyKey: row.idempotencyKey, entity: manifest.lane === 'active' ? 'enrollment' : 'course', state: 'error', operation: 'none', reason: 'course row cannot resolve its Contact target' };
  }
  const mappedCourse = cleanText(row.mapped_course);
  if (!mappedCourse) {
    return { idempotencyKey: row.idempotencyKey, entity: manifest.lane === 'active' ? 'enrollment' : 'course', state: 'held', operation: 'none', targetContactId: contactId, reason: 'course definition is unresolved' };
  }
  const duplicate = snapshot.courseRecords.find((record) => (
    record.metadataJson?.importIdempotencyKey === row.idempotencyKey ||
    (record.contactId === contactId && cleanText(record.courseName) === mappedCourse && cleanText(record.status) === cleanText(row.course_status) && cleanText(record.startDate) === cleanText(row.start_date) && cleanText(record.endDate) === cleanText(row.end_date))
  ));
  if (duplicate) {
    return { idempotencyKey: row.idempotencyKey, entity: manifest.lane === 'active' ? 'enrollment' : 'course', state: 'skip', operation: 'existing_record', targetContactId: contactId, targetCourseRecordId: duplicate.id, reason: 'equivalent course record already exists' };
  }
  const sectionKey = cleanText(row.resolved_class_section_key);
  const sectionPlan = sectionKey ? sectionPlans.get(sectionKey) : null;
  if (manifest.lane === 'active' && !sectionPlan) {
    return { idempotencyKey: row.idempotencyKey, entity: 'enrollment', state: 'held', operation: 'none', targetContactId: contactId, reason: 'active enrollment has no resolved class section' };
  }
  return {
    idempotencyKey: row.idempotencyKey,
    entity: manifest.lane === 'active' ? 'enrollment' : 'course',
    state: 'ready',
    operation: 'insert_course_record',
    targetContactId: contactId,
    targetCourseRecordId: deterministicImportUuid(row.idempotencyKey),
    targetSectionId: sectionPlan?.targetSectionId || null,
    course: row,
    reason: 'manifest row is actionable after live duplicate and identity recheck',
  };
}

function summarize(actions) {
  return actions.reduce((counts, action) => {
    const key = `${action.state}:${action.operation}`;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

export function buildRosterImportPlan(manifest, rawSnapshot = {}, options = {}) {
  validateRosterManifest(manifest, options);
  const snapshot = {
    contacts: rawSnapshot.contacts || [],
    latestLeadStatusByContact: rawSnapshot.latestLeadStatusByContact || {},
    classSections: rawSnapshot.classSections || [],
    courseRecords: rawSnapshot.courseRecords || [],
    appliedActionKeys: new Set(rawSnapshot.appliedActionKeys || []),
    completedManifestShas: new Set(rawSnapshot.completedManifestShas || []),
  };
  const sequenceErrors = [];
  if (manifest.lane === 'active' && !snapshot.completedManifestShas.has(manifest.sequence.requiredPriorManifestSha256)) {
    sequenceErrors.push({ entity: 'manifest', state: 'error', operation: 'sequence', reason: 'required inactive manifest has not completed on this target' });
  }
  const resolvedReferences = new Map();
  const contacts = manifest.contactActions.map((row) => planContactAction(manifest, row, snapshot, resolvedReferences));
  const sections = manifest.classSectionActions.map((row) => planSectionAction(row, snapshot));
  const sectionPlans = new Map(sections.filter((row) => row.section?.sectionKey).map((row) => [row.section.sectionKey, row]));
  const courses = manifest.courseActions.map((row) => planCourseAction(manifest, row, snapshot, resolvedReferences, sectionPlans));
  const actions = [...sequenceErrors, ...contacts, ...sections, ...courses];
  const blockers = actions.filter((action) => action.state === 'error' || action.state === 'blocked');
  return {
    schemaVersion: 1,
    manifestId: manifest.manifestId,
    manifestSha256: manifest.contentSha256,
    lane: manifest.lane,
    generatedAt: new Date().toISOString(),
    dryRun: true,
    approvalEligible: blockers.length === 0,
    blockers,
    counts: summarize(actions),
    contactActions: contacts,
    classSectionActions: sections,
    courseActions: courses,
    sequenceErrors,
  };
}
