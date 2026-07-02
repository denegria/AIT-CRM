import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import { businessUnits, roles } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import { createSignupInviteToken } from '@/lib/signup-invites';

const INVITE_ROLE_KEYS = ['account_manager', 'senior_coordinator', 'designer', 'sales_manager'];
const DEFAULT_EXPIRES_IN_SECONDS = 2 * 60 * 60;
const MAX_EXPIRES_IN_SECONDS = 24 * 60 * 60;

function normalizeBusinessUnitIds(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeRoleKey(value) {
  const roleKey = String(value || '').trim();
  return INVITE_ROLE_KEYS.includes(roleKey) ? roleKey : '';
}

function normalizeExpiry(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_EXPIRES_IN_SECONDS;
  return Math.min(Math.floor(seconds), MAX_EXPIRES_IN_SECONDS);
}

function inviteOrigin(request) {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (forwardedProto && forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  return request.nextUrl.origin;
}

export async function POST(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.SETTINGS_WRITE);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const roleKey = normalizeRoleKey(body.roleKey);
  const businessUnitIds = normalizeBusinessUnitIds(body.businessUnitIds);
  const expiresInSeconds = normalizeExpiry(body.expiresInSeconds);
  const label = String(body.label || '').trim();

  if (!roleKey) {
    return NextResponse.json({ error: 'Invite role is not available.' }, { status: 400 });
  }
  if (!businessUnitIds.length) {
    return NextResponse.json({ error: 'At least one active division is required.' }, { status: 400 });
  }

  const db = getDb();
  const [roleRow, unitRows] = await Promise.all([
    db
      .select({ id: roles.id })
      .from(roles)
      .where(and(
        eq(roles.organizationId, session.user.organizationId),
        eq(roles.key, roleKey),
      ))
      .limit(1),
    db
      .select({ id: businessUnits.id, name: businessUnits.name })
      .from(businessUnits)
      .where(and(
        eq(businessUnits.organizationId, session.user.organizationId),
        eq(businessUnits.isActive, true),
        inArray(businessUnits.id, businessUnitIds),
      )),
  ]);

  if (!roleRow.length) {
    return NextResponse.json({ error: 'Invite role is not available.' }, { status: 400 });
  }
  if (unitRows.length !== businessUnitIds.length) {
    return NextResponse.json({ error: 'One or more invite divisions are no longer available.' }, { status: 400 });
  }

  const expiresAt = Date.now() + expiresInSeconds * 1000;
  const token = createSignupInviteToken({
    roleKey,
    organizationId: session.user.organizationId,
    businessUnitIds,
    expiresAt,
    ...(label ? { label } : {}),
  });

  const inviteUrl = new URL('/join', inviteOrigin(request));
  inviteUrl.searchParams.set('token', token);

  return NextResponse.json({
    inviteUrl: inviteUrl.toString(),
    expiresAt: new Date(expiresAt).toISOString(),
    roleKey,
    businessUnits: unitRows.map((unit) => ({ id: unit.id, name: unit.name })),
  });
}
