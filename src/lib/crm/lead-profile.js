export const LEAD_PROFILE_FIELDS = Object.freeze([
  'programInterest',
  'preferredDay',
  'preferredSchedule',
  'testInterest',
  'educationLevel',
  'schoolName',
  'locationPreference',
  'profileDetails',
  'sourceDetail',
]);

export const LEAD_PROFILE_COLUMN_BY_FIELD = Object.freeze({
  programInterest: 'program_interest',
  preferredDay: 'preferred_day',
  preferredSchedule: 'preferred_schedule',
  testInterest: 'test_interest',
  educationLevel: 'education_level',
  schoolName: 'school_name',
  locationPreference: 'location_preference',
  profileDetails: 'profile_details',
  sourceDetail: 'source_detail',
});

const PROFILE_FIELD_LABELS = Object.freeze({
  programInterest: 'Program',
  preferredDay: 'Preferred day',
  preferredSchedule: 'Preferred schedule',
  testInterest: 'Test',
  educationLevel: 'Level',
  schoolName: 'School',
  locationPreference: 'Market / region',
  profileDetails: 'Details',
  sourceDetail: 'Source detail',
});

const PROFILE_KEY_ALIASES = Object.freeze({
  programInterest: [
    'program_interest',
    'program',
    'programa',
    'program_of_interest',
    'programinterest',
    'service',
    'service_type',
    'servicetype',
    'interest',
  ],
  preferredDay: [
    'preferred_day',
    'preferred_days',
    'day_preference',
    'preferredday',
    'day',
    'days',
    'dia',
  ],
  preferredSchedule: [
    'preferred_schedule',
    'schedule_preference',
    'preferred_time',
    'preferred_time_of_day',
    'preferredschedule',
    'schedule',
    'time',
    'horario',
  ],
  testInterest: [
    'test_interest',
    'test',
    'exam',
    'placement_test',
    'english_test',
  ],
  educationLevel: [
    'education_level',
    'level',
    'english_level',
    'language_level',
    'student_level',
    'nivel',
  ],
  schoolName: [
    'school_name',
    'school',
    'current_school',
    'escuela',
  ],
  locationPreference: [
    'location_preference',
    'location',
    'campus',
    'city',
    'address',
    'ubicacion',
  ],
  profileDetails: [
    'profile_details',
    'details',
    'message',
    'notes',
    'comments',
    'description',
  ],
  sourceDetail: [
    'source_detail',
    'source',
    'source_name',
    'form_name',
  ],
});

