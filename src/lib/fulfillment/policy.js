export const LEARNING_MODALITIES = Object.freeze({
  IN_PERSON: 'in_person',
  ONLINE: 'online',
});

export const FULFILLMENT_MODES = Object.freeze({
  PICKUP: 'pickup',
  SHIPMENT: 'shipment',
  DIGITAL: 'digital',
});

export class FulfillmentPolicyError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'FulfillmentPolicyError';
    this.code = code;
    this.status = status;
  }
}

function clean(value) {
  return String(value || '').trim();
}

function hasAddressInput(value) {
  return Boolean(value && typeof value === 'object' && Object.values(value).some((entry) => clean(entry)));
}

function shippingAddressSnapshot(value = {}) {
  const countryCode = clean(value.countryCode).toUpperCase();
  const state = clean(value.state).toUpperCase();
  const postalCode = clean(value.postalCode);
  const snapshot = {
    recipientName: clean(value.recipientName).replace(/\s+/g, ' '),
    addressLine1: clean(value.addressLine1),
    addressLine2: clean(value.addressLine2),
    city: clean(value.city),
    state,
    postalCode,
    countryCode,
  };
  if (!snapshot.recipientName || !snapshot.addressLine1 || !snapshot.city || !state || !postalCode) {
    throw new FulfillmentPolicyError('shipping_address_incomplete', 'A complete shipping address is required for United States online registration.');
  }
  if (countryCode !== 'US') {
    throw new FulfillmentPolicyError('shipping_country_invalid', 'The shipping address for this fulfillment policy must be in the United States.');
  }
  if (!/^[A-Z]{2}$/.test(state)) {
    throw new FulfillmentPolicyError('shipping_state_invalid', 'A two-letter United States state code is required.');
  }
  if (!/^\d{5}(?:-\d{4})?$/.test(postalCode)) {
    throw new FulfillmentPolicyError('shipping_postal_code_invalid', 'A valid United States postal code is required.');
  }
  return Object.freeze(snapshot);
}

export function resolveBookFulfillmentPlan({
  residenceCountryCode,
  learningModality,
  shippingAddress,
} = {}) {
  const countryCode = clean(residenceCountryCode).toUpperCase();
  const modality = clean(learningModality).toLowerCase();
  if (!countryCode) {
    throw new FulfillmentPolicyError('fulfillment_country_required', 'Residence country is required to determine book fulfillment.');
  }
  if (!Object.values(LEARNING_MODALITIES).includes(modality)) {
    throw new FulfillmentPolicyError('learning_modality_invalid', 'Learning modality must be online or in_person.');
  }

  let deliveryMode;
  let requiresDigitalDelivery;
  if (countryCode !== 'US') {
    deliveryMode = FULFILLMENT_MODES.DIGITAL;
    requiresDigitalDelivery = true;
  } else if (modality === LEARNING_MODALITIES.IN_PERSON) {
    deliveryMode = FULFILLMENT_MODES.PICKUP;
    requiresDigitalDelivery = false;
  } else {
    deliveryMode = FULFILLMENT_MODES.SHIPMENT;
    requiresDigitalDelivery = true;
  }

  if (deliveryMode !== FULFILLMENT_MODES.SHIPMENT && hasAddressInput(shippingAddress)) {
    throw new FulfillmentPolicyError(
      'shipping_address_not_allowed',
      'A shipping address is collected only when physical shipment is required.',
    );
  }

  return Object.freeze({
    policyVersion: '2026-09-18.v1',
    residenceCountryCode: countryCode,
    learningModality: modality,
    deliveryMode,
    requiresDigitalDelivery,
    requiresPhysicalDelivery: deliveryMode !== FULFILLMENT_MODES.DIGITAL,
    shippingAddressSnapshot: deliveryMode === FULFILLMENT_MODES.SHIPMENT
      ? shippingAddressSnapshot(shippingAddress)
      : null,
  });
}
