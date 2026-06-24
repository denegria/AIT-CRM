import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPipelineEligibleContact,
  isWorkflowContactActive,
  pipelineStatusFromLead,
  workflowColumnsForBusinessUnit,
  workflowFromContact,
  workflowFromLead,
} from './sales-workflow.js';

test('workflowColumnsForBusinessUnit returns AIT USA enrollment columns', () => {
  assert.deepEqual(
    workflowColumnsForBusinessUnit({ name: 'AIT USA Institute' }).map((column) => column.id),
    ['New Lead', 'Follow Up', 'Enrolled', 'Dropped / Quit', 'Retargeting', 'Not Interested', 'Course Completed'],
  );
});

test('workflow active checks exclude do-not-contact leads even before status cleanup', () => {
  const businessUnit = { id: 'bu-usa', name: 'AIT USA Institute' };
  assert.equal(
    isWorkflowContactActive(
      { id: 'contact-1', status: 'Follow Up', isDoNotCall: true, businessUnitId: 'bu-usa' },
      businessUnit,
    ),
    false,
  );
  assert.equal(
    isWorkflowContactActive(
      { id: 'contact-2', status: 'New Lead', processPills: ['do_not_contact'], businessUnitId: 'bu-usa' },
      businessUnit,
    ),
    false,
  );
  assert.equal(
    isWorkflowContactActive(
      { id: 'contact-3', status: 'New Lead', workflowKey: 'ait_usa' },
    ),
    true,
  );
});

test('workflowColumnsForBusinessUnit returns AIT Signs operational columns', () => {
  const columns = workflowColumnsForBusinessUnit({ name: 'AIT Signs' });
  assert.deepEqual(
    columns.map((column) => column.id),
    ['Intake', 'Estimate', 'Work Order', 'Fulfillment', 'Invoice / Payment'],
  );
  assert.equal(columns.find((column) => column.id === 'Estimate').isOperational, true);
  assert.equal(columns.find((column) => column.id === 'Invoice / Payment').isTerminal, true);
});

test('workflowFromLead maps legacy statuses into the AIT USA workflow', () => {
  assert.equal(
    workflowFromLead({ status: 'Contacted', currentStage: 'Qualified' }, { businessUnit: { name: 'AIT USA Institute' } }).status,
    'Follow Up',
  );
  assert.equal(
    pipelineStatusFromLead({ status: 'Won' }, { businessUnit: { name: 'AIT USA Institute' } }),
    'Enrolled',
  );
  assert.equal(
    pipelineStatusFromLead({ status: 'Completed / Previous Student' }, { businessUnit: { name: 'AIT USA Institute' } }),
    'Course Completed',
  );
  assert.equal(
    pipelineStatusFromLead({ status: 'Retargeting only' }, { businessUnit: { name: 'AIT USA Institute' } }),
    'Retargeting',
  );
  assert.equal(
    pipelineStatusFromLead({ status: 'Dropped course' }, { businessUnit: { name: 'AIT USA Institute' } }),
    'Dropped / Quit',
  );
  assert.equal(
    pipelineStatusFromLead({ status: 'Quit course' }, { businessUnit: { name: 'AIT USA Institute' } }),
    'Dropped / Quit',
  );
  assert.equal(
    pipelineStatusFromLead({ status: 'Previous student' }, { businessUnit: { name: 'AIT USA Institute' } }),
    'New Lead',
  );
  assert.equal(
    pipelineStatusFromLead({ status: 'Closed Lost' }, { businessUnit: { name: 'AIT USA Institute' } }),
    'Not Interested',
  );
});

test('AIT USA default pipeline excludes prior-year and explicit retargeting rows', () => {
  const businessUnit = { id: 'bu-usa', name: 'AIT USA Institute' };
  const now = Date.parse('2026-06-24T00:00:00.000Z');

  assert.equal(
    isPipelineEligibleContact(
      { id: 'old-lead', workflowKey: 'ait_usa', status: 'Follow Up', leadCreatedAt: '2025-12-31T23:59:59.000Z' },
      { businessUnit, now },
    ),
    false,
  );
  assert.equal(
    isPipelineEligibleContact(
      { id: 'current-lead', workflowKey: 'ait_usa', status: 'Follow Up', leadCreatedAt: '2026-01-01T00:00:00.000Z' },
      { businessUnit, now },
    ),
    true,
  );
  assert.equal(
    isPipelineEligibleContact(
      { id: 'retargeting-status', workflowKey: 'ait_usa', status: 'Retargeting', leadCreatedAt: '2026-02-01T00:00:00.000Z' },
      { businessUnit, now },
    ),
    false,
  );
  assert.equal(
    isPipelineEligibleContact(
      { id: 'dropped-status', workflowKey: 'ait_usa', status: 'Dropped / Quit', leadCreatedAt: '2026-02-01T00:00:00.000Z' },
      { businessUnit, now },
    ),
    false,
  );
  assert.equal(
    isPipelineEligibleContact(
      { id: 'quit-status', workflowKey: 'ait_usa', status: 'Dropped / Quit', leadCreatedAt: '2026-02-01T00:00:00.000Z' },
      { businessUnit, now },
    ),
    false,
  );
  assert.equal(
    isPipelineEligibleContact(
      { id: 'retargeting-tag', workflowKey: 'ait_usa', status: 'New Lead', tags: ['legacy_undated_retargeting'] },
      { businessUnit, now },
    ),
    false,
  );
  assert.equal(
    isPipelineEligibleContact(
      { id: 'unknown-date-active-row', workflowKey: 'ait_usa', status: 'New Lead' },
      { businessUnit, now },
    ),
    true,
  );
});

