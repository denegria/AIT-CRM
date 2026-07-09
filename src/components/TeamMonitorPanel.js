'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CheckSquare,
  Clock3,
  ExternalLink,
  MessageSquare,
  TrendingDown,
  UserCheck,
  UsersRound,
} from 'lucide-react';
import {
  buildTaskScopePreview,
  buildTeamMonitorViewModel,
} from '@/lib/team-monitor.js';
import s from './TeamMonitorPanel.module.css';

const KPI_META = [
  { key: 'onlineNow', label: 'Online now', Icon: UsersRound, tone: 'success' },
  { key: 'enrollmentsThisWeek', label: 'Enrollments this week', Icon: UserCheck, tone: 'accent', captionKey: 'enrollmentTrendLabel' },
  { key: 'cancellationsThisWeek', label: 'Cancellations this week', Icon: TrendingDown, tone: 'warning', captionKey: 'cancellationTrendLabel' },
  { key: 'overdue', label: 'Overdue tasks', Icon: Clock3, tone: 'danger' },
];

const SNAPSHOT_META = [
  { key: 'enrollmentsToday', label: 'Enrollments today' },
  { key: 'enrollmentsThisWeek', label: 'Enrollments week' },
  { key: 'cancellationsThisWeek', label: 'Cancellations week' },
  { key: 'assignedContacts', label: 'Assigned contacts' },
];

