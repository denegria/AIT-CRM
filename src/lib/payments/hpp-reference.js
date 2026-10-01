import { createHash } from 'node:crypto';

const PREFIXES = Object.freeze({
  staff: 'S',
  portal: 'P',
  registration: 'R',
});

// Dejavoo's HPP request contract allows at most 20 alphanumeric characters.
// One type letter and 19 hex characters retain 76 bits of collision resistance.
export const HPP_REFERENCE_PATTERN = /^[A-Za-z0-9]{1,20}$/;

export function createHppMerchantReference(kind, identifiers) {
  const prefix = PREFIXES[kind];
  if (!prefix || !Array.isArray(identifiers) || identifiers.length === 0
    || identifiers.some((identifier) => !String(identifier ?? '').trim())) {
    throw new Error('A known HPP reference type and nonempty identifiers are required.');
  }
  const digest = createHash('sha256')
    .update(JSON.stringify([kind, ...identifiers.map((identifier) => String(identifier))]))
    .digest('hex')
    .slice(0, 19)
    .toUpperCase();
  return `${prefix}${digest}`;
}
