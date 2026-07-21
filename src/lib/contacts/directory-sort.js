export const CONTACT_DIRECTORY_MODES = Object.freeze({
  CONTACTS: 'contacts',
  AIT_SIGNS: 'ait_signs',
  AIT_USA: 'ait_usa',
});

export const CONTACT_DIRECTORY_SORT_DIRECTIONS = Object.freeze({
  ASC: 'asc',
  DESC: 'desc',
});

const CONTACTS_SORT_KEYS = Object.freeze([
  'name',
  'email',
  'phone',
  'status',
  'assignedLabel',
  'divisionLabel',
  'source',
  'lastTouch',
  'lastEdited',
]);

const AIT_SIGNS_SORT_KEYS = Object.freeze([
  'name',
  'phone',
  'sourceCategoryText',
  'linkedPeopleSummary',
  'status',
  'assignedLabel',
  'lastTouch',
  'lastEdited',
]);

const AIT_USA_SORT_KEYS = Object.freeze([
  'name',
  'email',
  'phone',
  'enrollmentStage',
  'studentLocation',
  'schoolLocation',
  'inquirySource',
  'assignedLabel',
  'lastTouch',
  'lastEdited',
]);

export const CONTACT_DIRECTORY_SORT_KEYS_BY_MODE = Object.freeze({
  [CONTACT_DIRECTORY_MODES.CONTACTS]: CONTACTS_SORT_KEYS,
  [CONTACT_DIRECTORY_MODES.AIT_SIGNS]: AIT_SIGNS_SORT_KEYS,
  [CONTACT_DIRECTORY_MODES.AIT_USA]: AIT_USA_SORT_KEYS,
});

const ALL_SORT_KEYS = new Set(Object.values(CONTACT_DIRECTORY_SORT_KEYS_BY_MODE).flat());

function clean(value = '') {
  return String(value || '').trim();
}

export function contactDirectoryModeForRequest({
  directoryKind = 'contacts',
  workflowKey = '',
  hasSingleDivisionScope = false,
} = {}) {
  if (workflowKey === CONTACT_DIRECTORY_MODES.AIT_USA && (directoryKind === 'clients' || hasSingleDivisionScope)) {
    return CONTACT_DIRECTORY_MODES.AIT_USA;
  }
  if (directoryKind === 'clients') return CONTACT_DIRECTORY_MODES.AIT_SIGNS;
  return CONTACT_DIRECTORY_MODES.CONTACTS;
}

export function contactDirectorySortKeys(mode = '') {
  if (!mode) return [...ALL_SORT_KEYS];
  return [...(CONTACT_DIRECTORY_SORT_KEYS_BY_MODE[mode] || CONTACTS_SORT_KEYS)];
}

export function normalizeContactDirectorySort({ key = '', direction = '', mode = '' } = {}) {
  const sortKey = clean(key);
  const allowedKeys = new Set(contactDirectorySortKeys(mode));
  if (!sortKey || !allowedKeys.has(sortKey)) {
    return { key: '', direction: CONTACT_DIRECTORY_SORT_DIRECTIONS.DESC };
  }
  return {
    key: sortKey,
    direction: clean(direction).toLowerCase() === CONTACT_DIRECTORY_SORT_DIRECTIONS.DESC
      ? CONTACT_DIRECTORY_SORT_DIRECTIONS.DESC
      : CONTACT_DIRECTORY_SORT_DIRECTIONS.ASC,
  };
}

export function contactDirectorySortStateFromParams(searchParams, { mode = '' } = {}) {
  return normalizeContactDirectorySort({
    key: searchParams?.get?.('sort'),
    direction: searchParams?.get?.('direction'),
    mode,
  });
}

export function nextContactDirectorySort({ currentKey = '', currentDirection = '', key = '' } = {}) {
  const nextKey = clean(key);
  if (!nextKey) return { key: '', direction: CONTACT_DIRECTORY_SORT_DIRECTIONS.DESC };
  if (clean(currentKey) === nextKey) {
    return {
      key: nextKey,
      direction: clean(currentDirection).toLowerCase() === CONTACT_DIRECTORY_SORT_DIRECTIONS.ASC
        ? CONTACT_DIRECTORY_SORT_DIRECTIONS.DESC
        : CONTACT_DIRECTORY_SORT_DIRECTIONS.ASC,
    };
  }
  return { key: nextKey, direction: CONTACT_DIRECTORY_SORT_DIRECTIONS.ASC };
}
