'use client';

import Link from 'next/link';
import { TeamMonitorPageSurface } from '@/components/TeamMonitorPanel';
import { canUseTeamMonitor } from '@/lib/team-monitor.js';
import { useCRM } from '@/lib/store';

export default function TeamMonitorPage() {
  const {
    role,
    employees,
    tasks,
    currentUser,
    loaded,
  } = useCRM();
  const monitorCurrentUser = currentUser || { id: 'emp-1', primaryRoleKey: role };

  if (!loaded) return <div className="empty-state">Loading team monitor...</div>;

  if (!canUseTeamMonitor(monitorCurrentUser)) {
    return (
      <div className="empty-state">
        <p>Team Monitor is available to administrators and senior coordinators.</p>
        <Link className="btn btn-sm" href="/">Back to dashboard</Link>
      </div>
    );
  }

  return (
    <TeamMonitorPageSurface
      employees={employees}
      tasks={tasks}
      currentUser={monitorCurrentUser}
    />
  );
}
