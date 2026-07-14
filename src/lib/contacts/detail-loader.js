function responseError(payload, fallback) {
  return new Error(payload?.error || fallback);
}

export async function loadContactTimeline(contactId, { fetcher = fetch } = {}) {
  const response = await fetcher(`/api/contacts/${contactId}/timeline`, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw responseError(payload, 'Timeline load failed.');
  return Array.isArray(payload.timeline) ? payload.timeline : [];
}

export async function appendContactNote(contactId, note, { fetcher = fetch } = {}) {
  const response = await fetcher(`/api/contacts/${contactId}/timeline`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ note }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw responseError(payload, 'Note save failed.');
  return payload.note || null;
}
