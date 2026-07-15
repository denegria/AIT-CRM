import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeContactSummaryCandidateRows } from './contact-summary-loader.js';

test('contact summary candidates deduplicate rows selected for multiple summary roles', () => {
  const merged = mergeContactSummaryCandidateRows(
    [{ rowId: 'event-1', contactId: 'contact-1', eventType: 'ait_usa.follow_up', message: 'Called student' }],
    [
      { rowId: 'event-1', contactId: 'contact-1', eventType: 'ait_usa.follow_up', message: 'Called student' },
      { rowId: 'event-2', contactId: 'contact-2', eventType: 'website_lead_captured', message: 'Website lead' },
    ],
  );

  assert.deepEqual(merged, [
    { contactId: 'contact-1', eventType: 'ait_usa.follow_up', message: 'Called student' },
    { contactId: 'contact-2', eventType: 'website_lead_captured', message: 'Website lead' },
  ]);
  assert.equal(merged.some((row) => Object.hasOwn(row, 'rowId')), false);
});

test('contact summary candidate merge ignores empty query results', () => {
  assert.deepEqual(mergeContactSummaryCandidateRows([], null, [undefined]), []);
});
