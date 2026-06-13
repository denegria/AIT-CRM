export const AIT_SIGNS_FORM_COMPANY = {
  name: 'AIT SIGNS PRINTING',
  tagline: 'WEB PAGE & DIGITAL ADS',
  address: '35 Watchung Ave, Plainfield, NJ 07060',
  phone: '908-561-0004',
  email: 'info@aitsigns.com',
};

export const AIT_SIGNS_FORM_TAX_RATE = 0.06625;
export const AIT_SIGNS_FORM_MISSING_FIELD = 'Not captured';
export const AIT_SIGNS_FORM_SERVICES = [
  { label: 'Vehicle Graphics', detail: 'Lettering | Wraps | Decals' },
  { label: 'Signs', detail: 'Storefront | Banners | Yard Signs' },
  { label: 'Printing', detail: 'Business Cards | Flyers | Forms' },
  { label: 'Apparel', detail: 'T-Shirts | Embroidery | Uniforms' },
  { label: 'Digital', detail: 'Web Page | Ads | Motion Graphics' },
];
export const AIT_SIGNS_FORM_FOOTER_NOTE = 'Printing guarantee applies to approved artwork and final proof. Web page and motion graphics timelines depend on supplied content.';
export const AIT_SIGNS_DOCUMENT_TYPES = {
  estimate: {
    title: 'Estimate',
    numberLabel: 'Estimate #',
    dateLabel: 'Estimate Date',
    termsTitle: 'Estimate terms',
    terms: 'This estimate is valid for 30 days unless otherwise noted. Production begins after customer approval, required deposit, and final artwork/proof confirmation.',
  },
  invoice: {
    title: 'Invoice',
    numberLabel: 'Invoice #',
    dateLabel: 'Invoice Date',
    termsTitle: 'Payment terms',
    terms: 'Invoice balance is due by the listed due date. Deposits and partial payments are applied to the balance due.',
  },
  receipt: {
    title: 'Receipt',
    numberLabel: 'Receipt #',
    dateLabel: 'Payment Date',
    termsTitle: 'Payment confirmation',
    terms: 'This receipt confirms payment received. Keep this copy for your records and contact AIT Signs with any payment questions.',
  },
  workOrder: {
    title: 'Work Order',
    numberLabel: 'Work Order #',
    dateLabel: 'Created Date',
    termsTitle: 'Production notes',
    terms: 'This work order is for internal production and customer scope confirmation. Final production depends on approved artwork, measurements, materials, and scheduling.',
  },
};

function cleanText(value) {
  return String(value || '').trim();
}

function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return '';
}

function moneyNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = typeof value === 'string' ? value.replace(/[$,]/g, '').trim() : value;
  if (normalized === '') return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function firstMoney(...values) {
  for (const value of values) {
    const number = moneyNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizedDocumentType(value) {
  const text = cleanText(value).toLowerCase();
  if (text.includes('receipt') || text.includes('payment')) return 'receipt';
  if (text.includes('invoice')) return 'invoice';
  if (text.includes('work')) return 'workOrder';
  if (text.includes('estimate') || text.includes('proposal')) return 'estimate';
  return 'workOrder';
}

export function formatAitSignsMoney(value, placeholder = AIT_SIGNS_FORM_MISSING_FIELD) {
  const number = moneyNumber(value);
  if (number === null) return placeholder;
  return `$${number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatAitSignsDate(value, placeholder = AIT_SIGNS_FORM_MISSING_FIELD) {
  const text = cleanText(value);
  if (!text) return placeholder;

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${Number(isoMatch[2])}/${Number(isoMatch[3])}/${isoMatch[1]}`;
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function compactArray(values = []) {
  return values.filter((value) => value !== undefined && value !== null && value !== '');
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ''),
  );
}

function descriptionBeforeImportTrail(value) {
  const text = cleanText(value);
  if (!text) return '';
  const match = text.match(/\s+[•·-]\s*Import:/i);
  if (!match) return text;
  return text.slice(0, match.index).trim();
}

function splitWorkbookCells(value) {
  return String(value || '')
    .split('|')
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function hasWorkbookCells(value) {
  return splitWorkbookCells(value).length >= 4;
}

function stripSourceRowSuffix(value) {
  return cleanText(value)
    .replace(/\s+·\s*\d{2,6}(?:\.0)?\s*$/i, '')
    .trim();
}

function polishWorkDescription(value) {
  return stripSourceRowSuffix(value)
    .replace(/\bletterning\b/gi, 'LETTERING')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitDescriptionAndNote(value) {
  const text = polishWorkDescription(value);
  const pieces = text.split(/\s+-\s+/).map(cleanText).filter(Boolean);
  if (pieces.length <= 1) return { description: text, detail: '' };
  return {
    description: pieces[0],
    detail: pieces.slice(1).join(' - '),
  };
}

function quantityFromDescription(value) {
  const match = cleanText(value).match(/^\((\d+)\)\s*/);
  if (!match) return 1;
  const qty = Number(match[1]);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

function stripQuantityPrefix(value) {
  return cleanText(value).replace(/^\(\d+\)\s*/, '').trim();
}

function isWorkbookNoiseCell(value) {
  const text = cleanText(value);
  if (!text) return true;
  if (text === '$') return true;
  if (/^(si|no|yes|n\/a)$/i.test(text)) return true;
  if (/^\d{7,15}$/.test(text.replace(/[^\d]/g, ''))) return true;
  if (/^4[3-6]\d{3}(?:\.0)?$/.test(text)) return true;
  if (/^[\d$,.]+$/.test(text)) return true;
  return false;
}

function workbookDescriptionCell(cells = []) {
  const quantityCell = cells.find((cell) => /^\(\d+\)\s*\S/.test(cell));
  if (quantityCell) return quantityCell;
  return cells
    .filter((cell) => /[a-z]/i.test(cell) && !isWorkbookNoiseCell(cell))
    .sort((left, right) => right.length - left.length)[0] || '';
}

function workbookDetailCell(cells = [], descriptionCell = '') {
  const descriptionIndex = cells.indexOf(descriptionCell);
  const candidates = cells
    .slice(descriptionIndex >= 0 ? descriptionIndex + 1 : 0)
    .filter((cell) => /[a-z]/i.test(cell) && !isWorkbookNoiseCell(cell) && cell !== descriptionCell)
    .filter((cell) => !/^[A-Z]{2,}(?:\s+[A-Z]{2,}){0,2}$/.test(cell.trim()));
  return candidates[0] || '';
}

function workbookAmountHints(cells = []) {
  const markerIndex = cells.findIndex((cell) => cleanText(cell) === '$');
  const amountCells = (markerIndex >= 0 ? cells.slice(markerIndex + 1) : cells)
    .map(moneyNumber)
    .filter((amount) => amount !== null);
  if (markerIndex < 0 || amountCells.length < 2) return {};
  return compactObject({
    subtotal: amountCells[0],
    tax: amountCells[1],
    total: amountCells[2],
  });
}

function importedLineItemBreakdown(fallbackDescription, fallbackAmount) {
  const descriptionText = descriptionBeforeImportTrail(fallbackDescription);
  if (!descriptionText || (!hasWorkbookCells(descriptionText) && !descriptionText.includes(' · '))) return null;

  const sections = descriptionText
    .split(/\s+·\s+/)
    .map(cleanText)
    .filter(Boolean);
  const rawSection = sections.find(hasWorkbookCells) || '';
  const cells = splitWorkbookCells(rawSection || descriptionText);
  const cleanSection = sections.find((section) => !hasWorkbookCells(section) && !/^import:/i.test(section)) || '';
  const rawDescriptionCell = cleanSection || workbookDescriptionCell(cells);
  if (!rawDescriptionCell) return null;

  const split = splitDescriptionAndNote(rawDescriptionCell);
  const detail = split.detail || workbookDetailCell(cells, rawDescriptionCell);
  const qty = quantityFromDescription(split.description);
  const description = stripQuantityPrefix(split.description) || AIT_SIGNS_FORM_MISSING_FIELD;
  const amountHints = workbookAmountHints(cells);
  const lineAmount = firstMoney(amountHints.subtotal, fallbackAmount);
  const rate = lineAmount === null ? null : roundCurrency(lineAmount / qty);

  return {
    amountHints,
    items: [{
      description,
      detail: detail ? polishWorkDescription(detail) : '',
      qty,
      rate,
      amount: lineAmount,
    }],
  };
}

function normalizeLineItems(record, fallbackDescription, fallbackAmount) {
  const sourceItems = Array.isArray(record?.items) ? record.items : [];
  const items = sourceItems
    .map((item) => {
      const qty = firstMoney(item.qty, item.quantity) ?? 1;
      const rate = firstMoney(item.rate, item.unitPrice, item.price);
      const amount = firstMoney(item.amount, rate === null ? null : qty * rate);
      return {
        description: firstText(item.desc, item.description, item.title, fallbackDescription),
        detail: firstText(item.detail, item.note, item.notes),
        qty,
        rate,
        amount,
      };
    })
    .filter((item) => item.description || item.amount !== null);

  if (items.length > 0) return { items, amountHints: {} };

  const importedBreakdown = importedLineItemBreakdown(fallbackDescription, fallbackAmount);
  if (importedBreakdown?.items?.length) return importedBreakdown;

  return {
    amountHints: {},
    items: [{
      description: fallbackDescription || AIT_SIGNS_FORM_MISSING_FIELD,
      detail: '',
      qty: 1,
      rate: fallbackAmount,
      amount: fallbackAmount,
    }],
  };
}

function sumLineAmounts(items) {
  const amounts = items.map((item) => moneyNumber(item.amount)).filter((amount) => amount !== null);
  if (!amounts.length) return null;
  return roundCurrency(amounts.reduce((sum, amount) => sum + amount, 0));
}

function resolveAmounts(record, items, amountHints = {}, documentType = '') {
  const itemSubtotal = sumLineAmounts(items);
  const subtotal = firstMoney(
    record?.subtotal,
    record?.subTotal,
    amountHints.subtotal,
    itemSubtotal,
    record?.estimatedCost,
    record?.amount,
    record?.total,
  );
  const explicitTax = firstMoney(record?.tax, record?.salesTax, amountHints.tax);
  const taxEstimated = documentType !== 'receipt' && explicitTax === null && subtotal !== null;
  const tax = explicitTax ?? (
    documentType === 'receipt'
      ? 0
      : (subtotal === null ? null : roundCurrency(subtotal * AIT_SIGNS_FORM_TAX_RATE))
  );
  const total = firstMoney(
    record?.total,
    record?.amountWithTax,
    amountHints.total,
    subtotal === null || tax === null ? null : subtotal + tax,
    record?.amount,
    record?.estimatedCost,
  );
  const paidAmount = firstMoney(
    record?.paidAmount,
    record?.amountPaid,
    record?.paymentAmount,
    record?.depositAmount,
    record?.deposit,
    documentType === 'receipt' ? total : null,
  );
  const balanceDue = firstMoney(
    record?.balanceDue,
    record?.balance,
    total === null ? null : roundCurrency(total - (paidAmount || 0)),
  );

  return {
    subtotal,
    tax,
    total,
    paidAmount,
    balanceDue,
    taxEstimated,
    subtotalDisplay: formatAitSignsMoney(subtotal),
    taxDisplay: formatAitSignsMoney(tax),
    totalDisplay: formatAitSignsMoney(total),
    paidAmountDisplay: formatAitSignsMoney(paidAmount, '$0.00'),
    balanceDueDisplay: formatAitSignsMoney(balanceDue, AIT_SIGNS_FORM_MISSING_FIELD),
    taxRateLabel: `${(AIT_SIGNS_FORM_TAX_RATE * 100).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}%`,
  };
}

export function buildAitSignsDocument(record = {}, context = {}) {
  const documentType = normalizedDocumentType(context.documentType || record.documentType || record.type || record.kind);
  const typeConfig = AIT_SIGNS_DOCUMENT_TYPES[documentType];
  const customerName = firstText(
    record.customer,
    record.customerName,
    record.client,
    context.contact?.companyName,
    context.contact?.company,
    context.contact?.businessName,
    context.contact?.name,
    AIT_SIGNS_FORM_MISSING_FIELD,
  );
  const workContact = firstText(
    record.workContact,
    record.customerContact,
    record.contactPerson,
    record.contactName,
    record.attentionTo,
    record.attn,
    context.contact?.contactName,
    context.contact?.name,
    AIT_SIGNS_FORM_MISSING_FIELD,
  );
  const documentNumber = firstText(
    documentType === 'receipt' ? record.receiptNumber : '',
    documentType === 'invoice' ? record.invoiceNumber : '',
    documentType === 'estimate' ? record.estimateNumber : '',
    documentType === 'workOrder' ? record.workOrderNumber : '',
    record.estimateNumber,
    record.number,
    record.workOrderNumber,
    record.invoiceNumber,
    AIT_SIGNS_FORM_MISSING_FIELD,
  );
  const documentDate = firstText(
    record.date,
    record.estimateDate,
    record.invoiceDate,
    record.paidAt,
    record.createdAt,
    record.dueDate,
    record.deliveryDate,
  );
  const description = firstText(
    record.description,
    record.scope,
    record.title,
    Array.isArray(record.items) ? record.items[0]?.desc || record.items[0]?.description : '',
    AIT_SIGNS_FORM_MISSING_FIELD,
  );
  const fallbackAmount = firstMoney(record.subtotal, record.estimatedCost, record.amount, record.total);
  const lineItems = normalizeLineItems(record, description, fallbackAmount);
  const items = lineItems.items;
  const amounts = resolveAmounts(record, items, lineItems.amountHints, documentType);
  const assignedName = firstText(context.assignedEmployee?.name, record.assignedToName, record.assignedName);

  return {
    company: AIT_SIGNS_FORM_COMPANY,
    services: AIT_SIGNS_FORM_SERVICES,
    footerNote: AIT_SIGNS_FORM_FOOTER_NOTE,
    documentType,
    title: typeConfig.title,
    numberLabel: typeConfig.numberLabel,
    dateLabel: typeConfig.dateLabel,
    termsTitle: typeConfig.termsTitle,
    terms: firstText(record.terms, record.termsNote, typeConfig.terms),
    number: documentNumber,
    date: documentDate,
    dateDisplay: formatAitSignsDate(documentDate),
    customerName,
    workContact,
    phone: firstText(record.phone, context.contact?.phone, AIT_SIGNS_FORM_MISSING_FIELD),
    email: firstText(record.email, context.contact?.email, AIT_SIGNS_FORM_MISSING_FIELD),
    address: firstText(record.address, context.contact?.address, AIT_SIGNS_FORM_MISSING_FIELD),
    status: firstText(record.status, AIT_SIGNS_FORM_MISSING_FIELD),
    dueDate: firstText(record.dueDate, record.deliveryDate),
    dueDateDisplay: formatAitSignsDate(firstText(record.dueDate, record.deliveryDate), AIT_SIGNS_FORM_MISSING_FIELD),
    paymentMethod: firstText(record.paymentMethod, record.method, record.tender, AIT_SIGNS_FORM_MISSING_FIELD),
    division: firstText(context.businessUnit?.name, record.divisionLabel, record.businessUnitName, AIT_SIGNS_FORM_MISSING_FIELD),
    assignedName: assignedName || AIT_SIGNS_FORM_MISSING_FIELD,
    description,
    items,
    amounts,
    billingInfo: {
      name: customerName,
      contactName: workContact,
      address: firstText(record.billingAddress, record.address, context.contact?.address, AIT_SIGNS_FORM_MISSING_FIELD),
      phone: firstText(record.phone, context.contact?.phone, AIT_SIGNS_FORM_MISSING_FIELD),
    },
    workAddress: {
      name: firstText(record.workAddressName, record.jobName, customerName),
      contactName: firstText(record.workContact, record.siteContact, workContact),
      address: firstText(record.workAddress, record.jobAddress, record.address, context.contact?.address, AIT_SIGNS_FORM_MISSING_FIELD),
      phone: firstText(record.workPhone, record.phone, context.contact?.phone, AIT_SIGNS_FORM_MISSING_FIELD),
    },
  };
}
