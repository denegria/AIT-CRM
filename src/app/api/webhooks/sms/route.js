import { NextResponse } from 'next/server';
import { Client } from 'pg';
import {
  createSmsProviderConfigFromEnv,
  flattenSmsProviderEvents,
  normalizeSmsProvider,
  validateSmsWebhookSharedSecret,
} from '@/lib/messaging/providers/sms.js';
import { ingestSmsProviderEvents } from '@/lib/ingestion/sms-provider-events.js';
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

async function parseWebhookPayload(request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await request.text();
    return Object.fromEntries(new URLSearchParams(text));
  }
  if (contentType.includes('application/json') || !contentType) {
    return request.json();
  }
  const text = await request.text();
  try {
    return JSON.parse(text);
  } catch {
    return Object.fromEntries(new URLSearchParams(text));
  }
}

export async function POST(request) {
  if (externalIoDisabled(process.env)) {
    return NextResponse.json(externalIoDisabledResponse(), { status: 503 });
  }
  const smsConfig = createSmsProviderConfigFromEnv(process.env);
  if (!process.env.DATABASE_URL) {
    return jsonError('DATABASE_URL is required before SMS webhook processing can run.', 503);
  }

  const secretCheck = validateSmsWebhookSharedSecret({
    secretHeader: request.headers.get('x-ait-sms-webhook-secret') || '',
    config: smsConfig,
  });
  if (!secretCheck.ok) {
    return jsonError(secretCheck.reason, secretCheck.code === 'SMS_WEBHOOK_SECRET_MISSING' ? 503 : 401);
  }

  const url = new URL(request.url);
  const provider = normalizeSmsProvider(
    url.searchParams.get('provider')
      || request.headers.get('x-sms-provider')
      || smsConfig.provider,
  );
  if (!provider) return jsonError('Unsupported or missing SMS provider.', 400);

  let payload;
  try {
    payload = await parseWebhookPayload(request);
  } catch {
    return jsonError('Invalid SMS webhook payload.', 400);
  }

  const events = flattenSmsProviderEvents(provider, payload);
  if (!events.length) {
    return NextResponse.json({ ok: true, received: 0, inserted: 0, skipped: 0 });
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

    return NextResponse.json({ ok: true, provider, ...result });
  } catch (error) {
    return jsonError(error.message || 'Failed to ingest SMS webhook.', 500);
  }
}
