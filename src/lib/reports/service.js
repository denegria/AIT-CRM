import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { activityEvents, businessUnits, contactCourseRecords, contacts, leadStatusHistory, leads, users } from '@/db/schema.js';
import { scopedBusinessUnitWhere, scopedOrgWhere } from '@/lib/crm/access.js';
import { workflowKeyForBusinessUnit, WORKFLOW_KEYS } from '@/lib/crm/lifecycle.js';
import { canAccessContactLead } from '@/lib/crm/coordinator-policy.js';
import { buildIntakeTrend, buildReportEvidence, canonicalLeadDate, detailRowsForSelection, parseReportDates, reportRate } from './metrics.js';

const PAGE_SIZE = 25;
const clean = (value) => String(value || '').trim();
const asDate = (value) => { const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || ''); return Number.isNaN(date.getTime()) ? null : date; };

function sourceLabel(lead, contact) {
  const raw = `${lead.sourceName || ''} ${lead.sourceType || ''} ${contact?.sourceLabel || ''}`.toLowerCase();
  if (!raw.trim()) return 'Manual / unknown';
  if (/messenger/.test(raw)) return 'Facebook Messenger';
  if (/facebook|leadgen/.test(raw)) return 'Facebook lead ads';
  if (/website|web form|wix|wordpress/.test(raw)) return 'Website form';
  if (/workbook|xlsx|spreadsheet|archive|interesados|ait signs/.test(raw)) return 'Workbook import';
  return lead.sourceName || lead.sourceType || contact?.sourceLabel || 'Other source';
}

function ownerName(owner, currentOwnerId) { return owner?.name || owner?.email || (currentOwnerId ? 'Assigned coordinator' : 'Unassigned'); }
function scopeForLeads(session, businessUnitId) { const base = scopedBusinessUnitWhere(leads, session); return !businessUnitId || businessUnitId === 'all' ? base : and(base, eq(leads.businessUnitId, businessUnitId)); }

