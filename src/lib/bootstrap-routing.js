export const LEAN_SHELL_PATHS = Object.freeze([
  '/tasks',
  '/inbox',
  '/sms-campaigns',
  '/import-review',
  '/comms-ops',
  '/settings',
]);

export function bootstrapModeForPathname(pathname = '') {
  if (pathname === '/contacts' || pathname === '/clients') return 'contact-directory';
  if (pathname === '/') return 'dashboard';
  if (pathname === '/pipeline') return 'pipeline';
  if (LEAN_SHELL_PATHS.includes(pathname)) return 'lean-shell';
  return 'full';
}
