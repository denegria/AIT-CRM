import './globals.css';
import { CRMProvider } from '@/lib/store';
import { ToastProvider } from '@/components/Toast';
import AppShell from '@/components/AppShell';
import { getBootstrapData } from '@/lib/bootstrap-data';
import { getCurrentSession } from '@/lib/auth';

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
  const bootstrapData = await getBootstrapData(session);
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ToastProvider>
          <CRMProvider initialData={bootstrapData}>
            <AppShell>{children}</AppShell>
          </CRMProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
