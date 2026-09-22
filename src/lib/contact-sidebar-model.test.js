import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildContactSidebarInquiry,
  buildContactSidebarNextStep,
  scopedOpenFollowUpTasks,
} from './contact-sidebar-model.js';

const contact = Object.freeze({
  id: 'contact-1',
  name: 'Denegri QA',
  phone: '973-555-0100',
  email: 'qa@example.com',
  hasLeadStatus: true,
  activeOpportunityCount: 1,
  status: 'Follow Up',
});
const task = Object.freeze({
  id: 'task-1',
  contactId: contact.id,
  leadId: 'lead-1',
  taskType: 'follow_up',
  status: 'open',
  title: 'Call about evening class',
  dueAt: '2026-09-22T13:00:00.000Z',
  ownerUserId: 'owner-1',
});

test('sidebar next step makes empty task scope explicit without overstating global truth', () => {
  const privileged = buildContactSidebarNextStep({ contact, canSeeAllTasks: true });
  const regular = buildContactSidebarNextStep({ contact, canSeeAllTasks: false });
  assert.equal(privileged.title, 'No follow-up recorded');
  assert.equal(regular.title, 'No follow-up assigned to you');
  assert.equal(privileged.actionLabel, 'Log follow-up');
});

test('sidebar next step treats first outreach as work to record, not inquiry status', () => {
  const firstOutreach = buildContactSidebarNextStep({
    contact: { ...contact, needsFirstOutreach: true },
    canSeeAllTasks: true,
  });
  assert.equal(firstOutreach.kind, 'first_outreach');
  assert.equal(firstOutreach.stateLabel, 'Needs first outreach');
  assert.equal(firstOutreach.title, 'First outreach has not been recorded');
  assert.equal(firstOutreach.actionLabel, 'Log follow-up');
  assert.equal(firstOutreach.actionHref, '/contacts/contact-1?action=log-follow-up');
});

test('sidebar next step exposes exact scheduled and overdue task actions', () => {
  const scheduled = buildContactSidebarNextStep({
    contact,
    tasks: [task],
    ownerOptions: [{ id: 'owner-1', label: 'Lili Coordinator' }],
    now: new Date('2026-09-20T12:00:00.000Z'),
  });
  assert.equal(scheduled.kind, 'scheduled');
  assert.equal(scheduled.ownerLabel, 'Lili Coordinator');
  assert.equal(scheduled.actionLabel, 'Log outcome');
  assert.equal(scheduled.openHref, '/tasks/task-1');

  const overdue = buildContactSidebarNextStep({
    contact,
    tasks: [{ ...task, dueAt: '2026-09-18T13:00:00.000Z' }],
    now: new Date('2026-09-20T12:00:00.000Z'),
  });
  assert.equal(overdue.kind, 'overdue');
  assert.equal(overdue.actionLabel, 'Log overdue outcome');
});

test('sidebar next step preserves multiple-task and inquiry-conflict ambiguity', () => {
  const multiple = buildContactSidebarNextStep({ contact, tasks: [task, { ...task, id: 'task-2' }] });
  assert.equal(multiple.kind, 'multiple');
  assert.equal(multiple.actionLabel, 'Review follow-ups');

  const conflict = buildContactSidebarNextStep({
    contact: { ...contact, opportunityConflict: true, activeOpportunityCount: 3 },
    tasks: [task],
  });
  assert.equal(conflict.kind, 'inquiry_conflict');
  assert.equal(conflict.title, '3 active inquiries need review');
  assert.equal(conflict.actionLabel, 'Review inquiries');
});

test('sidebar next step prioritizes missing channels and outreach restrictions', () => {
  const missing = buildContactSidebarNextStep({ contact: { ...contact, phone: '', email: '' }, tasks: [task] });
  assert.equal(missing.kind, 'missing_contact');
  assert.equal(missing.actionType, 'edit');

  const restricted = buildContactSidebarNextStep({
    contact,
    tasks: [task],
    contactability: { status: 'do_not_contact', canFollowUp: false, label: 'Do Not Contact', reason: 'Contact requested no outreach.' },
  });
  assert.equal(restricted.kind, 'restricted');
  assert.equal(restricted.actionLabel, 'Outreach blocked');
  assert.equal(restricted.actionType, 'disabled');
  assert.equal(restricted.task.id, task.id);

  const wrongNumber = buildContactSidebarNextStep({
    contact: { ...contact, email: '' },
    contactability: { status: 'wrong_number', canFollowUp: false, label: 'Wrong Number' },
  });
  assert.equal(wrongNumber.actionLabel, 'Update contact info');
  assert.equal(wrongNumber.actionType, 'edit');
});

