const SUCCESSFUL_CONTACT_EVENTS = new Set(['follow_up.reached_interested', 'follow_up.reached_not_interested']);
const ENROLLMENT_STATUSES = new Set(['enrolled', 'matriculated', 'registered']);
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
import { workflowKeyForBusinessUnit, WORKFLOW_KEYS } from '../crm/lifecycle.js';
import { latestExcelDateFromText } from '../contact-touch.js';

const asDate = (value) => { const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || ''); return Number.isNaN(date.getTime()) ? null : date; };

export function canonicalLeadDate({ lead, contact, eventsByLead, eventsByContact, allLeads, unit }) {
  if (workflowKeyForBusinessUnit(unit) === WORKFLOW_KEYS.AIT_USA) {
    const captureTypes = ['website_lead_captured', 'facebook_lead_captured'];
    const sameContactBuLeads = allLeads.filter((candidate) => candidate.contactId === lead.contactId && candidate.businessUnitId === lead.businessUnitId);
    const exactEvents = eventsByLead.get(lead.id) || [];
    const contactEvents = eventsByContact.get(lead.contactId) || [];
    const legacyEvents = sameContactBuLeads.length === 1
      ? contactEvents.filter((event) => !event.leadId && (event.businessUnitId === lead.businessUnitId || event.businessUnitId == null))
      : [];
    const exactCapture = exactEvents.filter((event) => event.businessUnitId === lead.businessUnitId && captureTypes.includes(event.eventType?.toLowerCase()))
      .map((event) => asDate(event.occurredAt || event.createdAt)).filter(Boolean).sort((a, b) => a - b)[0];
    const legacyCapture = legacyEvents.filter((event) => captureTypes.includes(event.eventType?.toLowerCase()))
      .map((event) => asDate(event.occurredAt || event.createdAt)).filter(Boolean).sort((a, b) => a - b)[0];
    const capture = exactCapture || legacyCapture;
    return capture || asDate(lead.createdAt) || asDate(contact?.createdAt);
  }
  const referenceTime = Date.now();
  const cohortEvents = [...(eventsByLead.get(lead.id) || []), ...(eventsByContact.get(lead.contactId) || []).filter((event) => !event.leadId)];
  const workbookDate = [lead.originalNotes, ...cohortEvents.map((event) => event.message || event.eventType || '')]
    .reduce((latest, value) => Math.max(latest, latestExcelDateFromText(value, { referenceTime })), 0);
  return workbookDate ? new Date(workbookDate) : asDate(lead.createdAt) || asDate(contact?.createdAt);
}
function invalid(message) { const error = new Error(message); error.status = 400; throw error; }
function parseCalendarDate(value, label, end = false) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (!DATE_ONLY.test(raw)) invalid(`${label} must be a valid calendar date in YYYY-MM-DD format.`);
  const date = new Date(`${raw}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
  if (date.toISOString().slice(0, 10) !== raw) invalid(`${label} must be a valid calendar date in YYYY-MM-DD format.`);
  return date;
}

export function parseReportDates(searchParams, now = new Date()) {
  const fromRaw = String(searchParams.get('from') || '').trim();
  const toRaw = String(searchParams.get('to') || '').trim();
  const asOfRaw = String(searchParams.get('asOf') || '').trim();
  const from = parseCalendarDate(fromRaw, 'Lead date from');
  const to = parseCalendarDate(toRaw, 'Lead date to', true);
  if (from && to && from > to) invalid('Lead date from must be on or before lead date to.');
  let asOf = now;
  if (asOfRaw) { asOf = asDate(asOfRaw); if (!asOf) invalid('As-of must be a valid timestamp or YYYY-MM-DD date.'); if (asOf > now) invalid('As-of cannot be in the future.'); }
  return { from, to, asOf, fromRaw, toRaw, asOfRaw };
}

export function buildReportEvidence({ lead, allLeads, eventsByLead, eventsByContact, historyByLead, coursesByLead, coursesByContact, asOf, unit }) {
  const sameContactBuLeads = allLeads.filter((candidate) => candidate.contactId === lead.contactId && candidate.businessUnitId === lead.businessUnitId);
  const allowLegacy = sameContactBuLeads.length === 1;
  const events = [...(eventsByLead.get(lead.id) || []), ...(allowLegacy ? (eventsByContact.get(lead.contactId) || []).filter((event) => !event.leadId) : [])].filter((event) => event.businessUnitId === lead.businessUnitId || (!event.leadId && event.businessUnitId == null));
  const courses = [...(coursesByLead.get(lead.id) || []), ...(allowLegacy ? (coursesByContact.get(lead.contactId) || []).filter((row) => !row.leadId) : [])].filter((row) => row.businessUnitId === lead.businessUnitId);
  const history = (historyByLead.get(lead.id) || []).filter((row) => row.businessUnitId === lead.businessUnitId);
  const contacted = events.some((event) => successfulContactEvent(event, asOf));
  const historicalEnrollment = history.some((row) => enrollmentStatusEvidence(row, asOf));
  const currentCourseEnrollment = courses.some((row) => { const createdAt = asDate(row.createdAt); return createdAt && createdAt <= asOf && ['active', 'enrolled', 'matriculated', 'registered'].includes(String(row.status || '').trim().toLowerCase()); });
  const enrollmentSupported = workflowKeyForBusinessUnit(unit) === WORKFLOW_KEYS.AIT_USA;
  const snapshotAt = asDate(lead.updatedAt) || asDate(lead.createdAt);
  const currentStage = String(lead.currentStage || lead.status || '').trim().toLowerCase();
  const currentEnrollment = enrollmentSupported && Boolean(snapshotAt && snapshotAt <= asOf && ['enrolled', 'matriculated', 'registered', 'won', 'closed won', 'sold'].includes(currentStage));
  return { contacted, contactEvidenceAvailable: events.length > 0, enrolled: enrollmentSupported && (historicalEnrollment || currentEnrollment || currentCourseEnrollment), enrollmentSupported, legacyFallbackUsed: (allowLegacy && events.some((event) => !event.leadId)) || (allowLegacy && courses.some((row) => !row.leadId)), evidence: { events, history, courses } };
}

export function reportRate(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

export function summarizeReportRows(rows, enrollmentSupported = rows.every((row) => row.enrollmentSupported)) {
  const incoming = rows.length;
  const contacted = rows.filter((row) => row.contacted).length;
  const enrolled = rows.filter((row) => row.enrolled).length;
  const contactEvidence = rows.filter((row) => row.contactEvidenceAvailable).length;
  const enrollmentEligible = rows.filter((row) => row.enrollmentSupported).length;
  const contactedEnrollmentEligible = rows.filter((row) => row.contacted && row.enrollmentSupported).length;
  const contactedEnrolled = rows.filter((row) => row.contacted && row.enrollmentSupported && row.enrolled).length;
  return { incoming, contacted, enrolled, contactedEnrolled, contactedEnrollmentEligible, contactRate: reportRate(contacted, incoming), enrollmentRate: enrollmentSupported ? reportRate(enrolled, enrollmentEligible) : null, contactedEnrollmentRate: enrollmentSupported ? reportRate(contactedEnrolled, contactedEnrollmentEligible) : null, contactEvidence, contactCoverage: reportRate(contactEvidence, incoming), enrollmentEligible };
}

function bucketDefinition(from, to) {
  const span = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86400000));
  if (span <= 45) return { unit: 'day', step: 1, format: (date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) };
  if (span <= 180) return { unit: 'week', step: 7, format: (date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) };
  if (span <= 900) return { unit: 'month', step: 1, format: (date) => date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) };
  if (span <= 3000) return { unit: 'quarter', step: 3, format: (date) => `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}` };
  return { unit: 'year', step: 1, format: (date) => String(date.getUTCFullYear()) };
}

export function detailRowsForSelection(rows, { detailType, detailKey, detailUnit }) {
  if (!detailType || !detailKey) return rows;
  if (detailType === 'metric') {
    if (detailKey === 'confirmed-contact') return rows.filter((row) => row.contacted);
    if (detailKey === 'enrolled') return rows.filter((row) => row.enrolled);
    if (detailKey === 'contacted-enrolled') return rows.filter((row) => row.contacted && row.enrollmentSupported && row.enrolled);
    return rows;
  }
  if (detailType === 'source') return rows.filter((row) => row.source === detailKey);
  if (detailType === 'coordinator') return rows.filter((row) => (row.coordinatorId || '__unassigned__') === detailKey);
  if (detailType === 'status') return rows.filter((row) => row.status === detailKey);
  if (detailType === 'division') return rows.filter((row) => row.businessUnit === detailKey);
  if (detailType === 'trend') {
    const start = new Date(`${detailKey}T00:00:00.000Z`);
    const increments = { day: 1, week: 7, month: 1, quarter: 3, year: 12 };
    const trendEnd = new Date(start);
    if (detailUnit === 'year' || detailUnit === 'quarter' || detailUnit === 'month') trendEnd.setUTCMonth(trendEnd.getUTCMonth() + (increments[detailUnit] || 1));
    else trendEnd.setUTCDate(trendEnd.getUTCDate() + (increments[detailUnit] || 1));
    return rows.filter((row) => { const date = new Date(row.leadDate); return date >= start && date < trendEnd; });
  }
  return rows;
}

export function buildIntakeTrend(rows, { from, to } = {}) {
  const dates = rows.map((row) => asDate(row.leadDate)).filter(Boolean);
  const start = from || dates.reduce((earliest, date) => date < earliest ? date : earliest, dates[0] || new Date());
  const end = to || dates.reduce((latest, date) => date > latest ? date : latest, dates[0] || start);
  const definition = bucketDefinition(start, end);
  const anchor = new Date(Date.UTC(start.getUTCFullYear(), definition.unit === 'year' ? 0 : definition.unit === 'quarter' ? Math.floor(start.getUTCMonth() / 3) * 3 : start.getUTCMonth(), definition.unit === 'day' || definition.unit === 'week' ? start.getUTCDate() : 1));
  if (definition.unit === 'week') anchor.setUTCDate(anchor.getUTCDate() - ((anchor.getUTCDay() + 6) % 7));
  const buckets = [];
  const cursor = new Date(anchor);
  while (cursor <= end) {
    const bucketStart = new Date(cursor);
    const bucketEnd = new Date(cursor);
    if (definition.unit === 'month' || definition.unit === 'quarter' || definition.unit === 'year') bucketEnd.setUTCMonth(bucketEnd.getUTCMonth() + (definition.unit === 'year' ? 12 : definition.step));
    else bucketEnd.setUTCDate(bucketEnd.getUTCDate() + definition.step);
    buckets.push({ key: bucketStart.toISOString().slice(0, 10), label: definition.format(bucketStart), unit: definition.unit, incoming: 0, contacted: 0, enrolled: 0 });
    cursor.setTime(bucketEnd.getTime());
  }
  for (const row of rows) {
    const date = asDate(row.leadDate); if (!date) continue;
    let bucketDate = new Date(Date.UTC(date.getUTCFullYear(), definition.unit === 'year' ? 0 : definition.unit === 'quarter' ? Math.floor(date.getUTCMonth() / 3) * 3 : date.getUTCMonth(), definition.unit === 'day' || definition.unit === 'week' ? date.getUTCDate() : 1));
    if (definition.unit === 'week') bucketDate.setUTCDate(bucketDate.getUTCDate() - ((bucketDate.getUTCDay() + 6) % 7));
    const bucket = buckets.find((candidate) => candidate.key === bucketDate.toISOString().slice(0, 10));
    if (bucket) { bucket.incoming += 1; if (row.contacted) bucket.contacted += 1; if (row.enrolled) bucket.enrolled += 1; }
  }
  return { unit: definition.unit, buckets };
}

export function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function dateValue(value) { const d = value ? new Date(value) : null; return d && !Number.isNaN(d.getTime()) ? d : null; }

export function successfulContactEvent(event, asOf = new Date()) {
  const occurredAt = dateValue(event?.occurredAt || event?.createdAt);
  const eventType = String(event?.eventType || '').toLowerCase();
  const outcome = String(event?.metadataJson?.outcome || '').toLowerCase();
  const affirmative = SUCCESSFUL_CONTACT_EVENTS.has(eventType) || (eventType === 'ait_usa.follow_up' && ['reached_interested', 'reached_not_interested'].includes(outcome));
  return affirmative && Boolean(occurredAt && occurredAt <= asOf);
}

export function enrollmentStatusEvidence(row, asOf = new Date()) {
  const occurredAt = dateValue(row?.occurredAt || row?.createdAt);
  return ENROLLMENT_STATUSES.has(String(row?.toStatus || '').trim().toLowerCase()) && Boolean(occurredAt && occurredAt <= asOf);
}
