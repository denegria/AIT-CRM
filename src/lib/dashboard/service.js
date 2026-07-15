import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  activityEvents,
  businessUnits,
  contactCourseRecords,
  contacts,
  estimates,
  financialDocuments,
  leads,
  leadStatusHistory,
  workOrders,
} from '@/db/schema.js';
import { mapContacts } from '@/lib/bootstrap-data.js';
import { countContactDirectoryRows } from '@/lib/contact-directory/service.js';
import {
  scopedBusinessUnitWhere,
  scopedContactWhere,
  scopedOrgWhere,
  scopedWorkOrderWhere,
} from '@/lib/crm/access.js';
import { WORKFLOW_KEYS, workflowKeyForBusinessUnit } from '@/lib/crm/lifecycle.js';
import { sessionHasAdminRole } from '@/lib/auth/admin-policy.js';
import { summarizeAitUsaDashboardContacts } from '@/lib/dashboard/summary.js';

function directoryParams(businessUnitId, values = {}) {
  const params = new URLSearchParams({ businessUnitId });
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  return params;
}

function isOpenWorkOrder(row = {}) {
  return String(row.status || '').toLowerCase() !== 'completed';
}

function isPendingEstimate(row = {}) {
  const type = String(row.type || '').toLowerCase();
  const status = String(row.status || '').toLowerCase();
  return type === 'estimate' && status !== 'draft' && status !== 'paid';
}

async function loadAitUsaDashboardContacts({ db, session, businessUnit, employeeIds }) {

  const compactContacts = await db
    .select({
      id: contacts.id,
      primaryBusinessUnitId: contacts.primaryBusinessUnitId,
      name: contacts.name,
      companyName: contacts.companyName,
      phone: contacts.phone,
      email: contacts.email,
      address: contacts.address,
      sourceLabel: contacts.sourceLabel,
      isDoNotCall: contacts.isDoNotCall,
      isWrongNumber: contacts.isWrongNumber,
      createdAt: contacts.createdAt,
      updatedAt: contacts.updatedAt,
    })
    .from(contacts)
    .where(and(scopedContactWhere(contacts, session), eq(contacts.primaryBusinessUnitId, businessUnit.id)));
  const contactIds = compactContacts.map((row) => row.id);
  if (!contactIds.length) {
    return summarizeAitUsaDashboardContacts({
      mappedContacts: [],
      currentUserId: session.user.id,
      employeeIds,
      includeBusinessMovement: sessionHasAdminRole(session),
    });
  }

  const [latestLeads, websiteEvents, courseRows, statusRows] = await Promise.all([
    db
      .selectDistinctOn([leads.contactId], {
        id: leads.id,
        contactId: leads.contactId,
        businessUnitId: leads.businessUnitId,
        sourceType: leads.sourceType,
        sourceName: leads.sourceName,
        status: leads.status,
        currentStage: leads.currentStage,
        assignedUserId: leads.assignedUserId,
        currentCourse: leads.currentCourse,
        completedCourse: leads.completedCourse,
        endedCourse: leads.endedCourse,
        courseOutcome: leads.courseOutcome,
        originalNotes: leads.originalNotes,
        sourceDetail: leads.sourceDetail,
        createdAt: leads.createdAt,
      })
      .from(leads)
      .where(and(scopedBusinessUnitWhere(leads, session), inArray(leads.contactId, contactIds)))
      .orderBy(leads.contactId, desc(leads.createdAt), desc(leads.id)),
    db
      .select({
        contactId: activityEvents.contactId,
        leadId: activityEvents.leadId,
        businessUnitId: activityEvents.businessUnitId,
        eventType: activityEvents.eventType,
        occurredAt: activityEvents.occurredAt,
        createdAt: activityEvents.createdAt,
      })
      .from(activityEvents)
      .where(and(
        scopedBusinessUnitWhere(activityEvents, session),
        eq(activityEvents.businessUnitId, businessUnit.id),
        eq(activityEvents.eventType, 'website_lead_captured'),
        inArray(activityEvents.contactId, contactIds),
      )),
    db
      .select({
        contactId: contactCourseRecords.contactId,
        courseName: contactCourseRecords.courseName,
        courseLocation: contactCourseRecords.courseLocation,
        teacher: contactCourseRecords.teacher,
        status: contactCourseRecords.status,
        startDate: contactCourseRecords.startDate,
        endDate: contactCourseRecords.endDate,
        outcomeReason: contactCourseRecords.outcomeReason,
        createdAt: contactCourseRecords.createdAt,
        updatedAt: contactCourseRecords.updatedAt,
      })
      .from(contactCourseRecords)
      .where(and(scopedBusinessUnitWhere(contactCourseRecords, session), inArray(contactCourseRecords.contactId, contactIds))),
    db
      .select({
        contactId: leadStatusHistory.contactId,
        businessUnitId: leadStatusHistory.businessUnitId,
        fromStatus: leadStatusHistory.fromStatus,
        toStatus: leadStatusHistory.toStatus,
        actorUserId: leadStatusHistory.actorUserId,
        metadataJson: leadStatusHistory.metadataJson,
        occurredAt: leadStatusHistory.occurredAt,
        createdAt: leadStatusHistory.createdAt,
      })
      .from(leadStatusHistory)
      .where(and(
        scopedBusinessUnitWhere(leadStatusHistory, session),
        inArray(leadStatusHistory.contactId, contactIds),
        inArray(leadStatusHistory.toStatus, ['Enrolled', 'Dropped / Quit']),
      )),
  ]);

  const mapped = mapContacts(
    compactContacts,
    latestLeads,
    [],
    websiteEvents,
    [businessUnit],
    session.user.canAccessAllBusinessUnits ? null : session.user.businessUnitIds,
    { courseRecords: courseRows, leadStatusHistory: statusRows },
  );
  return summarizeAitUsaDashboardContacts({
    mappedContacts: mapped,
    currentUserId: session.user.id,
    employeeIds,
    includeBusinessMovement: sessionHasAdminRole(session),
  });
}

