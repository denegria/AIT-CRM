import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { Client } from 'pg';
import { getDb } from '@/db/index.js';
import {
  businessUnits,
  contacts,
  followUpSequences,
  followUpSequenceSteps,
  leads,
  users,
} from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import {
  canAccessBusinessUnit,
  resolveBusinessUnitId,
  resolveContactById,
} from '@/lib/crm/access.js';
import { createCrmError, crmErrorResponse } from '@/lib/crm/errors.js';
import { isUuid } from '@/lib/crm/validation.js';
import {
  enrollContactInFollowUpSequence,
  executeDueFollowUpSteps,
} from '@/lib/follow-up-sequences/service.js';

function stringParam(value) {
  return String(value || '').trim();
}

function boolParam(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
}

async function withClient(handler) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is required before follow-up sequence jobs can run.' }, { status: 503 });
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await handler(client);
  } finally {
    await client.end();
  }
}

function sequencePayload(row) {
  return {
    id: row.id,
    businessUnitId: row.businessUnitId || '',
    key: row.key,
    name: row.name,
    description: row.description || '',
    status: row.status,
    defaultChannel: row.defaultChannel,
    isEnabled: row.isEnabled,
    maxTouches: row.maxTouches,
    settingsJson: row.settingsJson || {},
    createdAt: row.createdAt?.toISOString?.() || row.createdAt || null,
    updatedAt: row.updatedAt?.toISOString?.() || row.updatedAt || null,
  };
}

async function resolveSequence(db, session, sequenceId, { enabledOnly = false } = {}) {
  if (!isUuid(sequenceId)) throw createCrmError('A valid sequence id is required.');
  const conditions = [
    eq(followUpSequences.id, sequenceId),
    eq(followUpSequences.organizationId, session.user.organizationId),
  ];
  if (enabledOnly) conditions.push(eq(followUpSequences.isEnabled, true));

  const [sequence] = await db
    .select()
    .from(followUpSequences)
    .where(and(...conditions))
    .limit(1);

  if (!sequence) throw createCrmError('Follow-up sequence not found.', 404);
  if (sequence.businessUnitId && !canAccessBusinessUnit(session, sequence.businessUnitId)) {
    throw createCrmError('Insufficient business-unit access for this sequence.', 403);
  }
  return sequence;
}

async function resolveFirstStep(db, sequence) {
  const [step] = await db
    .select()
    .from(followUpSequenceSteps)
    .where(and(
      eq(followUpSequenceSteps.sequenceId, sequence.id),
      eq(followUpSequenceSteps.organizationId, sequence.organizationId),
      eq(followUpSequenceSteps.position, 1),
      eq(followUpSequenceSteps.isActive, true),
    ))
    .limit(1);

  if (!step) throw createCrmError('Follow-up sequence has no active first step.', 409);
  return step;
}

async function resolveOwnerUserId(db, session, value) {
  const ownerUserId = stringParam(value);
  if (!ownerUserId) return session.user.id;
  if (!isUuid(ownerUserId)) throw createCrmError('A valid owner user id is required.');

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(
      eq(users.id, ownerUserId),
      eq(users.organizationId, session.user.organizationId),
      eq(users.isActive, true),
    ))
    .limit(1);

  if (!user) throw createCrmError('Sequence owner not found.', 404);
  return user.id;
}

async function resolveLeadId(db, session, contact, value, businessUnitId) {
  const leadId = stringParam(value);
  if (!leadId) return null;
  if (!isUuid(leadId)) throw createCrmError('A valid lead id is required.');

  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, session.user.organizationId)))
    .limit(1);

  if (!lead) throw createCrmError('Lead not found.', 404);
  if (lead.contactId && lead.contactId !== contact.id) {
    throw createCrmError('Sequence lead must belong to the selected contact.');
  }
  if (lead.businessUnitId !== businessUnitId || !canAccessBusinessUnit(session, lead.businessUnitId)) {
    throw createCrmError('Insufficient business-unit access for this lead.', 403);
  }
  return lead.id;
}

export async function GET(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;

  const db = getDb();
  const { searchParams } = new URL(request.url);
  const activeOnly = boolParam(searchParams.get('active'));

  try {
    const conditions = [eq(followUpSequences.organizationId, session.user.organizationId)];
    if (activeOnly) conditions.push(eq(followUpSequences.isEnabled, true));
    const rows = await db
      .select()
      .from(followUpSequences)
      .where(and(...conditions))
      .orderBy(followUpSequences.name);

    const scopedRows = rows.filter((row) => !row.businessUnitId || canAccessBusinessUnit(session, row.businessUnitId));
    return NextResponse.json({ sequences: scopedRows.map(sequencePayload) });
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function POST(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_WRITE);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const action = stringParam(body.action || 'enroll');
  const db = getDb();

  try {
    if (action === 'run_due') {
      const businessUnitIds = session.user.canAccessAllBusinessUnits ? null : session.user.businessUnitIds;
      return withClient(async (client) => {
        const result = await executeDueFollowUpSteps(client, {
          organizationId: session.user.organizationId,
          businessUnitIds,
          limit: Math.max(1, Math.min(100, Number(body.limit || 25))),
        });
        return NextResponse.json(result);
      });
    }

    if (action !== 'enroll') {
      return NextResponse.json({ error: 'Unsupported follow-up sequence action.' }, { status: 400 });
    }

    const sequence = await resolveSequence(db, session, stringParam(body.sequenceId), { enabledOnly: true });
    const contact = await resolveContactById({
      db,
      session,
      contactsTable: contacts,
      contactId: stringParam(body.contactId),
    });
    const firstStep = await resolveFirstStep(db, sequence);
    const requestedBusinessUnitId = stringParam(body.businessUnitId);
    const fallbackBusinessUnitId = sequence.businessUnitId || contact.primaryBusinessUnitId || '';
    const businessUnitId = await resolveBusinessUnitId({
      db,
      session,
      businessUnitsTable: businessUnits,
      requestedId: requestedBusinessUnitId || fallbackBusinessUnitId,
    });

    if (sequence.businessUnitId && sequence.businessUnitId !== businessUnitId) {
      throw createCrmError('Enrollment business unit must match the selected sequence.');
    }
    if (contact.primaryBusinessUnitId && contact.primaryBusinessUnitId !== businessUnitId) {
      throw createCrmError('Enrollment business unit must match the selected contact.');
    }
    const ownerUserId = await resolveOwnerUserId(db, session, body.ownerUserId || session.user.id);
    const leadId = await resolveLeadId(db, session, contact, body.leadId, businessUnitId);

    return withClient(async (client) => {
      const enrollment = await enrollContactInFollowUpSequence(client, {
        organizationId: session.user.organizationId,
        businessUnitId,
        sequence,
        firstStep,
        contactId: contact.id,
        actorUserId: session.user.id,
        values: {
          leadId,
          channel: body.channel,
          ownerUserId,
          triggerType: body.triggerType || 'manual',
          maxTouches: body.maxTouches,
          nextStepDueAt: body.nextStepDueAt,
          metadataJson: body.metadataJson,
        },
      });

      return NextResponse.json({
        enrollment: {
          id: enrollment.id,
          nextStepDueAt: enrollment.next_step_due_at?.toISOString?.() || enrollment.next_step_due_at || null,
          existing: enrollment.inserted === false,
        },
      }, { status: enrollment.inserted === false ? 200 : 201 });
    });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
