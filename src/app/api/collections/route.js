import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server.js';

import { getDb, getPool } from '@/db/index.js';
import { businessUnits } from '@/db/schema.js';
import { PERMISSIONS, requirePermission } from '@/lib/auth.js';
import { isAitUsaBusinessUnit } from '@/lib/attendance/policy.js';
import {
  createHostedCollectionLink,
  loadCollectionsQueue,
  loadCollectionsSetup,
  recordManualCollectionPayment,
} from '@/lib/collections/service.js';
import {
  initiateSpinCollectionPayment,
  recoverSpinCollectionPayment,
} from '@/lib/collections/spin-service.js';
import { resolveBusinessUnitId } from '@/lib/crm/access.js';
import { createCrmError, crmErrorResponse } from '@/lib/crm/errors.js';
import { dejavooSpinConfigHealth } from '@/lib/payments/providers/dejavoo-spin.js';
import { orchestrateRegistration } from '@/lib/registration/action.js';

function text(value) {
  return String(value || '').trim();
}

async function resolveAitUsaScope(session, requestedId) {
  const db = getDb();
  const businessUnitId = await resolveBusinessUnitId({
    db,
    session,
    businessUnitsTable: businessUnits,
    requestedId: text(requestedId),
  });
  const [businessUnit] = await db
    .select({ id: businessUnits.id, name: businessUnits.name })
    .from(businessUnits)
    .where(and(
      eq(businessUnits.id, businessUnitId),
      eq(businessUnits.organizationId, session.user.organizationId),
    ))
    .limit(1);
  if (!businessUnit || !isAitUsaBusinessUnit(businessUnit.name)) {
    throw createCrmError('Collections is limited to AIT USA.', 403);
  }
  return businessUnitId;
}

function providerEnvironment() {
  return process.env.VERCEL_ENV === 'production' ? 'production' : 'uat';
}

function deployedBaseUrl(request) {
  const host = process.env.VERCEL_ENV === 'production'
    ? process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
    : process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL;
  if (host) return `https://${String(host).replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  const origin = new URL(request.url).origin;
  if (!origin.startsWith('https://')) throw createCrmError('A secure deployment URL is required for hosted checkout.', 503);
  return origin;
}

export async function GET(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.FINANCIALS_READ);
  if (error) return error;
  const { searchParams } = new URL(request.url);
  let client;
  try {
    const businessUnitId = await resolveAitUsaScope(session, searchParams.get('businessUnitId'));
    client = await getPool().connect();
    const scope = { organizationId: session.user.organizationId, businessUnitId };
    const queue = await loadCollectionsQueue(client, {
      ...scope,
      state: searchParams.get('state'),
      search: searchParams.get('search'),
      page: searchParams.get('page'),
      pageSize: searchParams.get('pageSize'),
    });
    const setup = await loadCollectionsSetup(client, scope);
    const terminalHealth = dejavooSpinConfigHealth({ environment: providerEnvironment() });
    return NextResponse.json({
      queue,
      setup: {
        ...setup,
        terminalCheckout: {
          ready: terminalHealth.ready,
          environment: terminalHealth.environment,
        },
      },
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (caught) {
    return crmErrorResponse(caught);
  } finally {
    client?.release();
  }
}

export async function POST(request) {
  const { error, session } = await requirePermission(request, PERMISSIONS.FINANCIALS_WRITE);
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  let client;
  try {
    const businessUnitId = await resolveAitUsaScope(session, body.businessUnitId);
    const scope = { organizationId: session.user.organizationId, businessUnitId };
    client = await getPool().connect();
    if (body.action === 'create_checkout') {
      const result = await orchestrateRegistration(client, {
        ...body.registration,
        ...scope,
        channel: 'staff',
        actor: {
          canManageRegistrations: true,
          isAdmin: session.user.primaryRoleKey === 'admin',
          businessUnitIds: session.user.businessUnitIds,
        },
      });
      return NextResponse.json({ result }, {
        status: result.duplicate ? 200 : 201,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    if (body.action === 'create_hosted_link') {
      const result = await createHostedCollectionLink(client, {
        ...scope,
        paymentRequestId: body.paymentRequestId,
        idempotencyKey: body.idempotencyKey,
        environment: providerEnvironment(),
        baseUrl: deployedBaseUrl(request),
      });
      return NextResponse.json({ result }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
    }
    if (body.action === 'initiate_terminal_payment') {
      const result = await initiateSpinCollectionPayment(client, {
        ...scope,
        paymentRequestId: body.paymentRequestId,
        idempotencyKey: body.idempotencyKey,
        environment: providerEnvironment(),
        actorUserId: session.user.id,
      });
      return NextResponse.json({ result }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
    }
    if (body.action === 'recover_terminal_payment') {
      const result = await recoverSpinCollectionPayment(client, {
        ...scope,
        paymentRequestId: body.paymentRequestId,
        idempotencyKey: body.idempotencyKey,
        environment: providerEnvironment(),
        actorUserId: session.user.id,
      });
      return NextResponse.json({ result }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    if (body.action === 'record_manual_payment') {
      const result = await recordManualCollectionPayment(client, {
        ...scope,
        ...body.payment,
        actorUserId: session.user.id,
      });
      return NextResponse.json({ result }, {
        status: result.duplicate ? 200 : 201,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    throw createCrmError('Unsupported collections action.');
  } catch (caught) {
    return crmErrorResponse(caught);
  } finally {
    client?.release();
  }
}
