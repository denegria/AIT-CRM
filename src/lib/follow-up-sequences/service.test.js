import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FOLLOW_UP_BLOCK_CODES,
  FOLLOW_UP_ENROLLMENT_STATUSES,
  FOLLOW_UP_SEQUENCE_STATUSES,
  FOLLOW_UP_STEP_ACTIONS,
} from './constants.js';
import {
  buildFollowUpDraftMessage,
  evaluateFollowUpStepEligibility,
  executeDueFollowUpSteps,
  isWithinFollowUpQuietHours,
  normalizeFollowUpEnrollmentDraft,
  normalizeFollowUpSequenceDraft,
  normalizeFollowUpStepDraft,
} from './service.js';

const NOW = new Date('2026-05-26T15:00:00.000Z');

function baseSequence(overrides = {}) {
  return {
    id: 'sequence-1',
    status: FOLLOW_UP_SEQUENCE_STATUSES.ACTIVE,
    is_enabled: true,
    default_channel: 'messenger',
    max_touches: 3,
    settings_json: { quietHours: { enabled: false } },
    ...overrides,
  };
}

function baseEnrollment(overrides = {}) {
  return {
    id: 'enrollment-1',
    organization_id: 'org-1',
    business_unit_id: 'bu-1',
    sequence_id: 'sequence-1',
    contact_id: 'contact-1',
    lead_id: 'lead-1',
    status: FOLLOW_UP_ENROLLMENT_STATUSES.ACTIVE,
    channel: 'messenger',
    owner_user_id: 'user-1',
    next_step_position: 1,
    next_step_due_at: NOW,
    touch_count: 0,
    max_touches: 3,
    ...overrides,
  };
}

function baseStep(overrides = {}) {
  return {
    id: 'step-1',
    position: 1,
    delay_minutes: 30,
    channel: 'messenger',
    template_id: 'template-1',
    action_type: FOLLOW_UP_STEP_ACTIONS.TASK_AND_DRAFT,
    task_title: 'Review lead follow-up',
    task_description: 'Send the prepared follow-up if it still fits.',
    is_active: true,
    ...overrides,
  };
}

function baseContact(overrides = {}) {
  return {
    id: 'contact-1',
    name: 'Ada Signs',
    company_name: 'AIT',
    is_do_not_call: false,
    is_wrong_number: false,
    ...overrides,
  };
}

function baseTemplate(overrides = {}) {
  return {
    id: 'template-1',
    channel: 'messenger',
    purpose: 'warmup',
    display_name: 'Warm intro',
    body_text: 'Hi {{ contact_name }}, still interested in signs for {{ company_name }}?',
    status: 'active',
    provider_status: 'not_required',
    is_enabled: true,
    ...overrides,
  };
}

function dueRow(overrides = {}) {
  return {
    enrollment_id: 'enrollment-1',
    organization_id: 'org-1',
    business_unit_id: 'bu-1',
    sequence_id: 'sequence-1',
    contact_id: 'contact-1',
    lead_id: 'lead-1',
    enrollment_status: 'active',
    enrollment_channel: 'messenger',
    owner_user_id: 'user-1',
    next_step_position: 1,
    next_step_due_at: NOW,
    touch_count: 0,
    enrollment_max_touches: 3,
    sequence_status: 'active',
    sequence_is_enabled: true,
    default_channel: 'messenger',
    sequence_max_touches: 3,
    sequence_settings_json: { quietHours: { enabled: false } },
    step_id: 'step-1',
    step_position: 1,
    delay_minutes: 30,
    step_channel: 'messenger',
    template_id: 'template-1',
    action_type: 'task_and_draft',
    task_title: 'Review lead follow-up',
    task_description: 'Send the prepared follow-up if it still fits.',
    step_is_active: true,
    contact_name: 'Ada Signs',
    company_name: 'AIT',
    is_do_not_call: false,
    is_wrong_number: false,
    template_channel: 'messenger',
    template_purpose: 'warmup',
    template_display_name: 'Warm intro',
    template_body_text: 'Hi {{ contact_name }}, still interested in signs for {{ company_name }}?',
    template_status: 'active',
    template_provider_status: 'not_required',
    template_is_enabled: true,
    template_metadata_json: {},
    last_inbound_at: '2026-05-26T14:30:00.000Z',
    ...overrides,
  };
}

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
}

function createExecutionClient({ rows = [dueRow()], duplicateRun = false, hasNextStep = false } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      async query(sql, params = []) {
        const normalized = normalizeSql(sql);
        calls.push({ sql: normalized, params });

        if (normalized.startsWith('select e.id as enrollment_id')) {
          return { rows };
        }
        if (normalized.startsWith('insert into follow_up_sequence_step_runs')) {
          return { rows: duplicateRun ? [] : [{ id: 'run-1' }] };
        }
        if (normalized.startsWith('insert into tasks')) {
          return { rows: [{ id: 'task-1' }] };
        }
        if (normalized.startsWith('update follow_up_sequence_step_runs')) {
          return { rows: [] };
        }
        if (normalized.startsWith('select id, delay_minutes from follow_up_sequence_steps')) {
          return { rows: hasNextStep ? [{ id: 'step-2', delay_minutes: 120 }] : [] };
        }
        if (normalized.startsWith('update follow_up_sequence_enrollments')) {
          return { rows: [] };
        }

        throw new Error('Unexpected query: ' + normalized);
      },
    },
  };
}

