import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aitUsaCourseMetadataForContact,
  buildAitUsaEnrollmentSignals,
  completedOrEndedAitUsaCourse,
  currentOrEnrolledAitUsaCourse,
  parseLeadNoteFields,
} from './ait-usa-enrollment-signals.js';

test('parseLeadNoteFields reads persisted website lead notes without raw string scraping in UI', () => {
  assert.deepEqual(
    parseLeadNoteFields('website_form | source_key=wix-ait-usa | age=36 | address=New jersey | external_id=none | empty='),
    {
      source_key: 'wix-ait-usa',
      age: '36',
      address: 'New jersey',
    },
  );
});

test('buildAitUsaEnrollmentSignals exposes Wix first-outreach fields as structured payload', () => {
  const signals = buildAitUsaEnrollmentSignals({
    contact: {
      phone: '+19085363081',
      email: 'hilda@example.com',
      address: 'New jersey',
    },
    lead: {
      sourceType: 'website_form',
      sourceName: 'Wix Contact Form',
      status: 'New Lead',
      currentStage: 'New Lead',
      originalNotes: 'website_form | external_id=none | source_key=wix-ait-usa | source_row_id=row-1 | current_stage=New Lead | address=New jersey | age=36 | service=ESL',
    },
    workflow: {
      workflowKey: 'ait_usa',
      status: 'New Lead',
      tags: [],
      priority: 'Medium',
      needsFirstOutreach: false,
    },
  });

  assert.equal(signals.source.channel, 'Wix Website Form');
  assert.equal(signals.inquiry.age, '36');
  assert.equal(signals.inquiry.location, 'New jersey');
  assert.equal(signals.inquiry.programInterest, 'ESL');
  assert.deepEqual(signals.course, {
    current: 'ESL',
    enrolled: 'ESL',
  });
  assert.equal(signals.contactability.status, 'reachable');
  assert.equal(signals.quality.disposition, 'ready_for_follow_up');
});

test('AIT USA course metadata selectors expose current/enrolled and completed/ended outcomes', () => {
  const activeSignals = buildAitUsaEnrollmentSignals({
    contact: { phone: '9085550101', email: 'student@example.com' },
    lead: {
      status: 'Enrolled',
      originalNotes: 'website_form | current_course=ESL Level 2 | enrolled_course=ESL Level 2 | service=ESL',
    },
    workflow: { workflowKey: 'ait_usa', status: 'Enrolled' },
  });
  const endedSignals = buildAitUsaEnrollmentSignals({
    contact: { phone: '9085550101', email: 'student@example.com' },
    lead: {
      status: 'Dropped / Quit',
      originalNotes: 'website_form | ended_course=Tax Prep | course_outcome=dropped',
    },
    workflow: { workflowKey: 'ait_usa', status: 'Dropped / Quit' },
  });

  assert.equal(currentOrEnrolledAitUsaCourse({ enrollmentSignals: activeSignals }), 'ESL Level 2');
  assert.equal(completedOrEndedAitUsaCourse({ enrollmentSignals: endedSignals }), 'Tax Prep');
  assert.deepEqual(aitUsaCourseMetadataForContact({ enrollmentSignals: endedSignals }), {
    ended: 'Tax Prep',
    outcome: 'dropped',
  });
});

test('buildAitUsaEnrollmentSignals creates process pills for historical first outreach leads', () => {
  const signals = buildAitUsaEnrollmentSignals({
    contact: {
      phone: '',
      email: 'student@example.com',
    },
    lead: {
      sourceType: 'website_form',
      sourceName: 'Wix Historical Import',
      status: 'New Lead',
      currentStage: 'Needs First Outreach',
      originalNotes: 'website_form | source_key=wix-ait-usa | current_stage=Needs First Outreach | outreach_state=never_contacted | priority=High | tags=wix_history;needs_first_outreach;unworked_lead | next_action=Call today',
    },
    workflow: {
      workflowKey: 'ait_usa',
      status: 'New Lead',
      outreachState: 'never_contacted',
      priority: 'High',
      nextAction: 'Call today',
      tags: ['wix_history', 'needs_first_outreach', 'unworked_lead'],
      needsFirstOutreach: true,
    },
  });

  assert.equal(signals.source.channel, 'Wix Historical Import');
  assert.equal(signals.process.needsFirstOutreach, true);
  assert.equal(signals.process.priority, 'High');
  assert.equal(signals.contactability.status, 'missing_phone');
  assert.equal(signals.contactability.canFollowUp, true);
  assert.deepEqual(
    signals.process.pills.sort(),
    [
      'missing_phone',
      'needs_first_outreach',
      'new_lead',
      'ready_for_follow_up',
      'unworked_lead',
      'wix_history',
    ].sort(),
  );
});

test('buildAitUsaEnrollmentSignals marks missing channels as needs review', () => {
  const signals = buildAitUsaEnrollmentSignals({
    contact: {
      phone: '',
      email: '',
    },
    lead: {
      sourceType: 'facebook_messenger',
      sourceName: 'Facebook Messenger',
      status: 'New Lead',
      currentStage: 'New Lead',
      originalNotes: 'Messenger sender_id=123',
    },
    workflow: {
      workflowKey: 'ait_usa',
      status: 'New Lead',
      tags: [],
    },
  });

  assert.equal(signals.source.channel, 'Facebook Messenger');
  assert.equal(signals.contactability.status, 'no_contact_channel');
  assert.equal(signals.quality.disposition, 'needs_review');
  assert.deepEqual(
    signals.quality.flags.sort(),
    ['missing_phone', 'missing_email', 'no_contact_channel'].sort(),
  );
});
