import { NextResponse } from 'next/server';
import { and, asc, eq, ne } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import { activityEvents, businessUnits } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(String(value || ''));
}

function toBusinessUnitPayload(row) {
  return {
    id: row.id,
    name: row.name,
    label: row.label || 'Divisions',
    color: row.color || '',
    isActive: row.isActive !== false,
  };
}

function cleanString(value) {
  return String(value || '').trim();
}

async function logBusinessUnitEvent(db, session, businessUnit, eventType) {
  await db.insert(activityEvents).values({
    organizationId: session.user.organizationId,
    businessUnitId: businessUnit.id,
    eventType,
    message: (eventType === 'business_unit.created' ? 'Created' : 'Updated') + ' division ' + businessUnit.name + '.',
    actorUserId: session.user.id,
    occurredAt: new Date(),
  });
}

export async function GET(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.SETTINGS_READ);
  if (error) return error;

  const rows = await getDb()
    .select()
    .from(businessUnits)
    .where(eq(businessUnits.organizationId, session.user.organizationId))
    .orderBy(asc(businessUnits.name));

  return NextResponse.json({ businessUnits: rows.map(toBusinessUnitPayload) });
}

export async function POST(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.SETTINGS_WRITE);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const name = cleanString(body.name);
  if (!name) {
    return NextResponse.json({ error: 'Division name is required.' }, { status: 400 });
  }

  const db = getDb();
  const [businessUnit] = await db
    .insert(businessUnits)
    .values({
      organizationId: session.user.organizationId,
      name,
      label: cleanString(body.label) || 'Divisions',
      color: cleanString(body.color) || null,
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
    })
    .returning();

  await logBusinessUnitEvent(db, session, businessUnit, 'business_unit.created');

  const rows = await db
    .select()
    .from(businessUnits)
    .where(eq(businessUnits.organizationId, session.user.organizationId))
    .orderBy(asc(businessUnits.name));

  return NextResponse.json({ businessUnit: toBusinessUnitPayload(businessUnit), businessUnits: rows.map(toBusinessUnitPayload) }, { status: 201 });
}

export async function PATCH(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.SETTINGS_WRITE);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const id = cleanString(body.id);
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'A valid division id is required.' }, { status: 400 });
  }

  const db = getDb();
  const [existing] = await db
    .select()
    .from(businessUnits)
    .where(and(eq(businessUnits.id, id), eq(businessUnits.organizationId, session.user.organizationId)))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: 'Division not found.' }, { status: 404 });
  }

  if (body.isActive === false) {
    const [otherActive] = await db
      .select({ id: businessUnits.id })
      .from(businessUnits)
      .where(and(
        eq(businessUnits.organizationId, session.user.organizationId),
        eq(businessUnits.isActive, true),
        ne(businessUnits.id, id),
      ))
      .limit(1);

    if (!otherActive) {
      return NextResponse.json({ error: 'At least one active division is required.' }, { status: 400 });
    }
  }

  const patch = { updatedAt: new Date() };
  if ('name' in body) {
    const name = cleanString(body.name);
    if (!name) return NextResponse.json({ error: 'Division name is required.' }, { status: 400 });
    patch.name = name;
  }
  if ('label' in body) patch.label = cleanString(body.label) || 'Divisions';
  if ('color' in body) patch.color = cleanString(body.color) || null;
  if ('isActive' in body) patch.isActive = Boolean(body.isActive);

  const [businessUnit] = await db
    .update(businessUnits)
    .set(patch)
    .where(eq(businessUnits.id, id))
    .returning();

  await logBusinessUnitEvent(db, session, businessUnit, 'business_unit.updated');

  const rows = await db
    .select()
    .from(businessUnits)
    .where(eq(businessUnits.organizationId, session.user.organizationId))
    .orderBy(asc(businessUnits.name));

  return NextResponse.json({ businessUnit: toBusinessUnitPayload(businessUnit), businessUnits: rows.map(toBusinessUnitPayload) });
}
