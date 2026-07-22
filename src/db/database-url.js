export function databaseSslMode(connectionString) {
  if (!connectionString) return '';
  try {
    return new URL(connectionString).searchParams.get('sslmode')?.trim().toLowerCase() || '';
  } catch {
    return '';
  }
}

export function databaseUrlUsesFullVerification(connectionString) {
  return databaseSslMode(connectionString) === 'verify-full';
}
