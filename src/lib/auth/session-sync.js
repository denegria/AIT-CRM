export const ACTIVE_SESSION_STORAGE_KEY = 'ait-crm-active-session';
export const SESSION_EVENT_STORAGE_KEY = 'ait-crm-session-event';
export const SESSION_CHANNEL_NAME = 'ait-crm-session-sync';
export const USER_SCOPED_STORAGE_KEYS = [
  'ait-crm-business-unit-scope',
  'ait-crm-scope-user-id',
];

export function sessionIdentityForUser(user) {
  if (!user?.id) return null;
  return {
    userId: user.id,
    name: user.name || '',
    email: user.email || '',
  };
}

export function sameSessionIdentity(left, right) {
  return Boolean(left?.userId && right?.userId && left.userId === right.userId);
}

export function parseStoredSession(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed?.userId ? parsed : null;
  } catch {
    return null;
  }
}

export function readStoredSession() {
  if (typeof window === 'undefined') return null;
  return parseStoredSession(window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY));
}

function broadcastSessionEvent(event) {
  if (typeof window === 'undefined') return;
  const payload = {
    ...event,
    timestamp: Date.now(),
  };
  try {
    window.localStorage.setItem(SESSION_EVENT_STORAGE_KEY, JSON.stringify(payload));
  } catch {}
  try {
    const channel = new BroadcastChannel(SESSION_CHANNEL_NAME);
    channel.postMessage(payload);
    channel.close();
  } catch {}
}

export function publishActiveSession(identity, reason = 'session') {
  if (typeof window === 'undefined' || !identity?.userId) return;
  try {
    window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify(identity));
  } catch {}
  broadcastSessionEvent({ type: 'session', reason, identity });
}

export function clearUserScopedSessionState() {
  if (typeof window === 'undefined') return;
  for (const key of USER_SCOPED_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {}
  }
}

export function publishLogout(reason = 'logout') {
  if (typeof window === 'undefined') return;
  clearUserScopedSessionState();
  try {
    window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
  } catch {}
  broadcastSessionEvent({ type: 'logout', reason, identity: null });
}
