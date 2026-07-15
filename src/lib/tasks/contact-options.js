import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { businessUnits, contacts, leads } from '../../db/schema.js';
import {
  canAccessBusinessUnit,
  contactLeadAccessWhere,
  scopedContactWhere,
  scopedOrgWhere,
} from '../crm/access.js';
import { createCrmError } from '../crm/errors.js';
import { workflowFromLead } from '../sales-workflow.js';
import { searchPattern, searchPhoneDigits } from '../search/match.js';

export const TASK_CONTACT_OPTION_LIMIT = 35;

function clean(value = '') {
  return String(value || '').trim();
}

function boundedLimit(value, fallback = TASK_CONTACT_OPTION_LIMIT) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 50);
}

export function toTaskContactOption(row = {}, unitById = new Map()) {
  const businessUnit = unitById.get(row.primaryBusinessUnitId) || null;
  const lead = row.leadId ? {
    id: row.leadId,
    status: row.leadStatus,
    currentStage: row.currentStage,
    assignedUserId: row.assignedUserId,
    sourceType: row.sourceType,
    sourceName: row.sourceName,
    originalNotes: row.originalNotes,
    programInterest: row.programInterest,
    preferredDay: row.preferredDay,
    preferredSchedule: row.preferredSchedule,
    testInterest: row.testInterest,
    educationLevel: row.educationLevel,
    schoolName: row.schoolName,
    locationPreference: row.locationPreference,
  } : null;
  const workflow = workflowFromLead(lead, { businessUnit });
  return {
    id: row.id,
    name: row.name || '',
    companyName: row.companyName || '',
    email: row.email || '',
    phone: row.phone || '',
    address: row.address || '',
    businessUnitId: row.primaryBusinessUnitId || '',
    primaryBusinessUnitId: row.primaryBusinessUnitId || '',
    businessUnitName: businessUnit?.name || '',
    status: workflow.status,
    currentStage: workflow.currentStage,
    workflowKey: workflow.workflowKey,
    source: row.sourceName || row.sourceType || row.sourceLabel || '',
    assignedTo: row.assignedUserId || '',
    programInterest: row.programInterest || '',
    preferredDay: row.preferredDay || '',
    preferredSchedule: row.preferredSchedule || '',
    testInterest: row.testInterest || '',
    educationLevel: row.educationLevel || '',
    schoolName: row.schoolName || '',
    locationPreference: row.locationPreference || '',
  };
}

export async function loadTaskContactOptions({
  db,
  session,
  businessUnitId = '',
  query = '',
  contactIds = [],
  limit = TASK_CONTACT_OPTION_LIMIT,
} = {}) {
  const requestedBusinessUnitId = clean(businessUnitId);
  if (
    requestedBusinessUnitId &&
    requestedBusinessUnitId !== 'all' &&
    !canAccessBusinessUnit(session, requestedBusinessUnitId)
  ) {
    throw createCrmError('Insufficient business-unit access.', 403);
  }

  const unitRows = await db
    .select({ id: businessUnits.id, name: businessUnits.name, label: businessUnits.label })
    .from(businessUnits)
    .where(scopedOrgWhere(businessUnits, session));
  const latestLead = db
    .selectDistinctOn([leads.contactId], {
      contactId: leads.contactId,
      businessUnitId: leads.businessUnitId,
      leadId: leads.id,
      leadStatus: leads.status,
      currentStage: leads.currentStage,
      assignedUserId: leads.assignedUserId,
      sourceType: leads.sourceType,
      sourceName: leads.sourceName,
      originalNotes: leads.originalNotes,
      programInterest: leads.programInterest,
      preferredDay: leads.preferredDay,
      preferredSchedule: leads.preferredSchedule,
      testInterest: leads.testInterest,
      educationLevel: leads.educationLevel,
      schoolName: leads.schoolName,
      locationPreference: leads.locationPreference,
    })
    .from(leads)
    .where(scopedOrgWhere(leads, session))
    .orderBy(leads.contactId, desc(leads.createdAt), desc(leads.id))
    .as('task_contact_latest_lead');
  const uniqueContactIds = [...new Set(contactIds.filter(Boolean))];
  if (uniqueContactIds.length > 500) throw createCrmError('Too many task contacts requested.');
  const search = clean(query);
  const conditions = [
    scopedContactWhere(contacts, session),
    requestedBusinessUnitId && requestedBusinessUnitId !== 'all'
      ? eq(contacts.primaryBusinessUnitId, requestedBusinessUnitId)
      : undefined,
    contactLeadAccessWhere(contacts, latestLead, session),
    uniqueContactIds.length ? inArray(contacts.id, uniqueContactIds) : undefined,
  ];
  if (search && !uniqueContactIds.length) {
    const pattern = searchPattern(search);
    const phoneDigits = searchPhoneDigits(search);
    conditions.push(or(
      ilike(contacts.name, pattern),
      ilike(contacts.companyName, pattern),
      ilike(contacts.email, pattern),
      ilike(contacts.phone, pattern),
      phoneDigits
        ? sql`regexp_replace(coalesce(${contacts.phone}, ''), '[^0-9]', '', 'g') like ${`%${phoneDigits}%`}`
        : undefined,
      ilike(contacts.address, pattern),
      ilike(contacts.sourceLabel, pattern),
      ilike(latestLead.sourceType, pattern),
      ilike(latestLead.sourceName, pattern),
      ilike(latestLead.leadStatus, pattern),
      ilike(latestLead.currentStage, pattern),
      ilike(latestLead.programInterest, pattern),
      ilike(latestLead.locationPreference, pattern),
    ));
  }

  let request = db
    .select({
      id: contacts.id,
      name: contacts.name,
      companyName: contacts.companyName,
      email: contacts.email,
      phone: contacts.phone,
      address: contacts.address,
      sourceLabel: contacts.sourceLabel,
      primaryBusinessUnitId: contacts.primaryBusinessUnitId,
      leadId: latestLead.leadId,
      leadStatus: latestLead.leadStatus,
      currentStage: latestLead.currentStage,
      assignedUserId: latestLead.assignedUserId,
      sourceType: latestLead.sourceType,
      sourceName: latestLead.sourceName,
      originalNotes: latestLead.originalNotes,
      programInterest: latestLead.programInterest,
      preferredDay: latestLead.preferredDay,
      preferredSchedule: latestLead.preferredSchedule,
      testInterest: latestLead.testInterest,
      educationLevel: latestLead.educationLevel,
      schoolName: latestLead.schoolName,
      locationPreference: latestLead.locationPreference,
    })
    .from(contacts)
    .leftJoin(latestLead, eq(latestLead.contactId, contacts.id))
    .where(and(...conditions))
    .orderBy(asc(contacts.name), asc(contacts.id));
  if (!uniqueContactIds.length) request = request.limit(boundedLimit(limit));

  const rows = await request;
  const unitById = new Map(unitRows.map((unit) => [unit.id, unit]));
  return rows.map((row) => toTaskContactOption(row, unitById));
}
