'use client';
import { useState } from 'react';
import { useCRM } from '@/lib/store';
import DataTable from '@/components/DataTable';
import Modal from '@/components/Modal';
import { generateWorkOrderPDF } from '@/lib/pdf';

const empty = { number:'', title:'', client:'', contactId:'', priority:'Medium', status:'Pending', assignedTo:'emp-1', dueDate:'', description:'', estimatedCost:0 };

export default function WorkOrdersPage() {
  const { workOrders, addWorkOrder, updateWorkOrder, deleteWorkOrder, contacts, employees, loaded } = useCRM();
  const [drawer, setDrawer] = useState(null);
  const [form, setForm] = useState(empty);

  const openNew = () => {
    const num = `WO-${String(workOrders.length + 1).padStart(3, '0')}`;
    setForm({ ...empty, number: num, dueDate: new Date().toISOString().slice(0,10) });
    setDrawer('new');
  };
  const openEdit = (row) => { setForm({ ...row }); setDrawer(row); };
  const close = () => setDrawer(null);
  const save = () => {
    if (!form.title.trim()) return;
    if (drawer === 'new') addWorkOrder(form);
    else updateWorkOrder(drawer.id, form);
    close();
  };

  const empName = (id) => employees.find(e => e.id === id)?.name || id;

  const columns = [
    { key: 'number', label: 'WO #', sortable: true },
    { key: 'title', label: 'Title', sortable: true },
    { key: 'client', label: 'Client', sortable: true },
    { key: 'priority', label: 'Priority', type: 'badge', sortable: true },
    { key: 'status', label: 'Status', type: 'badge', sortable: true },
    { key: 'dueDate', label: 'Due Date', sortable: true },
    { key: 'estimatedCost', label: 'Est. Cost', type: 'currency', sortable: true },
  ];

  if (!loaded) return <div className="empty-state">Loading...</div>;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Work Orders</h1>
          <p className="page-subtitle">{workOrders.filter(w=>w.status!=='Completed').length} active orders</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ New Work Order</button>
      </div>

      <div className="card" style={{padding:16}}>
        <DataTable
          columns={columns}
          data={workOrders.map(w => ({ ...w, assignedLabel: empName(w.assignedTo) }))}
          searchPlaceholder="Search work orders..."
          onEdit={(id, u) => updateWorkOrder(id, u)}
          actions={[
            { label: 'Edit', onClick: openEdit },
            { label: 'PDF', onClick: (r) => generateWorkOrderPDF(r) },
            { label: 'Delete', onClick: (r) => deleteWorkOrder(r.id), danger: true },
          ]}
        />
      </div>

      <Modal open={!!drawer} onClose={close} title={drawer === 'new' ? 'New Work Order' : 'Edit Work Order'}
        footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>}>
        <div className="grid-2">
          <div className="form-group">
            <label className="form-label">WO Number</label>
            <input className="input" value={form.number} readOnly style={{opacity:0.6}} />
          </div>
          <div className="form-group">
            <label className="form-label">Due Date</label>
            <input className="input" type="date" value={form.dueDate} onChange={e => setForm(f=>({...f,dueDate:e.target.value}))} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Title</label>
          <input className="input" value={form.title} onChange={e => setForm(f=>({...f,title:e.target.value}))} />
        </div>
        <div className="form-group">
          <label className="form-label">Client</label>
          <select className="input select" value={form.contactId} onChange={e => {
            const c = contacts.find(ct => ct.id === e.target.value);
            setForm(f=>({...f, contactId: e.target.value, client: c?.name || ''}));
          }}>
            <option value="">Select client</option>
            {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="grid-3">
          <div className="form-group">
            <label className="form-label">Priority</label>
            <select className="input select" value={form.priority} onChange={e => setForm(f=>({...f,priority:e.target.value}))}>
              {['Low','Medium','High'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="input select" value={form.status} onChange={e => setForm(f=>({...f,status:e.target.value}))}>
              {['Pending','In Progress','Completed','On Hold'].map(st => <option key={st} value={st}>{st}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Assigned To</label>
            <select className="input select" value={form.assignedTo} onChange={e => setForm(f=>({...f,assignedTo:e.target.value}))}>
              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Estimated Cost ($)</label>
          <input className="input" type="number" value={form.estimatedCost} onChange={e => setForm(f=>({...f,estimatedCost:Number(e.target.value)}))} />
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea className="input" rows={3} value={form.description} onChange={e => setForm(f=>({...f,description:e.target.value}))} style={{resize:'vertical'}} />
        </div>
      </Modal>
    </div>
  );
}
