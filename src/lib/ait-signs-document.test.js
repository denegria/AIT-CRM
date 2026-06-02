import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAitSignsDocument,
  formatAitSignsDate,
  formatAitSignsMoney,
} from './ait-signs-document.js';

test('AIT Signs document maps the attached paper estimate fields', () => {
  const document = buildAitSignsDocument(
    {
      type: 'Estimate',
      estimateNumber: '2026-079',
      date: '2026-05-19',
      customerName: 'XTREEM KLEEN',
      workContact: 'MIKE',
      description: 'Exterior sign package',
      subtotal: 3500,
      tax: 231.88,
      total: 3731.88,
      status: 'Proposal Sent',
    },
    {
      businessUnit: { name: 'AIT Signs' },
    },
  );

  assert.equal(document.company.name, 'AIT SIGNS PRINTING');
  assert.equal(document.company.tagline, 'WEB PAGE & DIGITAL ADS');
  assert.equal(document.title, 'Estimate');
  assert.equal(document.number, '2026-079');
  assert.equal(document.dateDisplay, '5/19/2026');
  assert.equal(document.customerName, 'XTREEM KLEEN');
  assert.equal(document.workContact, 'MIKE');
  assert.equal(document.billingInfo.name, 'XTREEM KLEEN');
  assert.equal(document.workAddress.contactName, 'MIKE');
  assert.equal(document.division, 'AIT Signs');
  assert.equal(document.items[0].description, 'Exterior sign package');
  assert.equal(document.amounts.subtotalDisplay, '$3,500.00');
  assert.equal(document.amounts.taxDisplay, '$231.88');
  assert.equal(document.amounts.totalDisplay, '$3,731.88');
  assert.equal(document.services.length, 5);
  assert.match(document.footerNote, /Printing guarantee/);
});

test('AIT Signs document estimates tax when only subtotal-like cost is present', () => {
  const document = buildAitSignsDocument({
    workOrderNumber: 'WO-100',
    client: 'XTREEM KLEEN',
    contactName: 'MIKE',
    title: 'Exterior sign package',
    estimatedCost: 3500,
  });

  assert.equal(document.amounts.taxEstimated, true);
  assert.equal(document.amounts.subtotalDisplay, '$3,500.00');
  assert.equal(document.amounts.taxDisplay, '$231.88');
  assert.equal(document.amounts.totalDisplay, '$3,731.88');
});

test('AIT Signs document breaks imported workbook descriptions into item lines', () => {
  const document = buildAitSignsDocument({
    workOrderNumber: 'AIT-WO-ARCH-1515',
    client: 'ROJAS TRANSPORTATIONS',
    contactName: 'CARLOS',
    phone: '9089548607',
    status: 'Canceled',
    estimatedCost: 234.575,
    description: '(2) SIGN LETTERNING CREARLE UN LOGO - LO HIZO POR OTRO LADO · 1503 | SI | NO | 45280.0 | ANC TRANSPORT FLEMINGTON | CARLOS | 908 9548607 | (2) SIGN LETTERNING CREARLE UN LOGO | LO HIZO POR OTRO LADO | JOEL | $ | 220.0 | 14.575 | 234.575 | 234.575 | 234.575 · Import: WORK ORDER TERMINADOS Y PAGADOS · row 1515 · lost',
  });

  assert.equal(document.items.length, 1);
  assert.equal(document.items[0].description, 'SIGN LETTERING CREARLE UN LOGO');
  assert.equal(document.items[0].detail, 'LO HIZO POR OTRO LADO');
  assert.equal(document.items[0].qty, 2);
  assert.equal(document.items[0].rate, 110);
  assert.equal(document.items[0].amount, 220);
  assert.equal(document.amounts.subtotalDisplay, '$220.00');
  assert.equal(document.amounts.taxDisplay, '$14.58');
  assert.equal(document.amounts.totalDisplay, '$234.58');
});

test('AIT Signs document formatters keep paper-friendly money and dates', () => {
  assert.equal(formatAitSignsMoney('3,500'), '$3,500.00');
  assert.equal(formatAitSignsMoney(''), 'Not captured');
  assert.equal(formatAitSignsDate('2026-05-19T14:00:00.000Z'), '5/19/2026');
});
