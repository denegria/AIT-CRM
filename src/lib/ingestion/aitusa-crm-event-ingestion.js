import { createInboundLeadNotification } from '../notifications/service.js';
import { createInboundLeadIntakeTask } from '../tasks/intake.js';
import { classifyContactIdentity } from '../crm/contact-identity.js';
import { resolveAitUsaActiveOpportunity } from '../crm/ait-usa-opportunities.js';
import { isAitUsaPlacementReviewEvent } from './aitusa-crm-events.js';
import { syncPlacementReviewWorkflow } from '../placement-reviews/crm-workflow.js';

const FOLLOW_UP_EVENTS = new Set(['placement_completed', 'advisor_handoff_requested']);
const AITUSA_CRM_REVIEW_BATCH_SOURCE_NAME = 'AIT USA Refresh Events';
const AITUSA_CRM_REVIEW_BATCH_SOURCE_TYPE = 'aitusa_crm_event';
const AITUSA_CRM_REVIEW_SOURCE_SHEET = 'aitusa_crm_event';
const AITUSA_CRM_REVIEW_FILE_NAME = 'aitusa-crm-event-identity-review';
const AITUSA_CRM_REVIEW_TYPE = 'aitusa_crm_identity_review';

// This is intentionally separate from website-lead import promotion. A launch
// event is a timeline fact, not a new form submission. The transaction lock
// makes acknowledgement/replay safe even though the legacy import tables do not
// have a suitable event-id uniqueness constraint.
export async function ingestAitUsaCrmEvent(client, { organizationId, businessUnitId, businessUnit: preparedBusinessUnit = null, event }) {
  const eventKey = event.idempotencyKey;
  await client.query('begin');
  try {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`aitusa-crm-event:${organizationId}:${eventKey}`]);
    const prior = await client.query(
      `select contact_id, lead_id, metadata_json from activity_events
       where organization_id = $1 and metadata_json->>'aitusa_event_idempotency_key' = $2
       order by occurred_at desc limit 1`,
      [organizationId, eventKey],
    );
    if (prior.rows[0]) {
      await client.query('commit');
      return {
        acknowledged: true,
        duplicate: true,
        review: priorIdentityReview(prior.rows[0]),
        contactId: prior.rows[0].contact_id || null,
        leadId: prior.rows[0].lead_id || null,
      };
    }

    if (isAitUsaPlacementReviewEvent(event)) {
      const linkedScope = await resolvePlacementReviewCrmScope(client, {
        organizationId,
        businessUnitId,
        correlationId: event.correlationId,
      });
      const metadata = safeEventMetadata(event);
      await client.query(
        `insert into activity_events
         (organization_id, business_unit_id, contact_id, lead_id, event_type, message, metadata_json, occurred_at)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)`,
        [organizationId, businessUnitId, linkedScope.contactId, linkedScope.leadId, `aitusa.${event.eventType}`, safeTimelineMessage(event), JSON.stringify(metadata), event.occurredAt],
      );
      const placementReview = await syncPlacementReviewWorkflow(client, {
        organizationId,
        businessUnitId,
        contactId: linkedScope.contactId,
        leadId: linkedScope.leadId,
        event,
      });
      await client.query('commit');
      return { acknowledged: true, duplicate: false, ...linkedScope, placementReview };
    }

    const contact = event.contact || {};
    for (const contactIdentity of contactIdentityLockKeys(contact)) {
      await client.query(
        'select pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`aitusa-crm-contact:${organizationId}:${contactIdentity}`],
      );
    }
    const identity = await classifyContactIdentity(client, {
      organizationId,
      email: contact.email,
      phone: contact.phone,
    });
    const identityReviewReason = contactIdentityReviewReason(identity);
    if (identityReviewReason) {
      const reviewRecord = await recordContactIdentityReview(client, {
        organizationId,
        businessUnitId,
        event,
        identity,
        reason: identityReviewReason,
      });
      await client.query('commit');
      return {
        acknowledged: true,
        duplicate: false,
        review: true,
        contactId: null,
        leadId: null,
        identity,
        reviewRecord,
      };
    }
    const businessUnit = preparedBusinessUnit || { id: businessUnitId, name: 'AIT USA Institute' };
    const existingLead = identity.status === 'exact'
      ? await resolveAitUsaActiveOpportunity({
          client,
          organization: organizationId,
          businessUnit,
          contact: identity.contactId,
        })
      : { status: 'none', leadId: null };
    if (existingLead.status === 'ambiguous') {
      const reviewRecord = await recordContactIdentityReview(client, {
        organizationId,
        businessUnitId,
        event,
        identity,
        reason: 'multiple_active_opportunities',
      });
      await client.query('commit');
      return {
        acknowledged: true,
        duplicate: false,
        review: true,
        contactId: null,
        leadId: null,
        identity,
        reviewRecord,
      };
    }
    const contactId = await upsertEventContact(client, { organizationId, businessUnitId, contact, identity });
    if (!contactId) {
      const reviewRecord = await recordContactIdentityReview(client, {
        organizationId,
        businessUnitId,
        event,
        identity,
        reason: 'exact_contact_not_available_for_organization',
      });
      await client.query('commit');
      return {
        acknowledged: true,
        duplicate: false,
        review: true,
        contactId: null,
        leadId: null,
        identity,
        reviewRecord,
      };
    }
    let leadId = existingLead.leadId;
    if (!leadId && FOLLOW_UP_EVENTS.has(event.eventType)) {
      leadId = await createEventLead(client, { organizationId, businessUnitId, contactId, event });
    }
    const metadata = safeEventMetadata(event);
    await client.query(
      `insert into activity_events
       (organization_id, business_unit_id, contact_id, lead_id, event_type, message, metadata_json, occurred_at)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)`,
      [organizationId, businessUnitId, contactId, leadId, `aitusa.${event.eventType}`, safeTimelineMessage(event), JSON.stringify(metadata), event.occurredAt],
    );

    if (FOLLOW_UP_EVENTS.has(event.eventType)) {
      const followUpKey = `aitusa:${event.correlationId}:follow-up`;
      await createInboundLeadNotification(client, {
        organizationId, businessUnitId, contactId, leadId,
        idempotencyKey: followUpKey,
        sourceName: 'AIT USA Refresh',
        detail: event.eventType === 'advisor_handoff_requested' ? 'Advisor contact requested.' : 'Placement result completed.',
      });
      await createInboundLeadIntakeTask(client, {
        organizationId, businessUnitId, contactId, leadId,
        idempotencyKey: followUpKey,
        sourceName: 'AIT USA Refresh',
        detail: event.eventType === 'advisor_handoff_requested' ? 'Advisor contact requested.' : 'Placement result completed.',
        metadata: { correlationId: event.correlationId, eventType: event.eventType },
      });
    }
    await client.query('commit');
    return { acknowledged: true, duplicate: false, contactId, leadId, placementReview: null };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

