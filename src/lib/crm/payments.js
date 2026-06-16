import { and, desc, eq, or } from 'drizzle-orm';
import { activityEvents, paymentSnapshots } from '../../db/schema.js';
import { normalizeLifecycleStatus, WORKFLOW_KEYS, workflowKeyForBusinessUnit } from './lifecycle.js';

export const PAYMENT_RECEIVED_EVENT_TYPE = 'financial.payment_received';

function clean(value) {
  return String(value || '').trim();
}

export function parsePaymentAmount(value) {
  const normalized = typeof value === 'string' ? value.replace(/[$,]/g, '').trim() : value;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function normalizePaymentMethod(value) {
  const text = clean(value);
  if (!text) return 'Unspecified';
  const lower = text.toLowerCase();
  if (lower.includes('cash')) return 'Cash';
  if (lower.includes('check') || lower.includes('cheque')) return 'Check';
  if (lower.includes('card') || lower.includes('credit') || lower.includes('debit')) return 'Card';
  if (lower.includes('zelle')) return 'Zelle';
  if (lower.includes('cashapp') || lower.includes('cash app')) return 'Cash App';
  if (lower.includes('venmo')) return 'Venmo';
  if (lower.includes('paypal')) return 'PayPal';
  if (lower.includes('transfer') || lower.includes('ach') || lower.includes('wire')) return 'Bank Transfer';
  return text;
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(String(value).replace(/[$,]/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

function money(value) {
  const amount = numeric(value);
  if (amount === null) return '';
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function normalizePaymentDate(value, fallback = new Date()) {
  if (!value) return fallback.toISOString().slice(0, 10);
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback.toISOString().slice(0, 10);
}

export function paymentDateToOccurredAt(value) {
  const date = normalizePaymentDate(value);
  return new Date(`${date}T12:00:00.000Z`);
}

export function calculateBalanceAfter({ targetTotal = null, priorPayments = [], amount = 0 } = {}) {
  const total = numeric(targetTotal);
  if (total === null) return null;
  const priorPaid = priorPayments.reduce((sum, row) => sum + (numeric(row.amount) || 0), 0);
  return Math.round((total - priorPaid - amount + Number.EPSILON) * 100) / 100;
}

export function buildPaymentMessage({
  amount,
  paymentMethod,
  balanceAfter = null,
  targetLabel = '',
  note = '',
} = {}) {
  return [
    `Payment received ${money(amount) || ''}`.trim(),
    normalizePaymentMethod(paymentMethod),
    targetLabel,
    balanceAfter === null ? '' : `Balance ${money(balanceAfter)}`,
    clean(note),
  ].filter(Boolean).join(' · ');
}

export function isPaymentBusinessUnit(businessUnit = null, workflowKey = '') {
  return (workflowKey || workflowKeyForBusinessUnit(businessUnit)) === WORKFLOW_KEYS.AIT_SIGNS;
}

export function isStudentReceiptBusinessUnit(businessUnit = null, workflowKey = '') {
  return (workflowKey || workflowKeyForBusinessUnit(businessUnit)) === WORKFLOW_KEYS.AIT_USA;
}

export function isEnrolledStudentStatus(value) {
  return normalizeLifecycleStatus(value, { workflowKey: WORKFLOW_KEYS.AIT_USA }) === 'Enrolled';
}

export function paymentWorkflowBlocker({
  businessUnit = null,
  lead = null,
  contact = null,
  hasInvoice = false,
} = {}) {
  const workflowKey = workflowKeyForBusinessUnit(businessUnit);
  if (isStudentReceiptBusinessUnit(businessUnit, workflowKey)) {
    const status = lead?.currentStage || lead?.status || contact?.currentStage || contact?.status || '';
    if (!isEnrolledStudentStatus(status)) {
      return 'Student must be Enrolled before generating a receipt. Change the status to Enrolled first.';
    }
  }
  if (isPaymentBusinessUnit(businessUnit, workflowKey) && !hasInvoice) {
    return 'Generate an invoice from a work order before recording a payment.';
  }
  return '';
}

export function toPaymentReceiptPayload(payment, {
  contact = null,
  businessUnit = null,
  workOrder = null,
  estimate = null,
  fallbackNumber = '',
} = {}) {
  const amount = numeric(payment.amount) || 0;
  const paymentNumber = payment.paymentNumber ? String(payment.paymentNumber).padStart(3, '0') : '';
  const number = fallbackNumber || (paymentNumber ? `REC-${paymentNumber}` : `REC-${String(payment.id || '').slice(0, 8)}`);
  const paidAt = normalizePaymentDate(payment.paidAt || payment.createdAt);
  return {
    id: payment.id,
    number,
    type: 'Receipt',
    client: contact?.name || workOrder?.client || estimate?.client || '',
    contactId: contact?.id || workOrder?.contactId || estimate?.contactId || '',
    businessUnitId: payment.businessUnitId || businessUnit?.id || workOrder?.businessUnitId || estimate?.businessUnitId || '',
    estimateId: payment.estimateId || estimate?.id || '',
    workOrderId: payment.workOrderId || workOrder?.id || '',
    amount,
    paidAmount: amount,
    paymentMethod: payment.paymentMethod || 'Unspecified',
    checkNumber: payment.checkNumber || '',
    balanceDue: numeric(payment.balanceAfter),
    date: paidAt,
    status: 'Paid',
    items: [{
      desc: workOrder?.title ? `Payment for ${workOrder.title}` : 'Payment received',
      qty: 1,
      rate: amount,
      amount,
    }],
  };
}

async function priorPaymentsForTarget(tx, organizationId, { workOrderId = null, estimateId = null } = {}) {
  const linkClauses = [
    workOrderId ? eq(paymentSnapshots.workOrderId, workOrderId) : null,
    estimateId ? eq(paymentSnapshots.estimateId, estimateId) : null,
  ].filter(Boolean);
  if (!linkClauses.length) return [];
  return tx
    .select()
    .from(paymentSnapshots)
    .where(and(eq(paymentSnapshots.organizationId, organizationId), or(...linkClauses)))
    .orderBy(desc(paymentSnapshots.paidAt), desc(paymentSnapshots.createdAt));
}

export async function createPaymentWithActivity({
  db,
  organizationId,
  actorUserId,
  paymentValues,
  contact = null,
  businessUnit = null,
  workOrder = null,
  estimate = null,
  targetTotal = null,
  note = '',
}) {
  const amount = parsePaymentAmount(paymentValues.amount);
  if (amount === null) {
    throw Object.assign(new Error('Payment amount must be greater than zero.'), { status: 400 });
  }

  const paymentMethod = normalizePaymentMethod(paymentValues.paymentMethod);
  const paidAt = normalizePaymentDate(paymentValues.paidAt);
  const checkNumber = clean(paymentValues.checkNumber) || null;

  return db.transaction(async (tx) => {
    const priorPayments = await priorPaymentsForTarget(tx, organizationId, {
      workOrderId: paymentValues.workOrderId || null,
      estimateId: paymentValues.estimateId || null,
    });
    const paymentNumber = priorPayments.reduce((max, row) => Math.max(max, Number(row.paymentNumber || 0)), 0) + 1;
    const balanceAfter = calculateBalanceAfter({ targetTotal, priorPayments, amount });

    const [payment] = await tx
      .insert(paymentSnapshots)
      .values({
        organizationId,
        businessUnitId: paymentValues.businessUnitId,
        estimateId: paymentValues.estimateId || null,
        workOrderId: paymentValues.workOrderId || null,
        paymentNumber,
        paymentMethod,
        checkNumber,
        amount: amount.toFixed(2),
        paidAt,
        balanceAfter: balanceAfter === null ? null : balanceAfter.toFixed(2),
      })
      .returning();

    const targetLabel = workOrder?.workOrderNumber
      ? `Work Order ${workOrder.workOrderNumber}`
      : estimate?.estimateNumber
        ? `Estimate ${estimate.estimateNumber}`
        : '';

    const [activityEvent] = await tx
      .insert(activityEvents)
      .values({
        organizationId,
        businessUnitId: paymentValues.businessUnitId,
        contactId: paymentValues.contactId || null,
        leadId: paymentValues.leadId || null,
        estimateId: paymentValues.estimateId || null,
        workOrderId: paymentValues.workOrderId || null,
        eventType: PAYMENT_RECEIVED_EVENT_TYPE,
        message: buildPaymentMessage({ amount, paymentMethod, balanceAfter, targetLabel, note }),
        metadataJson: {
          paymentSnapshotId: payment.id,
          amount,
          paymentMethod,
          checkNumber,
          balanceAfter,
          note: clean(note),
        },
        actorUserId,
        occurredAt: paymentDateToOccurredAt(paidAt),
      })
      .returning();

    return {
      payment,
      activityEvent,
      receipt: toPaymentReceiptPayload(payment, { contact, businessUnit, workOrder, estimate }),
    };
  });
}
