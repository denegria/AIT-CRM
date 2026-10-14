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
  const currentEnrollment = courses.some((row) => { const createdAt = asDate(row.createdAt); return createdAt && createdAt <= asOf && ['active', 'enrolled', 'matriculated', 'registered'].includes(String(row.status || '').trim().toLowerCase()); });
  const enrollmentSupported = workflowKeyForBusinessUnit(unit) === WORKFLOW_KEYS.AIT_USA;
  return { contacted, enrolled: enrollmentSupported && (historicalEnrollment || currentEnrollment), enrollmentSupported, legacyFallbackUsed: (allowLegacy && events.some((event) => !event.leadId)) || (allowLegacy && courses.some((row) => !row.leadId)), evidence: { events, history, courses } };
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
