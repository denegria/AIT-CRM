import assert from 'node:assert/strict';
import test from 'node:test';
import { latestStructuredFollowUpAt } from './structured-follow-up.js';

test('scoped bootstrap structured follow-up projection excludes generic outbound activity', () => {
  const structuredFollowUpAt = latestStructuredFollowUpAt([
    { eventType: 'manual_outbound', occurredAt: '2026-07-08T15:00:00Z' },
    { eventType: 'ait_usa.follow_up', occurredAt: '2026-07-08T14:00:00Z' },
    { eventType: 'follow_up.left_voicemail', occurredAt: '2026-07-08T10:00:00Z' },
    { eventType: 'follow_up.no_answer', occurredAt: '2026-07-08T12:00:00Z' },
  ]);

  assert.equal(structuredFollowUpAt, '2026-07-08T12:00:00.000Z');
});
