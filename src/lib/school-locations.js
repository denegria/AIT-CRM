export const AIT_USA_SCHOOL_LOCATIONS = ['Bound Brook', 'Plainfield'];

export function schoolLocationOptions(currentValue = '') {
  const current = String(currentValue || '').trim();
  if (!current || AIT_USA_SCHOOL_LOCATIONS.includes(current)) {
    return AIT_USA_SCHOOL_LOCATIONS;
  }
  return [current, ...AIT_USA_SCHOOL_LOCATIONS];
}
