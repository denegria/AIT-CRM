'use client';

import { useEffect } from 'react';
import { TeamMonitorPageSurface } from '@/components/TeamMonitorPanel';
import PageState, { PageStateAction } from '@/components/PageState';
import { canUseTeamMonitor } from '@/lib/team-monitor.js';
import { useCRM } from '@/lib/store';

export default function TeamMonitorPage() {
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
  } = useCRM();
  const monitorCurrentUser = currentUser || { id: 'emp-1', primaryRoleKey: role };
  const canViewTeamMonitor = canUseTeamMonitor(monitorCurrentUser);

  useEffect(() => {
    if (!canViewTeamMonitor || dataSource !== 'postgres' || !access.canReadCrm || tasksLoaded || tasksLoading) return;
    loadTasks().catch(() => null);
  }, [access.canReadCrm, canViewTeamMonitor, dataSource, loadTasks, tasksLoaded, tasksLoading]);

  if (!canViewTeamMonitor) {
    return (
      <PageState
        tone="denied"
        title="Team Monitor requires administrator access"
        copy="Your account can keep using the CRM workspaces assigned to your role."
        actions={<PageStateAction href="/">Back to Dashboard</PageStateAction>}
      />
    );
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
