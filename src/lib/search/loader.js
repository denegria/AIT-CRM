export async function fetchGlobalSearch({ query, businessUnitId = '', fetcher = fetch, signal } = {}) {
  const value = String(query || '').trim();
  if (value.length < 2) return [];
  const params = new URLSearchParams({ q: value });
  if (businessUnitId) params.set('businessUnitId', businessUnitId);
  const response = await fetcher(`/api/search?${params.toString()}`, { cache: 'no-store', signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Search could not load.');
  return payload.results || [];
}
