'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenCheck, ChevronLeft, Plus, Search } from 'lucide-react';
import Modal from './Modal.js';
import { schoolLocationOptions } from '../lib/school-locations.js';
import { CANONICAL_WEEKDAYS } from '../lib/schedule-days.js';
import { addCalendarDays } from '../lib/attendance/client-view.js';
import { normalizeScheduleSlots, scheduleSlotsForSection, scheduleSummary } from '../lib/crm/class-schedule.js';
import s from './ClassManagementWorkspace.module.css';

const empty = { sectionKey: '', courseName: '', teacher: '', courseLocation: '', modality: 'in_person',
  scheduleSlots: [{ days: [], startTime: '', endTime: '' }], status: 'planned', effectiveDate: '' };
const statusLabels = { planned: 'Planned', active: 'Active', inactive: 'Inactive' };
const steps = ['Class details', 'Class schedule', 'Timing & status', 'Review'];

async function requestJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

function editable(section, today) {
  const lastEffectiveDate = section?.lastEffectiveDate || section?.baselineDate;
  const effectiveDate = lastEffectiveDate >= today ? addCalendarDays(lastEffectiveDate, 1) : today;
  const importedDays = section?.scheduleDays?.some((day) => !CANONICAL_WEEKDAYS.includes(day));
  const knownSlots = section && !importedDays ? scheduleSlotsForSection(section) : [];
  return section ? { sectionKey: section.sectionKey, courseName: section.courseName,
    teacher: section.teacher, courseLocation: section.courseLocation, modality: section.modality,
    scheduleSlots: knownSlots.length ? knownSlots.map((slot) => ({ ...slot, days: [...slot.days] }))
      : [{ days: [], startTime: section.startTime || '', endTime: section.endTime || '' }],
    status: section.status, effectiveDate } : { ...empty, effectiveDate };
}

