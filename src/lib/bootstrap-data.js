import { cache } from 'react';
import { asc, desc, sql } from 'drizzle-orm';
import * as seedData from './data';
import { getDb } from '../db/index.js';
import {
  contacts as contactsTable,
  workOrders as workOrdersTable,
  estimates as estimatesTable,
  paymentSnapshots as paymentSnapshotsTable,
  notes as notesTable,
  activityEvents as activityEventsTable,
  leads as leadsTable,
  businessUnits as businessUnitsTable,
  importBatches as importBatchesTable,
  importSourceRows as importSourceRowsTable,
  importNormalizedRecords as importNormalizedRecordsTable,
  importReviewItems as importReviewItemsTable,
} from '../db/schema.js';

function toIsoDate(value) {
  if (!value) return '';
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}

function toStatusFromLead(lead) {
  if (!lead) return 'New Lead';
  const status = String(lead.status || '').toLowerCase();
  if (status.includes('lost')) return 'Lost';
  if (status.includes('won') || status.includes('qualified')) return 'Qualified';
  if (status.includes('proposal') || status.includes('estimate')) return 'Proposal Sent';
  if (status.includes('contact')) return 'Contacted';
  return 'New Lead';
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
      status: toStatusFromLead(lead),
      source: lead?.sourceName || lead?.sourceType || contact.sourceLabel || seedData.SOURCES[index % seedData.SOURCES.length],
      assignedTo: lead?.assignedUserId || seedData.EMPLOYEES[index % seedData.EMPLOYEES.length].id,
      lastContact: recentActivity?.date || toIsoDate(contact.updatedAt) || toIsoDate(contact.createdAt),
      notes: noteItems.length ? noteItems : recentActivity ? [recentActivity] : [],
    };
  });
}

function mapWorkOrders(rows, contactLookup) {
  return rows.map((row, index) => ({
    id: row.id,
    number: row.workOrderNumber || `WO-${String(index + 1).padStart(3, '0')}`,
    title: row.status || `Work Order ${index + 1}`,
    client: contactLookup.get(row.contactId)?.name || '',
    contactId: row.contactId || '',
    priority: row.priority || 'Medium',
    status: row.status || 'Pending',
    assignedTo: row.assignedUserId || seedData.EMPLOYEES[index % seedData.EMPLOYEES.length].id,
    dueDate: toIsoDate(row.deliveryDate),
    description: '',
    estimatedCost: 0,
  }));
}

function mapFinancials(estimateRows, paymentRows, contactLookup) {
  const estimates = estimateRows.map((row, index) => ({
    id: row.id,
    number: row.estimateNumber || `EST-${String(index + 1).padStart(3, '0')}`,
    type: 'Estimate',
    client: contactLookup.get(row.contactId)?.name || '',
    contactId: row.contactId || '',
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
    amount: Number(row.amount || 0),
    date: toIsoDate(row.paidAt),
    status: 'Paid',
    items: [],
  }));

  return [...estimates, ...receipts];
}

function mapBusinessUnits(rows) {
  if (!rows.length) return seedData.businessUnits || [];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    label: row.label || 'Divisions',
    color: row.color || null,
    isActive: row.isActive ?? true,
  }));
}

async function countRows(db, table) {
  const rows = await db.select({ count: sql`count(*)::int` }).from(table);
  return Number(rows[0]?.count || 0);
}

async function getImportStagingSummary(db) {
  const [latestBatchRows, sourceRows, normalizedRecords, reviewItems] = await Promise.all([
    db.select().from(importBatchesTable).orderBy(desc(importBatchesTable.createdAt)).limit(1),
    countRows(db, importSourceRowsTable),
    countRows(db, importNormalizedRecordsTable),
    countRows(db, importReviewItemsTable),
  ]);
  const latestBatch = latestBatchRows[0];

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
    businessUnits: mapBusinessUnits(businessUnitRows),
    contacts: [],
    workOrders: [],
    financials: [],
    tasks: [],
    calendarEvents: [],
    salesLedger: [],
    importStaging,
  };
}

export const getBootstrapData = cache(async function getBootstrapData() {
  if (!process.env.DATABASE_URL) {
    return seedData;
  }

  try {
    const db = getDb();
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
      db.select().from(businessUnitsTable).orderBy(asc(businessUnitsTable.name)),
      db.select().from(contactsTable).orderBy(desc(contactsTable.createdAt)),
      db.select().from(leadsTable).orderBy(desc(leadsTable.createdAt)),
      db.select().from(workOrdersTable).orderBy(desc(workOrdersTable.createdAt)),
      db.select().from(estimatesTable).orderBy(desc(estimatesTable.createdAt)),
      db.select().from(paymentSnapshotsTable).orderBy(desc(paymentSnapshotsTable.createdAt)),
      db.select().from(notesTable).orderBy(desc(notesTable.createdAt)),
      db.select().from(activityEventsTable).orderBy(desc(activityEventsTable.createdAt)),
      getImportStagingSummary(db),
    ]);

    if (!contactRows.length) {
      return emptyDbData(businessUnitRows, importStaging);
    }

    const contacts = mapContacts(contactRows, leadRows, noteRows, eventRows);
    const contactLookup = new Map(contacts.map((contact) => [contact.id, contact]));
    const workOrders = mapWorkOrders(workOrderRows, contactLookup);
    const financials = mapFinancials(estimateRows, paymentRows, contactLookup);
    return {
      ...seedData,
      dataSource: 'postgres',
      businessUnits: mapBusinessUnits(businessUnitRows),
      contacts,
      workOrders,
      financials,
      importStaging,
    };
  } catch (error) {
    console.warn('Falling back to empty CRM data because Postgres bootstrap failed:', error.message);
    return emptyDbData();
  }
});
