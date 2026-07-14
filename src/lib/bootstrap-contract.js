export const DEFERRED_BOOTSTRAP_LOADERS = Object.freeze({
  TASKS: 'tasks',
  CONTACT_DETAILS: 'contactDetails',
  CONTACT_DIRECTORY: 'contactDirectory',
});

export const CONTACT_BOOTSTRAP_SUMMARY_FIELDS = Object.freeze({
  notes: Object.freeze(['contactId', 'businessUnitId', 'body', 'createdAt']),
  activityEvents: Object.freeze([
    'contactId',
    'businessUnitId',
    'leadId',
    'eventType',
    'message',
    'sourceSheet',
    'sourceRow',
    'occurredAt',
    'createdAt',
  ]),
  conversationMessages: Object.freeze([
    'contactId',
    'businessUnitId',
    'textBody',
    'occurredAt',
    'createdAt',
  ]),
  contactPeople: Object.freeze(['contactId', 'name', 'isPrimary']),
  courseRecords: Object.freeze([
    'contactId',
    'courseName',
    'courseLocation',
    'status',
    'startDate',
    'endDate',
    'outcomeReason',
    'createdAt',
    'updatedAt',
  ]),
  leadStatusHistory: Object.freeze([
    'contactId',
    'businessUnitId',
    'fromStatus',
    'toStatus',
    'actorUserId',
    'metadataJson',
    'occurredAt',
    'createdAt',
  ]),
});

export function contactBootstrapSummarySelection(table, category) {
  const fields = CONTACT_BOOTSTRAP_SUMMARY_FIELDS[category];
  if (!fields) throw new Error(`Unknown contact bootstrap summary category: ${category}`);
  return Object.fromEntries(fields.map((field) => [field, table[field]]));
}

export function projectContactBootstrapSummaryRows(rowsByCategory = {}) {
  return Object.fromEntries(Object.entries(CONTACT_BOOTSTRAP_SUMMARY_FIELDS).map(([category, fields]) => [
    category,
    (rowsByCategory[category] || []).map((row) => Object.fromEntries(
      fields.map((field) => [field, row[field]]),
    )),
  ]));
}

export function toContactListPayload(contact = {}) {
  const { notes: _notes, timeline: _timeline, courseSummary: _courseSummary, ...listPayload } = contact;
  return {
    ...listPayload,
    ...(Array.isArray(listPayload.courseRecords) ? {
      courseRecords: listPayload.courseRecords.map((record) => ({
        courseName: record.courseName || '',
        courseLocation: record.courseLocation || '',
        status: record.status || '',
        startDate: record.startDate || '',
        endDate: record.endDate || '',
        outcomeReason: record.outcomeReason || '',
        createdAt: record.createdAt || '',
        updatedAt: record.updatedAt || '',
      })),
    } : {}),
  };
}

export function deferBootstrapContactDetails(payload = {}) {
  const deferredLoaders = new Set(payload.deferredLoaders || []);
  deferredLoaders.add(DEFERRED_BOOTSTRAP_LOADERS.CONTACT_DETAILS);

  return {
    ...payload,
    contacts: (payload.contacts || []).map(toContactListPayload),
    deferredLoaders: [...deferredLoaders],
  };
}

export function deferBootstrapTasks(payload = {}) {
  const deferredLoaders = new Set(payload.deferredLoaders || []);
  deferredLoaders.add(DEFERRED_BOOTSTRAP_LOADERS.TASKS);

  return {
    ...payload,
    tasks: [],
    deferredLoaders: [...deferredLoaders],
  };
}

export function deferBootstrapContactDirectory(payload = {}) {
  const deferredLoaders = new Set(payload.deferredLoaders || []);
  deferredLoaders.add(DEFERRED_BOOTSTRAP_LOADERS.CONTACT_DIRECTORY);

  return {
    ...payload,
    contacts: [],
    workOrders: [],
    financials: [],
    deferredLoaders: [...deferredLoaders],
  };
}

export function hasDeferredBootstrapLoader(payload = {}, loader) {
  return (payload.deferredLoaders || []).includes(loader);
}
