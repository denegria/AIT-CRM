import { applyFulfillmentAction, FulfillmentError, normalizeFulfillmentLane, normalizeFulfillmentPage } from './model.js';

function value(row, snake, camel = snake) {
  return row?.[snake] ?? row?.[camel] ?? null;
}

function normalizedRecord(row) {
  return {
    id: row.id,
    organizationId: value(row, 'organization_id', 'organizationId'),
    businessUnitId: value(row, 'business_unit_id', 'businessUnitId'),
    studentContactId: value(row, 'student_contact_id', 'studentContactId'),
    enrollmentId: value(row, 'enrollment_id', 'enrollmentId'),
    paymentRequestId: value(row, 'payment_request_id', 'paymentRequestId'),
    providerTransactionId: value(row, 'provider_transaction_id', 'providerTransactionId'),
    deliveryMode: value(row, 'delivery_mode', 'deliveryMode'),
    status: value(row, 'status'),
    digitalStatus: value(row, 'digital_status', 'digitalStatus'),
    physicalStatus: value(row, 'physical_status', 'physicalStatus'),
    shippingAddressSnapshot: value(row, 'shipping_address_snapshot_json', 'shippingAddressSnapshotJson') || {},
    assignedUserId: value(row, 'assigned_user_id', 'assignedUserId'),
    carrier: value(row, 'carrier'),
    trackingReference: value(row, 'tracking_reference', 'trackingReference'),
    notes: value(row, 'notes'),
    readyAt: value(row, 'ready_at', 'readyAt'),
    digitalSentAt: value(row, 'digital_sent_at', 'digitalSentAt'),
    shippedAt: value(row, 'shipped_at', 'shippedAt'),
    pickedUpAt: value(row, 'picked_up_at', 'pickedUpAt'),
    createdAt: value(row, 'created_at', 'createdAt'),
    updatedAt: value(row, 'updated_at', 'updatedAt'),
  };
}

function fulfillmentInvariant(existing, input) {
  const same = value(existing, 'student_contact_id', 'studentContactId') === input.studentContactId
    && value(existing, 'enrollment_id', 'enrollmentId') === input.enrollmentId
    && value(existing, 'payment_request_id', 'paymentRequestId') === input.paymentRequestId
    && value(existing, 'delivery_mode', 'deliveryMode') === input.plan.deliveryMode;
  if (!same) {
    throw new FulfillmentError('fulfillment_idempotency_conflict', 'Existing fulfillment does not match the registration.', 409);
  }
}

export async function createBookFulfillment(client, input) {
  const digitalStatus = input.plan.requiresDigitalDelivery ? 'pending' : 'not_required';
  const physicalStatus = input.plan.requiresPhysicalDelivery ? 'pending' : 'not_required';
  const address = input.plan.shippingAddressSnapshot || {};
  const inserted = await client.query(
    `insert into book_fulfillments
      (organization_id, business_unit_id, student_contact_id, enrollment_id, payment_request_id,
       delivery_mode, status, digital_status, physical_status, shipping_address_snapshot_json, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, 'payment_pending', $7, $8, $9::jsonb, $10)
     on conflict (organization_id, business_unit_id, payment_request_id) do nothing
     returning *`,
    [
      input.organizationId,
      input.businessUnitId,
      input.studentContactId,
      input.enrollmentId,
      input.paymentRequestId,
      input.plan.deliveryMode,
      digitalStatus,
      physicalStatus,
      JSON.stringify(address),
      input.idempotencyKey,
    ],
  );
  let record = inserted.rows[0];
  if (!record) {
    const existing = await client.query(
      `select * from book_fulfillments
        where organization_id = $1 and business_unit_id = $2 and payment_request_id = $3
        limit 1`,
      [input.organizationId, input.businessUnitId, input.paymentRequestId],
    );
    record = existing.rows[0];
    fulfillmentInvariant(record, input);
  }
  return normalizedRecord(record);
}

export async function loadRegistrationFulfillment(client, { organizationId, businessUnitId, paymentRequestId }) {
  const result = await client.query(
    `select * from book_fulfillments
      where organization_id = $1 and business_unit_id = $2 and payment_request_id = $3
      limit 1`,
    [organizationId, businessUnitId, paymentRequestId],
  );
  return result.rows[0] ? normalizedRecord(result.rows[0]) : null;
}

export async function activateBookFulfillmentForVerifiedPayment(client, input) {
  const result = await client.query(
    `update book_fulfillments
        set provider_transaction_id = coalesce(provider_transaction_id, $1),
            status = case when status = 'payment_pending' then 'pending' else status end,
            updated_at = now()
      where organization_id = $2 and business_unit_id = $3 and payment_request_id = $4
        and (provider_transaction_id is null or provider_transaction_id = $1)
      returning *`,
    [input.providerTransactionId, input.organizationId, input.businessUnitId, input.paymentRequestId],
  );
  if (result.rows[0]) return normalizedRecord(result.rows[0]);
  const existing = await loadRegistrationFulfillment(client, input);
  if (!existing) return null;
  throw new FulfillmentError('fulfillment_transaction_conflict', 'Fulfillment is linked to a different verified transaction.', 409);
}

