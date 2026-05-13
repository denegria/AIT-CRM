'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCRM } from '@/lib/store';
import { useToast } from '@/components/Toast';
import s from './Sidebar.module.css';

import { LayoutDashboard, Users, ClipboardList, DollarSign, BarChart3, Settings, Moon, Sun, Database, LogOut } from 'lucide-react';

const nav = [
  { href: '/', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/contacts', label: 'Contacts', Icon: Users },
  { href: '/import-review', label: 'Import Review', Icon: Database },
  { href: '/work-orders', label: 'Work Orders', Icon: ClipboardList },
  { href: '/financials', label: 'Financials', Icon: DollarSign },
  { href: '/reports', label: 'Reports', Icon: BarChart3 },
  { href: '/settings', label: 'Settings', Icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { role, theme, setTheme, currentUser, access, dataSource } = useCRM();
  const { toast } = useToast();

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    window.location.reload();
  };

  return (
    <aside className={s.sidebar}>
      <div className={s.logo}>
        <span className={s.logoIcon}>◆</span>
        <span>AIT Signs</span>
      </div>
      <nav className={s.navSection}>
        <div className={s.navLabel}>Menu</div>
        {nav.map(({ href, label, Icon }) => {
          if (href === '/settings' && !access.canReadSettings) return null;
          if (href === '/import-review' && !access.canReadImportReview) return null;
          if (href === '/reports' && !access.canReadReports && role !== 'admin') return null;
          if (href === '/financials' && !access.canReadFinancials && role !== 'admin') return null;
          return (
            <Link key={href} href={href} className={`${s.navItem} ${pathname === href ? s.active : ''}`}>
              <Icon /><span>{label}</span>
            </Link>
          );
        })}
      </nav>
      <div className={s.bottom}>
        <div className={s.themeToggle}>
          <button className={s.themeBtn} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            <span>{theme === 'light' ? 'Dark Mode' : 'Light Mode'}</span>
          </button>
        </div>
        <div className={s.roleSwitcher}>
          <label className={s.roleLabel}>Signed In</label>
          <div className={s.userName}>{currentUser?.name || 'Local Admin'}</div>
          <div className={s.userEmail}>{currentUser?.email || 'local fallback'}</div>
        </div>
        <div className={s.roleBadge}>
          {role === 'admin' ? 'Full Access' : 'Restricted Access'}
        </div>
        {dataSource === 'postgres' && (
          <button className={s.logoutBtn} onClick={handleLogout}>
            <LogOut size={14} />
            <span>Sign out</span>
          </button>
        )}
      </div>
    </aside>
  );
}
