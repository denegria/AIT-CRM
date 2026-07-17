import { NextResponse } from 'next/server';
import { Client } from 'pg';
import { CONVERSATION_PROVIDERS } from '@/lib/conversations/constants.js';
import { ingestSmsProviderEvents } from '@/lib/ingestion/sms-provider-events.js';
import {
  createSmsProviderConfigFromEnv,
  flattenSmsProviderEvents,
  parseTelnyxWebhookPayloadText,
  TELNYX_SIGNATURE_HEADER,
  TELNYX_TIMESTAMP_HEADER,
  validateTelnyxWebhookSignature,
} from '@/lib/messaging/providers/sms.js';
import { externalIoDisabled, externalIoDisabledResponse } from '@/lib/runtime-safety.js';

function jsonError(message, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function withClient(handler) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await handler(client);
  } finally {
    await client.end();
  }
}

async function resolveOrganizationId(client) {
  const result = await client.query('select id from organizations order by created_at asc limit 1');
  return result.rows[0]?.id || null;
}

export async function POST(request) {
  if (externalIoDisabled(process.env)) {
    return NextResponse.json(externalIoDisabledResponse(), { status: 503 });
  }
  const smsConfig = createSmsProviderConfigFromEnv(process.env);
  const bodyText = await request.text();

  const signatureCheck = validateTelnyxWebhookSignature({
    bodyText,
    signatureHeader: request.headers.get(TELNYX_SIGNATURE_HEADER) || '',
    timestampHeader: request.headers.get(TELNYX_TIMESTAMP_HEADER) || '',
    config: smsConfig,
  });
  if (!signatureCheck.ok) {
    return jsonError(
      signatureCheck.reason,
      signatureCheck.code === 'TELNYX_PUBLIC_KEY_MISSING' ? 503 : 401,
    );
  }

  const parsed = parseTelnyxWebhookPayloadText(bodyText);
  if (!parsed.ok) return jsonError(parsed.reason, 400);

  if (!process.env.DATABASE_URL) {
    return jsonError('DATABASE_URL is required before Telnyx SMS webhook processing can run.', 503);
  }

  const events = flattenSmsProviderEvents(CONVERSATION_PROVIDERS.TELNYX, parsed.payload);
  if (!events.length) {
    return NextResponse.json({ ok: true, provider: CONVERSATION_PROVIDERS.TELNYX, received: 0, inserted: 0, skipped: 0 });
  }

  try {
    const result = await withClient(async (client) => {
      const organizationId = await resolveOrganizationId(client);
      const received = events.length;
      if (!organizationId) return { inserted: 0, skipped: received, received, reason: 'No organization found' };

      return ingestSmsProviderEvents(client, {
        organizationId,
        events,
        smsConfig,
      });
    });

    return NextResponse.json({ ok: true, provider: CONVERSATION_PROVIDERS.TELNYX, ...result });
  } catch (error) {
    return jsonError(error.message || 'Failed to ingest Telnyx SMS webhook.', 500);
  }
}