export async function loadLeadPerformanceReport({ db, session, searchParams }) {
  const requestedBusinessUnitId = clean(searchParams.get('businessUnitId')) || 'all';
  const source = clean(searchParams.get('source')).toLowerCase();
  const coordinatorId = clean(searchParams.get('coordinatorId'));
  const groupBy = searchParams.get('groupBy') === 'coordinator' ? 'coordinator' : 'source';
  const detailType = clean(searchParams.get('detailType')).toLowerCase();
  const detailKey = searchParams.get('detailKey') || '';
  const detailUnit = clean(searchParams.get('detailUnit')).toLowerCase();
  const dates = parseReportDates(searchParams);
  const from = dates.from || new Date('1970-01-01T00:00:00.000Z');
  const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
  const exportAll = searchParams.get('format') === 'csv';
  const businessUnitRows = await db.select({ id: businessUnits.id, name: businessUnits.name }).from(businessUnits).where(scopedOrgWhere(businessUnits, session));
  const visibleUnitRows = session.user.canAccessAllBusinessUnits ? businessUnitRows : businessUnitRows.filter((unit) => (session.user.businessUnitIds || []).includes(unit.id));
  const selectedUnits = requestedBusinessUnitId === 'all' ? visibleUnitRows : visibleUnitRows.filter((unit) => unit.id === requestedBusinessUnitId);
  if (requestedBusinessUnitId !== 'all' && !selectedUnits.length) { const error = new Error('Insufficient business-unit access.'); error.status = 403; throw error; }
  const unitById = new Map(businessUnitRows.map((unit) => [unit.id, unit]));
  const selectedUnitIds = selectedUnits.map((unit) => unit.id);
  const leadsRows = await db.select().from(leads).where(scopeForLeads(session, requestedBusinessUnitId)).orderBy(desc(leads.createdAt), desc(leads.id));
  const leadIds = leadsRows.map((lead) => lead.id);
  const contactIds = [...new Set(leadsRows.map((lead) => lead.contactId).filter(Boolean))];
  const relatedScope = (table) => and(scopedOrgWhere(table, session), or(inArray(table.businessUnitId, selectedUnitIds), isNull(table.businessUnitId)));
  const [contactRows, eventRows, historyRows, enrollmentRows, ownerRows] = await Promise.all([
    contactIds.length ? db.select().from(contacts).where(and(scopedOrgWhere(contacts, session), inArray(contacts.id, contactIds), isNull(contacts.archivedAt))) : Promise.resolve([]),
    leadIds.length ? db.select().from(activityEvents).where(and(relatedScope(activityEvents), or(inArray(activityEvents.leadId, leadIds), inArray(activityEvents.contactId, contactIds)))).orderBy(desc(activityEvents.occurredAt), desc(activityEvents.createdAt)) : Promise.resolve([]),
    leadIds.length ? db.select().from(leadStatusHistory).where(and(scopedBusinessUnitWhere(leadStatusHistory, session), inArray(leadStatusHistory.leadId, leadIds))).orderBy(asc(leadStatusHistory.occurredAt)) : Promise.resolve([]),
    contactIds.length ? db.select().from(contactCourseRecords).where(and(scopedBusinessUnitWhere(contactCourseRecords, session), inArray(contactCourseRecords.contactId, contactIds))) : Promise.resolve([]),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(and(eq(users.organizationId, session.user.organizationId), eq(users.isActive, true))).orderBy(asc(users.name)),
  ]);
  const contactsById = new Map(contactRows.map((row) => [row.id, row]));
  const eventsByLead = new Map(); const eventsByContact = new Map();
  for (const event of eventRows) { if (event.leadId) eventsByLead.set(event.leadId, [...(eventsByLead.get(event.leadId) || []), event]); if (event.contactId) eventsByContact.set(event.contactId, [...(eventsByContact.get(event.contactId) || []), event]); }
  const historyByLead = new Map(); for (const row of historyRows) historyByLead.set(row.leadId, [...(historyByLead.get(row.leadId) || []), row]);
  const coursesByLead = new Map(); const coursesByContact = new Map();
  for (const row of enrollmentRows) { if (row.leadId) coursesByLead.set(row.leadId, [...(coursesByLead.get(row.leadId) || []), row]); coursesByContact.set(row.contactId, [...(coursesByContact.get(row.contactId) || []), row]); }
  const ownerById = new Map(ownerRows.map((row) => [row.id, row]));
  const facetSources = new Set();
  const facetCoordinators = new Set();
  const rows = [];
  for (const lead of leadsRows) {
    const contact = contactsById.get(lead.contactId); const unit = unitById.get(lead.businessUnitId);
    if (!canAccessContactLead(session, lead, contact)) continue;
    const cohortDate = canonicalLeadDate({ lead, contact, eventsByLead, eventsByContact, allLeads: leadsRows, unit });
    if (!cohortDate || cohortDate < from || (dates.to && cohortDate > dates.to) || cohortDate > dates.asOf) continue;
    const rowSource = sourceLabel(lead, contact);
    facetSources.add(rowSource);
    facetCoordinators.add(lead.assignedUserId || '');
    if (source && source !== 'all' && rowSource.toLowerCase() !== source) continue;
    if (coordinatorId && coordinatorId !== 'all' && (lead.assignedUserId || '') !== coordinatorId) continue;
    const evidence = buildReportEvidence({ lead, allLeads: leadsRows, eventsByLead, eventsByContact, historyByLead, coursesByLead, coursesByContact, asOf: dates.asOf, unit });
    rows.push({ id: lead.id, contactId: lead.contactId, name: contact?.name || lead.profileDetails || 'Unnamed lead', email: contact?.email || '', source: rowSource, businessUnitId: lead.businessUnitId, businessUnit: unit?.name || 'Unassigned division', coordinatorId: lead.assignedUserId || '', coordinator: ownerName(ownerById.get(lead.assignedUserId), lead.assignedUserId), leadDate: cohortDate.toISOString(), status: lead.currentStage || lead.status || 'Unknown', contacted: evidence.contacted, contactEvidence: evidence.contacted ? 'confirmed' : (evidence.contactEvidenceAvailable ? 'reviewed-no-confirmation' : 'not evidenced'), contactEvidenceAvailable: evidence.contactEvidenceAvailable, enrolled: evidence.enrolled, enrollmentSupported: evidence.enrollmentSupported, evidence: { contacted: evidence.contacted, enrolled: evidence.enrolled, legacyFallbackUsed: evidence.legacyFallbackUsed } });
  }
  const incoming = rows.length; const contacted = rows.filter((row) => row.contacted).length; const enrolled = rows.filter((row) => row.enrolled).length; const contactEvidence = rows.filter((row) => row.contactEvidenceAvailable).length; const enrollmentEligible = rows.filter((row) => row.enrollmentSupported).length;
  const groups = new Map();
  for (const row of rows) { const key = groupBy === 'coordinator' ? row.coordinatorId || '__unassigned__' : row.source; const label = groupBy === 'coordinator' ? row.coordinator : row.source; const existing = groups.get(key) || { key, label, incoming: 0, contacted: 0, enrolled: 0 }; existing.incoming += 1; if (row.contacted) existing.contacted += 1; if (row.enrolled) existing.enrolled += 1; groups.set(key, existing); }
  const breakdown = [...groups.values()].map((group) => ({ ...group, contactRate: reportRate(group.contacted, group.incoming), enrollmentRate: reportRate(group.enrolled, group.incoming) })).sort((a, b) => b.incoming - a.incoming || a.label.localeCompare(b.label));
  const grouped = (field) => [...new Set(rows.map((row) => field === 'coordinator' ? row.coordinatorId || '__unassigned__' : row[field]))].map((key) => { const groupRows = rows.filter((row) => (field === 'coordinator' ? row.coordinatorId || '__unassigned__' : row[field]) === key); const group = { key, label: field === 'coordinator' ? groupRows[0]?.coordinator || 'Unassigned' : key, incoming: groupRows.length, contacted: groupRows.filter((row) => row.contacted).length, enrolled: groupRows.filter((row) => row.enrolled).length }; const denominator = groupRows.filter((row) => row.enrollmentSupported).length; return { ...group, contactRate: reportRate(group.contacted, group.incoming), enrollmentRate: reportRate(group.enrolled, denominator), enrollmentDenominator: denominator }; }).sort((a, b) => b.incoming - a.incoming || a.label.localeCompare(b.label));
  const statusGroups = grouped('status').map(({ key, label, incoming, enrolled }) => ({ key, label, incoming, enrolled }));
  const divisionGroups = grouped('businessUnit').map(({ key, label, incoming, enrolled }) => ({ key, label, incoming, enrolled }));
  const detailRows = detailRowsForSelection(rows, { detailType, detailKey, detailUnit });
  const totalPages = Math.max(1, Math.ceil(detailRows.length / PAGE_SIZE)); const pageRows = exportAll ? detailRows : detailRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const enrollmentSupported = selectedUnits.every((unit) => workflowKeyForBusinessUnit(unit) === WORKFLOW_KEYS.AIT_USA);
  const limitation = enrollmentSupported
    ? 'AIT USA enrollment combines status history, course snapshots, and the current lead stage through the as-of timestamp. Older imported leads without dated evidence may remain limited.'
    : 'Enrollment reporting is supported only for AIT USA. AIT Signs leads remain visible, but are not mapped to enrollment. Historical enrollment status depends on available lead history; current AIT USA enrollment snapshots are included through the as-of timestamp.';
  const enrollmentRate = enrollmentSupported ? reportRate(enrolled, enrollmentEligible) : null;
  return { filters: { businessUnitId: requestedBusinessUnitId, from: dates.fromRaw, to: dates.toRaw, asOf: dates.asOf.toISOString(), source, coordinatorId, groupBy, detailType, detailKey }, summary: { incoming, contacted, enrolled, contactRate: reportRate(contacted, incoming), enrollmentRate, contactEvidence, contactCoverage: reportRate(contactEvidence, incoming), enrollmentEligible }, comparisons: [{ key: 'contacted', label: 'Confirmed contact evidence', numerator: contacted, denominator: incoming, rate: reportRate(contacted, incoming) }, { key: 'enrolled', label: 'Enrollment evidence', numerator: enrolled, denominator: enrollmentEligible, rate: enrollmentRate }], breakdown, analytics: { sources: grouped('source'), coordinators: grouped('coordinator'), statuses: statusGroups, divisions: divisionGroups, intakeTrend: buildIntakeTrend(rows, { from: dates.from, to: dates.to || dates.asOf }) }, leads: pageRows, pagination: { page, pageSize: PAGE_SIZE, total: detailRows.length, totalPages }, sources: [...facetSources].sort(), coordinators: ownerRows.filter((row) => facetCoordinators.has(row.id)).map((row) => ({ id: row.id, name: row.name || row.email })), scope: { businessUnits: selectedUnits, enrollmentSupported, limitation } };
}
