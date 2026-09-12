import { contactIdentityLockKeys, classifyContactIdentity } from './contact-identity.js';
import { isActiveAitUsaOpportunity } from './ait-usa-opportunities.js';
import { verifyManualAitUsaConfirmation } from './manual-ait-usa-confirmation.js';
import { createHash } from 'node:crypto';

const GENERIC_REVIEW = 'This inquiry needs review before it can be added.';
const ACTIVE_CONFLICT = 'An active inquiry already exists for this contact. Review it before adding another inquiry.';
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/;

function camelContact(row = {}) {
  return {
    id: row.id,
    organizationId: row.organizationId || row.organization_id,
    primaryBusinessUnitId: row.primaryBusinessUnitId || row.primary_business_unit_id,
    name: row.name,
    email: row.email || null,
    phone: row.phone || null,
    address: row.address || null,
    sourceLabel: row.sourceLabel || row.source_label || null,
    createdAt: row.createdAt || row.created_at || null,
    updatedAt: row.updatedAt || row.updated_at || null,
  };
}

function camelLead(row = {}) {
  return {
    id: row.id,
    organizationId: row.organizationId || row.organization_id,
    businessUnitId: row.businessUnitId || row.business_unit_id,
    contactId: row.contactId || row.contact_id,
    sourceType: row.sourceType || row.source_type,
    sourceName: row.sourceName || row.source_name || null,
    status: row.status,
    currentStage: row.currentStage || row.current_stage || null,
    assignedUserId: row.assignedUserId || row.assigned_user_id || null,
    programInterest: row.programInterest || row.program_interest || null,
    preferredDay: row.preferredDay || row.preferred_day || null,
    preferredSchedule: row.preferredSchedule || row.preferred_schedule || null,
    locationPreference: row.locationPreference || row.location_preference || null,
    sourceDetail: row.sourceDetail || row.source_detail || null,
    createdAt: row.createdAt || row.created_at || null,
    updatedAt: row.updatedAt || row.updated_at || null,
  };
}

async function lock(client, key) {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
}

async function loadContact(client, organizationId, contactId) {
  const result = await client.query(
    'select * from contacts where id = $1 and organization_id = $2 limit 1',
    [contactId, organizationId],
  );
  return result.rows[0] ? camelContact(result.rows[0]) : null;
}

async function activeLeads(client, { organizationId, businessUnitId, contactId }) {
  const result = await client.query(
    `select * from leads where organization_id = $1 and business_unit_id = $2 and contact_id = $3
     order by created_at desc, id desc`,
    [organizationId, businessUnitId, contactId],
  );
  return result.rows.map(camelLead).filter(isActiveAitUsaOpportunity);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value ?? null;
}

export function manualAitUsaRequestFingerprint({ organizationId, businessUnitId, actorUserId, contactValues, leadValues, initialLeadStatusReason, initialNote }) {
  return createHash('sha256').update(JSON.stringify(canonical({
    organizationId, businessUnitId, actorUserId,
    contact: { ...contactValues, email: String(contactValues.email || '').trim().toLowerCase(), phone: String(contactValues.phone || '').replace(/[^0-9+]/g, '') },
    inquiry: leadValues,
    initialLeadStatusReason: initialLeadStatusReason || null,
    initialNote: initialNote?.body || null,
  }))).digest('hex');
}

async function replay(client, { organizationId, idempotencyKey, fingerprint }) {
  const result = await client.query(
    `select contact_id, lead_id, metadata_json from activity_events
     where organization_id = $1 and metadata_json->>'manual_ait_usa_inquiry_idempotency_key' = $2
     order by occurred_at desc, id desc limit 1`,
    [organizationId, idempotencyKey],
  );
  const row = result.rows[0];
  if (!row?.contact_id || !row?.lead_id) return null;
  const metadata = typeof row.metadata_json === 'string' ? JSON.parse(row.metadata_json) : (row.metadata_json || {});
  if (metadata.manual_ait_usa_inquiry_fingerprint !== fingerprint) return { changedPayload: true };
  const [contact, leadResult] = await Promise.all([
    loadContact(client, organizationId, row.contact_id),
    client.query('select * from leads where id = $1 and organization_id = $2 limit 1', [row.lead_id, organizationId]),
  ]);
  const lead = leadResult.rows[0] ? camelLead(leadResult.rows[0]) : null;
  return contact && lead ? { contact, lead } : null;
}

