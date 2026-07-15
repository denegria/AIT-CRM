export function routeBusinessUnitFilterForGlobalScope(currentBusinessUnitId) {
  if (currentBusinessUnitId && currentBusinessUnitId !== 'all' && currentBusinessUnitId !== 'unassigned') {
    return currentBusinessUnitId;
  }
  return 'all';
}

export function syncRouteBusinessUnitFilter(filters, currentBusinessUnitId) {
  const businessUnitId = routeBusinessUnitFilterForGlobalScope(currentBusinessUnitId);
  if (filters.businessUnitId === businessUnitId) return filters;
  return { ...filters, businessUnitId };
}