test('normalizes conservative sequence and enrollment drafts', () => {
  const sequence = normalizeFollowUpSequenceDraft({
    name: ' Warm Lead ',
    defaultChannel: 'WhatsApp',
    isEnabled: true,
    status: 'active',
  });
  const step = normalizeFollowUpStepDraft({
    position: 1,
    channel: 'messenger',
    taskTitle: ' Review draft ',
  });
  const enrollment = normalizeFollowUpEnrollmentDraft(
    { channel: 'messenger' },
    { now: NOW, sequence, firstStep: { delay_minutes: 60 } },
  );

  assert.equal(sequence.key, 'warm-lead');
  assert.equal(sequence.defaultChannel, 'whatsapp');
  assert.equal(sequence.maxTouches, 3);
  assert.equal(step.actionType, FOLLOW_UP_STEP_ACTIONS.TASK_AND_DRAFT);
  assert.equal(enrollment.nextStepDueAt.toISOString(), '2026-05-26T16:00:00.000Z');
});

test('blocks opt-out contacts and leaves live auto-send disabled in drafts', () => {
  const result = evaluateFollowUpStepEligibility({
    enrollment: baseEnrollment(),
    sequence: baseSequence(),
    step: baseStep(),
    contact: baseContact({ is_do_not_call: true }),
    template: baseTemplate(),
    lastInboundAt: '2026-05-26T14:30:00.000Z',
    now: NOW,
  });
  const draft = buildFollowUpDraftMessage({
    enrollment: baseEnrollment(),
    sequence: baseSequence(),
    step: baseStep(),
    contact: baseContact(),
    template: baseTemplate(),
    now: NOW,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reasons[0].code, FOLLOW_UP_BLOCK_CODES.CONTACT_BLOCKED);
  assert.equal(draft.reviewRequired, true);
  assert.equal(draft.autoSendEnabled, false);
});

test('respects quiet hours, provider windows, and channel template constraints', () => {
  assert.equal(isWithinFollowUpQuietHours({
    now: new Date('2026-05-26T21:00:00.000Z'),
    settingsJson: {},
  }), true);

  const quiet = evaluateFollowUpStepEligibility({
    enrollment: baseEnrollment(),
    sequence: baseSequence({ settings_json: {} }),
    step: baseStep(),
    contact: baseContact(),
    template: baseTemplate(),
    lastInboundAt: '2026-05-26T14:30:00.000Z',
    now: new Date('2026-05-26T21:00:00.000Z'),
  });
  const staleMessenger = evaluateFollowUpStepEligibility({
    enrollment: baseEnrollment(),
    sequence: baseSequence(),
    step: baseStep(),
    contact: baseContact(),
    template: baseTemplate(),
    lastInboundAt: '2026-05-24T14:30:00.000Z',
    now: NOW,
  });
  const whatsappPending = evaluateFollowUpStepEligibility({
    enrollment: baseEnrollment({ channel: 'whatsapp' }),
    sequence: baseSequence({ default_channel: 'whatsapp' }),
    step: baseStep({ channel: 'whatsapp' }),
    contact: baseContact(),
    template: baseTemplate({ channel: 'whatsapp', provider_status: 'pending' }),
    lastInboundAt: '2026-05-24T14:30:00.000Z',
    now: NOW,
  });

  assert.equal(quiet.reasons[0].code, FOLLOW_UP_BLOCK_CODES.QUIET_HOURS);
  assert.equal(staleMessenger.reasons[0].code, FOLLOW_UP_BLOCK_CODES.MESSENGER_WINDOW_CLOSED);
  assert.equal(whatsappPending.reasons[0].code, FOLLOW_UP_BLOCK_CODES.TEMPLATE_NOT_APPROVED);
});

test('executes due steps idempotently by creating one review task and draft record', async () => {
  const { client, calls } = createExecutionClient();
  const result = await executeDueFollowUpSteps(client, {
    organizationId: 'org-1',
    businessUnitIds: ['bu-1'],
    now: NOW,
  });

  assert.equal(result.processed, 1);
  assert.equal(result.results[0].runId, 'run-1');
  assert.equal(result.results[0].taskId, 'task-1');
  assert.equal(result.results[0].draftCreated, true);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into tasks')), true);

  const runInsert = calls.find((call) => call.sql.startsWith('insert into follow_up_sequence_step_runs'));
  assert.equal(runInsert.params[10], 'enrollment-1:step-1:2026-05-26T15:00:00.000Z');
  assert.equal(runInsert.params[11].autoSendEnabled, false);
});

test('does not create duplicate tasks when a due step was already recorded', async () => {
  const { client, calls } = createExecutionClient({ duplicateRun: true });
  const result = await executeDueFollowUpSteps(client, {
    organizationId: 'org-1',
    now: NOW,
  });

  assert.equal(result.results[0].duplicate, true);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into tasks')), false);
});

test('stops enrollment without task creation when contact is blocked', async () => {
  const { client, calls } = createExecutionClient({
    rows: [dueRow({ is_do_not_call: true })],
  });
  const result = await executeDueFollowUpSteps(client, {
    organizationId: 'org-1',
    now: NOW,
  });

  assert.equal(result.results[0].blocked, true);
  assert.equal(result.results[0].reasons[0].code, FOLLOW_UP_BLOCK_CODES.CONTACT_BLOCKED);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into tasks')), false);
  assert.equal(
    calls.some((call) => call.sql.includes("set status = 'stopped'")),
    true,
  );
});
