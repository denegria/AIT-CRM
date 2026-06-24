import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AIT_USA_CONTACT_BUCKETS,
  isAitUsaFollowUpBucket,
  isAitUsaNewLeadBucket,
  isAitUsaRetargetingBucket,
  isPipelineNewLeadBucket,
  matchesPipelineQuickFilter,
} from './contact-workflow-buckets.js';

const businessUnitById = new Map([
  ['usa', { id: 'usa', name: 'AIT USA Institute', workflowKey: 'ait_usa' }],
  ['signs', { id: 'signs', name: 'AIT Signs', workflowKey: 'ait_signs' }],
]);

function bucketIdsFor(contact) {
  return AIT_USA_CONTACT_BUCKETS
    .filter((bucket) => bucket.matches(contact, { businessUnitById }))
    .map((bucket) => bucket.id);
}

test('AIT USA stage and action buckets stay explicit', () => {
  const newLead = {
    id: 'new',
    businessUnitId: 'usa',
    workflowKey: 'ait_usa',
    status: 'New Lead',
    currentStage: 'New Lead',
    needsFirstOutreach: true,
  };
  const followUp = {
    id: 'follow',
    businessUnitId: 'usa',
    workflowKey: 'ait_usa',
    status: 'Follow Up',
    processPills: ['ready_for_follow_up'],
  };

  assert.equal(isAitUsaNewLeadBucket(newLead), true);
  assert.equal(matchesPipelineQuickFilter(newLead, 'new_leads', { businessUnitById }), true);
  assert.equal(matchesPipelineQuickFilter(newLead, 'needs_first_outreach', { businessUnitById }), true);
  assert.equal(isAitUsaFollowUpBucket(newLead), false);

  assert.equal(isAitUsaNewLeadBucket(followUp), false);
  assert.equal(isAitUsaFollowUpBucket(followUp), true);
  assert.equal(matchesPipelineQuickFilter(followUp, 'new_leads', { businessUnitById }), false);
});

test('AIT USA bucket ids are shared for Contacts facets and Pipeline quick filters', () => {
  const contacts = [
    { id: 'new', businessUnitId: 'usa', workflowKey: 'ait_usa', status: 'New Lead' },
    { id: 'follow', businessUnitId: 'usa', workflowKey: 'ait_usa', status: 'Follow Up' },
    { id: 'enrolled', businessUnitId: 'usa', workflowKey: 'ait_usa', status: 'Enrolled' },
    { id: 'dropped', businessUnitId: 'usa', workflowKey: 'ait_usa', status: 'Dropped / Quit', isPipelineEligible: false },
    { id: 'quit', businessUnitId: 'usa', workflowKey: 'ait_usa', status: 'quit course', isPipelineEligible: false },
    { id: 'retargeting', businessUnitId: 'usa', workflowKey: 'ait_usa', status: 'Retargeting', isPipelineEligible: false },
    { id: 'bad-channel', businessUnitId: 'usa', workflowKey: 'ait_usa', status: 'Follow Up', processPills: ['wrong_number'] },
  ];

  assert.deepEqual(bucketIdsFor(contacts[0]), ['usa_new_lead']);
  assert.deepEqual(bucketIdsFor(contacts[1]), ['usa_follow_up']);
  assert.deepEqual(bucketIdsFor(contacts[2]), ['usa_enrolled']);
  assert.deepEqual(bucketIdsFor(contacts[3]), ['usa_dropped_quit']);
  assert.deepEqual(bucketIdsFor(contacts[4]), ['usa_dropped_quit']);
  assert.deepEqual(bucketIdsFor(contacts[5]), ['usa_retargeting']);
  assert.deepEqual(bucketIdsFor(contacts[6]), ['usa_bad_contact_channel']);

  assert.equal(matchesPipelineQuickFilter(contacts[0], 'new_leads', { businessUnitById }), true);
  assert.equal(matchesPipelineQuickFilter(contacts[1], 'active', { businessUnitById }), true);
  assert.equal(matchesPipelineQuickFilter(contacts[3], 'active', { businessUnitById }), false);
  assert.equal(matchesPipelineQuickFilter(contacts[4], 'active', { businessUnitById }), false);
  assert.equal(matchesPipelineQuickFilter(contacts[5], 'active', { businessUnitById }), false);
});

test('Pipeline new lead keeps legacy AIT Signs intake behavior outside AIT USA', () => {
  assert.equal(
    isPipelineNewLeadBucket({
      id: 'signs-intake',
      businessUnitId: 'signs',
      workflowKey: 'ait_signs',
      status: 'Intake',
    }),
    true,
  );
  assert.equal(
    isPipelineNewLeadBucket({
      id: 'signs-work-order',
      businessUnitId: 'signs',
      workflowKey: 'ait_signs',
      status: 'Work Order',
    }),
    false,
  );
});

test('Retargeting is visible as its own bucket but not active pipeline work', () => {
  const retargeting = {
    id: 'retargeting',
    businessUnitId: 'usa',
    workflowKey: 'ait_usa',
    status: 'Retargeting',
    isPipelineEligible: false,
    processPills: ['retargeting_only'],
  };

  assert.equal(isAitUsaRetargetingBucket(retargeting), true);
  assert.equal(matchesPipelineQuickFilter(retargeting, 'active', { businessUnitById }), false);
  assert.equal(matchesPipelineQuickFilter(retargeting, 'new_leads', { businessUnitById }), false);
});
