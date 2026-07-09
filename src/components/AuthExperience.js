'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  publishActiveSession,
  sessionIdentityForUser,
} from '@/lib/auth/session-sync.js';

const AUTH_WELCOME_STORAGE_KEY = 'ait-crm-auth-welcome-pending';
const AUTH_WELCOME_MAX_AGE_MS = 60 * 1000;
const AUTH_WELCOME_DURATION_MS = 1150;
const AUTH_WELCOME_REDUCED_MOTION_DURATION_MS = 650;

let welcomeSnapshotUserId = '';
let welcomeSnapshotVisible = false;

function setWelcomePending(user) {
  if (typeof window === 'undefined' || !user?.id) return;
  try {
    sessionStorage.setItem(AUTH_WELCOME_STORAGE_KEY, JSON.stringify({
      userId: user.id,
      at: Date.now(),
    }));
    welcomeSnapshotUserId = '';
    welcomeSnapshotVisible = false;
  } catch {}
}

function consumeWelcomePending(currentUserId) {
  if (typeof window === 'undefined' || !currentUserId) return false;

  let rawValue = '';
  try {
    rawValue = sessionStorage.getItem(AUTH_WELCOME_STORAGE_KEY) || '';
    sessionStorage.removeItem(AUTH_WELCOME_STORAGE_KEY);
  } catch {
    return false;
  }

  if (!rawValue) return false;

  try {
    const pending = JSON.parse(rawValue);
    const isCurrentUser = pending?.userId === currentUserId;
    const isFresh = Number.isFinite(pending?.at) && Date.now() - pending.at <= AUTH_WELCOME_MAX_AGE_MS;
    return Boolean(isCurrentUser && isFresh);
  } catch {
    return false;
  }
}

function subscribeWelcomeSnapshot(callback) {
  if (typeof window === 'undefined') return () => {};
  const timeout = window.setTimeout(callback, 0);
  return () => window.clearTimeout(timeout);
}

function getWelcomeSnapshot(currentUserId) {
  if (!currentUserId) return false;
  if (welcomeSnapshotUserId === currentUserId) return welcomeSnapshotVisible;

  welcomeSnapshotUserId = currentUserId;
  welcomeSnapshotVisible = consumeWelcomePending(currentUserId);
  return welcomeSnapshotVisible;
}

function dismissWelcomeSnapshot(currentUserId) {
  if (!currentUserId || welcomeSnapshotUserId !== currentUserId) return;
  welcomeSnapshotVisible = false;
}

function firstNameForUser(user) {
  const name = String(user?.name || '').trim();
  if (name) return name.split(/\s+/)[0];
  const emailName = String(user?.email || '').split('@')[0].trim();
  return emailName || '';
}

function LogoMark({ className = '', decorative = false }) {
  return (
    <span className={`auth-logo-mark ${className}`} aria-hidden={decorative ? 'true' : undefined}>
      <Image src="/logo.png" alt={decorative ? '' : 'AIT CRM'} width={96} height={96} />
    </span>
  );
}

export function LoginGate({ authError }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(authError || '');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Sign-in failed.');
      const sessionResponse = await fetch('/api/auth/session', { cache: 'no-store' }).catch(() => null);
      const sessionPayload = await sessionResponse?.json?.().catch(() => ({}));
      if (sessionPayload?.user) {
        setWelcomePending(sessionPayload.user);
        publishActiveSession(sessionIdentityForUser(sessionPayload.user), 'login');
      }
      router.refresh();
    } catch (err) {
      setError(err.message || 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-brand" aria-label="AIT CRM secure access">
        <LogoMark />
        <div>
          <div className="auth-brand-title">AIT CRM</div>
          <div className="auth-brand-subtitle">Secure team access</div>
        </div>
      </div>

      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-copy">
          <h1 className="auth-title">Welcome to AIT CRM</h1>
          <p className="auth-subtitle">Sign in and enter the team workspace.</p>
        </div>

        <div className="auth-fields">
          <div className="form-group">
            <label className="form-label" htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              className="input auth-input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              className="input auth-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
        </div>

        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}

        <button className="auth-submit" type="submit" disabled={submitting}>
          {submitting ? 'Checking access...' : 'Continue'}
        </button>

        <p className="auth-note">Invite required for workspace access</p>
        <div className="auth-divider" />
        <p className="auth-help">
          <span>Need access?</span>
          <strong>Contact an administrator</strong>
        </p>
      </form>

      <div className="auth-trust-row" aria-label="Access safeguards">
        <span><i aria-hidden="true" />Protected sessions</span>
        <span>Admin-managed access</span>
        <span>Invite required</span>
      </div>
    </div>
  );
}

export function AuthWelcomeLobby({ currentUser }) {
  const currentUserId = currentUser?.id || '';
  const welcomePending = useSyncExternalStore(
    subscribeWelcomeSnapshot,
    () => getWelcomeSnapshot(currentUserId),
    () => false,
  );
  const [dismissedUserId, setDismissedUserId] = useState('');
  const firstName = useMemo(() => firstNameForUser(currentUser), [currentUser]);
  const visible = Boolean(welcomePending && currentUserId && dismissedUserId !== currentUserId);

  useEffect(() => {
    if (!visible) return undefined;

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const hideTimeout = window.setTimeout(
      () => {
        dismissWelcomeSnapshot(currentUserId);
        setDismissedUserId(currentUserId);
      },
      reducedMotion ? AUTH_WELCOME_REDUCED_MOTION_DURATION_MS : AUTH_WELCOME_DURATION_MS,
    );

    return () => window.clearTimeout(hideTimeout);
  }, [currentUserId, visible]);

  if (!visible) return null;

  const welcomeText = firstName ? `Welcome back, ${firstName}` : 'Welcome back';
  const steps = [
    ['Dashboard', 'Loading team summary and priorities'],
    ['Tasks', 'Syncing due today and follow-up queue'],
    ['Team Monitor', 'Preparing roster and activity pulse'],
  ];

  return (
    <div
      className="auth-welcome-overlay"
      role="status"
      aria-live="polite"
      aria-label="Preparing your workspace"
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        dismissWelcomeSnapshot(currentUserId);
        setDismissedUserId(currentUserId);
      }}
    >
      <div className="auth-welcome-ghost" aria-hidden="true" />
      <section className="auth-welcome-card">
        <LogoMark className="auth-welcome-logo" decorative />
        <h2>{welcomeText}</h2>
        <p>Preparing your workspace</p>
        <div className="auth-welcome-progress" aria-hidden="true">
          <span />
        </div>
        <div className="auth-loading-list">
          {steps.map(([label, subtitle]) => (
            <div className="auth-loading-row" key={label}>
              <span className="auth-loading-spinner" aria-hidden="true" />
              <span className="auth-loading-text">
                <strong>{label}</strong>
                <small>{subtitle}</small>
              </span>
              <LogoMark className="auth-loading-logo" decorative />
            </div>
          ))}
        </div>
      </section>
      <p className="auth-welcome-footnote">Dashboard opens as soon as the workspace is ready.</p>
    </div>
  );
}
