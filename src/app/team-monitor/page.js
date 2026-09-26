'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { TeamMonitorPageSurface } from '@/components/TeamMonitorPanel';
import PageState, { PageStateAction } from '@/components/PageState';
import { canUseTeamMonitorWorkspace } from '@/lib/crm/coordinator-policy.js';
import { useCRM } from '@/lib/store';

export default function TeamMonitorPage() {
  const searchParams = useSearchParams();
  const {
    role,
    contacts,
    employees,
    tasks,
    tasksLoaded,
    tasksLoading,
    tasksError,
    loadTasks,
    currentUser,
    loaded,
    dataSource,
    access,
    routeDataReady,
    accessibleBusinessUnits,
    currentBusinessUnitId,
    setCurrentBusinessUnitId,
  } = useCRM();
  const monitorCurrentUser = currentUser || { id: 'emp-1', primaryRoleKey: role };
  const canViewTeamMonitor = canUseTeamMonitorWorkspace(monitorCurrentUser);
  const requestedBusinessUnitId = searchParams.get('businessUnitId') || '';
  const hasAuthorizedRequestedScope = accessibleBusinessUnits.some((unit) => unit.id === requestedBusinessUnitId);

  useEffect(() => {
    if (!routeDataReady || !canViewTeamMonitor || !hasAuthorizedRequestedScope || currentBusinessUnitId === requestedBusinessUnitId) return;
    setCurrentBusinessUnitId(requestedBusinessUnitId);
  }, [canViewTeamMonitor, currentBusinessUnitId, hasAuthorizedRequestedScope, requestedBusinessUnitId, routeDataReady, setCurrentBusinessUnitId]);

  useEffect(() => {
    if (!routeDataReady || !canViewTeamMonitor || dataSource !== 'postgres' || !access.canReadCrm || tasksLoaded || tasksLoading) return;
    loadTasks().catch(() => null);
  }, [access.canReadCrm, canViewTeamMonitor, dataSource, loadTasks, routeDataReady, tasksLoaded, tasksLoading]);

  if (!routeDataReady) {
    return <PageState tone="loading" title="Loading team monitor" copy="Refreshing the scoped team monitor workspace." />;
  }

  if (!canViewTeamMonitor) {
    return (
      <PageState
        tone="denied"
        title="Team Monitor is unavailable for this role"
        copy="Your account can keep using the CRM workspaces assigned to your role."
        actions={<PageStateAction href="/">Back to Dashboard</PageStateAction>}
      />
    );
  }

  if (hasAuthorizedRequestedScope && currentBusinessUnitId !== requestedBusinessUnitId) {
    return <PageState tone="loading" title="Loading team monitor" copy="Opening the selected division's team workspace." />;
  }

  if (!loaded || (dataSource === 'postgres' && !tasksLoaded && !tasksError)) {
    return <PageState tone="loading" title="Loading team monitor" copy="Preparing team workload and coordinator activity." />;
  }

  if (dataSource === 'postgres' && tasksError) {
    return (
      <PageState
        tone="error"
        title="Team workload could not load"
        copy={tasksError}
        actions={<button className="btn btn-primary" onClick={() => loadTasks({ force: true }).catch(() => null)}>Try again</button>}
      />
    );
  }

  return (
    <TeamMonitorPageSurface
      employees={employees}
      tasks={tasks}
      contacts={contacts}
      currentUser={monitorCurrentUser}
    />
  );
}
