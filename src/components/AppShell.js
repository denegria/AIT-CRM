'use client';

import { usePathname } from 'next/navigation';
import CommandPalette from '@/components/CommandPalette';
import Sidebar from '@/components/Sidebar';
import { useCRM } from '@/lib/store';

export default function AppShell({ children }) {
  const pathname = usePathname();
  const { accessibleBusinessUnits } = useCRM();
  const isPublicJoinPage = pathname === '/join';
  const hasMobileScopeBar = accessibleBusinessUnits?.length > 0;

  if (isPublicJoinPage) {
    return <main className="public-main-content">{children}</main>;
  }

  return (
    <>
      <CommandPalette />
      <div className={`app-layout ${hasMobileScopeBar ? 'app-layout-has-mobile-scope' : ''}`}>
        <Sidebar />
        <main className="main-content">
          {children}
        </main>
      </div>
    </>
  );
}
