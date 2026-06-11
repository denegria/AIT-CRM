'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useCRM } from '@/lib/store';
import s from './Sidebar.module.css';

import { LayoutDashboard, Users, ClipboardList, DollarSign, BarChart3, Settings, Moon, Sun, Database, LogOut, Building2, ListTodo, RadioTower, Columns3, MoreHorizontal } from 'lucide-react';

const nav = [
  { href: '/', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/contacts', label: 'Contacts', Icon: Users },
  { href: '/pipeline', label: 'Pipeline', Icon: Columns3 },
  { href: '/tasks', label: 'Tasks', Icon: ListTodo },
  { href: '/import-review', label: 'Import Review', Icon: Database },
  { href: '/work-orders', label: 'Work Orders', Icon: ClipboardList },
  { href: '/financials', label: 'Financials', Icon: DollarSign },
  { href: '/reports', label: 'Reports', Icon: BarChart3 },
  { href: '/comms-ops', label: 'Comms Ops', Icon: RadioTower },
  { href: '/settings', label: 'Settings', Icon: Settings },
];

const mobilePrimaryPriority = ['/', '/clients', '/contacts', '/pipeline', '/tasks'];
const clientViewBusinessUnits = new Set(['AIT Signs']);

function isRouteActive(pathname, href) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Sidebar() {
  const pathname = usePathname();
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const {
    role,
    theme,
    setTheme,
    currentUser,
    access,
    dataSource,
    accessibleBusinessUnits,
    currentBusinessUnitId,
    currentBusinessUnit,
    setCurrentBusinessUnitId,
    scopeLabel,
  } = useCRM();

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    // Clear persisted scope so next user starts fresh
    localStorage.removeItem('ait-crm-business-unit-scope');
    localStorage.removeItem('ait-crm-scope-user-id');
    window.location.reload();
  };

  const isClientViewScope = currentBusinessUnitId !== 'all' && clientViewBusinessUnits.has(currentBusinessUnit?.name);
  const scopedNav = useMemo(() => nav.map((item) => {
    if (item.href === '/contacts' && isClientViewScope) {
      return { href: '/clients', label: 'Clients', Icon: Building2 };
    }
    return item;
  }), [isClientViewScope]);

  const visibleNav = useMemo(() => scopedNav.filter(({ href }) => {
    if (href === '/settings' && !access.canReadSettings) return false;
    if (href === '/comms-ops' && !access.canReadSettings) return false;
    if (href === '/import-review' && !access.canReadImportReview) return false;
    if (href === '/reports' && !access.canReadReports) return false;
    if (href === '/financials' && !access.canReadFinancials) return false;
    return true;
  }), [access.canReadFinancials, access.canReadImportReview, access.canReadReports, access.canReadSettings, scopedNav]);

  const mobileNav = useMemo(() => {
    if (visibleNav.length <= 5) {
      return { primary: visibleNav, overflow: [] };
    }

    const priority = new Set(mobilePrimaryPriority);
    const primary = visibleNav.filter((item) => priority.has(item.href)).slice(0, 4);

    for (const item of visibleNav) {
      if (primary.length >= 4) break;
      if (!primary.some((primaryItem) => primaryItem.href === item.href)) {
        primary.push(item);
      }
    }

    return {
      primary,
      overflow: visibleNav.filter((item) => !primary.some((primaryItem) => primaryItem.href === item.href)),
    };
  }, [visibleNav]);

  const renderNavLink = ({ href, label, Icon }, className = s.navItem) => (
    <Link key={href} href={href} className={`${className} ${isRouteActive(pathname, href) ? s.active : ''}`} aria-label={label} title={label} onClick={() => setIsMoreOpen(false)}>
      <Icon /><span>{label}</span>
    </Link>
  );

  return (
    <aside className={s.sidebar}>
      <div className={s.logo}>
        <Image src="/logo.png" alt="AIT USA" width={40} height={40} className={s.logoImage} />
        <span>AIT USA</span>
      </div>
      <nav className={s.navSection}>
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
              <option value="unassigned" title="Shows records that have not been assigned to any division">No Division</option>
              {accessibleBusinessUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>{unit.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className={s.navLabel}>Menu</div>
        <div className={s.desktopNav}>
          {visibleNav.map((item) => renderNavLink(item))}
        </div>
        <div className={s.mobileNav}>
          {mobileNav.primary.map((item) => renderNavLink(item, s.mobileNavItem))}
          {mobileNav.overflow.length > 0 && (
            <div className={s.moreWrap}>
              <button
                type="button"
                className={`${s.mobileNavItem} ${mobileNav.overflow.some((item) => isRouteActive(pathname, item.href)) ? s.active : ''}`}
                aria-label="More navigation"
                aria-expanded={isMoreOpen}
                aria-haspopup="menu"
                onClick={() => setIsMoreOpen((open) => !open)}
              >
                <MoreHorizontal /><span>More</span>
              </button>
              {isMoreOpen && (
                <div className={s.moreMenu} role="menu" aria-label="More navigation">
                  {mobileNav.overflow.map(({ href, label, Icon }) => (
                    <Link key={href} href={href} className={s.moreMenuItem} role="menuitem" onClick={() => setIsMoreOpen(false)}>
                      <Icon /><span>{label}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
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
          {dataSource === 'postgres' && currentUser?.primaryRoleKey
            ? currentUser.primaryRoleKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
            : role === 'admin' ? 'Full Access' : 'Restricted Access'}
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
