import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/index.js';
import { businessUnits, messageTemplates } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import { canAccessBusinessUnit } from '@/lib/crm/access.js';
import { isUuid } from '@/lib/crm/validation.js';
import {
  createMessageTemplate,
  listMessageChannelSettings,
  listMessageTemplates,
  normalizeMessageChannelSettingDraft,
  normalizeMessageTemplateDraft,
  updateMessageTemplate,
  upsertMessageChannelSetting,
} from '@/lib/message-templates/service.js';

function jsonError(error, fallback = 'Message template request failed.') {
  return NextResponse.json(
    { error: error.message || fallback },
    { status: error.status || 400 },
  );
}

function cleanText(value) {
  return String(value || '').trim();
}

function nullableId(value) {
  const id = cleanText(value);
  return id || null;
}

function scopedBusinessUnitIds(session) {
  if (session.user.canAccessAllBusinessUnits) return null;
  return session.user.businessUnitIds || [];
}

async function assertBusinessUnitAccess(db, session, businessUnitId) {
  if (!businessUnitId) {
    if (session.user.canAccessAllBusinessUnits) return null;
    const error = new Error('Organization-wide message settings require all business-unit access.');
    error.status = 403;
    throw error;
  }
  if (!isUuid(businessUnitId)) {
    const error = new Error('A valid business unit id is required.');
    error.status = 400;
    throw error;
  }

  const [row] = await db
    .select({ id: businessUnits.id })
    .from(businessUnits)
    .where(and(
      eq(businessUnits.id, businessUnitId),
      eq(businessUnits.organizationId, session.user.organizationId),
    ))
    .limit(1);

  if (!row) {
    const error = new Error('Business unit not found.');
    error.status = 404;
    throw error;
  }

  if (!canAccessBusinessUnit(session, businessUnitId)) {
    const error = new Error('Insufficient business-unit access.');
    error.status = 403;
    throw error;
  }

  return row.id;
}

async function assertTemplateUpdateAccess(db, session, templateId) {
  const [row] = await db
    .select({ id: messageTemplates.id, businessUnitId: messageTemplates.businessUnitId })
    .from(messageTemplates)
    .where(and(
      eq(messageTemplates.id, templateId),
      eq(messageTemplates.organizationId, session.user.organizationId),
    ))
    .limit(1);

  if (!row) {
    const error = new Error('Template not found.');
    error.status = 404;
    throw error;
  }

  await assertBusinessUnitAccess(db, session, row.businessUnitId);
  return row;
}

async function registryPayload(db, session, filters = {}) {
  const businessUnitIds = scopedBusinessUnitIds(session);
  const [templates, channelSettings] = await Promise.all([
    listMessageTemplates({
      db,
      organizationId: session.user.organizationId,
      businessUnitIds,
      filters,
    }),
    listMessageChannelSettings({
      db,
      organizationId: session.user.organizationId,
      businessUnitIds,
      filters,
    }),
  ]);

  return { templates, channelSettings };
}

export async function GET(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.SETTINGS_READ);
  if (error) return error;

  const db = getDb();
  const { searchParams } = new URL(request.url);
  const businessUnitId = nullableId(searchParams.get('businessUnitId'));

  try {
    if (businessUnitId) await assertBusinessUnitAccess(db, session, businessUnitId);
    return NextResponse.json(await registryPayload(db, session, {
      businessUnitId,
      channel: cleanText(searchParams.get('channel')),
      purpose: cleanText(searchParams.get('purpose')),
      status: cleanText(searchParams.get('status')),
    }));
  } catch (requestError) {
    return jsonError(requestError);
  }
}

export async function POST(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.SETTINGS_WRITE);
  if (error) return error;

  const db = getDb();
  const body = await request.json().catch(() => ({}));

  try {
    const draft = normalizeMessageTemplateDraft(body);
    await assertBusinessUnitAccess(db, session, draft.businessUnitId);
    const template = await createMessageTemplate({
      db,
      organizationId: session.user.organizationId,
      actorUserId: session.user.id,
      values: draft,
    });
    const payload = await registryPayload(db, session);
    return NextResponse.json({ ...payload, template }, { status: 201 });
  } catch (requestError) {
    return jsonError(requestError);
  }
}

export async function PATCH(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.SETTINGS_WRITE);
  if (error) return error;

  const db = getDb();
  const body = await request.json().catch(() => ({}));

  try {
    if (body.kind === 'channel_setting') {
      const draft = normalizeMessageChannelSettingDraft(body);
      await assertBusinessUnitAccess(db, session, draft.businessUnitId);
      const channelSetting = await upsertMessageChannelSetting({
        db,
        organizationId: session.user.organizationId,
        actorUserId: session.user.id,
        values: draft,
      });
      const payload = await registryPayload(db, session);
      return NextResponse.json({ ...payload, channelSetting });
    }

    const id = cleanText(body.id);
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'A valid template id is required.' }, { status: 400 });
    }

    const draft = normalizeMessageTemplateDraft(body);
    await assertTemplateUpdateAccess(db, session, id);
    await assertBusinessUnitAccess(db, session, draft.businessUnitId);
    const template = await updateMessageTemplate({
      db,
      organizationId: session.user.organizationId,
      actorUserId: session.user.id,
      id,
      values: draft,
    });
    const payload = await registryPayload(db, session);
    return NextResponse.json({ ...payload, template });
  } catch (requestError) {
    return jsonError(requestError);
  }
}