const FULFILLMENT_QUEUE_SQL = `
with eligible as (
  select
    f.*,
    c.name as student_name,
    owner.name as assigned_user_name,
    t.verified_at as payment_verified_at,
    case when $3 = 'shipment' then f.shipping_address_snapshot_json else '{}'::jsonb end as visible_shipping_address
  from book_fulfillments f
  join business_units bu
    on bu.id = f.business_unit_id and bu.organization_id = f.organization_id and bu.name ~* 'ait\\s*usa'
  join contacts c
    on c.id = f.student_contact_id and c.organization_id = f.organization_id and c.archived_at is null
  left join users owner on owner.id = f.assigned_user_id
  left join provider_transactions t
    on t.id = f.provider_transaction_id and t.organization_id = f.organization_id and t.business_unit_id = f.business_unit_id
  where f.organization_id = $1
    and ($2::uuid[] is null or f.business_unit_id = any($2::uuid[]))
    and f.status in ('pending', 'in_progress')
    and (
      ($3 = 'digital' and f.digital_status = 'pending')
      or ($3 = 'pickup' and f.delivery_mode = 'pickup' and f.physical_status in ('pending', 'ready'))
      or ($3 = 'shipment' and f.delivery_mode = 'shipment' and f.physical_status = 'pending')
    )
), counted as (
  select count(*)::int as total from eligible
)
select eligible.*, counted.total
from eligible cross join counted
order by eligible.created_at asc, eligible.id asc
limit $4 offset $5`;

const FULFILLMENT_QUEUE_COUNTS_SQL = `
select
  count(*) filter (where f.digital_status = 'pending')::int as digital,
  count(*) filter (where f.delivery_mode = 'pickup' and f.physical_status in ('pending', 'ready'))::int as pickup,
  count(*) filter (where f.delivery_mode = 'shipment' and f.physical_status = 'pending')::int as shipment
from book_fulfillments f
join business_units bu
  on bu.id = f.business_unit_id and bu.organization_id = f.organization_id and bu.name ~* 'ait\\s*usa'
where f.organization_id = $1
  and ($2::uuid[] is null or f.business_unit_id = any($2::uuid[]))
  and f.status in ('pending', 'in_progress')`;

export async function loadBookFulfillmentQueue(client, {
  organizationId,
  businessUnitIds = null,
  lane = 'digital',
  page = 1,
  pageSize = 25,
} = {}) {
  if (!organizationId) throw new FulfillmentError('organization_required', 'Organization is required.');
  const scopedIds = Array.isArray(businessUnitIds) ? businessUnitIds : null;
  if (scopedIds && !scopedIds.length) return { lane: normalizeFulfillmentLane(lane), items: [], total: 0, page: 1, pageSize };
  const normalizedLane = normalizeFulfillmentLane(lane);
  const normalizedPage = normalizeFulfillmentPage(page);
  const normalizedPageSize = Math.min(normalizeFulfillmentPage(pageSize, 25), 100);
  const [countsResult, result] = await Promise.all([
    client.query(FULFILLMENT_QUEUE_COUNTS_SQL, [organizationId, scopedIds]),
    client.query(FULFILLMENT_QUEUE_SQL, [
    organizationId,
    scopedIds,
    normalizedLane,
    normalizedPageSize,
    (normalizedPage - 1) * normalizedPageSize,
    ]),
  ]);
  const counts = countsResult.rows[0] || {};
  return {
    lane: normalizedLane,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    total: Number(result.rows[0]?.total || 0),
    counts: {
      digital: Number(counts.digital || 0),
      pickup: Number(counts.pickup || 0),
      shipment: Number(counts.shipment || 0),
    },
    items: result.rows.map((row) => ({
      ...normalizedRecord(row),
      studentName: row.student_name,
      assignedUserName: row.assigned_user_name || null,
      paymentVerifiedAt: row.payment_verified_at || null,
      shippingAddressSnapshot: row.visible_shipping_address || {},
    })),
  };
}

export async function transitionBookFulfillment(client, input) {
  if (!input.organizationId || !input.businessUnitId || !input.fulfillmentId || !input.actorUserId) {
    throw new FulfillmentError('fulfillment_scope_required', 'Fulfillment scope and actor are required.');
  }
  if (!input.expectedUpdatedAt) {
    throw new FulfillmentError('fulfillment_version_required', 'Refresh the worklist before changing this item.', 409);
  }
  await client.query('begin');
  try {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`book-fulfillment:${input.fulfillmentId}`]);
    const loaded = await client.query(
      `select * from book_fulfillments
        where id = $1 and organization_id = $2 and business_unit_id = $3
        for update`,
      [input.fulfillmentId, input.organizationId, input.businessUnitId],
    );
    if (!loaded.rows[0]) throw new FulfillmentError('fulfillment_not_found', 'Fulfillment item was not found.', 404);
    const current = normalizedRecord(loaded.rows[0]);
    const currentVersion = new Date(current.updatedAt).toISOString();
    const expectedVersion = new Date(input.expectedUpdatedAt).toISOString();
    if (currentVersion !== expectedVersion) {
      throw new FulfillmentError('fulfillment_stale_write', 'This fulfillment item changed. Refresh the worklist and try again.', 409);
    }
    const next = applyFulfillmentAction(current, input);
    const updated = await client.query(
      `update book_fulfillments
          set status = $1,
              digital_status = $2,
              physical_status = $3,
              assigned_user_id = $4,
              carrier = $5,
              tracking_reference = $6,
              notes = $7,
              ready_at = $8,
              digital_sent_at = $9,
              shipped_at = $10,
              picked_up_at = $11,
              updated_at = now()
        where id = $12 and organization_id = $13 and business_unit_id = $14
        returning *`,
      [
        next.status,
        next.digitalStatus,
        next.physicalStatus,
        next.assignedUserId,
        next.carrier,
        next.trackingReference,
        next.notes,
        next.readyAt,
        next.digitalSentAt,
        next.shippedAt,
        next.pickedUpAt,
        input.fulfillmentId,
        input.organizationId,
        input.businessUnitId,
      ],
    );
    await client.query('commit');
    return normalizedRecord(updated.rows[0]);
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

export { FULFILLMENT_QUEUE_COUNTS_SQL, FULFILLMENT_QUEUE_SQL };
