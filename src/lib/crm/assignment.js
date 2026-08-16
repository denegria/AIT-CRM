import { and, eq } from 'drizzle-orm';
import { activityEvents, leads } from '../../db/schema.js';
import {
  HISTORICAL_IMPORT_SOURCE_TYPES,
  INBOUND_LEAD_SOURCE_TYPES,
  isCurrentInboundLeadProvenance,
} from './lead-provenance.js';
import { WORKFLOW_KEYS, workflowKeyForBusinessUnit } from './lifecycle.js';

export const LEAD_ASSIGNMENT_EVENT_TYPE = 'lead.assigned';

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
  return isCurrentInboundLeadProvenance({ sourceType, historicalImport });
}

export { HISTORICAL_IMPORT_SOURCE_TYPES, INBOUND_LEAD_SOURCE_TYPES };

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
          select
            u.id,
            u.name,
            u.email,
            bu.name as business_unit_name,
            bu.label as business_unit_label
          from business_units bu
          left join business_unit_memberships bum on bum.business_unit_id = bu.id
          left join users u on u.id = bum.user_id
            and u.organization_id = $1
            and u.is_active = true
          where bu.organization_id = $1
            and bu.id = $2
            and bu.is_active = true
          order by coalesce(nullif(u.name, ''), u.email, u.id::text), u.id
        `,
        [organizationId, businessUnitId],
      )
    : { rows: [] };

  const scopedBusinessUnit = scopedUsers.rows[0]
    ? {
        name: scopedUsers.rows[0].business_unit_name,
        label: scopedUsers.rows[0].business_unit_label,
      }
    : null;
  if (workflowKeyForBusinessUnit(scopedBusinessUnit) === WORKFLOW_KEYS.AIT_USA) return null;
  const scopedOwnerRows = scopedUsers.rows.filter((user) => user?.id);

  const fallbackUsers = scopedOwnerRows.length
    ? { rows: scopedOwnerRows }
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
      select $1, $2, $3, $4, $5, $6, now()
      where not exists (
        select 1
        from activity_events
        where organization_id = $1
          and lead_id = $4
          and event_type = $5
          and message = $6
      )
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