test('task payload projection keeps only open follow-up tasks', () => {
  const payload = {
    tasks: [
      task,
      { ...task, id: 'closed', status: 'completed' },
      { ...task, id: 'generic', taskType: 'general' },
    ],
  };
  assert.deepEqual(scopedOpenFollowUpTasks(payload).map((item) => item.id), ['task-1']);
});

test('sidebar inquiry exposes canonical status and only explicit profile truth', () => {
  const inquiry = buildContactSidebarInquiry({
    contact: {
      ...contact,
      hasLeadStatus: true,
      activeOpportunityCount: 1,
      status: 'New Lead',
      currentStage: 'New Lead',
      programInterest: 'Wix historical lead',
      leadProfile: { programInterest: '', locationPreference: 'New Jersey' },
    },
    studentLocation: 'New Jersey',
  });
  assert.equal(inquiry.kind, 'active');
  assert.deepEqual(inquiry.facts, {
    status: 'New Lead',
    program: 'Not recorded',
    studentLocation: 'New Jersey',
  });
});

test('sidebar inquiry distinguishes the current inquiry from truthful closed history', () => {
  const history = buildContactSidebarInquiry({
    contact: {
      ...contact,
      activeOpportunityCount: 0,
      status: 'Retargeting',
      leadProfile: { programInterest: 'English' },
    },
    studentLocation: 'New Jersey',
  });
  assert.equal(history.kind, 'history');
  assert.equal(history.heading, 'Last inquiry');
  assert.deepEqual(history.facts, {
    status: 'Retargeting',
    program: 'English',
    studentLocation: 'New Jersey',
  });

  const missing = buildContactSidebarInquiry({
    contact: { ...contact, hasLeadStatus: false, activeOpportunityCount: 0 },
  });
  assert.equal(missing.kind, 'missing');
  assert.equal(missing.title, 'Inquiry history unavailable');

  const conflict = buildContactSidebarInquiry({
    contact: { ...contact, hasLeadStatus: true, opportunityConflict: true, activeOpportunityCount: 2 },
  });
  assert.equal(conflict.kind, 'conflict');
  assert.equal(conflict.title, 'Multiple active inquiries');
});

test('sidebar next step makes Retargeting actionable without requiring an individual schedule', () => {
  const retargeting = buildContactSidebarNextStep({
    contact: { ...contact, activeOpportunityCount: 0, status: 'Retargeting' },
    canSeeAllTasks: true,
  });
  assert.equal(retargeting.kind, 'retargeting');
  assert.equal(retargeting.stateLabel, 'Ready for retargeting');
  assert.equal(retargeting.title, 'Renewed outreach may be recorded');
  assert.equal(retargeting.actionLabel, 'Log follow-up');
  assert.equal(retargeting.actionHref, '/contacts/contact-1?action=log-follow-up');

  const exactTask = buildContactSidebarNextStep({
    contact: { ...contact, activeOpportunityCount: 0, status: 'Retargeting' },
    tasks: [task],
    now: new Date('2026-09-20T12:00:00.000Z'),
  });
  assert.equal(exactTask.kind, 'scheduled');
  assert.equal(exactTask.title, task.title);
});

test('sidebar next step suppresses normal actions for closed inquiry outcomes', () => {
  for (const [status, expectedKind] of [
    ['Not Interested', 'closed_blocked'],
    ['Dropped / Quit', 'closed'],
    ['Course Completed', 'closed'],
  ]) {
    const result = buildContactSidebarNextStep({
      contact: { ...contact, activeOpportunityCount: 0, status },
      canSeeAllTasks: true,
    });
    assert.equal(result.kind, expectedKind);
    assert.equal(result.actionType, 'none');
    assert.equal(result.actionLabel, undefined);
  }
});

test('sidebar next step fails closed when inquiry history is missing', () => {
  const result = buildContactSidebarNextStep({
    contact: { ...contact, hasLeadStatus: false, activeOpportunityCount: 0 },
    canSeeAllTasks: true,
  });
  assert.equal(result.kind, 'missing_inquiry');
  assert.equal(result.actionType, 'none');
  assert.equal(result.actionLabel, undefined);
});
