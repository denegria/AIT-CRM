'use client';
import { useState, useMemo } from 'react';
import s from './Calendar.module.css';

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function Calendar({ events = [] }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const days = useMemo(() => {
    const first = new Date(year, month, 1);
    const startDay = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevDays = new Date(year, month, 0).getDate();
    const cells = [];
    for (let i = startDay - 1; i >= 0; i--) cells.push({ day: prevDays - i, current: false });
    for (let i = 1; i <= daysInMonth; i++) cells.push({ day: i, current: true });
    const rem = 42 - cells.length;
    for (let i = 1; i <= rem; i++) cells.push({ day: i, current: false });
    return cells;
  }, [year, month]);

  const eventMap = useMemo(() => {
    const m = {};
    events.forEach(ev => {
      const d = new Date(ev.date);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const key = d.getDate();
        if (!m[key]) m[key] = [];
        m[key].push(ev);
      }
    });
    return m;
  }, [events, year, month]);

  const prev = () => { if (month === 0) { setMonth(11); setYear(y=>y-1); } else setMonth(m=>m-1); };
  const next = () => { if (month === 11) { setMonth(0); setYear(y=>y+1); } else setMonth(m=>m+1); };

  const isToday = (day, current) => current && day === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  return (
    <div className={s.calendar}>
      <div className={s.header}>
        <button className={s.navBtn} onClick={prev}>‹</button>
        <span className={s.monthLabel}>{MONTHS[month]} {year}</span>
        <button className={s.navBtn} onClick={next}>›</button>
      </div>
      <div className={s.grid}>
        {DAYS.map(d => <div key={d} className={s.dayLabel}>{d}</div>)}
        {days.map((d, i) => (
          <div key={i} className={`${s.day} ${isToday(d.day, d.current) ? s.today : ''} ${!d.current ? s.otherMonth : ''}`} title={eventMap[d.day]?.map(e=>e.title).join(', ')}>
            {d.day}
            {d.current && eventMap[d.day] && (
              <span className={`${s.dot} ${s['dot' + (eventMap[d.day][0].type || 'meeting').charAt(0).toUpperCase() + (eventMap[d.day][0].type || 'meeting').slice(1)]}`} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