function cleanText(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeKey(value = '') {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function firstText(...values) {
  return values.map(cleanText).find(Boolean) || '';
}

function valueForAliases(valuesByKey, aliases = []) {
  for (const alias of aliases) {
    const value = valuesByKey.get(normalizeKey(alias));
    if (value) return value;
  }
  return '';
}

function compactPatch(patch = {}, { allowClear = false } = {}) {
  return Object.fromEntries(
    LEAD_PROFILE_FIELDS
      .filter((field) => Object.prototype.hasOwnProperty.call(patch, field))
      .map((field) => [field, cleanText(patch[field])])
      .filter(([, value]) => allowClear || Boolean(value)),
  );
}

export function leadProfilePatchFromPayload(payload = {}, { allowClear = false } = {}) {
  const source = payload.leadProfile && typeof payload.leadProfile === 'object'
    ? payload.leadProfile
    : payload;
  return compactPatch(source, { allowClear });
}

export function leadProfilePatchToDbValues(patch = {}) {
  return Object.fromEntries(
    Object.entries(patch)
      .filter(([field]) => LEAD_PROFILE_COLUMN_BY_FIELD[field])
      .map(([field, value]) => [LEAD_PROFILE_COLUMN_BY_FIELD[field], cleanText(value) || null]),
  );
}

export function leadProfilePatchToDrizzleValues(patch = {}) {
  return Object.fromEntries(
    Object.entries(patch)
      .filter(([field]) => LEAD_PROFILE_FIELDS.includes(field))
      .map(([field, value]) => [field, cleanText(value) || null]),
  );
}

export function leadProfileFromLeadRow(lead = null) {
  if (!lead) return {};
  return Object.fromEntries(
    LEAD_PROFILE_FIELDS.map((field) => [field, cleanText(lead[field])]).filter(([, value]) => value),
  );
}

export function leadProfileForPayload(lead = null) {
  return Object.fromEntries(LEAD_PROFILE_FIELDS.map((field) => [field, cleanText(lead?.[field])]));
}

export function leadProfileSummary(patch = {}) {
  return Object.entries(patch)
    .filter(([field, value]) => LEAD_PROFILE_FIELDS.includes(field) && cleanText(value))
    .map(([field, value]) => `${PROFILE_FIELD_LABELS[field] || field}: ${cleanText(value)}`)
    .join('; ');
}

export function leadProfilePatchFromWebsiteLead(lead = {}) {
  const fields = lead.formFields && typeof lead.formFields === 'object' ? lead.formFields : {};
  const valuesByKey = new Map();
  Object.entries(fields).forEach(([key, value]) => {
    const text = Array.isArray(value) ? value.map(cleanText).filter(Boolean).join(', ') : cleanText(value);
    if (text) valuesByKey.set(normalizeKey(key), text);
  });

  return compactPatch({
    programInterest: firstText(lead.service, valueForAliases(valuesByKey, PROFILE_KEY_ALIASES.programInterest)),
    preferredDay: valueForAliases(valuesByKey, PROFILE_KEY_ALIASES.preferredDay),
    preferredSchedule: valueForAliases(valuesByKey, PROFILE_KEY_ALIASES.preferredSchedule),
    testInterest: valueForAliases(valuesByKey, PROFILE_KEY_ALIASES.testInterest),
    educationLevel: firstText(lead.age ? `Age ${lead.age}` : '', valueForAliases(valuesByKey, PROFILE_KEY_ALIASES.educationLevel)),
    schoolName: valueForAliases(valuesByKey, PROFILE_KEY_ALIASES.schoolName),
    locationPreference: firstText(lead.address, valueForAliases(valuesByKey, PROFILE_KEY_ALIASES.locationPreference)),
    profileDetails: firstText(lead.message, valueForAliases(valuesByKey, PROFILE_KEY_ALIASES.profileDetails)),
    sourceDetail: firstText(lead.sourceName, lead.sourceKey),
  });
}

export function leadProfilePatchFromMetaFieldData(fieldData = []) {
  const valuesByKey = new Map();
  for (const field of fieldData || []) {
    const key = normalizeKey(field?.name);
    const values = Array.isArray(field?.values)
      ? field.values.map(cleanText).filter(Boolean)
      : [];
    if (key && values.length) valuesByKey.set(key, values.join(', '));
  }

  return compactPatch({
    programInterest: valueForAliases(valuesByKey, PROFILE_KEY_ALIASES.programInterest),
    preferredDay: valueForAliases(valuesByKey, PROFILE_KEY_ALIASES.preferredDay),
    preferredSchedule: valueForAliases(valuesByKey, PROFILE_KEY_ALIASES.preferredSchedule),
    testInterest: valueForAliases(valuesByKey, PROFILE_KEY_ALIASES.testInterest),
    educationLevel: valueForAliases(valuesByKey, PROFILE_KEY_ALIASES.educationLevel),
    schoolName: valueForAliases(valuesByKey, PROFILE_KEY_ALIASES.schoolName),
    locationPreference: valueForAliases(valuesByKey, PROFILE_KEY_ALIASES.locationPreference),
    profileDetails: valueForAliases(valuesByKey, PROFILE_KEY_ALIASES.profileDetails),
    sourceDetail: 'Facebook Ads',
  });
}
