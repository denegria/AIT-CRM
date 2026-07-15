export async function fetchDashboardSummary({ businessUnitId, employeeIds = [], fetcher = fetch } = {}) {
  if (!businessUnitId || businessUnitId === 'all' || businessUnitId === 'unassigned') {
    throw new Error('Select a division before loading the dashboard summary.');
  }
  const params = new URLSearchParams({ businessUnitId });
  if (employeeIds.length) params.set('employeeIds', employeeIds.join(','));
  const response = await fetcher(`/api/dashboard-summary?${params.toString()}`, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Dashboard summary could not load.');
  return payload;
}
