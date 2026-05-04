'use client';
import { useRef, useEffect } from 'react';

export function BarChart({ data, width = 400, height = 200 }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr; canvas.height = height * dpr;
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, width, height);

    if (!data || data.length === 0) return;
    const maxVal = Math.max(...data.map(d => d.value), 1);
    const pad = { top: 10, right: 10, bottom: 30, left: 50 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;
    const barW = Math.min(32, (chartW / data.length) * 0.6);
    const gap = chartW / data.length;

    // Grid lines
    ctx.strokeStyle = '#27272a'; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (chartH / 4) * i;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
      ctx.fillStyle = '#71717a'; ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'right';
      ctx.fillText('$' + Math.round(maxVal - (maxVal / 4) * i).toLocaleString(), pad.left - 6, y + 3);
    }

    // Bars
    data.forEach((d, i) => {
      const barH = (d.value / maxVal) * chartH;
      const x = pad.left + i * gap + (gap - barW) / 2;
      const y = pad.top + chartH - barH;
      const gradient = ctx.createLinearGradient(x, y, x, y + barH);
      gradient.addColorStop(0, d.color || '#4a7aff');
      gradient.addColorStop(1, (d.color || '#4a7aff') + '60');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]);
      ctx.fill();
      ctx.fillStyle = '#a1a1aa'; ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(d.label, pad.left + i * gap + gap / 2, height - 8);
    });
  }, [data, width, height]);

  return <canvas ref={ref} style={{ width: '100%', maxWidth: width, height }} />;
}

export function PieChart({ data, size = 180 }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr; canvas.height = size * dpr;
    canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, size, size);

    if (!data || data.length === 0) return;
    const total = data.reduce((s, d) => s + d.value, 0);
    if (total === 0) return;
    const cx = size / 2, cy = size / 2, r = size / 2 - 8, inner = r * 0.6;
    let angle = -Math.PI / 2;

    data.forEach(d => {
      const slice = (d.value / total) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx + inner * Math.cos(angle), cy + inner * Math.sin(angle));
      ctx.arc(cx, cy, r, angle, angle + slice);
      ctx.arc(cx, cy, inner, angle + slice, angle, true);
      ctx.closePath();
      ctx.fillStyle = d.color; ctx.fill();
      angle += slice;
    });

    ctx.fillStyle = '#a1a1aa'; ctx.font = 'bold 16px Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(total.toLocaleString(), cx, cy + 1);
    ctx.font = '9px Inter, sans-serif'; ctx.fillText('Total', cx, cy + 14);
  }, [data, size]);

  return <canvas ref={ref} style={{ width: size, height: size }} />;
}

export function ChartLegend({ data }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-xs)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
          <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{d.label}</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{d.value}</span>
        </div>
      ))}
    </div>
  );
}
