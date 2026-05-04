'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCRM } from '@/lib/store';
import s from './Sidebar.module.css';

const DashIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
const UsersIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
const ClipIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 14l2 2 4-4"/></svg>;
const DollarIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>;
const ChartIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>;
const GearIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;

const nav = [
  { href: '/', label: 'Dashboard', Icon: DashIcon },
  { href: '/contacts', label: 'Contacts', Icon: UsersIcon },
  { href: '/work-orders', label: 'Work Orders', Icon: ClipIcon },
  { href: '/financials', label: 'Financials', Icon: DollarIcon },
  { href: '/reports', label: 'Reports', Icon: ChartIcon },
  { href: '/settings', label: 'Settings', Icon: GearIcon },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { role, setRole } = useCRM();
  return (
    <aside className={s.sidebar}>
      <div className={s.logo}>
        <span className={s.logoIcon}>◆</span>
        <span>AIT CRM</span>
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
