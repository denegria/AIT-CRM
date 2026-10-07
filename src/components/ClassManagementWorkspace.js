'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenCheck, ChevronLeft, Plus, Search } from 'lucide-react';
import Modal from './Modal.js';
import { schoolLocationOptions } from '../lib/school-locations.js';
import { CANONICAL_WEEKDAYS } from '../lib/schedule-days.js';
import { addCalendarDays, formatScheduleDays, formatTimeRange } from '../lib/attendance/client-view.js';
import s from './ClassManagementWorkspace.module.css';

const empty = { sectionKey: '', courseName: '', teacher: '', courseLocation: '', modality: 'in_person',
  scheduleDays: [], startTime: '', endTime: '', status: 'planned', effectiveDate: '' };
const statusLabels = { planned: 'Planned', active: 'Active', inactive: 'Inactive' };

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

function editable(section, today) {
  const lastEffectiveDate = section?.lastEffectiveDate || section?.baselineDate;
  const effectiveDate = lastEffectiveDate >= today ? addCalendarDays(lastEffectiveDate, 1) : today;
  return section ? { sectionKey: section.sectionKey, courseName: section.courseName,
    teacher: section.teacher, courseLocation: section.courseLocation, modality: section.modality,
    scheduleDays: section.scheduleDays.filter((day) => CANONICAL_WEEKDAYS.includes(day)),
    startTime: section.startTime, endTime: section.endTime,
    status: section.status, effectiveDate } : { ...empty, effectiveDate };
}

function scheduleLine(section) {
  const days = !section.scheduleDays?.length ? 'Days not set'
    : section.scheduleDays.some((day) => !CANONICAL_WEEKDAYS.includes(day))
      ? 'Schedule needs review' : formatScheduleDays(section.scheduleDays);
  const time = section.startTime && section.endTime
    ? formatTimeRange(section.startTime, section.endTime) : 'Time not set';
  return `${days} · ${time}`;
}

