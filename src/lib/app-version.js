const LOCAL_APP_VERSION = 'local-dev';

export function normalizeAppVersion(value) {
  const normalized = String(value || '').trim();
  return normalized || '';
}

export function getServerAppVersion(env = process.env) {
  return normalizeAppVersion(
    env.AIT_CRM_APP_VERSION ||
    env.VERCEL_GIT_COMMIT_SHA ||
    env.VERCEL_DEPLOYMENT_ID ||
    env.VERCEL_URL ||
    env.npm_package_version ||
    LOCAL_APP_VERSION
  );
}

export function sameAppVersion(loadedVersion, serverVersion) {
  const loaded = normalizeAppVersion(loadedVersion);
  const server = normalizeAppVersion(serverVersion);
  if (!loaded || !server) return true;
  return loaded === server;
}
