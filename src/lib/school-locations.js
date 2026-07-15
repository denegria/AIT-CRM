export const AIT_USA_SCHOOL_LOCATIONS = [
  'Bound Brook',
  'Plainfield',
  'Piscataway',
  'Flemington',
  'Online',
];

export const AIT_USA_CAMPAIGN_MARKETS = ['Madrid, Spain'];
export const AIT_USA_LOCATION_FILTER_VALUES = [
  ...AIT_USA_SCHOOL_LOCATIONS,
  ...AIT_USA_CAMPAIGN_MARKETS,
];

function clean(value = '') {
  return String(value || '').trim();
}

function normalize(value = '') {
  return clean(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

const SCHOOL_LOCATION_BY_KEY = new Map(
  AIT_USA_SCHOOL_LOCATIONS.map((location) => [normalize(location), location]),
);
const CAMPAIGN_MARKET_BY_KEY = new Map(
  AIT_USA_CAMPAIGN_MARKETS.map((market) => [normalize(market), market]),
);

export function schoolLocationOptions(currentValue = '') {
  const current = clean(currentValue);
  if (!current || AIT_USA_SCHOOL_LOCATIONS.includes(current)) {
    return AIT_USA_SCHOOL_LOCATIONS;
  }
  return [current, ...AIT_USA_SCHOOL_LOCATIONS];
}

export function campaignMarketOptions(currentValue = '') {
  const current = clean(currentValue);
  if (!current || AIT_USA_CAMPAIGN_MARKETS.includes(current)) {
    return AIT_USA_CAMPAIGN_MARKETS;
  }
  return [current, ...AIT_USA_CAMPAIGN_MARKETS];
}

export function canonicalAitUsaSchoolLocation(value = '') {
  return SCHOOL_LOCATION_BY_KEY.get(normalize(value)) || '';
}

export function canonicalAitUsaCampaignMarket(value = '') {
  return CAMPAIGN_MARKET_BY_KEY.get(normalize(value)) || '';
}

export function schoolLocationForContact(contact = {}) {
  return canonicalAitUsaSchoolLocation(contact.address) ||
    canonicalAitUsaSchoolLocation(contact.locationPreference) ||
    canonicalAitUsaSchoolLocation(contact.enrollmentSignals?.inquiry?.location);
}

export function marketRegionForContact(contact = {}) {
  const candidates = [
    contact.locationPreference,
    contact.enrollmentSignals?.inquiry?.location,
    contact.address,
  ];
  for (const value of candidates) {
    const current = clean(value);
    if (!current || canonicalAitUsaSchoolLocation(current)) continue;
    return canonicalAitUsaCampaignMarket(current) || current;
  }
  return '';
}

export function contactLocationValues(contact = {}) {
  return [...new Set([
    schoolLocationForContact(contact),
    marketRegionForContact(contact),
  ].filter(Boolean))];
}
