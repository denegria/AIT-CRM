export const AIT_USA_SCHOOL_LOCATIONS = [
  'Bound Brook',
  'Plainfield',
  'Piscataway',
  'Flemington',
  'Online',
];

export const AIT_USA_CAMPAIGN_MARKETS = ['Madrid, Spain'];

function clean(value = '') {
  return String(value || '').trim();
}

function normalize(value = '') {
  return clean(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

const SCHOOL_LOCATION_BY_KEY = new Map(
  AIT_USA_SCHOOL_LOCATIONS.map((location) => [normalize(location), location]),
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

export function schoolLocationForContact(contact = {}) {
  return canonicalAitUsaSchoolLocation(contact.address) ||
    canonicalAitUsaSchoolLocation(contact.locationPreference) ||
    canonicalAitUsaSchoolLocation(contact.enrollmentSignals?.inquiry?.location);
}
