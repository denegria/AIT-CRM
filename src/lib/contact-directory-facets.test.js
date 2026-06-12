import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildContactDirectoryFacetGroups,
  contactDirectorySignalLabels,
  filterContactsByDirectoryFacet,
} from './contact-directory-facets.js';

const businessUnitById = new Map([
  ['signs', { id: 'signs', name: 'AIT Signs' }],
  ['usa', { id: 'usa', name: 'AIT USA Institute' }],
]);

function facetCount(groups, id) {
  return groups.flatMap((group) => group.facets).find((facet) => facet.id === id)?.count;
}

test('contact directory facets expose counted division-aware buckets', () => {
  const contacts = [
    {
      id: 'signs-source',
      businessUnitId: 'signs',
      workflowKey: 'ait_signs',
      status: 'Intake',
      phone: '9085551212',
      email: '',
      assignedTo: 'emp-1',
      isPipelineEligible: false,
      lastTouch: '2026-05-15',
    },
    {
      id: 'signs-work',
      businessUnitId: 'signs',
      workflowKey: 'ait_signs',
      status: 'Work Order',
      phone: '90855534340',
      email: 'shop@example.com',
      linkedPeopleCount: 2,
      relatedWorkOrderCount: 1,
      lastTouch: '2026-05-25',
    },
    {
      id: 'usa-first',
      businessUnitId: 'usa',
      workflowKey: 'ait_usa',
      status: 'New Lead',
      email: 'lead@example.com',
      needsFirstOutreach: true,
      processPills: ['needs_first_outreach', 'ready_for_follow_up', 'missing_phone'],
      lastTouch: 'None',
    },
    {
      id: 'usa-review',
      businessUnitId: 'usa',
      workflowKey: 'ait_usa',
      status: 'New Lead',
      processPills: ['needs_review', 'no_contact_channel'],
      lastTouch: '2026-04-01',
    },
  ];

  const groups = buildContactDirectoryFacetGroups(contacts, {
    businessUnitById,
    currentUserId: 'emp-1',
    now: new Date('2026-06-03T00:00:00Z').getTime(),
  });

  assert.equal(facetCount(groups, 'all'), 4);
  assert.equal(facetCount(groups, 'mine'), 1);
  assert.equal(facetCount(groups, 'active'), 3);
  assert.equal(facetCount(groups, 'no_recent_touch'), 2);
  assert.equal(facetCount(groups, 'needs_contact_info'), 1);
  assert.equal(facetCount(groups, 'invalid_phone'), 1);
  assert.equal(facetCount(groups, 'signs_linked_people'), 1);
  assert.equal(facetCount(groups, 'usa_follow_up'), 1);
  assert.equal(facetCount(groups, 'usa_bad_contact_channel'), 1);
});

test('contact directory facet filtering isolates sales-cycle buckets', () => {
  const contacts = [
    {
      id: 'ready',
      businessUnitId: 'usa',
      workflowKey: 'ait_usa',
      status: 'New Lead',
      processPills: ['ready_for_follow_up'],
    },
    {
      id: 'suppress',
      businessUnitId: 'usa',
      workflowKey: 'ait_usa',
      status: 'Follow Up',
      processPills: ['suppress_from_follow_up', 'wrong_number'],
    },
    {
      id: 'estimate',
      businessUnitId: 'signs',
      workflowKey: 'ait_signs',
      status: 'Estimate',
      linkedPeopleCount: 1,
      relatedEstimateCount: 1,
    },
  ];

  assert.deepEqual(
    filterContactsByDirectoryFacet(contacts, 'usa_follow_up', { businessUnitById }).map((contact) => contact.id),
    ['ready', 'suppress'],
  );
  assert.deepEqual(
    filterContactsByDirectoryFacet(contacts, 'usa_bad_contact_channel', { businessUnitById }).map((contact) => contact.id),
    ['suppress'],
  );
  assert.deepEqual(
    filterContactsByDirectoryFacet(contacts, 'signs_estimate', { businessUnitById }).map((contact) => contact.id),
    ['estimate'],
  );
  assert.deepEqual(
    filterContactsByDirectoryFacet(contacts, 'signs_linked_people', { businessUnitById }).map((contact) => contact.id),
    ['estimate'],
  );
});

test('contact directory signal labels summarize useful row context', () => {
  assert.deepEqual(
    contactDirectorySignalLabels({
      workflowKey: 'ait_usa',
      status: 'New Lead',
      email: 'lead@example.com',
      needsFirstOutreach: true,
      processPills: ['ready_for_follow_up', 'missing_phone'],
    }),
    ['First Outreach', 'Missing Phone', 'Ready Follow-up'],
  );
});

test('contact directory signal labels flag invalid phone formats', () => {
  assert.deepEqual(
    contactDirectorySignalLabels({
      workflowKey: 'ait_signs',
      status: 'Work Order',
      phone: '90855534340',
      email: 'shop@example.com',
      linkedPeopleCount: 2,
    }),
    ['Invalid Phone', 'Linked People'],
  );
});
