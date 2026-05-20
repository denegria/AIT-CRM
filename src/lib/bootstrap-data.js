import { cache } from 'react';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import * as seedData from './data';
import { getDb } from '../db/index.js';
import { hasPermission, isAuthEnabled, PERMISSIONS, SESSION_SECRET_ENV } from './auth';
import {
  businessUnits as businessUnitsTable,
  contacts as contactsTable,
  workOrders as workOrdersTable,
  estimates as estimatesTable,
  paymentSnapshots as paymentSnapshotsTable,
  notes as notesTable,
  activityEvents as activityEventsTable,
  leads as leadsTable,
  importBatches as importBatchesTable,
  importSourceRows as importSourceRowsTable,
  importNormalizedRecords as importNormalizedRecordsTable,
  importReviewItems as importReviewItemsTable,
} from '../db/schema.js';
import {
  scopedBusinessUnitWhere,
  scopedContactWhere,
  scopedOrgWhere,
} from './crm/access.js';
import { toBusinessUnitPayload } from './crm/payloads.js';
import { workflowFromLead } from './sales-workflow';

const OPERATOR_REVIEW_SOURCE_TYPES = ['xlsx', 'csv', 'spreadsheet'];
const toBootstrapBusinessUnitPayload = (row) => toBusinessUnitPayload(row, { emptyColor: null });

function toIsoDate(value) {
  if (!value) return '';
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}

function mapContacts(contactRows, leadRows, noteRows, eventRows) {
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

  return contactRows.map((contact, index) => {
    const lead = leadByContactId.get(contact.id);
    const workflow = workflowFromLead(lead);
    const noteItems = (notesByContactId.get(contact.id) || []).map((note) => ({
      id: note.id,
      text: note.body,
      date: toIsoDate(note.createdAt),
    }));
    const eventItems = (eventsByContactId.get(contact.id) || []).map((event) => ({
      id: event.id,
      text: event.message || event.eventType,
      date: toIsoDate(event.occurredAt || event.createdAt),
    }));
    const recentActivity = [...noteItems, ...eventItems]
      .filter((item) => item.date)
      .sort((a, b) => b.date.localeCompare(a.date))[0];

    return {
      id: contact.id,
      name: contact.name,
      email: contact.email || '',
      phone: contact.phone || '',
      address: contact.address || '',
      businessUnitId: contact.primaryBusinessUnitId || '',
      primaryBusinessUnitId: contact.primaryBusinessUnitId || '',
      status: workflow.status,
      currentStage: workflow.currentStage,
      tags: workflow.tags,
      nextAction: workflow.nextAction,
      priority: workflow.priority,
      outreachState: workflow.outreachState,
      needsFirstOutreach: workflow.needsFirstOutreach,
      source: lead?.sourceName || lead?.sourceType || contact.sourceLabel || seedData.SOURCES[index % seedData.SOURCES.length],
      assignedTo: lead?.assignedUserId || '',
      lastContact: recentActivity?.date || toIsoDate(contact.updatedAt) || toIsoDate(contact.createdAt),
      notes: noteItems.length ? noteItems : recentActivity ? [recentActivity] : [],
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
    assignedTo: row.assignedUserId || seedData.EMPLOYEES[index % seedData.EMPLOYEES.length].id,
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
    date: toIsoDate(row.createdAt),
    dueDate: toIsoDate(row.approvedAt || row.rejectedAt || row.createdAt),
    status: row.status || 'Pending',
    items: [],
  }));

  const receipts = paymentRows.map((row, index) => ({
    id: row.id,
    number: `REC-${String(index + 1).padStart(3, '0')}`,
    type: 'Receipt',
    client: '',
    contactId: '',
    businessUnitId: row.businessUnitId || '',
    amount: Number(row.amount || 0),
    date: toIsoDate(row.paidAt),
    status: 'Paid',
    items: [],
  }));

  return [...estimates, ...receipts];
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
      access.canReadImportReview ? getImportStagingSummary(db) : Promise.resolve(null),
    ]);

    if (!contactRows.length) {
      return {
        ...emptyDbData(businessUnitRows, importStaging),
        currentUser: session.user,
        access,
      };
    }

    const contacts = mapContacts(contactRows, leadRows, noteRows, eventRows);
    const contactLookup = new Map(contacts.map((contact) => [contact.id, contact]));
    const workOrders = mapWorkOrders(workOrderRows, contactLookup);
    const financials = mapFinancials(estimateRows, paymentRows, contactLookup);
    return {
      ...seedData,
      dataSource: 'postgres',
      authRequired: false,
      authError: '',
      currentUser: session.user,
      access,
      businessUnits: businessUnitRows.map(toBootstrapBusinessUnitPayload),
      contacts,
      workOrders,
      financials,
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
