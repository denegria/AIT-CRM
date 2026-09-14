'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import CommandPalette from '@/components/CommandPalette';
import NotificationBell from '@/components/NotificationBell';
import PageState, { PageStateAction } from '@/components/PageState';
import SessionSwitchGuard from '@/components/SessionSwitchGuard';
import Sidebar from '@/components/Sidebar';
import { RecordScopeProvider, useRecordScope } from '@/components/RecordScopeContext';
import { canUseCoordinatorRoute, canUseWorkOrdersForBusinessUnit } from '@/lib/crm/coordinator-policy.js';
import { useCRM } from '@/lib/store';

function navigationPreferenceKey(userId) {
  const normalizedUserId = String(userId || '').trim();
  return normalizedUserId ? `ait-crm-navigation-pinned:${normalizedUserId}` : null;
}

const navigationPinnedChangeEvent = 'ait-crm-navigation-pinned-change';

function readPinnedNavigationPreference(userId) {
  const preferenceKey = navigationPreferenceKey(userId);
  if (!preferenceKey || typeof window === 'undefined') return false;

  try {
    return window.localStorage.getItem(preferenceKey) === 'true';
  } catch {
    return false;
  }
}

function readPinnedNavigationServerSnapshot() {
  return false;
}

function subscribePinnedNavigationPreference(userId, callback) {
  const preferenceKey = navigationPreferenceKey(userId);
  if (!preferenceKey || typeof window === 'undefined') return () => {};

  const handleStorageChange = (event) => {
    if (event.key === preferenceKey) callback();
  };
  const handleSameWindowChange = (event) => {
    if (event.detail?.preferenceKey === preferenceKey) callback();
  };

  window.addEventListener('storage', handleStorageChange);
  window.addEventListener(navigationPinnedChangeEvent, handleSameWindowChange);
  return () => {
    window.removeEventListener('storage', handleStorageChange);
    window.removeEventListener(navigationPinnedChangeEvent, handleSameWindowChange);
  };
}

function writePinnedNavigationPreference(userId, isPinned) {
  const preferenceKey = navigationPreferenceKey(userId);
  if (!preferenceKey || typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(preferenceKey, isPinned ? 'true' : 'false');
    window.dispatchEvent(new CustomEvent(navigationPinnedChangeEvent, {
      detail: { preferenceKey },
    }));
  } catch {
    // Navigation pinning is a local enhancement; storage failures leave it session-local.
  }
}

function NavigationLayout({ authenticatedUserId, hasMobileScopeBar, children }) {
  const subscribe = useCallback(
    (callback) => subscribePinnedNavigationPreference(authenticatedUserId, callback),
    [authenticatedUserId],
  );
  const getSnapshot = useCallback(
    () => readPinnedNavigationPreference(authenticatedUserId),
    [authenticatedUserId],
  );
  const pinnedNavigation = useSyncExternalStore(subscribe, getSnapshot, readPinnedNavigationServerSnapshot);
  const isNavigationPinned = Boolean(authenticatedUserId && pinnedNavigation);

  const handlePinnedNavigationChange = useCallback((nextPinned) => {
    if (!authenticatedUserId) return;

    const nextValue = Boolean(nextPinned);
    writePinnedNavigationPreference(authenticatedUserId, nextValue);
  }, [authenticatedUserId]);

  return (
    <div
      className={`app-layout ${hasMobileScopeBar ? 'app-layout-has-mobile-scope' : ''}`}
      data-navigation-pinned={isNavigationPinned}
    >
      <Sidebar isPinned={isNavigationPinned} onPinnedChange={handlePinnedNavigationChange} />
      <main className="main-content">
        <div className="app-notification-dock" aria-label="Workspace notifications">
          <NotificationBell />
        </div>
        {children}
      </main>
    </div>
  );
}

function AppShellContent({ children }) {
  const pathname = usePathname();
  const { accessibleBusinessUnits, currentBusinessUnit, currentUser, loaded } = useCRM();
  const { recordBusinessUnit } = useRecordScope();
  const routeBusinessUnit = recordBusinessUnit || currentBusinessUnit;
  const isPublicJoinPage = pathname === '/join';
  const hasMobileScopeBar = Boolean(recordBusinessUnit?.id || accessibleBusinessUnits?.length > 0);
  const isWorkOrdersRoute = pathname === '/work-orders' || pathname.startsWith('/work-orders/');
  const authenticatedUserId = currentUser?.id || null;
  const canUseRoute = isPublicJoinPage || (
    canUseCoordinatorRoute(currentUser, pathname) &&
    (!isWorkOrdersRoute || canUseWorkOrdersForBusinessUnit(currentUser, routeBusinessUnit))
  );

  if (isPublicJoinPage) {
    return <main className="public-main-content">{children}</main>;
  }

  return (
    <>
      <CommandPalette />
      <SessionSwitchGuard />
      <NavigationLayout
        key={authenticatedUserId ? `user:${authenticatedUserId}` : 'unauthenticated'}
        authenticatedUserId={authenticatedUserId}
        hasMobileScopeBar={hasMobileScopeBar}
      >
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
      </NavigationLayout>
    </>
  );
}

export default function AppShell({ children }) {
  return (
    <RecordScopeProvider>
      <AppShellContent>{children}</AppShellContent>
    </RecordScopeProvider>
  );
}
