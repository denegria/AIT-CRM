'use client';
import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useCRM } from '@/lib/store';
import KPICard from '@/components/KPICard';
import TaskList from '@/components/TaskList';
import Calendar from '@/components/Calendar';
import { BarChart, PieChart, ChartLegend } from '@/components/Charts';
import { useToast } from '@/components/Toast';

function dateInputToIso(value) {
  if (!value) return null;
  const date = new Date(`${value}T09:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
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
  const currentUserId = currentUser?.id || 'emp-1';
  const isAdminView = role === 'admin' || Boolean(currentUser?.canAccessAllBusinessUnits);
  const canReadFinancials = Boolean(access?.canReadFinancials);
  const dashboardTaskOwners = useMemo(() => {
    if (dataSource === 'postgres') {
      return currentUser?.id
        ? [{ id: currentUser.id, name: currentUser.name || currentUser.email || 'Me', email: currentUser.email || '' }]
        : [];
    }
    return employees || [];
  }, [currentUser, dataSource, employees]);

  const kpis = useMemo(() => {
    const invoices = financials.filter(f => f.type === 'Invoice');
    const totalRevenue = invoices.filter(f => f.status === 'Paid').reduce((s, f) => s + f.amount, 0);
    const pipeline = financials.filter(f => f.type === 'Estimate' && f.status !== 'Draft').reduce((s, f) => s + f.amount, 0);
    const totalInvoiced = invoices.reduce((s, f) => s + f.amount, 0);
    const activeWOs = workOrders.filter(w => w.status !== 'Completed').length;
    const newLeads = contacts.filter(c => c.status === 'New Lead').length;
    
    // Employee Specific
    const myTasksCount = tasks.filter(t => (t.ownerUserId || t.assignedTo) === currentUserId && !t.completed).length;
    const needsFollowUp = contacts.filter(c => c.status !== 'Won' && c.status !== 'Lost').length;
    const pendingInvoices = invoices.filter(f => f.status === 'Pending').length;
    const assignedWOs = workOrders.filter(w => w.assignedTo === currentUserId && w.status !== 'Completed').length;
    const myPipeline = contacts.filter(c => c.assignedTo === currentUserId && c.status !== 'Won' && c.status !== 'Lost').length;

    return { totalRevenue, pipeline, totalInvoiced, activeWOs, newLeads, myTasksCount, needsFollowUp, pendingInvoices, assignedWOs, myPipeline };
  }, [financials, workOrders, contacts, tasks, currentUserId]);

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

  const empProgress = useMemo(() => {
    return employees.map(emp => {
      const t = tasks.filter(tk => tk.assignedTo === emp.id);
      const done = t.filter(tk => tk.completed).length;
      return { ...emp, total: t.length, done, leads: contacts.filter(c => c.assignedTo === emp.id).length };
    });
  }, [employees, tasks, contacts]);

  const followUpStats = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const openTasks = tasks.filter(t => !t.completed && !['completed', 'canceled'].includes(t.taskStatus || t.status || ''));
    const dueToday = openTasks.filter(t => (t.dueDate || t.dueAt || '').slice(0, 10) === todayKey).length;
    const overdue = openTasks.filter(t => {
      const due = (t.dueDate || t.dueAt || '').slice(0, 10);
      return due && due < todayKey;
    }).length;
    const unassigned = openTasks.filter(t => !(t.assignedTo || t.ownerUserId)).length;
    return { open: openTasks.length, dueToday, overdue, unassigned };
  }, [tasks]);

  const createDashboardTask = useCallback(async (draft) => {
    if (!access.canWriteCrm) throw new Error('CRM write access is required.');
    if (dataSource !== 'postgres') {
      addTask(draft);
      toast('Task created');
      return;
    }

    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: draft.title,
        dueAt: dateInputToIso(draft.dueDate),
        ownerUserId: draft.ownerUserId || null,
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
  }, [access.canWriteCrm, addTask, dataSource, toast]);

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

      {dataSource === 'postgres' && !importStaging?.latestBatch && contacts.length === 0 && (
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

      {isAdminView ? (
        <div className="dashboard-kpi-grid" style={{marginBottom:20}}>
          <KPICard label="Total Revenue" value={`$${kpis.totalRevenue.toLocaleString()}`} change="12% vs last month" trend="up" />
          <KPICard label="Pipeline Value" value={`$${kpis.pipeline.toLocaleString()}`} change={`${financials.filter(f=>f.type==='Estimate'&&f.status==='Pending').length} estimates`} trend="up" />
          <KPICard label="Active Work Orders" value={kpis.activeWOs} change={`${workOrders.filter(w=>w.status==='In Progress').length} in progress`} trend="up" />
          <KPICard label="New Leads" value={kpis.newLeads} change="This week" trend="up" />
        </div>
      ) : (
        <div className="dashboard-kpi-grid" style={{marginBottom:20}}>
          <KPICard label="My Active Tasks" value={kpis.myTasksCount} change="Due soon" trend="up" />
          <KPICard label="Needs Follow Up" value={kpis.needsFollowUp} change="Active leads" trend="up" />
          {canReadFinancials
            ? <KPICard label="Invoices Pending" value={kpis.pendingInvoices} change="Action required" trend="down" />
            : <KPICard label="My Pipeline" value={kpis.myPipeline} change="Assigned active leads" trend="up" />}
          <KPICard label="Assigned Work Orders" value={kpis.assignedWOs} change="In progress" trend="up" />
        </div>
      )}

      <div className="card dashboard-action-card" style={{marginBottom:20, padding:16}}>
        <div className="flex-between" style={{alignItems:'flex-start', gap:16}}>
          <div>
            <div className="card-title" style={{marginBottom:4}}>Task snapshot</div>
            <p className="page-subtitle" style={{margin:0}}>
              {followUpStats.open} open · {followUpStats.dueToday} due today · {followUpStats.overdue} overdue · {followUpStats.unassigned} unassigned
            </p>
          </div>
          <Link className="btn btn-sm btn-primary" href="/tasks">
            Open tasks
          </Link>
        </div>
      </div>

      <div className="dashboard-panel-grid" style={{marginBottom:20}}>
        <div className="card">
          <div className="flex-between" style={{marginBottom:12, gap:12}}>
            <div className="card-title" style={{marginBottom:0}}>Tasks</div>
            <Link className="btn btn-sm" href="/tasks">Detailed task page</Link>
          </div>
          <TaskList
            tasks={myTasks}
            onToggle={(id, u) => updateTask(id, u)}
            onAdd={createDashboardTask}
            employees={employees}
            owners={dashboardTaskOwners}
            canAdd={Boolean(access.canWriteCrm)}
          />
        </div>
        <div className="card">
          <div className="card-title">Calendar</div>
          <Calendar events={calendarEvents} />
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
