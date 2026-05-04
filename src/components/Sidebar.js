'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCRM } from '@/lib/store';
import s from './Sidebar.module.css';

import { LayoutDashboard, Users, ClipboardList, DollarSign, BarChart3, Settings } from 'lucide-react';

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
  const { role, setRole } = useCRM();
  return (
    <aside className={s.sidebar}>
      <div className={s.logo}>
        <span className={s.logoIcon}>◆</span>
        <span>AIT Signs</span>
      </div>
      <nav className={s.navSection}>
        <div className={s.navLabel}>Menu</div>
        {nav.map(({ href, label, Icon }) => (
          <Link key={href} href={href} className={`${s.navItem} ${pathname === href ? s.active : ''}`}>
            <Icon /><span>{label}</span>
          </Link>
        ))}
      </nav>
      <div className={s.bottom}>
        <div className={s.roleToggle}>
          <button className={`${s.roleBtn} ${role==='admin'?s.activeRole:''}`} onClick={()=>setRole('admin')}>Admin</button>
          <button className={`${s.roleBtn} ${role==='employee'?s.activeRole:''}`} onClick={()=>setRole('employee')}>Employee</button>
        </div>
        <div className={s.roleBadge}>Viewing as {role === 'admin' ? 'Administrator' : 'Employee'}</div>
      </div>
    </aside>
  );
}
