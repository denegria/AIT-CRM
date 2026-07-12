'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lock, LogOut, RefreshCw, RotateCcw } from 'lucide-react';
import { useCRM } from '@/lib/store';
import { sameAppVersion } from '@/lib/app-version.js';
import {
  SESSION_CHANNEL_NAME,
  SESSION_EVENT_STORAGE_KEY,
  clearUserScopedSessionState,
  parseStoredSession,
  publishActiveSession,
  publishLogout,
  readStoredSession,
  sameSessionIdentity,
  sessionIdentityForUser,
} from '@/lib/auth/session-sync.js';
import s from './SessionSwitchGuard.module.css';

function eventIdentity(event) {
  if (event?.identity?.userId) return event.identity;
  return null;
}

export default function SessionSwitchGuard() {
  const { appVersion, dataSource, currentUser } = useCRM();
  const [lockedIdentity, setLockedIdentity] = useState(null);
  const [staleVersion, setStaleVersion] = useState(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const loadedAppVersionRef = useRef(appVersion || '');
  const currentIdentity = useMemo(() => sessionIdentityForUser(currentUser), [currentUser]);
  const enabled = dataSource === 'postgres' && Boolean(currentIdentity);

  const lockForIdentity = useCallback((identity) => {
    if (!identity?.userId || sameSessionIdentity(identity, currentIdentity)) return;
    clearUserScopedSessionState();
    setPassword('');
    setError('');
    setLockedIdentity(identity);
  }, [currentIdentity]);

  const lockForStaleVersion = useCallback((serverVersion) => {
    if (sameAppVersion(loadedAppVersionRef.current, serverVersion)) return;
    clearUserScopedSessionState();
    setPassword('');
    setError('');
    setLockedIdentity(null);
    setStaleVersion({
      loaded: loadedAppVersionRef.current,
      server: serverVersion,
    });
  }, []);

  const publishCurrentIdentity = useCallback((reason) => {
    if (!currentIdentity) return;
    publishActiveSession(currentIdentity, reason);
  }, [currentIdentity]);

  const checkServerSession = useCallback(async () => {
    if (!enabled) return;
    try {
      const response = await fetch('/api/auth/session', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.authenticated) {
        publishLogout('session-lost');
        window.location.reload();
        return;
      }
      if (!sameAppVersion(loadedAppVersionRef.current, payload.appVersion)) {
        lockForStaleVersion(payload.appVersion);
        return;
      }
      const serverIdentity = sessionIdentityForUser(payload.user);
      if (!sameSessionIdentity(serverIdentity, currentIdentity)) {
        publishActiveSession(serverIdentity, 'server-session-check');
        lockForIdentity(serverIdentity);
      }
    } catch {
      // Keep the current tab usable during a transient network failure.
    }
  }, [currentIdentity, enabled, lockForIdentity, lockForStaleVersion]);

  useEffect(() => {
    if (!enabled) return undefined;

    queueMicrotask(() => {
      const stored = readStoredSession();
      if (stored && !sameSessionIdentity(stored, currentIdentity)) {
        lockForIdentity(stored);
      } else {
        publishCurrentIdentity('mount');
      }
    });

    const onEvent = (event) => {
      const payload = event.data || {};
      if (payload.type === 'logout') {
        clearUserScopedSessionState();
        window.location.reload();
        return;
      }
      if (payload.type === 'session') {
        lockForIdentity(eventIdentity(payload));
      }
    };

    const onStorage = (event) => {
      if (event.key === SESSION_EVENT_STORAGE_KEY) {
        const payload = parseStoredSession(event.newValue)
          ? { type: 'session', identity: parseStoredSession(event.newValue) }
          : (() => {
              try { return JSON.parse(event.newValue || '{}'); } catch { return {}; }
            })();
        if (payload.type === 'logout') {
          clearUserScopedSessionState();
          window.location.reload();
          return;
        }
        if (payload.type === 'session') lockForIdentity(eventIdentity(payload));
      }
    };

    const onFocus = () => {
      const active = readStoredSession();
      if (active && !sameSessionIdentity(active, currentIdentity)) {
        lockForIdentity(active);
        return;
      }
      checkServerSession();
    };

    let channel = null;
    try {
      channel = new BroadcastChannel(SESSION_CHANNEL_NAME);
      channel.addEventListener('message', onEvent);
    } catch {}

    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    const interval = setInterval(checkServerSession, 60000);

    return () => {
      if (channel) {
        channel.removeEventListener('message', onEvent);
        channel.close();
      }
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      clearInterval(interval);
    };
  }, [checkServerSession, currentIdentity, enabled, lockForIdentity, publishCurrentIdentity]);

  async function handleUnlock(event) {
    event.preventDefault();
    if (!lockedIdentity || !password) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/auth/reauth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to unlock this session.');
      const identity = sessionIdentityForUser(payload.user) || lockedIdentity;
      publishActiveSession(identity, 'unlock');
      window.location.reload();
    } catch (err) {
      setError(err.message || 'Unable to unlock this session.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    setSubmitting(true);
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    publishLogout('session-switch-lock');
    window.location.reload();
  }

  function handleRefresh() {
    window.location.reload();
  }

  if (!enabled) return null;

  if (staleVersion) {
    return (
      <div className={s.backdrop} role="alertdialog" aria-modal="true" aria-labelledby="app-version-title">
        <div className={s.panel}>
          <div className={s.icon}><RefreshCw size={22} /></div>
          <h2 id="app-version-title">CRM update available</h2>
          <p>
            This tab is running an older CRM version. Refresh and sign in again if prompted to continue on the latest CRM.
          </p>
          {staleVersion.loaded && staleVersion.server && (
            <p className={s.versionMeta}>
              Loaded version {staleVersion.loaded.slice(0, 12)} / current version {staleVersion.server.slice(0, 12)}
            </p>
          )}
          <div className={s.actions}>
            <button className="btn btn-primary" type="button" onClick={handleRefresh}>
              <RefreshCw size={16} />
              <span>Refresh CRM</span>
            </button>
            <button className="btn" type="button" disabled={submitting} onClick={handleSignOut}>
              <LogOut size={16} />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!lockedIdentity) return null;

  return (
    <div className={s.backdrop} role="alertdialog" aria-modal="true" aria-labelledby="session-switch-title">
      <form className={s.panel} onSubmit={handleUnlock}>
        <div className={s.icon}><Lock size={22} /></div>
        <h2 id="session-switch-title">Session changed</h2>
        <p>
          This browser session changed to <strong>{lockedIdentity.name || lockedIdentity.email || 'another user'}</strong>.
          Enter that user&apos;s password to continue here, or sign out.
        </p>
        <label className={s.label}>
          Password for {lockedIdentity.email || lockedIdentity.name || 'current user'}
          <input
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            autoFocus
            required
          />
        </label>
        {error && <div className={s.error}>{error}</div>}
        <div className={s.actions}>
          <button className="btn btn-primary" type="submit" disabled={submitting || !password}>
            <RotateCcw size={16} />
            <span>{submitting ? 'Checking...' : `Continue as ${lockedIdentity.name || 'current user'}`}</span>
          </button>
          <button className="btn" type="button" disabled={submitting} onClick={handleSignOut}>
            <LogOut size={16} />
            <span>Sign out</span>
          </button>
        </div>
      </form>
    </div>
  );
}
