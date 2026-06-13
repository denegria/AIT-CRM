import { cache } from 'react';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import * as seedData from './data';
import { getDb } from '../db/index.js';
import { hasPermission, isAuthEnabled, PERMISSIONS, SESSION_SECRET_ENV } from './auth';
import {
  businessUnits as businessUnitsTable,
  contacts as contactsTable,
  contactPeople as contactPeopleTable,
  workOrders as workOrdersTable,
  estimates as estimatesTable,
  paymentSnapshots as paymentSnapshotsTable,
  notes as notesTable,
  activityEvents as activityEventsTable,
  tasks as tasksTable,
  leads as leadsTable,
  users as usersTable,
  businessUnitMemberships as businessUnitMembershipsTable,
  importBatches as importBatchesTable,
  importSourceRows as importSourceRowsTable,
  importNormalizedRecords as importNormalizedRecordsTable,
  importReviewItems as importReviewItemsTable,
  conversationMessages as conversationMessagesTable,
} from '../db/schema.js';
import {
  scopedBusinessUnitWhere,
  scopedContactWhere,
  scopedOrgWhere,
} from './crm/access.js';
import { toBusinessUnitPayload } from './crm/payloads.js';
import { isPipelineEligibleContact, workflowFromLead } from './sales-workflow';
import { TASK_STATUSES } from './tasks/constants.js';
import { buildContactTimeline, filterTimelineRowsForBusinessUnit } from './timeline/service.js';
import { latestExcelDateFromText, summarizeContactTouch } from './contact-touch.js';
import { buildAitUsaEnrollmentSignals } from './ait-usa-enrollment-signals.js';
import { attachPaymentSnapshotContactLinks } from './financial-linkage.js';

const OPERATOR_REVIEW_SOURCE_TYPES = ['xlsx', 'csv', 'spreadsheet'];
const toBootstrapBusinessUnitPayload = (row) => toBusinessUnitPayload(row, { emptyColor: null });

function toIsoDate(value) {
  if (!value) return '';
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}

function toIsoDateTime(value) {
  if (!value) return '';
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString();
}

function clean(value) {
  return String(value || '').trim();
}

function latestTime(...values) {
  return values.reduce((latest, value) => {
    const time = value instanceof Date ? value.getTime() : new Date(value || '').getTime();
    return Number.isNaN(time) ? latest : Math.max(latest, time);
  }, 0);
}

function sourceCategoryForContact({ source = '', sourceLabel = '', workflowKey = '' } = {}) {
  const text = [source, sourceLabel].map(clean).join(' ').toLowerCase();
  if (text.includes('website') || text.includes('web form') || text.includes('wix') || text.includes('wordpress')) {
    return 'Website Form Submission';
  }
  if (
    workflowKey === 'ait_signs' ||
    text.includes('workbook') ||
    text.includes('xlsx') ||
    text.includes('spreadsheet') ||
    text.includes('archive') ||
    text.includes('work_order') ||
    text.includes('estimate') ||
    text.includes('interesados') ||
    text.includes('ait signs')
  ) {
    return 'Workbook Import';
  }
  if (!text) return 'Manual / Unknown';
  return 'Other Source';
}

function aitSignsSourceActivityDate({
  lead = null,
  events = [],
  notes = [],
  workOrders = [],
  estimates = [],
  paymentSnapshots = [],
} = {}) {
  const referenceTime = Date.now();
  const textTime = [
    lead?.originalNotes,
    ...(events || []).map((event) => event.message || event.eventType || ''),
    ...(notes || []).map((note) => note.body || ''),
  ].reduce((latest, text) => Math.max(latest, latestExcelDateFromText(text, { referenceTime })), 0);

  const explicitTime = latestTime(
    ...(workOrders || []).map((row) => row.deliveryDate),
    ...(estimates || []).flatMap((row) => [row.approvedAt, row.rejectedAt]),
    ...(paymentSnapshots || []).map((row) => row.paidAt),
  );

  return toIsoDateTime(Math.max(textTime, explicitTime));
}

function rowsByContactId(rows = []) {
  const lookup = new Map();
  for (const row of rows) {
    if (!row.contactId) continue;
    const list = lookup.get(row.contactId) || [];
    list.push(row);
    lookup.set(row.contactId, list);
  }
  return lookup;
}

