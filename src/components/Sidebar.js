'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCRM } from '@/lib/store';
import { useToast } from '@/components/Toast';
import s from './Sidebar.module.css';

import { LayoutDashboard, Users, ClipboardList, DollarSign, BarChart3, Settings, Moon, Sun } from 'lucide-react';

const nav = [
  { href: '/', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/contacts', label: 'Contacts', Icon: Users },
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
          if (role === 'employee' && href === '/settings') return null;
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
        <div className={s.roleToggle}>
          <button className={`${s.roleBtn} ${role==='admin'?s.activeRole:''}`} onClick={()=>handleRoleChange('admin')}>Admin</button>
          <button className={`${s.roleBtn} ${role==='employee'?s.activeRole:''}`} onClick={()=>handleRoleChange('employee')}>Employee</button>
        </div>
        <div className={s.roleBadge}>Viewing as {role === 'admin' ? 'Administrator' : 'Employee'}</div>
      </div>
    </aside>
  );
}
