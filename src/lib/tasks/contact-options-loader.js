export async function fetchTaskContactOptions({
  businessUnitId = '',
  query = '',
  contactId = '',
  signal,
  fetcher = globalThis.fetch,
} = {}) {
  const params = new URLSearchParams();
  if (businessUnitId && businessUnitId !== 'all') params.set('businessUnitId', businessUnitId);
  if (query.trim()) params.set('q', query.trim());
  if (contactId) params.set('contactId', contactId);
  const response = await fetcher(`/api/tasks/contact-options?${params.toString()}`, {
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Task contacts could not load.');
  return Array.isArray(payload.contacts) ? payload.contacts : [];
}
