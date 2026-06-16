import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import { businessUnits, contacts, estimates, financialDocuments, leads, workOrders } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import {
  canAccessBusinessUnit,
  resolveBusinessUnitId,
  resolveContactById,
} from '@/lib/crm/access.js';
import { createCrmError, crmErrorResponse } from '@/lib/crm/errors.js';
import { isUuid } from '@/lib/crm/validation.js';
import { createPaymentWithActivity, parsePaymentAmount, paymentWorkflowBlocker } from '@/lib/crm/payments.js';

async function latestLeadForContact(db, organizationId, contactId) {
  if (!contactId) return null;
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.organizationId, organizationId), eq(leads.contactId, contactId)))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  return lead || null;
}

async function resolveBusinessUnit(db, session, businessUnitId) {
  const resolvedId = await resolveBusinessUnitId({
    db,
    session,
    businessUnitsTable: businessUnits,
    requestedId: businessUnitId,
  });
  const [businessUnit] = await db
    .select()
    .from(businessUnits)
    .where(and(eq(businessUnits.organizationId, session.user.organizationId), eq(businessUnits.id, resolvedId)))
    .limit(1);
  return businessUnit || null;
}

async function latestInvoiceForWorkOrder(db, organizationId, workOrderId) {
  if (!workOrderId) return null;
  const [invoice] = await db
    .select()
    .from(financialDocuments)
    .where(and(
      eq(financialDocuments.organizationId, organizationId),
      eq(financialDocuments.workOrderId, workOrderId),
      eq(financialDocuments.documentType, 'Invoice'),
    ))
    .orderBy(desc(financialDocuments.createdAt))
    .limit(1);
  return invoice || null;
}

async function resolvePaymentContext(db, session, body) {
  const workOrderId = String(body.workOrderId || '').trim();
  const estimateId = String(body.estimateId || '').trim();
  const requestedContactId = String(body.contactId || '').trim();
  const requestedBusinessUnitId = String(body.businessUnitId || '').trim();

  if (workOrderId && !isUuid(workOrderId)) throw createCrmError('A valid work order id is required.');
  if (estimateId && !isUuid(estimateId)) throw createCrmError('A valid estimate id is required.');

  let workOrder = null;
  if (workOrderId) {
    [workOrder] = await db
      .select()
      .from(workOrders)
      .where(and(eq(workOrders.organizationId, session.user.organizationId), eq(workOrders.id, workOrderId)))
      .limit(1);
    if (!workOrder) throw createCrmError('Work order not found.', 404);
    if (!canAccessBusinessUnit(session, workOrder.businessUnitId)) {
      throw createCrmError('Insufficient business-unit access.', 403);
    }
  }

  let estimate = null;
  const targetEstimateId = estimateId || workOrder?.estimateId || '';
  if (targetEstimateId) {
    [estimate] = await db
      .select()
      .from(estimates)
      .where(and(eq(estimates.organizationId, session.user.organizationId), eq(estimates.id, targetEstimateId)))
      .limit(1);
    if (!estimate && estimateId) throw createCrmError('Estimate not found.', 404);
    if (estimate && !canAccessBusinessUnit(session, estimate.businessUnitId)) {
      throw createCrmError('Insufficient business-unit access.', 403);
    }
  }

  const contactId = workOrder?.contactId || estimate?.contactId || requestedContactId;
  const contact = await resolveContactById({
    db,
    session,
    contactsTable: contacts,
    contactId,
  });

  const businessUnitId = workOrder?.businessUnitId
    || estimate?.businessUnitId
    || contact?.primaryBusinessUnitId
    || requestedBusinessUnitId;
  const businessUnit = await resolveBusinessUnit(db, session, businessUnitId);
  if (!businessUnit) throw createCrmError('No business units available for this payment.');

  if (contact?.primaryBusinessUnitId && contact.primaryBusinessUnitId !== businessUnit.id) {
    throw createCrmError('Payment division must match the selected contact.');
  }

  const lead = await latestLeadForContact(db, session.user.organizationId, contact?.id || null);
  const invoice = await latestInvoiceForWorkOrder(db, session.user.organizationId, workOrder?.id || null);
  const blocker = paymentWorkflowBlocker({
    businessUnit,
    lead,
    contact,
    hasInvoice: Boolean(invoice),
  });
  if (blocker) throw createCrmError(blocker, 400);
  const targetTotal = invoice?.total ?? workOrder?.estimatedCost ?? estimate?.balanceDue ?? estimate?.total ?? null;

  return {
    contact,
    businessUnit,
    workOrder,
    estimate,
    invoice,
    lead,
    targetTotal,
  };
}

export async function POST(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.FINANCIALS_WRITE);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  if (parsePaymentAmount(body.amount) === null) {
    return NextResponse.json({ error: 'Payment amount must be greater than zero.' }, { status: 400 });
  }

  const db = getDb();
  try {
    const context = await resolvePaymentContext(db, session, body);
    const { receipt, payment, activityEvent } = await createPaymentWithActivity({
      db,
      organizationId: session.user.organizationId,
      actorUserId: session.user.id,
      paymentValues: {
        businessUnitId: context.businessUnit.id,
        contactId: context.contact?.id || null,
        leadId: context.lead?.id || null,
        estimateId: context.estimate?.id || null,
        workOrderId: context.workOrder?.id || null,
        amount: body.amount,
        paymentMethod: body.paymentMethod,
        checkNumber: body.checkNumber,
        paidAt: body.paidAt,
      },
      contact: context.contact,
      businessUnit: context.businessUnit,
      workOrder: context.workOrder,
      estimate: context.estimate,
      targetTotal: context.targetTotal,
      note: body.note,
    });

    return NextResponse.json({ receipt, paymentId: payment.id, activityEventId: activityEvent.id }, { status: 201 });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