async function resolvePlacementReviewCrmScope(client, { organizationId, businessUnitId, correlationId }) {
  const linked = await client.query(
    `select contact_id, lead_id from activity_events
     where organization_id = $1 and business_unit_id = $2
       and metadata_json->>'correlationId' = $3
       and (contact_id is not null or lead_id is not null)
     order by (lead_id is not null) desc, occurred_at desc limit 1`,
    [organizationId, businessUnitId, correlationId],
  );
  return {
    contactId: linked.rows[0]?.contact_id || null,
    leadId: linked.rows[0]?.lead_id || null,
  };
}

function priorIdentityReview(prior) {
  const metadata = typeof prior.metadata_json === 'string'
    ? JSON.parse(prior.metadata_json)
    : prior.metadata_json;
  return Boolean(metadata?.contactIdentity?.reason);
}

function contactIdentityLockKeys(contact) {
  const email = typeof contact.email === 'string' ? contact.email.trim().toLowerCase() : '';
  const phone = typeof contact.phone === 'string' ? contact.phone.replace(/[^0-9+]/g, '') : '';
  return [
    email ? `email:${email}` : null,
    phone ? `phone:${phone}` : null,
  ].filter(Boolean).sort();
}

function contactIdentityReviewReason(identity) {
  if (identity.status === 'ambiguous') return identity.reason;
  if (!identity.evidence?.email && !identity.evidence?.phone) return 'no_usable_contact_identity';
  return null;
}

