const ACTIONS = new Set([
  'claim',
  'save_note',
  'mark_digital_delivered',
  'mark_ready',
  'mark_picked_up',
  'mark_shipped',
]);

export class FulfillmentError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'FulfillmentError';
    this.code = code;
    this.status = status;
  }
}

function text(value, maxLength, label, { required = false } = {}) {
  const clean = String(value || '').trim();
  if (required && !clean) throw new FulfillmentError('fulfillment_input_required', `${label} is required.`);
  if (clean.length > maxLength) throw new FulfillmentError('fulfillment_input_too_long', `${label} is too long.`);
  return clean || null;
}

function completed(row) {
  const digitalDone = row.digitalStatus === 'not_required' || row.digitalStatus === 'delivered';
  const physicalDone = row.physicalStatus === 'not_required'
    || row.physicalStatus === 'picked_up'
    || row.physicalStatus === 'shipped';
  return digitalDone && physicalDone;
}

export function applyFulfillmentAction(current, input = {}) {
  const action = String(input.action || '').trim();
  if (!ACTIONS.has(action)) throw new FulfillmentError('fulfillment_action_invalid', 'Fulfillment action is not supported.');
  if (current.status === 'payment_pending') {
    throw new FulfillmentError('fulfillment_payment_pending', 'Fulfillment work cannot begin before payment is verified.', 409);
  }
  const next = {
    status: current.status,
    digitalStatus: current.digitalStatus,
    physicalStatus: current.physicalStatus,
    assignedUserId: current.assignedUserId || null,
    carrier: current.carrier || null,
    trackingReference: current.trackingReference || null,
    notes: current.notes || null,
    readyAt: current.readyAt || null,
    digitalSentAt: current.digitalSentAt || null,
    shippedAt: current.shippedAt || null,
    pickedUpAt: current.pickedUpAt || null,
  };
  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  if (Number.isNaN(now.getTime())) throw new FulfillmentError('fulfillment_timestamp_invalid', 'A valid fulfillment timestamp is required.');

  if (action === 'claim') {
    next.assignedUserId = text(input.actorUserId, 80, 'Actor user', { required: true });
  } else if (action === 'save_note') {
    next.notes = text(input.notes, 2000, 'Operational note');
  } else if (action === 'mark_digital_delivered') {
    if (current.digitalStatus !== 'pending') {
      throw new FulfillmentError('digital_delivery_not_pending', 'Digital delivery is not pending for this item.', 409);
    }
    next.digitalStatus = 'delivered';
    next.digitalSentAt = now;
  } else if (action === 'mark_ready') {
    if (current.deliveryMode !== 'pickup' || current.physicalStatus !== 'pending') {
      throw new FulfillmentError('pickup_not_pending', 'This item is not awaiting pickup preparation.', 409);
    }
    next.physicalStatus = 'ready';
    next.readyAt = now;
  } else if (action === 'mark_picked_up') {
    if (current.deliveryMode !== 'pickup' || current.physicalStatus !== 'ready') {
      throw new FulfillmentError('pickup_not_ready', 'The book must be marked ready before pickup.', 409);
    }
    next.physicalStatus = 'picked_up';
    next.pickedUpAt = now;
  } else if (action === 'mark_shipped') {
    if (current.deliveryMode !== 'shipment' || current.physicalStatus !== 'pending') {
      throw new FulfillmentError('shipment_not_pending', 'This item is not awaiting shipment.', 409);
    }
    next.carrier = text(input.carrier, 120, 'Carrier', { required: true });
    next.trackingReference = text(input.trackingReference, 240, 'Tracking reference', { required: true });
    next.physicalStatus = 'shipped';
    next.shippedAt = now;
  }

  if (!['claim', 'save_note'].includes(action) && !next.assignedUserId) {
    next.assignedUserId = text(input.actorUserId, 80, 'Actor user', { required: true });
  }
  if (!['claim', 'save_note'].includes(action) && input.notes !== undefined) {
    next.notes = text(input.notes, 2000, 'Operational note');
  }
  next.status = completed(next) ? 'completed' : 'in_progress';
  if (action === 'claim' && current.status === 'pending') next.status = 'in_progress';
  if (action === 'save_note') next.status = current.status;
  return Object.freeze(next);
}

export function normalizeFulfillmentLane(value) {
  const lane = String(value || '').trim().toLowerCase();
  return ['digital', 'pickup', 'shipment'].includes(lane) ? lane : 'digital';
}

export function normalizeFulfillmentPage(value, fallback = 1) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
