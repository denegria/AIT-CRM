import assert from 'node:assert/strict';
import test from 'node:test';
import { assertKnownContactRelationships, CONTACT_RELATIONSHIP_POLICIES } from './service.js';

test('every declared Contact relationship policy is explicit', () => {
  const relationships = Object.keys(CONTACT_RELATIONSHIP_POLICIES).map((key) => {
    const split = key.lastIndexOf('.');
    return { table: key.slice(0, split), column: key.slice(split + 1) };
  });
  assert.equal(assertKnownContactRelationships(relationships), true);
});

test('a future unclassified Contact relationship aborts merge', () => {
  assert.throws(
    () => assertKnownContactRelationships([{ table: 'future_student_records', column: 'contact_id' }]),
    /Unclassified Contact relationships abort merge/,
  );
});
