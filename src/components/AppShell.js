'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import CommandPalette from '@/components/CommandPalette';
import NotificationBell from '@/components/NotificationBell';
import SessionSwitchGuard from '@/components/SessionSwitchGuard';
import Sidebar from '@/components/Sidebar';
import { canUseCoordinatorRoute, canUseWorkOrdersForBusinessUnit } from '@/lib/crm/coordinator-policy.js';
import { useCRM } from '@/lib/store';

export default function AppShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { accessibleBusinessUnits, currentBusinessUnit, currentUser, loaded } = useCRM();
  const isPublicJoinPage = pathname === '/join';
  const hasMobileScopeBar = accessibleBusinessUnits?.length > 0;
  const isWorkOrdersRoute = pathname === '/work-orders' || pathname.startsWith('/work-orders/');
  const canUseRoute = isPublicJoinPage || (
    canUseCoordinatorRoute(currentUser, pathname) &&
    (!isWorkOrdersRoute || canUseWorkOrdersForBusinessUnit(currentUser, currentBusinessUnit))
  );

  useEffect(() => {
    if (!loaded || canUseRoute) return;
    router.replace('/');
  }, [canUseRoute, loaded, router]);

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
          <header className="app-topbar" aria-label="Workspace notifications">
            <NotificationBell />
          </header>
          {loaded && !canUseRoute ? (
            <div className="empty-state">This workspace is limited to your assigned CRM queue.</div>
          ) : children}
        </main>
      </div>
    </>
  );
}
