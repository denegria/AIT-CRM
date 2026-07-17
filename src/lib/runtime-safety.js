export const EXTERNAL_IO_DISABLED_ENV = 'AIT_CRM_EXTERNAL_IO_DISABLED';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function externalIoDisabled(env = process.env) {
  return TRUE_VALUES.has(String(env?.[EXTERNAL_IO_DISABLED_ENV] || '').trim().toLowerCase());
}

export function externalIoDisabledResponse() {
  return {
    error: 'External provider I/O is disabled for this environment.',
    code: 'EXTERNAL_IO_DISABLED',
  };
}
