import { createInboundLeadNotification } from '../notifications/service.js';
import { createInboundLeadIntakeTask } from '../tasks/intake.js';

const FOLLOW_UP_EVENTS = new Set(['placement_completed', 'advisor_handoff_requested']);

// This is intentionally separate from website-lead import promotion. A launch
// event is a timeline fact, not a new form submission. The transaction lock
// makes acknowledgement/replay safe even though the legacy import tables do not
// have a suitable event-id uniqueness constraint.
export async function ingestAitUsaCrmEvent(client, { organizationId, businessUnitId, event }) {
  const eventKey = event.idempotencyKey;
  await client.query('begin');
  try {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`aitusa-crm-event:${organizationId}:${eventKey}`]);
    const prior = await client.query(
      `select contact_id, lead_id from activity_events
       where organization_id = $1 and metadata_json->>'aitusa_event_idempotency_key' = $2
       order by occurred_at desc limit 1`,
      [organizationId, eventKey],
    );
    if (prior.rows[0]?.contact_id) {
      await client.query('commit');
      return { acknowledged: true, duplicate: true, contactId: prior.rows[0].contact_id, leadId: prior.rows[0].lead_id || null };
    }

    const contact = event.contact || {};
    const contactIdentity = contactIdentityLockKey(contact);
    if (contactIdentity) {
      await client.query(
        'select pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`aitusa-crm-contact:${organizationId}:${contactIdentity}`],
      );
    }
    const contactId = await upsertEventContact(client, { organizationId, businessUnitId, contact });
    let leadId = await findExistingEventLead(client, { organizationId, contactId });
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
    return { acknowledged: true, duplicate: false, contactId, leadId };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

function contactIdentityLockKey(contact) {
  const email = typeof contact.email === 'string' ? contact.email.trim().toLowerCase() : '';
  if (email) return `email:${email}`;
  const phone = typeof contact.phone === 'string' ? contact.phone.replace(/[^0-9+]/g, '') : '';
  return phone ? `phone:${phone}` : null;
}

async function upsertEventContact(client, { organizationId, businessUnitId, contact }) {
  const found = await client.query(
    `select id from contacts where organization_id = $1 and
      ((nullif($2, '') is not null and lower(email) = lower($2)) or (nullif($3, '') is not null and regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g') = $3))
     order by updated_at desc limit 1`,
    [organizationId, contact.email || '', contact.phone || ''],
  );
  if (found.rows[0]?.id) {
    await client.query(
      `update contacts set name = coalesce(nullif($2, ''), name), email = coalesce(nullif($3, ''), email), phone = coalesce(nullif($4, ''), phone), updated_at = now() where id = $1`,
      [found.rows[0].id, contact.firstName || '', contact.email || '', contact.phone || ''],
    );
    return found.rows[0].id;
  }
  const inserted = await client.query(
    `insert into contacts (organization_id, primary_business_unit_id, name, email, phone, source_label)
     values ($1, $2, $3, nullif($4, ''), nullif($5, ''), 'AIT USA Refresh') returning id`,
    [organizationId, businessUnitId, contact.firstName || 'AIT USA learner', contact.email || '', contact.phone || ''],
  );
  return inserted.rows[0]?.id || null;
}

async function findExistingEventLead(client, { organizationId, contactId }) {
  const existing = await client.query(
    `select id from leads where organization_id = $1 and contact_id = $2 order by created_at asc limit 1`,
    [organizationId, contactId],
  );
  if (existing.rows[0]?.id) return existing.rows[0].id;
  return null;
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
