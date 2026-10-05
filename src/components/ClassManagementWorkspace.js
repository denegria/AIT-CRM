'use client';

import { useEffect, useMemo, useState } from 'react';
import { schoolLocationOptions } from '../lib/school-locations.js';
import { CANONICAL_WEEKDAYS } from '../lib/schedule-days.js';
import { addCalendarDays } from '../lib/attendance/client-view.js';
import s from './ClassManagementWorkspace.module.css';

const empty = { sectionKey: '', courseName: '', teacher: '', courseLocation: '', modality: 'in_person',
  scheduleDays: [], startTime: '', endTime: '', status: 'planned', effectiveDate: '' };

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

function editable(section, today) {
  const effectiveDate = section?.baselineDate === today ? addCalendarDays(today, 1) : today;
  return section ? { sectionKey: section.sectionKey, courseName: section.courseName,
    teacher: section.teacher, courseLocation: section.courseLocation, modality: section.modality,
    scheduleDays: section.scheduleDays, startTime: section.startTime, endTime: section.endTime,
    status: section.status, effectiveDate } : { ...empty, effectiveDate };
}

export default function ClassManagementWorkspace({ businessUnitId, today, initialState = null, onSaved }) {
  const staticMode = Boolean(initialState);
  const [sections, setSections] = useState(initialState?.sections || []);
  const [canManage, setCanManage] = useState(Boolean(initialState?.capabilities?.canManage));
  const [selectedId, setSelectedId] = useState(initialState?.selectedId || '');
  const [form, setForm] = useState(() => initialState?.form || editable(
    initialState?.sections?.find((section) => section.id === initialState?.selectedId) || null, today));
  const [loading, setLoading] = useState(!staticMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialState?.error || '');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState(initialState?.preview || null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [open, setOpen] = useState(Boolean(initialState?.open));
  const selected = useMemo(() => sections.find((section) => section.id === selectedId) || null, [sections, selectedId]);

  useEffect(() => {
    if (staticMode || !businessUnitId) return undefined;
    const controller = new AbortController();
    requestJson(`/api/active-classes/sections?businessUnitId=${encodeURIComponent(businessUnitId)}`, { signal: controller.signal })
      .then((data) => { setSections(data.sections || []); setCanManage(Boolean(data.capabilities?.canManage)); setError(''); })
      .catch((caught) => { if (caught.name !== 'AbortError') setError(caught.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [businessUnitId, staticMode]);

  const change = (key, value) => { setForm((current) => ({ ...current, [key]: value })); setPreview(null); setNotice(''); };
  const choose = (section) => { setSelectedId(section?.id || ''); setForm(editable(section, today)); setPreview(null); setError(''); setNotice(''); };
  const body = { ...form, businessUnitId, sectionId: selectedId || undefined,
    expectedRevision: selected?.revision || 0 };

  const previewImpact = async () => {
    if (busy || previewBusy || !canManage) return;
    setPreviewBusy(true); setError(''); setPreview(null);
    try {
      if (staticMode) { setPreview(initialState.preview || null); return; }
      setPreview(await requestJson('/api/active-classes/sections/preview', { method: 'POST', body: JSON.stringify(body) }));
    } catch (caught) { setError(caught.message); }
    finally { setPreviewBusy(false); }
  };

  const save = async (event) => {
    event.preventDefault();
    if (!canManage || !preview || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (staticMode) return;
      const result = await requestJson(selectedId
        ? `/api/active-classes/sections/${encodeURIComponent(selectedId)}`
        : '/api/active-classes/sections', {
        method: selectedId ? 'PATCH' : 'POST', body: JSON.stringify(body),
      });
      const data = await requestJson(`/api/active-classes/sections?businessUnitId=${encodeURIComponent(businessUnitId)}`);
      setSections(data.sections || []);
      setSelectedId(result.section.id);
      setForm(editable(result.section, today));
      setPreview(null);
      setNotice(result.audit.outcome === 'unchanged' ? 'No class change was needed.' : `Class change saved for ${result.audit.effectiveDate}.`);
      if (result.audit.outcome === 'saved') onSaved?.();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return <section className={s.shell} aria-label="Class management">
    <button type="button" className={s.toggle} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span><strong>Class catalog & management</strong><small>{canManage ? 'Schedule effective-dated class changes' : 'View your class catalog'}</small></span>
      <span aria-hidden="true">{open ? '−' : '+'}</span>
    </button>
    {open && <div className={s.content}>
      {loading && <p role="status">Loading class catalog…</p>}
      {error && <p className={s.error} role="alert">{error}</p>}
      {notice && <p className={s.notice} role="status">{notice}</p>}
      {!loading && <div className={s.columns}>
        <div className={s.catalog}>
          <h2>Sections</h2>
          {canManage && <button type="button" className="btn btn-sm" onClick={() => choose(null)} disabled={busy}>Add next-semester class</button>}
          {!sections.length && <p>No class sections in this business unit.</p>}
          {sections.map((section) => <button type="button" key={section.id}
            className={selectedId === section.id ? s.selected : s.item}
            onClick={() => choose(section)} disabled={busy} aria-pressed={selectedId === section.id}>
            <strong>{section.courseName} · {section.sectionKey}</strong>
            <span>{section.status} · {section.scheduleDays.join(', ') || 'No days'} · {section.startTime}–{section.endTime}</span>
            <small>{section.rosterCount} active enrollment{section.rosterCount === 1 ? '' : 's'}</small>
            {canManage && section.upcoming?.length > 0 && <small>{section.upcoming.length} scheduled change{section.upcoming.length === 1 ? '' : 's'}</small>}
          </button>)}
        </div>
        {canManage ? <form className={s.form} onSubmit={save}>
          <h2>{selected ? `Change ${selected.sectionKey}` : 'New class section'}</h2>
          <p>Dates and times use New York local time. Existing submitted attendance is never rewritten.</p>
          <div className={s.fields}>
            <label>Section key<input value={form.sectionKey} onChange={(event) => change('sectionKey', event.target.value)} disabled={busy || Boolean(selected)} required /></label>
            <label>Course<input value={form.courseName} onChange={(event) => change('courseName', event.target.value)} disabled={busy} required /></label>
            <label>Teacher<input value={form.teacher} onChange={(event) => change('teacher', event.target.value)} disabled={busy} /></label>
            <label>Location<select value={form.courseLocation} onChange={(event) => change('courseLocation', event.target.value)} disabled={busy} required>
              <option value="">Choose location</option>{schoolLocationOptions().map((location) => <option key={location} value={location}>{location}</option>)}
            </select></label>
            <label>Modality<select value={form.modality} onChange={(event) => change('modality', event.target.value)} disabled={busy}>
              <option value="in_person">In person</option><option value="online">Online</option><option value="hybrid">Hybrid</option>
            </select></label>
            <label>Status<select value={form.status} onChange={(event) => change('status', event.target.value)} disabled={busy}>
              <option value="planned">Planned</option><option value="active">Active</option><option value="inactive">Inactive</option>
            </select></label>
            <label>Start time<input type="time" value={form.startTime} onChange={(event) => change('startTime', event.target.value)} disabled={busy} required /></label>
            <label>End time<input type="time" value={form.endTime} onChange={(event) => change('endTime', event.target.value)} disabled={busy} required /></label>
            <label>Effective date<input type="date" min={selected?.baselineDate === today ? addCalendarDays(today, 1) : today} value={form.effectiveDate} onChange={(event) => change('effectiveDate', event.target.value)} disabled={busy} required /></label>
          </div>
          <fieldset disabled={busy}><legend>Meeting days</legend><div className={s.days}>{CANONICAL_WEEKDAYS.map((day) =>
            <label key={day}><input type="checkbox" checked={form.scheduleDays.includes(day)} onChange={(event) => change('scheduleDays', event.target.checked
              ? [...form.scheduleDays, day] : form.scheduleDays.filter((value) => value !== day))} />{day}</label>)}</div></fieldset>
          {selected?.upcoming?.length > 0 && <div className={s.pending}><strong>Scheduled changes</strong>{selected.upcoming.map((item) =>
            <p key={item.revision}>{item.effectiveDate}: {item.status} · {item.teacher || 'Teacher not set'} · {item.courseLocation}</p>)}</div>}
          <div className={s.actions}>
            <button type="button" className="btn" onClick={previewImpact} disabled={busy || previewBusy || !form.effectiveDate}>
              {previewBusy ? 'Checking impact…' : 'Preview impact'}</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !preview || preview.willBlockDeactivation}>
              {busy ? 'Saving…' : 'Save class change'}</button>
          </div>
          {preview && <div className={s.preview} role="status">
            <strong>Effective {preview.effectiveDate}</strong>
            <p>{preview.activeEnrollmentsSpanningDate} active enrollment{preview.activeEnrollmentsSpanningDate === 1 ? '' : 's'} span this date.</p>
            <p>{preview.upcomingDates.length ? `Upcoming meetings: ${preview.upcomingDates.join(', ')}` : 'No meetings in the next 14 days under this schedule.'}</p>
            {preview.willBlockDeactivation && <p className={s.error}>End or transition spanning enrollments before deactivation.</p>}
          </div>}
        </form> : <div className={s.readonly} role="note">Class changes are available to senior coordinators and administrators. Enrollment remains available from the Contact record.</div>}
      </div>}
    </div>}
  </section>;
}
