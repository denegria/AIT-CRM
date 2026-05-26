import { randomUUID } from 'crypto';
import {
  MESSAGE_TEMPLATE_CHANNELS,
  MESSAGE_TEMPLATE_PROVIDER_STATUSES,
  MESSAGE_TEMPLATE_STATUSES,
} from '../message-templates/constants.js';
import { renderManualTemplateBody } from '../conversations/manual-outbound.js';
import {
  FOLLOW_UP_BLOCK_CODES,
  FOLLOW_UP_ENROLLMENT_STATUSES,
  FOLLOW_UP_SEQUENCE_STATUSES,
  FOLLOW_UP_SERVICE_WINDOW_HOURS,
  FOLLOW_UP_SOURCE,
  FOLLOW_UP_STEP_ACTIONS,
  FOLLOW_UP_STEP_RUN_STATUSES,
  FOLLOW_UP_TRIGGER_TYPES,
  isSupportedFollowUpSequenceChannel,
} from './constants.js';

function cleanText(value) {
  return String(value || '').trim();
}

function cleanLower(value) {
  return cleanText(value).toLowerCase();
}

function cleanNullableText(value) {
  const text = cleanText(value);
  return text || null;
}

function cleanJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + Math.max(0, Number(minutes) || 0) * 60 * 1000);
}

function hoursSince(value, now = new Date()) {
  const date = normalizeDate(value);
  if (!date) return Infinity;
  return (now.getTime() - date.getTime()) / (1000 * 60 * 60);
}

function metadataJson(row = {}) {
  return row.metadata_json || row.metadataJson || row.settings_json || row.settingsJson || {};
}

function block(code, message) {
  return { code, message };
}

function templateMatchesChannel(template, channel) {
  return template?.channel === channel || template?.channel === MESSAGE_TEMPLATE_CHANNELS.ALL;
}

