export const AIT_USA_SCHOOL_LOCATIONS = [
  'Bound Brook',
  'Plainfield',
  'Piscataway',
  'Flemington',
  'Online',
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
export function schoolLocationOptions() {
  return [...AIT_USA_SCHOOL_LOCATIONS];
}

export function canonicalAitUsaSchoolLocation(value = '') {
  return SCHOOL_LOCATION_BY_KEY.get(normalize(value)) || '';
}

export function schoolLocationForContact(contact = {}) {
  return canonicalAitUsaSchoolLocation(contact.address);
}

export function studentLocationForContact(contact = {}) {
  const candidates = [
    contact.locationPreference,
    contact.enrollmentSignals?.inquiry?.location,
  ];
  for (const value of candidates) {
    const current = clean(value);
    if (current) return current;
  }
  const legacyAddress = clean(contact.address);
  return legacyAddress && !canonicalAitUsaSchoolLocation(legacyAddress) ? legacyAddress : '';
}
