'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import s from './Calendar.module.css';

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function eventDate(value) {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function eventTone(type) {
  const key = type || 'meeting';
  return s[`dot${key.charAt(0).toUpperCase()}${key.slice(1)}`] || s.dotMeeting;
}

function calendarItemTitle(event = {}) {
  return String(event.title || 'Calendar item').replace(/^Task:\s*/i, '').trim() || 'Calendar item';
}

function calendarItemDescription(event = {}) {
  return String(event.description || event.detail || event.subtitle || '').trim();
}

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
      const d = eventDate(ev.date);
      if (!d) return;
      if (d.getFullYear() === year && d.getMonth() === month) {
        const key = d.getDate();
        if (!m[key]) m[key] = [];
        m[key].push(ev);
      }
    });
    return m;
  }, [events, year, month]);

  const visibleEvents = useMemo(() => {
    return events
      .map((event) => ({ ...event, parsedDate: eventDate(event.date) }))
      .filter((event) => event.parsedDate && event.parsedDate.getFullYear() === year && event.parsedDate.getMonth() === month)
      .sort((left, right) => {
        const dayDiff = left.parsedDate.getDate() - right.parsedDate.getDate();
        if (dayDiff) return dayDiff;
        return String(left.title || '').localeCompare(String(right.title || ''));
      });
  }, [events, month, year]);

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
        {days.map((d, i) => {
          const dayEvents = d.current ? eventMap[d.day] || [] : [];
          return (
            <div key={i} className={`${s.day} ${isToday(d.day, d.current) ? s.today : ''} ${!d.current ? s.otherMonth : ''}`} title={dayEvents.map(e=>e.title).join(', ')}>
              <span className={s.dayNumber}>{d.day}</span>
              {dayEvents.length > 0 && (
                <div className={s.dayEvents}>
                  {dayEvents.slice(0, 2).map((event) => {
                    const content = (
                      <>
                        <span className={`${s.eventDot} ${eventTone(event.type)}`} />
                        <span className={s.dayEventCopy}>
                          <strong>{calendarItemTitle(event)}</strong>
                          {calendarItemDescription(event) && <small>{calendarItemDescription(event)}</small>}
                        </span>
                      </>
                    );
                    return event.href ? (
                      <Link key={event.id || `${event.date}-${event.title}`} className={s.dayEvent} href={event.href}>
                        {content}
                      </Link>
                    ) : (
                      <div key={event.id || `${event.date}-${event.title}`} className={s.dayEvent}>
                        {content}
                      </div>
                    );
                  })}
                  {dayEvents.length > 2 && (
                    <span className={s.dayEventMore}>+{dayEvents.length - 2} more</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {visibleEvents.length > 0 && (
        <div className={s.eventList} aria-label={`${MONTHS[month]} calendar items`}>
          {visibleEvents.slice(0, 6).map((event) => {
            const content = (
              <>
                <span className={`${s.eventDot} ${eventTone(event.type)}`} />
                <span className={s.eventDay}>{event.parsedDate.getDate()}</span>
                <span className={s.eventTitle}>{event.title}</span>
              </>
            );
            return event.href ? (
              <Link key={event.id || `${event.date}-${event.title}`} className={s.eventItem} href={event.href}>
                {content}
              </Link>
            ) : (
              <div key={event.id || `${event.date}-${event.title}`} className={s.eventItem}>
                {content}
              </div>
            );
          })}
          {visibleEvents.length > 6 && (
            <div className={s.eventMore}>+{visibleEvents.length - 6} more this month</div>
          )}
        </div>
      )}
    </div>
  );
}
