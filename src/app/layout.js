import './globals.css';
import { CRMProvider } from '@/lib/store';
import { ToastProvider } from '@/components/Toast';
import AppShell from '@/components/AppShell';
import { getBootstrapData } from '@/lib/bootstrap-data';
import { getCurrentSession } from '@/lib/auth';
import { cookies } from 'next/headers';
import { headers } from 'next/headers';
import { bootstrapModeForPathname } from '@/lib/bootstrap-routing.js';

const SCOPE_STORAGE_KEY = 'ait-crm-business-unit-scope';
const SCOPE_USER_KEY = 'ait-crm-scope-user-id';

export const metadata = {
  title: 'AIT Signs',
  description: 'AIT Signs Operational CRM — Lead management, work orders, and financials.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }) {
  const session = await getCurrentSession();
  const cookieStore = await cookies();
  const headerStore = await headers();
  const pathname = headerStore.get('x-ait-crm-pathname') || '';
  const bootstrapMode = bootstrapModeForPathname(pathname);
  const bootstrapData = {
    ...(await getBootstrapData(session, bootstrapMode)),
    bootstrapMode,
    persistedBusinessUnitScope: cookieStore.get(SCOPE_STORAGE_KEY)?.value || '',
    persistedBusinessUnitScopeUserId: cookieStore.get(SCOPE_USER_KEY)?.value || '',
  };
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ToastProvider>
          <CRMProvider key={bootstrapData.currentUser?.id || 'signed-out'} initialData={bootstrapData}>
            <AppShell>{children}</AppShell>
          </CRMProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
