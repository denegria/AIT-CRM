import { jsPDF } from 'jspdf';
import { buildAitSignsDocument, formatAitSignsMoney } from '@/lib/ait-signs-document';

const COMPANY = { name: 'AIT Services', address: '1200 Commerce Dr, Suite 400', city: 'Austin, TX 78701', phone: '(512) 555-0100', email: 'info@aitservices.com' };

function header(doc, title, number) {
  doc.setFontSize(20); doc.setFont('helvetica','bold'); doc.setTextColor(30,30,30);
  doc.text(COMPANY.name, 20, 25);
  doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(100,100,100);
  doc.text(COMPANY.address, 20, 32); doc.text(`${COMPANY.city}  |  ${COMPANY.phone}`, 20, 37);
  doc.setFontSize(16); doc.setFont('helvetica','bold'); doc.setTextColor(74,122,255);
  doc.text(title, 190, 25, { align: 'right' });
  doc.setFontSize(10); doc.setTextColor(80,80,80); doc.setFont('helvetica','normal');
  doc.text(number, 190, 32, { align: 'right' });
  doc.setDrawColor(220,220,220); doc.line(20, 42, 190, 42);
  return 50;
}

function clientBlock(doc, y, record) {
  doc.setFontSize(8); doc.setTextColor(130,130,130); doc.text('BILL TO', 20, y);
  doc.setFontSize(11); doc.setTextColor(30,30,30); doc.setFont('helvetica','bold');
  doc.text(record.client || 'Client', 20, y+7); doc.setFont('helvetica','normal');
  doc.setFontSize(9); doc.setTextColor(100,100,100);
  if (record.date) { doc.text(`Date: ${record.date}`, 140, y); }
  if (record.dueDate) { doc.text(`Due: ${record.dueDate}`, 140, y+6); }
  if (record.status) { doc.text(`Status: ${record.status}`, 140, y+12); }
  return y + 22;
}

function itemsTable(doc, y, items) {
  doc.setFillColor(245,245,248); doc.rect(20, y, 170, 8, 'F');
  doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(80,80,80);
  doc.text('Description', 24, y+5.5); doc.text('Qty', 120, y+5.5);
  doc.text('Rate', 145, y+5.5); doc.text('Amount', 170, y+5.5);
  y += 12; doc.setFont('helvetica','normal'); doc.setTextColor(50,50,50); doc.setFontSize(9);
  (items||[]).forEach(item => {
    doc.text(item.desc || '', 24, y);
    doc.text(String(item.qty || 1), 123, y);
    doc.text(`$${(item.rate||0).toLocaleString()}`, 145, y);
    doc.text(`$${((item.qty||1)*(item.rate||0)).toLocaleString()}`, 170, y);
    y += 7;
  });
  return y;
}

function totalBlock(doc, y, amount) {
  doc.setDrawColor(220,220,220); doc.line(120, y, 190, y);
  y += 8; doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(30,30,30);
  doc.text('Total:', 145, y); doc.text(`$${(amount||0).toLocaleString()}`, 190, y, { align: 'right' });
  return y + 10;
}

function footer(doc) {
  doc.setFontSize(8); doc.setTextColor(150,150,150);
  doc.text('Thank you for your business.', 105, 280, { align: 'center' });
  doc.text(`${COMPANY.name}  |  ${COMPANY.email}`, 105, 285, { align: 'center' });
}

export function generateInvoicePDF(record) {
  try {
    const doc = new jsPDF();
    let y = header(doc, 'INVOICE', record.number);
    y = clientBlock(doc, y, record);
    y = itemsTable(doc, y, record.items);
    totalBlock(doc, y + 4, record.amount);
    footer(doc);
    doc.save(`${record.number}.pdf`);
  } catch (err) {
    console.error('PDF Generation Error:', err);
    alert('Failed to generate PDF. Please check console for details.');
  }
}