test('workflowFromContact derives AIT Signs stage from linked records before lead labels', () => {
  const contact = {
    id: 'contact-1',
    status: 'Intake',
    currentStage: 'Intake',
    businessUnitId: 'bu-signs',
  };
  const businessUnit = { id: 'bu-signs', name: 'AIT Signs' };

  assert.equal(
    workflowFromContact(contact, {
      businessUnit,
      estimates: [{ contactId: 'contact-1', status: 'Pending' }],
    }).status,
    'Estimate',
  );
  assert.equal(
    workflowFromContact(contact, {
      businessUnit,
      workOrders: [{ contactId: 'contact-1', status: 'In Progress' }],
    }).status,
    'Fulfillment',
  );
  assert.equal(
    workflowFromContact(contact, {
      businessUnit,
      paymentSnapshots: [{ contactId: 'contact-1', amount: 250, paidAt: '2026-06-01' }],
    }).status,
    'Invoice / Payment',
  );
});

test('AIT Signs source-only import contacts stay out of the active pipeline', () => {
  const businessUnit = { id: 'bu-signs', name: 'AIT Signs' };
  assert.equal(
    isPipelineEligibleContact(
      { id: 'contact-1', source: 'archive', hasLeadStatus: false, businessUnitId: 'bu-signs' },
      { businessUnit },
    ),
    false,
  );
  assert.equal(
    isPipelineEligibleContact(
      { id: 'contact-2', source: 'archive', hasLeadStatus: true, businessUnitId: 'bu-signs' },
      { businessUnit },
    ),
    false,
  );
  assert.equal(
    isPipelineEligibleContact(
      { id: 'contact-3', source: 'archive', hasLeadStatus: false, businessUnitId: 'bu-signs' },
      { businessUnit, workOrders: [{ contactId: 'contact-3' }] },
    ),
    false,
  );
  assert.equal(
    isPipelineEligibleContact(
      { id: 'contact-3-current', source: 'archive', hasLeadStatus: false, businessUnitId: 'bu-signs' },
      { businessUnit, workOrders: [{ contactId: 'contact-3-current' }], lastTouch: '2025-10-16' },
    ),
    true,
  );
  assert.equal(
    isPipelineEligibleContact(
      { id: 'contact-3-follow-up', source: 'archive', hasLeadStatus: false, businessUnitId: 'bu-signs' },
      {
        businessUnit,
        workOrders: [{ contactId: 'contact-3-follow-up' }],
        lastTouch: '2024-12-15',
        lastFollowUpTouch: '2026-02-01',
      },
    ),
    true,
  );
  assert.equal(
    isPipelineEligibleContact(
      { id: 'contact-4', source: 'archive', hasLeadStatus: false, businessUnitId: 'bu-usa' },
      { businessUnit: { id: 'bu-usa', name: 'AIT USA Institute' } },
    ),
    true,
  );
  assert.equal(
    isPipelineEligibleContact(
      { id: 'contact-5', source: 'Estimate request', hasLeadStatus: false, businessUnitId: 'bu-signs' },
      { businessUnit },
    ),
    true,
  );
  assert.equal(
    isPipelineEligibleContact(
      { id: 'contact-6', hasLeadStatus: false, businessUnitId: 'bu-signs' },
      { businessUnit, activityEvents: [{ eventType: 'import_promoted_note', sourceSheet: '2. ESTIMADOS' }] },
    ),
    false,
  );
  assert.equal(
    isPipelineEligibleContact(
      { id: 'contact-7', hasLeadStatus: true, businessUnitId: 'bu-signs' },
      { businessUnit },
    ),
    true,
  );
  assert.equal(
    isPipelineEligibleContact(
      { id: 'contact-8', source: '1. INTERESADOS', hasLeadStatus: true, businessUnitId: 'bu-signs' },
      { businessUnit },
    ),
    false,
  );
  assert.equal(
    isPipelineEligibleContact(
      { id: 'contact-9', source: '1. INTERESADOS', hasLeadStatus: true, businessUnitId: 'bu-signs' },
      { businessUnit, lastFollowUpTouch: '2026-03-28' },
    ),
    true,
  );
});
