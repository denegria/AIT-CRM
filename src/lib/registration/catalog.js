export const REGISTRATION_CATALOG_VERSION = '2026-09-17.v1';
export const REGIONAL_PRICING_VERSION = '2026-09-17.v1';

export const REGISTRATION_ITEM_CODES = Object.freeze({
  PUBLIC_BUNDLE: 'registration_book_bundle',
  REGISTRATION_ONLY: 'registration_only',
  BOOK_ONLY: 'book_only',
  TUITION_PREPAYMENT: 'tuition_prepayment_four_week',
});

export const REGISTRATION_CHANNELS = Object.freeze({
  PUBLIC: 'public',
  STAFF: 'staff',
});

export const TUITION_REGION_RATES_CENTS = Object.freeze({
  united_states: 19500,
  europe: 17500,
  latinoamerica: 14500,
});

const EUROPE_COUNTRY_CODES = Object.freeze([
  'AD', 'AL', 'AT', 'AX', 'BA', 'BE', 'BG', 'BY', 'CH', 'CY', 'CZ', 'DE', 'DK',
  'EE', 'ES', 'FI', 'FO', 'FR', 'GB', 'GG', 'GI', 'GR', 'HR', 'HU', 'IE', 'IM',
  'IS', 'IT', 'JE', 'LI', 'LT', 'LU', 'LV', 'MC', 'MD', 'ME', 'MK', 'MT', 'NL',
  'NO', 'PL', 'PT', 'RO', 'RS', 'RU', 'SE', 'SI', 'SJ', 'SK', 'SM', 'UA', 'VA',
  'XK',
]);

const LATINOAMERICA_COUNTRY_CODES = Object.freeze([
  'AR', 'BO', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'GT', 'HN', 'MX', 'NI', 'PA',
  'PE', 'PR', 'PY', 'SV', 'UY', 'VE',
]);

export const REGIONAL_COUNTRY_MAP = Object.freeze({
  US: 'united_states',
  ...Object.fromEntries(EUROPE_COUNTRY_CODES.map((code) => [code, 'europe'])),
  ...Object.fromEntries(LATINOAMERICA_COUNTRY_CODES.map((code) => [code, 'latinoamerica'])),
});

export const REGISTRATION_CATALOG = Object.freeze({
  [REGISTRATION_ITEM_CODES.PUBLIC_BUNDLE]: Object.freeze({
    code: REGISTRATION_ITEM_CODES.PUBLIC_BUNDLE,
    label: 'Registration and book bundle',
    amountCents: 9500,
    visibility: 'public',
    taxable: false,
    ledgerTreatment: 'charge',
    chargeType: 'registration_book_bundle',
  }),
  [REGISTRATION_ITEM_CODES.REGISTRATION_ONLY]: Object.freeze({
    code: REGISTRATION_ITEM_CODES.REGISTRATION_ONLY,
    label: 'Registration',
    amountCents: 5500,
    visibility: 'staff',
    taxable: false,
    ledgerTreatment: 'charge',
    chargeType: 'registration',
  }),
  [REGISTRATION_ITEM_CODES.BOOK_ONLY]: Object.freeze({
    code: REGISTRATION_ITEM_CODES.BOOK_ONLY,
    label: 'Book',
    amountCents: 5500,
    visibility: 'staff',
    taxable: false,
    ledgerTreatment: 'charge',
    chargeType: 'book',
  }),
});

export class RegistrationCatalogError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'RegistrationCatalogError';
    this.code = code;
    this.status = status;
  }
}

function cleanCode(value) {
  return String(value || '').trim().toUpperCase();
}

