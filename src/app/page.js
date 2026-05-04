'use client';
import { useMemo } from 'react';
import { useCRM } from '@/lib/store';
import KPICard from '@/components/KPICard';
import TaskList from '@/components/TaskList';
import Calendar from '@/components/Calendar';
import { BarChart, PieChart, ChartLegend } from '@/components/Charts';

export default function Dashboard() {
  const { role, contacts, workOrders, financials, tasks, calendarEvents, employees, updateTask, addTask, loaded } = useCRM();

  const kpis = useMemo(() => {
    const invoices = financials.filter(f => f.type === 'Invoice');
    const totalRevenue = invoices.filter(f => f.status === 'Paid').reduce((s, f) => s + f.amount, 0);
    const pipeline = financials.filter(f => f.type === 'Estimate' && f.status !== 'Draft').reduce((s, f) => s + f.amount, 0);
    const totalInvoiced = invoices.reduce((s, f) => s + f.amount, 0);
    const activeWOs = workOrders.filter(w => w.status !== 'Completed').length;
    const newLeads = contacts.filter(c => c.status === 'New Lead').length;
    return { totalRevenue, pipeline, totalInvoiced, activeWOs, newLeads };
  }, [financials, workOrders, contacts]);

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
    return months.map((m, i) => ({
      label: m, value: Math.floor(Math.random() * 8000 + 4000) + (i === new Date().getMonth() ? kpis.totalRevenue : 0), color: '#4a7aff'
    }));
  }, [kpis.totalRevenue]);

  const myTasks = useMemo(() => {
    if (role === 'admin') return tasks;
    return tasks.filter(t => t.assignedTo === 'emp-1');
  }, [tasks, role]);

  const empProgress = useMemo(() => {
    return employees.map(emp => {
      const t = tasks.filter(tk => tk.assignedTo === emp.id);
      const done = t.filter(tk => tk.completed).length;
      return { ...emp, total: t.length, done, leads: contacts.filter(c => c.assignedTo === emp.id).length };
    });
  }, [employees, tasks, contacts]);

  if (!loaded) return <div className="empty-state">Loading...</div>;

  const today = new Date();
  const greeting = today.getHours() < 12 ? 'Good morning' : today.getHours() < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">{greeting}</h1>
          <p className="page-subtitle">{today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
        <span className={`badge ${role==='admin'?'badge-won':'badge-contacted'}`} style={{fontSize:'var(--text-sm)',padding:'4px 12px'}}>{role==='admin'?'Admin View':'Employee View'}</span>
      </div>

      <div className="grid-4" style={{marginBottom:20}}>
        <KPICard label="Total Revenue" value={`$${kpis.totalRevenue.toLocaleString()}`} change="12% vs last month" trend="up" />
        <KPICard label="Pipeline Value" value={`$${kpis.pipeline.toLocaleString()}`} change={`${financials.filter(f=>f.type==='Estimate'&&f.status==='Pending').length} estimates`} trend="up" />
        <KPICard label="Active Work Orders" value={kpis.activeWOs} change={`${workOrders.filter(w=>w.status==='In Progress').length} in progress`} trend="up" />
        <KPICard label="New Leads" value={kpis.newLeads} change="This week" trend="up" />
      </div>

      <div className="grid-2" style={{marginBottom:20}}>
        <div className="card">
          <div className="card-title">Tasks</div>
          <TaskList tasks={myTasks} onToggle={(id, u) => updateTask(id, u)} onAdd={addTask} employees={employees} />
        </div>
        <div className="card">
          <div className="card-title">Calendar</div>
          <Calendar events={calendarEvents} />
        </div>
      </div>

      {role === 'admin' && (
        <div className="grid-2" style={{marginBottom:20}}>
          <div className="card">
            <div className="card-title">Revenue Trend</div>
            <BarChart data={revenueByMonth} width={400} height={200} />
          </div>
          <div className="card">
            <div className="flex-between" style={{marginBottom:12}}>
              <div className="card-title" style={{marginBottom:0}}>Invoice Status</div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:24}}>
              <PieChart data={statusData} size={140} />
              <ChartLegend data={statusData} />
            </div>
          </div>
        </div>
      )}

      {role === 'admin' && (
        <div className="card">
          <div className="card-title">Employee Progress</div>
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
      )}
    </div>
  );
}
