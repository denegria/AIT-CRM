'use client';

import { usePathname } from 'next/navigation';
import CommandPalette from '@/components/CommandPalette';
import NotificationBell from '@/components/NotificationBell';
import PageState, { PageStateAction } from '@/components/PageState';
import SessionSwitchGuard from '@/components/SessionSwitchGuard';
import Sidebar from '@/components/Sidebar';
import { canUseCoordinatorRoute, canUseWorkOrdersForBusinessUnit } from '@/lib/crm/coordinator-policy.js';
import { useCRM } from '@/lib/store';

export default function AppShell({ children }) {
  const pathname = usePathname();
  const { accessibleBusinessUnits, currentBusinessUnit, currentUser, loaded } = useCRM();
  const isPublicJoinPage = pathname === '/join';
  const hasMobileScopeBar = accessibleBusinessUnits?.length > 0;
  const isWorkOrdersRoute = pathname === '/work-orders' || pathname.startsWith('/work-orders/');
  const canUseRoute = isPublicJoinPage || (
    canUseCoordinatorRoute(currentUser, pathname) &&
    (!isWorkOrdersRoute || canUseWorkOrdersForBusinessUnit(currentUser, currentBusinessUnit))
  );

  if (isPublicJoinPage) {
    return <main className="public-main-content">{children}</main>;
  }

  return (
    <>
      <CommandPalette />
      <SessionSwitchGuard />
      <div className={`app-layout ${hasMobileScopeBar ? 'app-layout-has-mobile-scope' : ''}`}>
        <Sidebar />
        <main className="main-content">
          <div className="app-notification-dock" aria-label="Workspace notifications">
            <NotificationBell />
          </div>
          {loaded && !canUseRoute ? (
            <PageState
              tone="denied"
              title={isWorkOrdersRoute ? 'Switch to AIT Signs to use Work Orders' : 'This route is outside your queue'}
              copy={isWorkOrdersRoute
                ? 'Work Orders are only available inside the AIT Signs division. Change your division scope or return to your dashboard.'
                : 'Your account can still use the CRM surfaces assigned to your role. Ask an administrator if this route should be added to your access.'}
              actions={<PageStateAction href="/">Back to Dashboard</PageStateAction>}
            />
          ) : children}
        </main>
      </div>
    </>
  );
}
