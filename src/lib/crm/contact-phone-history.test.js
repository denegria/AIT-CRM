import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contactPhoneHistoryInput,
  contactPhoneHistoryPayload,
  contactPhoneIdentityKey,
  normalizeContactPhone,
  planContactPhoneHistoryUpsert,
} from './contact-phone-history.js';

test('phone history normalization produces stable E.164 identity keys', () => {
  assert.equal(normalizeContactPhone('(908) 555-0100'), '+19085550100');
  assert.equal(normalizeContactPhone('1-908-555-0100'), '+19085550100');
  assert.equal(contactPhoneIdentityKey('contact-a', '(908) 555-0100'), 'contact-a:+19085550100');
  assert.notEqual(
    contactPhoneIdentityKey('contact-a', '(908) 555-0100'),
    contactPhoneIdentityKey('contact-b', '(908) 555-0100'),
  );
});

test('phone history input preserves per-number restrictions and provenance', () => {
  const input = contactPhoneHistoryInput({
    phone: '908.555.0100',
    isPrimary: false,
    isDoNotCall: true,
    channelConsentJson: { sms: 'opted_out' },
    sourceType: ' roster manifest ',
    sourceReference: ' MIS-318:Bound Brook:42 ',
    observedAt: '2026-07-16T12:00:00Z',
  });
  assert.equal(input.normalizedPhone, '+19085550100');
  assert.equal(input.isDoNotCall, true);
  assert.deepEqual(input.channelConsentJson, { sms: 'opted_out' });
  assert.equal(input.sourceType, 'roster manifest');
  assert.equal(input.sourceReference, 'MIS-318:Bound Brook:42');
});

test('phone history upsert planning is repeatable and only patches changes', () => {
  const incoming = contactPhoneHistoryInput({
    phone: '(908) 555-0100',
    sourceType: 'roster_manifest',
    sourceReference: 'MIS-318:42',
    observedAt: '2026-07-16T12:00:00Z',
  });
  assert.equal(planContactPhoneHistoryUpsert(null, incoming).action, 'insert');
  assert.equal(planContactPhoneHistoryUpsert({ ...incoming }, incoming).action, 'unchanged');
  assert.deepEqual(
    planContactPhoneHistoryUpsert({ ...incoming, phone: '9085550100' }, incoming),
    { action: 'update', patch: { phone: '(908) 555-0100' } },
  );
});

test('phone history payload never promotes a historical number to a current outreach target', () => {
  const payload = contactPhoneHistoryPayload({
    id: 'phone-1',
    contactId: 'contact-1',
    phone: '(908) 555-0100',
    normalizedPhone: '+19085550100',
    isPrimary: false,
    isWrongNumber: true,
  });
  assert.equal(payload.isPrimary, false);
  assert.equal(payload.isWrongNumber, true);
});
