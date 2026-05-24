'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlarmClock,
  CheckCircle2,
  ExternalLink,
  FilterX,
  RefreshCcw,
  UserPlus,
} from 'lucide-react';
import { useCRM } from '@/lib/store';
import { useToast } from '@/components/Toast';
import s from './FollowUpQueue.module.css';

const TASK_TYPE_OPTIONS = [
  ['all', 'All Types'],
  ['first_outreach', 'First Outreach'],
  ['follow_up', 'Follow Up'],
  ['appointment', 'Appointment'],
  ['document_request', 'Docs'],
  ['payment_follow_up', 'Payment'],
  ['manual_reminder', 'Manual'],
];

const DUE_OPTIONS = [
  ['work', 'Open Work'],
  ['today', 'Due Today'],
  ['overdue', 'Overdue'],
  ['unassigned', 'Unassigned'],
  ['all', 'All Statuses'],
];

const OPEN_STATUSES = new Set(['open', 'in_progress', 'snoozed']);
const CLOSED_STATUSES = new Set(['completed', 'canceled']);

function dateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
}

function formatDate(value) {
  const key = dateKey(value);
  if (!key) return 'No due date';
  const today = todayKey();
  if (key === today) return 'Today';
  const date = new Date(value);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function titleCase(value) {
  return String(value || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeTask(task, contacts = []) {
  const contact = contacts.find((row) => row.id === task.contactId);
  const status = task.status || task.taskStatus || (task.completed ? 'completed' : 'open');
  const dueAt = task.dueAt || task.dueDate || null;
  const ownerUserId = task.ownerUserId || task.assignedTo || '';
  return {
    ...task,
    dueAt,
    ownerUserId,
    status,
    taskType: task.taskType || 'manual_reminder',
    priority: String(task.priority || 'medium').toLowerCase(),
    contactName: task.contactName || task.client || contact?.name || '',
  };
}

function taskMatchesDue(task, dueFilter) {
  const key = dateKey(task.dueAt);
  const today = todayKey();
  const isClosed = CLOSED_STATUSES.has(task.status);
  if (dueFilter === 'all') return true;
  if (dueFilter === 'unassigned') return !task.ownerUserId && !isClosed;
  if (dueFilter === 'today') return !isClosed && key === today;
  if (dueFilter === 'overdue') return !isClosed && key && key < today;
  return !isClosed && OPEN_STATUSES.has(task.status);
}

function taskBadgeClass(task) {
  if (task.status === 'completed') return 'badge-completed';
  if (task.status === 'canceled') return 'badge-lost';
  if (dateKey(task.dueAt) && dateKey(task.dueAt) < todayKey() && !CLOSED_STATUSES.has(task.status)) return 'badge-overdue';
  if (task.status === 'snoozed') return 'badge-pending';
  return 'badge-contacted';
}

export default function FollowUpQueuePage() {
  const {
    tasks,
    contacts,
    employees,
    accessibleBusinessUnits,
    currentBusinessUnitId,
    currentBusinessUnit,
    currentUser,
    access,
    dataSource,
    scopeLabel,
    updateTask,
  } = useCRM();
  const { toast } = useToast();
  const [queueTasks, setQueueTasks] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [filters, setFilters] = useState({
    due: 'work',
    ownerUserId: 'all',
    businessUnitId: currentBusinessUnitId === 'all' || currentBusinessUnitId === 'unassigned' ? 'all' : currentBusinessUnitId,
    taskType: 'all',
  });
  const [loading, setLoading] = useState(dataSource === 'postgres');
  const [error, setError] = useState('');
  const [busyTaskId, setBusyTaskId] = useState('');

  const fallbackAssignees = useMemo(() => {
    const mappedEmployees = (employees || []).map((employee) => ({
      id: employee.id,
      name: employee.name,
      email: '',
    }));
    if (!currentUser?.id || mappedEmployees.some((employee) => employee.id === currentUser.id)) {
      return mappedEmployees;
    }
    return [
      { id: currentUser.id, name: currentUser.name || currentUser.email || 'Me', email: currentUser.email || '' },
      ...mappedEmployees,
    ];
  }, [currentUser, employees]);

  const visibleAssignees = assignees.length ? assignees : fallbackAssignees;

  const readTasks = useCallback(async () => {
    if (dataSource !== 'postgres') {
      setQueueTasks((tasks || []).map((task) => normalizeTask(task, contacts)));
      setAssignees(fallbackAssignees);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (filters.businessUnitId !== 'all') params.set('businessUnitId', filters.businessUnitId);
    if (filters.ownerUserId !== 'all' && filters.ownerUserId !== 'unassigned') {
      params.set('ownerUserId', filters.ownerUserId);
    }
    if (filters.ownerUserId === 'unassigned') params.set('unassigned', 'true');
    if (filters.taskType !== 'all') params.set('taskType', filters.taskType);

    try {
      const response = await fetch(`/api/tasks?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Task queue could not load.');
      setQueueTasks((payload.tasks || []).map((task) => normalizeTask(task, contacts)));
      setAssignees(payload.users || []);
    } catch (err) {
      setError(err.message || 'Task queue could not load.');
    } finally {
      setLoading(false);
    }
  }, [contacts, dataSource, fallbackAssignees, filters.businessUnitId, filters.ownerUserId, filters.taskType, tasks]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) readTasks();
    });
    return () => {
      cancelled = true;
    };
  }, [readTasks]);

  const filteredTasks = useMemo(() => {
    return queueTasks
      .filter((task) => taskMatchesDue(task, filters.due))
      .filter((task) => filters.ownerUserId === 'all' || filters.ownerUserId === 'unassigned' || task.ownerUserId === filters.ownerUserId)
      .filter((task) => filters.ownerUserId !== 'unassigned' || !task.ownerUserId)
      .filter((task) => filters.businessUnitId === 'all' || task.businessUnitId === filters.businessUnitId)
      .filter((task) => filters.taskType === 'all' || task.taskType === filters.taskType)
      .sort((a, b) => {
        const aKey = dateKey(a.dueAt) || '9999-12-31';
        const bKey = dateKey(b.dueAt) || '9999-12-31';
        if (aKey !== bKey) return aKey.localeCompare(bKey);
        return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });
  }, [filters, queueTasks]);

  const stats = useMemo(() => {
    const open = queueTasks.filter((task) => OPEN_STATUSES.has(task.status)).length;
    const dueToday = queueTasks.filter((task) => taskMatchesDue(task, 'today')).length;
    const overdue = queueTasks.filter((task) => taskMatchesDue(task, 'overdue')).length;
    const unassigned = queueTasks.filter((task) => taskMatchesDue(task, 'unassigned')).length;
    return { open, dueToday, overdue, unassigned };
  }, [queueTasks]);

  async function applyTaskAction(task, action, payload = {}) {
    if (!access.canWriteCrm) return;
    setBusyTaskId(task.id);
    setError('');
    try {
      if (dataSource === 'postgres') {
        const response = await fetch('/api/tasks', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: task.id, action, ...payload }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Task update failed.');
        const nextTask = normalizeTask(result.task, contacts);
        setQueueTasks((prev) => prev.map((row) => (row.id === task.id ? nextTask : row)));
        updateTask(task.id, {
          taskStatus: nextTask.status,
          status: nextTask.status,
          completed: nextTask.status === 'completed',
          assignedTo: nextTask.ownerUserId,
          ownerUserId: nextTask.ownerUserId,
          dueDate: dateKey(nextTask.dueAt),
          dueAt: nextTask.dueAt,
        });
      } else {
        const localPatch = {
          ...(action === 'complete' ? { completed: true, status: 'completed', taskStatus: 'completed' } : {}),
          ...(action === 'snooze' ? { dueDate: dateKey(payload.snoozedUntil), dueAt: payload.snoozedUntil, status: 'snoozed', taskStatus: 'snoozed' } : {}),
          ...(action === 'assign' ? { assignedTo: payload.ownerUserId || '', ownerUserId: payload.ownerUserId || '' } : {}),
        };
        updateTask(task.id, localPatch);
        setQueueTasks((prev) => prev.map((row) => (row.id === task.id ? normalizeTask({ ...row, ...localPatch }, contacts) : row)));
      }
      toast(action === 'complete' ? 'Task completed' : action === 'snooze' ? 'Task snoozed' : 'Task assigned');
    } catch (err) {
      setError(err.message || 'Task update failed.');
      toast(err.message || 'Task update failed.');
    } finally {
      setBusyTaskId('');
    }
  }

  const resetFilters = () => setFilters({
    due: 'work',
    ownerUserId: 'all',
    businessUnitId: currentBusinessUnitId === 'all' || currentBusinessUnitId === 'unassigned' ? 'all' : currentBusinessUnitId,
    taskType: 'all',
  });

  if (!access.canReadCrm) {
    return (
      <div className="fade-in">
        <div className="page-header">
          <div>
            <h1 className="page-title">Follow-up Queue</h1>
            <p className="page-subtitle">CRM read access is required.</p>
          </div>
        </div>
        <div className="empty-state">Missing CRM permission.</div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Follow-up Queue</h1>
          <p className="page-subtitle">{currentBusinessUnit?.name || `All ${scopeLabel}`} · {filteredTasks.length} visible tasks</p>
        </div>
        <div className="flex-gap">
          <button className="btn btn-sm" onClick={readTasks} disabled={loading}>
            <RefreshCcw size={14} />
            Refresh
          </button>
        </div>
      </div>

      <div className={s.summaryGrid}>
        <div className={s.summaryTile}><span className={s.summaryValue}>{stats.open}</span><span className={s.summaryLabel}>Open Work</span></div>
        <div className={s.summaryTile}><span className={s.summaryValue}>{stats.dueToday}</span><span className={s.summaryLabel}>Due Today</span></div>
        <div className={s.summaryTile}><span className={s.summaryValue}>{stats.overdue}</span><span className={s.summaryLabel}>Overdue</span></div>
        <div className={s.summaryTile}><span className={s.summaryValue}>{stats.unassigned}</span><span className={s.summaryLabel}>Unassigned</span></div>
      </div>

      <div className="card">
        <div className={s.toolbar}>
          <label className={s.filterGroup}>
            <span className="form-label">Due</span>
            <select className="select" value={filters.due} onChange={(event) => setFilters((prev) => ({ ...prev, due: event.target.value }))}>
              {DUE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className={s.filterGroup}>
            <span className="form-label">Owner</span>
            <select className="select" value={filters.ownerUserId} onChange={(event) => setFilters((prev) => ({ ...prev, ownerUserId: event.target.value }))}>
              <option value="all">All Owners</option>
              <option value="unassigned">Unassigned</option>
              {visibleAssignees.map((user) => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}
            </select>
          </label>
          <label className={s.filterGroup}>
            <span className="form-label">{scopeLabel}</span>
            <select className="select" value={filters.businessUnitId} onChange={(event) => setFilters((prev) => ({ ...prev, businessUnitId: event.target.value }))}>
              <option value="all">All {scopeLabel}</option>
              {accessibleBusinessUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
            </select>
          </label>
          <label className={s.filterGroup}>
            <span className="form-label">Task Type</span>
            <select className="select" value={filters.taskType} onChange={(event) => setFilters((prev) => ({ ...prev, taskType: event.target.value }))}>
              {TASK_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <div className={s.filterGroup}>
            <span className="form-label">Results</span>
            <div className={s.dueText}>{loading ? 'Loading' : `${filteredTasks.length} tasks`}</div>
          </div>
          <button className="btn btn-sm" onClick={resetFilters}>
            <FilterX size={14} />
            Reset
          </button>
        </div>

        {error && (
          <div className={s.statusRow}>
            <span>{error}</span>
            <button className="btn btn-sm" onClick={readTasks}>Retry</button>
          </div>
        )}

        {!loading && !error && filteredTasks.length === 0 && (
          <div className="empty-state">
            {queueTasks.length === 0 ? 'No tasks in this queue.' : 'No tasks match these filters.'}
          </div>
        )}

        <div className={s.queueShell}>
          {filteredTasks.map((task) => {
            const key = dateKey(task.dueAt);
            const isOverdue = key && key < todayKey() && !CLOSED_STATUSES.has(task.status);
            const isToday = key === todayKey() && !CLOSED_STATUSES.has(task.status);
            const assignee = visibleAssignees.find((user) => user.id === task.ownerUserId);
            return (
              <article key={task.id} className={`${s.queueItem} ${isOverdue ? s.queueItemOverdue : ''} ${isToday ? s.queueItemToday : ''}`}>
                <div>
                  <div className={s.taskTitle}>{task.title}</div>
                  {task.description && <div className={s.taskDescription}>{task.description}</div>}
                  <div className={s.metaLine}>
                    <span className={`badge ${taskBadgeClass(task)}`}>{titleCase(task.status)}</span>
                    <span className={`badge badge-${task.priority}`}>{titleCase(task.priority)}</span>
                    <span className="badge badge-draft">{titleCase(task.taskType)}</span>
                  </div>
                </div>
                <div>
                  <div className={s.compactLabel}>Due</div>
                  <div className={`${s.dueText} ${isOverdue ? s.dueTextDanger : ''}`}>{formatDate(task.dueAt)}</div>
                  <div className={s.mutedText}>{task.contactName || 'No contact linked'}</div>
                </div>
                <label className={s.assigneeSelect}>
                  <span className={s.compactLabel}>Owner</span>
                  <select
                    className="select"
                    value={task.ownerUserId || ''}
                    disabled={!access.canWriteCrm || busyTaskId === task.id}
                    onChange={(event) => applyTaskAction(task, 'assign', { ownerUserId: event.target.value || null })}
                  >
                    <option value="">Unassigned</option>
                    {visibleAssignees.map((user) => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}
                  </select>
                  {assignee?.email && <span className={s.mutedText}>{assignee.email}</span>}
                </label>
                <div className={s.actions}>
                  <button
                    className={`btn btn-sm ${s.iconButton}`}
                    data-tooltip="Assign to me"
                    disabled={!access.canWriteCrm || busyTaskId === task.id || !currentUser?.id}
                    onClick={() => applyTaskAction(task, 'assign', { ownerUserId: currentUser.id })}
                    aria-label="Assign to me"
                  >
                    <UserPlus size={14} />
                  </button>
                  <button
                    className={`btn btn-sm ${s.iconButton}`}
                    data-tooltip="Snooze one day"
                    disabled={!access.canWriteCrm || busyTaskId === task.id || CLOSED_STATUSES.has(task.status)}
                    onClick={() => applyTaskAction(task, 'snooze', { snoozedUntil: addDays(1) })}
                    aria-label="Snooze one day"
                  >
                    <AlarmClock size={14} />
                  </button>
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={!access.canWriteCrm || busyTaskId === task.id || CLOSED_STATUSES.has(task.status)}
                    onClick={() => applyTaskAction(task, 'complete')}
                  >
                    <CheckCircle2 size={14} />
                    Complete
                  </button>
                  {task.contactId && (
                    <Link className={`btn btn-sm ${s.iconButton}`} href={`/contacts/${task.contactId}`} data-tooltip="Open contact" aria-label="Open contact">
                      <ExternalLink size={14} />
                    </Link>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
