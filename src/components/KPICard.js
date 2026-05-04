'use client';
import s from './KPICard.module.css';

import { TrendingUp, TrendingDown } from 'lucide-react';

export default function KPICard({ label, value, change, trend }) {
  return (
    <div className={s.card}>
      <span className={s.label}>{label}</span>
      <span className={s.value}>{value}</span>
      {change && (
        <span className={`${s.change} ${trend === 'up' ? s.up : s.down}`}>
          {trend === 'up' ? <TrendingUp size={14} /> : <TrendingDown size={14} />} {change}
        </span>
      )}
    </div>
  );
}
