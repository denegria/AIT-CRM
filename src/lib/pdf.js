import { jsPDF } from 'jspdf';

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
  const doc = new jsPDF();
  let y = header(doc, 'INVOICE', record.number);
  y = clientBlock(doc, y, record);
  y = itemsTable(doc, y, record.items);
  totalBlock(doc, y + 4, record.amount);
  footer(doc);
  doc.save(`${record.number}.pdf`);
}

export function generateEstimatePDF(record) {
  const doc = new jsPDF();
  let y = header(doc, 'ESTIMATE', record.number);
  y = clientBlock(doc, y, record);
  y = itemsTable(doc, y, record.items);
  totalBlock(doc, y + 4, record.amount);
  doc.setFontSize(8); doc.setTextColor(150,150,150);
  doc.text('This estimate is valid for 30 days from the date of issue.', 105, 275, { align: 'center' });
  footer(doc);
  doc.save(`${record.number}.pdf`);
}

export function generateReceiptPDF(record) {
  const doc = new jsPDF();
  let y = header(doc, 'RECEIPT', record.number);
  y = clientBlock(doc, y, record);
  y = itemsTable(doc, y, record.items);
  totalBlock(doc, y + 4, record.amount);
  doc.setFontSize(10); doc.setTextColor(34,197,94); doc.setFont('helvetica','bold');
  doc.text('PAID', 105, y + 24, { align: 'center' });
  footer(doc);
  doc.save(`${record.number}.pdf`);
}

export function generateWorkOrderPDF(wo) {
  const doc = new jsPDF();
  let y = header(doc, 'WORK ORDER', wo.number);
  doc.setFontSize(8); doc.setTextColor(130,130,130); doc.text('CLIENT', 20, y);
  doc.setFontSize(11); doc.setTextColor(30,30,30); doc.setFont('helvetica','bold');
  doc.text(wo.client||'', 20, y+7); doc.setFont('helvetica','normal');
  doc.setFontSize(9); doc.setTextColor(100,100,100);
  doc.text(`Priority: ${wo.priority||''}`, 140, y); doc.text(`Status: ${wo.status||''}`, 140, y+6);
  doc.text(`Due: ${wo.dueDate||''}`, 140, y+12);
  y += 24;
  doc.setFontSize(8); doc.setTextColor(130,130,130); doc.text('DESCRIPTION', 20, y);
  y += 7; doc.setFontSize(10); doc.setTextColor(50,50,50);
  const lines = doc.splitTextToSize(wo.description||'', 160);
  doc.text(lines, 20, y); y += lines.length * 5 + 8;
  doc.setFontSize(8); doc.setTextColor(130,130,130); doc.text('ESTIMATED COST', 20, y);
  y += 7; doc.setFontSize(12); doc.setTextColor(30,30,30); doc.setFont('helvetica','bold');
  doc.text(`$${(wo.estimatedCost||0).toLocaleString()}`, 20, y);
  footer(doc);
  doc.save(`${wo.number}.pdf`);
}
