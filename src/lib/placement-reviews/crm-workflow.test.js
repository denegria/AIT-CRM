import assert from 'node:assert/strict';
import test from 'node:test';
import {
  placementReviewHref,
  planPlacementReviewDelivery,
  recordPlacementReviewDeliveryOutcome,
  syncPlacementReviewWorkflow,
} from './crm-workflow.js';

function event(overrides = {}) {
  return {
    eventType: 'placement_review_created',
    correlationId: 'placement-correlation-0001',
    consent: { communicationPreference: 'sms', advisorContactEmail: true, serviceSms: false, marketingSms: false, phoneCall: false, whatsappContact: false, verifiedEmail: true, verifiedMobile: false },
    placement: {
      reviewId: 'placement-review-opaque-0001',
      resultId: 'placement-result-opaque-0001',
      attemptId: 'placement-attempt-opaque-0001',
      state: 'pending',
    },
    ...overrides,
  };
}

function client({ existingTask = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(statement, values = []) {
      const sql = String(statement).replace(/\s+/g, ' ').trim();
      calls.push({ sql, values });
      if (sql.includes("r.key = 'senior_coordinator'")) return { rows: [{ id: 'senior-aitusa', tier: 'senior_coordinator' }] };
      if (sql.includes("r.key = 'admin'")) return { rows: [] };
      if (sql.startsWith('select id, status, owner_user_id, due_at, metadata_json from tasks')) return { rows: existingTask ? [existingTask] : [] };
      if (sql.startsWith('insert into tasks')) return { rows: [{ id: 'task-placement-1', status: values[6] || 'open', owner_user_id: 'senior-aitusa', due_at: '2026-08-20T12:00:00.000Z' }] };
      if (sql.startsWith('update tasks')) return { rows: [{ id: existingTask?.id || 'task-placement-1', status: sql.includes("then 'open'") ? 'open' : 'completed', owner_user_id: 'senior-aitusa', due_at: '2026-08-20T12:00:00.000Z' }] };
      if (sql.startsWith('insert into notifications')) return { rows: [{ id: 'notification-placement-1' }] };
      return { rows: [] };
    },
  };
}

test('plans email as queued-only baseline and keeps SMS/WhatsApp provider dispatch disabled', () => {
  const outcomes = planPlacementReviewDelivery({
    placement: { correlationId: 'correlation-0001' },
    consent: { communicationPreference: 'sms', advisorContactEmail: true, verifiedEmail: true, verifiedMobile: true, serviceSms: true },
  });
  assert.deepEqual(outcomes, [
    { channel: 'email', status: 'queued', reason: 'verified_account_email_baseline', correlationId: 'correlation-0001' },
    { channel: 'sms', status: 'suppressed', reason: 'sms_provider_readiness_required', correlationId: 'correlation-0001' },
  ]);
  assert.equal(placementReviewHref('opaque-review-id'), '/employee/placement-reviews?review=opaque-review-id');
  const mobileMissing = planPlacementReviewDelivery({
    placement: { correlationId: 'correlation-0002' },
    consent: { communicationPreference: 'sms', advisorContactEmail: false, verifiedEmail: false, verifiedMobile: false, serviceSms: true },
  });
  assert.equal(mobileMissing.find((outcome) => outcome.channel === 'sms').reason, 'verified_mobile_required');
});

test('stale created or started events cannot regress a completed review, while additional review is the only reopen transition', async () => {
  const existingTask = {
    id: 'task-placement-1', status: 'completed', owner_user_id: 'senior-aitusa', due_at: '2026-08-20T12:00:00.000Z',
    metadata_json: { placementReview: { state: 'confirmed', deliveryOutcomes: [] } },
  };
  const db = client({ existingTask });
  const stale = await syncPlacementReviewWorkflow(db, {
    organizationId: 'org-1', businessUnitId: 'aitusa-1', contactId: null, leadId: null, event: event(),
  });
  assert.deepEqual(stale, { taskId: 'task-placement-1', taskStatus: 'completed', ownerUserId: 'senior-aitusa', action: 'ignored', stale: true });
  assert.equal(db.calls.some((call) => call.sql.startsWith('update tasks')), false);
});

test('sticky bounced, opt-out, and DNC outcomes cannot be silently re-queued', async () => {
  const existingTask = {
    id: 'task-placement-1', status: 'open', owner_user_id: 'senior-aitusa', due_at: '2026-08-20T12:00:00.000Z',
    metadata_json: { placementReview: { state: 'confirmed', deliveryOutcomes: [{ channel: 'email', status: 'bounced', reason: 'mailbox_unavailable', correlationId: 'placement-correlation-0001', deliveryId: null }] } },
  };
  const db = client({ existingTask });
  const result = await recordPlacementReviewDeliveryOutcome(db, {
    organizationId: 'org-1', businessUnitId: 'aitusa-1', reviewId: 'placement-review-opaque-0001',
    outcome: { channel: 'email', status: 'queued', correlationId: 'placement-correlation-0001' },
  });
  assert.equal(result.suppressed, true);
  assert.equal(db.calls.some((call) => call.sql.startsWith('update tasks')), false);
  assert.equal(db.calls.filter((call) => call.sql === 'begin').length, 1);
  assert.equal(db.calls.filter((call) => call.sql === 'commit').length, 1);
});