function taskDateLabel(value) {
  if (!value) return 'No due date';
  const key = String(value).slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (key === today) return 'Today';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function progressWidth(done, total) {
  if (!total) return '0%';
  return `${Math.min(100, Math.round((done / total) * 100))}%`;
}

function statusDotClass(tone) {
  if (tone === 'danger') return s.dotDanger;
  if (tone === 'warning') return s.dotWarning;
  if (tone === 'online' || tone === 'success') return s.dotSuccess;
  return s.dotMuted;
}

function EmployeeAvatar({ employee }) {
  const initials = String(employee.name || employee.email || 'U')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'U';
  return <span className={s.avatar} aria-hidden="true">{initials}</span>;
}

function MetricCards({ summary }) {
  return (
    <div className={s.kpiGrid}>
      {KPI_META.map(({ key, label, Icon, tone, captionKey }) => (
        <div key={key} className={s.kpiCard}>
          <span className={`${s.kpiIcon} ${s[`tone_${tone}`]}`}>
            <Icon size={20} />
          </span>
          <span>
            <span className={s.kpiLabel}>{label}</span>
            <strong className={s.kpiValue}>{summary[key]}</strong>
            {captionKey && <small className={s.kpiCaption}>{summary[captionKey]}</small>}
          </span>
        </div>
      ))}
    </div>
  );
}

function BusinessSnapshot({ summary }) {
  return (
    <div className={s.snapshotGrid}>
      {SNAPSHOT_META.map(({ key, label }) => (
        <div key={key} className={s.snapshotItem}>
          <strong>{summary[key]}</strong>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function PreviewEmployeeList({ roster }) {
  const visibleRoster = roster.slice(0, 5);
  return (
    <div className={s.previewList}>
      {visibleRoster.map((employee) => (
        <div key={employee.id} className={s.previewEmployee}>
          <div className={s.previewIdentity}>
            <EmployeeAvatar employee={employee} />
            <span>
              <strong>{employee.name || employee.email || 'Unnamed user'}</strong>
              <small>{employee.presenceLabel} · {employee.lastOnlineLabel}</small>
            </span>
          </div>
          <div className={s.previewProgress}>
            <span>{employee.progressDone} of {employee.progressTotal} tasks</span>
            <div className={s.progressTrack}>
              <span style={{ width: progressWidth(employee.progressDone, employee.progressTotal) }} />
            </div>
          </div>
          <div className={s.previewOutcome}>
            <strong>{employee.enrollmentsThisWeekCount}</strong>
            <span>enrolled wk</span>
          </div>
          <span className={employee.overdueCount ? s.previewRiskDanger : s.previewRisk}>
            {employee.overdueCount ? `${employee.overdueCount} overdue` : employee.signal}
          </span>
        </div>
      ))}
      {!visibleRoster.length && (
        <div className={s.emptyDetail}>No active employees are available for this scope.</div>
      )}
    </div>
  );
}

function RosterTable({ roster, selectedEmployeeId, onSelectEmployee, compact = false }) {
  const visibleRoster = compact ? roster.slice(0, 5) : roster;
  return (
    <div className={s.tableWrap}>
      <table className={s.rosterTable}>
        <thead>
          <tr>
            <th>Employee</th>
            <th>Status / last online</th>
            <th>Today progress</th>
            <th>Assigned contacts</th>
            <th>Enrollments wk</th>
            <th>Cancels wk</th>
            <th>Overdue</th>
            <th>Signal</th>
          </tr>
        </thead>
        <tbody>
          {visibleRoster.map((employee) => (
            <tr
              key={employee.id}
              className={employee.id === selectedEmployeeId ? s.selectedRow : ''}
              onClick={() => onSelectEmployee?.(employee.id)}
            >
              <td>
                <div className={s.employeeCell}>
                  <EmployeeAvatar employee={employee} />
                  <span>
                    <strong>{employee.name || employee.email || 'Unnamed user'}</strong>
                    <small>{employee.roleLabel}</small>
                  </span>
                </div>
              </td>
              <td>
                <div className={s.statusCell}>
                  <span className={`${s.dot} ${statusDotClass(employee.presenceTone)}`} />
                  <span>{employee.presenceLabel}</span>
                  <small>{employee.lastOnlineLabel}</small>
                </div>
              </td>
              <td>
                <div className={s.progressCell}>
                  <span>{employee.progressDone} of {employee.progressTotal}</span>
                  <div className={s.progressTrack}>
                    <span style={{ width: progressWidth(employee.progressDone, employee.progressTotal) }} />
                  </div>
                </div>
              </td>
              <td>{employee.assignedContactCount}</td>
              <td><span className={s.successCount}>{employee.enrollmentsThisWeekCount}</span></td>
              <td><span className={employee.cancellationsThisWeekCount ? s.softCount : s.zeroCount}>{employee.cancellationsThisWeekCount}</span></td>
              <td><span className={employee.overdueCount ? s.dangerCount : s.zeroCount}>{employee.overdueCount}</span></td>
              <td>
                <span className={s.signal}>
                  <span className={`${s.dot} ${statusDotClass(employee.signalTone)}`} />
                  {employee.signal}
                </span>
              </td>
            </tr>
          ))}
          {!visibleRoster.length && (
            <tr>
              <td colSpan={8} className={s.emptyCell}>No active employees are available for this scope.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function EmployeeDetail({ employee }) {
  if (!employee) {
    return (
      <aside className={s.detailPanel}>
        <div className={s.emptyDetail}>Select an employee to review today&apos;s open work.</div>
      </aside>
    );
  }

  return (
    <aside className={s.detailPanel}>
      <div className={s.detailHeader}>
        <EmployeeAvatar employee={employee} />
        <span>
          <strong>{employee.name || employee.email || 'Unnamed user'}</strong>
          <small>{employee.roleLabel}</small>
          <small>{employee.presenceLabel} · {employee.lastOnlineLabel}</small>
        </span>
      </div>
      <div className={s.detailSection}>
        <div className={s.detailTitle}>Enrollment movement</div>
        <div className={s.detailStats}>
          <span><strong>{employee.assignedContactCount}</strong><small>assigned contacts</small></span>
          <span><strong>{employee.enrollmentsTodayCount}</strong><small>today</small></span>
          <span><strong>{employee.enrollmentsThisWeekCount}</strong><small>enrolled wk</small></span>
          <span><strong>{employee.cancellationsThisWeekCount}</strong><small>cancels wk</small></span>
        </div>
      </div>
      <div className={s.detailSection}>
        <div className={s.detailTitle}>Today tasks</div>
        {employee.todayTasks.length ? employee.todayTasks.map((task) => (
          <div key={task.id} className={s.detailTask}>
            <CheckSquare size={14} />
            <span>{task.title || 'Untitled task'}</span>
            <small>{taskDateLabel(task.dueAt || task.dueDate)}</small>
          </div>
        )) : <div className={s.emptyDetail}>No tasks due today.</div>}
      </div>
      <div className={s.detailSection}>
        <div className={s.detailTitle}>Overdue</div>
        {employee.overdueTasks.length ? employee.overdueTasks.map((task) => (
          <div key={task.id} className={s.detailTask}>
            <Clock3 size={14} />
            <span>{task.title || 'Untitled task'}</span>
            <small>{taskDateLabel(task.dueAt || task.dueDate)}</small>
          </div>
        )) : <div className={s.emptyDetail}>No overdue tasks.</div>}
      </div>
      <div className={s.detailActions}>
        <Link className="btn btn-sm" href={`/tasks?ownerUserId=${encodeURIComponent(employee.id)}`}>
          View tasks
        </Link>
        <Link className="btn btn-sm" href="/inbox">
          <MessageSquare size={14} />
          Message
        </Link>
      </div>
    </aside>
  );
}

function TaskScopePreview({ tasks, employees, currentUser, showScopeControls = true }) {
  const [scope, setScope] = useState('mine');
  const [filter, setFilter] = useState('today');
  const effectiveScope = showScopeControls ? scope : 'mine';
  const previewTasks = useMemo(() => buildTaskScopePreview({
    tasks,
    employees,
    currentUser,
    scope: effectiveScope,
    filter,
    limit: 6,
  }), [currentUser, effectiveScope, employees, filter, tasks]);

  return (
    <section className={s.tasksPanel}>
      <div className={s.sectionHeader}>
        <div>
          <h2>My Tasks</h2>
          <p>Normal CRM tasks with admin view scope controls.</p>
        </div>
        <Link className="btn btn-sm" href="/tasks">Open tasks</Link>
      </div>
      <div className={s.controlRow}>
        {showScopeControls && (
          <div className={s.segmented} aria-label="Task scope">
            {[
              ['mine', 'My tasks'],
              ['team', 'Team tasks'],
              ['all', 'All employee tasks'],
            ].map(([value, label]) => (
              <button key={value} type="button" className={scope === value ? s.activeSegment : ''} onClick={() => setScope(value)}>
                {label}
              </button>
            ))}
          </div>
        )}
        <div className={s.segmented} aria-label="Task filter">
          {[
            ['today', 'Due today'],
            ['overdue', 'Overdue'],
            ['unassigned', 'Unassigned'],
          ].map(([value, label]) => (
            <button key={value} type="button" className={filter === value ? s.activeSegment : ''} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className={s.taskTableWrap}>
        <table className={s.taskTable}>
          <thead>
            <tr>
              <th>Task</th>
              <th>Context</th>
              <th>Owner</th>
              <th>Due / status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {previewTasks.map((task) => (
              <tr key={task.id}>
                <td>{task.title || 'Untitled task'}</td>
                <td>{task.contextLabel}</td>
                <td>{task.ownerName}</td>
                <td>{filter === 'overdue' ? 'Overdue' : taskDateLabel(task.dueAt || task.dueDate)}</td>
                <td><Link href={`/tasks/${encodeURIComponent(task.id)}`}>Open</Link></td>
              </tr>
            ))}
            {!previewTasks.length && (
              <tr>
                <td colSpan={5} className={s.emptyCell}>No matching tasks in this scope.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function TeamMonitorPreview({ employees, tasks, contacts, currentUser }) {
  const viewModel = useMemo(() => buildTeamMonitorViewModel({ employees, tasks, contacts, currentUser }), [contacts, currentUser, employees, tasks]);

  return (
    <section className={s.previewCard}>
      <div className={s.sectionHeader}>
        <div>
          <h2>Team Monitor Preview</h2>
          <p>Online status, task progress, and enrollment movement.</p>
        </div>
        <Link className="btn btn-sm" href="/team-monitor">
          Open Team Monitor
          <ExternalLink size={14} />
        </Link>
      </div>
      <BusinessSnapshot summary={viewModel.summary} />
      <PreviewEmployeeList roster={viewModel.roster} />
      <p className={s.lowData}>{viewModel.lowDataNotice}</p>
    </section>
  );
}

export function TeamMonitorPageSurface({ employees, tasks, contacts, currentUser }) {
  const viewModel = useMemo(() => buildTeamMonitorViewModel({ employees, tasks, contacts, currentUser }), [contacts, currentUser, employees, tasks]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(() => viewModel.roster[0]?.id || '');
  const selectedEmployee = viewModel.roster.find((employee) => employee.id === selectedEmployeeId) || viewModel.roster[0] || null;

  return (
    <div className={s.monitorSurface}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Team Monitor</h1>
          <p className="page-subtitle">Employee activity, task progress, enrollments, and cancellation movement.</p>
        </div>
      </div>
      <MetricCards summary={viewModel.summary} />
      <div className={s.fullLayout}>
        <section className={s.rosterCard}>
          <div className={s.filterRow}>
            <span className={s.activePill}>Today</span>
            <span className={s.pill}>This week</span>
            <span className={s.divider} />
            <span className={s.pill}>All</span>
            <span className={s.pill}>Needs attention</span>
          </div>
          <RosterTable
            roster={viewModel.roster}
            selectedEmployeeId={selectedEmployee?.id}
            onSelectEmployee={setSelectedEmployeeId}
          />
          <div className={s.tableFooter}>
            <span>{viewModel.updatedLabel}</span>
            <span>Showing {viewModel.roster.length} employee{viewModel.roster.length === 1 ? '' : 's'}</span>
          </div>
          <p className={s.lowData}>{viewModel.lowDataNotice}</p>
        </section>
        <EmployeeDetail employee={selectedEmployee} />
      </div>
    </div>
  );
}

export function DashboardTasksPanel({ tasks, employees, currentUser, showScopeControls = true }) {
  return (
    <TaskScopePreview
      tasks={tasks}
      employees={employees}
      currentUser={currentUser}
      showScopeControls={showScopeControls}
    />
  );
}