async function withTransaction(client, handler) {
  await client.query('begin');
  try {
    const result = await handler();
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

function quietHoursWindow(settingsJson = {}) {
  const quietHours = settingsJson.quietHours && typeof settingsJson.quietHours === 'object'
    ? settingsJson.quietHours
    : {};
  return {
    enabled: quietHours.enabled !== false,
    startHour: Number.isInteger(quietHours.startHour) ? quietHours.startHour : 20,
    endHour: Number.isInteger(quietHours.endHour) ? quietHours.endHour : 8,
  };
}

export function isWithinFollowUpQuietHours({ now = new Date(), settingsJson = {} } = {}) {
  const quietHours = quietHoursWindow(settingsJson);
  if (!quietHours.enabled) return false;
  const hour = now.getUTCHours();
  const start = Math.max(0, Math.min(23, quietHours.startHour));
  const end = Math.max(0, Math.min(23, quietHours.endHour));
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export function nextQuietHoursExit({ now = new Date(), settingsJson = {} } = {}) {
  const quietHours = quietHoursWindow(settingsJson);
  const end = Math.max(0, Math.min(23, quietHours.endHour));
  const exit = new Date(now);
  exit.setUTCHours(end, 0, 0, 0);
  if (exit <= now) exit.setUTCDate(exit.getUTCDate() + 1);
  return exit;
}

export function normalizeFollowUpSequenceDraft(input = {}) {
  const key = cleanLower(input.key || input.name).replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  const name = cleanText(input.name);
  const defaultChannel = cleanLower(input.defaultChannel || input.default_channel || 'messenger');
  const status = cleanLower(input.status || FOLLOW_UP_SEQUENCE_STATUSES.DRAFT);
  const maxTouches = Math.max(1, Math.min(12, Number(input.maxTouches || input.max_touches || 3)));

  if (!key) throw new Error('Sequence key is required.');
  if (!name) throw new Error('Sequence name is required.');
  if (!isSupportedFollowUpSequenceChannel(defaultChannel)) {
    throw new Error('Follow-up sequences support Messenger and WhatsApp only.');
  }
  if (!Object.values(FOLLOW_UP_SEQUENCE_STATUSES).includes(status)) {
    throw new Error('Unsupported follow-up sequence status.');
  }
  if (input.isEnabled && status !== FOLLOW_UP_SEQUENCE_STATUSES.ACTIVE) {
    throw new Error('Only active follow-up sequences can be enabled.');
  }

  return {
    businessUnitId: cleanNullableText(input.businessUnitId || input.business_unit_id),
    key,
    name,
    description: cleanNullableText(input.description),
    status,
    defaultChannel,
    isEnabled: Boolean(input.isEnabled || input.is_enabled),
    maxTouches,
    settingsJson: cleanJsonObject(input.settingsJson || input.settings_json),
  };
}

export function normalizeFollowUpStepDraft(input = {}) {
  const stepKey = cleanLower(input.stepKey || input.step_key || input.position || randomUUID())
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const position = Math.max(1, Number(input.position || 1));
  const delayMinutes = Math.max(0, Number(input.delayMinutes || input.delay_minutes || 1440));
  const channel = cleanLower(input.channel || 'messenger');
  const actionType = cleanLower(input.actionType || input.action_type || FOLLOW_UP_STEP_ACTIONS.TASK_AND_DRAFT);
  const taskTitle = cleanText(input.taskTitle || input.task_title || `Follow up step ${position}`);

  if (!stepKey) throw new Error('Sequence step key is required.');
  if (!Number.isInteger(position)) throw new Error('Sequence step position must be an integer.');
  if (!isSupportedFollowUpSequenceChannel(channel)) {
    throw new Error('Follow-up sequence steps support Messenger and WhatsApp only.');
  }
  if (!Object.values(FOLLOW_UP_STEP_ACTIONS).includes(actionType)) {
    throw new Error('Unsupported follow-up sequence step action.');
  }
  if (!taskTitle) throw new Error('Sequence step task title is required.');

  return {
    stepKey,
    position,
    delayMinutes,
    channel,
    templateId: cleanNullableText(input.templateId || input.template_id),
    actionType,
    taskTitle,
    taskDescription: cleanNullableText(input.taskDescription || input.task_description),
    isActive: input.isActive === undefined && input.is_active === undefined
      ? true
      : Boolean(input.isActive ?? input.is_active),
    metadataJson: cleanJsonObject(input.metadataJson || input.metadata_json),
  };
}

export function normalizeFollowUpEnrollmentDraft(input = {}, { now = new Date(), sequence = null, firstStep = null } = {}) {
  const channel = cleanLower(input.channel || sequence?.default_channel || sequence?.defaultChannel || firstStep?.channel || 'messenger');
  const maxTouches = Math.max(1, Math.min(12, Number(input.maxTouches || input.max_touches || sequence?.max_touches || sequence?.maxTouches || 3)));
  const firstDelayMinutes = Number(firstStep?.delay_minutes ?? firstStep?.delayMinutes ?? 0);

  if (!isSupportedFollowUpSequenceChannel(channel)) {
    throw new Error('Follow-up enrollments support Messenger and WhatsApp only.');
  }

  return {
    leadId: cleanNullableText(input.leadId || input.lead_id),
    channel,
    ownerUserId: cleanNullableText(input.ownerUserId || input.owner_user_id),
    triggerType: cleanLower(input.triggerType || input.trigger_type || FOLLOW_UP_TRIGGER_TYPES.MANUAL),
    nextStepPosition: 1,
    nextStepDueAt: input.nextStepDueAt || input.next_step_due_at
      ? normalizeDate(input.nextStepDueAt || input.next_step_due_at)
      : addMinutes(now, firstDelayMinutes),
    maxTouches,
    metadataJson: cleanJsonObject(input.metadataJson || input.metadata_json),
  };
}

function templateBlock({ template, channel }) {
  if (!template?.id) {
    return block(FOLLOW_UP_BLOCK_CODES.TEMPLATE_MISSING, 'A configured message template is required before a follow-up draft can be created.');
  }
  if (
    template.status !== MESSAGE_TEMPLATE_STATUSES.ACTIVE
    || !template.is_enabled
    || !templateMatchesChannel(template, channel)
  ) {
    return block(FOLLOW_UP_BLOCK_CODES.TEMPLATE_NOT_ENABLED, 'Follow-up template must be active, enabled, and match the sequence channel.');
  }
  if (
    channel === 'whatsapp'
    && template.provider_status !== MESSAGE_TEMPLATE_PROVIDER_STATUSES.APPROVED
  ) {
    return block(FOLLOW_UP_BLOCK_CODES.TEMPLATE_NOT_APPROVED, 'WhatsApp follow-up templates must be provider approved.');
  }
  return null;
}

export function evaluateFollowUpStepEligibility({
  enrollment,
  sequence,
  step,
  contact,
  template,
  lastInboundAt = null,
  now = new Date(),
} = {}) {
  const channel = cleanLower(step?.channel || enrollment?.channel || sequence?.default_channel);
  const settingsJson = metadataJson(sequence);
  const reasons = [];

  if (!isSupportedFollowUpSequenceChannel(channel)) {
    reasons.push(block(FOLLOW_UP_BLOCK_CODES.CHANNEL_UNSUPPORTED, 'Follow-up sequences support Messenger and WhatsApp only.'));
  }
  if (sequence?.status !== FOLLOW_UP_SEQUENCE_STATUSES.ACTIVE || !sequence?.is_enabled) {
    reasons.push(block(FOLLOW_UP_BLOCK_CODES.SEQUENCE_NOT_ACTIVE, 'Follow-up sequence is not active and enabled.'));
  }
  if (step?.is_active === false) {
    reasons.push(block(FOLLOW_UP_BLOCK_CODES.STEP_NOT_ACTIVE, 'Follow-up sequence step is inactive.'));
  }
  if (enrollment?.status !== FOLLOW_UP_ENROLLMENT_STATUSES.ACTIVE) {
    reasons.push(block(FOLLOW_UP_BLOCK_CODES.ENROLLMENT_NOT_ACTIVE, 'Follow-up enrollment is not active.'));
  }
  if (contact?.is_do_not_call || contact?.isDoNotCall || contact?.is_wrong_number || contact?.isWrongNumber) {
    reasons.push(block(FOLLOW_UP_BLOCK_CODES.CONTACT_BLOCKED, 'Contact is marked do-not-call or wrong number.'));
  }
  if (Number(enrollment?.touch_count || 0) >= Number(enrollment?.max_touches || sequence?.max_touches || 1)) {
    reasons.push(block(FOLLOW_UP_BLOCK_CODES.MAX_TOUCHES_REACHED, 'Follow-up enrollment has reached its max touches.'));
  }
  if (isWithinFollowUpQuietHours({ now, settingsJson })) {
    reasons.push(block(FOLLOW_UP_BLOCK_CODES.QUIET_HOURS, 'Follow-up sequence is paused during configured quiet hours.'));
  }
  if (!normalizeDate(lastInboundAt)) {
    reasons.push(block(FOLLOW_UP_BLOCK_CODES.PRIOR_INBOUND_REQUIRED, 'A prior inbound conversation is required before sequence follow-up drafts.'));
  } else if (channel === 'messenger' && hoursSince(lastInboundAt, now) > FOLLOW_UP_SERVICE_WINDOW_HOURS) {
    reasons.push(block(FOLLOW_UP_BLOCK_CODES.MESSENGER_WINDOW_CLOSED, 'Messenger follow-up drafts require an open provider service window.'));
  }

  const needsDraft = [FOLLOW_UP_STEP_ACTIONS.DRAFT, FOLLOW_UP_STEP_ACTIONS.TASK_AND_DRAFT].includes(step?.action_type || step?.actionType);
  if (needsDraft) {
    const reason = templateBlock({ template, channel });
    if (reason) reasons.push(reason);
  }

  return {
    ok: reasons.length === 0,
    blocked: reasons.length > 0,
    reasons,
    deferUntil: reasons.some((reason) => reason.code === FOLLOW_UP_BLOCK_CODES.QUIET_HOURS)
      ? nextQuietHoursExit({ now, settingsJson })
      : null,
  };
}

function templateVariables(contact = {}) {
  return {
    contact_name: contact.name || '',
    name: contact.name || '',
    company_name: contact.company_name || contact.companyName || '',
  };
}

export function buildFollowUpDraftMessage({ enrollment, sequence, step, contact, template, now = new Date() }) {
  if (!template) return {};
  return {
    channel: step.channel || enrollment.channel,
    provider: 'meta',
    templateId: template.id,
    templatePurpose: template.purpose,
    templateDisplayName: template.display_name || template.displayName || '',
    textBody: renderManualTemplateBody(template.body_text || template.bodyText, templateVariables(contact)),
    reviewRequired: true,
    autoSendEnabled: false,
    sequenceId: sequence.id,
    enrollmentId: enrollment.id,
    stepId: step.id,
    preparedAt: now.toISOString(),
  };
}

function mapDueRow(row) {
  return {
    enrollment: {
      id: row.enrollment_id,
      organization_id: row.organization_id,
      business_unit_id: row.business_unit_id,
      sequence_id: row.sequence_id,
      contact_id: row.contact_id,
      lead_id: row.lead_id,
      status: row.enrollment_status,
      channel: row.enrollment_channel,
      owner_user_id: row.owner_user_id,
      next_step_position: row.next_step_position,
      next_step_due_at: row.next_step_due_at,
      touch_count: row.touch_count,
      max_touches: row.enrollment_max_touches,
    },
    sequence: {
      id: row.sequence_id,
      status: row.sequence_status,
      is_enabled: row.sequence_is_enabled,
      default_channel: row.default_channel,
      max_touches: row.sequence_max_touches,
      settings_json: row.sequence_settings_json || {},
    },
    step: {
      id: row.step_id,
      position: row.step_position,
      delay_minutes: row.delay_minutes,
      channel: row.step_channel,
      template_id: row.step_template_id,
      action_type: row.action_type,
      task_title: row.task_title,
      task_description: row.task_description,
      is_active: row.step_is_active,
    },
    contact: {
      id: row.contact_id,
      name: row.contact_name,
      company_name: row.company_name,
      is_do_not_call: row.is_do_not_call,
      is_wrong_number: row.is_wrong_number,
    },
    template: row.template_id ? {
      id: row.template_id,
      channel: row.template_channel,
      purpose: row.template_purpose,
      display_name: row.template_display_name,
      body_text: row.template_body_text,
      status: row.template_status,
      provider_status: row.template_provider_status,
      is_enabled: row.template_is_enabled,
      metadata_json: row.template_metadata_json || {},
    } : null,
    lastInboundAt: row.last_inbound_at,
  };
}

export async function listDueFollowUpSteps(client, {
  organizationId,
  businessUnitIds = null,
  now = new Date(),
  limit = 25,
} = {}) {
  const result = await client.query(
    `
      select
        e.id as enrollment_id,
        e.organization_id,
        e.business_unit_id,
        e.sequence_id,
        e.contact_id,
        e.lead_id,
        e.status as enrollment_status,
        e.channel as enrollment_channel,
        e.owner_user_id,
        e.next_step_position,
        e.next_step_due_at,
        e.touch_count,
        e.max_touches as enrollment_max_touches,
        s.status as sequence_status,
        s.is_enabled as sequence_is_enabled,
        s.default_channel,
        s.max_touches as sequence_max_touches,
        s.settings_json as sequence_settings_json,
        st.id as step_id,
        st.position as step_position,
        st.delay_minutes,
        st.channel as step_channel,
        st.template_id as step_template_id,
        st.action_type,
        st.task_title,
        st.task_description,
        st.is_active as step_is_active,
        c.name as contact_name,
        c.company_name,
        c.is_do_not_call,
        c.is_wrong_number,
        mt.channel as template_channel,
        mt.id as template_id,
        mt.purpose as template_purpose,
        mt.display_name as template_display_name,
        mt.body_text as template_body_text,
        mt.status as template_status,
        mt.provider_status as template_provider_status,
        mt.is_enabled as template_is_enabled,
        mt.metadata_json as template_metadata_json,
        max(cm.occurred_at) filter (where cm.direction = 'inbound' and cm.channel = st.channel) as last_inbound_at
      from follow_up_sequence_enrollments e
      join follow_up_sequences s on s.id = e.sequence_id and s.organization_id = e.organization_id
      join follow_up_sequence_steps st on st.sequence_id = s.id and st.position = e.next_step_position
      join contacts c on c.id = e.contact_id and c.organization_id = e.organization_id
      left join message_templates mt
        on mt.id = st.template_id
       and mt.organization_id = e.organization_id
       and (mt.business_unit_id is null or mt.business_unit_id = e.business_unit_id)
      left join conversation_messages cm
        on cm.organization_id = e.organization_id
       and cm.business_unit_id = e.business_unit_id
       and cm.contact_id = e.contact_id
      where e.organization_id = $1
        and e.status = 'active'
        and e.next_step_due_at <= $2
        and (e.paused_until is null or e.paused_until <= $2)
        and ($3::text[] is null or e.business_unit_id::text = any($3::text[]))
      group by e.id, s.id, st.id, c.id, mt.id
      order by e.next_step_due_at asc, e.created_at asc
      limit $4
    `,
    [organizationId, now, Array.isArray(businessUnitIds) ? businessUnitIds : null, limit],
  );
  return result.rows.map(mapDueRow);
}

async function createRun(client, { due, idempotencyKey, status, draftMessageJson = {}, blockedReason = null, now }) {
  const result = await client.query(
    `
      insert into follow_up_sequence_step_runs (
        organization_id,
        business_unit_id,
        sequence_id,
        enrollment_id,
        step_id,
        contact_id,
        lead_id,
        status,
        due_at,
        executed_at,
        idempotency_key,
        draft_message_json,
        blocked_reason,
        metadata_json
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      on conflict (organization_id, idempotency_key) do nothing
      returning id
    `,
    [
      due.enrollment.organization_id,
      due.enrollment.business_unit_id,
      due.enrollment.sequence_id,
      due.enrollment.id,
      due.step.id,
      due.enrollment.contact_id,
      due.enrollment.lead_id,
      status,
      due.enrollment.next_step_due_at,
      now,
      idempotencyKey,
      draftMessageJson,
      blockedReason,
      { source: FOLLOW_UP_SOURCE },
    ],
  );
  return result.rows[0] || null;
}

async function createReviewTask(client, { due, runId, draftMessageJson, now }) {
  const result = await client.query(
    `
      insert into tasks (
        organization_id,
        business_unit_id,
        contact_id,
        lead_id,
        title,
        description,
        task_type,
        status,
        priority,
        due_at,
        owner_user_id,
        created_by_user_id,
        source_type,
        source_id,
        source_label,
        metadata_json
      )
      values ($1,$2,$3,$4,$5,$6,'follow_up','open','medium',$7,$8,$9,$10,$11,$12,$13)
      returning id
    `,
    [
      due.enrollment.organization_id,
      due.enrollment.business_unit_id,
      due.enrollment.contact_id,
      due.enrollment.lead_id,
      due.step.task_title,
      due.step.task_description || 'Review the prepared follow-up draft before sending.',
      now,
      due.enrollment.owner_user_id,
      due.enrollment.owner_user_id,
      FOLLOW_UP_SOURCE,
      runId,
      `Follow-up sequence step ${due.step.position}`,
      {
        sequenceId: due.sequence.id,
        enrollmentId: due.enrollment.id,
        stepId: due.step.id,
        draftMessage: draftMessageJson,
        autoSendEnabled: false,
      },
    ],
  );
  return result.rows[0]?.id || null;
}

async function updateRunTask(client, { runId, taskId, organizationId }) {
  if (!taskId) return;
  await client.query(
    `
      update follow_up_sequence_step_runs
      set task_id = $1, updated_at = now()
      where id = $2 and organization_id = $3
    `,
    [taskId, runId, organizationId],
  );
}

async function advanceEnrollment(client, { due, now }) {
  const nextPosition = Number(due.step.position) + 1;
  const nextStep = await client.query(
    `
      select id, delay_minutes
      from follow_up_sequence_steps
      where sequence_id = $1
        and organization_id = $2
        and position = $3
        and is_active = true
      limit 1
    `,
    [due.sequence.id, due.enrollment.organization_id, nextPosition],
  );

  if (!nextStep.rows[0]) {
    await client.query(
      `
        update follow_up_sequence_enrollments
        set status = 'completed',
            touch_count = touch_count + 1,
            next_step_position = $1,
            updated_at = now()
        where id = $2 and organization_id = $3
      `,
      [nextPosition, due.enrollment.id, due.enrollment.organization_id],
    );
    return { completed: true };
  }

  await client.query(
    `
      update follow_up_sequence_enrollments
      set touch_count = touch_count + 1,
          next_step_position = $1,
          next_step_due_at = $2,
          updated_at = now()
      where id = $3 and organization_id = $4
    `,
    [
      nextPosition,
      addMinutes(now, nextStep.rows[0].delay_minutes),
      due.enrollment.id,
      due.enrollment.organization_id,
    ],
  );
  return { completed: false };
}

async function stopEnrollment(client, { due, reason }) {
  await client.query(
    `
      update follow_up_sequence_enrollments
      set status = 'stopped',
          stopped_at = now(),
          stop_reason = $1,
          updated_at = now()
      where id = $2 and organization_id = $3
    `,
    [reason, due.enrollment.id, due.enrollment.organization_id],
  );
}

async function deferEnrollment(client, { due, deferUntil }) {
  await client.query(
    `
      update follow_up_sequence_enrollments
      set next_step_due_at = $1,
          updated_at = now()
      where id = $2 and organization_id = $3
    `,
    [deferUntil, due.enrollment.id, due.enrollment.organization_id],
  );
}

export async function executeDueFollowUpSteps(client, {
  organizationId,
  businessUnitIds = null,
  now = new Date(),
  limit = 25,
} = {}) {
  const dueSteps = await listDueFollowUpSteps(client, { organizationId, businessUnitIds, now, limit });
  const results = [];

  for (const due of dueSteps) {
    const idempotencyKey = `${due.enrollment.id}:${due.step.id}:${normalizeDate(due.enrollment.next_step_due_at)?.toISOString() || ''}`;
    const eligibility = evaluateFollowUpStepEligibility({
      enrollment: due.enrollment,
      sequence: due.sequence,
      step: due.step,
      contact: due.contact,
      template: due.template,
      lastInboundAt: due.lastInboundAt,
      now,
    });

    if (!eligibility.ok) {
      const codes = eligibility.reasons.map((reason) => reason.code);
      if (eligibility.deferUntil && codes.length === 1) {
        await deferEnrollment(client, { due, deferUntil: eligibility.deferUntil });
        results.push({ enrollmentId: due.enrollment.id, deferred: true, deferUntil: eligibility.deferUntil, reasons: eligibility.reasons });
        continue;
      }

      const result = await withTransaction(client, async () => {
        const run = await createRun(client, {
          due,
          idempotencyKey,
          status: FOLLOW_UP_STEP_RUN_STATUSES.BLOCKED,
          blockedReason: codes.join(','),
          now,
        });
        if (run && (codes.includes(FOLLOW_UP_BLOCK_CODES.CONTACT_BLOCKED) || codes.includes(FOLLOW_UP_BLOCK_CODES.MAX_TOUCHES_REACHED))) {
          await stopEnrollment(client, { due, reason: codes.join(',') });
        }
        return {
          enrollmentId: due.enrollment.id,
          runId: run?.id || null,
          blocked: true,
          duplicate: !run,
          reasons: eligibility.reasons,
        };
      });
      results.push(result);
      continue;
    }

    const draftMessageJson = buildFollowUpDraftMessage({
      enrollment: due.enrollment,
      sequence: due.sequence,
      step: due.step,
      contact: due.contact,
      template: due.template,
      now,
    });
    const result = await withTransaction(client, async () => {
      const run = await createRun(client, {
        due,
        idempotencyKey,
        status: FOLLOW_UP_STEP_RUN_STATUSES.CREATED,
        draftMessageJson,
        now,
      });

      if (!run) {
        return { enrollmentId: due.enrollment.id, duplicate: true };
      }

      let taskId = null;
      if ([FOLLOW_UP_STEP_ACTIONS.TASK, FOLLOW_UP_STEP_ACTIONS.TASK_AND_DRAFT].includes(due.step.action_type)) {
        taskId = await createReviewTask(client, { due, runId: run.id, draftMessageJson, now });
        await updateRunTask(client, {
          runId: run.id,
          taskId,
          organizationId: due.enrollment.organization_id,
        });
      }
      const advance = await advanceEnrollment(client, { due, now });
      return {
        enrollmentId: due.enrollment.id,
        runId: run.id,
        taskId,
        draftCreated: Boolean(draftMessageJson.templateId),
        completed: advance.completed,
      };
    });
    results.push(result);
  }

  return { processed: results.length, results };
}

async function resolveEnrollmentOwnerUserId(client, {
  organizationId,
  businessUnitId,
  ownerUserId,
  actorUserId = null,
}) {
  const requestedOwnerId = ownerUserId || actorUserId || null;
  if (!requestedOwnerId) return null;

  const result = await client.query(
    `
      select u.id
      from users u
      where u.id = $1
        and u.organization_id = $2
        and u.is_active = true
        and (
          exists (
            select 1
            from business_unit_memberships bum
            where bum.user_id = u.id
              and bum.business_unit_id = $3
          )
          or exists (
            select 1
            from user_roles ur
            join role_permissions rp on rp.role_id = ur.role_id
            join permissions p on p.id = rp.permission_id
            where ur.user_id = u.id
              and p.key = 'business_units:all'
          )
        )
      limit 1
    `,
    [requestedOwnerId, organizationId, businessUnitId],
  );

  if (!result.rows[0]) {
    const error = new Error('Sequence owner must be an active organization user with access to the enrollment business unit.');
    error.status = 403;
    throw error;
  }

  return result.rows[0].id;
}

export async function enrollContactInFollowUpSequence(client, {
  organizationId,
  businessUnitId,
  sequence,
  firstStep = null,
  contactId,
  actorUserId,
  values = {},
  now = new Date(),
}) {
  const draft = normalizeFollowUpEnrollmentDraft(values, { now, sequence, firstStep });
  const ownerUserId = await resolveEnrollmentOwnerUserId(client, {
    organizationId,
    businessUnitId,
    ownerUserId: draft.ownerUserId || actorUserId || null,
    actorUserId,
  });
  const result = await client.query(
    `
      insert into follow_up_sequence_enrollments (
        organization_id,
        business_unit_id,
        sequence_id,
        contact_id,
        lead_id,
        status,
        channel,
        owner_user_id,
        enrolled_by_user_id,
        trigger_type,
        next_step_position,
        next_step_due_at,
        max_touches,
        metadata_json
      )
      values ($1,$2,$3,$4,$5,'active',$6,$7,$8,$9,$10,$11,$12,$13)
      on conflict (organization_id, sequence_id, contact_id) where status = 'active'
      do update set updated_at = follow_up_sequence_enrollments.updated_at
      returning id, next_step_due_at, (xmax = 0) as inserted
    `,
    [
      organizationId,
      businessUnitId,
      sequence.id,
      contactId,
      draft.leadId,
      draft.channel,
      ownerUserId,
      actorUserId || null,
      draft.triggerType,
      draft.nextStepPosition,
      draft.nextStepDueAt,
      draft.maxTouches,
      draft.metadataJson,
    ],
  );
  return result.rows[0];
}
