'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LoaderCircle,
  MapPin,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Save,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import {
  addCalendarDays,
  attendanceCounts,
  attendanceStateLabel,
  classRailHeading,
  classTitle,
  formatClassLocation,
  formatEnrollmentDate,
  formatLongDate,
  formatScheduleDays,
  formatSessionDate,
  formatTimeRange,
  initials,
  marksFromRoster,
  selectedSession,
  serializeMarks,
  todayInNewYork,
} from '../lib/attendance/client-view.js';

const TABS = ['overview', 'roster', 'attendance'];

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Request failed with status ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function statusTone(status) {
  if (status === 'submitted') return 'success';
  if (status === 'in_progress') return 'warning';
  return 'muted';
}

function markSummary(status) {
  if (status === 'present') return 'Present';
  if (status === 'absent') return 'Absent';
  return 'Unmarked';
}

export default function ActiveClassesWorkspace({ styles: s, initialState = null }) {
  const staticMode = Boolean(initialState);
  const today = useMemo(() => initialState?.today || todayInNewYork(), [initialState]);
  const [date, setDate] = useState(initialState?.date || today);
  const [classes, setClasses] = useState(initialState?.classes || []);
  const [selectedClassId, setSelectedClassId] = useState(initialState?.selectedClassId || initialState?.classes?.[0]?.id || '');
  const [workspace, setWorkspace] = useState(initialState?.workspace || null);
  const [activeTab, setActiveTab] = useState(initialState?.activeTab || 'overview');
  const [locationFilter, setLocationFilter] = useState('all');
  const [classLoading, setClassLoading] = useState(!staticMode);
  const [workspaceLoading, setWorkspaceLoading] = useState(!staticMode);
  const [classError, setClassError] = useState('');
  const [workspaceError, setWorkspaceError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [draftMarks, setDraftMarks] = useState(() => marksFromRoster(initialState?.workspace?.roster || []));
  const [noteDraft, setNoteDraft] = useState(initialState?.noteDraft ?? selectedSession(initialState?.workspace)?.note ?? '');
  const [saveState, setSaveState] = useState(initialState?.saveState || 'idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [mutationError, setMutationError] = useState('');
  const [mutationKind, setMutationKind] = useState('');
  const [editingNoteId, setEditingNoteId] = useState('');
  const [markNoteDraft, setMarkNoteDraft] = useState('');
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const revisionRef = useRef(selectedSession(initialState?.workspace)?.revision || 0);
  const selectedClassIdRef = useRef(selectedClassId);

  const busy = Boolean(mutationKind);

  useEffect(() => {
    selectedClassIdRef.current = selectedClassId;
  }, [selectedClassId]);

  useEffect(() => {
    if (staticMode) return undefined;
    const controller = new AbortController();
    requestJson(`/api/attendance/classes?date=${encodeURIComponent(date)}`, { signal: controller.signal })
      .then((result) => {
        const nextClasses = result.classes || [];
        const currentId = selectedClassIdRef.current;
        const nextId = nextClasses.some((item) => item.id === currentId) ? currentId : nextClasses[0]?.id || '';
        setClasses(nextClasses);
        setClassError('');
        if (nextId !== currentId) setSelectedClassId(nextId);
        if (!nextId) {
          setWorkspace(null);
          setWorkspaceLoading(false);
        }
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setClassError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setClassLoading(false);
      });
    return () => controller.abort();
  }, [date, reloadKey, staticMode]);

  useEffect(() => {
    if (staticMode) return undefined;
    if (!selectedClassId) return undefined;
    const controller = new AbortController();
    requestJson(`/api/attendance/classes/${encodeURIComponent(selectedClassId)}?weekOf=${encodeURIComponent(date)}&date=${encodeURIComponent(date)}`, {
      signal: controller.signal,
    })
      .then((result) => {
        setWorkspace(result);
        const session = selectedSession(result);
        revisionRef.current = session?.revision || 0;
        setDraftMarks(marksFromRoster(result.roster || []));
        setNoteDraft(session?.note || '');
        setSaveState('idle');
        setSaveMessage('');
        setMutationError('');
        setEditingNoteId('');
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setWorkspaceError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setWorkspaceLoading(false);
      });
    return () => controller.abort();
  }, [date, reloadKey, selectedClassId, staticMode]);

  const locationOptions = useMemo(() => (
    [...new Set(classes.map((item) => formatClassLocation(item)))].sort()
  ), [classes]);

  const visibleClasses = useMemo(() => (
    locationFilter === 'all' ? classes : classes.filter((item) => formatClassLocation(item) === locationFilter)
  ), [classes, locationFilter]);

  const selectedClass = classes.find((item) => item.id === selectedClassId) || null;
  const session = selectedSession(workspace);
  const counts = attendanceCounts(workspace?.roster || [], draftMarks);
  const canReopen = Boolean(workspace?.capabilities?.canReopenSubmittedAttendance);
  const isSubmitted = session?.status === 'submitted';
  const noteChanged = noteDraft.trim() !== String(session?.note || '').trim();

  const updateSession = (nextSession) => {
    revisionRef.current = nextSession.revision;
    setWorkspace((current) => current ? {
      ...current,
      sessions: current.sessions.map((item) => item.date === nextSession.date ? { ...item, ...nextSession } : item),
    } : current);
    if (nextSession.date === date) {
      setClasses((current) => current.map((item) => (
        item.id === selectedClassId
          ? { ...item, attendanceState: nextSession.attendanceState }
          : item
      )));
    }
  };

  const runMutation = async (kind, work, successMessage) => {
    if (busy || staticMode) return null;
    setMutationKind(kind);
    setMutationError('');
    setSaveState('saving');
    try {
      const result = await work();
      setSaveState('saved');
      setSaveMessage(successMessage);
      return result;
    } catch (error) {
      setSaveState('error');
      setMutationError(error.message);
      return null;
    } finally {
      setMutationKind('');
    }
  };

  const persistMarks = async (nextMarks, successMessage = 'Attendance saved') => {
    if (!workspace || !session || isSubmitted) return;
    const previousMarks = draftMarks;
    setDraftMarks(nextMarks);
    const result = await runMutation('attendance', () => requestJson(
      `/api/attendance/classes/${encodeURIComponent(workspace.class.id)}/sessions/${encodeURIComponent(workspace.selectedDate)}/attendance`,
      {
        method: 'PUT',
        body: JSON.stringify({
          expectedRevision: revisionRef.current,
          marks: serializeMarks(workspace.roster, nextMarks),
        }),
      },
    ), successMessage);
    if (result?.session) updateSession(result.session);
    else setDraftMarks(previousMarks);
  };

  const handleMark = (enrollmentId, status) => {
    const nextMarks = {
      ...draftMarks,
      [enrollmentId]: { ...draftMarks[enrollmentId], status },
    };
    persistMarks(nextMarks, status ? `${markSummary(status)} saved` : 'Student returned to unmarked');
  };

  const handleMarkAllPresent = () => {
    const nextMarks = Object.fromEntries((workspace?.roster || []).map((student) => [student.enrollmentId, {
      status: 'present',
      note: draftMarks[student.enrollmentId]?.note || '',
    }]));
    persistMarks(nextMarks, 'Everyone marked present');
  };

  const handleSaveMarkNote = async () => {
    if (!editingNoteId) return;
    const nextMarks = {
      ...draftMarks,
      [editingNoteId]: { ...draftMarks[editingNoteId], note: markNoteDraft },
    };
    await persistMarks(nextMarks, 'Student note saved');
    setEditingNoteId('');
    setMarkNoteDraft('');
  };

  const handleSaveSessionNote = async () => {
    if (!workspace || !session || isSubmitted || !noteChanged) return;
    const result = await runMutation('session-note', () => requestJson(
      `/api/attendance/classes/${encodeURIComponent(workspace.class.id)}/sessions/${encodeURIComponent(workspace.selectedDate)}/note`,
      {
        method: 'PATCH',
        body: JSON.stringify({ expectedRevision: revisionRef.current, sessionNote: noteDraft }),
      },
    ), 'Session note saved');
    if (result?.session) updateSession(result.session);
  };

  const handleSubmit = async () => {
    if (!workspace || !session || counts.unmarked > 0 || isSubmitted) return;
    const result = await runMutation('submit', () => requestJson(
      `/api/attendance/classes/${encodeURIComponent(workspace.class.id)}/sessions/${encodeURIComponent(workspace.selectedDate)}/submit`,
      { method: 'POST', body: JSON.stringify({ expectedRevision: revisionRef.current }) },
    ), 'Attendance submitted');
    if (result?.session) updateSession(result.session);
  };

  const handleReopen = async () => {
    if (!workspace || !session || !canReopen || !reopenReason.trim()) return;
    const result = await runMutation('reopen', () => requestJson(
      `/api/attendance/classes/${encodeURIComponent(workspace.class.id)}/sessions/${encodeURIComponent(workspace.selectedDate)}/reopen`,
      {
        method: 'POST',
        body: JSON.stringify({ expectedRevision: revisionRef.current, reason: reopenReason }),
      },
    ), 'Attendance reopened');
    if (result?.session) {
      updateSession(result.session);
      setReopenOpen(false);
      setReopenReason('');
    }
  };

  const chooseDate = (nextDate) => {
    if (busy || !nextDate) return;
    setClassLoading(true);
    setWorkspaceLoading(true);
    setClassError('');
    setWorkspaceError('');
    setDate(nextDate);
  };

  const chooseClass = (sectionId) => {
    if (busy || sectionId === selectedClassId) return;
    if (!sectionId) {
      setSelectedClassId('');
      setWorkspace(null);
      setWorkspaceLoading(false);
      return;
    }
    setWorkspaceLoading(true);
    setWorkspaceError('');
    setSelectedClassId(sectionId);
  };

  const retryLoad = () => {
    setClassLoading(true);
    setWorkspaceLoading(Boolean(selectedClassId));
    setClassError('');
    setWorkspaceError('');
    setReloadKey((value) => value + 1);
  };

  const chooseLocation = (value) => {
    setLocationFilter(value);
    const nextVisible = value === 'all' ? classes : classes.filter((item) => formatClassLocation(item) === value);
    if (!nextVisible.some((item) => item.id === selectedClassId)) chooseClass(nextVisible[0]?.id || '');
  };

  const sessionRows = workspace?.sessions || [];
  const roster = workspace?.roster || [];
  const classInfo = workspace?.class || selectedClass;

  return (
    <section className={s.page} aria-label="Active Classes attendance workspace">
      <header className={s.topBar}>
        <div>
          <p className={s.eyebrow}>AIT USA</p>
          <h1>Active Classes</h1>
        </div>
        <div className={s.dateControls} aria-label="Class date">
          <button type="button" className={s.iconButton} onClick={() => chooseDate(addCalendarDays(date, -1))} disabled={busy} aria-label="Previous day">
            <ChevronLeft size={18} />
          </button>
          <label className={s.datePicker}>
            <CalendarDays size={17} aria-hidden="true" />
            <span>{formatLongDate(date)}</span>
            <input type="date" value={date} onChange={(event) => chooseDate(event.target.value)} aria-label="Choose class date" disabled={busy} />
          </label>
          <button type="button" className={s.iconButton} onClick={() => chooseDate(addCalendarDays(date, 1))} disabled={busy} aria-label="Next day">
            <ChevronRight size={18} />
          </button>
        </div>
        <label className={s.locationSelect}>
          <MapPin size={16} aria-hidden="true" />
          <select value={locationFilter} onChange={(event) => chooseLocation(event.target.value)} aria-label="Filter classes by location">
            <option value="all">All locations</option>
            {locationOptions.map((location) => <option key={location} value={location}>{location}</option>)}
          </select>
        </label>
      </header>

      <div className={s.workspaceGrid}>
        <aside className={s.classRail} aria-label={classRailHeading(date, today)}>
          <div className={s.railHeading}>
            <div>
              <span>{classRailHeading(date, today)}</span>
              {!classLoading && <small>{visibleClasses.length} {visibleClasses.length === 1 ? 'class' : 'classes'}</small>}
            </div>
            {classError && (
              <button type="button" className={s.retryIcon} onClick={retryLoad} aria-label="Retry class list">
                <RefreshCw size={16} />
              </button>
            )}
          </div>
          <div className={s.classList}>
            {classLoading && <div className={s.railState}><LoaderCircle className={s.spin} size={18} /> Loading classes…</div>}
            {!classLoading && classError && <div className={s.railStateError}>{classError}</div>}
            {!classLoading && !classError && visibleClasses.length === 0 && (
              <div className={s.railEmpty}>
                <CalendarDays size={22} />
                <strong>No scheduled classes</strong>
                <span>Try another date or location.</span>
              </div>
            )}
            {visibleClasses.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`${s.classCard} ${item.id === selectedClassId ? s.classCardSelected : ''}`}
                onClick={() => chooseClass(item.id)}
                disabled={busy}
                aria-pressed={item.id === selectedClassId}
              >
                <span className={s.classCardMain}>
                  <strong>{item.courseName}</strong>
                  <span>{formatTimeRange(item.startTime, item.endTime)}</span>
                  <span>{formatClassLocation(item)}{item.teacher ? ` · ${item.teacher}` : ''}</span>
                  <span>{item.studentCount} active {item.studentCount === 1 ? 'student' : 'students'}</span>
                </span>
                <span className={`${s.stateText} ${s[`state_${statusTone(item.attendanceState)}`]}`}>{attendanceStateLabel(item.attendanceState)}</span>
                <ChevronRight size={17} aria-hidden="true" />
              </button>
            ))}
          </div>
        </aside>

        <main className={s.classWorkspace}>
          {workspaceLoading && <div className={s.workspaceState}><LoaderCircle className={s.spin} size={22} /> Loading class workspace…</div>}
          {!workspaceLoading && workspaceError && (
            <div className={s.workspaceStateError} role="alert">
              <AlertCircle size={22} />
              <strong>Class workspace could not load</strong>
              <span>{workspaceError}</span>
              <button type="button" className="btn btn-sm" onClick={retryLoad}>Try again</button>
            </div>
          )}
          {!workspaceLoading && !workspaceError && !classInfo && (
            <div className={s.workspaceState}>
              <CalendarDays size={24} /> Select a date with a scheduled class.
            </div>
          )}
          {!workspaceLoading && !workspaceError && classInfo && workspace && (
            <>
              <header className={s.classHeader}>
                <h2>{classTitle(classInfo)}</h2>
                <div className={s.classMeta}>
                  <span><UserRound size={16} /> {classInfo.teacher || 'Instructor not set'}</span>
                  <span><CalendarDays size={16} /> {formatScheduleDays(classInfo.scheduleDays)}</span>
                  <span><Clock3 size={16} /> {formatTimeRange(classInfo.startTime, classInfo.endTime)}</span>
                  <span><UsersRound size={16} /> {roster.length} active {roster.length === 1 ? 'student' : 'students'}</span>
                </div>
              </header>

              <nav className={s.tabs} aria-label="Class workspace sections">
                {TABS.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={activeTab === tab ? s.tabActive : ''}
                    onClick={() => setActiveTab(tab)}
                    aria-current={activeTab === tab ? 'page' : undefined}
                  >
                    {tab[0].toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </nav>

              {mutationError && (
                <div className={s.mutationError} role="alert">
                  <AlertCircle size={17} />
                  <span>{mutationError}</span>
                  <button type="button" onClick={retryLoad}>Refresh class</button>
                </div>
              )}

              <div className={s.tabBody}>
                {activeTab === 'overview' && (
                  <div className={s.overviewGrid}>
                    <section className={s.panel}>
                      <div className={s.panelHeading}>
                        <div><h3>Sessions</h3><span>This week · oldest to newest</span></div>
                      </div>
                      <div className={s.sessionList}>
                        {sessionRows.length === 0 && <div className={s.inlineEmpty}>No scheduled sessions this week.</div>}
                        {sessionRows.map((item) => {
                          const selected = item.date === workspace.selectedDate;
                          const isFuture = item.date > today;
                          return (
                            <div
                              key={item.date}
                              className={`${s.sessionRow} ${selected ? s.sessionRowSelected : ''}`}
                            >
                              <button type="button" className={s.sessionSelect} onClick={() => chooseDate(item.date)} disabled={busy} aria-pressed={selected}>
                                <span className={`${s.sessionDot} ${item.status === 'submitted' ? s.sessionDotDone : ''}`}>
                                  {item.status === 'submitted' && <Check size={13} />}
                                </span>
                                <span className={s.sessionDate}>
                                  <strong>{formatSessionDate(item.date)}</strong>
                                  <span>{formatTimeRange(item.startTime, item.endTime)}</span>
                                </span>
                                <span className={`${s.sessionState} ${s[`state_${statusTone(item.attendanceState)}`]}`}>
                                  {isFuture && item.attendanceState === 'not_started' ? 'Upcoming' : attendanceStateLabel(item.attendanceState)}
                                </span>
                              </button>
                              {selected && item.status !== 'submitted' && !isFuture && (
                                <button
                                  type="button"
                                  className={s.takeAttendance}
                                  onClick={() => setActiveTab('attendance')}
                                >
                                  Take attendance
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </section>

                    <div className={s.overviewAside}>
                      <section className={s.panel}>
                        <div className={s.panelHeading}>
                          <div><h3>Roster</h3><span>{roster.length} active {roster.length === 1 ? 'student' : 'students'}</span></div>
                          <button type="button" onClick={() => setActiveTab('roster')}>Open roster</button>
                        </div>
                        <div className={s.rosterPreview}>
                          {roster.length === 0 && <div className={s.inlineEmpty}>No active students for this session.</div>}
                          {roster.slice(0, 6).map((student) => (
                            <div className={s.previewStudent} key={student.enrollmentId}>
                              <span className={s.avatar}>{initials(student.name)}</span>
                              {workspace.canLinkContacts && student.contactId
                                ? <Link href={`/contacts/${student.contactId}`}>{student.name}</Link>
                                : <span>{student.name}</span>}
                            </div>
                          ))}
                        </div>
                      </section>

                      <section className={s.panel}>
                        <div className={s.panelHeading}>
                          <div><h3>Session notes</h3><span>{formatSessionDate(workspace.selectedDate)}</span></div>
                          {saveState === 'saving' && mutationKind === 'session-note' && <span className={s.saving}><LoaderCircle className={s.spin} size={14} /> Saving</span>}
                        </div>
                        <textarea
                          className={s.sessionNote}
                          value={noteDraft}
                          onChange={(event) => setNoteDraft(event.target.value)}
                          placeholder="Add a note for this class meeting…"
                          maxLength={4000}
                          disabled={isSubmitted || busy}
                          aria-label={`Session note for ${workspace.selectedDate}`}
                        />
                        <div className={s.noteFooter}>
                          <span>{isSubmitted ? 'Reopen attendance to edit this note.' : 'This note belongs only to the selected session.'}</span>
                          <button type="button" className="btn btn-sm" onClick={handleSaveSessionNote} disabled={!noteChanged || busy || isSubmitted}>
                            <Save size={14} /> Save note
                          </button>
                        </div>
                      </section>
                    </div>
                  </div>
                )}

                {activeTab === 'roster' && (
                  <section className={s.panel}>
                    <div className={s.panelHeading}>
                      <div><h3>Active roster</h3><span>{roster.length} enrolled {roster.length === 1 ? 'student' : 'students'}</span></div>
                    </div>
                    <div className={s.rosterTable} role="table" aria-label="Active class roster">
                      <div className={s.rosterHeader} role="row">
                        <span role="columnheader">Student</span>
                        <span role="columnheader">Enrollment started</span>
                        <span role="columnheader">Enrollment state</span>
                        {workspace.canLinkContacts && <span role="columnheader">Contact</span>}
                      </div>
                      {roster.length === 0 && <div className={s.inlineEmpty}>No active students for this session.</div>}
                      {roster.map((student) => (
                        <div className={s.rosterRow} role="row" key={student.enrollmentId}>
                          <div className={s.studentCell} role="cell">
                            <span className={s.avatar}>{initials(student.name)}</span>
                            {workspace.canLinkContacts && student.contactId
                              ? <Link href={`/contacts/${student.contactId}`}>{student.name}</Link>
                              : <span>{student.name}</span>}
                          </div>
                          <span role="cell" data-label="Enrollment started">{formatEnrollmentDate(student.startDate)}</span>
                          <span role="cell" data-label="Enrollment state" className={s.enrollmentState}>Active enrollment</span>
                          {workspace.canLinkContacts && (
                            <span role="cell" data-label="Contact">
                              {student.contactId ? <Link className={s.contactLink} href={`/contacts/${student.contactId}`}>View contact <ChevronRight size={15} /></Link> : 'Unavailable'}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className={s.rosterFootnote}>Enrollment changes are managed from the student’s Contact record.</p>
                  </section>
                )}

                {activeTab === 'attendance' && (
                  <section className={s.attendancePanel}>
                    <header className={s.attendanceToolbar}>
                      <div>
                        <h3>{formatSessionDate(workspace.selectedDate)} attendance</h3>
                        <span>{formatTimeRange(session?.startTime, session?.endTime)}</span>
                      </div>
                      <div className={s.attendanceToolbarActions}>
                        <span>{counts.present + counts.absent} of {roster.length} marked</span>
                        {!isSubmitted && (
                          <button type="button" className="btn btn-sm" onClick={handleMarkAllPresent} disabled={busy || roster.length === 0}>Mark all present</button>
                        )}
                        <span className={`${s.saveStatus} ${saveState === 'error' ? s.saveStatusError : ''}`} aria-live="polite">
                          {saveState === 'saving' ? <><LoaderCircle className={s.spin} size={14} /> Saving…</> : saveState === 'saved' ? <><Check size={14} /> {saveMessage}</> : 'Ready'}
                        </span>
                      </div>
                    </header>

                    {isSubmitted && (
                      <div className={s.submittedBanner}>
                        <Check size={17} />
                        <span>Attendance was submitted. It is read-only until an authorized employee reopens it.</span>
                      </div>
                    )}

                    <div className={s.markList}>
                      {roster.length === 0 && <div className={s.inlineEmpty}>No active students are eligible for this session.</div>}
                      {roster.map((student) => {
                        const mark = draftMarks[student.enrollmentId] || { status: null, note: '' };
                        return (
                          <div className={s.markRow} key={student.enrollmentId}>
                            <div className={s.markStudent}>
                              <span className={s.avatar}>{initials(student.name)}</span>
                              <div>
                                {workspace.canLinkContacts && student.contactId
                                  ? <Link href={`/contacts/${student.contactId}`}>{student.name}</Link>
                                  : <span>{student.name}</span>}
                                {mark.note && <small>{mark.note}</small>}
                              </div>
                            </div>
                            <div className={s.segmented} role="group" aria-label={`Attendance for ${student.name}`}>
                              <button type="button" className={mark.status === 'present' ? s.presentSelected : ''} aria-pressed={mark.status === 'present'} disabled={busy || isSubmitted} onClick={() => handleMark(student.enrollmentId, 'present')}>
                                {mark.status === 'present' && <Check size={15} />} Present
                              </button>
                              <button type="button" className={mark.status === 'absent' ? s.absentSelected : ''} aria-pressed={mark.status === 'absent'} disabled={busy || isSubmitted} onClick={() => handleMark(student.enrollmentId, 'absent')}>
                                {mark.status === 'absent' && <X size={15} />} Absent
                              </button>
                              <button type="button" className={!mark.status ? s.unmarkedSelected : ''} aria-pressed={!mark.status} disabled={busy || isSubmitted} onClick={() => handleMark(student.enrollmentId, null)}>Unmarked</button>
                            </div>
                            <button
                              type="button"
                              className={s.noteButton}
                              aria-label={`Add attendance note for ${student.name}`}
                              aria-expanded={editingNoteId === student.enrollmentId}
                              disabled={busy || isSubmitted || !mark.status}
                              onClick={() => {
                                setEditingNoteId(editingNoteId === student.enrollmentId ? '' : student.enrollmentId);
                                setMarkNoteDraft(mark.note || '');
                              }}
                            >
                              <MessageSquareText size={18} />
                            </button>
                            {editingNoteId === student.enrollmentId && (
                              <div className={s.markNoteEditor}>
                                <label>
                                  <span>Optional note for {student.name}</span>
                                  <textarea value={markNoteDraft} onChange={(event) => setMarkNoteDraft(event.target.value)} maxLength={1000} autoFocus />
                                </label>
                                <div>
                                  <button type="button" className="btn btn-sm" onClick={() => { setEditingNoteId(''); setMarkNoteDraft(''); }}>Cancel</button>
                                  <button type="button" className="btn btn-sm btn-primary" onClick={handleSaveMarkNote} disabled={busy}>Save note</button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <footer className={s.attendanceFooter}>
                      <div className={s.countSummary}>
                        <strong>{counts.present} present</strong>
                        <span>{counts.absent} absent</span>
                        <span>{counts.unmarked} unmarked</span>
                        {!isSubmitted && counts.unmarked > 0 && <small><AlertCircle size={14} /> Mark every student before submitting.</small>}
                      </div>
                      {isSubmitted ? (
                        canReopen ? (
                          <button type="button" className="btn" onClick={() => setReopenOpen(true)} disabled={busy}><RotateCcw size={15} /> Reopen attendance</button>
                        ) : <span className={s.readOnlyLabel}>Submitted · read only</span>
                      ) : (
                        <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={busy || roster.length === 0 || counts.unmarked > 0}>Submit attendance</button>
                      )}
                    </footer>
                  </section>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {reopenOpen && (
        <div className={s.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setReopenOpen(false); }}>
          <section className={s.dialog} role="dialog" aria-modal="true" aria-labelledby="reopen-title">
            <div className={s.dialogHeading}>
              <div><span className={s.dialogIcon}><RotateCcw size={18} /></span><div><h3 id="reopen-title">Reopen attendance</h3><p>{formatSessionDate(workspace?.selectedDate)}</p></div></div>
              <button type="button" className={s.iconButton} onClick={() => setReopenOpen(false)} disabled={busy} aria-label="Close reopen dialog"><X size={17} /></button>
            </div>
            <label className={s.reopenField}>
              <span>Correction reason</span>
              <textarea value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} placeholder="Explain why this submitted attendance needs correction…" autoFocus />
            </label>
            <p>This reason will be stored in the attendance audit trail.</p>
            <div className={s.dialogActions}>
              <button type="button" className="btn" onClick={() => setReopenOpen(false)} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleReopen} disabled={busy || !reopenReason.trim()}>{busy ? 'Reopening…' : 'Reopen attendance'}</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