export function generateEstimatePDF(record) {
  try {
    const doc = new jsPDF();
    let y = header(doc, 'ESTIMATE', record.number);
    y = clientBlock(doc, y, record);
    y = itemsTable(doc, y, record.items);
    totalBlock(doc, y + 4, record.amount);
    doc.setFontSize(8); doc.setTextColor(150,150,150);
    doc.text('This estimate is valid for 30 days from the date of issue.', 105, 275, { align: 'center' });
    footer(doc);
    doc.save(`${record.number}.pdf`);
  } catch (err) {
    console.error('PDF Generation Error:', err);
    alert('Failed to generate PDF. Please check console for details.');
  }
}

export function generateReceiptPDF(record) {
  try {
    const doc = new jsPDF();
    let y = header(doc, 'RECEIPT', record.number);
    y = clientBlock(doc, y, record);
    y = itemsTable(doc, y, record.items);
    totalBlock(doc, y + 4, record.amount);
    doc.setFontSize(10); doc.setTextColor(34,197,94); doc.setFont('helvetica','bold');
    doc.text('PAID', 105, y + 24, { align: 'center' });
    footer(doc);
    doc.save(`${record.number}.pdf`);
  } catch (err) {
    console.error('PDF Generation Error:', err);
    alert('Failed to generate PDF. Please check console for details.');
  }
}

