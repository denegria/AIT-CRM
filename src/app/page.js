'use client';
import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { ListTodo, UserPlus } from 'lucide-react';
import { useCRM } from '@/lib/store';
import KPICard from '@/components/KPICard';
import TaskList from '@/components/TaskList';
import Calendar from '@/components/Calendar';
import { BarChart, PieChart, ChartLegend } from '@/components/Charts';
import { useToast } from '@/components/Toast';
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
  } = useCRM();
  const { toast } = useToast();
  const [dashboardNow] = useState(() => Date.now());
  const currentUserId = currentUser?.id || 'emp-1';
  const isAdminView = role === 'admin' || Boolean(currentUser?.canAccessAllBusinessUnits);
  const canReadFinancials = Boolean(access?.canReadFinancials);

  const kpis = useMemo(() => {
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
    const unassignedLeadFollowUps = tasks.filter(isUnassignedInboundLeadFollowUp);
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
    const signsFirstOutreach = filterContactsByDirectoryFacet(aitSignsCurrentContacts, 'needs_first_outreach', { currentUserId, now }).filter(isAitSigns).length;
    const pendingEstimates = financials.filter(isPendingEstimate);
    const pendingEstimateValue = pendingEstimates.reduce((sum, record) => sum + Number(record.amount || 0), 0);
    const usaNewLeads = filterContactsByDirectoryFacet(aitUsaContacts, 'usa_new_lead', { currentUserId, now }).length;
    const usaFollowUp = filterContactsByDirectoryFacet(aitUsaContacts, 'usa_follow_up', { currentUserId, now }).length;
    const usaFirstOutreach = filterContactsByDirectoryFacet(aitUsaContacts, 'needs_first_outreach', { currentUserId, now }).filter(isAitUsa).length;
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
      usaFirstOutreach,
      usaBadContactChannel,
    };
  }, [contacts, currentUserId, dashboardNow, financials, isAdminView, tasks, workOrders]);

  const statusData = useMemo(() => {
    const counts = {};
    financials.filter(f => f.type === 'Invoice').forEach(f => { counts[f.status] = (counts[f.status] || 0) + 1; });
    return [
      { label: 'Paid', value: counts['Paid'] || 0, color: '#22c55e' },
      { label: 'Pending', value: counts['Pending'] || 0, color: '#eab308' },
      { label: 'Overdue', value: counts['Overdue'] || 0, color: '#ef4444' },
    ];
  }, [financials]);

  const revenueByMonth = useMemo(() => {
    const months = ['Jan','Feb','Mar','Apr','May','Jun'];
    return months.map((m, i) => {
      // Deterministic "mock" growth: base 4k + (i * 1.5k) + minor variation based on month index
      const seedVal = 4000 + (i * 1200) + ((i * 313) % 800);
      return {
        label: m, 
        value: seedVal + (i === new Date().getMonth() ? kpis.totalRevenue : 0), 
        color: '#4a7aff'
      };
    });
  }, [kpis.totalRevenue]);

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
        { label: 'Current Leads', value: kpis.usaNewLeads + kpis.usaFollowUp, change: 'Enrollment pipeline', trend: 'up', href: '/contacts?leadDateScope=current&facet=usa_new_lead' },
        { label: 'Follow-ups Due', value: kpis.usaFollowUp, change: `${kpis.usaFirstOutreach} first outreach`, trend: 'up', href: '/contacts?leadDateScope=current&facet=usa_follow_up' },
        { label: 'Bad Contact Channel', value: kpis.usaBadContactChannel, change: 'Needs cleanup', trend: kpis.usaBadContactChannel ? 'down' : 'up', href: '/contacts?leadDateScope=current&facet=usa_bad_contact_channel' },
      ];
    }

    if (workflowKey === WORKFLOW_KEYS.AIT_SIGNS) {
      const signsLeadCard = kpis.signsFirstOutreach
        ? { label: 'Needs First Outreach', value: kpis.signsFirstOutreach, change: `${kpis.signsIntake} in intake`, trend: 'up', href: '/contacts?leadDateScope=current&facet=needs_first_outreach' }
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
      { label: 'Open Work Orders', value: kpis.activeWOs, change: `${workOrders.filter(w=>w.status==='In Progress').length} in progress`, trend: 'up', href: '/work-orders?status=open' },
      canReadFinancials
        ? { label: 'Pending Estimates', value: moneyLabel(kpis.pendingEstimateValue), change: `${kpis.pendingEstimates} estimates`, trend: 'up', href: '/financials' }
        : { label: 'Needs First Outreach', value: kpis.needsFirstOutreach, change: 'Ready to assign', trend: 'up', href: '/contacts?leadDateScope=current&facet=needs_first_outreach' },
    ];
  }, [canReadFinancials, currentBusinessUnit, isAdminView, kpis, workOrders]);

  const unassignedLeadFollowUps = useMemo(
    () => tasks.filter(isUnassignedInboundLeadFollowUp),
    [tasks],
  );
  const unassignedFacebookFollowUps = useMemo(
    () => unassignedLeadFollowUps.filter(isFacebookLeadFollowUp),
    [unassignedLeadFollowUps],
  );

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

  const empProgress = useMemo(() => {
    return employees.map(emp => {
      const t = tasks.filter(tk => tk.assignedTo === emp.id);
      const done = t.filter(tk => tk.completed).length;
      return { ...emp, total: t.length, done, leads: contacts.filter(c => c.assignedTo === emp.id).length };
    });
  }, [employees, tasks, contacts]);

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

  if (!loaded) return <div className="empty-state">Loading...</div>;

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

      {dataSource === 'postgres' && access.canReadImportReview && !importStaging?.latestBatch && contacts.length === 0 && (
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

      {isAdminView && (
        <div className="dashboard-panel-grid" style={{marginBottom:20}}>
          <div className="card">
            <div className="card-title">Revenue Trend</div>
            <BarChart data={revenueByMonth} width={400} height={200} />
          </div>
          <div className="card">
            <div className="flex-between" style={{marginBottom:12}}>
              <div className="card-title" style={{marginBottom:0}}>Invoice Status</div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:24,flexWrap:'wrap',justifyContent:'center'}}>
              <PieChart data={statusData} size={140} />
              <ChartLegend data={statusData} />
            </div>
          </div>
        </div>
      )}

      {isAdminView && (
        <div className="card">
          <div className="card-title">Employee Progress</div>
          <div className="responsive-table">
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr>
                <th style={{textAlign:'left',padding:'6px 12px',fontSize:'var(--text-xs)',color:'var(--text-muted)',borderBottom:'1px solid var(--border-subtle)',fontWeight:600}}>Employee</th>
                <th style={{textAlign:'left',padding:'6px 12px',fontSize:'var(--text-xs)',color:'var(--text-muted)',borderBottom:'1px solid var(--border-subtle)',fontWeight:600}}>Tasks</th>
                <th style={{textAlign:'left',padding:'6px 12px',fontSize:'var(--text-xs)',color:'var(--text-muted)',borderBottom:'1px solid var(--border-subtle)',fontWeight:600}}>Completed</th>
                <th style={{textAlign:'left',padding:'6px 12px',fontSize:'var(--text-xs)',color:'var(--text-muted)',borderBottom:'1px solid var(--border-subtle)',fontWeight:600}}>Leads</th>
                <th style={{textAlign:'left',padding:'6px 12px',fontSize:'var(--text-xs)',color:'var(--text-muted)',borderBottom:'1px solid var(--border-subtle)',fontWeight:600}}>Progress</th>
              </tr></thead>
              <tbody>
                {empProgress.map(emp => (
                  <tr key={emp.id}>
                    <td style={{padding:'8px 12px',fontSize:'var(--text-sm)',borderBottom:'1px solid var(--border-subtle)'}}>{emp.name}</td>
                    <td style={{padding:'8px 12px',fontSize:'var(--text-sm)',color:'var(--text-secondary)',borderBottom:'1px solid var(--border-subtle)'}}>{emp.total}</td>
                    <td style={{padding:'8px 12px',fontSize:'var(--text-sm)',color:'var(--text-secondary)',borderBottom:'1px solid var(--border-subtle)'}}>{emp.done}</td>
                    <td style={{padding:'8px 12px',fontSize:'var(--text-sm)',color:'var(--text-secondary)',borderBottom:'1px solid var(--border-subtle)'}}>{emp.leads}</td>
                    <td style={{padding:'8px 12px',borderBottom:'1px solid var(--border-subtle)'}}>
                      <div style={{width:100,height:6,background:'var(--bg-hover)',borderRadius:3,overflow:'hidden'}}>
                        <div style={{width:`${emp.total?Math.round(emp.done/emp.total*100):0}%`,height:'100%',background:'var(--accent)',borderRadius:3,transition:'width 0.3s ease'}} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