function submittedAtForLead(contactEvents = [], lead = null) {
  const leadEvents = contactEvents
    .filter((event) => {
      const eventType = clean(event.eventType).toLowerCase();
      if (eventType !== 'website_lead_captured') return false;
      return !lead?.id || !event.leadId || event.leadId === lead.id;
    })
    .map((event) => event.occurredAt || event.createdAt)
    .filter(Boolean)
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime());
  const submittedAt = leadEvents[0];
  return submittedAt?.toISOString?.() || submittedAt || '';
}

function mapEmployees(userRows = [], membershipRows = []) {
  const membershipsByUserId = new Map();
  for (const membership of membershipRows) {
    if (!membership.userId || !membership.businessUnitId) continue;
    const list = membershipsByUserId.get(membership.userId) || [];
    list.push(membership.businessUnitId);
    membershipsByUserId.set(membership.userId, list);
  }

  return userRows.map((user) => ({
    id: user.id,
    name: user.name || user.email || 'Unnamed User',
    email: user.email || '',
    phone: user.phone || '',
    businessUnitIds: membershipsByUserId.get(user.id) || [],
  }));
}

function mapContacts(
  contactRows,
  leadRows,
  noteRows,
  eventRows,
  businessUnitRows = [],
  businessUnitIds = null,
  relatedRows = {},
) {
  const leadByContactId = new Map();
  for (const lead of leadRows) {
    if (!lead.contactId || leadByContactId.has(lead.contactId)) continue;
    leadByContactId.set(lead.contactId, lead);
  }

  const notesByContactId = new Map();
  for (const note of noteRows) {
    if (!note.contactId) continue;
    const list = notesByContactId.get(note.contactId) || [];
    list.push(note);
    notesByContactId.set(note.contactId, list);
  }

  const eventsByContactId = new Map();
  for (const event of eventRows) {
    if (!event.contactId) continue;
    const list = eventsByContactId.get(event.contactId) || [];
    list.push(event);
    eventsByContactId.set(event.contactId, list);
  }

  const businessUnitById = new Map(businessUnitRows.map((unit) => [unit.id, unit]));
  const workOrdersByContactId = rowsByContactId(relatedRows.workOrders || []);
  const estimatesByContactId = rowsByContactId(relatedRows.estimates || []);
  const paymentSnapshotsByContactId = rowsByContactId(relatedRows.paymentSnapshots || []);
  const conversationMessagesByContactId = rowsByContactId(relatedRows.conversationMessages || []);
  const peopleByContactId = rowsByContactId(relatedRows.contactPeople || []);

  return contactRows.map((contact, index) => {
    const lead = leadByContactId.get(contact.id);
    const businessUnit = businessUnitById.get(contact.primaryBusinessUnitId) || null;
    const contactWorkOrders = workOrdersByContactId.get(contact.id) || [];
    const contactEstimates = estimatesByContactId.get(contact.id) || [];
    const contactPaymentSnapshots = paymentSnapshotsByContactId.get(contact.id) || [];
    const contactPeople = (peopleByContactId.get(contact.id) || [])
      .slice()
      .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary) || clean(left.name).localeCompare(clean(right.name)));
    const workflow = workflowFromLead(lead, {
      businessUnit,
      workOrders: contactWorkOrders,
      estimates: contactEstimates,
      paymentSnapshots: contactPaymentSnapshots,
    });
    const contactNotes = filterTimelineRowsForBusinessUnit(notesByContactId.get(contact.id) || [], businessUnitIds);
    const contactEvents = filterTimelineRowsForBusinessUnit(eventsByContactId.get(contact.id) || [], businessUnitIds);
    const submittedAt = submittedAtForLead(contactEvents, lead);
    const contactConversationMessages = filterTimelineRowsForBusinessUnit(
      conversationMessagesByContactId.get(contact.id) || [],
      businessUnitIds,
    );
    const source = lead?.sourceName || lead?.sourceType || contact.sourceLabel || seedData.SOURCES[index % seedData.SOURCES.length];
    const touchSummary = summarizeContactTouch({
      contact,
      businessUnit,
      notes: contactNotes,
      activityEvents: contactEvents,
      conversationMessages: contactConversationMessages,
      workOrders: contactWorkOrders,
      estimates: contactEstimates,
      paymentSnapshots: contactPaymentSnapshots,
    });
    const isPipelineEligible = isPipelineEligibleContact({
      ...contact,
      source,
      hasLeadStatus: Boolean(lead),
      leadId: lead?.id || '',
    }, {
      businessUnit,
      workOrders: contactWorkOrders,
      estimates: contactEstimates,
      paymentSnapshots: contactPaymentSnapshots,
      activityEvents: contactEvents,
      lastTouch: touchSummary.lastTouch,
      lastFollowUpTouch: touchSummary.lastFollowUpTouch,
    });
    const noteItems = contactNotes.map((note) => ({
      id: note.id,
      text: note.body,
      createdAt: note.createdAt?.toISOString?.() || '',
      timestamp: note.createdAt?.toISOString?.() || '',
      date: toIsoDate(note.createdAt),
    }));
    const eventItems = contactEvents.map((event) => ({
      id: event.id,
      text: event.message || event.eventType,
      date: toIsoDate(event.occurredAt || event.createdAt),
    }));
    const timelineItems = buildContactTimeline({
      notes: contactNotes,
      activityEvents: contactEvents,
      leads: lead ? [lead] : [],
      businessUnits: businessUnitRows,
    });
    const enrollmentSignals = buildAitUsaEnrollmentSignals({
      contact,
      lead,
      workflow,
    });
    const sourceActivityDate = workflow.workflowKey === 'ait_signs'
      ? aitSignsSourceActivityDate({
        lead,
        events: contactEvents,
        notes: contactNotes,
        workOrders: contactWorkOrders,
        estimates: contactEstimates,
        paymentSnapshots: contactPaymentSnapshots,
      })
      : submittedAt;

    return {
      id: contact.id,
      name: contact.name,
      companyName: contact.companyName || '',
      email: contact.email || '',
      phone: contact.phone || '',
      address: contact.address || '',
      isDoNotCall: Boolean(contact.isDoNotCall),
      isWrongNumber: Boolean(contact.isWrongNumber),
      businessUnitId: contact.primaryBusinessUnitId || '',
      primaryBusinessUnitId: contact.primaryBusinessUnitId || '',
      businessUnitName: businessUnit?.name || '',
      hasLeadStatus: Boolean(lead),
      isPipelineEligible,
      workflowKey: workflow.workflowKey,
      workflowLabel: workflow.workflowLabel,
      status: workflow.status,
      currentStage: workflow.currentStage,
      tags: workflow.tags,
      nextAction: workflow.nextAction,
      priority: workflow.priority,
      outreachState: workflow.outreachState,
      needsFirstOutreach: workflow.needsFirstOutreach,
      source,
      sourceLabel: contact.sourceLabel || '',
      sourceCategory: sourceCategoryForContact({
        source,
        sourceLabel: contact.sourceLabel,
        workflowKey: workflow.workflowKey,
      }),
      sourceActivityDate,
      assignedTo: lead?.assignedUserId || '',
      submittedAt,
      contactCreatedAt: contact.createdAt?.toISOString?.() || contact.createdAt || '',
      leadCreatedAt: lead?.createdAt?.toISOString?.() || lead?.createdAt || '',
      createdAt: lead?.createdAt?.toISOString?.() || contact.createdAt?.toISOString?.() || lead?.createdAt || contact.createdAt || '',
      lastContact: touchSummary.lastTouch,
      lastTouch: touchSummary.lastTouch,
      lastTouchLabel: touchSummary.lastTouchLabel,
      lastTouchText: touchSummary.lastTouchText,
      lastFollowUpTouch: touchSummary.lastFollowUpTouch,
      lastFollowUpTouchText: touchSummary.lastFollowUpTouchText,
      hasRecentFollowUpTouch: touchSummary.hasRecentFollowUpTouch,
      latestComment: touchSummary.latestComment,
      latestCommentDate: touchSummary.latestCommentDate,
      latestCommentLabel: touchSummary.latestCommentLabel,
      lastEdited: touchSummary.lastEdited,
      enrollmentSignals,
      inquirySource: enrollmentSignals?.source?.channel || '',
      programInterest: enrollmentSignals?.inquiry?.programInterest || '',
      contactabilityStatus: enrollmentSignals?.contactability?.status || '',
      qualityDisposition: enrollmentSignals?.quality?.disposition || '',
      processPills: enrollmentSignals?.process?.pills || [],
      linkedPeopleCount: contactPeople.length,
      linkedPeoplePreview: contactPeople.slice(0, 3).map((person) => person.name).filter(Boolean).join(', '),
      primaryLinkedPerson: contactPeople.find((person) => person.isPrimary)?.name || contactPeople[0]?.name || '',
      notes: noteItems.length ? noteItems : eventItems,
      timeline: timelineItems,
    };
  });
}

