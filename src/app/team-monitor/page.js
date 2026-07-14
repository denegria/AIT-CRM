'use client';

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
    currentUser,
    loaded,
  } = useCRM();
  const monitorCurrentUser = currentUser || { id: 'emp-1', primaryRoleKey: role };

  if (!loaded) {
    return <PageState tone="loading" title="Loading team monitor" copy="Preparing team workload and coordinator activity." />;
  }

  if (!canUseTeamMonitor(monitorCurrentUser)) {
    return (
      <PageState
        tone="denied"
        title="Team Monitor requires administrator access"
        copy="Your account can keep using the CRM workspaces assigned to your role."
        actions={<PageStateAction href="/">Back to Dashboard</PageStateAction>}
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
