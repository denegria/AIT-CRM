export function cleanSearchQuery(value = '') {
  return String(value || '').trim();
}

export function searchPattern(value = '') {
  return `%${cleanSearchQuery(value).replace(/[\\%_]/g, '\\$&')}%`;
}

export function searchPhoneDigits(value = '') {
  const digits = cleanSearchQuery(value).replace(/[^0-9]/g, '');
  return digits.length >= 4 ? digits : '';
}

export function matchesSearchValues(query, values = [], phoneValues = []) {
  const normalizedQuery = cleanSearchQuery(query).toLowerCase();
  if (!normalizedQuery) return true;

  const textMatches = values
    .map((value) => String(value || '').toLowerCase())
    .some((value) => value.includes(normalizedQuery));
  if (textMatches) return true;

  const phoneDigits = searchPhoneDigits(normalizedQuery);
  return Boolean(phoneDigits) && phoneValues
    .map((value) => String(value || '').replace(/[^0-9]/g, ''))
    .some((value) => value.includes(phoneDigits));
}