async function recordContactIdentityReview(client, { organizationId, businessUnitId, event, identity, reason }) {
  const metadata = {
    ...safeEventMetadata(event),
    contactIdentity: {
      status: identity.status,
      reason,
      matches: identity.matches,
    },
  };
  await client.query(
    `insert into activity_events
     (organization_id, business_unit_id, contact_id, lead_id, event_type, message, metadata_json, occurred_at)
     values ($1, $2, null, null, $3, $4, $5::jsonb, $6::timestamptz)`,
    [
      organizationId,
      businessUnitId,
      `aitusa.${event.eventType}`,
      `${safeTimelineMessage(event)} | contact_identity_review:${reason}`,
      JSON.stringify(metadata),
      event.occurredAt,
    ],
  );

  return persistAitUsaIdentityImportReview(client, {
    organizationId,
    businessUnitId,
    event,
    identity,
    reason,
  });
}

async function persistAitUsaIdentityImportReview(client, {
  organizationId,
  businessUnitId,
  event,
  identity,
  reason,
}) {
  await client.query(
    'select pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`aitusa-crm-review-batch:${organizationId}:${businessUnitId}`],
  );
  const batch = await client.query(
    `select id from import_batches
     where organization_id = $1 and business_unit_id = $2 and source_type = $3 and file_name = $4
     order by created_at desc limit 1 for update`,
    [organizationId, businessUnitId, AITUSA_CRM_REVIEW_BATCH_SOURCE_TYPE, AITUSA_CRM_REVIEW_FILE_NAME],
  );
  let batchId = batch.rows[0]?.id || null;
  if (!batchId) {
    const created = await client.query(
      `insert into import_batches
       (organization_id, business_unit_id, source_name, source_type, file_name, sheet_name, status)
       values ($1, $2, $3, $4, $5, $6, 'staging') returning id`,
      [
        organizationId,
        businessUnitId,
        AITUSA_CRM_REVIEW_BATCH_SOURCE_NAME,
        AITUSA_CRM_REVIEW_BATCH_SOURCE_TYPE,
        AITUSA_CRM_REVIEW_FILE_NAME,
        AITUSA_CRM_REVIEW_SOURCE_SHEET,
      ],
    );
    batchId = created.rows[0]?.id || null;
  }
  if (!batchId) throw new Error('Unable to create AIT USA identity review batch.');

  await client.query('select id from import_batches where id = $1 for update', [batchId]);
  const rowNumberResult = await client.query(
    'select coalesce(max(source_row_number), 0)::int as max_row from import_source_rows where import_batch_id = $1',
    [batchId],
  );
  const rowNumber = Number(rowNumberResult.rows[0]?.max_row || 0) + 1;
  const reviewEvidence = {
    email: identity.evidence?.email || null,
    phone: identity.evidence?.phone || null,
    matches: identity.matches || { email: [], phone: [] },
    reason,
  };
  const rawValues = {
    source: AITUSA_CRM_REVIEW_BATCH_SOURCE_TYPE,
    event_id: event.eventId,
    idempotency_key: event.idempotencyKey,
    correlation_id: event.correlationId,
    event_type: event.eventType,
    occurred_at: event.occurredAt,
    contact_identity: reviewEvidence,
    metadata: safeEventMetadata(event),
  };
  const sourceRow = await client.query(
    `insert into import_source_rows
     (import_batch_id, source_sheet, source_row_number, raw_values_json, raw_text, parse_status)
     values ($1, $2, $3, $4::jsonb, $5, 'parsed') returning id`,
    [
      batchId,
      AITUSA_CRM_REVIEW_SOURCE_SHEET,
      rowNumber,
      JSON.stringify(rawValues),
      JSON.stringify(rawValues),
    ],
  );
  const sourceRowId = sourceRow.rows[0]?.id || null;
  if (!sourceRowId) throw new Error('Unable to create AIT USA identity review source row.');

  const proposedContact = {
    email: reviewEvidence.email,
    phone: reviewEvidence.phone,
    business_unit_id: businessUnitId,
    contact_id: null,
    identity_classification: {
      status: identity.status,
      reason,
      matches: reviewEvidence.matches,
    },
  };
  const proposedLead = {
    source_type: AITUSA_CRM_REVIEW_BATCH_SOURCE_TYPE,
    event_id: event.eventId,
    idempotency_key: event.idempotencyKey,
    event_type: event.eventType,
    correlation_id: event.correlationId,
    business_unit_id: businessUnitId,
    contact_id: null,
    lead_id: null,
  };
  const normalized = await client.query(
    `insert into import_normalized_records
     (import_batch_id, source_row_id, record_type, proposed_contact_json, proposed_lead_json, confidence_score, status)
     values ($1, $2, 'lead', $3::jsonb, $4::jsonb, $5, 'needs_review') returning id`,
    [batchId, sourceRowId, JSON.stringify(proposedContact), JSON.stringify(proposedLead), 0.25],
  );
  const normalizedRecordId = normalized.rows[0]?.id || null;
  if (!normalizedRecordId) throw new Error('Unable to create AIT USA identity review record.');

  const review = await client.query(
    `insert into import_review_items
     (import_batch_id, source_row_id, review_type, reason, review_status, proposed_resolution_json)
     values ($1, $2, $3, $4, 'pending', $5::jsonb) returning id`,
    [
      batchId,
      sourceRowId,
      AITUSA_CRM_REVIEW_TYPE,
      `AIT USA event identity needs review: ${reason}.`,
      JSON.stringify({
        action: 'review_contact_identity',
        normalizedRecordId,
        contactId: null,
        leadId: null,
        identityClassification: proposedContact.identity_classification,
      }),
    ],
  );
  const reviewId = review.rows[0]?.id || null;
  if (!reviewId) throw new Error('Unable to create AIT USA identity review item.');
  return { batchId, sourceRowId, normalizedRecordId, reviewId };
}