function mapWorkOrders(rows, contactLookup) {
  return rows.map((row, index) => ({
    id: row.id,
    number: row.workOrderNumber || `WO-${String(index + 1).padStart(3, '0')}`,
    title: row.title || row.status || `Work Order ${index + 1}`,
    client: contactLookup.get(row.contactId)?.name || '',
    contactId: row.contactId || '',
    businessUnitId: row.businessUnitId || '',
    priority: row.priority || 'Medium',
    status: row.status || 'Pending',
    assignedTo: row.assignedUserId || '',
    dueDate: toIsoDate(row.deliveryDate),
    description: row.description || '',
    estimatedCost: Number(row.estimatedCost || 0),
  }));
}

function mapFinancials(estimateRows, paymentRows, contactLookup) {
  const estimates = estimateRows.map((row, index) => ({
    id: row.id,
    number: row.estimateNumber || `EST-${String(index + 1).padStart(3, '0')}`,
    type: 'Estimate',
    client: contactLookup.get(row.contactId)?.name || '',
    contactId: row.contactId || '',
    businessUnitId: row.businessUnitId || '',
    amount: Number(row.total || row.subtotal || 0),
    paidAmount: Number(row.advancePaid || 0),
    balanceDue: Number(row.balanceDue || 0),
    subtotal: Number(row.subtotal || 0),
    tax: Number(row.tax || 0),
    date: toIsoDate(row.createdAt),
    dueDate: toIsoDate(row.approvedAt || row.rejectedAt || row.createdAt),
    status: row.status || 'Pending',
    items: [],
  }));

  const receipts = paymentRows.map((row, index) => ({
    id: row.id,
    number: row.paymentNumber ? `REC-${String(row.paymentNumber).padStart(3, '0')}` : `REC-${String(index + 1).padStart(3, '0')}`,
    type: 'Receipt',
    client: contactLookup.get(row.contactId)?.name || '',
    contactId: row.contactId || '',
    businessUnitId: row.businessUnitId || '',
    estimateId: row.estimateId || '',
    workOrderId: row.workOrderId || '',
    amount: Number(row.amount || 0),
    paidAmount: Number(row.amount || 0),
    paymentMethod: row.paymentMethod || '',
    checkNumber: row.checkNumber || '',
    balanceDue: row.balanceAfter === null || row.balanceAfter === undefined ? null : Number(row.balanceAfter),
    date: toIsoDate(row.paidAt),
    status: 'Paid',
    items: [{
      desc: 'Payment received',
      qty: 1,
      rate: Number(row.amount || 0),
      amount: Number(row.amount || 0),
    }],
  }));

  return [...estimates, ...receipts];
}

