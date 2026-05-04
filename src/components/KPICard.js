'use client';
import s from './KPICard.module.css';

export default function KPICard({ label, value, change, trend }) {
  return (
    <div className={s.card}>
      <span className={s.label}>{label}</span>
      <span className={s.value}>{value}</span>
      {change && (
        <span className={`${s.change} ${trend === 'up' ? s.up : s.down}`}>
          {trend === 'up' ? '↑' : '↓'} {change}
        </span>
      )}
    </div>
  );
}