test('creates one dedicated, senior-assigned placement-review task and an opaque internal notification', async () => {
  const db = client();
  const result = await syncPlacementReviewWorkflow(db, {
    organizationId: 'org-1', businessUnitId: 'aitusa-1', contactId: 'contact-1', leadId: 'lead-1', event: event(),
  });
  assert.deepEqual(result, { taskId: 'task-placement-1', taskStatus: 'open', ownerUserId: 'senior-aitusa', action: 'create' });
  const taskInsert = db.calls.find((call) => call.sql.startsWith('insert into tasks'));
  assert.equal(taskInsert.values[4], 'Review placement result');
  assert.equal(taskInsert.values[9], 'review:placement-review-opaque-0001');
  const reviewLock = db.calls.find((call) => call.sql.includes('pg_advisory_xact_lock'));
  assert.deepEqual(reviewLock.values, ['aitusa-placement-review:org-1:aitusa-1:placement-review-opaque-0001']);
  const notification = db.calls.find((call) => call.sql.startsWith('insert into notifications'));
  assert.equal(notification.values[7], '/employee/placement-reviews?review=placement-review-opaque-0001');
  assert.equal(db.calls.some((call) => /telnyx|fetch|conversation_messages/i.test(call.sql)), false);
  const reviewerLookup = db.calls.find((call) => call.sql.includes("r.key = 'senior_coordinator'"));
  assert.match(reviewerLookup.sql, /bum\.business_unit_id = \$2/);
});

test('authoritative final decisions complete the exact review task and delivery failures reopen CRM work only', async () => {
  const existingTask = {
    id: 'task-placement-1', status: 'in_progress', owner_user_id: 'senior-aitusa', due_at: '2026-08-20T12:00:00.000Z',
    metadata_json: { placementReview: { state: 'in_review', deliveryOutcomes: [] } },
  };
  const db = client({ existingTask });
  const confirmed = await syncPlacementReviewWorkflow(db, {
    organizationId: 'org-1', businessUnitId: 'aitusa-1', contactId: 'contact-1', leadId: 'lead-1',
    event: event({ eventType: 'placement_review_confirmed', placement: { ...event().placement, state: 'confirmed', finalLevel: 'level-2' } }),
  });
  assert.equal(confirmed.action, 'complete');
  assert.equal(confirmed.taskStatus, 'completed');
  const recovered = await recordPlacementReviewDeliveryOutcome(db, {
    organizationId: 'org-1', businessUnitId: 'aitusa-1', reviewId: 'placement-review-opaque-0001',
    outcome: { channel: 'email', status: 'bounced', correlationId: 'placement-correlation-0001', reason: 'mailbox_unavailable' },
  });
  assert.equal(recovered.reopened, true);
  assert.equal(recovered.taskStatus, 'open');
  assert.equal(db.calls.some((call) => call.sql.includes('update leads')), false);
  assert.equal(db.calls.some((call) => /telnyx|send.*message|conversation_messages/i.test(call.sql)), false);
});

test('a final decision received after an earlier outbox retry gap still creates the exact task as completed', async () => {
  const db = client();
  const result = await syncPlacementReviewWorkflow(db, {
    organizationId: 'org-1', businessUnitId: 'aitusa-1', contactId: 'contact-1', leadId: 'lead-1',
    event: event({ eventType: 'placement_review_adjusted', placement: { ...event().placement, state: 'adjusted', finalLevel: 'level-3' } }),
  });
  assert.equal(result.action, 'complete');
  assert.equal(result.taskStatus, 'completed');
  const taskInsert = db.calls.find((call) => call.sql.startsWith('insert into tasks'));
  assert.equal(taskInsert.values[6], 'completed');
});

test('additional review reopens the same source-scoped task without a duplicate create', async () => {
  const db = client({ existingTask: {
    id: 'task-placement-1', status: 'completed', owner_user_id: 'senior-aitusa', due_at: '2026-08-20T12:00:00.000Z', metadata_json: { placementReview: { state: 'confirmed' } },
  } });
  const result = await syncPlacementReviewWorkflow(db, {
    organizationId: 'org-1', businessUnitId: 'aitusa-1', contactId: 'contact-1', leadId: 'lead-1',
    event: event({ eventType: 'placement_review_additional_review_required', placement: { ...event().placement, state: 'additional_review_required' } }),
  });
  assert.equal(result.action, 'reopen');
  assert.equal(db.calls.some((call) => call.sql.startsWith('insert into tasks')), false);
  assert.equal(db.calls.some((call) => call.sql.startsWith('update tasks')), true);
});