export function generateWorkOrderPDF(wo, context = {}) {
  try {
    const form = buildAitSignsDocument(wo, context);
    const doc = new jsPDF();
    const drawInfoBox = (title, info, x, y, width = 84) => {
      doc.setDrawColor(20,20,20); doc.rect(x, y, width, 38);
      doc.setFillColor(243,244,246); doc.rect(x, y, width, 7, 'F');
      doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(185,28,28);
      doc.text(title.toUpperCase(), x + 3, y + 5);
      doc.setFontSize(7); doc.setTextColor(100,100,100);
      doc.text('NAME', x + 3, y + 13); doc.text('CONTACT', x + 3, y + 21);
      doc.text('ADDRESS', x + 3, y + 29); doc.text('PHONE', x + 3, y + 36);
      doc.setFont('helvetica','normal'); doc.setTextColor(35,35,35);
      doc.text(doc.splitTextToSize(info.name || '', width - 30), x + 27, y + 13);
      doc.text(doc.splitTextToSize(info.contactName || '', width - 30), x + 27, y + 21);
      doc.text(doc.splitTextToSize(info.address || '', width - 30), x + 27, y + 29);
      doc.text(doc.splitTextToSize(info.phone || '', width - 30), x + 27, y + 36);
    };

    doc.setFontSize(18); doc.setFont('helvetica','bold'); doc.setTextColor(24,24,24);
    doc.rect(20, 15, 18, 14);
    doc.setFillColor(185,28,28); doc.rect(23, 18, 4, 8, 'F');
    doc.setTextColor(185,28,28); doc.text('A', 23, 25);
    doc.setTextColor(24,24,24); doc.text('IT', 29, 25);
    doc.text(form.company.name, 42, 21);
    doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(90,90,90);
    doc.text(form.company.tagline, 42, 28);
    doc.setFontSize(7);
    doc.text(`${form.company.address} | ${form.company.phone} | ${form.company.email}`, 42, 34);
    doc.setFontSize(16); doc.setFont('helvetica','bold'); doc.setTextColor(24,24,24);
    doc.text('ESTIMATE / WORK ORDER', 190, 22, { align: 'right' });
    doc.setFillColor(243,244,246); doc.rect(150, 27, 19, 20, 'F');
    doc.setDrawColor(20,20,20);
    doc.rect(150, 27, 40, 20);
    doc.line(150, 37, 190, 37);
    doc.line(169, 27, 169, 47);
    doc.setFontSize(6); doc.setFont('helvetica','bold'); doc.setTextColor(100,100,100);
    doc.text('ESTIMATE #', 152, 33);
    doc.text('DATE', 152, 43);
    doc.setFontSize(8); doc.setTextColor(24,24,24);
    doc.text(form.number, 187, 33, { align: 'right' });
    doc.text(form.dateDisplay, 187, 43, { align: 'right' });

    let y = 52;
    const serviceWidth = 170 / form.services.length;
    for (const [index, service] of form.services.entries()) {
      const x = 20 + serviceWidth * index;
      doc.setFillColor(185,28,28);
      doc.rect(x, y, serviceWidth, 17, 'FD');
      doc.setFontSize(7); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
      doc.text(service.label, x + serviceWidth / 2, y + 6, { align: 'center' });
      doc.setFontSize(5); doc.setFont('helvetica','normal'); doc.setTextColor(255,232,232);
      doc.text(doc.splitTextToSize(service.detail, serviceWidth - 4), x + serviceWidth / 2, y + 11, { align: 'center' });
    }

    drawInfoBox('Billing Info', form.billingInfo, 20, 77);
    drawInfoBox('Work Address (if different)', form.workAddress, 106, 77);

    y = 124;
    doc.setFillColor(20,24,32); doc.rect(20, y, 170, 9, 'F');
    doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
    doc.text('ITM', 24, y + 6);
    doc.text('DESCRIPTION', 40, y + 6);
    doc.text('UNIT PRICE', 134, y + 6);
    doc.text('QT', 158, y + 6);
    doc.text('TOTAL', 184, y + 6, { align: 'right' });
    y += 16;
    doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(35,35,35);
    for (const [index, item] of form.items.entries()) {
      const lines = doc.splitTextToSize(item.description || '', 84);
      const detailLines = item.detail ? doc.splitTextToSize(item.detail, 84) : [];
      doc.text(String(index + 1), 25, y);
      doc.setFont('helvetica','bold');
      doc.text(lines, 40, y);
      if (detailLines.length) {
        doc.setFont('helvetica','normal');
        doc.setFontSize(7);
        doc.setTextColor(95,95,95);
        doc.text(detailLines, 40, y + (lines.length * 5));
        doc.setFontSize(9);
        doc.setTextColor(35,35,35);
      }
      doc.setFont('helvetica','normal');
      doc.text(formatAitSignsMoney(item.rate, ''), 149, y, { align: 'right' });
      doc.text(String(item.qty || 1), 159, y);
      doc.text(formatAitSignsMoney(item.amount, ''), 184, y, { align: 'right' });
      y += Math.max((lines.length + detailLines.length) * 5, 7) + 5;
    }

    y = Math.max(y + 4, 190);
    doc.setDrawColor(210,210,210); doc.line(118, y, 190, y);
    y += 9; doc.setFontSize(10); doc.setFont('helvetica','normal');
    doc.text('Subtotal', 136, y); doc.text(form.amounts.subtotalDisplay, 190, y, { align: 'right' });
    y += 8; doc.text(`Tax (${form.amounts.taxRateLabel})`, 136, y); doc.text(form.amounts.taxDisplay, 190, y, { align: 'right' });
    y += 9; doc.setFont('helvetica','bold'); doc.setFontSize(12);
    doc.text('Total', 136, y); doc.text(form.amounts.totalDisplay, 190, y, { align: 'right' });
    doc.setFontSize(14); doc.setFont('helvetica','bold'); doc.setTextColor(30,30,30);
    doc.text('Thank You for Your Business', 105, 260, { align: 'center' });
    doc.setDrawColor(185,28,28); doc.rect(35, 265, 140, 12);
    doc.setFontSize(6); doc.setFont('helvetica','bold'); doc.setTextColor(185,28,28);
    doc.text(doc.splitTextToSize(form.footerNote.toUpperCase(), 132), 105, 270, { align: 'center' });
    doc.save(`${form.number || wo.number || 'ait-signs-work-order'}.pdf`);
  } catch (err) {
    console.error('PDF Generation Error:', err);
    alert('Failed to generate PDF. Please check console for details.');
  }
}
