'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  CONTACT_LEAD_DATE_SCOPE_ALL,
  CONTACT_LEAD_DATE_SCOPE_CUSTOM,
  CONTACT_LEAD_DATE_SCOPE_QUARTER,
  contactLeadDatePanelSummary,
  DEFAULT_CONTACT_LEAD_DATE_SCOPE,
} from '@/lib/contact-directory-filters';

const DAY_MS = 86400000;

function todayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function monthStart(date = todayUtc()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date, offset) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function parseDate(value = '') {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? null : date;
}

function displayDate(value = '') {
  const date = parseDate(value);
  if (!date) return 'Not set';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function monthLabel(date) {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function calendarDays(visibleMonth) {
  const start = monthStart(visibleMonth);
  const gridStart = new Date(start.getTime() - start.getUTCDay() * DAY_MS);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart.getTime() + index * DAY_MS);
    return {
      date,
      iso: formatDate(date),
      label: String(date.getUTCDate()),
      inMonth: date.getUTCMonth() === start.getUTCMonth(),
    };
  });
}

function compareDates(a = '', b = '') {
  if (!a || !b) return 0;
  return a.localeCompare(b);
}

function inSelectedRange(iso, from = '', to = '') {
  if (!from && !to) return false;
  if (from && !to) return iso === from;
  if (!from && to) return iso === to;
  return iso >= from && iso <= to;
}

export default function TimeframeFilterPanel({
  activeScope,
  counts,
  leadDateFrom,
  leadDateTo,
  onDateRangeChange,
  onScopeChange,
}) {
  const initialMonth = parseDate(leadDateFrom) || todayUtc();
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(initialMonth));
  const days = useMemo(() => calendarDays(visibleMonth), [visibleMonth]);
  const isCustom = activeScope === CONTACT_LEAD_DATE_SCOPE_CUSTOM;
  const panelSummary = useMemo(
    () => contactLeadDatePanelSummary(activeScope, leadDateFrom, leadDateTo),
    [activeScope, leadDateFrom, leadDateTo],
  );

  const options = [
    {
      id: CONTACT_LEAD_DATE_SCOPE_QUARTER,
      label: 'This Quarter',
      detail: 'Quarter-to-date',
      count: counts.quarter,
    },
    {
      id: DEFAULT_CONTACT_LEAD_DATE_SCOPE,
      label: 'Current Year',
      detail: 'Year-to-date',
      count: counts.current,
    },
    {
      id: CONTACT_LEAD_DATE_SCOPE_ALL,
      label: 'All Leads',
      detail: 'No date limit',
      count: counts.all,
    },
  ];

  function pickDate(iso) {
    if (!isCustom || (leadDateFrom && leadDateTo)) {
      onDateRangeChange(iso, '');
      return;
    }

    if (!leadDateFrom) {
      onDateRangeChange(iso, leadDateTo || '');
      return;
    }

    if (compareDates(iso, leadDateFrom) < 0) {
      onDateRangeChange(iso, leadDateFrom);
      return;
    }

    onDateRangeChange(leadDateFrom, iso);
  }

  return (
    <div className="timeframe-filter-panel">
      <div className="timeframe-filter-options" aria-label="Timeframe presets">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`timeframe-filter-option ${activeScope === option.id ? 'active' : ''}`}
            onClick={() => onScopeChange(option.id)}
            aria-pressed={activeScope === option.id}
          >
            <span className="timeframe-filter-option-icon">
              <CalendarDays size={15} aria-hidden="true" />
            </span>
            <span className="timeframe-filter-option-copy">
              <strong>{option.label}</strong>
              <small>{option.detail}</small>
            </span>
            <span className="timeframe-filter-option-count">{option.count}</span>
          </button>
        ))}
      </div>

      <div className={`timeframe-calendar-card ${isCustom ? 'active' : ''}`}>
        {isCustom ? (
          <div className="timeframe-date-chips" aria-label="Selected calendar range">
            <span>
              <small>From</small>
              <strong>{displayDate(leadDateFrom)}</strong>
            </span>
            <span>
              <small>To</small>
              <strong>{displayDate(leadDateTo)}</strong>
            </span>
          </div>
        ) : (
          <div className="timeframe-preset-summary" aria-label="Selected timeframe">
            <small>{panelSummary.label}</small>
            <strong>{panelSummary.value}</strong>
            <p>{panelSummary.detail}</p>
          </div>
        )}

        <div className="timeframe-calendar-head">
          <button
            type="button"
            className="timeframe-calendar-nav"
            onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
            aria-label="Previous month"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <strong>{monthLabel(visibleMonth)}</strong>
          <button
            type="button"
            className="timeframe-calendar-nav"
            onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
            aria-label="Next month"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="timeframe-calendar-grid" aria-label="Inline calendar">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
            <span key={day} className="timeframe-calendar-weekday">{day}</span>
          ))}
          {days.map((day) => (
            <button
              key={day.iso}
              type="button"
              className={[
                'timeframe-calendar-day',
                day.inMonth ? '' : 'muted',
                inSelectedRange(day.iso, leadDateFrom, leadDateTo) ? 'in-range' : '',
                day.iso === leadDateFrom || day.iso === leadDateTo ? 'range-edge' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => pickDate(day.iso)}
              aria-pressed={isCustom && inSelectedRange(day.iso, leadDateFrom, leadDateTo)}
            >
              {day.label}
            </button>
          ))}
        </div>

        <div className="timeframe-calendar-hint">
          {isCustom ? `${counts.custom} matching range` : 'Choose dates below to switch to a custom range'}
        </div>
      </div>
    </div>
  );
}
