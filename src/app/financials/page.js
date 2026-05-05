'use client';
import { useState, useMemo } from 'react';
import { useCRM } from '@/lib/store';
import DataTable from '@/components/DataTable';
import Modal from '@/components/Modal';
import { generateInvoicePDF, generateEstimatePDF, generateReceiptPDF } from '@/lib/pdf';
import { useToast } from '@/components/Toast';

const types = ['Invoice', 'Estimate', 'Receipt'];
const emptyForm = { number:'', type:'Invoice', client:'', contactId:'', amount:0, date:'', dueDate:'', status:'Pending', items:[{desc:'',qty:1,rate:0}] };

export default function FinancialsPage() {
  const { financials, addFinancial, updateFinancial, deleteFinancial, contacts, loaded } = useCRM();
  const { addToast } = useToast();
  const [tab, setTab] = useState('Invoice');
  const [drawer, setDrawer] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [statusFilter, setStatusFilter] = useState('');

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
    addToast(`${selected.length} records exported`, 'info');
  };

  const filtered = useMemo(() => {
    return financials
      .filter(f => f.type === tab)
      .filter(f => !statusFilter || f.status === statusFilter);
  }, [financials, tab, statusFilter]);

  const openNew = () => {
    const prefix = tab === 'Invoice' ? 'INV' : tab === 'Estimate' ? 'EST' : 'REC';
    const count = financials.filter(f => f.type === tab).length + 1;
    setForm({ ...emptyForm, type: tab, number: `${prefix}-${String(count).padStart(3,'0')}`, date: new Date().toISOString().slice(0,10) });
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
      addToast(`${form.type} created successfully`, 'success');
    } else {
      updateFinancial(drawer.id, data);
      addToast(`${form.type} updated`, 'success');
    }
    close();
  };

  const handleDelete = (id) => {
    deleteFinancial(id);
    addToast('Record deleted', 'error');
  };

  const genPDF = (row) => {
    if (row.type === 'Invoice') generateInvoicePDF(row);
    else if (row.type === 'Estimate') generateEstimatePDF(row);
    else generateReceiptPDF(row);
  };

  const addItem = () => setForm(f => ({...f, items:[...f.items, {desc:'',qty:1,rate:0}]}));
  const updateItem = (idx, key, val) => setForm(f => ({...f, items: f.items.map((it,i) => i===idx ? {...it,[key]:val} : it)}));
  const removeItem = (idx) => setForm(f => ({...f, items: f.items.filter((_,i)=>i!==idx)}));

  const columns = [
    { key: 'number', label: 'Doc #', sortable: true },
    { key: 'client', label: 'Client', sortable: true },
    { key: 'amount', label: 'Amount', type: 'currency', sortable: true },
    { key: 'date', label: 'Date', sortable: true },
    { key: 'status', label: 'Status', type: 'badge', sortable: true },
  ];
  if (tab !== 'Receipt') columns.splice(4, 0, { key: 'dueDate', label: 'Due Date', sortable: true });

  if (!loaded) return <div className="empty-state">Loading...</div>;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Financials</h1>
          <p className="page-subtitle">Manage estimates, invoices, and receipts</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ New {tab}</button>
      </div>

      <div className="tabs">
        {types.map(t => (
          <button key={t} className={`tab ${tab===t?'tab-active':''}`} onClick={()=>{setTab(t); setSelectedIds([]); setStatusFilter('');}}>
            {t}s <span style={{marginLeft:4,opacity:0.5}}>({financials.filter(f=>f.type===t).length})</span>
          </button>
        ))}
      </div>

      <div className="card" style={{padding:16}}>
        <DataTable
          columns={columns}
          data={filtered}
          searchPlaceholder={`Search ${tab.toLowerCase()}s...`}
          filters={[{ label: 'All Statuses', options: ['Draft', 'Pending', 'Paid', 'Overdue'], value: statusFilter, onChange: setStatusFilter }]}
          selectable
          selectedIds={selectedIds}
          onSelect={setSelectedIds}
          toolbarExtra={
            selectedIds.length > 0 && (
              <button className="btn fade-in" onClick={exportSelected} data-tooltip="Sample feature — exports selected rows to CSV">
                Export Selected ({selectedIds.length})
              </button>
            )
          }
          actions={[
            { label: 'Edit', onClick: openEdit },
            { label: 'PDF', onClick: genPDF },
            { label: 'Delete', onClick: (r) => handleDelete(r.id), danger: true },
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
            setForm(f=>({...f,contactId:e.target.value,client:c?.name||''}));
          }}>
            <option value="">Select client</option>
            {contacts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
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
