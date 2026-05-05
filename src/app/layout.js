import './globals.css';
import { CRMProvider } from '@/lib/store';
import { ToastProvider } from '@/components/Toast';
import Sidebar from '@/components/Sidebar';

export const metadata = {
  title: 'AIT CRM',
  description: 'Lead management, work orders, financials, and reporting — AIT Services CRM.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <CRMProvider>
          <ToastProvider>
            <div className="app-layout">
              <Sidebar />
              <main className="main-content">
                {children}
              </main>
            </div>
          </ToastProvider>
        </CRMProvider>
      </body>
    </html>
  );
}