async function upsertEventContact(client, { organizationId, businessUnitId, contact, identity }) {
  if (identity.status === 'exact') {
    const updated = await client.query(
      `update contacts set name = coalesce(nullif($3, ''), name), email = coalesce(nullif($4, ''), email), phone = coalesce(nullif($5, ''), phone), updated_at = now() where id = $1 and organization_id = $2 returning id`,
      [identity.contactId, organizationId, contact.firstName || '', contact.email || '', contact.phone || ''],
    );
    return updated.rows[0]?.id || null;
  }
  const inserted = await client.query(
    `insert into contacts (organization_id, primary_business_unit_id, name, email, phone, source_label)
     values ($1, $2, $3, nullif($4, ''), nullif($5, ''), 'AIT USA Refresh') returning id`,
    [organizationId, businessUnitId, contact.firstName || 'AIT USA learner', contact.email || '', contact.phone || ''],
  );
  return inserted.rows[0]?.id || null;
}

async function createEventLead(client, { organizationId, businessUnitId, contactId, event }) {
  const created = await client.query(
    `insert into leads (organization_id, business_unit_id, contact_id, source_type, source_name, status, current_stage, original_notes)
     values ($1, $2, $3, 'website_lead', 'AIT USA Refresh', 'New Lead', 'New Lead', $4) returning id`,
    [organizationId, businessUnitId, contactId, safeTimelineMessage(event)],
  );
  return created.rows[0]?.id || null;
}

function safeTimelineMessage(event) {
  const placement = event.placement || {};
  const practice = event.practice || {};
  return [
    `AIT USA ${event.eventType}`,
    placement.recommendedLevelKey ? `level:${placement.recommendedLevelKey}` : '',
    Number.isInteger(placement.answeredQuestionCount) ? `answered:${placement.answeredQuestionCount}` : '',
    practice.scenario ? `practice:${practice.scenario}` : '',
    Number.isInteger(practice.turnCount) ? `turns:${practice.turnCount}` : '',
  ].filter(Boolean).join(' | ');
}

function safeEventMetadata(event) {
  return {
    aitusa_event_idempotency_key: event.idempotencyKey,
    eventId: event.eventId,
    correlationId: event.correlationId,
    eventType: event.eventType,
    source: event.source,
    ageBand: event.ageBand || null,
    goalKeys: event.goalKeys || [],
    placement: event.placement || null,
    practice: event.practice || null,
    utm: event.utm || null,
    consent: event.consent || null,
  };
}
