import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  activityEvents,
  businessUnits,
  contactCourseRecords,
  contacts,
  leadStatusHistory,
  leads,
  users,
} from '@/db/schema.js';
import { scopedBusinessUnitWhere, scopedOrgWhere } from '@/lib/crm/access.js';
import { workflowKeyForBusinessUnit, WORKFLOW_KEYS } from '@/lib/crm/lifecycle.js';
import { canAccessContactLead } from '@/lib/crm/coordinator-policy.js';
import { enrollmentStatusEvidence, successfulContactEvent } from './metrics.js';

const PAGE_SIZE = 25;

function text(value) { return String(value || '').trim(); }
function dateValue(value) { const d = value ? new Date(value) : null; return d && !Number.isNaN(d.getTime()) ? d : null; }
function dateOnly(value) { return value ? new Date(`${value}T00:00:00.000Z`) : null; }
function endOfDate(value) { return value ? new Date(`${value}T23:59:59.999Z`) : null; }
function sourceLabel(lead, contact) {
  const raw = `${lead.sourceName || ''} ${lead.sourceType || ''} ${contact?.sourceLabel || ''}`.toLowerCase();
  if (!raw.trim()) return 'Manual / unknown';
  if (/messenger/.test(raw)) return 'Facebook Messenger';
  if (/facebook|leadgen/.test(raw)) return 'Facebook lead ads';
  if (/website|web form|wix|wordpress/.test(raw)) return 'Website form';
  if (/workbook|xlsx|spreadsheet|archive|interesados|ait signs/.test(raw)) return 'Workbook import';
  return lead.sourceName || lead.sourceType || contact?.sourceLabel || 'Other source';
}
function canonicalLeadDate(lead, contact, events, unit) {
  if (workflowKeyForBusinessUnit(unit) === WORKFLOW_KEYS.AIT_USA) {
    const captured = events.filter((event) => event.eventType?.toLowerCase() === 'website_lead_captured' && (!event.leadId || event.leadId === lead.id));
    const captureDate = captured.map((event) => dateValue(event.occurredAt || event.createdAt)).filter(Boolean).sort((a, b) => a - b)[0];
    return captureDate || dateValue(lead.createdAt) || dateValue(contact?.createdAt);
  }
  return dateValue(lead.createdAt) || dateValue(contact?.createdAt);
}
function ownerName(owner, currentOwnerId) { return owner?.name || owner?.email || (currentOwnerId ? 'Assigned coordinator' : 'Unassigned'); }

function scopeForLeads(session, requestedBusinessUnitId) {
  const base = scopedBusinessUnitWhere(leads, session);
  if (!requestedBusinessUnitId || requestedBusinessUnitId === 'all') return base;
  return and(base, eq(leads.businessUnitId, requestedBusinessUnitId));
}

