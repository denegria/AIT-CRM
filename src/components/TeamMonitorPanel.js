'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CheckSquare,
  Clock3,
  ExternalLink,
  TrendingDown,
  UserCheck,
  UsersRound,
} from 'lucide-react';
import {
  buildTaskScopePreview,
  buildTeamMonitorPageModel,
  buildTeamMonitorViewModel,
  filterTeamMonitorRows,
} from '@/lib/team-monitor.js';
import s from './TeamMonitorPanel.module.css';
import { TeamMonitorRosterTable } from './TeamMonitorRosterTable.js';

const KPI_META = [
  { key: 'onlineNow', label: 'Online now', Icon: UsersRound, tone: 'success' },
  { key: 'enrollmentsThisWeek', label: 'Enrollments this week', Icon: UserCheck, tone: 'accent', captionKey: 'enrollmentTrendLabel' },
  { key: 'cancellationsThisWeek', label: 'Cancellations this week', Icon: TrendingDown, tone: 'warning', captionKey: 'cancellationTrendLabel' },
  { key: 'overdue', label: 'Overdue tasks', Icon: Clock3, tone: 'danger' },
];

const PULSE_STATS = [
  { key: 'assignedContacts', label: 'Assigned contacts' },
  { key: 'enrollmentsToday', label: 'Today' },
  { key: 'cancellationsThisWeek', label: 'Cancellations' },
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

function TeamPulse({ summary }) {
  return (
    <div className={s.teamPulse}>
      <div className={s.pulseLead}>
        <span className={s.pulseEyebrow}>Team pulse</span>
        <div className={s.pulsePrimary}>
          <strong>{summary.enrollmentsThisWeek}</strong>
          <span>
            <b>Enrollments this week</b>
            <small>{summary.enrollmentTrendLabel}</small>
          </span>
        </div>
      </div>
      <div className={s.pulseStats}>
        {PULSE_STATS.map(({ key, label }) => (
          <span key={key}>
            <strong>{summary[key]}</strong>
            <small>{label}</small>
          </span>
        ))}
      </div>
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

function MonitorSummary({ summary, period, onPeriodChange }) {
  const risks = [
    { key: 'overdue', value: summary.overdue, label: 'Overdue tasks', hint: 'Open work past due', tone: 'danger' },
    { key: 'dueToday', value: summary.dueToday, label: 'Due today', hint: 'Open tasks due today', tone: 'warning' },
    { key: 'contactsWithoutNextFollowUp', value: summary.contactsWithoutNextFollowUp, label: 'Follow-up gaps', hint: 'Active-stage contacts without an open, dated follow-up', tone: 'warning' },
  ];
  return (
    <section className={s.monitorOverview} aria-label="Team workload overview">
      <div className={s.overviewHeader}>
        <div><h2>Needs review</h2><p>Current work across this division, including unassigned work.</p></div>
        <span className={s.overviewTotal}>{summary.openTasks} open tasks</span>
      </div>
      <div className={s.monitorMetricGrid}>
        {risks.map(({ key, value, label, hint, tone }) => (
          <div key={key} className={s.monitorMetric}>
            <span className={`${s.dot} ${statusDotClass(tone)}`} aria-hidden="true" />
            <span><strong>{value}</strong><b>{label}</b><small>{hint}</small></span>
          </div>
        ))}
      </div>
      <div className={s.movementRow}>
        <div className={s.movementIntro}>
          <span>Movement</span>
          <div className={s.controlGroup} role="group" aria-label="Reporting period">
            {[['today', 'Today'], ['week', 'This week']].map(([value, label]) => (
              <button key={value} type="button" className={period === value ? s.activePill : s.pill} aria-pressed={period === value} onClick={() => onPeriodChange(value)}>{label}</button>
            ))}
          </div>
        </div>
        <span><strong>{summary.completedTasks}</strong> tasks completed</span>
        <span><strong>{summary.enrollments}</strong> enrollments</span>
        <span><strong>{summary.cancellations}</strong> cancellations</span>
      </div>
    </section>
  );
}

function MonitorControls({ attention, onAttentionChange }) {
  return (
    <div className={s.monitorControls}>
      <div className={s.rosterHeading}><strong>Coordinator workload</strong><small>Current portfolio and {attention === 'all' ? 'all work' : attention === 'attention' ? 'attention items' : 'quiet rows'}</small></div>
      <div className={s.controlGroup} role="group" aria-label="Attention filter">
        {[['all', 'All work'], ['attention', 'Needs attention'], ['no-work', 'No active workload']].map(([value, label]) => (
          <button key={value} type="button" className={attention === value ? s.activePill : s.pill} aria-pressed={attention === value} onClick={() => onAttentionChange(value)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function RosterTable({ roster, selectedEmployeeId, onSelectEmployee }) {
  return <TeamMonitorRosterTable roster={roster} selectedEmployeeId={selectedEmployeeId} onSelectEmployee={onSelectEmployee} renderAvatar={(employee) => <EmployeeAvatar employee={employee} />} styles={s} />;
}

function EmployeeDetail({ employee, periodLabel }) {
  if (!employee) {
    return (
      <aside className={s.detailPanel}>
        <div className={s.emptyDetail}>No team member matches this filter.</div>
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
        </span>
      </div>
      <div className={s.detailSnapshot}>
        <span><strong>{employee.openTasks}</strong><small>open tasks</small></span>
        <span><strong>{Number(employee.activeAssignedContacts || 0) + Number(employee.unassignedActiveContacts || 0)}</strong><small>active contacts</small></span>
        <span><strong>{employee.contactsWithoutNextFollowUp}</strong><small>follow-up gaps</small></span>
      </div>
      <p className={s.detailContext}>{employee.isUnassignedBucket ? 'Review ownership before routing this work.' : `${employee.completedTasks} tasks completed, ${employee.enrollments} enrollments and ${employee.cancellations} cancellations ${periodLabel.toLowerCase()}.`}</p>
      <div className={s.detailSection}>
        <div className={s.detailTitle}>Overdue tasks <span>{employee.overdue}</span></div>
        {employee.overdueTasks.length ? employee.overdueTasks.slice(0, 5).map((task) => (
          <Link key={task.id} className={s.detailTask} href={`/tasks/${encodeURIComponent(task.id)}`} title={task.title || 'Untitled task'}>
            <Clock3 size={14} />
            <span>{task.title || 'Untitled task'}</span>
            <small>{taskDateLabel(task.dueAt || task.dueDate)}</small>
          </Link>
        )) : <div className={s.emptyDetail}>No overdue tasks.</div>}
        {employee.overdueTasks.length > 5 && <div className={s.moreTasks}>+{employee.overdueTasks.length - 5} more in Tasks</div>}
      </div>
      <div className={s.detailSection}>
        <div className={s.detailTitle}>Due today <span>{employee.dueToday}</span></div>
        {employee.dueTodayTasks.length ? employee.dueTodayTasks.slice(0, 5).map((task) => (
          <Link key={task.id} className={s.detailTask} href={`/tasks/${encodeURIComponent(task.id)}`} title={task.title || 'Untitled task'}>
            <CheckSquare size={14} />
            <span>{task.title || 'Untitled task'}</span>
            <small>{taskDateLabel(task.dueAt || task.dueDate)}</small>
          </Link>
        )) : <div className={s.emptyDetail}>No tasks due today.</div>}
        {employee.dueTodayTasks.length > 5 && <div className={s.moreTasks}>+{employee.dueTodayTasks.length - 5} more in Tasks</div>}
      </div>
      <div className={s.detailActions}>
        <Link className="btn btn-sm" href={employee.taskHref}>
          View tasks
        </Link>
        <Link className="btn btn-sm" href={employee.contactHref}>
          View contacts
        </Link>
      </div>
    </aside>
  );
}

function TaskScopePreview({ tasks, employees, currentUser, showScopeControls = true }) {
  const [scope, setScope] = useState('mine');
  const [filter, setFilter] = useState('today');
  const showAdminControls = Boolean(showScopeControls);
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
          <p>{showAdminControls ? 'Normal CRM tasks with admin view scope controls.' : 'Your normal CRM task list.'}</p>
        </div>
        <Link className="btn btn-sm" href="/tasks">Open tasks</Link>
      </div>
      {showAdminControls && (
        <div className={s.controlRow}>
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
      )}
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

export function TeamMonitorPreview({ employees, tasks, contacts, currentUser, businessMovement = null }) {
  const viewModel = useMemo(
    () => buildTeamMonitorViewModel({ employees, tasks, contacts, currentUser, businessMovement }),
    [businessMovement, contacts, currentUser, employees, tasks],
  );

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
      <PreviewEmployeeList roster={viewModel.roster} />
      <TeamPulse summary={viewModel.summary} />
      <p className={s.lowData}>{viewModel.lowDataNotice}</p>
    </section>
  );
}

export function TeamMonitorPageSurface({ employees, tasks, contacts, currentUser }) {
  const [period, setPeriod] = useState('today');
  const [attention, setAttention] = useState('all');
  const viewModel = useMemo(
    () => buildTeamMonitorPageModel({ employees, tasks, contacts, currentUser, period }),
    [contacts, currentUser, employees, period, tasks],
  );
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const filteredRoster = useMemo(
    () => filterTeamMonitorRows({ roster: viewModel.roster, unassigned: viewModel.unassigned, attention }),
    [attention, viewModel.roster, viewModel.unassigned],
  );
  const visibleUnassigned = filteredRoster.find((employee) => employee.isUnassignedBucket);
  const visibleEmployees = filteredRoster.filter((employee) => !employee.isUnassignedBucket);
  const selectedEmployee = filteredRoster.find((employee) => employee.id === selectedEmployeeId) || filteredRoster[0] || null;

  return (
    <div className={s.monitorSurface}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Team Monitor</h1>
          <p className="page-subtitle">Spot uncovered work, review coordinators, and open the right queue.</p>
        </div>
      </div>
      <MonitorSummary summary={viewModel.summary} period={period} onPeriodChange={setPeriod} />
      <div className={s.fullLayout}>
        <section className={s.rosterCard}>
          <MonitorControls attention={attention} onAttentionChange={setAttention} />
          <RosterTable
            roster={filteredRoster}
            selectedEmployeeId={selectedEmployee?.id}
            onSelectEmployee={setSelectedEmployeeId}
          />
          <div className={s.tableFooter}>
            <span>{viewModel.updatedLabel}</span>
            <span>Showing {visibleEmployees.length} employee{visibleEmployees.length === 1 ? '' : 's'}{visibleUnassigned ? ' plus unassigned work' : ''}</span>
          </div>
          <p className={s.lowData}>{viewModel.metricNote}{viewModel.summary.unattributedTasks || viewModel.summary.unattributedContacts ? ` ${viewModel.summary.unattributedTasks + viewModel.summary.unattributedContacts} item${viewModel.summary.unattributedTasks + viewModel.summary.unattributedContacts === 1 ? '' : 's'} with an owner outside this roster remain in the reconciliation bucket.` : ''}</p>
        </section>
        <EmployeeDetail employee={selectedEmployee} periodLabel={viewModel.period.label} />
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
