export function pipelineSummaryQuery({ businessUnitId, leadDateScope = 'current', leadDateFrom = '', leadDateTo = '' } = {}) {
  const params = new URLSearchParams({ businessUnitId, leadDateScope });
  if (leadDateFrom) params.set('leadDateFrom', leadDateFrom);
  if (leadDateTo) params.set('leadDateTo', leadDateTo);
  return params.toString();
}

export async function fetchPipelineSummary({ fetcher = fetch, ...filters } = {}) {
  if (!filters.businessUnitId || filters.businessUnitId === 'all' || filters.businessUnitId === 'unassigned') {
    throw new Error('Select a division before loading the pipeline.');
  }
  const query = pipelineSummaryQuery(filters);
  const response = await fetcher(`/api/pipeline-summary?${query}`, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Pipeline summary could not load.');
  return { ...payload, queryKey: query };
}
