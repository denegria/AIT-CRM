import test from 'node:test';
import assert from 'node:assert/strict';
import { contactIdentityFromProposal } from './promote-ait-signs-staging.mjs';

test('AIT Signs promotion does not use imported row artifacts as contact display identity', () => {
  const identity = contactIdentityFromProposal({
    sourceSheet: '2. ESTIMADOS',
    sourceRowNumber: 22,
    rawValuesJson: ['channel letters', 'YA SE ENVIO ESTIMADO', '623.75'],
    originalText: 'channel letters | YA SE ENVIO ESTIMADO | 623.75',
    workDescription: 'channel letters',
    statusText: 'YA SE ENVIO ESTIMADO',
    moneyHint: '623.75',
  });

  assert.equal(identity.name, 'Unknown AIT Signs Contact');
  assert.equal(identity.companyName, null);
  assert.equal(identity.phone, null);
  assert.equal(identity.email, null);
  assert.equal(identity.address, null);
});

test('AIT Signs promotion uses only explicit contact identity fields', () => {
  const identity = contactIdentityFromProposal({
    contactHint: 'legacy row hint',
    rawValuesJson: ['channel letters', '623.75'],
    contactIdentityFields: {
      customerName: "SAL'S DELI",
      contactName: 'Saul',
      phoneHint: '(908) 821-8180',
      emailHint: 'saul@example.com',
      addressHint: '15 Main St',
    },
  });

  assert.deepEqual(identity, {
    name: "SAL'S DELI",
    companyName: "SAL'S DELI",
    personName: 'Saul',
    phone: '9088218180',
    email: 'saul@example.com',
    address: '15 Main St',
  });
});