function toDisplayPriority(value) {
  if (!value) return 'Medium';
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ');
}

function mapTasks(rows, contactLookup) {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description || '',
    businessUnitId: row.businessUnitId || '',
    contactId: row.contactId || '',
    leadId: row.leadId || '',
    workOrderId: row.workOrderId || '',
    client: contactLookup.get(row.contactId)?.name || '',
    assignedTo: row.ownerUserId || '',
    dueDate: toIsoDate(row.dueAt),
    completed: Boolean(row.completedAt || row.status === TASK_STATUSES.COMPLETED),
    priority: toDisplayPriority(row.priority),
    taskType: row.taskType,
    taskStatus: row.status,
    sourceType: row.sourceType || '',
    sourceLabel: row.sourceLabel || '',
  }));
}

function authData({ authRequired = false, authError = '', currentUser = null } = {}) {
  return {
    ...seedData,
    dataSource: process.env.DATABASE_URL ? 'postgres' : 'local',
    authRequired,
    authError,
    currentUser,
    access: {
      canReadCrm: Boolean(currentUser),
      canWriteCrm: false,
      canReadImportReview: false,
      canWriteImportReview: false,
      canReadSettings: false,
      canWriteSettings: false,
      canReadReports: false,
      canReadFinancials: false,
      canWriteFinancials: false,
      canWriteWorkOrders: false,
    },
    importStaging: null,
    contacts: [],
    workOrders: [],
    financials: [],
    tasks: [],
    calendarEvents: [],
    salesLedger: [],
  };
}

