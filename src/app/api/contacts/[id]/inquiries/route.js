import { NextResponse } from 'next/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import { activityEvents, contacts, leads, tasks, users } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import { canAccessContactLead, resolveContactById } from '@/lib/crm/access.js';
import { crmErrorResponse } from '@/lib/crm/errors.js';
import { isActiveAitUsaOpportunity } from '@/lib/crm/ait-usa-opportunities.js';
import { inquiryWorkspaceItem } from '@/lib/crm/inquiry-workspace.js';
import { PLACEMENT_REVIEW_TASK_SOURCE_TYPE } from '@/lib/placement-reviews/crm-workflow.js';
import { placementReviewTaskLink } from '@/lib/tasks/detail.js';
import { canReadTaskDetail } from '@/lib/tasks/detail-policy.js';

export function taskPlacement(task, session) {
  if (!task) return null;
  const placement = task.metadataJson?.placementReview || {};
  return {
    state: String(placement.state || (task.status === 'completed' ? 'Review acknowledged' : 'Review pending')),
    finalLevel: String(placement.finalLevel || ''),
    finalStatus: String(placement.state === 'confirmed' || placement.state === 'adjusted' ? placement.state : ''),
    updatedAt: task.updatedAt || task.createdAt || null,
    reviewPath: canReadTaskDetail(session, task) ? (placementReviewTaskLink(task.metadataJson) || '') : '',
  };
}

export async function GET(request, { params }, {
  requirePermissionForRequest = requirePermission,
  getDbForRequest = getDb,
  resolveContactForRequest = resolveContactById,
} = {}) {
  const { error, session } = await requirePermissionForRequest(request, PERMISSIONS.CRM_READ);
  if (error) return error;
  const { id } = await params;
  const db = getDbForRequest();
  try {
    const contact = await resolveContactForRequest({ db, session, contactsTable: contacts, contactId: id });
    const rows = await db.select().from(leads).where(and(
      eq(leads.organizationId, session.user.organizationId),
      eq(leads.contactId, contact.id),
      eq(leads.businessUnitId, contact.primaryBusinessUnitId),
    )).orderBy(desc(leads.createdAt), desc(leads.id));
    const permitted = rows.filter((lead) => canAccessContactLead(session, lead, contact));
    const ownerIds = [...new Set(permitted.map((lead) => lead.assignedUserId).filter(Boolean))];
    const ownerRows = ownerIds.length
      ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(and(eq(users.organizationId, session.user.organizationId), inArray(users.id, ownerIds)))
      : [];
    const owners = new Map(ownerRows.map((owner) => [owner.id, owner]));
    const leadIds = permitted.map((lead) => lead.id);
    const [placementRows, activityRows] = leadIds.length
      ? await Promise.all([
        db.select({ leadId: tasks.leadId, status: tasks.status, sourceId: tasks.sourceId, contactId: tasks.contactId, businessUnitId: tasks.businessUnitId, ownerUserId: tasks.ownerUserId, taskType: tasks.taskType, metadataJson: tasks.metadataJson, createdAt: tasks.createdAt, updatedAt: tasks.updatedAt })
        .from(tasks)
        .where(and(
          eq(tasks.organizationId, session.user.organizationId),
          eq(tasks.businessUnitId, contact.primaryBusinessUnitId),
          eq(tasks.contactId, contact.id),
          inArray(tasks.leadId, leadIds),
          eq(tasks.sourceType, PLACEMENT_REVIEW_TASK_SOURCE_TYPE),
        )).orderBy(desc(tasks.createdAt), desc(tasks.id)),
        db.select({ leadId: activityEvents.leadId, occurredAt: activityEvents.occurredAt, createdAt: activityEvents.createdAt })
          .from(activityEvents)
          .where(and(eq(activityEvents.organizationId, session.user.organizationId), eq(activityEvents.contactId, contact.id), inArray(activityEvents.leadId, leadIds)))
          .orderBy(desc(activityEvents.occurredAt), desc(activityEvents.createdAt)),
      ])
      : [[], []];
    const placements = new Map();
    for (const task of placementRows) if (!placements.has(task.leadId)) placements.set(task.leadId, task);
    const lastActivity = new Map();
    for (const activity of activityRows) if (!lastActivity.has(activity.leadId)) lastActivity.set(activity.leadId, activity.occurredAt || activity.createdAt);
    return NextResponse.json({
      inquiries: permitted.map((lead) => inquiryWorkspaceItem({
        lead: { ...lead, isActive: isActiveAitUsaOpportunity(lead) },
        owner: owners.get(lead.assignedUserId) || null,
        placement: taskPlacement(placements.get(lead.id), session),
        lastActivityAt: lastActivity.get(lead.id) || null,
      })),
    });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
