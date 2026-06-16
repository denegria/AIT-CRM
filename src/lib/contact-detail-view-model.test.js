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
  assert.deepEqual(model.workflowChips, ['Needs First Outreach']);
  assert.ok(model.highlights.some((item) => item.label === 'Contactability' && item.value === 'Missing Email'));
});

test('AIT USA contact detail keeps Wix source tags out of the top action row', () => {
  const model = buildContactDetailViewModel({
    businessUnit: { name: 'AIT USA Institute' },
    contact: {
      id: 'contact-ait-america',
      name: 'Ait America',
      workflowKey: 'ait_usa',
      status: 'New Lead',
      currentStage: 'Needs First Outreach',
      email: 'lead@example.com',
      phone: '',
      source: 'Wix Historical Import',
      needsFirstOutreach: true,
      enrollmentSignals: {
        source: {
          channel: 'Wix Historical Import',
          tags: ['wix_history', 'needs_first_outreach', 'unworked_lead'],
        },
        inquiry: {},
        process: {
          stage: 'Needs First Outreach',
          outreachState: 'never_contacted',
          needsFirstOutreach: true,
          nextAction: 'Call today',
        },
        contactability: {
          status: 'missing_phone',
          label: 'Missing Phone',
          canFollowUp: true,
          hasPhone: false,
          hasEmail: true,
        },
      },
    },
  });

  assert.deepEqual(model.workflowChips, ['Needs First Outreach']);
  assert.ok(model.highlights.some((item) => item.label === 'Inquiry source' && item.value === 'Wix Historical Import'));
  assert.ok(model.highlights.some((item) => item.label === 'Contactability' && item.value === 'Missing Phone'));
  assert.ok(!model.workflowChips.includes('Wix History'));
  assert.ok(!model.workflowChips.includes('Never Contacted'));
  assert.ok(!model.workflowChips.includes('Missing Phone'));
});

test('AIT USA contact detail uses contact-info blocker as the only top chip when outreach is blocked', () => {
  const model = buildContactDetailViewModel({
    businessUnit: { name: 'AIT USA Institute' },
    contact: {
      workflowKey: 'ait_usa',
      status: 'New Lead',
      currentStage: 'New Lead',
      email: '',
      phone: '',
      needsFirstOutreach: true,
      enrollmentSignals: {
        source: { channel: 'WordPress Website Form' },
        process: {
          stage: 'New Lead',
          outreachState: 'never_contacted',
          needsFirstOutreach: true,
        },
        contactability: {
          status: 'no_contact_channel',
          label: 'Needs Contact Info',
          canFollowUp: false,
          hasPhone: false,
          hasEmail: false,
        },
      },
    },
  });

  assert.deepEqual(model.workflowChips, ['Needs Contact Info']);
  assert.ok(model.highlights.some((item) => item.label === 'Inquiry source' && item.value === 'WordPress Website Form'));
  assert.ok(model.highlights.some((item) => item.label === 'Contactability' && item.value === 'Needs Contact Info'));
});

test('AIT USA contact detail only adds student receipt finance affordances when real receipt records exist', () => {
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
  assert.equal(model.tabs.financialLabel, 'Receipts');
  assert.deepEqual(model.snapshotItems.map((item) => item.key), ['lead', 'follow_up', 'message', 'task', 'work', 'payment']);
  assert.deepEqual(model.snapshotItems.map((item) => item.label), ['Inquiry', 'Outreach', 'Messages', 'Tasks', 'Related work', 'Receipts']);
  assert.deepEqual(model.timelineFilters.map((filter) => filter.label), [
    'All history',
    'Enrollment leads',
    'Follow-ups',
    'Messages',
    'Tasks',
    'Notes',
    'Related work',
    'Receipts',
    'Source details',
  ]);
});
