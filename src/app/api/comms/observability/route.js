import { NextResponse } from 'next/server';
import { Client } from 'pg';
import { PERMISSIONS, requirePermission } from '@/lib/auth';
import { buildCommsObservabilitySnapshot } from '@/lib/comms-observability/service.js';

async function withClient(handler) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is required before comms observability can run.' }, { status: 503 });
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await handler(client);
  } finally {
    await client.end();
  }
}

export async function GET(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.SETTINGS_READ);
  if (error) return error;

  const businessUnitIds = session.user.canAccessAllBusinessUnits ? null : session.user.businessUnitIds;
  return withClient(async (client) => {
    const snapshot = await buildCommsObservabilitySnapshot(client, {
      organizationId: session.user.organizationId,
      businessUnitIds,
      env: process.env,
    });
    return NextResponse.json(snapshot, {
      headers: {
        'cache-control': 'no-store',
      },
    });
  });
}
