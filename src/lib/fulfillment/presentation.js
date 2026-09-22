const FULFILLMENT_LANES = Object.freeze(['digital', 'pickup', 'shipment']);

const STAGES = Object.freeze({
  digital: Object.freeze({
    label: 'Needs manual delivery',
    nextAction: 'Confirm access sent',
    action: 'mark_digital_delivered',
    completion: true,
  }),
  pickupPending: Object.freeze({
    label: 'Preparing for pickup',
    nextAction: 'Mark ready',
    action: 'mark_ready',
    completion: false,
  }),
  pickupReady: Object.freeze({
    label: 'Ready for pickup',
    nextAction: 'Mark picked up',
    action: 'mark_picked_up',
    completion: true,
  }),
  shipment: Object.freeze({
    label: 'Shipment pending',
    nextAction: 'Mark shipped',
    action: 'mark_shipped',
    completion: true,
  }),
});

export function allFulfillmentLanesClear(counts = {}) {
  return FULFILLMENT_LANES.every((lane) => (
    Object.hasOwn(counts, lane) && Number(counts[lane]) === 0
  ));
}

export function fulfillmentStage(item = {}, lane = '') {
  if (lane === 'digital') return STAGES.digital;
  if (lane === 'pickup') {
    return item.physicalStatus === 'ready' ? STAGES.pickupReady : STAGES.pickupPending;
  }
  return STAGES.shipment;
}
