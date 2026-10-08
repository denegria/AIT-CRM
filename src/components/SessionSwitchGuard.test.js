import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./SessionSwitchGuard.js', import.meta.url), 'utf8');

test('version refresh preserves division scope while an identity change still clears it', () => {
  const identityGuard = source.split('const lockForIdentity = useCallback(')[1]?.split('const lockForStaleVersion = useCallback(')[0];
  const versionGuard = source.split('const lockForStaleVersion = useCallback(')[1]?.split('const publishCurrentIdentity = useCallback(')[0];

  assert.match(identityGuard, /clearUserScopedSessionState\(\)/);
  assert.match(versionGuard, /sameAppVersion\(loadedAppVersionRef\.current, serverVersion\)/);
  assert.doesNotMatch(versionGuard, /clearUserScopedSessionState\(\)/);
});
