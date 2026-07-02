import { NextResponse } from 'next/server';
import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import { notifications } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import { canReadInboundLeadNotifications, canReadNotification } from '@/lib/notifications/access.js';
import { NOTIFICATION_TYPES } from '@/lib/notifications/service.js';

function notificationAccessWhere(session) {
  const base = [
    eq(notifications.organizationId, session.user.organizationId),
    or(isNull(notifications.userId), eq(notifications.userId, session.user.id)),
  ];
  if (!session.user.canAccessAllBusinessUnits) {
    const businessUnitIds = session.user.businessUnitIds || [];
    base.push(businessUnitIds.length
      ? or(isNull(notifications.businessUnitId), inArray(notifications.businessUnitId, businessUnitIds))
      : isNull(notifications.businessUnitId));
  }
  if (!canReadInboundLeadNotifications(session)) {
    base.push(ne(notifications.type, NOTIFICATION_TYPES.INBOUND_LEAD));
  }
  return and(...base);
}

function toPayload(row) {
  return {
    id: row.id,
    type: row.type,
    sourceType: row.sourceType || '',
    title: row.title,
    body: row.body || '',
    href: row.href || '',
    businessUnitId: row.businessUnitId || '',
    contactId: row.contactId || '',
    leadId: row.leadId || '',
    metadata: row.metadataJson || {},
    readAt: row.readAt?.toISOString?.() || row.readAt || '',
    createdAt: row.createdAt?.toISOString?.() || row.createdAt || '',
  };
}

export async function GET(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get('limit') || 10), 1), 50);
  const db = getDb();
  const where = notificationAccessWhere(session);

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(limit),
    db
      .select({ count: sql`count(*)::int` })
      .from(notifications)
      .where(and(where, isNull(notifications.readAt))),
  ]);

  return NextResponse.json({
    notifications: rows.filter((row) => canReadNotification(session, row)).map(toPayload),
    unreadCount: Number(countRows[0]?.count || 0),
  });
}

export async function PATCH(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids)
    ? body.ids.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const markAllRead = body.all === true;
  if (!markAllRead && !ids.length) {
    return NextResponse.json({ error: 'Notification ids are required.' }, { status: 400 });
  }

  const db = getDb();
  const where = markAllRead
    ? notificationAccessWhere(session)
    : and(notificationAccessWhere(session), inArray(notifications.id, ids));

  const updated = await db
    .update(notifications)
    .set({ readAt: new Date(), updatedAt: new Date() })
    .where(and(where, isNull(notifications.readAt)))
    .returning({ id: notifications.id });

  return NextResponse.json({
    updated: updated.length,
    ids: updated.map((row) => row.id),
  });
}
