import assert from 'node:assert/strict';
import test from 'node:test';

import {
  contactMatchesFollowUpCoverage,
  followUpCoverageForContact,
  isGenuineHumanActivityEvent,
} from './follow-up-coverage.js';

const eligible = {
  workflowKey: 'ait_usa',
  status: 'New Lead',
  processPills: ['ready_for_follow_up'],
};

test('coverage segments are actionable and mutually exclusive', () => {
  const first = followUpCoverageForContact(eligible, {
    hasHumanInteraction: false,
    hasActiveDatedCommitment: false,
  });
  const next = followUpCoverageForContact({ ...eligible, status: 'Follow Up' }, {
    hasHumanInteraction: true,
    hasActiveDatedCommitment: false,
  });
  const covered = followUpCoverageForContact(eligible, {
    hasHumanInteraction: false,
    hasActiveDatedCommitment: true,
  });

  assert.equal(first.needsFirstContact, true);
  assert.equal(first.needsNextFollowUp, false);
  assert.equal(next.needsFirstContact, false);
  assert.equal(next.needsNextFollowUp, true);
  assert.equal(covered.needsFirstContact, false);
  assert.equal(covered.needsNextFollowUp, false);
  assert.equal(contactMatchesFollowUpCoverage({ ...eligible, followUpCoverage: first }, 'needs_first_contact'), true);
});

test('terminal and suppressed contacts are never coverage exceptions', () => {
  for (const contact of [
    { ...eligible, status: 'Enrolled' },
    { ...eligible, status: 'Not Interested' },
    { ...eligible, isDoNotCall: true },
    { ...eligible, isWrongNumber: true },
    { ...eligible, workflowKey: 'ait_signs', status: 'Intake' },
  ]) {
    const coverage = followUpCoverageForContact(contact, {
      hasHumanInteraction: false,
      hasActiveDatedCommitment: false,
    });
    assert.equal(coverage.needsFirstContact, false);
    assert.equal(coverage.needsNextFollowUp, false);
  }
});

test('website capture is not a human interaction but real outreach is', () => {
  assert.equal(isGenuineHumanActivityEvent({ eventType: 'website_lead_captured' }), false);
  assert.equal(isGenuineHumanActivityEvent({ eventType: 'task.created' }), false);
  assert.equal(isGenuineHumanActivityEvent({ eventType: 'follow_up.no_answer' }), true);
  assert.equal(isGenuineHumanActivityEvent({ eventType: 'manual_outbound.sms' }), true);
});
