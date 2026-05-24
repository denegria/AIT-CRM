import { and, eq } from 'drizzle-orm';
import { activityEvents, leads } from '../../db/schema.js';

export const LEAD_ASSIGNMENT_EVENT_TYPE = 'lead.assigned';

export const INBOUND_LEAD_SOURCE_TYPES = Object.freeze([
  'website_form',
  'facebook_lead_ads',
  'facebook_webhook',
  'facebook_messenger',
  'whatsapp',
  'whatsapp_inbound',
]);

export const HISTORICAL_IMPORT_SOURCE_TYPES = Object.freeze([
  'import',
  'csv',
  'spreadsheet',
  'xlsx',
  'wix_historical_import',
]);

function normalizeText(value) {
  return String(value || '').trim();
}

function stableHash(value) {
  let hash = 0;
  for (const char of String(value || '')) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

export function isInboundLeadAssignmentEligible({ sourceType, historicalImport = false } = {}) {
  const normalizedSourceType = normalizeText(sourceType).toLowerCase();
  if (historicalImport || HISTORICAL_IMPORT_SOURCE_TYPES.includes(normalizedSourceType)) return false;
  return INBOUND_LEAD_SOURCE_TYPES.includes(normalizedSourceType);
}

export function pickDeterministicOwnerUserId(users = [], key = '') {
  const activeUsers = users
    .filter((user) => user?.id)
    .sort((left, right) => {
      const leftName = normalizeText(left.name || left.email || left.id).toLowerCase();
      const rightName = normalizeText(right.name || right.email || right.id).toLowerCase();
      return leftName.localeCompare(rightName) || left.id.localeCompare(right.id);
    });
  if (!activeUsers.length) return null;
  return activeUsers[stableHash(key) % activeUsers.length].id;
}

export async function resolveDefaultInboundLeadOwnerUserId(client, {
  organizationId,
  businessUnitId,
  sourceType,
  sourceKey = '',
  historicalImport = false,
} = {}) {
  if (!organizationId || !isInboundLeadAssignmentEligible({ sourceType, historicalImport })) return null;

  const scopedUsers = businessUnitId
    ? await client.query(
        `
          select u.id, u.name, u.email
          from users u
          join business_unit_memberships bum on bum.user_id = u.id
          where u.organization_id = $1
            and u.is_active = true
            and bum.business_unit_id = $2
          order by coalesce(nullif(u.name, ''), u.email, u.id::text), u.id
        `,
        [organizationId, businessUnitId],
      )
    : { rows: [] };

  const fallbackUsers = scopedUsers.rows.length
    ? scopedUsers
    : await client.query(
        `
          select id, name, email
          from users
          where organization_id = $1 and is_active = true
          order by coalesce(nullif(name, ''), email, id::text), id
        `,
        [organizationId],
      );

  return pickDeterministicOwnerUserId(
    fallbackUsers.rows,
    [organizationId, businessUnitId, sourceType, sourceKey].filter(Boolean).join(':'),
  );
}

function leadAssignmentMessage(ownerUserId) {
  return ownerUserId ? 'Assigned lead.' : 'Unassigned lead.';
}

export function leadAssignmentActivityValues({
  organizationId,
  actorUserId = null,
  lead,
  ownerUserId = null,
  message,
}) {
  return {
    organizationId,
    businessUnitId: lead.businessUnitId,
    contactId: lead.contactId || null,
    leadId: lead.id,
    eventType: LEAD_ASSIGNMENT_EVENT_TYPE,
    message: message || leadAssignmentMessage(ownerUserId),
    actorUserId,
    occurredAt: new Date(),
    sourceSheet: null,
    sourceRow: null,
  };
}

export async function updateLeadOwnerWithActivity({
  tx,
  organizationId,
  actorUserId = null,
  existingLead,
  ownerUserId = null,
  message,
}) {
  if (!existingLead) return { lead: null, changed: false, previousOwnerUserId: null, ownerUserId };
  const previousOwnerUserId = existingLead.assignedUserId || null;
  const nextOwnerUserId = ownerUserId || null;

  if (previousOwnerUserId === nextOwnerUserId) {
    return {
      lead: existingLead,
      changed: false,
      previousOwnerUserId,
      ownerUserId: nextOwnerUserId,
    };
  }

  const [lead] = await tx
    .update(leads)
    .set({ assignedUserId: nextOwnerUserId, updatedAt: new Date() })
    .where(and(eq(leads.id, existingLead.id), eq(leads.organizationId, organizationId)))
    .returning();

  await tx.insert(activityEvents).values({
    organizationId,
    businessUnitId: lead.businessUnitId,
    contactId: lead.contactId || null,
    leadId: lead.id,
    eventType: LEAD_ASSIGNMENT_EVENT_TYPE,
    message: message || leadAssignmentMessage(nextOwnerUserId),
    actorUserId,
    occurredAt: new Date(),
  });

  return {
    lead,
    changed: true,
    previousOwnerUserId,
    ownerUserId: nextOwnerUserId,
  };
}

export async function recordInboundLeadAssignmentActivity(client, {
  organizationId,
  businessUnitId,
  contactId = null,
  leadId,
  ownerUserId = null,
} = {}) {
  if (!ownerUserId || !leadId) return;
  await client.query(
    `
      insert into activity_events
      (organization_id, business_unit_id, contact_id, lead_id, event_type, message, occurred_at)
      values ($1, $2, $3, $4, $5, $6, now())
    `,
    [
      organizationId,
      businessUnitId,
      contactId,
      leadId,
      LEAD_ASSIGNMENT_EVENT_TYPE,
      'Assigned inbound lead by default rule.',
    ],
  );
}