function scheduleLine(section) {
  return scheduleSummary(section);
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
  const [step, setStep] = useState(initialState?.step || 0);
  const [query, setQuery] = useState(initialState?.query || '');
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
  }, [open, view, step]);

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
    setStep(0);
    setView('edit');
  };
  const updateSlot = (index, patch) => {
    setForm((current) => ({ ...current, scheduleSlots: current.scheduleSlots.map((slot, slotIndex) =>
      slotIndex === index ? { ...slot, ...patch } : slot) }));
    setPreview(null);
    setError('');
  };
  const body = { ...form, businessUnitId, sectionId: selectedId || undefined,
    expectedRevision: selected?.revision || 0 };

  const continueStep = async (event) => {
    event.preventDefault();
    if (busy || previewBusy || !canManage) return;
    if (step === 0) {
      if (!form.courseName.trim() || !form.courseLocation || (!selectedId && !form.sectionKey.trim())) {
        setError('Complete the required class details before continuing.'); return;
      }
      setError(''); setStep(1); return;
    }
    if (step === 1) {
      try { normalizeScheduleSlots(form.scheduleSlots); }
      catch (caught) { setError(caught.message); return; }
      setError(''); setStep(2); return;
    }
    if (!form.effectiveDate) { setError('Choose when this class change takes effect.'); return; }
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
      setNotice(result.audit.outcome === 'unchanged' ? 'No class change was needed.'
        : selectedId ? `Class change saved for ${result.audit.effectiveDate}.`
          : `Class created for ${result.audit.effectiveDate}.`);
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
    <button type="button" className="btn" onClick={() => { setError(''); if (step === 0) setView('browse'); else setStep(step - 1); }} disabled={previewBusy}>
      {step === 0 ? 'Back to classes' : 'Back'}
    </button>
    <button type="submit" form="class-management-form" className="btn btn-primary" disabled={previewBusy}>
      {previewBusy ? 'Checking impact…' : step === 0 ? 'Next: Class schedule' : step === 1 ? 'Next: Timing & status' : 'Review change'}
    </button>
  </> : <>
    <button type="button" className="btn" onClick={() => { setPreview(null); setError(''); setStep(2); setView('edit'); }} disabled={busy}>Back to timing</button>
    <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !preview || preview.willBlockDeactivation}>
      {busy ? 'Saving…' : selectedId ? 'Save class change' : 'Create class'}
    </button>
  </>;

  return <>
    <button type="button" className={s.trigger} onClick={() => { if (view === 'browse') setQuery(''); setOpen(true); }} aria-haspopup="dialog">
      <BookOpenCheck size={16} aria-hidden="true" />
      {loading ? 'Classes' : canManage ? 'Manage classes' : 'View classes'}
    </button>
    <Modal open={open} onClose={close} title={view === 'browse' ? 'Classes & schedules'
      : view === 'edit' ? selected ? `Edit ${selected.courseName}` : 'Add a class'
        : selected ? 'Review class change' : 'Review new class'} variant="dialog" panelClassName={s.dialog} footer={footer}>
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
          <p>{selected ? `Updates start on the effective date. Internal class code: ${selected.sectionKey}.` : 'Set up one class with the days and times it meets.'}</p>
          <div className={s.stepProgress} aria-label={`Step ${step + 1} of 4: ${steps[step]}`}>
            {steps.map((label, index) => <span key={label} className={index === step ? s.currentStep : index < step ? s.completedStep : ''}>
              <span>{index + 1}</span><span>{label}</span>
            </span>)}
          </div>
        </div>
        {error && <p className={s.error} role="alert">{error}</p>}
        <form id="class-management-form" className={s.form} onSubmit={continueStep}>
          {step === 0 && <section className={s.group} aria-labelledby="class-details-heading">
            <div className={s.groupHeading}><h3 id="class-details-heading">Class details</h3><p>What students and staff will recognize.</p></div>
            <div className={s.fields}>
              <label>Course name<input value={form.courseName} onChange={(event) => change('courseName', event.target.value)} disabled={previewBusy} required /></label>
              <label>Teacher<input value={form.teacher} onChange={(event) => change('teacher', event.target.value)} disabled={previewBusy} /></label>
              <label>Location<select value={form.courseLocation} onChange={(event) => change('courseLocation', event.target.value)} disabled={previewBusy} required>
                <option value="">Choose location</option>{schoolLocationOptions().map((location) => <option key={location} value={location}>{location}</option>)}</select></label>
              <label>How it meets<select value={form.modality} onChange={(event) => change('modality', event.target.value)} disabled={previewBusy}>
                <option value="in_person">In person</option><option value="online">Online</option><option value="hybrid">Hybrid</option></select></label>
              {!selected && <label className={s.fullField}>Internal class code<input value={form.sectionKey} onChange={(event) => change('sectionKey', event.target.value)} disabled={previewBusy} required /><small>Used internally to distinguish class sections.</small></label>}
            </div>
          </section>}
          {step === 1 && <section className={s.group} aria-labelledby="class-schedule-heading">
            <div className={s.groupHeading}><h3 id="class-schedule-heading">Class schedule</h3><p>Group days that share a time. Times are in New York local time.</p></div>
            {importedDays.length > 0 && <p className={s.legacyNotice}>Imported schedule text: {importedDays.join(', ')}. Confirm the correct days and times before saving.</p>}
            <div className={s.slotList}>{form.scheduleSlots.map((slot, index) => <div key={index} className={s.slotGroup}>
              <div className={s.slotHeading}><strong>Time group {index + 1}</strong>{form.scheduleSlots.length > 1 &&
                <button type="button" className={s.removeSlot} onClick={() => change('scheduleSlots', form.scheduleSlots.filter((_, slotIndex) => slotIndex !== index))}>Remove</button>}</div>
              <fieldset className={s.days} disabled={previewBusy}><legend>Class days</legend><div>{CANONICAL_WEEKDAYS.map((day) => {
                const takenElsewhere = form.scheduleSlots.some((other, slotIndex) => slotIndex !== index && other.days.includes(day));
                return <label key={day}><input type="checkbox" checked={slot.days.includes(day)} disabled={takenElsewhere}
                  onChange={(event) => updateSlot(index, { days: event.target.checked
                    ? [...slot.days, day] : slot.days.filter((value) => value !== day) })} /><span>{day.slice(0, 3)}</span></label>;
              })}</div></fieldset>
              <div className={s.fields}>
                <label>Starts at<input type="time" value={slot.startTime} onChange={(event) => updateSlot(index, { startTime: event.target.value })} disabled={previewBusy} required /></label>
                <label>Ends at<input type="time" value={slot.endTime} onChange={(event) => updateSlot(index, { endTime: event.target.value })} disabled={previewBusy} required /></label>
              </div>
            </div>)}</div>
            {form.scheduleSlots.length < 7 && new Set(form.scheduleSlots.flatMap((slot) => slot.days)).size < 7 &&
              <button type="button" className={s.addSlot} onClick={() =>
              change('scheduleSlots', [...form.scheduleSlots, { days: [], startTime: '', endTime: '' }])}>+ Add another time group</button>}
          </section>}
          {step === 2 && <section className={s.group} aria-labelledby="effective-date-heading">
            <div className={s.groupHeading}><h3 id="effective-date-heading">Timing &amp; status</h3><p>Choose when this change takes effect. Existing submitted attendance will not change.</p></div>
            <div className={s.fields}>
              <label>Class status<select value={form.status} onChange={(event) => change('status', event.target.value)} disabled={previewBusy}>
                <option value="planned">Planned</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
              <label>Effective date<input type="date" min={(selected?.lastEffectiveDate || selected?.baselineDate) >= today
                ? addCalendarDays(selected.lastEffectiveDate || selected.baselineDate, 1) : today} value={form.effectiveDate}
                onChange={(event) => change('effectiveDate', event.target.value)} disabled={previewBusy} required /></label>
            </div>
            {selected?.upcoming?.length > 0 && <div className={s.pending}><strong>Already scheduled</strong>{selected.upcoming.map((item) =>
              <p key={item.revision}>{item.effectiveDate}: {statusLabels[item.status] || item.status} · {scheduleLine(item)} · {item.teacher || 'Teacher not set'} · {item.courseLocation}</p>)}</div>}
          </section>}
        </form>
      </div>}

      {view === 'review' && preview && <div className={s.review}>
        <h2 ref={stepHeadingRef} tabIndex="-1">{form.courseName}</h2>
        <div className={s.stepProgress} aria-label="Step 4 of 4: Review">{steps.map((label, index) =>
          <span key={label} className={index === 3 ? s.currentStep : s.completedStep}><span>{index + 1}</span><span>{label}</span></span>)}</div>
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
