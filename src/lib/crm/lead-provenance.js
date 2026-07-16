export const INBOUND_LEAD_SOURCE_TYPES = Object.freeze([
  'website_form',
  'facebook_lead_ads',
  'facebook_webhook',
  'facebook_messenger',
  'whatsapp',
  'whatsapp_inbound',
]);

export const HISTORICAL_IMPORT_SOURCE_TYPES = Object.freeze([
  'import',
  'csv',
  'spreadsheet',
  'xlsx',
  'wix_historical_import',
]);

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

export function isCurrentInboundLeadProvenance({ sourceType, historicalImport = false } = {}) {
  const normalizedSourceType = normalizeText(sourceType);
  if (historicalImport || HISTORICAL_IMPORT_SOURCE_TYPES.includes(normalizedSourceType)) return false;
  return INBOUND_LEAD_SOURCE_TYPES.includes(normalizedSourceType);
}
