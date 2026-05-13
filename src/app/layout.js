import './globals.css';
import { CRMProvider } from '@/lib/store';
import { ToastProvider } from '@/components/Toast';
import CommandPalette from '@/components/CommandPalette';
import Sidebar from '@/components/Sidebar';
import { getBootstrapData } from '@/lib/bootstrap-data';
import { getCurrentSession } from '@/lib/auth';

export const metadata = {
  title: 'AIT Signs',
  description: 'AIT Signs Operational CRM — Lead management, work orders, and financials.',
};

export default async function RootLayout({ children }) {
  const session = await getCurrentSession();
  const bootstrapData = await getBootstrapData(session);
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ToastProvider>
          <CRMProvider initialData={bootstrapData}>
            <CommandPalette />
            <div className="app-layout">
              <Sidebar />
              <main className="main-content">
                {children}
              </main>
            </div>
          </CRMProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
