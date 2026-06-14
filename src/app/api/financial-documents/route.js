import { NextResponse } from 'next/server';
import { and, count, eq } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import { businessUnits, contacts, financialDocuments, workOrders } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import {
  resolveBusinessUnitId,
  resolveContactById,
} from '@/lib/crm/access.js';
import { createCrmError, crmErrorResponse } from '@/lib/crm/errors.js';

const SUPPORTED_DOCUMENT_TYPES = new Set(['Estimate', 'Invoice']);

function money(value) {
  if (value === null || value === undefined || value === '') return 0;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function dateOnly(value) {
  if (!value) return null;
  const date = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function toIsoDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function documentToFinancialPayload(row, contact = null) {
  const total = money(row.total || row.subtotal);
  const paidAmount = money(row.paidAmount);
  const items = Array.isArray(row.itemsJson) ? row.itemsJson : [];
  return {
    id: row.id,
    number: row.documentNumber || '',
    type: row.documentType || '',
    client: contact?.name || '',
    contactId: row.contactId || '',
    businessUnitId: row.businessUnitId || '',
    workOrderId: row.workOrderId || '',
    estimateId: row.estimateId || '',
    amount: total,
    paidAmount,
    balanceDue: row.balanceDue === null || row.balanceDue === undefined ? Math.max(total - paidAmount, 0) : money(row.balanceDue),
    subtotal: money(row.subtotal),
    tax: money(row.tax),
    date: toIsoDate(row.issueDate || row.createdAt),
    dueDate: toIsoDate(row.dueDate || row.createdAt),
    status: row.status || 'Pending',
    items,
    note: row.notes || '',
  };
}

async function nextDocumentNumber(db, organizationId, type) {
  const [row] = await db
    .select({ value: count() })
    .from(financialDocuments)
    .where(and(
      eq(financialDocuments.organizationId, organizationId),
      eq(financialDocuments.documentType, type),
    ));
  const prefix = type === 'Invoice' ? 'INV' : 'EST';
  return `${prefix}-${String(Number(row?.value || 0) + 1).padStart(3, '0')}`;
}

async function resolveWorkOrder(db, session, workOrderId) {
  if (!workOrderId) return null;
  const [row] = await db
    .select()
    .from(workOrders)
    .where(and(
      eq(workOrders.organizationId, session.user.organizationId),
      eq(workOrders.id, workOrderId),
    ))
    .limit(1);
  return row || null;
}

export async function POST(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.FINANCIALS_WRITE);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const type = String(body.type || 'Estimate').trim();
  if (!SUPPORTED_DOCUMENT_TYPES.has(type)) {
    return NextResponse.json(
      { error: 'Only estimates and invoices can be saved from this workflow.' },
      { status: 400 },
    );
  }

  const db = getDb();
  try {
    const contact = await resolveContactById({
      db,
      session,
      contactsTable: contacts,
      contactId: String(body.contactId || '').trim(),
    });
    if (!contact) throw createCrmError('Estimate contact is required.');

    const requestedBusinessUnitId = String(body.businessUnitId || contact.primaryBusinessUnitId || '').trim();
    const businessUnitId = await resolveBusinessUnitId({
      db,
      session,
      businessUnitsTable: businessUnits,
      requestedId: requestedBusinessUnitId,
    });
    if (contact.primaryBusinessUnitId && businessUnitId !== contact.primaryBusinessUnitId) {
      throw createCrmError('Document division must match the selected contact.');
    }
    const workOrder = await resolveWorkOrder(db, session, String(body.workOrderId || '').trim());
    if (workOrder && workOrder.contactId && workOrder.contactId !== contact.id) {
      throw createCrmError('Work order must belong to the selected contact.');
    }
    if (workOrder && workOrder.businessUnitId !== businessUnitId) {
      throw createCrmError('Work order division must match the document division.');
    }

    const subtotal = money(body.subtotal || body.amount);
    const tax = money(body.tax);
    const total = money(body.amount || subtotal + tax);
    const paidAmount = money(body.paidAmount);
    const documentNumber = String(body.number || '').trim() || await nextDocumentNumber(db, session.user.organizationId, type);
    const itemsJson = Array.isArray(body.items) ? body.items : [];

    const [document] = await db
      .insert(financialDocuments)
      .values({
        organizationId: session.user.organizationId,
        businessUnitId,
        contactId: contact.id,
        workOrderId: workOrder?.id || null,
        documentNumber,
        documentType: type,
        status: String(body.status || 'Pending').trim() || 'Pending',
        subtotal,
        tax,
        total,
        paidAmount,
        balanceDue: Math.max(total - paidAmount, 0),
        issueDate: dateOnly(body.date),
        dueDate: dateOnly(body.dueDate),
        itemsJson,
        notes: String(body.note || body.notes || '').trim() || null,
      })
      .returning();

    return NextResponse.json({ financial: documentToFinancialPayload(document, contact) }, { status: 201 });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
