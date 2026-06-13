export const AIT_USA_RECEIPT_COMPANY = {
  name: 'AIT USA Institute',
  tagline: 'Student payment confirmation',
};

function clean(value) {
  return String(value || '').trim();
}

function firstText(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return '';
}

function numberValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(/[$,]/g, ''));
  return Number.isFinite(number) ? number : null;
}

export function formatAitUsaReceiptMoney(value, placeholder = 'Not captured') {
  const number = numberValue(value);
  if (number === null) return placeholder;
  return `$${number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatAitUsaReceiptDate(value, placeholder = 'Not captured') {
  const text = clean(value);
  if (!text) return placeholder;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${Number(iso[2])}/${Number(iso[3])}/${iso[1]}`;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

export function buildAitUsaReceiptDocument(record = {}, context = {}) {
  const companyName = firstText(context.businessUnit?.name, record.businessUnitName, AIT_USA_RECEIPT_COMPANY.name);
  const receiptNumber = firstText(record.receiptNumber, record.number, `REC-${String(record.id || '').slice(0, 8)}`, 'Receipt');
  const date = firstText(record.date, record.paidAt, record.createdAt);
  const amount = numberValue(record.paidAmount ?? record.amount);
  const balanceDue = numberValue(record.balanceDue ?? record.balanceAfter);
  const studentName = firstText(
    record.studentName,
    record.client,
    context.contact?.name,
    'Student / Client',
  );
  const program = firstText(record.program, record.programInterest, context.contact?.programInterest);
  const method = firstText(record.paymentMethod, record.method, 'Not captured');
  const note = firstText(record.note, record.memo, record.description);

  return {
    company: {
      ...AIT_USA_RECEIPT_COMPANY,
      name: companyName,
    },
    title: 'Receipt / Recibo',
    receiptNumber,
    date,
    dateDisplay: formatAitUsaReceiptDate(date),
    studentName,
    program,
    method,
    checkNumber: firstText(record.checkNumber, record.referenceNumber),
    amount,
    amountDisplay: formatAitUsaReceiptMoney(amount),
    balanceDue,
    balanceDueDisplay: balanceDue === null ? '' : formatAitUsaReceiptMoney(balanceDue),
    receivedBy: firstText(record.receivedBy, context.currentUser?.name),
    note,
    bilingualNote: [
      'This receipt confirms payment received for AIT USA Institute services.',
      'Este recibo confirma el pago recibido por servicios de AIT USA Institute.',
    ],
  };
}
