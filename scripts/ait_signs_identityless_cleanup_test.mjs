import test from 'node:test';
import assert from 'node:assert/strict';
import { identitylessRowsFromArtifact } from './cleanup-ait-signs-identityless-promotions.mjs';

test('extracts only missing-identity AIT Signs review rows from an artifact', () => {
  const artifact = {
    reviewItems: [
      {
        sourceSheet: '1. INTERESADOS',
        sourceRowNumber: 14,
        reason: 'Missing customer/contact/phone identity: NO CONTESTO',
      },
      {
        sourceSheet: '1. INTERESADOS',
        sourceRowNumber: 14,
        reason: 'Missing customer/contact/phone identity: duplicate reason',
      },
      {
        sourceSheet: '2. ESTIMADOS',
        sourceRowNumber: 145,
        reason: 'Missing customer/contact/phone identity: 1650.0 | 109.3125',
      },
      {
        sourceSheet: '2. ESTIMADOS',
        sourceRowNumber: 999,
        reason: 'Low confidence row',
      },
    ],
  };

  assert.deepEqual(identitylessRowsFromArtifact(artifact), [
    { sourceSheet: '1. INTERESADOS', sourceRow: 14 },
    { sourceSheet: '2. ESTIMADOS', sourceRow: 145 },
  ]);
});