function identityKey(section) {
  return [section.courseName, section.teacher, section.courseLocation, section.status,
    scheduleLine(section), section.rosterCount].join('|').toLocaleLowerCase();
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
  const [view, setView] = useState(initialState?.view || 'browse');
  const [query, setQuery] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const stepHeadingRef = useRef(null);
  const searchRef = useRef(null);
  const selected = useMemo(() => sections.find((section) => section.id === selectedId) || null, [sections, selectedId]);
  const matches = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return sections;
    return sections.filter((section) => [section.courseName, section.sectionKey, section.teacher,
      section.courseLocation, ...(section.scheduleDays || [])].join(' ').toLocaleLowerCase().includes(term));
  }, [query, sections]);
  const duplicateCounts = useMemo(() => sections.reduce((counts, section) => {
    const key = identityKey(section);
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map()), [sections]);
  const importedDays = selected?.scheduleDays?.filter((day) => !CANONICAL_WEEKDAYS.includes(day)) || [];

  useEffect(() => {
    if (staticMode || !businessUnitId) return undefined;
    const controller = new AbortController();
    requestJson(`/api/active-classes/sections?businessUnitId=${encodeURIComponent(businessUnitId)}`, { signal: controller.signal })
      .then((data) => { setSections(data.sections || []); setCanManage(Boolean(data.capabilities?.canManage)); setError(''); })
      .catch((caught) => { if (caught.name !== 'AbortError') setError(caught.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [businessUnitId, reloadKey, staticMode]);

  useEffect(() => {
    if (!open) return;
    if (view === 'browse') searchRef.current?.focus();
    else stepHeadingRef.current?.focus();
  }, [open, view]);

  const close = () => {
    if (busy || previewBusy) return;
    if (view === 'review') { setPreview(null); setView('edit'); }
    setOpen(false);
  };
  const change = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setPreview(null);
    setError('');
  };
  const choose = (section) => {
    setSelectedId(section?.id || '');
    setForm(editable(section, today));
    setPreview(null);
    setError('');
    setNotice('');
    setView('edit');
  };
  const body = { ...form, businessUnitId, sectionId: selectedId || undefined,
    expectedRevision: selected?.revision || 0 };

  const previewImpact = async (event) => {
    event.preventDefault();
    if (busy || previewBusy || !canManage) return;
    if (!form.scheduleDays.length) { setError('Choose at least one meeting day.'); return; }
    setPreviewBusy(true); setError(''); setPreview(null);
    try {
      const result = staticMode ? initialState.preview : await requestJson('/api/active-classes/sections/preview', {
        method: 'POST', body: JSON.stringify(body),
      });
      if (result) { setPreview(result); setView('review'); }
    } catch (caught) { setError(caught.message); }
    finally { setPreviewBusy(false); }
  };

  const save = async () => {
    if (!canManage || !preview || preview.willBlockDeactivation || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (staticMode) return;
      const result = await requestJson(selectedId
        ? `/api/active-classes/sections/${encodeURIComponent(selectedId)}`
        : '/api/active-classes/sections', {
        method: selectedId ? 'PATCH' : 'POST', body: JSON.stringify(body),
      });
      setSelectedId('');
      setPreview(null);
      setQuery('');
      setView('browse');
      setNotice(result.audit.outcome === 'unchanged' ? 'No class change was needed.' : `Class change saved for ${result.audit.effectiveDate}.`);
      if (result.audit.outcome === 'saved') onSaved?.();
      try {
        const data = await requestJson(`/api/active-classes/sections?businessUnitId=${encodeURIComponent(businessUnitId)}`);
        setSections(data.sections || []);
      } catch {
        setError('The change was saved, but the class list could not refresh. Try again.');
      }
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  const footer = view === 'browse' ? <>
    <button type="button" className="btn" onClick={close}>Close</button>
    {canManage && <button type="button" className="btn btn-primary" onClick={() => choose(null)} disabled={loading}>
      <Plus size={16} aria-hidden="true" /> Add class
    </button>}
  </> : view === 'edit' ? <>
    <button type="button" className="btn" onClick={() => { setError(''); setView('browse'); }} disabled={previewBusy}>Back to classes</button>
    <button type="submit" form="class-management-form" className="btn btn-primary" disabled={previewBusy}>
      {previewBusy ? 'Checking impact…' : 'Review change'}
    </button>
  </> : <>
    <button type="button" className="btn" onClick={() => { setPreview(null); setError(''); setView('edit'); }} disabled={busy}>Back to edit</button>
    <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !preview || preview.willBlockDeactivation}>
      {busy ? 'Saving…' : 'Save class change'}
    </button>
  </>;

  return <>
    <button type="button" className={s.trigger} onClick={() => setOpen(true)} aria-haspopup="dialog">
      <BookOpenCheck size={16} aria-hidden="true" />
      {loading ? 'Classes' : canManage ? 'Manage classes' : 'View classes'}
    </button>
    <Modal open={open} onClose={close} title={view === 'browse' ? 'Classes & schedules'
      : view === 'edit' ? selected ? `Edit ${selected.courseName}` : 'Add a class'
        : 'Review class change'} variant="dialog" panelClassName={s.dialog} footer={footer}>
      {view === 'browse' && <div className={s.browse}>
        <div className={s.intro}>
          <p>{canManage ? 'Find a class by course, teacher, location or day. Choose one to change its details and schedule.'
            : 'Find a class by course, teacher, location or day.'}</p>
          {!canManage && !loading && <p className={s.readonly}>Class changes are available to senior coordinators and administrators.</p>}
        </div>
        {notice && <p className={s.notice} role="status">{notice}</p>}
        {error && <div className={s.error} role="alert">{error}
          {!staticMode && <button type="button" className="btn btn-sm" onClick={() => { setLoading(true); setReloadKey((value) => value + 1); }}>Try again</button>}
        </div>}
        <label className={s.search}><Search size={17} aria-hidden="true" />
          <span className={s.srOnly}>Search classes</span>
          <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search classes" disabled={loading} />
        </label>
        <div className={s.listHeading}><strong>{query ? 'Matching classes' : 'All classes'}</strong><span>{matches.length} {matches.length === 1 ? 'class' : 'classes'}</span></div>
        {loading ? <p role="status" className={s.emptyState}>Loading class catalog…</p>
          : !matches.length ? <p className={s.emptyState}>{query ? 'No classes match your search.' : 'No classes in this business unit yet.'}</p>
            : <div className={s.list}>{matches.map((section) => {
              const content = <>
                <span className={s.classMain}><strong>{section.courseName}</strong><span className={s.status}>{statusLabels[section.status] || section.status}</span></span>
                <span className={s.classSchedule}>{scheduleLine(section)}</span>
                <span className={s.classMeta}>{section.courseLocation || 'Location not set'}{section.teacher ? ` · ${section.teacher}` : ''} · {section.rosterCount} active {section.rosterCount === 1 ? 'student' : 'students'}</span>
                {duplicateCounts.get(identityKey(section)) > 1 && <span className={s.classRef}>To distinguish this class: {section.sectionKey}</span>}
                {canManage && section.upcoming?.length > 0 && <span className={s.scheduled}>{section.upcoming.length} scheduled {section.upcoming.length === 1 ? 'change' : 'changes'}</span>}
              </>;
              return canManage ? <button type="button" key={section.id} className={s.classItem} onClick={() => choose(section)}>{content}<span className={s.editCue}>Edit</span></button>
                : <div key={section.id} className={s.classItemReadonly}>{content}</div>;
            })}</div>}
      </div>}

      {view === 'edit' && canManage && <div className={s.edit}>
        <div className={s.stepIntro}>
          <button type="button" className={s.backLink} onClick={() => { setError(''); setView('browse'); }}><ChevronLeft size={16} aria-hidden="true" /> All classes</button>
          <h2 ref={stepHeadingRef} tabIndex="-1">{selected ? selected.courseName : 'New class'}</h2>
          <p>{selected ? `Updates start on the effective date. Internal class code: ${selected.sectionKey}.` : 'Set up the class, then review its schedule before saving.'}</p>
        </div>
        {error && <p className={s.error} role="alert">{error}</p>}
        <form id="class-management-form" className={s.form} onSubmit={previewImpact}>
          <section className={s.group} aria-labelledby="class-details-heading">
            <div className={s.groupHeading}><span className={s.groupNumber}>1</span><div><h3 id="class-details-heading">Class details</h3><p>What students and staff will recognize.</p></div></div>
            <div className={s.fields}>
              <label>Course name<input value={form.courseName} onChange={(event) => change('courseName', event.target.value)} disabled={previewBusy} required /></label>
              <label>Teacher<input value={form.teacher} onChange={(event) => change('teacher', event.target.value)} disabled={previewBusy} /></label>
              <label>Location<select value={form.courseLocation} onChange={(event) => change('courseLocation', event.target.value)} disabled={previewBusy} required>
                <option value="">Choose location</option>{schoolLocationOptions().map((location) => <option key={location} value={location}>{location}</option>)}</select></label>
              <label>How it meets<select value={form.modality} onChange={(event) => change('modality', event.target.value)} disabled={previewBusy}>
                <option value="in_person">In person</option><option value="online">Online</option><option value="hybrid">Hybrid</option></select></label>
              {!selected && <label className={s.fullField}>Internal class code<input value={form.sectionKey} onChange={(event) => change('sectionKey', event.target.value)} disabled={previewBusy} required /><small>Used internally to distinguish class sections.</small></label>}
            </div>
          </section>
          <section className={s.group} aria-labelledby="meeting-schedule-heading">
            <div className={s.groupHeading}><span className={s.groupNumber}>2</span><div><h3 id="meeting-schedule-heading">Meeting schedule</h3><p>Times are in New York local time.</p></div></div>
            {importedDays.length > 0 && <p className={s.legacyNotice}>Imported schedule text: {importedDays.join(', ')}. Choose the correct meeting days below before saving.</p>}
            <fieldset className={s.days} disabled={previewBusy}><legend>Meeting days</legend><div>{CANONICAL_WEEKDAYS.map((day) =>
              <label key={day}><input type="checkbox" checked={form.scheduleDays.includes(day)} onChange={(event) => change('scheduleDays', event.target.checked
                ? [...form.scheduleDays, day] : form.scheduleDays.filter((value) => value !== day))} /><span>{day.slice(0, 3)}</span></label>)}</div></fieldset>
            <div className={s.fields}>
              <label>Starts at<input type="time" value={form.startTime} onChange={(event) => change('startTime', event.target.value)} disabled={previewBusy} required /></label>
              <label>Ends at<input type="time" value={form.endTime} onChange={(event) => change('endTime', event.target.value)} disabled={previewBusy} required /></label>
            </div>
          </section>
          <section className={s.group} aria-labelledby="effective-date-heading">
            <div className={s.groupHeading}><span className={s.groupNumber}>3</span><div><h3 id="effective-date-heading">When this takes effect</h3><p>Existing submitted attendance will not change.</p></div></div>
            <div className={s.fields}>
              <label>Class status<select value={form.status} onChange={(event) => change('status', event.target.value)} disabled={previewBusy}>
                <option value="planned">Planned</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
              <label>Effective date<input type="date" min={(selected?.lastEffectiveDate || selected?.baselineDate) >= today
                ? addCalendarDays(selected.lastEffectiveDate || selected.baselineDate, 1) : today} value={form.effectiveDate}
                onChange={(event) => change('effectiveDate', event.target.value)} disabled={previewBusy} required /></label>
            </div>
            {selected?.upcoming?.length > 0 && <div className={s.pending}><strong>Already scheduled</strong>{selected.upcoming.map((item) =>
              <p key={item.revision}>{item.effectiveDate}: {statusLabels[item.status] || item.status} · {item.teacher || 'Teacher not set'} · {item.courseLocation}</p>)}</div>}
          </section>
        </form>
      </div>}

      {view === 'review' && preview && <div className={s.review}>
        <h2 ref={stepHeadingRef} tabIndex="-1">{form.courseName}</h2>
        <p>Check the change and its impact before saving. Existing submitted attendance is never rewritten.</p>
        {error && <p className={s.error} role="alert">{error}</p>}
        <div className={s.reviewSummary}>
          <div><span>Schedule</span><strong>{scheduleLine(form)}</strong></div>
          <div><span>Location & teacher</span><strong>{form.courseLocation}{form.teacher ? ` · ${form.teacher}` : ''}</strong></div>
          <div><span>Status</span><strong>{statusLabels[form.status]}</strong></div>
          <div><span>Effective date</span><strong>{preview.effectiveDate}</strong></div>
        </div>
        <div className={s.impact} role="status"><h3>Impact check</h3>
          <p>{preview.activeEnrollmentsSpanningDate} active {preview.activeEnrollmentsSpanningDate === 1 ? 'enrollment spans' : 'enrollments span'} this date.</p>
          <p>{preview.upcomingDates.length ? `Upcoming meetings: ${preview.upcomingDates.join(', ')}` : 'No meetings in the next 14 days under this schedule.'}</p>
        </div>
        {preview.willBlockDeactivation && <p className={s.error} role="alert">This class cannot be deactivated yet. End or transition the enrollments spanning the effective date.</p>}
      </div>}
    </Modal>
  </>;
}