function sessionAccess(session) {
  return {
    canReadCrm: hasPermission(session, PERMISSIONS.CRM_READ),
    canWriteCrm: hasPermission(session, PERMISSIONS.CRM_WRITE),
    canReadImportReview: hasPermission(session, PERMISSIONS.IMPORT_REVIEW_READ),
    canWriteImportReview: hasPermission(session, PERMISSIONS.IMPORT_REVIEW_WRITE),
    canReadSettings: hasPermission(session, PERMISSIONS.SETTINGS_READ),
    canWriteSettings: hasPermission(session, PERMISSIONS.SETTINGS_WRITE),
    canReadReports: hasPermission(session, PERMISSIONS.REPORTS_READ),
    canReadFinancials: hasPermission(session, PERMISSIONS.FINANCIALS_READ),
    canWriteFinancials: hasPermission(session, PERMISSIONS.FINANCIALS_WRITE),
    canWriteWorkOrders: hasPermission(session, PERMISSIONS.WORK_ORDERS_WRITE),
  };
}

async function countRowsForBatch(db, table, batchId) {
  if (!batchId) return 0;
  const rows = await db
    .select({ count: sql`count(*)::int` })
    .from(table)
    .where(eq(table.importBatchId, batchId));
  return Number(rows[0]?.count || 0);
}

async function getOperatorReviewBatch(db) {
  const preferred = await db
    .select()
    .from(importBatchesTable)
    .where(inArray(importBatchesTable.sourceType, OPERATOR_REVIEW_SOURCE_TYPES))
    .orderBy(desc(importBatchesTable.createdAt))
    .limit(1);
  if (preferred[0]) return preferred[0];

  const fallback = await db
    .select()
    .from(importBatchesTable)
    .orderBy(desc(importBatchesTable.createdAt))
    .limit(1);
  return fallback[0] || null;
}

async function getImportStagingSummary(db) {
  const latestBatch = await getOperatorReviewBatch(db);
  const [sourceRows, normalizedRecords, reviewItems] = await Promise.all([
    countRowsForBatch(db, importSourceRowsTable, latestBatch?.id),
    countRowsForBatch(db, importNormalizedRecordsTable, latestBatch?.id),
    countRowsForBatch(db, importReviewItemsTable, latestBatch?.id),
  ]);

  return {
    latestBatch: latestBatch ? {
      id: latestBatch.id,
      sourceName: latestBatch.sourceName,
      sourceType: latestBatch.sourceType,
      fileName: latestBatch.fileName,
      fileHash: latestBatch.fileHash,
      status: latestBatch.status,
      createdAt: latestBatch.createdAt?.toISOString?.() || latestBatch.createdAt || '',
    } : null,
    counts: {
      sourceRows,
      normalizedRecords,
      reviewItems,
    },
  };
}

function emptyDbData(businessUnitRows = [], importStaging = null) {
  return {
    ...seedData,
    dataSource: 'postgres',
    authRequired: false,
    authError: '',
    currentUser: null,
    access: authData().access,
    businessUnits: businessUnitRows.length ? businessUnitRows.map(toBootstrapBusinessUnitPayload) : (seedData.businessUnits || []),
    employees: [],
    contacts: [],
    workOrders: [],
    financials: [],
    tasks: [],
    calendarEvents: [],
    salesLedger: [],
    importStaging,
  };
}

