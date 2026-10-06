'use client';

import { useState } from 'react';
import ClassManagementWorkspace from '@/components/ClassManagementWorkspace.js';
import { todayInAttendanceTimeZone } from '@/lib/attendance/policy.js';
import ActiveClassesWorkspace from '@/components/ActiveClassesWorkspace.js';
import PageState, { PageStateAction } from '@/components/PageState.js';
import { isAitUsaBusinessUnit } from '@/lib/attendance/policy.js';
import { useCRM } from '@/lib/store';
import s from './ActiveClasses.module.css';

export default function ActiveClassesPage() {
  const { currentBusinessUnit, routeDataReady } = useCRM();
  const [classRefreshKey, setClassRefreshKey] = useState(0);

  if (!routeDataReady) {
    return <PageState tone="loading" title="Loading Active Classes" copy="Preparing the attendance workspace." />;
  }

  if (!isAitUsaBusinessUnit(currentBusinessUnit?.name)) {
    return (
      <PageState
        tone="denied"
        title="Switch to AIT USA to use Active Classes"
        copy="Attendance is available only within the AIT USA Institute business-unit scope."
        actions={<PageStateAction href="/">Back to Dashboard</PageStateAction>}
      />
    );
  }

  return <ActiveClassesWorkspace styles={s} classRefreshKey={classRefreshKey}
    managementAction={<ClassManagementWorkspace key={currentBusinessUnit?.id} businessUnitId={currentBusinessUnit?.id}
      today={todayInAttendanceTimeZone()} onSaved={() => setClassRefreshKey((value) => value + 1)} />} />;
}
