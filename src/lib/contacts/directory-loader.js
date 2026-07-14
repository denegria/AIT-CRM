'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const EMPTY_RESULT = Object.freeze({
  contacts: [],
  workOrders: [],
  financials: [],
  page: 1,
  pageSize: 50,
  total: 0,
  totalPages: 1,
});

export function useDeferredContactDirectory({
  enabled = false,
  searchParams,
  businessUnitId = '',
  refreshKey = 0,
} = {}) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pagination, setPagination] = useState({ scope: '', page: 1 });
  const [result, setResult] = useState(EMPTY_RESULT);
  const [status, setStatus] = useState(enabled ? 'loading' : 'idle');
  const [error, setError] = useState('');
  const filterQuery = searchParams?.toString?.() || '';

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timeout);
  }, [search]);

  const pageScope = `${businessUnitId}|${debouncedSearch}|${filterQuery}`;
  const page = pagination.scope === pageScope ? pagination.page : 1;
  const setPage = useCallback((nextPage) => {
    setPagination((current) => {
      const currentPage = current.scope === pageScope ? current.page : 1;
      return {
        scope: pageScope,
        page: typeof nextPage === 'function' ? nextPage(currentPage) : nextPage,
      };
    });
  }, [pageScope]);

  const requestUrl = useMemo(() => {
    const params = new URLSearchParams(filterQuery);
    params.set('view', 'directory');
    params.set('page', String(page));
    params.set('pageSize', '50');
    if (businessUnitId) params.set('businessUnitId', businessUnitId);
    if (debouncedSearch) params.set('q', debouncedSearch);
    else params.delete('q');
    return `/api/contacts?${params.toString()}`;
  }, [businessUnitId, debouncedSearch, filterQuery, page]);

  const load = useCallback((signal) => {
    if (!enabled) return Promise.resolve(null);
    setStatus('loading');
    setError('');
    return fetch(requestUrl, { cache: 'no-store', signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Contacts could not load.');
        setResult({ ...EMPTY_RESULT, ...payload });
        setStatus('ready');
        return payload;
      })
      .catch((loadError) => {
        if (loadError?.name === 'AbortError') return null;
        setError(loadError.message || 'Contacts could not load.');
        setStatus('error');
        return null;
      });
  }, [enabled, requestUrl]);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) load(controller.signal);
    });
    return () => controller.abort();
  }, [enabled, load, refreshKey]);

  return {
    ...result,
    error,
    loading: status === 'loading',
    ready: status === 'ready',
    retry: () => load(),
    search,
    setSearch,
    setPage,
  };
}