export async function loadDashboardSummary({ db, session, businessUnitId, employeeIds = [] }) {
  const [businessUnit] = await db
    .select()
    .from(businessUnits)
    .where(and(scopedOrgWhere(businessUnits, session), eq(businessUnits.id, businessUnitId)))
    .limit(1);
  const allowed = businessUnit && (
    session.user.canAccessAllBusinessUnits || session.user.businessUnitIds.includes(businessUnit.id)
  );
  if (!allowed) {
    const error = new Error('Insufficient business-unit access.');
    error.status = 403;
    throw error;
  }

  const workflowKey = workflowKeyForBusinessUnit(businessUnit);
  const currentParams = directoryParams(businessUnitId, { leadDateScope: 'current' });
  const countRows = (values, options = {}) => countContactDirectoryRows({
    db,
    session,
    searchParams: directoryParams(businessUnitId, values),
    businessUnitRows: [businessUnit],
    ...options,
  });
  const contactCountRequests = workflowKey === WORKFLOW_KEYS.AIT_USA ? [] : [
    countContactDirectoryRows({ db, session, searchParams: currentParams, businessUnitRows: [businessUnit] }),
    countRows({ status: 'New Lead' }),
    countRows({ leadDateScope: 'current', owner: session.user.id }),
    countRows({ leadDateScope: 'current', facet: 'needs_first_outreach' }),
    countRows({ source: 'Website Form Submission' }),
  ];

  if (workflowKey === WORKFLOW_KEYS.AIT_SIGNS) {
    contactCountRequests.push(
      countRows({ facet: 'signs_intake' }),
      countRows({ facet: 'signs_estimate' }),
      countRows({ facet: 'signs_work_order' }),
      countRows({ facet: 'signs_fulfillment' }),
      countRows({ facet: 'signs_payment_balance' }),
      countRows({ leadDateScope: 'current', status: 'Intake' }),
    );
  }

  const [contactCounts, workOrderRows, estimateRows, documentRows, aitUsaSummary] = await Promise.all([
    Promise.all(contactCountRequests),
    db
      .select({ status: workOrders.status, assignedUserId: workOrders.assignedUserId })
      .from(workOrders)
      .where(and(scopedWorkOrderWhere(workOrders, session), eq(workOrders.businessUnitId, businessUnitId))),
    db
      .select({ status: estimates.status, total: estimates.total, subtotal: estimates.subtotal })
      .from(estimates)
      .where(and(scopedBusinessUnitWhere(estimates, session), eq(estimates.businessUnitId, businessUnitId))),
    db
      .select({
        type: financialDocuments.documentType,
        status: financialDocuments.status,
        total: financialDocuments.total,
        subtotal: financialDocuments.subtotal,
      })
      .from(financialDocuments)
      .where(and(scopedBusinessUnitWhere(financialDocuments, session), eq(financialDocuments.businessUnitId, businessUnitId))),
    workflowKey === WORKFLOW_KEYS.AIT_USA
      ? loadAitUsaDashboardContacts({ db, session, businessUnit, employeeIds })
      : null,
  ]);

  const [
    countedActiveContacts = 0,
    countedNewLeads = 0,
    countedMyPipeline = 0,
    countedNeedsFirstOutreach = 0,
    countedWebsiteLeads = 0,
    ...workflowCounts
  ] = contactCounts;
  const activeContacts = aitUsaSummary?.kpis.activeContacts ?? countedActiveContacts;
  const newLeads = aitUsaSummary?.kpis.newLeads ?? countedNewLeads;
  const myPipeline = aitUsaSummary?.kpis.myPipeline ?? countedMyPipeline;
  const needsFirstOutreach = aitUsaSummary?.kpis.needsFirstOutreach ?? countedNeedsFirstOutreach;
  const websiteLeads = aitUsaSummary?.websiteLeads ?? countedWebsiteLeads;
  const financialRows = [
    ...estimateRows.map((row) => ({ type: 'Estimate', status: row.status, amount: Number(row.total || row.subtotal || 0) })),
    ...documentRows.map((row) => ({ type: row.type, status: row.status, amount: Number(row.total || row.subtotal || 0) })),
  ];
  const invoices = financialRows.filter((row) => String(row.type || '').toLowerCase() === 'invoice');
  const pendingEstimates = financialRows.filter(isPendingEstimate);
  const openWorkOrders = workOrderRows.filter(isOpenWorkOrder);
  const kpis = {
    totalRevenue: invoices.filter((row) => String(row.status || '').toLowerCase() === 'paid').reduce((sum, row) => sum + row.amount, 0),
    pipeline: financialRows.filter((row) => String(row.type || '').toLowerCase() === 'estimate' && String(row.status || '').toLowerCase() !== 'draft').reduce((sum, row) => sum + row.amount, 0),
    totalInvoiced: invoices.reduce((sum, row) => sum + row.amount, 0),
    activeWOs: openWorkOrders.length,
    inProgressWorkOrders: workOrderRows.filter((row) => String(row.status || '').toLowerCase() === 'in progress').length,
    newLeads,
    activeContacts,
    pendingInvoices: invoices.filter((row) => String(row.status || '').toLowerCase() === 'pending').length,
    assignedWOs: openWorkOrders.filter((row) => row.assignedUserId === session.user.id).length,
    myPipeline,
    needsFirstOutreach,
    pendingEstimates: pendingEstimates.length,
    pendingEstimateValue: pendingEstimates.reduce((sum, row) => sum + row.amount, 0),
    signsIntake: 0,
    signsEstimate: 0,
    signsWorkOrder: 0,
    signsFulfillment: 0,
    signsPayment: 0,
    signsFirstOutreach: 0,
    usaNewLeads: 0,
    usaFollowUp: 0,
    usaBadContactChannel: 0,
  };
  if (workflowKey === WORKFLOW_KEYS.AIT_USA) {
    kpis.usaNewLeads = aitUsaSummary?.kpis.usaNewLeads ?? 0;
    kpis.usaFollowUp = aitUsaSummary?.kpis.usaFollowUp ?? 0;
    kpis.usaBadContactChannel = aitUsaSummary?.kpis.usaBadContactChannel ?? 0;
  } else if (workflowKey === WORKFLOW_KEYS.AIT_SIGNS) {
    [
      kpis.signsIntake,
      kpis.signsEstimate,
      kpis.signsWorkOrder,
      kpis.signsFulfillment,
      kpis.signsPayment,
      kpis.signsFirstOutreach,
    ] = workflowCounts;
  }

  return {
    businessUnitId,
    workflowKey,
    kpis,
    sourceHealth: { websiteLeads },
    businessMovement: aitUsaSummary?.businessMovement ?? null,
  };
}
