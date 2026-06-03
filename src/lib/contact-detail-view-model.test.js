import assert from 'node:assert/strict';
import test from 'node:test';

import { buildContactDetailViewModel } from './contact-detail-view-model.js';

test('AIT Signs contact detail keeps customer-account operational snapshot grammar', () => {
  const model = buildContactDetailViewModel({
    businessUnit: { name: 'AIT Signs' },
    contact: {
      id: 'contact-blue',
      name: 'BLUE MOUNTAIN',
      companyName: 'BLUE MOUNTAIN',
      workflowKey: 'ait_signs',
      workflowLabel: 'AIT Signs Work Pipeline',
      currentStage: 'Invoice / Payment',
      source: 'work_order',
      phone: '9085550101',
    },
    counts: {
      work: 57,
      payment: 24,
      estimate: 1,
      follow_up: 0,
    },
  });

  assert.equal(model.profileTitle, 'Customer Account');
  assert.equal(model.sourceEyebrow, 'AIT Signs');
  assert.deepEqual(model.snapshotItems.map((item) => item.key), ['work', 'payment', 'estimate', 'follow_up']);
  assert.equal(model.tabs.showWorkOrders, true);
  assert.equal(model.tabs.showFinancials, true);
  assert.ok(model.highlights.some((item) => item.label === 'Account' && item.value === 'BLUE MOUNTAIN'));
});

test('AIT USA contact detail uses enrollment grammar and hides empty Signs finance/work affordances', () => {
  const model = buildContactDetailViewModel({
    businessUnit: { name: 'AIT USA Institute' },
    contact: {
      id: 'contact-hilda',
      name: 'HildaRodriguez',
      workflowKey: 'ait_usa',
      status: 'New Lead',
      currentStage: 'New Lead',
      phone: '9735550101',
      email: '',
      source: 'Wix Contact Form',
      enrollmentSignals: {
        source: {
          channel: 'Wix Website Form',
          tags: ['wix_history', 'needs_first_outreach'],
        },
        inquiry: {
          programInterest: 'ESL',
          age: '36',
          location: 'New Jersey',
        },
        process: {
          stage: 'New Lead',
          nextAction: 'Call today',
          outreachState: 'never_contacted',
        },
        contactability: {
          status: 'missing_email',
          label: 'Missing Email',
          canFollowUp: true,
          hasPhone: true,
          hasEmail: false,
        },
      },
    },
    counts: {
      lead: 1,
      follow_up: 0,
      message: 0,
      task: 0,
      work: 0,
      payment: 0,
      estimate: 0,
    },
  });

  assert.equal(model.profileTitle, 'Enrollment Profile');
  assert.equal(model.sourceEyebrow, 'Wix Website Form');
  assert.deepEqual(model.snapshotItems.map((item) => item.key), ['lead', 'follow_up', 'message', 'task']);
  assert.deepEqual(model.timelineFilters.map((filter) => filter.value), ['all', 'lead', 'follow_up', 'message', 'task', 'note', 'import']);
  assert.equal(model.tabs.showWorkOrders, false);
  assert.equal(model.tabs.showFinancials, false);
  assert.ok(model.highlights.some((item) => item.label === 'Program' && item.value === 'ESL'));
  assert.ok(model.workflowChips.includes('Missing Email'));
});

test('AIT USA contact detail only adds operational tabs when real records exist', () => {
  const model = buildContactDetailViewModel({
    businessUnit: { name: 'AIT USA Institute' },
    contact: {
      workflowKey: 'ait_usa',
      name: 'Previous Student',
      email: 'student@example.com',
      phone: '9735550101',
    },
    counts: {
      work: 1,
      payment: 2,
      estimate: 1,
    },
  });

  assert.equal(model.tabs.showWorkOrders, true);
  assert.equal(model.tabs.showFinancials, true);
  assert.deepEqual(model.snapshotItems.map((item) => item.key), ['lead', 'follow_up', 'message', 'task', 'work', 'payment', 'estimate']);
});
