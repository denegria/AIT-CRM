import assert from 'node:assert/strict';
import test from 'node:test';
import {
  pipelineStatusFromLead,
  workflowColumnsForBusinessUnit,
  workflowFromContact,
  workflowFromLead,
} from './sales-workflow.js';

test('workflowColumnsForBusinessUnit returns AIT USA enrollment columns', () => {
  assert.deepEqual(
    workflowColumnsForBusinessUnit({ name: 'AIT USA Institute' }).map((column) => column.id),
    ['New Lead', 'Follow Up', 'Enrolled', 'Completed / Previous Student'],
  );
});

test('workflowColumnsForBusinessUnit returns AIT Signs operational columns', () => {
  const columns = workflowColumnsForBusinessUnit({ name: 'AIT Signs' });
  assert.deepEqual(
    columns.map((column) => column.id),
    ['New Lead', 'Estimate', 'Work Order', 'Fulfillment', 'Invoice / Payment'],
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
});

test('workflowFromContact derives AIT Signs stage from linked records before lead labels', () => {
  const contact = {
    id: 'contact-1',
    status: 'New Lead',
    currentStage: 'New Lead',
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
