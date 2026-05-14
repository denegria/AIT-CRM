'use client';
import { useState } from 'react';
import { useCRM } from '@/lib/store';
import { useToast } from '@/components/Toast';
import DataTable from '@/components/DataTable';
import Modal from '@/components/Modal';
import { generateWorkOrderPDF } from '@/lib/pdf';

const empty = { number:'', title:'', client:'', contactId:'', priority:'Medium', status:'Pending', assignedTo:'emp-1', dueDate:'', description:'', estimatedCost:0 };

export default function WorkOrdersPage() {
  const {
    workOrders,
    addWorkOrder,
    updateWorkOrder,
    deleteWorkOrder,
    contacts,
    employees,
    access,
    loaded,
    role,
    accessibleBusinessUnits,
    currentBusinessUnitId,
    currentBusinessUnit,
    scopeLabel,
  } = useCRM();
  const { toast } = useToast();
  const [drawer, setDrawer] = useState(null);
  const [form, setForm] = useState(empty);
  const [statusFilter, setStatusFilter] = useState('All');
  const canWriteWorkOrders = Boolean(access?.canWriteWorkOrders);

  const openNew = () => {
    if (!canWriteWorkOrders) return;
    const num = `WO-${String(workOrders.length + 1).padStart(3, '0')}`;
    const businessUnitId = currentBusinessUnitId !== 'all' && currentBusinessUnitId !== 'unassigned' ? currentBusinessUnitId : accessibleBusinessUnits[0]?.id || '';
    setForm({ ...empty, number: num, businessUnitId, dueDate: new Date().toISOString().slice(0,10) });
    setDrawer('new');
  };
  const openEdit = (row) => {
    if (!canWriteWorkOrders) return;
    setForm({ ...row });
    setDrawer(row);
  };
  const close = () => setDrawer(null);
  const save = async () => {
    if (!canWriteWorkOrders) return;
    if (!form.title.trim()) return;
    try {
      if (drawer === 'new') {
        await addWorkOrder(form);
        toast('Work order created');
      } else {
        await updateWorkOrder(drawer.id, form);
        toast('Work order updated');
      }
      close();
    } catch (error) {
      toast(error?.message || 'Work order save failed.', 'error');
    }
  };

  const empName = (id) => employees.find(e => e.id === id)?.name || id;
  const unitName = (id) => accessibleBusinessUnits.find((unit) => unit.id === id)?.name || 'Unassigned';

  const columns = [
    { key: 'number', label: 'WO #', sortable: true },
    { key: 'title', label: 'Title', sortable: true, editable: true },
    { key: 'client', label: 'Client', sortable: true },
    { key: 'divisionLabel', label: scopeLabel, sortable: true },
    { key: 'priority', label: 'Priority', type: 'badge', sortable: true },
    { key: 'status', label: 'Status', type: 'badge', sortable: true },
    { key: 'dueDate', label: 'Due Date', sortable: true },
    { key: 'estimatedCost', label: 'Est. Cost', type: 'currency', sortable: true, editable: true },
  ];

  const filtered = workOrders.filter(w => statusFilter === 'All' || w.status === statusFilter);

  const [selectedIds, setSelectedIds] = useState([]);

  const exportSelected = () => {
    const selected = workOrders.filter(w => selectedIds.includes(w.id));
    if (selected.length === 0) return;
    const rows = [['WO #','Title','Client','Priority','Status','Due Date','Est. Cost']];
    selected.forEach(w => rows.push([w.number, w.title, w.client, w.priority, w.status, w.dueDate, w.estimatedCost]));
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'work_orders_export.csv'; a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${selected.length} work orders`);
  };

  if (!loaded) return <div className="empty-state">Loading...</div>;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Work Orders</h1>
          <p className="page-subtitle">{workOrders.filter(w=>w.status!=='Completed').length} active orders in {currentBusinessUnit?.name || `all ${scopeLabel.toLowerCase()}`}</p>
        </div>
        <button className="btn btn-primary" onClick={openNew} disabled={!canWriteWorkOrders}>+ New Work Order</button>
      </div>

      <div className="card" style={{padding:16}}>
        <DataTable
          columns={columns}
          data={filtered.map(w => ({ ...w, assignedLabel: empName(w.assignedTo), divisionLabel: unitName(w.businessUnitId) }))}
          searchPlaceholder="Search work orders..."
          onEdit={canWriteWorkOrders ? ((id, u) => {
            updateWorkOrder(id, u)
              .then(() => toast('Field updated'))
              .catch((error) => toast(error?.message || 'Update failed.', 'error'));
          }) : undefined}
          selectable
          selectedIds={selectedIds}
          onSelect={setSelectedIds}
          toolbarExtra={
            <div className="flex-gap">
              <select className="input select" style={{width:130, padding:'4px 8px'}} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
                <option value="All">All Statuses</option>
                {['Pending','In Progress','Completed','On Hold'].map(s=><option key={s} value={s}>{s}</option>)}
              </select>
              {role === 'admin' && selectedIds.length > 0 && (
                <button className="btn fade-in" onClick={exportSelected} data-tooltip="Sample feature — exports selected rows to CSV">
                  Export Selected ({selectedIds.length})
                </button>
              )}
            </div>
          }
          actions={[
            ...(canWriteWorkOrders ? [{ label: 'Edit', onClick: openEdit }] : []),
            { label: 'PDF', onClick: (r) => { generateWorkOrderPDF(r); toast('PDF Generated'); } },
            ...(canWriteWorkOrders ? [{
              label: 'Delete',
              onClick: async (r) => {
                try {
                  await deleteWorkOrder(r.id);
                  toast('Work order deleted', 'error');
                } catch (error) {
                  toast(error?.message || 'Delete failed.', 'error');
                }
              },
              danger: true,
            }] : []),
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
            setForm(f=>({...f, contactId: e.target.value, client: c?.name || '', businessUnitId: c?.businessUnitId || c?.primaryBusinessUnitId || f.businessUnitId || ''}));
          }}>
            <option value="">Select client</option>
            {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="grid-3">
          <div className="form-group">
            <label className="form-label">{scopeLabel}</label>
            <select className="input select" value={form.businessUnitId || ''} onChange={e => setForm(f=>({...f,businessUnitId:e.target.value}))}>
              {accessibleBusinessUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
            </select>
          </div>
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
