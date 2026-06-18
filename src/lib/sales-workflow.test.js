import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPipelineEligibleContact,
  pipelineStatusFromLead,
  workflowColumnsForBusinessUnit,
  workflowFromContact,
  workflowFromLead,
} from './sales-workflow.js';

test('workflowColumnsForBusinessUnit returns AIT USA enrollment columns', () => {
  assert.deepEqual(
    workflowColumnsForBusinessUnit({ name: 'AIT USA Institute' }).map((column) => column.id),
    ['New Lead', 'Follow Up', 'Enrolled', 'Not Interested', 'Course Completed'],
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
    pipelineStatusFromLead({ status: 'Closed Lost' }, { businessUnit: { name: 'AIT USA Institute' } }),
    'Not Interested',
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
