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

function normalizeLineItems(record, fallbackDescription, fallbackAmount) {
  const sourceItems = Array.isArray(record?.items) ? record.items : [];
  const items = sourceItems
    .map((item) => {
      const qty = firstMoney(item.qty, item.quantity) ?? 1;
      const rate = firstMoney(item.rate, item.unitPrice, item.price);
      const amount = firstMoney(item.amount, rate === null ? null : qty * rate);
      return {
        description: firstText(item.desc, item.description, item.title, fallbackDescription),
        qty,
        rate,
        amount,
      };
    })
    .filter((item) => item.description || item.amount !== null);

  if (items.length > 0) return items;

  return [{
    description: fallbackDescription || AIT_SIGNS_FORM_MISSING_FIELD,
    qty: 1,
    rate: fallbackAmount,
    amount: fallbackAmount,
  }];
}

function sumLineAmounts(items) {
  const amounts = items.map((item) => moneyNumber(item.amount)).filter((amount) => amount !== null);
  if (!amounts.length) return null;
  return roundCurrency(amounts.reduce((sum, amount) => sum + amount, 0));
}

function resolveAmounts(record, items) {
  const itemSubtotal = sumLineAmounts(items);
  const subtotal = firstMoney(
    record?.subtotal,
    record?.subTotal,
    itemSubtotal,
    record?.estimatedCost,
    record?.amount,
    record?.total,
  );
  const explicitTax = firstMoney(record?.tax, record?.salesTax);
  const taxEstimated = explicitTax === null && subtotal !== null;
  const tax = explicitTax ?? (subtotal === null ? null : roundCurrency(subtotal * AIT_SIGNS_FORM_TAX_RATE));
  const total = firstMoney(
    record?.total,
    record?.amountWithTax,
    subtotal === null || tax === null ? null : subtotal + tax,
    record?.amount,
    record?.estimatedCost,
  );

  return {
    subtotal,
    tax,
    total,
    taxEstimated,
    subtotalDisplay: formatAitSignsMoney(subtotal),
    taxDisplay: formatAitSignsMoney(tax),
    totalDisplay: formatAitSignsMoney(total),
    taxRateLabel: `${(AIT_SIGNS_FORM_TAX_RATE * 100).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}%`,
  };
}

export function buildAitSignsDocument(record = {}, context = {}) {
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
    record.estimateNumber,
    record.number,
    record.workOrderNumber,
    record.invoiceNumber,
    AIT_SIGNS_FORM_MISSING_FIELD,
  );
  const documentDate = firstText(record.date, record.estimateDate, record.createdAt, record.dueDate, record.deliveryDate);
  const description = firstText(
    record.description,
    record.scope,
    record.title,
    Array.isArray(record.items) ? record.items[0]?.desc || record.items[0]?.description : '',
    AIT_SIGNS_FORM_MISSING_FIELD,
  );
  const fallbackAmount = firstMoney(record.subtotal, record.estimatedCost, record.amount, record.total);
  const items = normalizeLineItems(record, description, fallbackAmount);
  const amounts = resolveAmounts(record, items);
  const assignedName = firstText(context.assignedEmployee?.name, record.assignedToName, record.assignedName);

  return {
    company: AIT_SIGNS_FORM_COMPANY,
    services: AIT_SIGNS_FORM_SERVICES,
    footerNote: AIT_SIGNS_FORM_FOOTER_NOTE,
    title: record.type === 'Estimate' ? 'Estimate' : 'Estimate / Work Order',
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