async function insertLead(client, { organizationId, businessUnitId, contactId, leadValues }) {
  const values = {
    organization_id: organizationId,
    business_unit_id: businessUnitId,
    contact_id: contactId,
    source_type: leadValues.sourceType,
    source_name: leadValues.sourceName,
    status: leadValues.status,
    current_stage: leadValues.currentStage,
    assigned_user_id: leadValues.assignedUserId,
    program_interest: leadValues.programInterest,
    preferred_day: leadValues.preferredDay,
    preferred_schedule: leadValues.preferredSchedule,
    test_interest: leadValues.testInterest,
    education_level: leadValues.educationLevel,
    school_name: leadValues.schoolName,
    location_preference: leadValues.locationPreference,
    profile_details: leadValues.profileDetails,
    source_detail: leadValues.sourceDetail,
  };
  const columns = Object.keys(values);
  const result = await client.query(
    `insert into leads (${columns.join(', ')}) values (${columns.map((_, index) => `$${index + 1}`).join(', ')}) returning *`,
    columns.map((column) => values[column] ?? null),
  );
  return camelLead(result.rows[0]);
}

async function insertContact(client, { organizationId, contactValues }) {
  const result = await client.query(
    `insert into contacts (organization_id, primary_business_unit_id, name, email, phone, address, source_label)
     values ($1, $2, $3, $4, $5, $6, $7) returning *`,
    [organizationId, contactValues.primaryBusinessUnitId, contactValues.name, contactValues.email, contactValues.phone, contactValues.address, contactValues.sourceLabel],
  );
  return camelContact(result.rows[0]);
}

async function recordReplay(client, { organizationId, businessUnitId, actorUserId, contactId, leadId, idempotencyKey, fingerprint }) {
  await client.query(
    `insert into activity_events (organization_id, business_unit_id, contact_id, lead_id, event_type, message, actor_user_id, metadata_json, occurred_at)
     values ($1, $2, $3, $4, 'manual_inquiry_created', 'Manual inquiry created.', $5, $6::jsonb, now())`,
    [organizationId, businessUnitId, contactId, leadId, actorUserId, JSON.stringify({ manual_ait_usa_inquiry_idempotency_key: idempotencyKey, manual_ait_usa_inquiry_fingerprint: fingerprint })],
  );
}

async function recordInitialContext(client, {
  organizationId, businessUnitId, actorUserId, contactId, lead, initialLeadStatusReason, initialNote,
}) {
  if (initialLeadStatusReason) {
    await client.query(
      `insert into lead_status_history (organization_id, business_unit_id, contact_id, lead_id, from_status, to_status, actor_user_id, reason, occurred_at)
       values ($1, $2, $3, $4, null, $5, $6, $7, now())`,
      [organizationId, businessUnitId, contactId, lead.id, lead.status, actorUserId, initialLeadStatusReason],
    );
  }
  if (initialNote?.body) {
    await client.query(
      `insert into notes (organization_id, business_unit_id, contact_id, body, author_user_id)
       values ($1, $2, $3, $4, $5)`,
      [organizationId, businessUnitId, contactId, initialNote.body, actorUserId],
    );
  }
}

/**
 * Atomic AIT USA manual-entry mechanic. The route supplies authorization and
 * lifecycle policy; this service owns locks, exact identity resolution and
 * inserts. It intentionally never returns inaccessible identity details.
 */
