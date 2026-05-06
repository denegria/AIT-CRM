import './globals.css';
import { CRMProvider } from '@/lib/store';
import { ToastProvider } from '@/components/Toast';
import Sidebar from '@/components/Sidebar';

export const metadata = {
  title: 'AIT Signs',
  description: 'AIT Signs Operational CRM — Lead management, work orders, and financials.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ToastProvider>
          <CRMProvider>
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
