import { NextResponse } from 'next/server';
import { Client } from 'pg';
import { getDb } from '@/db/index.js';
import { contacts } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import { sessionHasAdminRole } from '@/lib/auth/admin-policy.js';
import { resolveContactById } from '@/lib/crm/access.js';
import { crmErrorResponse } from '@/lib/crm/errors.js';
import { listContactConversationMessages } from '@/lib/conversations/service.js';
import {
  evaluateManualOutboundGuardrails,
  loadManualOutboundContext,
  normalizeManualOutboundRequest,
  sendManualOutboundMessage,
} from '@/lib/conversations/manual-outbound.js';
import {
  FB_APP_SECRET_ENV,
  META_APP_SECRET_ENV,
  META_PAGE_ACCESS_TOKEN_ENV,
  META_PAGE_ACCESS_TOKEN_MAP_ENV,
  META_WHATSAPP_ACCESS_TOKEN_ENV,
  META_WHATSAPP_ACCESS_TOKEN_MAP_ENV,
  createMetaProviderConfig,
} from '@/lib/messaging/providers/meta.js';
import { createSmsCampaignSendConfigFromEnv } from '@/lib/messaging/providers/sms.js';
import { externalIoDisabled } from '@/lib/runtime-safety.js';

function getManualOutboundMetaConfig() {
  return createMetaProviderConfig({
    appSecret: process.env[META_APP_SECRET_ENV] || process.env[FB_APP_SECRET_ENV],
    defaultPageAccessToken: process.env[META_PAGE_ACCESS_TOKEN_ENV],
    pageAccessTokenMapRaw: process.env[META_PAGE_ACCESS_TOKEN_MAP_ENV],
    defaultWhatsAppAccessToken: process.env[META_WHATSAPP_ACCESS_TOKEN_ENV],
    whatsappAccessTokenMapRaw: process.env[META_WHATSAPP_ACCESS_TOKEN_MAP_ENV],
    externalIoDisabled: externalIoDisabled(process.env),
  });
}

async function withClient(handler) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is required before manual outbound sends can run.' }, { status: 503 });
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await handler(client);
  } finally {
    await client.end();
  }
}

export async function GET(request, { params }) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_READ);
  if (error) return error;

  const { id } = await params;
  const db = getDb();

  try {
    const contact = await resolveContactById({
      db,
      session,
      contactsTable: contacts,
      contactId: id,
    });
    const messages = await listContactConversationMessages({
      db,
      organizationId: session.user.organizationId,
      contactId: contact.id,
      businessUnitIds: session.user.canAccessAllBusinessUnits ? null : session.user.businessUnitIds,
    });

    return NextResponse.json({ messages });
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function POST(request, { params }) {
  const { error, session } = await requirePermission(request, PERMISSIONS.CRM_WRITE);
  if (error) return error;
  if (!sessionHasAdminRole(session)) {
    return NextResponse.json(
      { error: 'Manual outbound sends require administrator access.' },
      { status: 403 },
    );
  }

  const { id } = await params;
  const db = getDb();
  const body = await request.json().catch(() => ({}));
  const manualRequest = normalizeManualOutboundRequest(body);
  const metaConfig = getManualOutboundMetaConfig();
  const smsConfig = createSmsCampaignSendConfigFromEnv(process.env);

  try {
    const contact = await resolveContactById({
      db,
      session,
      contactsTable: contacts,
      contactId: id,
    });

    return withClient(async (client) => {
      const businessUnitIds = session.user.canAccessAllBusinessUnits ? null : session.user.businessUnitIds;
      const context = await loadManualOutboundContext(client, {
        organizationId: session.user.organizationId,
        contact,
        channel: manualRequest.channel,
        templateId: manualRequest.templateId,
        businessUnitIds,
      });
      const guardrails = evaluateManualOutboundGuardrails({
        contact,
        request: manualRequest,
        context,
        conversation: context.conversation,
        channelSetting: context.channelSetting,
        template: context.template,
        metaConfig,
        smsConfig,
      });

      if (!guardrails.ok) {
        return NextResponse.json({
          ok: false,
          blocked: true,
          reasons: guardrails.reasons,
        }, { status: 409 });
      }

      const result = await sendManualOutboundMessage(client, {
        organizationId: session.user.organizationId,
        actorUserId: session.user.id,
        contact,
        request: manualRequest,
        context,
        metaConfig,
        smsConfig,
      });

      return NextResponse.json(result, { status: result.ok ? 201 : 502 });
    });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
