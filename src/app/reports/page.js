'use client';
import { useState, useMemo } from 'react';
import { useCRM } from '@/lib/store';
import KPICard from '@/components/KPICard';
import { BarChart, PieChart, ChartLegend } from '@/components/Charts';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function ReportsPage() {
  const { financials, contacts, workOrders, businessUnits, loaded, role, currentBusinessUnit, scopeLabel } = useCRM();
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());

  const report = useMemo(() => {
    const invoices = financials.filter(f => f.type === 'Invoice');
    const paidInvoices = invoices.filter(f => f.status === 'Paid');
    const totalRevenue = paidInvoices.reduce((s, f) => s + f.amount, 0);
    const totalInvoiced = invoices.reduce((s, f) => s + f.amount, 0);
    const pendingEstimates = financials.filter(f => f.type === 'Estimate' && f.status === 'Pending');
    const pipelineValue = pendingEstimates.reduce((s, f) => s + f.amount, 0);
    const overdueInvoices = invoices.filter(f => f.status === 'Overdue');
    const overdueAmount = overdueInvoices.reduce((s, f) => s + f.amount, 0);
    return { totalRevenue, totalInvoiced, pipelineValue, overdueAmount, pendingEstimates: pendingEstimates.length, overdueCount: overdueInvoices.length };
  }, [financials]);

  const monthlyRevenue = useMemo(() => {
    const currentMonth = new Date().getMonth();
    return SHORT.map((m, i) => {
      const seed = (i + 1) * 1234.56;
      const base = Math.floor((seed % 6000) + 3000);
      const val = i === currentMonth ? report.totalRevenue : base;
      return { label: m, value: val, color: i === selectedMonth ? '#4a7aff' : '#4a7aff60' };
    });
  }, [report.totalRevenue, selectedMonth]);

  const statusBreakdown = useMemo(() => {
    const inv = financials.filter(f => f.type === 'Invoice');
    const paid = inv.filter(f => f.status === 'Paid').length;
    const pending = inv.filter(f => f.status === 'Pending').length;
    const overdue = inv.filter(f => f.status === 'Overdue').length;
    return [
      { label: 'Paid', value: paid, color: '#22c55e' },
      { label: 'Pending', value: pending, color: '#eab308' },
      { label: 'Overdue', value: overdue, color: '#ef4444' },
    ];
  }, [financials]);

  const sourceBreakdown = useMemo(() => {
    const counts = {};
    contacts.forEach(c => { counts[c.source] = (counts[c.source] || 0) + 1; });
    const colors = { 'Facebook Ads': '#4a7aff', 'Website': '#22c55e', 'Referral': '#a78bfa', 'Cold Call': '#eab308', 'Google Ads': '#ef4444' };
    return Object.entries(counts).map(([label, value]) => ({ label, value, color: colors[label] || '#71717a' }));
  }, [contacts]);

  const divisionBreakdown = useMemo(() => {
    const unitCounts = new Map((businessUnits || []).map((unit) => [unit.id, { label: unit.name, value: 0, color: unit.color || '#71717a' }]));
    contacts.forEach((contact) => {
      const id = contact.businessUnitId || contact.primaryBusinessUnitId;
      if (!id) return;
      const current = unitCounts.get(id);
      if (current) current.value += 1;
    });
    return [...unitCounts.values()].filter((entry) => entry.value > 0);
  }, [businessUnits, contacts]);

  const exportCSV = () => {
    const rows = [['Type','Number','Client','Amount','Status','Date']];
    financials.forEach(f => rows.push([f.type, f.number, f.client, f.amount, f.status, f.date]));
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `financial_report_${MONTHS[selectedMonth]}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (!loaded) return <div className="empty-state">Loading...</div>;
  if (role !== 'admin') return <div className="empty-state">Reports are admin-only in v1.</div>;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">Monthly financial snapshot & analytics for {currentBusinessUnit?.name || `all ${scopeLabel.toLowerCase()}`}</p>
        </div>
        <div className="flex-gap">
          <select className="input select" style={{width:'auto'}} value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          {role === 'admin' && <button className="btn" onClick={exportCSV} data-tooltip="Sample feature — exports monthly report to CSV">Export CSV</button>}
          <button className="btn btn-primary" onClick={() => window.print()}>Print Report</button>
        </div>
      </div>

      <div className="card" style={{marginBottom:20}}>
        <div className="card-title">Sample Data Notice</div>
        <p className="page-subtitle" style={{margin:0}}>
          Financials and reports are intentionally unfinished for v1. Metrics here are sample/demo until the post-v1 accounting phase.
        </p>
      </div>

      <div className="grid-4" style={{marginBottom:20}}>
        <KPICard label="Total Revenue" value={`$${report.totalRevenue.toLocaleString()}`} change="From paid invoices" trend="up" />
        <KPICard label="Pipeline Value" value={`$${report.pipelineValue.toLocaleString()}`} change={`${report.pendingEstimates} pending`} trend="up" />
        <KPICard label="Total Invoiced" value={`$${report.totalInvoiced.toLocaleString()}`} />
        <KPICard label="Overdue Amount" value={`$${report.overdueAmount.toLocaleString()}`} change={`${report.overdueCount} invoices`} trend="down" />
      </div>

      <div className="grid-2" style={{marginBottom:20}}>
        <div className="card">
          <div className="card-title">Revenue by Month</div>
          <BarChart data={monthlyRevenue} width={500} height={220} />
        </div>
        <div className="card">
          <div className="card-title" style={{marginBottom:16}}>Invoice Status</div>
          <div style={{display:'flex',alignItems:'center',gap:32,justifyContent:'center',flexWrap:'wrap'}}>
            <PieChart data={statusBreakdown} size={160} />
            <ChartLegend data={statusBreakdown} />
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title" style={{marginBottom:16}}>Lead Sources</div>
          <div style={{display:'flex',alignItems:'center',gap:32,justifyContent:'center',flexWrap:'wrap'}}>
            <PieChart data={sourceBreakdown} size={160} />
            <ChartLegend data={sourceBreakdown} />
          </div>
        </div>
        <div className="card">
          <div className="card-title" style={{marginBottom:16}}>{scopeLabel} Mix</div>
          {divisionBreakdown.length ? (
            <div style={{display:'flex',alignItems:'center',gap:32,justifyContent:'center',flexWrap:'wrap'}}>
              <PieChart data={divisionBreakdown} size={160} />
              <ChartLegend data={divisionBreakdown} />
            </div>
          ) : (
            <div className="empty-state">No {scopeLabel.toLowerCase()} data in the selected scope.</div>
          )}
        </div>
      </div>

      <div className="grid-2" style={{marginTop:20}}>
        <div className="card">
          <div className="card-title">Quick Stats</div>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <div className="flex-between"><span style={{color:'var(--text-secondary)',fontSize:'var(--text-sm)'}}>Total Contacts</span><span style={{fontWeight:600}}>{contacts.length}</span></div>
            <div className="flex-between"><span style={{color:'var(--text-secondary)',fontSize:'var(--text-sm)'}}>Active Work Orders</span><span style={{fontWeight:600}}>{workOrders.filter(w=>w.status!=='Completed').length}</span></div>
            <div className="flex-between"><span style={{color:'var(--text-secondary)',fontSize:'var(--text-sm)'}}>Won Deals</span><span style={{fontWeight:600}}>{contacts.filter(c=>c.status==='Won').length}</span></div>
            <div className="flex-between"><span style={{color:'var(--text-secondary)',fontSize:'var(--text-sm)'}}>Conversion Rate</span><span style={{fontWeight:600}}>{contacts.length ? Math.round(contacts.filter(c=>c.status==='Won').length/contacts.length*100) : 0}%</span></div>
            <div className="flex-between"><span style={{color:'var(--text-secondary)',fontSize:'var(--text-sm)'}}>Avg Invoice Value</span><span style={{fontWeight:600}}>${financials.filter(f=>f.type==='Invoice').length ? Math.round(financials.filter(f=>f.type==='Invoice').reduce((s,f)=>s+f.amount,0)/financials.filter(f=>f.type==='Invoice').length).toLocaleString() : 0}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
