import { createNotification } from '../notifications/service.js';

export const PLACEMENT_REVIEW_TASK_SOURCE_TYPE = 'aitusa_placement_review';
export const PLACEMENT_REVIEW_TASK_TITLE = 'Review placement result';
export const PLACEMENT_REVIEW_DELIVERY_STATUSES = Object.freeze([
  'queued', 'sent', 'delivered', 'failed', 'bounced', 'opted_out', 'suppressed',
]);

const REVIEW_EVENT_ACTIONS = Object.freeze({
  placement_review_created: 'create',
  placement_review_started: 'start',
  placement_review_confirmed: 'complete',
  placement_review_adjusted: 'complete',
  placement_review_additional_review_required: 'reopen',
});
const RECOVERABLE_DELIVERY_STATUSES = new Set(['failed', 'bounced', 'opted_out', 'suppressed']);
const FINAL_REVIEW_STATES = new Set(['confirmed', 'adjusted']);

function cleanText(value) {
  return String(value || '').trim();
}

function metadataJson(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function placementReviewTaskSourceId(reviewId) {
  return `review:${cleanText(reviewId)}`;
}

export function placementReviewHref(reviewId) {
  return `/employee/placement-reviews?review=${encodeURIComponent(cleanText(reviewId))}`;
}

export function planPlacementReviewDelivery({ placement = {}, consent = {} } = {}) {
  const preference = consent.communicationPreference || null;
  const correlationId = cleanText(placement.correlationId);
  const outcomes = [];
  if (consent.verifiedEmail === true && consent.advisorContactEmail === true) {
    outcomes.push({ channel: 'email', status: 'queued', reason: 'verified_account_email_baseline', correlationId });
  } else {
    outcomes.push({ channel: 'email', status: 'suppressed', reason: consent.verifiedEmail ? 'advisor_email_consent_required' : 'verified_account_email_required', correlationId });
  }
  if (preference === 'sms') {
    outcomes.push({
      channel: 'sms',
      status: 'suppressed',
      reason: consent.verifiedMobile !== true ? 'verified_mobile_required' : consent.serviceSms === true ? 'sms_provider_readiness_required' : 'service_sms_consent_required',
      correlationId,
    });
  }
  if (preference === 'whatsapp') {
    outcomes.push({ channel: 'whatsapp', status: 'suppressed', reason: 'automated_whatsapp_disabled', correlationId });
  }
  return outcomes;
}

export function validatePlacementReviewDeliveryOutcome(outcome = {}) {
  const status = cleanText(outcome.status).toLowerCase();
  const channel = cleanText(outcome.channel).toLowerCase();
  if (!PLACEMENT_REVIEW_DELIVERY_STATUSES.includes(status)) throw new Error('Unsupported placement-review delivery status.');
  if (!['email', 'sms', 'whatsapp'].includes(channel)) throw new Error('Unsupported placement-review delivery channel.');
  return {
    channel,
    status,
    reason: cleanText(outcome.reason) || null,
    correlationId: cleanText(outcome.correlationId) || null,
    deliveryId: cleanText(outcome.deliveryId) || null,
    occurredAt: outcome.occurredAt || new Date().toISOString(),
  };
}

async function findPlacementReviewAssignee(client, { organizationId, businessUnitId }) {
  const senior = await client.query(
    `select u.id, 'senior_coordinator' as tier
     from users u
     join user_roles ur on ur.user_id = u.id
     join roles r on r.id = ur.role_id
     join business_unit_memberships bum on bum.user_id = u.id
     where u.organization_id = $1 and u.is_active = true
       and r.organization_id = $1 and r.key = 'senior_coordinator'
       and bum.business_unit_id = $2
     order by bum.is_primary desc, u.id asc limit 1`,
    [organizationId, businessUnitId],
  );
  if (senior.rows[0]?.id) return senior.rows[0];
  const admin = await client.query(
    `select u.id, 'admin' as tier
     from users u
     join user_roles ur on ur.user_id = u.id
     join roles r on r.id = ur.role_id
     where u.organization_id = $1 and u.is_active = true
       and r.organization_id = $1 and r.key = 'admin'
     order by u.id asc limit 1`,
    [organizationId],
  );
  return admin.rows[0] || null;
}

async function findPlacementReviewTask(client, { organizationId, businessUnitId, reviewId }) {
  const result = await client.query(
    `select id, status, owner_user_id, due_at, metadata_json
     from tasks
     where organization_id = $1 and business_unit_id = $2
       and source_type = $3 and source_id = $4
     order by created_at desc limit 1 for update`,
    [organizationId, businessUnitId, PLACEMENT_REVIEW_TASK_SOURCE_TYPE, placementReviewTaskSourceId(reviewId)],
  );
  return result.rows[0] || null;
}

function taskMetadata({ event, reviewer, existing = null, plannedDelivery = null }) {
  const placement = event.placement || {};
  const prior = metadataJson(existing?.metadata_json || existing?.metadataJson);
  const currentDelivery = Array.isArray(prior.placementReview?.deliveryOutcomes)
    ? prior.placementReview.deliveryOutcomes
    : [];
  const nextDelivery = plannedDelivery || planPlacementReviewDelivery({
    placement: { ...placement, correlationId: event.correlationId },
    consent: event.consent,
  });
  return {
    ...prior,
    placementReview: {
      ...(prior.placementReview || {}),
      reviewId: placement.reviewId,
      resultId: placement.resultId,
      state: placement.state,
      attemptId: placement.attemptId,
      revision: placement.revision,
      finalLevel: placement.finalLevel || null,
      correlationId: event.correlationId,
      reviewerTier: reviewer?.tier || prior.placementReview?.reviewerTier || null,
      deliveryMode: 'queued_disabled',
      providerDispatch: 'disabled',
      deliveryOutcomes: mergeDeliveryOutcomes(currentDelivery, nextDelivery),
    },
  };
}

function mergeDeliveryOutcomes(current = [], next = []) {
  const latest = new Map();
  for (const outcome of current) {
    const normalized = validatePlacementReviewDeliveryOutcome(outcome);
    latest.set(`${normalized.channel}:${normalized.correlationId || ''}`, normalized);
  }
  for (const outcome of next) {
    const normalized = validatePlacementReviewDeliveryOutcome(outcome);
    const key = `${normalized.channel}:${normalized.correlationId || ''}`;
    const prior = latest.get(key);
    if (!isStickyDeliveryOutcome(prior)) latest.set(key, normalized);
  }
  return [...latest.values()];
}

function isStickyDeliveryOutcome(outcome = {}) {
  // Delivery recovery is explicit work. Do not let a later queued/sent update
  // erase any unresolved outcome; a human-safe correction must record a new
  // channel/correlation after resolving the original issue.
  return isUnresolvedDeliveryOutcome(outcome);
}

function isUnresolvedDeliveryOutcome(outcome = {}) {
  return RECOVERABLE_DELIVERY_STATUSES.has(outcome.status)
    || ['wrong_number', 'do_not_contact', 'dnc'].includes(cleanText(outcome.reason).toLowerCase());
}

function hasUnresolvedRecovery(existing = {}) {
  const metadata = metadataJson(existing.metadata_json || existing.metadataJson);
  return (metadata.placementReview?.deliveryOutcomes || []).some(isUnresolvedDeliveryOutcome);
}

function actionForEvent(eventType) {
  const action = REVIEW_EVENT_ACTIONS[eventType];
  if (!action) throw new Error('Unsupported placement-review event type.');
  return action;
}

function taskEventMessage(action) {
  if (action === 'complete') return 'Placement review decision acknowledged; task completed.';
  if (action === 'reopen') return 'Additional placement review required; task reopened.';
  if (action === 'start') return 'Placement review started.';
  if (action === 'recovery_open') return 'Placement decision acknowledged; delivery recovery remains open.';
  return 'Placement review task created.';
}

function transitionFor(existing = null, state, revision, plannedDelivery = []) {
  const deliveryNeedsRecovery = plannedDelivery.some(isUnresolvedDeliveryOutcome);
  if (!existing) {
    if (deliveryNeedsRecovery) return { action: 'recovery_open', taskStatus: 'open' };
    if (FINAL_REVIEW_STATES.has(state)) return { action: 'complete', taskStatus: 'completed' };
    if (state === 'in_review') return { action: 'start', taskStatus: 'in_progress' };
    return { action: state === 'additional_review_required' ? 'reopen' : 'create', taskStatus: 'open' };
  }
  const priorMetadata = metadataJson(existing.metadata_json).placementReview || {};
  const priorState = priorMetadata.state || null;
  const priorRevision = Number(priorMetadata.revision || 0);
  if (Number.isInteger(priorRevision) && priorRevision >= revision) return { action: 'ignored', taskStatus: existing.status };
  if (state === 'additional_review_required') return { action: 'reopen', taskStatus: 'open' };
  if (hasUnresolvedRecovery(existing) || deliveryNeedsRecovery) return { action: 'recovery_open', taskStatus: 'open' };
  if (FINAL_REVIEW_STATES.has(priorState)) return { action: 'ignored', taskStatus: existing.status };
  if ((priorState === 'in_review' || priorState === 'additional_review_required') && state === 'pending') return { action: 'ignored', taskStatus: existing.status };
  if (state === 'in_review') return { action: 'start', taskStatus: 'in_progress' };
  if (FINAL_REVIEW_STATES.has(state)) return { action: 'complete', taskStatus: 'completed' };
  return { action: 'ignored', taskStatus: existing.status };
}

async function insertTaskEvent(client, { task, organizationId, businessUnitId, action, metadata }) {
  await client.query(
    `insert into task_events
     (task_id, organization_id, business_unit_id, event_type, from_status, to_status, from_owner_user_id, to_owner_user_id, from_due_at, to_due_at, actor_user_id, message, metadata_json)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, null, $11, $12::jsonb)`,
    [
      task.id, organizationId, businessUnitId,
      action === 'complete' ? 'completed' : action === 'start' || action === 'reopen' ? 'started' : action === 'recovery_open' ? 'automation_action' : 'created',
      task.fromStatus || null, task.status, task.fromOwnerUserId || null, task.ownerUserId || null,
      task.fromDueAt || null, task.dueAt || null,
      taskEventMessage(action), JSON.stringify(metadata),
    ],
  );
}

async function notifyReviewer(client, { organizationId, businessUnitId, contactId, leadId, reviewId, reviewerId, action, correlationId }) {
  if (!reviewerId) return { inserted: false, reason: 'reviewer_missing' };
  return createNotification(client, {
    organizationId,
    businessUnitId,
    userId: reviewerId,
    type: 'placement_review',
    sourceType: PLACEMENT_REVIEW_TASK_SOURCE_TYPE,
    title: PLACEMENT_REVIEW_TASK_TITLE,
    body: action === 'complete' ? 'Placement decision acknowledged.' : 'Placement review needs attention.',
    href: placementReviewHref(reviewId),
    contactId,
    leadId,
    idempotencyKey: `placement-review:${reviewId}:${correlationId}:${action}`,
    metadataJson: { reviewId, correlationId, action },
  });
}

export async function syncPlacementReviewWorkflow(client, {
  organizationId,
  businessUnitId,
  contactId,
  leadId,
  event,
}) {
  const placement = event.placement || {};
  actionForEvent(event.eventType);
  await client.query(
    'select pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`aitusa-placement-review:${organizationId}:${businessUnitId}:${placement.reviewId}`],
  );
  const reviewer = await findPlacementReviewAssignee(client, { organizationId, businessUnitId });
  if (!reviewer?.id) throw new Error('No active AIT USA senior coordinator or administrator is available for placement review assignment.');

  const existing = await findPlacementReviewTask(client, { organizationId, businessUnitId, reviewId: placement.reviewId });
  const plannedDelivery = planPlacementReviewDelivery({
    placement: { ...placement, correlationId: event.correlationId },
    consent: event.consent,
  });
  const transition = transitionFor(existing, placement.state, placement.revision, plannedDelivery);
  const action = transition.action === 'ignored' ? 'ignored' : transition.action;
  const metadata = taskMetadata({ event, reviewer, existing, plannedDelivery });
  let task;
  if (!existing) {
    const initialStatus = transition.taskStatus;
    const created = await client.query(
      `insert into tasks
       (organization_id, business_unit_id, contact_id, lead_id, title, description, task_type, status, priority, due_at, completed_at, owner_user_id, created_by_user_id, source_type, source_id, source_label, metadata_json)
       values ($1, $2, $3, $4, $5, $6, 'follow_up', $7, 'high', now(), case when $7 = 'completed' then now() else null end, $8, null, $9, $10, $11, $12::jsonb)
       returning id, status, owner_user_id, due_at`,
      [organizationId, businessUnitId, contactId, leadId, PLACEMENT_REVIEW_TASK_TITLE,
        'Review the placement result in the AIT USA employee queue.', initialStatus, reviewer.id,
        PLACEMENT_REVIEW_TASK_SOURCE_TYPE, placementReviewTaskSourceId(placement.reviewId), 'AIT USA placement review', JSON.stringify(metadata)],
    );
    task = { ...created.rows[0], ownerUserId: created.rows[0]?.owner_user_id, dueAt: created.rows[0]?.due_at, fromStatus: null };
    if (!task.id) throw new Error('Unable to create placement review task.');
  } else {
    if (action === 'ignored') return { taskId: existing.id, taskStatus: existing.status, ownerUserId: existing.owner_user_id || null, action, stale: true };
    const nextStatus = transition.taskStatus;
    const updated = await client.query(
      `update tasks set status = $2, owner_user_id = coalesce(owner_user_id, $3), due_at = case when $2 = 'completed' then due_at else now() end,
       completed_at = case when $2 = 'completed' then now() else null end, canceled_at = null, snoozed_until = null, metadata_json = $4::jsonb, updated_at = now()
       where id = $1 and organization_id = $5 returning id, status, owner_user_id, due_at`,
      [existing.id, nextStatus, reviewer.id, JSON.stringify(metadata), organizationId],
    );
    task = { ...updated.rows[0], ownerUserId: updated.rows[0]?.owner_user_id, dueAt: updated.rows[0]?.due_at, fromStatus: existing.status, fromOwnerUserId: existing.owner_user_id, fromDueAt: existing.due_at };
    if (!task.id) throw new Error('Placement review task was not available for update.');
  }
  await insertTaskEvent(client, { task, organizationId, businessUnitId, action, metadata });
  await notifyReviewer(client, { organizationId, businessUnitId, contactId, leadId, reviewId: placement.reviewId, reviewerId: task.ownerUserId, action, correlationId: event.correlationId });
  return { taskId: task.id, taskStatus: task.status, ownerUserId: task.ownerUserId, action };
}

// This service is intentionally transport-free. A future authenticated callback
// route may call it after provider evidence arrives; it never changes academic
// state and reopens only CRM work for recoverable delivery outcomes.
export async function recordPlacementReviewDeliveryOutcome(client, {
  organizationId,
  businessUnitId,
  reviewId,
  outcome,
}) {
  const normalized = validatePlacementReviewDeliveryOutcome(outcome);
  await client.query('begin');
  try {
    await client.query(
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`aitusa-placement-review:${organizationId}:${businessUnitId}:${reviewId}`],
    );
    const task = await findPlacementReviewTask(client, { organizationId, businessUnitId, reviewId });
    if (!task) throw new Error('Placement review task was not found.');
    const prior = metadataJson(task.metadata_json);
    const existingOutcomes = prior.placementReview?.deliveryOutcomes || [];
    const deliveryKey = `${normalized.channel}:${normalized.correlationId || ''}`;
    const current = existingOutcomes.find((item) => `${item.channel}:${item.correlationId || ''}` === deliveryKey);
    if (current?.status === normalized.status && current?.reason === normalized.reason && current?.deliveryId === normalized.deliveryId) {
      await client.query('commit');
      return { taskId: task.id, taskStatus: task.status, reopened: false, duplicate: true, outcome: current };
    }
    if (isStickyDeliveryOutcome(current) && !isStickyDeliveryOutcome(normalized)) {
      await client.query('commit');
      return { taskId: task.id, taskStatus: task.status, reopened: false, suppressed: true, outcome: current };
    }
    const metadata = {
      ...prior,
      placementReview: {
        ...(prior.placementReview || {}),
        deliveryOutcomes: mergeDeliveryOutcomes(existingOutcomes, [normalized]),
      },
    };
    const reopen = isUnresolvedDeliveryOutcome(normalized);
    const updated = await client.query(
      `update tasks set status = case when $2 then 'open' else status end,
         completed_at = case when $2 then null else completed_at end,
         due_at = case when $2 then now() else due_at end,
         metadata_json = $3::jsonb, updated_at = now()
       where id = $1 and organization_id = $4 returning id, status, owner_user_id, due_at`,
      [task.id, reopen, JSON.stringify(metadata), organizationId],
    );
    const next = updated.rows[0];
    if (!next?.id) throw new Error('Placement review delivery outcome was not recorded.');
    await client.query(
      `insert into task_events
       (task_id, organization_id, business_unit_id, event_type, from_status, to_status, from_owner_user_id, to_owner_user_id, from_due_at, to_due_at, actor_user_id, message, metadata_json)
       values ($1, $2, $3, 'automation_action', $4, $5, $6, $6, $7, $8, null, $9, $10::jsonb)`,
      [task.id, organizationId, businessUnitId, task.status, next.status, task.owner_user_id || null, task.due_at || null, next.due_at || null,
        `Placement review delivery ${normalized.status}.`, JSON.stringify({ placementReviewDelivery: normalized })],
    );
    await client.query('commit');
    return { taskId: next.id, taskStatus: next.status, reopened: reopen, outcome: normalized };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}
