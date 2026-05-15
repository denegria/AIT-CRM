'use client';
import { useState, useMemo } from 'react';
import { useCRM } from '@/lib/store';
import { useToast } from '@/components/Toast';
import DataTable from '@/components/DataTable';
import Modal from '@/components/Modal';
import { generateInvoicePDF, generateEstimatePDF, generateReceiptPDF } from '@/lib/pdf';

const types = ['Invoice', 'Estimate', 'Receipt'];
const emptyForm = { number:'', type:'Invoice', client:'', contactId:'', amount:0, date:'', dueDate:'', status:'Pending', items:[{desc:'',qty:1,rate:0}] };

export default function FinancialsPage() {
  const {
    financials,
    addFinancial,
    updateFinancial,
    deleteFinancial,
    contacts,
    loaded,
    role,
    accessibleBusinessUnits,
    currentBusinessUnitId,
    currentBusinessUnit,
    canUseConsolidatedScope,
    scopeLabel,
  } = useCRM();
  const { toast } = useToast();
  const [tab, setTab] = useState('Invoice');
  const [drawer, setDrawer] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const [selectedIds, setSelectedIds] = useState([]);

  const exportSelected = () => {
    const selected = financials.filter(f => selectedIds.includes(f.id));
    if (selected.length === 0) return;
    const rows = [['Type','Doc #','Client','Amount','Date','Due Date','Status']];
    selected.forEach(f => rows.push([f.type, f.number, f.client, f.amount, f.date, f.dueDate || '', f.status]));
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'financials_export.csv'; a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${selected.length} records`);
  };

  const filtered = useMemo(() => financials.filter(f => f.type === tab), [financials, tab]);

  const openNew = () => {
    const prefix = tab === 'Invoice' ? 'INV' : tab === 'Estimate' ? 'EST' : 'REC';
    const count = financials.filter(f => f.type === tab).length + 1;
    const businessUnitId = currentBusinessUnitId !== 'all' && currentBusinessUnitId !== 'unassigned' ? currentBusinessUnitId : accessibleBusinessUnits[0]?.id || '';
    setForm({ ...emptyForm, type: tab, number: `${prefix}-${String(count).padStart(3,'0')}`, businessUnitId, date: new Date().toISOString().slice(0,10) });
    setDrawer('new');
  };
  const openEdit = (row) => { setForm({ ...row }); setDrawer(row); };
  const close = () => setDrawer(null);
  const save = () => {
    if (!form.client.trim()) return;
    const total = form.items.reduce((s, it) => s + (it.qty||1)*(it.rate||0), 0);
    const data = { ...form, amount: total };
    if (drawer === 'new') {
      addFinancial(data);
      toast(`${tab} created`);
    } else {
      updateFinancial(drawer.id, data);
      toast(`${tab} updated`);
    }
    close();
  };

  const genPDF = (row) => {
    if (row.type === 'Invoice') generateInvoicePDF(row);
    else if (row.type === 'Estimate') generateEstimatePDF(row);
    else generateReceiptPDF(row);
    toast('PDF Generated');
  };

  const addItem = () => setForm(f => ({...f, items:[...f.items, {desc:'',qty:1,rate:0}]}));
  const updateItem = (idx, key, val) => setForm(f => ({...f, items: f.items.map((it,i) => i===idx ? {...it,[key]:val} : it)}));
  const removeItem = (idx) => setForm(f => ({...f, items: f.items.filter((_,i)=>i!==idx)}));

  const columns = [
    { key: 'number', label: 'Doc #', sortable: true },
    { key: 'client', label: 'Client', sortable: true },
    { key: 'divisionLabel', label: scopeLabel, sortable: true },
    { key: 'amount', label: 'Amount', type: 'currency', sortable: true },
    { key: 'date', label: 'Date', sortable: true },
    { key: 'status', label: 'Status', type: 'badge', sortable: true },
  ];
  if (tab !== 'Receipt') columns.splice(4, 0, { key: 'dueDate', label: 'Due Date', sortable: true });

  if (!loaded) return <div className="empty-state">Loading...</div>;
  if (role !== 'admin') return <div className="empty-state">Financials are admin-only in v1.</div>;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Financials</h1>
          <p className="page-subtitle">Manage estimates, invoices, and receipts for {currentBusinessUnit?.name || `all ${scopeLabel.toLowerCase()}`}</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ New {tab}</button>
      </div>

      <div className="card" style={{marginBottom:16}}>
        <div className="card-title">Sample Data Notice</div>
        <p className="page-subtitle" style={{margin:0}}>
          Financials and reporting are not v1 goals. Data on this page is sample/demo only until the post-v1 accounting phase.
        </p>
      </div>

      <div className="tabs">
        {types.map(t => (
          <button key={t} className={`tab ${tab===t?'tab-active':''}`} onClick={()=>{setTab(t); setSelectedIds([]);}}>
            {t}s <span style={{marginLeft:4,opacity:0.5}}>({financials.filter(f=>f.type===t).length})</span>
          </button>
        ))}
      </div>

      {filtered.length > 0 && (
        <div className="card" style={{padding:'12px 16px', marginBottom:16, display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12}}>
          <div style={{display:'flex', alignItems:'center', gap:20, flexWrap:'wrap'}}>
            <div>
              <span style={{fontSize:'var(--text-xs)', color:'var(--text-muted)', textTransform:'uppercase', fontWeight:700, letterSpacing:'0.05em'}}>
                {tab} Total
              </span>
              <div style={{fontSize:'var(--text-lg)', fontWeight:700, color:'var(--text-primary)'}}>
                ${filtered.reduce((sum, f) => sum + (f.amount || 0), 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
              </div>
            </div>
            <div style={{width:1, height:32, background:'var(--border-subtle)'}} />
            <div>
              <span style={{fontSize:'var(--text-xs)', color:'var(--text-muted)', textTransform:'uppercase', fontWeight:700, letterSpacing:'0.05em'}}>
                Count
              </span>
              <div style={{fontSize:'var(--text-lg)', fontWeight:700, color:'var(--text-primary)'}}>
                {filtered.length}
              </div>
            </div>
          </div>
          <div style={{display:'flex', gap:10, flexWrap:'wrap'}}>
            {['Paid', 'Pending', 'Overdue', 'Draft'].map(status => {
              const count = filtered.filter(f => f.status === status).length;
              if (count === 0) return null;
              const total = filtered.filter(f => f.status === status).reduce((s, f) => s + (f.amount || 0), 0);
              return (
                <div key={status} style={{textAlign:'center', minWidth:70}}>
                  <span className={`badge ${status==='Paid'?'badge-won':status==='Overdue'?'badge-lost':status==='Pending'?'badge-medium':'badge-pending'}`}>
                    {status}
                  </span>
                  <div style={{fontSize:'var(--text-sm)', fontWeight:600, marginTop:4}}>
                    ${total.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}
                    <span style={{fontSize:'var(--text-xs)', color:'var(--text-muted)', marginLeft:4}}>({count})</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card" style={{padding:16}}>
        <DataTable
          columns={columns}
          data={filtered.map((record) => ({
            ...record,
            divisionLabel: accessibleBusinessUnits.find((unit) => unit.id === record.businessUnitId)?.name || 'No Division',
          }))}
          searchPlaceholder={`Search ${tab.toLowerCase()}s...`}
          selectable
          selectedIds={selectedIds}
          onSelect={setSelectedIds}
          toolbarExtra={
            role === 'admin' && selectedIds.length > 0 && (
              <button className="btn fade-in" onClick={exportSelected} data-tooltip="Sample feature — exports selected rows to CSV">
                Export Selected ({selectedIds.length})
              </button>
            )
          }
          actions={[
            { label: 'Edit', onClick: openEdit },
            { label: 'PDF', onClick: genPDF },
            { label: 'Delete', onClick: (r) => { deleteFinancial(r.id); toast('Record deleted', 'error'); }, danger: true },
          ]}
        />
      </div>

      <Modal open={!!drawer} onClose={close} title={drawer==='new'?`New ${form.type}`:`Edit ${form.type}`}
        footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>}>
        <div className="grid-2">
          <div className="form-group">
            <label className="form-label">Document #</label>
            <input className="input" value={form.number} readOnly style={{opacity:0.6}} />
          </div>
          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="input select" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
              {['Draft','Pending','Paid','Overdue'].map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Client</label>
          <select className="input select" value={form.contactId} onChange={e=>{
            const c = contacts.find(ct=>ct.id===e.target.value);
            setForm(f=>({...f,contactId:e.target.value,client:c?.name||'',businessUnitId:c?.businessUnitId||c?.primaryBusinessUnitId||f.businessUnitId||''}));
          }}>
            <option value="">Select client</option>
            {contacts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">{scopeLabel}</label>
          <select className="input select" value={form.businessUnitId || ''} onChange={e=>setForm(f=>({...f,businessUnitId:e.target.value}))}>
            {canUseConsolidatedScope && <option value="">No Division</option>}
            {accessibleBusinessUnits.map(unit=><option key={unit.id} value={unit.id}>{unit.name}</option>)}
          </select>
        </div>
        <div className="grid-2">
          <div className="form-group">
            <label className="form-label">Date</label>
            <input className="input" type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} />
          </div>
          {form.type !== 'Receipt' && <div className="form-group">
            <label className="form-label">Due Date</label>
            <input className="input" type="date" value={form.dueDate||''} onChange={e=>setForm(f=>({...f,dueDate:e.target.value}))} />
          </div>}
        </div>
        <div className="form-group">
          <label className="form-label">Line Items</label>
          {form.items.map((it, idx) => (
            <div key={idx} style={{display:'flex',gap:8,marginBottom:6,alignItems:'center'}}>
              <input className="input" placeholder="Description" value={it.desc} onChange={e=>updateItem(idx,'desc',e.target.value)} style={{flex:2}} />
              <input className="input" type="number" placeholder="Qty" value={it.qty} onChange={e=>updateItem(idx,'qty',Number(e.target.value))} style={{width:60}} />
              <input className="input" type="number" placeholder="Rate" value={it.rate} onChange={e=>updateItem(idx,'rate',Number(e.target.value))} style={{width:90}} />
              <button className="btn-icon" onClick={()=>removeItem(idx)} style={{color:'var(--danger)'}}>✕</button>
            </div>
          ))}
          <button className="btn btn-sm" onClick={addItem} style={{marginTop:4}}>+ Add Line</button>
        </div>
        <div style={{textAlign:'right',fontSize:'var(--text-md)',fontWeight:600,marginTop:8}}>
          Total: ${form.items.reduce((s,it)=>(s+(it.qty||1)*(it.rate||0)),0).toLocaleString()}
        </div>
      </Modal>
    </div>
  );
}
