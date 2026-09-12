import { NextResponse } from 'next/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import { contacts, leads, tasks, users } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import { canAccessContactLead, resolveContactById } from '@/lib/crm/access.js';
import { crmErrorResponse } from '@/lib/crm/errors.js';
import { isActiveAitUsaOpportunity } from '@/lib/crm/ait-usa-opportunities.js';
import { inquiryWorkspaceItem } from '@/lib/crm/inquiry-workspace.js';
import { PLACEMENT_REVIEW_TASK_SOURCE_TYPE, placementReviewHref } from '@/lib/placement-reviews/crm-workflow.js';

function taskPlacement(task, mayOpenEmployeeReview) {
  if (!task) return null;
  const reviewId = String(task.sourceId || '').replace(/^review:/, '').trim();
  return {
    state: task.status === 'completed' ? 'Review acknowledged' : 'Review pending',
    updatedAt: task.updatedAt || task.createdAt || null,
    reviewPath: mayOpenEmployeeReview && reviewId ? placementReviewHref(reviewId) : '',
  };
}

export async function GET(request, { params }) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;
  const { id } = await params;
  const db = getDb();
  try {
    const contact = await resolveContactById({ db, session, contactsTable: contacts, contactId: id });
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
    const placementRows = leadIds.length
      ? await db.select({ leadId: tasks.leadId, status: tasks.status, sourceId: tasks.sourceId, createdAt: tasks.createdAt, updatedAt: tasks.updatedAt })
        .from(tasks)
        .where(and(eq(tasks.organizationId, session.user.organizationId), inArray(tasks.leadId, leadIds), eq(tasks.sourceType, PLACEMENT_REVIEW_TASK_SOURCE_TYPE)))
      : [];
    const placements = new Map(placementRows.map((task) => [task.leadId, task]));
    return NextResponse.json({
      inquiries: permitted.map((lead) => inquiryWorkspaceItem({
        lead: { ...lead, isActive: isActiveAitUsaOpportunity(lead) },
        owner: owners.get(lead.assignedUserId) || null,
        placement: taskPlacement(placements.get(lead.id), session.user.canAccessAllBusinessUnits),
      })),
    });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