export const getBootstrapData = cache(async function getBootstrapData(session = null) {
  if (!process.env.DATABASE_URL) {
    return {
      ...seedData,
      authRequired: false,
      currentUser: {
        id: 'local-admin',
        name: 'Local Admin',
        email: '',
        primaryRoleKey: 'admin',
        roleKeys: ['admin'],
        permissions: Object.values(PERMISSIONS),
        businessUnitIds: [],
        canAccessAllBusinessUnits: true,
      },
      access: {
        canReadCrm: true,
        canWriteCrm: true,
        canReadImportReview: true,
        canWriteImportReview: true,
        canReadSettings: true,
        canWriteSettings: true,
        canReadReports: true,
        canReadFinancials: true,
        canWriteFinancials: true,
        canWriteWorkOrders: true,
      },
    };
  }

  if (!isAuthEnabled()) {
    return authData({
      authRequired: true,
      authError: `${SESSION_SECRET_ENV} is required before database-backed CRM data can be shown.`,
    });
  }

  if (!session) {
    return authData({ authRequired: true });
  }

  try {
    const db = getDb();
    const access = sessionAccess(session);
    const [
      businessUnitRows,
      contactRows,
      leadRows,
      workOrderRows,
      estimateRows,
      paymentRows,
      noteRows,
      eventRows,
      conversationMessageRows,
      contactPeopleRows,
      taskRows,
      userRows,
      membershipRows,
      importStaging,
    ] = await Promise.all([
      db.select().from(businessUnitsTable).where(scopedOrgWhere(businessUnitsTable, session)).orderBy(asc(businessUnitsTable.name)),
      db.select().from(contactsTable).where(scopedContactWhere(contactsTable, session)).orderBy(desc(contactsTable.createdAt)),
      db.select().from(leadsTable).where(scopedBusinessUnitWhere(leadsTable, session)).orderBy(desc(leadsTable.createdAt)),
      db.select().from(workOrdersTable).where(scopedBusinessUnitWhere(workOrdersTable, session)).orderBy(desc(workOrdersTable.createdAt)),
      db.select().from(estimatesTable).where(scopedBusinessUnitWhere(estimatesTable, session)).orderBy(desc(estimatesTable.createdAt)),
      db.select().from(paymentSnapshotsTable).where(scopedBusinessUnitWhere(paymentSnapshotsTable, session)).orderBy(desc(paymentSnapshotsTable.createdAt)),
      db.select().from(notesTable).where(scopedOrgWhere(notesTable, session)).orderBy(desc(notesTable.createdAt)),
      db.select().from(activityEventsTable).where(scopedOrgWhere(activityEventsTable, session)).orderBy(desc(activityEventsTable.createdAt)),
      db.select().from(conversationMessagesTable).where(scopedOrgWhere(conversationMessagesTable, session)).orderBy(desc(conversationMessagesTable.occurredAt)),
      db.select().from(contactPeopleTable).where(scopedOrgWhere(contactPeopleTable, session)).orderBy(desc(contactPeopleTable.isPrimary), asc(contactPeopleTable.name)),
      db.select().from(tasksTable).where(scopedBusinessUnitWhere(tasksTable, session)).orderBy(asc(tasksTable.dueAt), desc(tasksTable.createdAt)),
      db.select().from(usersTable).where(and(
        eq(usersTable.organizationId, session.user.organizationId),
        eq(usersTable.isActive, true),
      )).orderBy(asc(usersTable.name), asc(usersTable.email)),
      db.select().from(businessUnitMembershipsTable),
      access.canReadImportReview ? getImportStagingSummary(db) : Promise.resolve(null),
    ]);
    const employees = mapEmployees(userRows, membershipRows);

    if (!contactRows.length && !taskRows.length) {
      return {
        ...emptyDbData(businessUnitRows, importStaging),
        currentUser: session.user,
        access,
        employees,
      };
    }

    const paymentRowsWithContactLinks = attachPaymentSnapshotContactLinks(paymentRows, eventRows, {
      estimateRows,
      workOrderRows,
    });
    const contacts = mapContacts(
      contactRows,
      leadRows,
      noteRows,
      eventRows,
      businessUnitRows,
      session.user.canAccessAllBusinessUnits ? null : session.user.businessUnitIds,
      {
        workOrders: workOrderRows,
        estimates: estimateRows,
        paymentSnapshots: paymentRowsWithContactLinks,
        conversationMessages: conversationMessageRows,
        contactPeople: contactPeopleRows,
      },
    );
    const contactLookup = new Map(contacts.map((contact) => [contact.id, contact]));
    const workOrders = mapWorkOrders(workOrderRows, contactLookup);
    const financials = mapFinancials(estimateRows, paymentRowsWithContactLinks, contactLookup);
    const tasks = mapTasks(taskRows, contactLookup);
    return {
      ...seedData,
      dataSource: 'postgres',
      authRequired: false,
      authError: '',
      currentUser: session.user,
      access,
      businessUnits: businessUnitRows.map(toBootstrapBusinessUnitPayload),
      employees,
      contacts,
      workOrders,
      financials,
      tasks,
      importStaging,
    };
  } catch (error) {
    console.warn('Falling back to empty CRM data because Postgres bootstrap failed:', error.message);
    return {
      ...emptyDbData(),
      currentUser: session.user,
      access: sessionAccess(session),
    };
  }
});
