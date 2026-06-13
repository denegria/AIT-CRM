import { jsPDF } from 'jspdf';
import { buildAitSignsDocument, formatAitSignsMoney } from '@/lib/ait-signs-document';
import { buildAitUsaReceiptDocument } from '@/lib/ait-usa-receipt-document';

const DOCUMENT_ACCENT = {
  estimate: [185, 28, 28],
  invoice: [30, 64, 175],
  receipt: [22, 101, 52],
  workOrder: [17, 24, 39],
};

function safeFilePart(value) {
  return String(value || 'ait-document')
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'ait-document';
}

function setRgb(doc, method, color) {
  doc[method](color[0], color[1], color[2]);
}

function drawLogo(doc, x, y) {
  doc.setDrawColor(17, 24, 39);
  doc.setLineWidth(0.8);
  doc.rect(x, y, 17, 13);
  doc.setFillColor(185, 28, 28);
  doc.rect(x + 3, y + 3, 3.4, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(185, 28, 28);
  doc.text('A', x + 3.1, y + 9.5);
  doc.setTextColor(17, 24, 39);
  doc.text('IT', x + 8, y + 9.5);
}

function drawHeader(doc, form, accent) {
  drawLogo(doc, 18, 17);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(17, 24, 39);
  doc.text(form.company.name, 39, 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(86, 100, 118);
  doc.text(form.company.tagline, 39, 28);
  doc.text(`${form.company.address} | ${form.company.phone} | ${form.company.email}`, 39, 33);

  setRgb(doc, 'setTextColor', accent);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(23);
  doc.text(form.title.toUpperCase(), 192, 23, { align: 'right' });
  doc.setFontSize(8);
  doc.setTextColor(86, 100, 118);
  doc.text(`${form.numberLabel}:`, 145, 32);
  doc.text(`${form.dateLabel}:`, 145, 38);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(17, 24, 39);
  doc.text(form.number, 192, 32, { align: 'right' });
  doc.text(form.dateDisplay, 192, 38, { align: 'right' });

  setRgb(doc, 'setDrawColor', accent);
  doc.setLineWidth(0.9);
  doc.line(18, 45, 192, 45);
}

function drawServiceStrip(doc, form, y, accent) {
  const itemWidth = 174 / form.services.length;
  for (const [index, service] of form.services.entries()) {
    const x = 18 + itemWidth * index;
    setRgb(doc, 'setFillColor', accent);
    doc.rect(x, y, itemWidth, 15, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text(service.label, x + itemWidth / 2, y + 5.5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.3);
    doc.text(doc.splitTextToSize(service.detail, itemWidth - 4), x + itemWidth / 2, y + 10.5, { align: 'center' });
  }
}

function drawInfoBox(doc, title, rows, x, y, width, accent) {
  doc.setDrawColor(209, 213, 219);
  doc.rect(x, y, width, 39);
  setRgb(doc, 'setFillColor', accent);
  doc.rect(x, y, width, 7, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text(title.toUpperCase(), x + 3, y + 5);

  let rowY = y + 13;
  for (const [label, value] of rows) {
    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(101, 116, 139);
    doc.text(label.toUpperCase(), x + 3, rowY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(17, 24, 39);
    doc.text(doc.splitTextToSize(String(value || ''), width - 30), x + 27, rowY);
    rowY += 8;
  }
}

function drawStatusBox(doc, form, x, y, width) {
  doc.setDrawColor(209, 213, 219);
  doc.rect(x, y, width, 39);
  const rows = [
    ['Status', form.status],
    ['Due', form.dueDateDisplay],
    ['Method', form.paymentMethod],
    ['Owner', form.assignedName],
  ];
  let rowY = y + 7;
  for (const [label, value] of rows) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(101, 116, 139);
    doc.text(label.toUpperCase(), x + 3, rowY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(17, 24, 39);
    doc.text(doc.splitTextToSize(String(value || ''), width - 26), x + 22, rowY);
    rowY += 8;
  }
}

function drawItems(doc, form, startY) {
  let y = startY;
  doc.setFillColor(17, 24, 39);
  doc.rect(18, y, 174, 9, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  doc.text('#', 23, y + 6);
  doc.text('Description', 36, y + 6);
  doc.text('Unit', 139, y + 6, { align: 'right' });
  doc.text('Qty', 154, y + 6, { align: 'right' });
  doc.text('Amount', 188, y + 6, { align: 'right' });
  y += 14;

  doc.setTextColor(17, 24, 39);
  form.items.forEach((item, index) => {
    const descriptionLines = doc.splitTextToSize(item.description || '', 90);
    const detailLines = item.detail ? doc.splitTextToSize(item.detail, 90) : [];
    const rowHeight = Math.max(11, (descriptionLines.length + detailLines.length) * 4.5 + 4);
    doc.setDrawColor(229, 231, 235);
    doc.line(18, y - 6, 192, y - 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(String(index + 1), 24, y);
    doc.setFont('helvetica', 'bold');
    doc.text(descriptionLines, 36, y);
    if (detailLines.length) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(detailLines, 36, y + descriptionLines.length * 4.5);
      doc.setTextColor(17, 24, 39);
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(formatAitSignsMoney(item.rate, ''), 139, y, { align: 'right' });
    doc.text(String(item.qty || 1), 154, y, { align: 'right' });
    doc.text(formatAitSignsMoney(item.amount, ''), 188, y, { align: 'right' });
    y += rowHeight;
  });

  doc.line(18, y - 3, 192, y - 3);
  return y + 3;
}

function drawTotals(doc, form, y, accent) {
  const leftX = 112;
  const rightX = 192;
  const rows = [
    ['Subtotal', form.amounts.subtotalDisplay],
    [`Tax (${form.amounts.taxRateLabel})`, form.amounts.taxDisplay],
    ['Paid / Deposit', form.amounts.paidAmountDisplay],
    ['Balance Due', form.amounts.balanceDueDisplay],
  ];
  doc.setFontSize(8);
  for (const [label, value] of rows) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(label, leftX, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(17, 24, 39);
    doc.text(value, rightX, y, { align: 'right' });
    y += 7;
  }
  setRgb(doc, 'setDrawColor', accent);
  doc.setLineWidth(0.8);
  doc.line(leftX, y - 3, rightX, y - 3);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  setRgb(doc, 'setTextColor', accent);
  doc.text('Total', leftX, y + 4);
  doc.text(form.amounts.totalDisplay, rightX, y + 4, { align: 'right' });
  return y + 13;
}

function drawTerms(doc, form, y, accent) {
  const termsY = Math.max(y, 246);
  setRgb(doc, 'setDrawColor', accent);
  doc.setLineWidth(0.6);
  doc.roundedRect(18, termsY, 174, 19, 2, 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  setRgb(doc, 'setTextColor', accent);
  doc.text(form.termsTitle.toUpperCase(), 23, termsY + 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);
  doc.text(doc.splitTextToSize(form.terms, 126), 64, termsY + 7);
}

function drawFooter(doc, form) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(17, 24, 39);
  doc.text('Thank you for your business.', 105, 273, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text(doc.splitTextToSize(form.footerNote, 145), 105, 279, { align: 'center' });
}

function renderAitSignsPDF(record, context = {}, documentType) {
  try {
    const form = buildAitSignsDocument(record, { ...context, documentType });
    const accent = DOCUMENT_ACCENT[form.documentType] || DOCUMENT_ACCENT.workOrder;
    const doc = new jsPDF();
    drawHeader(doc, form, accent);
    drawServiceStrip(doc, form, 51, accent);
    drawInfoBox(doc, 'Bill To', [
      ['Name', form.billingInfo.name],
      ['Contact', form.billingInfo.contactName],
      ['Address', form.billingInfo.address],
      ['Phone', form.billingInfo.phone],
    ], 18, 73, 66, accent);
    drawInfoBox(doc, form.documentType === 'workOrder' ? 'Work Site' : 'Project', [
      ['Name', form.workAddress.name],
      ['Contact', form.workAddress.contactName],
      ['Address', form.workAddress.address],
      ['Phone', form.workAddress.phone],
    ], 88, 73, 66, accent);
    drawStatusBox(doc, form, 158, 73, 34);
    const afterItems = drawItems(doc, form, 124);
    const afterTotals = drawTotals(doc, form, Math.max(afterItems + 6, 190), accent);
    drawTerms(doc, form, afterTotals + 6, accent);
    drawFooter(doc, form);
    doc.save(`${safeFilePart(form.title)}-${safeFilePart(form.number)}.pdf`);
  } catch (err) {
    console.error('PDF Generation Error:', err);
    alert('Failed to generate PDF. Please check console for details.');
  }
}

function renderAitUsaReceiptPDF(record, context = {}) {
  try {
    const form = buildAitUsaReceiptDocument(record, context);
    const doc = new jsPDF();
    const accent = [30, 64, 175];
    const ink = [17, 24, 39];
    const muted = [86, 100, 118];

    doc.setFillColor(...accent);
    doc.rect(0, 0, 210, 34, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(form.company.name, 18, 18);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(form.company.tagline, 18, 25);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.text(form.title.toUpperCase(), 192, 19, { align: 'right' });

    doc.setTextColor(...muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Receipt #', 145, 45);
    doc.text('Payment Date', 145, 53);
    doc.setTextColor(...ink);
    doc.setFont('helvetica', 'bold');
    doc.text(form.receiptNumber, 192, 45, { align: 'right' });
    doc.text(form.dateDisplay, 192, 53, { align: 'right' });

    doc.setDrawColor(209, 213, 219);
    doc.roundedRect(18, 43, 104, 42, 2, 2);
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text('RECEIVED FROM / RECIBIDO DE', 24, 53);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...ink);
    doc.text(doc.splitTextToSize(form.studentName, 88), 24, 63);
    if (form.program) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...muted);
      doc.text(doc.splitTextToSize(form.program, 88), 24, 76);
    }

    doc.setFillColor(239, 246, 255);
    doc.roundedRect(18, 96, 174, 46, 2, 2, 'F');
    doc.setTextColor(...muted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('AMOUNT PAID', 28, 110);
    doc.text('PAYMENT METHOD', 102, 110);
    doc.text('BALANCE DUE', 158, 110, { align: 'right' });
    doc.setTextColor(...ink);
    doc.setFontSize(18);
    doc.text(form.amountDisplay, 28, 123);
    doc.setFontSize(11);
    doc.text(form.method, 102, 123);
    doc.text(form.balanceDueDisplay || '$0.00', 178, 123, { align: 'right' });
    if (form.checkNumber) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...muted);
      doc.text(`Reference / Check: ${form.checkNumber}`, 102, 133);
    }

    doc.setDrawColor(...accent);
    doc.roundedRect(18, 157, 174, 48, 2, 2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...accent);
    doc.text('PAYMENT NOTE', 25, 169);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...ink);
    doc.text(doc.splitTextToSize(form.note || form.bilingualNote[0], 154), 25, 181);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text(doc.splitTextToSize(form.bilingualNote.join(' '), 154), 25, 218);

    doc.setDrawColor(209, 213, 219);
    doc.line(18, 246, 92, 246);
    doc.line(118, 246, 192, 246);
    doc.setFontSize(7);
    doc.text('Received by / Recibido por', 18, 252);
    doc.text('Student / Cliente', 118, 252);
    if (form.receivedBy) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...ink);
      doc.text(form.receivedBy, 18, 242);
    }

    doc.setTextColor(...muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('Thank you. Gracias.', 105, 278, { align: 'center' });
    doc.save(`AIT-USA-${safeFilePart(form.receiptNumber)}.pdf`);
  } catch (err) {
    console.error('PDF Generation Error:', err);
    alert('Failed to generate PDF. Please check console for details.');
  }
}

export function generateInvoicePDF(record, context = {}) {
  renderAitSignsPDF(record, context, 'invoice');
}

export function generateEstimatePDF(record, context = {}) {
  renderAitSignsPDF(record, context, 'estimate');
}

export function generateReceiptPDF(record, context = {}) {
  renderAitSignsPDF(record, context, 'receipt');
}

export function generateAitUsaReceiptPDF(record, context = {}) {
  renderAitUsaReceiptPDF(record, context);
}

export function generateWorkOrderPDF(wo, context = {}) {
  renderAitSignsPDF(wo, context, 'workOrder');
}
