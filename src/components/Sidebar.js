'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCRM } from '@/lib/store';
import { useToast } from '@/components/Toast';
import s from './Sidebar.module.css';

import { LayoutDashboard, Users, ClipboardList, DollarSign, BarChart3, Settings, Moon, Sun, Database } from 'lucide-react';

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
  const { role, setRole, theme, setTheme } = useCRM();
  const { toast } = useToast();

  const handleRoleChange = (newRole) => {
    setRole(newRole);
    toast(`Switched to ${newRole} view`);
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
          if (role !== 'admin' && (href === '/settings' || href === '/import-review')) return null;
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
          <label className={s.roleLabel}>System Role</label>
          <select 
            className="input select" 
            style={{padding: '4px 8px', fontSize: 'var(--text-xs)'}} 
            value={role} 
            onChange={(e) => handleRoleChange(e.target.value)}
          >
            <option value="admin">Administrator</option>
            <option value="designer">Designer</option>
            <option value="account_manager">Account Manager</option>
            <option value="sales_manager">Sales Manager</option>
          </select>
        </div>
        <div className={s.roleBadge}>
          {role === 'admin' ? 'Full Access' : 'Restricted Access'}
        </div>
      </div>
    </aside>
  );
}
