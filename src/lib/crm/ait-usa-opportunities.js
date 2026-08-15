import { and, eq, sql } from 'drizzle-orm';
import { leadStatusHistory, leads } from '../../db/schema.js';
import {
  isClosedLifecycleStatus,
  WORKFLOW_KEYS,
  workflowKeyForBusinessUnit,
} from './lifecycle.js';

function requiredId(value, label) {
  const id = typeof value === 'string' ? value : value?.id;
  if (!id) throw new Error(`${label} is required to resolve an AIT USA Opportunity.`);
  return id;
}

function opportunityRow(row = {}) {
  return {
    id: row.id,
    organizationId: row.organizationId || row.organization_id,
    businessUnitId: row.businessUnitId || row.business_unit_id,
    contactId: row.contactId || row.contact_id,
    status: row.status,
    currentStage: row.currentStage || row.current_stage,
    assignedUserId: row.assignedUserId || row.assigned_user_id || null,
    sourceType: row.sourceType || row.source_type || null,
    sourceName: row.sourceName || row.source_name || null,
    createdAt: row.createdAt || row.created_at || null,
  };
}

function isActiveAitUsaOpportunity(row) {
  return !isClosedLifecycleStatus(row.status || row.currentStage, {
    workflowKey: WORKFLOW_KEYS.AIT_USA,
  });
}

async function lockOpportunityScope(client, lockKey) {
  if (typeof client.query === 'function') {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
    return;
  }
  await client.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
}

async function loadOpportunityRows(client, { organizationId, businessUnitId, contactId }) {
  if (typeof client.query === 'function') {
    const result = await client.query(
      `select id, organization_id, business_unit_id, contact_id, status, current_stage,
              assigned_user_id, source_type, source_name, created_at
       from leads
       where organization_id = $1 and business_unit_id = $2 and contact_id = $3
       order by created_at desc, id desc`,
      [organizationId, businessUnitId, contactId],
    );
    return result.rows.map(opportunityRow);
  }

  const rows = await client
    .select()
    .from(leads)
    .where(and(
      eq(leads.organizationId, organizationId),
      eq(leads.businessUnitId, businessUnitId),
      eq(leads.contactId, contactId),
    ));
  return rows.map(opportunityRow);
}

export async function resolveAitUsaActiveOpportunity({
  client,
  organization,
  businessUnit,
  contact,
  lock = true,
}) {
  if (!client) throw new Error('Database client is required to resolve an AIT USA Opportunity.');
  if (workflowKeyForBusinessUnit(businessUnit) !== WORKFLOW_KEYS.AIT_USA) {
    throw new Error('AIT USA Opportunity resolution requires an AIT USA business unit.');
  }

  const organizationId = requiredId(organization, 'Organization');
  const businessUnitId = requiredId(businessUnit, 'Business unit');
  const contactId = requiredId(contact, 'Contact');
  if (lock) {
    await lockOpportunityScope(
      client,
      `ait-usa-opportunity:${organizationId}:${businessUnitId}:${contactId}`,
    );
  }

  const opportunities = await loadOpportunityRows(client, {
    organizationId,
    businessUnitId,
    contactId,
  });
  const active = opportunities.filter(isActiveAitUsaOpportunity);

  if (active.length === 0) {
    return { status: 'none', leadId: null, opportunity: null };
  }
  if (active.length === 1) {
    return { status: 'exact', leadId: active[0].id, opportunity: active[0] };
  }
  return { status: 'ambiguous', leadId: null, opportunity: null };
}

export async function loadScopedOpportunityById(client, {
  organizationId,
  businessUnitId,
  contactId,
  opportunityId,
}) {
  const [opportunity] = await client
    .select()
    .from(leads)
    .where(and(
      eq(leads.id, opportunityId),
      eq(leads.organizationId, organizationId),
      eq(leads.businessUnitId, businessUnitId),
      eq(leads.contactId, contactId),
    ))
    .limit(1);
  return opportunity || null;
}

export async function startAitUsaOpportunity({
  db,
  organizationId,
  businessUnit,
  contact,
  actorUserId,
  assignedUserId = null,
  status,
  reason = null,
}) {
  return db.transaction(async (tx) => {
    const resolution = await resolveAitUsaActiveOpportunity({
      client: tx,
      organization: organizationId,
      businessUnit,
      contact,
    });
    if (resolution.status !== 'none') return { status: resolution.status, opportunity: null };

    const [opportunity] = await tx
      .insert(leads)
      .values({
        organizationId,
        businessUnitId: businessUnit.id,
        contactId: contact.id,
        sourceType: 'manual',
        sourceName: 'Manual',
        status,
        currentStage: status,
        assignedUserId,
      })
      .returning();

    await tx.insert(leadStatusHistory).values({
      organizationId,
      businessUnitId: businessUnit.id,
      contactId: contact.id,
      leadId: opportunity.id,
      fromStatus: null,
      toStatus: status,
      actorUserId,
      reason: reason || 'Opportunity started.',
      occurredAt: new Date(),
    });

    return { status: 'created', opportunity };
  });
}

export function toStartedOpportunityContactPayload(contact, opportunity, businessUnit) {
  return {
    id: contact.id,
    name: contact.name,
    email: contact.email || '',
    phone: contact.phone || '',
    address: contact.address || '',
    businessUnitId: businessUnit.id,
    primaryBusinessUnitId: businessUnit.id,
    businessUnitName: businessUnit.name || businessUnit.label || '',
    workflowKey: WORKFLOW_KEYS.AIT_USA,
    hasLeadStatus: true,
    opportunityId: opportunity.id,
    status: opportunity.status,
    currentStage: opportunity.currentStage || opportunity.status,
    assignedTo: opportunity.assignedUserId || '',
    source: opportunity.sourceName || '',
  };
}