export async function loadLeadPerformanceReport({ db, session, searchParams }) {
  const requestedBusinessUnitId = text(searchParams.get('businessUnitId')) || 'all';
  const source = text(searchParams.get('source')).toLowerCase();
  const coordinatorId = text(searchParams.get('coordinatorId'));
  const groupBy = searchParams.get('groupBy') === 'coordinator' ? 'coordinator' : 'source';
  const from = dateOnly(text(searchParams.get('from')));
  const to = endOfDate(text(searchParams.get('to')));
  const asOf = dateValue(text(searchParams.get('asOf'))) || new Date();
  const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
  const exportAll = searchParams.get('format') === 'csv';
  const businessUnitRows = await db.select({ id: businessUnits.id, name: businessUnits.name }).from(businessUnits).where(scopedOrgWhere(businessUnits, session));
  const visibleUnitRows = session.user.canAccessAllBusinessUnits ? businessUnitRows : businessUnitRows.filter((unit) => (session.user.businessUnitIds || []).includes(unit.id));
  const selectedUnits = requestedBusinessUnitId === 'all' ? visibleUnitRows : visibleUnitRows.filter((unit) => unit.id === requestedBusinessUnitId);
  if (requestedBusinessUnitId !== 'all' && !selectedUnits.length) { const error = new Error('Insufficient business-unit access.'); error.status = 403; throw error; }
  const unitById = new Map(businessUnitRows.map((unit) => [unit.id, unit]));
  const leadWhere = scopeForLeads(session, requestedBusinessUnitId);
  const leadsRows = await db.select().from(leads).where(leadWhere).orderBy(desc(leads.createdAt), desc(leads.id));
  const leadIds = leadsRows.map((lead) => lead.id);
  const contactIds = [...new Set(leadsRows.map((lead) => lead.contactId).filter(Boolean))];
  const [contactRows, eventRows, historyRows, enrollmentRows, ownerRows] = await Promise.all([
    contactIds.length ? db.select().from(contacts).where(and(scopedOrgWhere(contacts, session), inArray(contacts.id, contactIds), isNull(contacts.archivedAt))) : Promise.resolve([]),
    leadIds.length ? db.select().from(activityEvents).where(and(scopedOrgWhere(activityEvents, session), or(inArray(activityEvents.leadId, leadIds), inArray(activityEvents.contactId, contactIds)))).orderBy(desc(activityEvents.occurredAt), desc(activityEvents.createdAt)) : Promise.resolve([]),
    leadIds.length ? db.select().from(leadStatusHistory).where(and(scopedOrgWhere(leadStatusHistory, session), inArray(leadStatusHistory.leadId, leadIds))).orderBy(asc(leadStatusHistory.occurredAt)) : Promise.resolve([]),
    contactIds.length ? db.select().from(contactCourseRecords).where(and(scopedOrgWhere(contactCourseRecords, session), inArray(contactCourseRecords.contactId, contactIds))) : Promise.resolve([]),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(and(eq(users.organizationId, session.user.organizationId), eq(users.isActive, true))).orderBy(asc(users.name)),
  ]);
  const contactsById = new Map(contactRows.map((row) => [row.id, row]));
  const eventsByLead = new Map(); const eventsByContact = new Map();
  for (const event of eventRows) { if (event.leadId) eventsByLead.set(event.leadId, [...(eventsByLead.get(event.leadId) || []), event]); if (event.contactId) eventsByContact.set(event.contactId, [...(eventsByContact.get(event.contactId) || []), event]); }
  const historyByLead = new Map(); for (const row of historyRows) historyByLead.set(row.leadId, [...(historyByLead.get(row.leadId) || []), row]);
  const enrollmentsByContact = new Map(); for (const row of enrollmentRows) enrollmentsByContact.set(row.contactId, [...(enrollmentsByContact.get(row.contactId) || []), row]);
  const ownerById = new Map(ownerRows.map((row) => [row.id, row]));
  const rows = [];
  for (const lead of leadsRows) {
    const contact = contactsById.get(lead.contactId);
    const unit = unitById.get(lead.businessUnitId);
    // Regular coordinators are owner-scoped; division-wide sharing remains governed by the existing policy.
    if (!canAccessContactLead(session, lead, contact)) continue;
    const eventList = [...(eventsByLead.get(lead.id) || []), ...(eventsByContact.get(lead.contactId) || [])];
    const cohortDate = canonicalLeadDate(lead, contact, eventList, unit);
    if (!cohortDate || (from && cohortDate < from) || (to && cohortDate > to)) continue;
    const rowSource = sourceLabel(lead, contact);
    if (source && source !== 'all' && rowSource.toLowerCase() !== source) continue;
    if (coordinatorId && coordinatorId !== 'all' && (lead.assignedUserId || '') !== coordinatorId) continue;
    const successfulContact = eventList.some((event) => successfulContactEvent(event, asOf));
    const historyEnrolled = (historyByLead.get(lead.id) || []).some((row) => enrollmentStatusEvidence(row, asOf));
    const recordEnrolled = workflowKeyForBusinessUnit(unit) === WORKFLOW_KEYS.AIT_USA && (enrollmentsByContact.get(lead.contactId) || []).some((row) => dateValue(row.createdAt) <= asOf && !['canceled', 'voided'].includes(String(row.status || '').toLowerCase()));
    rows.push({ id: lead.id, contactId: lead.contactId, name: contact?.name || lead.profileDetails || 'Unnamed lead', email: contact?.email || '', source: rowSource, businessUnitId: lead.businessUnitId, businessUnit: unit?.name || 'Unassigned division', coordinatorId: lead.assignedUserId || '', coordinator: ownerName(ownerById.get(lead.assignedUserId), lead.assignedUserId), leadDate: cohortDate.toISOString(), status: lead.currentStage || lead.status || 'Unknown', contacted: successfulContact, contactEvidence: successfulContact ? 'confirmed' : 'not evidenced', enrolled: historyEnrolled || recordEnrolled, enrollmentSupported: workflowKeyForBusinessUnit(unit) === WORKFLOW_KEYS.AIT_USA });
  }
  const incoming = rows.length; const contacted = rows.filter((row) => row.contacted).length; const enrolled = rows.filter((row) => row.enrolled).length;
  const groups = new Map(); for (const row of rows) { const key = groupBy === 'coordinator' ? row.coordinator : row.source; const existing = groups.get(key) || { key, label: key, incoming: 0, contacted: 0, enrolled: 0 }; existing.incoming += 1; if (row.contacted) existing.contacted += 1; if (row.enrolled) existing.enrolled += 1; groups.set(key, existing); }
  const breakdown = [...groups.values()].map((group) => ({ ...group, contactRate: group.incoming ? Math.round((group.contacted / group.incoming) * 1000) / 10 : 0, enrollmentRate: group.incoming ? Math.round((group.enrolled / group.incoming) * 1000) / 10 : 0 })).sort((a, b) => b.incoming - a.incoming || a.label.localeCompare(b.label));
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)); const pageRows = exportAll ? rows : rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return { filters: { businessUnitId: requestedBusinessUnitId, from: text(searchParams.get('from')), to: text(searchParams.get('to')), asOf: asOf.toISOString(), source, coordinatorId, groupBy }, summary: { incoming, contacted, enrolled, contactRate: incoming ? Math.round((contacted / incoming) * 1000) / 10 : 0, enrollmentRate: incoming ? Math.round((enrolled / incoming) * 1000) / 10 : 0 }, comparisons: [{ key: 'contacted', label: 'Incoming → successful contact', numerator: contacted, denominator: incoming, rate: incoming ? Math.round((contacted / incoming) * 1000) / 10 : 0 }, { key: 'enrolled', label: 'Incoming → enrollment', numerator: enrolled, denominator: incoming, rate: incoming ? Math.round((enrolled / incoming) * 1000) / 10 : 0 }], breakdown, leads: pageRows, pagination: { page, pageSize: PAGE_SIZE, total: rows.length, totalPages }, sources: [...new Set(rows.map((row) => row.source))].sort(), coordinators: ownerRows.map((row) => ({ id: row.id, name: row.name || row.email })), scope: { businessUnits: selectedUnits, enrollmentSupported: selectedUnits.every((unit) => workflowKeyForBusinessUnit(unit) === WORKFLOW_KEYS.AIT_USA), limitation: selectedUnits.some((unit) => workflowKeyForBusinessUnit(unit) !== WORKFLOW_KEYS.AIT_USA) ? 'Enrollment reporting is supported only for AIT USA. AIT Signs leads remain visible, but are not mapped to enrollment.' : '' } };
}
