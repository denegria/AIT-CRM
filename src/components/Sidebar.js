'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCRM } from '@/lib/store';
import { useToast } from '@/components/Toast';
import s from './Sidebar.module.css';

import { LayoutDashboard, Users, ClipboardList, DollarSign, BarChart3, Settings, Moon, Sun, Database, LogOut, Building2 } from 'lucide-react';

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
  const {
    role,
    theme,
    setTheme,
    currentUser,
    access,
    dataSource,
    accessibleBusinessUnits,
    currentBusinessUnitId,
    setCurrentBusinessUnitId,
    canUseConsolidatedScope,
    scopeLabel,
  } = useCRM();
  const { toast } = useToast();

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    window.location.reload();
  };

  return (
    <aside className={s.sidebar}>
      <div className={s.logo}>
        <img src="/logo.png" alt="AIT USA" className={s.logoImage} />
        <span>AIT USA</span>
      </div>
      <nav className={s.navSection}>
        <div className={s.navLabel}>Menu</div>
        {nav.map(({ href, label, Icon }) => {
          if (href === '/settings' && !access.canReadSettings) return null;
          if (href === '/import-review' && !access.canReadImportReview) return null;
          if ((href === '/reports' || href === '/financials') && role !== 'admin') return null;
          return (
            <Link key={href} href={href} className={`${s.navItem} ${pathname === href ? s.active : ''}`}>
              <Icon /><span>{label}</span>
            </Link>
          );
        })}
        {accessibleBusinessUnits?.length > 0 && (
          <div className={s.scopePanel}>
            <div className={s.scopeTitle}>
              <Building2 size={14} />
              <span>{scopeLabel}</span>
            </div>
            <select
              className={s.scopeSelect}
              value={currentBusinessUnitId}
              onChange={(event) => setCurrentBusinessUnitId(event.target.value)}
              aria-label={`${scopeLabel} scope`}
            >
              {canUseConsolidatedScope && <option value="all">All {scopeLabel}</option>}
              <option value="unassigned">Unassigned</option>
              {accessibleBusinessUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>{unit.name}</option>
              ))}
            </select>
          </div>
        )}
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
