'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  publishActiveSession,
  sessionIdentityForUser,
} from '@/lib/auth/session-sync.js';

function JoinForm() {
  const searchParams = useSearchParams();
  const inviteToken = useMemo(() => searchParams.get('token') || searchParams.get('t') || '', [searchParams]);
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (!inviteToken) {
      setError('This signup link is missing an invite token.');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inviteToken,
          name: form.name,
          email: form.email,
          password: form.password,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to create account.');
      const sessionResponse = await fetch('/api/auth/session', { cache: 'no-store' }).catch(() => null);
      const sessionPayload = await sessionResponse?.json?.().catch(() => ({}));
      if (sessionPayload?.user) {
        publishActiveSession(sessionIdentityForUser(sessionPayload.user), 'signup');
      }
      setSuccess(true);
      window.setTimeout(() => {
        window.location.href = '/contacts';
      }, 700);
    } catch (err) {
      setError(err.message || 'Unable to create account.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="join-shell">
      <form className="card join-card" onSubmit={handleSubmit}>
        <div className="join-brand">AIT CRM</div>
        <h1 className="join-title">Create employee account</h1>
        <p className="page-subtitle join-subtitle">
          Use your invite link to create a role-scoped account for today&apos;s CRM walkthrough.
        </p>

        <div className="form-group">
          <label className="form-label">Name</label>
          <input
            className="input"
            value={form.name}
            onChange={(event) => updateField('name', event.target.value)}
            autoComplete="name"
            required
          />
        </div>
        <div className="form-group">
          <label className="form-label">Email</label>
          <input
            className="input"
            type="email"
            value={form.email}
            onChange={(event) => updateField('email', event.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div className="form-group">
          <label className="form-label">Password</label>
          <input
            className="input"
            type="password"
            value={form.password}
            onChange={(event) => updateField('password', event.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <div className="form-group">
          <label className="form-label">Confirm password</label>
          <input
            className="input"
            type="password"
            value={form.confirmPassword}
            onChange={(event) => updateField('confirmPassword', event.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>

        {error && <div className="empty-state join-message">{error}</div>}
        {success && <div className="empty-state join-message join-success">Account created. Opening CRM...</div>}

        <button className="btn btn-primary btn-block" type="submit" disabled={submitting || success}>
          {submitting ? 'Creating account...' : 'Create account'}
        </button>
      </form>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={<div className="join-shell"><div className="card join-card">Loading...</div></div>}>
      <JoinForm />
    </Suspense>
  );
}
