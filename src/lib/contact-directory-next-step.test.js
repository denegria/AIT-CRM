import assert from 'node:assert/strict';
import test from 'node:test';
import { contactDirectoryNextStep } from './contact-directory-next-step.js';

const base = {
  id: 'contact-1',
  phone: '973-555-0100',
  hasLeadStatus: true,
  activeOpportunityCount: 1,
  workflowKey: 'ait_usa',
  status: 'New Lead',
  followUpCoverage: {},
};

test('directory next step offers outreach logging for actionable contacts', () => {
  assert.deepEqual(contactDirectoryNextStep({
    ...base,
    followUpCoverage: { needsFirstContact: true },
  }), {
    label: 'Needs first outreach',
    detail: 'No outreach recorded',
    actionLabel: 'Log outreach',
    action: 'log_follow_up',
  });

  const nextFollowUp = contactDirectoryNextStep({
    ...base,
    status: 'Follow Up',
    followUpCoverage: { needsNextFollowUp: true },
  });
  assert.equal(nextFollowUp.label, 'Needs next follow-up');
  assert.equal(nextFollowUp.actionLabel, 'Log follow-up');

  const unflaggedNewLead = contactDirectoryNextStep({
    ...base,
    followUpCoverage: {},
  });
  assert.equal(unflaggedNewLead.actionLabel, 'Log outreach');
});

test('retargeting is actionable without implying an individual schedule', () => {
  const result = contactDirectoryNextStep({
    ...base,
    activeOpportunityCount: 0,
    status: 'Retargeting',
  });
  assert.equal(result.label, 'Ready for retargeting');
  assert.equal(result.actionLabel, 'Log outreach');
  assert.doesNotMatch(`${result.label} ${result.detail}`, /schedul/i);
});

test('exact dated commitments suppress the generic outreach shortcut', () => {
  const result = contactDirectoryNextStep({
    ...base,
    followUpCoverage: { hasActiveDatedCommitment: true },
  });
  assert.equal(result.label, 'Follow-up scheduled');
  assert.equal(result.action, 'none');
});

test('blocked, missing-channel, and neutral closed contacts have no shortcut', () => {
  assert.equal(contactDirectoryNextStep({ ...base, isDoNotCall: true }).action, 'none');
  assert.equal(contactDirectoryNextStep({ ...base, phone: '', email: '' }).label, 'Contact info needed');
  assert.equal(contactDirectoryNextStep({
    ...base,
    activeOpportunityCount: 0,
    status: 'Dropped / Quit',
  }).label, 'No active work');
});
