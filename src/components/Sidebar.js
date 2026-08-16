'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { publishLogout } from '@/lib/auth/session-sync.js';
import { useRecordScope } from '@/components/RecordScopeContext';
import { roleLabel } from '@/lib/roles.js';
import { useCRM } from '@/lib/store';
import { canUseTeamMonitorWorkspace, canUseWorkOrdersForBusinessUnit, coordinatorUiPolicyForUser } from '@/lib/crm/coordinator-policy.js';
import { isAitUsaBusinessUnit } from '@/lib/attendance/policy.js';
import { isClientAccountBusinessUnit } from '@/lib/crm/lifecycle';
import s from './Sidebar.module.css';

import { LayoutDashboard, Users, ClipboardList, DollarSign, BarChart3, Settings, Moon, Sun, CloudSun, Database, LogOut, Building2, ListTodo, RadioTower, Columns3, MoreHorizontal, Inbox, Megaphone, UsersRound, BookOpenCheck } from 'lucide-react';

const nav = [
  { href: '/', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/contacts', label: 'Contacts', Icon: Users },
  { href: '/pipeline', label: 'Pipeline', Icon: Columns3 },
  { href: '/tasks', label: 'Tasks', Icon: ListTodo },
  { href: '/recovery-queue', label: 'Recovery Queue', mobileLabel: 'Recovery', Icon: ListTodo },
  { href: '/active-classes', label: 'Active Classes', mobileLabel: 'Classes', Icon: BookOpenCheck },
  { href: '/team-monitor', label: 'Team Monitor', Icon: UsersRound },
  { href: '/inbox', label: 'Inbox', Icon: Inbox },
  { href: '/sms-campaigns', label: 'SMS Campaigns', Icon: Megaphone },
  { href: '/import-review', label: 'Import Review', Icon: Database },
  { href: '/work-orders', label: 'Work Orders', Icon: ClipboardList },
  { href: '/financials', label: 'Financials', Icon: DollarSign },
  { href: '/reports', label: 'Reports', Icon: BarChart3 },
  { href: '/comms-ops', label: 'Comms Ops', Icon: RadioTower },
  { href: '/settings', label: 'Settings', Icon: Settings },
];

const mobilePrimaryPriority = ['/', '/clients', '/contacts', '/pipeline', '/tasks', '/work-orders'];
const regularCoordinatorNav = new Set(['/', '/clients', '/contacts', '/pipeline', '/tasks', '/recovery-queue', '/active-classes', '/work-orders']);
const scopePersistenceKeys = ['ait-crm-business-unit-scope', 'ait-crm-scope-user-id'];

const themeOptions = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dusk', label: 'Dusk', Icon: CloudSun },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

function isRouteActive(pathname, href) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function formatRoleLabel(roleKey) {
  return roleLabel(roleKey);
}

function divisionBrandFor(unit) {
  const unitName = String(unit?.name || '').trim();
  if (/ait\s*signs/i.test(unitName)) {
    return {
      title: 'AIT Signs',
      alt: 'AIT Signs',
      logoSrc: '/ait-signs-logo.png',
      mark: '',
    };
  }
  if (/ait\s*usa/i.test(unitName)) {
    return {
      title: 'AIT USA',
      alt: 'AIT USA',
      logoSrc: '/logo.png',
      mark: '',
    };
  }
  return {
    title: unitName || 'AIT CRM',
    alt: unitName || 'AIT CRM',
    logoSrc: '/logo.png',
    mark: '',
  };
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
  const { recordBusinessUnit } = useRecordScope();
  const displayedBusinessUnit = recordBusinessUnit || currentBusinessUnit;
  const isRecordScope = Boolean(recordBusinessUnit?.id);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    // Clear persisted scope so next user starts fresh
    scopePersistenceKeys.forEach((key) => {
      localStorage.removeItem(key);
      document.cookie = `${key}=; Path=/; Max-Age=0; SameSite=Lax`;
    });
    publishLogout('manual-logout');
    window.location.reload();
  };

  const isClientViewScope = isRecordScope
    ? isClientAccountBusinessUnit(displayedBusinessUnit)
    : currentBusinessUnitId !== 'all' && isClientAccountBusinessUnit(currentBusinessUnit);
  const canUseFinancialsWorkspace = Boolean(access.canReadSettings || access.canReadReports || role === 'admin');
  const canReadMessagingInbox = Boolean(access.canReadMessagingInbox);
  const canManageSmsCampaigns = Boolean(access.canManageSmsCampaigns);
  const hasBusinessUnitScope = Boolean(recordBusinessUnit?.id || accessibleBusinessUnits?.length > 0);
  const divisionBrand = useMemo(() => divisionBrandFor(displayedBusinessUnit), [displayedBusinessUnit]);
  const monitorCurrentUser = useMemo(() => currentUser || { id: 'emp-1', primaryRoleKey: role }, [currentUser, role]);
  const coordinatorUiPolicy = useMemo(() => coordinatorUiPolicyForUser(currentUser), [currentUser]);
  const canUseWorkOrders = useMemo(
    () => canUseWorkOrdersForBusinessUnit(currentUser, displayedBusinessUnit),
    [currentUser, displayedBusinessUnit],
  );
  const isAitUsaScope = isAitUsaBusinessUnit(displayedBusinessUnit?.name);

  useEffect(() => {
    document.title = divisionBrand.title;
  }, [divisionBrand.title]);

  const scopedNav = useMemo(() => nav.map((item) => {
    if (item.href === '/contacts' && isClientViewScope) {
      return { href: '/clients', label: 'Clients', Icon: Building2 };
    }
    return item;
  }), [isClientViewScope]);

  const visibleNav = useMemo(() => scopedNav.filter(({ href }) => {
    if (coordinatorUiPolicy.isRegularCoordinator && !regularCoordinatorNav.has(href)) return false;
    if (href === '/active-classes' && !isAitUsaScope) return false;
    if (href === '/work-orders' && !canUseWorkOrders) return false;
    if (href === '/team-monitor' && !canUseTeamMonitorWorkspace(monitorCurrentUser)) return false;
    if (href === '/settings' && !access.canReadSettings) return false;
    if (href === '/comms-ops' && !access.canReadSettings) return false;
    if (href === '/import-review' && !access.canReadImportReview) return false;
    if (href === '/reports' && !access.canReadReports) return false;
    if (href === '/financials' && (!access.canReadFinancials || !canUseFinancialsWorkspace)) return false;
    if (href === '/inbox' && !canReadMessagingInbox) return false;
    if (href === '/sms-campaigns' && !canManageSmsCampaigns) return false;
    return true;
  }), [access.canReadFinancials, access.canReadImportReview, access.canReadReports, access.canReadSettings, canManageSmsCampaigns, canReadMessagingInbox, canUseFinancialsWorkspace, canUseWorkOrders, coordinatorUiPolicy.isRegularCoordinator, isAitUsaScope, monitorCurrentUser, scopedNav]);

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

  const renderScopeControl = () => {
    if (isRecordScope) {
      return (
        <div className={s.recordScopeValue} aria-label={`Record division: ${displayedBusinessUnit.name}`}>
          {displayedBusinessUnit.name}
        </div>
      );
    }
    return (
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
    );
  };

  return (
    <aside className={`${s.sidebar} ${hasBusinessUnitScope ? s.hasMobileScope : ''}`}>
      <div className={s.logo}>
        {divisionBrand.logoSrc ? (
          <Image src={divisionBrand.logoSrc} alt={divisionBrand.alt} width={40} height={40} className={s.logoImage} />
        ) : (
          <span className={s.logoMark} aria-hidden="true">{divisionBrand.mark}</span>
        )}
        <span>{divisionBrand.title}</span>
      </div>
      {hasBusinessUnitScope && (
        <div className={s.mobileScopeBar}>
          <div className={s.mobileScopeTitle}>
            <Building2 size={14} />
            <span>{isRecordScope ? 'Record division' : currentBusinessUnit?.name || scopeLabel}</span>
          </div>
          {renderScopeControl()}
        </div>
      )}
      <nav className={s.navSection}>
        {hasBusinessUnitScope && (
          <div className={s.scopePanel}>
            <div className={s.scopeTitle}>
              <Building2 size={14} />
              <span>{isRecordScope ? 'Record division' : scopeLabel}</span>
            </div>
            {renderScopeControl()}
          </div>
        )}
        <div className={s.navLabel}>Menu</div>
        <div className={s.desktopNav}>
          {visibleNav.map((item) => renderNavLink(item))}
        </div>
        <div className={s.mobileNav}>
          {mobileNav.primary.map((item) => renderNavLink({ ...item, label: item.mobileLabel || item.label }, s.mobileNavItem))}
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
        <div className={s.themeToggle} role="group" aria-label="Theme">
          {themeOptions.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              className={`${s.themeBtn} ${theme === value ? s.themeBtnActive : ''}`}
              onClick={() => setTheme(value)}
              aria-pressed={theme === value}
              title={`${label} theme`}
            >
              <Icon size={15} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className={s.roleSwitcher}>
          <label className={s.roleLabel}>Signed In</label>
          <div className={s.userName}>{currentUser?.name || 'Local Admin'}</div>
          <div className={s.userEmail}>{currentUser?.email || 'local fallback'}</div>
        </div>
        <div className={s.roleBadge}>
          {dataSource === 'postgres' && currentUser?.primaryRoleKey
            ? formatRoleLabel(currentUser.primaryRoleKey)
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
