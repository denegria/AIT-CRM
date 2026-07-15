'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ListTodo, UserPlus } from 'lucide-react';
import { useCRM } from '@/lib/store';
import PageState from '@/components/PageState';
import KPICard from '@/components/KPICard';
import TaskList from '@/components/TaskList';
import Calendar from '@/components/Calendar';
import { useToast } from '@/components/Toast';
import {
  DashboardTasksPanel,
  TeamMonitorPreview,
} from '@/components/TeamMonitorPanel';
import monitorStyles from '@/components/TeamMonitorPanel.module.css';
import { canUseTeamMonitor } from '@/lib/team-monitor.js';
import { WORKFLOW_KEYS, workflowKeyForBusinessUnit } from '@/lib/crm/lifecycle';
import {
  buildTaskCalendarEvents,
  isOpenTask,
  taskDueKey,
} from '@/lib/dashboard/task-calendar';
import { isCurrentLeadDateScope } from '@/lib/contact-directory-view';
import { filterContactsByDirectoryFacet } from '@/lib/contact-directory-facets';
import {
  isTaskCompletedToday,
  isTaskCurrentWork,
  isTaskDueToday,
  isTaskOverdue,
} from '@/lib/tasks/visibility.js';

function dateInputToIso(value) {
  if (!value) return null;
  const date = new Date(`${value}T09:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function moneyLabel(value) {
  return `$${Math.round(Number(value || 0)).toLocaleString()}`;
}

function isAitSigns(contact = {}) {
  return contact.workflowKey === WORKFLOW_KEYS.AIT_SIGNS;
}

function isAitUsa(contact = {}) {
  return contact.workflowKey === WORKFLOW_KEYS.AIT_USA;
}

function isOpenWorkOrder(workOrder = {}) {
  return String(workOrder.status || '').toLowerCase() !== 'completed';
}

function isPendingEstimate(record = {}) {
  const type = String(record.type || '').toLowerCase();
  const status = String(record.status || '').toLowerCase();
  return type === 'estimate' && status !== 'draft' && status !== 'paid';
}

function isUnassignedInboundLeadFollowUp(task = {}) {
  return isOpenTask(task) &&
    task.taskType === 'follow_up' &&
    !task.ownerUserId &&
    task.sourceType === 'automation' &&
    task.sourceLabel === 'New lead follow-up';
}

function isFacebookLeadFollowUp(task = {}) {
  return isUnassignedInboundLeadFollowUp(task) &&
    String(task.sourceId || '').startsWith('facebook_lead_ads:');
}

export default function Dashboard() {
  const {
    role,
    contacts,
    workOrders,
    financials,
    tasks,
    tasksLoaded,
    tasksLoading,
    tasksError,
    loadTasks,
    calendarEvents,
    employees,
    updateTask,
    addTask,
    loaded,
    dataSource,
    importStaging,
    currentUser,
    access,
    currentBusinessUnit,
    scopeLabel,
    dashboardSummary,
    dashboardSummaryIsDeferred,
    dashboardSummaryLoaded,
    dashboardSummaryLoading,
    dashboardSummaryError,
    loadDashboardSummary,
  } = useCRM();
  const { toast } = useToast();
  const [dashboardNow] = useState(() => Date.now());
  const currentUserId = currentUser?.id || 'emp-1';
  const monitorCurrentUser = currentUser || { id: currentUserId, primaryRoleKey: role };
  const isAdminView = canUseTeamMonitor(monitorCurrentUser);
  const canUseTeamMonitorView = isAdminView;
  const canReadFinancials = Boolean(access?.canReadFinancials);

  useEffect(() => {
    if (dataSource !== 'postgres' || !access.canReadCrm || tasksLoaded || tasksLoading) return;
    loadTasks().catch(() => null);
  }, [access.canReadCrm, dataSource, loadTasks, tasksLoaded, tasksLoading]);

  useEffect(() => {
    if (
      dataSource !== 'postgres' ||
      !dashboardSummaryIsDeferred ||
      !access.canReadCrm ||
      dashboardSummaryLoading ||
      !currentBusinessUnit?.id
    ) return;
    if (dashboardSummaryLoaded && dashboardSummary?.businessUnitId === currentBusinessUnit.id) return;
    loadDashboardSummary({
      businessUnitId: currentBusinessUnit.id,
      employeeIds: employees.map((employee) => employee.id).filter(Boolean),
    }).catch(() => null);
  }, [
    access.canReadCrm,
    currentBusinessUnit?.id,
    dashboardSummary?.businessUnitId,
    dashboardSummaryIsDeferred,
    dashboardSummaryLoaded,
    dashboardSummaryLoading,
    dataSource,
    employees,
    loadDashboardSummary,
  ]);

  const legacyKpis = useMemo(() => {
    const currentContacts = contacts.filter(c => isCurrentLeadDateScope(c));
    const now = dashboardNow;
    const invoices = financials.filter(f => f.type === 'Invoice');
    const totalRevenue = invoices.filter(f => f.status === 'Paid').reduce((s, f) => s + f.amount, 0);
    const pipeline = financials.filter(f => f.type === 'Estimate' && f.status !== 'Draft').reduce((s, f) => s + f.amount, 0);
    const totalInvoiced = invoices.reduce((s, f) => s + f.amount, 0);
    const activeWOs = workOrders.filter(isOpenWorkOrder).length;
    const newLeads = contacts.filter(c => c.status === 'New Lead').length;
    const myTasks = isAdminView ? tasks : tasks.filter(t => (t.ownerUserId || t.assignedTo) === currentUserId);
    const dueTodayTasks = myTasks.filter(task => isTaskDueToday(task));
    const overdueTasks = myTasks.filter(task => isTaskOverdue(task));
    const myTasksCount = myTasks.filter(isTaskCurrentWork).length;
    const unassignedLeadFollowUps = isAdminView ? tasks.filter(isUnassignedInboundLeadFollowUp) : [];
    const unassignedFacebookFollowUps = unassignedLeadFollowUps.filter(isFacebookLeadFollowUp);
    const activeContacts = currentContacts.length;
    const pendingInvoices = invoices.filter(f => f.status === 'Pending').length;
    const assignedWOs = workOrders.filter(w => w.assignedTo === currentUserId && isOpenWorkOrder(w)).length;
    const myPipeline = currentContacts.filter(c => c.assignedTo === currentUserId).length;
    const needsFirstOutreach = currentContacts.filter(c => c.needsFirstOutreach).length;
    const aitSignsContacts = contacts.filter(isAitSigns);
    const aitSignsCurrentContacts = currentContacts.filter(isAitSigns);
    const aitUsaContacts = currentContacts.filter(isAitUsa);
    const signsIntake = filterContactsByDirectoryFacet(aitSignsContacts, 'signs_intake', { currentUserId, now }).length;
    const signsEstimate = filterContactsByDirectoryFacet(aitSignsContacts, 'signs_estimate', { currentUserId, now }).length;
    const signsWorkOrder = filterContactsByDirectoryFacet(aitSignsContacts, 'signs_work_order', { currentUserId, now }).length;
    const signsFulfillment = filterContactsByDirectoryFacet(aitSignsContacts, 'signs_fulfillment', { currentUserId, now }).length;
    const signsPayment = filterContactsByDirectoryFacet(aitSignsContacts, 'signs_payment_balance', { currentUserId, now }).length;
    const signsFirstOutreach = aitSignsCurrentContacts.filter((contact) => isAitSigns(contact) && contact.needsFirstOutreach).length;
    const pendingEstimates = financials.filter(isPendingEstimate);
    const pendingEstimateValue = pendingEstimates.reduce((sum, record) => sum + Number(record.amount || 0), 0);
    const usaNewLeads = filterContactsByDirectoryFacet(aitUsaContacts, 'usa_new_lead', { currentUserId, now }).length;
    const usaFollowUp = filterContactsByDirectoryFacet(aitUsaContacts, 'usa_follow_up', { currentUserId, now }).length;
    const usaBadContactChannel = filterContactsByDirectoryFacet(aitUsaContacts, 'usa_bad_contact_channel', { currentUserId, now }).length;

    return {
      totalRevenue,
      pipeline,
      totalInvoiced,
      activeWOs,
      newLeads,
      myTasksCount,
      unassignedLeadFollowUps: unassignedLeadFollowUps.length,
      unassignedFacebookFollowUps: unassignedFacebookFollowUps.length,
      activeContacts,
      pendingInvoices,
      assignedWOs,
      myPipeline,
      needsFirstOutreach,
      dueTodayTasks: dueTodayTasks.length,
      overdueTasks: overdueTasks.length,
      signsIntake,
      signsEstimate,
      signsWorkOrder,
      signsFulfillment,
      signsPayment,
      signsFirstOutreach,
      pendingEstimates: pendingEstimates.length,
      pendingEstimateValue,
      usaNewLeads,
      usaFollowUp,
      usaBadContactChannel,
    };
  }, [contacts, currentUserId, dashboardNow, financials, isAdminView, tasks, workOrders]);
  const kpis = dashboardSummary?.kpis || legacyKpis;

  const myTasks = useMemo(() => {
    if (isAdminView) return tasks;
    return tasks.filter(t => (t.ownerUserId || t.assignedTo) === currentUserId);
  }, [tasks, isAdminView, currentUserId]);

  const dashboardKpiCards = useMemo(() => {
    const inboundTaskHref = '/tasks?ownerUserId=unassigned&taskType=follow_up&status=open';
    const taskHref = kpis.unassignedLeadFollowUps
      ? inboundTaskHref
      : kpis.overdueTasks
      ? `/tasks?due=overdue${isAdminView ? '' : '&ownerUserId=__me'}`
      : `/tasks?due=today${isAdminView ? '' : '&ownerUserId=__me'}`;
    const taskCard = {
      label: kpis.unassignedLeadFollowUps ? 'Unassigned Lead Follow-ups' : kpis.overdueTasks ? 'Overdue Tasks' : 'Tasks Due Today',
      value: kpis.unassignedLeadFollowUps || kpis.overdueTasks || kpis.dueTodayTasks,
      change: kpis.unassignedLeadFollowUps
        ? kpis.unassignedFacebookFollowUps ? `${kpis.unassignedFacebookFollowUps} Facebook leads` : 'Needs owner'
        : kpis.overdueTasks ? `${kpis.dueTodayTasks} also due today` : 'Due today',
      trend: kpis.unassignedLeadFollowUps || kpis.overdueTasks ? 'down' : 'up',
      href: taskHref,
    };
    const workflowKey = workflowKeyForBusinessUnit(currentBusinessUnit || '');

    if (workflowKey === WORKFLOW_KEYS.AIT_USA) {
      return [
        taskCard,
        { label: 'New Leads', value: kpis.usaNewLeads, change: 'Enrollment pipeline', trend: 'up', href: '/contacts?leadDateScope=current&status=New+Lead' },
        { label: 'Follow-ups Due', value: kpis.usaFollowUp, change: 'Active follow-up status', trend: 'up', href: '/contacts?leadDateScope=current&status=Follow+Up' },
        { label: 'Bad Contact Channel', value: kpis.usaBadContactChannel, change: 'Needs cleanup', trend: kpis.usaBadContactChannel ? 'down' : 'up', href: '/contacts?leadDateScope=current&facet=usa_bad_contact_channel' },
      ];
    }

    if (workflowKey === WORKFLOW_KEYS.AIT_SIGNS) {
      const signsLeadCard = kpis.signsFirstOutreach
        ? { label: 'Signs Intake', value: kpis.signsIntake, change: `${kpis.signsFirstOutreach} new records`, trend: 'up', href: '/contacts?leadDateScope=current&status=Intake' }
        : { label: 'Signs Intake', value: kpis.signsIntake, change: 'New Signs work', trend: 'up', href: '/contacts?facet=signs_intake' };
      return [
        taskCard,
        signsLeadCard,
        { label: 'Open Work Orders', value: kpis.activeWOs, change: `${kpis.signsFulfillment} in fulfillment`, trend: 'up', href: '/work-orders?status=open' },
        { label: 'Payment / Balance', value: kpis.signsPayment, change: 'Needs collection review', trend: kpis.signsPayment ? 'down' : 'up', href: '/contacts?facet=signs_payment_balance' },
      ];
    }

    return [
      taskCard,
      { label: 'Current Contacts', value: kpis.activeContacts, change: 'Current scope', trend: 'up', href: '/contacts?leadDateScope=current' },
      { label: 'Open Work Orders', value: kpis.activeWOs, change: `${dashboardSummary?.kpis?.inProgressWorkOrders ?? workOrders.filter(w=>w.status==='In Progress').length} in progress`, trend: 'up', href: '/work-orders?status=open' },
      canReadFinancials
        ? { label: 'Pending Estimates', value: moneyLabel(kpis.pendingEstimateValue), change: `${kpis.pendingEstimates} estimates`, trend: 'up', href: '/financials' }
        : { label: 'New Leads', value: kpis.needsFirstOutreach, change: 'Ready to assign', trend: 'up', href: '/contacts?leadDateScope=current&status=New+Lead' },
    ];
  }, [canReadFinancials, currentBusinessUnit, dashboardSummary?.kpis?.inProgressWorkOrders, isAdminView, kpis, workOrders]);

  const unassignedLeadFollowUps = useMemo(
    () => (isAdminView ? tasks.filter(isUnassignedInboundLeadFollowUp) : []),
    [isAdminView, tasks],
  );
  const unassignedFacebookFollowUps = useMemo(
    () => unassignedLeadFollowUps.filter(isFacebookLeadFollowUp),
    [unassignedLeadFollowUps],
  );

  const sourceHealth = useMemo(() => {
    const websiteLeads = dashboardSummary?.sourceHealth?.websiteLeads ?? contacts.filter((contact) => /website|web|wix/i.test(`${contact.source || ''} ${contact.sourceLabel || ''}`)).length;
    const facebookTasks = tasks.filter(isFacebookLeadFollowUp).length;
    return [
      { label: 'Website leads', status: websiteLeads ? `${websiteLeads} active` : 'Low data', tone: websiteLeads ? 'success' : 'muted' },
      { label: 'Facebook Lead Ads', status: facebookTasks ? 'Needs routing' : 'Attribution review', tone: facebookTasks ? 'warning' : 'muted' },
      { label: 'Messenger', status: 'Connected where configured', tone: 'success' },
      { label: 'SMS / 10DLC', status: 'Pending', tone: 'warning' },
    ];
  }, [contacts, dashboardSummary?.sourceHealth?.websiteLeads, tasks]);

  const dashboardDueTodayTasks = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    return myTasks
      .filter((task) => isOpenTask(task) && taskDueKey(task) === todayKey)
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  }, [myTasks]);

  const dashboardCompletedTodayTasks = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    return myTasks
      .filter((task) => isTaskCompletedToday(task, todayKey))
      .sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')))
      .slice(0, 5);
  }, [myTasks]);

  const dashboardCalendarEvents = useMemo(() => {
    const taskEvents = buildTaskCalendarEvents(myTasks);
    return [...calendarEvents, ...taskEvents];
  }, [calendarEvents, myTasks]);

  const createDashboardTask = useCallback(async (draft) => {
    if (!access.canWriteCrm) throw new Error('CRM write access is required.');
    const ownerUserId = currentUser?.id || '';
    if (!ownerUserId) throw new Error('Sign in again before creating a task.');
    if (dataSource !== 'postgres') {
      addTask({ ...draft, assignedTo: ownerUserId, ownerUserId });
      toast('Task created');
      return;
    }

    const taskBusinessUnitId = currentBusinessUnit?.id;
    if (!taskBusinessUnitId || taskBusinessUnitId === 'all' || taskBusinessUnitId === 'unassigned') {
      throw new Error('Select a division before creating a task.');
    }

    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: draft.title,
        businessUnitId: taskBusinessUnitId,
        dueAt: dateInputToIso(draft.dueDate),
        ownerUserId,
        taskType: 'manual_reminder',
        priority: 'medium',
        sourceType: 'manual',
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Task could not be created.');
    addTask({
      ...payload.task,
      assignedTo: payload.task.ownerUserId || '',
      dueDate: (payload.task.dueAt || '').slice(0, 10),
      completed: payload.task.status === 'completed',
      priority: 'Medium',
      taskStatus: payload.task.status,
    });
    toast('Task created');
  }, [access.canWriteCrm, addTask, currentBusinessUnit?.id, currentUser?.id, dataSource, toast]);

  if (
    !loaded ||
    (dataSource === 'postgres' && !tasksLoaded && !tasksError) ||
    (dashboardSummaryIsDeferred && !dashboardSummaryLoaded && !dashboardSummaryError)
  ) {
    return <PageState tone="loading" title="Loading dashboard" copy="Preparing your current tasks, contacts, and division summary." />;
  }

  if (dataSource === 'postgres' && tasksError) {
    return (
      <PageState
        tone="error"
        title="Dashboard tasks could not load"
        copy={tasksError}
        actions={<button className="btn btn-primary" onClick={() => loadTasks({ force: true }).catch(() => null)}>Try again</button>}
      />
    );
  }

  if (dashboardSummaryIsDeferred && dashboardSummaryError) {
    return (
      <PageState
        tone="error"
        title="Dashboard summary could not load"
        copy={dashboardSummaryError}
        actions={<button className="btn btn-primary" onClick={() => loadDashboardSummary({
          businessUnitId: currentBusinessUnit?.id,
          employeeIds: employees.map((employee) => employee.id).filter(Boolean),
          force: true,
        }).catch(() => null)}>Try again</button>}
      />
    );
  }

  const today = new Date();
  const greeting = today.getHours() < 12 ? 'Good morning' : today.getHours() < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">{greeting}</h1>
          <p className="page-subtitle">
            {today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            {' '}· {currentBusinessUnit?.name || `All ${scopeLabel}`}
          </p>
        </div>
        <span className={`badge ${isAdminView ? 'badge-won' : 'badge-contacted'}`} style={{fontSize:'var(--text-sm)',padding:'4px 12px'}}>{isAdminView ? 'Admin View' : 'Employee View'}</span>
      </div>

      {dataSource === 'postgres' && access.canReadImportReview && importStaging?.latestBatch && (
        <div className="card" style={{marginBottom:20, padding:16}}>
          <div className="flex-between" style={{alignItems:'flex-start', gap:16}}>
            <div>
              <div className="card-title" style={{marginBottom:4}}>AIT Signs import staging</div>
              <p className="page-subtitle" style={{margin:0}}>
                {importStaging.counts.sourceRows.toLocaleString()} source rows staged from {importStaging.latestBatch.fileName}
              </p>
            </div>
            <div className="flex-gap" style={{flexWrap:'wrap', justifyContent:'flex-end'}}>
              <span className="badge badge-contacted">{importStaging.counts.normalizedRecords.toLocaleString()} normalized</span>
              <span className="badge badge-qualified">{importStaging.counts.reviewItems.toLocaleString()} review</span>
              <span className="badge badge-pending">{importStaging.latestBatch.status}</span>
              <Link className="btn btn-sm btn-primary" href="/import-review">
                Open review queue
              </Link>
            </div>
          </div>
        </div>
      )}

      {unassignedLeadFollowUps.length > 0 && (
        <div className="card" style={{marginBottom:20, padding:16, borderColor:'color-mix(in srgb, var(--warning) 42%, var(--border-subtle))'}}>
          <div className="flex-between" style={{alignItems:'flex-start', gap:16}}>
            <div>
              <div className="card-title" style={{marginBottom:4}}>Unassigned lead follow-ups</div>
              <p className="page-subtitle" style={{margin:0}}>
                {unassignedLeadFollowUps.length} new lead follow-up{unassignedLeadFollowUps.length === 1 ? '' : 's'} need an owner
                {unassignedFacebookFollowUps.length ? ` · ${unassignedFacebookFollowUps.length} from Facebook` : ''}.
              </p>
            </div>
            <div className="flex-gap" style={{justifyContent:'flex-end'}}>
              <Link className="btn btn-sm btn-primary" href="/tasks?ownerUserId=unassigned&taskType=follow_up&status=open">
                <ListTodo size={14} />
                Review queue
              </Link>
              <Link className="btn btn-sm" href="/tasks?ownerUserId=unassigned&taskType=follow_up&status=open&due=work">
                <UserPlus size={14} />
                Assign follow-ups
              </Link>
            </div>
          </div>
        </div>
      )}

      {dataSource === 'postgres' && access.canReadImportReview && !importStaging?.latestBatch && !dashboardSummaryIsDeferred && contacts.length === 0 && (
        <div className="card" style={{marginBottom:20, padding:16, borderColor:'var(--accent)'}}>
          <div className="card-title" style={{marginBottom:4}}>Getting started with AIT Signs CRM</div>
          <p className="page-subtitle" style={{margin:0, marginBottom:16}}>
            Your database is connected but currently empty. To get started, run the data pipeline scripts to ingest the legacy AIT Signs workbook:
          </p>
          <div style={{background:'var(--bg-tertiary)', padding:12, borderRadius:'var(--radius-md)', border:'1px solid var(--border-subtle)', fontFamily:'monospace', fontSize:'var(--text-xs)', display:'flex', flexDirection:'column', gap:8}}>
            <div>1. Extract: <code style={{background:'var(--bg-primary)', padding:'2px 4px', borderRadius:4, color:'var(--text-primary)'}}>npm run db:extract</code></div>
            <div>2. Load: <code style={{background:'var(--bg-primary)', padding:'2px 4px', borderRadius:4, color:'var(--text-primary)'}}>npm run db:load</code></div>
            <div>3. Promote: <code style={{background:'var(--bg-primary)', padding:'2px 4px', borderRadius:4, color:'var(--text-primary)'}}>npm run db:promote</code></div>
          </div>
        </div>
      )}

      <div className="dashboard-kpi-grid" style={{marginBottom:20}}>
        {dashboardKpiCards.map((card) => (
          <KPICard
            key={card.label}
            label={card.label}
            value={card.value}
            change={card.change}
            trend={card.trend}
            href={card.href}
          />
        ))}
      </div>

      {canUseTeamMonitorView ? (
        <>
          <div className={monitorStyles.dashboardLayout}>
            <TeamMonitorPreview
              employees={employees}
              tasks={tasks}
              contacts={contacts}
              currentUser={monitorCurrentUser}
              businessMovement={dashboardSummary?.businessMovement || null}
            />
            <aside className={monitorStyles.rightRail}>
              <section className={monitorStyles.railCard}>
                <div className={monitorStyles.railTitle}>Calendar</div>
                <Calendar events={calendarEvents} />
              </section>
              <section className={monitorStyles.railCard}>
                <div className={monitorStyles.railTitle}>Source Health</div>
                <div className={monitorStyles.sourceList}>
                  {sourceHealth.map((item) => (
                    <div key={item.label} className={monitorStyles.sourceItem}>
                      <strong>{item.label}</strong>
                      <span className={item.tone === 'success' ? 'badge badge-completed' : item.tone === 'warning' ? 'badge badge-pending' : 'badge'}>
                        {item.status}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </aside>
          </div>
          <DashboardTasksPanel
            tasks={tasks}
            employees={employees}
            currentUser={monitorCurrentUser}
          />
        </>
      ) : (
        <div className="dashboard-panel-grid" style={{marginBottom:20}}>
          <div className="card">
            <div className="flex-between" style={{marginBottom:12, gap:12}}>
              <div className="card-title" style={{marginBottom:0}}>Tasks</div>
              <Link className="btn btn-sm" href="/tasks">Open tasks</Link>
            </div>
            <TaskList
              tasks={dashboardDueTodayTasks}
              onToggle={(id, u) => updateTask(id, u)}
              onAdd={createDashboardTask}
              employees={employees}
              canAdd={Boolean(access.canWriteCrm)}
              fixedOwnerId={currentUser?.id || ''}
              ownerRequired
              showOwnerSelect={false}
              emptyText="No tasks due today."
            />
            {dashboardCompletedTodayTasks.length > 0 && (
              <div style={{marginTop:14, paddingTop:12, borderTop:'1px solid var(--border-subtle)'}}>
                <div className="flex-between" style={{marginBottom:8, gap:8}}>
                  <div style={{fontSize:'var(--text-xs)', color:'var(--text-secondary)', fontWeight:700, textTransform:'uppercase', letterSpacing:0}}>
                    Done today
                  </div>
                  <span className="badge badge-completed">{dashboardCompletedTodayTasks.length}</span>
                </div>
                <div style={{display:'grid', gap:8}}>
                  {dashboardCompletedTodayTasks.map((task) => (
                    <div
                      key={`dashboard-completed-${task.id}`}
                      style={{
                        display:'flex',
                        alignItems:'center',
                        justifyContent:'space-between',
                        gap:10,
                        padding:'8px 10px',
                        border:'1px solid var(--border-subtle)',
                        borderRadius:'var(--radius-md)',
                        background:'var(--bg-secondary)',
                      }}
                    >
                      <span style={{fontSize:'var(--text-sm)', color:'var(--text-primary)', fontWeight:650, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                        {task.title || 'Untitled task'}
                      </span>
                      <span className="badge badge-completed">Done</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="card">
            <div className="card-title">Calendar</div>
            <Calendar events={dashboardCalendarEvents} />
          </div>
        </div>
      )}
    </div>
  );
}
