'use client';
import Link from 'next/link';
import s from './KPICard.module.css';

import { TrendingUp, TrendingDown } from 'lucide-react';

export default function KPICard({ label, value, change, trend, href }) {
  const content = (
    <>
      <span className={s.label}>{label}</span>
      <span className={s.value}>{value}</span>
      {change && (
        <span className={`${s.change} ${trend === 'up' ? s.up : s.down}`}>
          {trend === 'up' ? <TrendingUp size={14} /> : <TrendingDown size={14} />} {change}
        </span>
      )}
    </>
  );

  if (href) {
    return (
      <Link className={`${s.card} ${s.link}`} href={href} aria-label={`Open ${label}`}>
        {content}
      </Link>
    );
  }

  return (
    <div className={s.card}>
      {content}
    </div>
  );
}