export async function submitManualAitUsaInquiry({
  pool,
  organizationId,
  businessUnitId,
  actorUserId,
  contactValues,
  leadValues,
  initialLeadStatusReason = null,
  initialNote = null,
  idempotencyKey = '',
  confirmationProof = '',
  confirmationEnv = process.env,
  authorizeExistingContact,
}) {
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw Object.assign(new Error('A bounded idempotency key is required.'), { status: 400 });
  const fingerprint = manualAitUsaRequestFingerprint({ organizationId, businessUnitId, actorUserId, contactValues, leadValues, initialLeadStatusReason, initialNote });
  const client = await pool.connect();
  try {
    await client.query('begin');
    await lock(client, `manual-ait-usa-inquiry:${organizationId}:${idempotencyKey}`);
    for (const identityKey of contactIdentityLockKeys(contactValues)) {
      await lock(client, `aitusa-crm-contact:${organizationId}:${identityKey}`);
    }

    const prior = await replay(client, { organizationId, idempotencyKey, fingerprint });
    if (prior?.changedPayload) {
      await client.query('commit');
      return { outcome: 'idempotency_conflict', error: 'This idempotency key was already used for a different inquiry.' };
    }
    if (prior) {
      if (!await authorizeExistingContact({ contact: prior.contact, activeLeads: [prior.lead] })) {
        await client.query('commit');
        return { outcome: 'review_required', error: GENERIC_REVIEW };
      }
      await client.query('commit');
      return { outcome: 'replayed', ...prior };
    }

    const identity = await classifyContactIdentity(client, { organizationId, ...contactValues });
    if (identity.status === 'ambiguous') {
      await client.query('commit');
      return { outcome: 'review_required', error: GENERIC_REVIEW };
    }

    let contact;
    let createdContact = false;
    if (identity.status === 'exact') {
      contact = await loadContact(client, organizationId, identity.contactId);
      if (contact) await lock(client, `ait-usa-opportunity:${organizationId}:${businessUnitId}:${contact.id}`);
      const existingActiveLeads = contact ? await activeLeads(client, { organizationId, businessUnitId, contactId: contact.id }) : [];
      if (!contact || !await authorizeExistingContact({ contact, activeLeads: existingActiveLeads })) {
        await client.query('commit');
        return { outcome: 'review_required', error: GENERIC_REVIEW };
      }
      if (!verifyManualAitUsaConfirmation(confirmationProof, {
        organizationId, actorUserId, businessUnitId, contactId: contact.id, contactValues,
      }, confirmationEnv)) {
        await client.query('commit');
        return { outcome: 'confirmation_required', existingContact: { id: contact.id, name: contact.name } };
      }
      if (existingActiveLeads.length > 1) {
        await client.query('commit');
        return { outcome: 'review_required', error: GENERIC_REVIEW };
      }
      if (existingActiveLeads.length === 1) {
        await client.query('commit');
        return { outcome: 'active_conflict', error: ACTIVE_CONFLICT };
      }
    } else {
      contact = await insertContact(client, { organizationId, contactValues });
      createdContact = true;
      await lock(client, `ait-usa-opportunity:${organizationId}:${businessUnitId}:${contact.id}`);
      if ((await activeLeads(client, { organizationId, businessUnitId, contactId: contact.id })).length) {
        await client.query('commit');
        return { outcome: 'active_conflict', error: ACTIVE_CONFLICT };
      }
    }

    const lead = await insertLead(client, { organizationId, businessUnitId, contactId: contact.id, leadValues });
    await recordInitialContext(client, {
      organizationId, businessUnitId, actorUserId, contactId: contact.id, lead, initialLeadStatusReason, initialNote,
    });
    await recordReplay(client, { organizationId, businessUnitId, actorUserId, contactId: contact.id, leadId: lead.id, idempotencyKey, fingerprint });
    await client.query('commit');
    return { outcome: 'created', contact, lead, createdContact };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export const manualAitUsaInquiryMessages = Object.freeze({ GENERIC_REVIEW, ACTIVE_CONFLICT });
