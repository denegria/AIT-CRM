export const FINANCIAL_DOCUMENT_FIELD_MAP = {
  estimate: {
    required: ['documentNumber', 'clientName', 'issueDate', 'lineItems', 'subtotal', 'tax', 'total'],
    optional: ['validUntil', 'approvalTerms', 'workAddress', 'depositRequired', 'assignedOwner'],
  },
  invoice: {
    required: ['documentNumber', 'clientName', 'issueDate', 'dueDate', 'lineItems', 'subtotal', 'tax', 'total', 'balanceDue'],
    optional: ['paidAmount', 'paymentMethod', 'workOrderNumber', 'workAddress', 'assignedOwner'],
  },
  receipt: {
    required: ['documentNumber', 'clientName', 'paymentDate', 'amountPaid', 'paymentMethod'],
    optional: ['balanceDue', 'checkNumber', 'workOrderNumber', 'estimateNumber', 'receivedBy', 'memo'],
  },
  workOrder: {
    required: ['workOrderNumber', 'clientName', 'createdDate', 'scope', 'lineItems', 'productionTerms'],
    optional: ['dueDate', 'assignedOwner', 'paidAmount', 'balanceDue', 'workAddress', 'customerContact'],
  },
  aitUsaReceipt: {
    required: ['receiptNumber', 'studentName', 'paymentDate', 'amountPaid', 'paymentMethod'],
    optional: ['program', 'balanceDue', 'checkNumber', 'receivedBy', 'bilingualNote', 'memo'],
  },
};

function normalizeType(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text.includes('ait usa') || text.includes('student')) return 'aitUsaReceipt';
  if (text.includes('work')) return 'workOrder';
  if (text.includes('receipt') || text.includes('payment')) return 'receipt';
  if (text.includes('invoice')) return 'invoice';
  return 'estimate';
}

export function getFinancialDocumentFieldMap(documentType, { businessUnitName = '' } = {}) {
  const type = /receipt|payment/i.test(String(documentType || '')) && /ait usa|institute/i.test(businessUnitName)
    ? 'aitUsaReceipt'
    : normalizeType(documentType);
  return {
    type,
    ...FINANCIAL_DOCUMENT_FIELD_MAP[type],
  };
}