function cleanItemCode(value) {
  return String(value || '').trim().toLowerCase();
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function moneyFromCents(cents) {
  return (cents / 100).toFixed(2);
}

function countryDecision(countryCode) {
  const normalized = cleanCode(countryCode);
  const region = REGIONAL_COUNTRY_MAP[normalized] || null;
  return { countryCode: normalized || null, region, supported: Boolean(region) };
}

export function resolveRegionalPricing({ residenceCountryCode, billingCountryCode } = {}) {
  const residence = countryDecision(residenceCountryCode);
  const billing = countryDecision(billingCountryCode);
  const supplied = [residence, billing].filter((entry) => entry.countryCode);

  if (!supplied.length) {
    return deepFreeze({
      status: 'advisor_required',
      reason: 'pricing_country_required',
      residenceCountryCode: null,
      billingCountryCode: null,
      region: null,
    });
  }
  const unsupported = supplied.find((entry) => !entry.supported);
  if (unsupported) {
    return deepFreeze({
      status: 'advisor_required',
      reason: 'unsupported_pricing_country',
      residenceCountryCode: residence.countryCode,
      billingCountryCode: billing.countryCode,
      unsupportedCountryCode: unsupported.countryCode,
      region: null,
    });
  }
  const regions = [...new Set(supplied.map((entry) => entry.region))];
  if (regions.length !== 1) {
    return deepFreeze({
      status: 'advisor_required',
      reason: 'pricing_country_region_conflict',
      residenceCountryCode: residence.countryCode,
      billingCountryCode: billing.countryCode,
      region: null,
    });
  }
  const region = regions[0];
  return deepFreeze({
    status: 'eligible',
    reason: null,
    residenceCountryCode: residence.countryCode,
    billingCountryCode: billing.countryCode,
    region,
    tuitionRateCents: TUITION_REGION_RATES_CENTS[region],
    currency: 'USD',
    pricingVersion: REGIONAL_PRICING_VERSION,
  });
}
function selectedCatalogItems(channel, itemCodes) {
  const codes = [...new Set((Array.isArray(itemCodes) ? itemCodes : []).map(cleanItemCode).filter(Boolean))];
  if (!codes.length) throw new RegistrationCatalogError('catalog_item_required', 'At least one registration item is required.');
  const selected = codes.map((code) => {
    const item = REGISTRATION_CATALOG[code];
    if (!item) throw new RegistrationCatalogError('catalog_item_not_found', `Registration item is not supported: ${code}.`);
    if (channel === REGISTRATION_CHANNELS.PUBLIC && item.visibility !== 'public') {
      throw new RegistrationCatalogError('catalog_item_forbidden', 'The requested registration item is staff-only.', 403);
    }
    return item;
  });
  const codesSet = new Set(codes);
  if (codesSet.has(REGISTRATION_ITEM_CODES.PUBLIC_BUNDLE)
    && (codesSet.has(REGISTRATION_ITEM_CODES.REGISTRATION_ONLY) || codesSet.has(REGISTRATION_ITEM_CODES.BOOK_ONLY))) {
    throw new RegistrationCatalogError('catalog_item_conflict', 'The bundle cannot be combined with individual registration or book items.');
  }
  return selected;
}

export function calculateRegistrationQuote({
  channel,
  itemCodes,
  includeTuitionPrepayment = false,
  residenceCountryCode,
  billingCountryCode,
} = {}) {
  if (!Object.values(REGISTRATION_CHANNELS).includes(channel)) {
    throw new RegistrationCatalogError('registration_channel_invalid', 'Registration channel is not supported.');
  }
  const regionalPricing = resolveRegionalPricing({ residenceCountryCode, billingCountryCode });
  if (regionalPricing.status !== 'eligible') {
    return deepFreeze({
      status: 'advisor_required',
      reason: regionalPricing.reason,
      catalogVersion: REGISTRATION_CATALOG_VERSION,
      pricingVersion: REGIONAL_PRICING_VERSION,
      regionalPricing,
      lines: [],
      totalCents: 0,
      total: '0.00',
      currency: 'USD',
    });
  }

  const lines = selectedCatalogItems(channel, itemCodes).map((item) => ({
    code: item.code,
    label: item.label,
    quantity: 1,
    unitAmountCents: item.amountCents,
    amountCents: item.amountCents,
    amount: moneyFromCents(item.amountCents),
    currency: 'USD',
    taxable: item.taxable,
    ledgerTreatment: item.ledgerTreatment,
    chargeType: item.chargeType,
  }));
  if (includeTuitionPrepayment) {
    lines.push({
      code: REGISTRATION_ITEM_CODES.TUITION_PREPAYMENT,
      label: 'First four-week tuition prepayment',
      quantity: 1,
      unitAmountCents: regionalPricing.tuitionRateCents,
      amountCents: regionalPricing.tuitionRateCents,
      amount: moneyFromCents(regionalPricing.tuitionRateCents),
      currency: 'USD',
      taxable: false,
      ledgerTreatment: 'unapplied_credit',
      chargeType: null,
    });
  }
  const totalCents = lines.reduce((total, line) => total + line.amountCents, 0);
  return deepFreeze({
    status: 'quoted',
    reason: null,
    catalogVersion: REGISTRATION_CATALOG_VERSION,
    pricingVersion: REGIONAL_PRICING_VERSION,
    channel,
    regionalPricing,
    lines,
    totalCents,
    total: moneyFromCents(totalCents),
    currency: 'USD',
    taxableAmountCents: 0,
    taxCents: 0,
  });
}
