'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCRM } from '@/lib/store';
import { useToast } from '@/components/Toast';
import DataTable from '@/components/DataTable';
import KanbanBoard from '@/components/KanbanBoard';
import Modal from '@/components/Modal';
import { List, LayoutDashboard as KanbanIcon } from 'lucide-react';

const empty = { name:'', email:'', phone:'', status:'New Lead', source:'Facebook Ads', assignedTo:'emp-1', notes: [] };

export default function ContactsPage() {
  const {
    contacts,
    addContact,
    updateContact,
    deleteContact,
    employees,
    loaded,
    access,
    accessibleBusinessUnits,
    currentBusinessUnitId,
    currentBusinessUnit,
    canUseConsolidatedScope,
    scopeLabel,
  } = useCRM();
  const { toast } = useToast();
  const router = useRouter();
  const [drawer, setDrawer] = useState(null); // null | 'new' | contact object
  const [form, setForm] = useState(empty);
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'kanban'
  const [statusFilter, setStatusFilter] = useState('All');

  const canWrite = access.canWriteCrm;
  const defaultBusinessUnitId = currentBusinessUnitId !== 'all' && currentBusinessUnitId !== 'unassigned' ? currentBusinessUnitId : accessibleBusinessUnits[0]?.id || '';
  const openNew = () => {
    if (!canWrite) return;
    setForm({ ...empty, businessUnitId: defaultBusinessUnitId, primaryBusinessUnitId: defaultBusinessUnitId });
    setDrawer('new');
  };
  const openEdit = (row) => { if (!canWrite) return; setForm({ ...row }); setDrawer(row); };
  const close = () => setDrawer(null);

  const save = () => {
    if (!form.name.trim()) return;
    if (drawer === 'new') {
      addContact(form);
      toast('Contact created successfully');
    } else {
      updateContact(drawer.id, form);
      toast('Contact updated successfully');
    }
    close();
  };

  const empName = (id) => employees.find(e => e.id === id)?.name || id;
  const unitName = (id) => accessibleBusinessUnits.find((unit) => unit.id === id)?.name || 'Unassigned';

  const columns = [
    { key: 'name', label: 'Name', sortable: true, editable: true },
    { key: 'email', label: 'Email', sortable: true, editable: true },
    { key: 'phone', label: 'Phone', editable: true },
    { key: 'status', label: 'Status', type: 'badge', sortable: true },
    { key: 'divisionLabel', label: scopeLabel, sortable: true },
    { key: 'source', label: 'Source', sortable: true },
    { key: 'lastContact', label: 'Last Contact', sortable: true },
  ];

  const filteredContacts = contacts.filter(c => statusFilter === 'All' || c.status === statusFilter);
  const dataWithEmp = filteredContacts.map(c => ({ ...c, assignedLabel: empName(c.assignedTo), divisionLabel: unitName(c.businessUnitId || c.primaryBusinessUnitId) }));

  if (!loaded) return <div className="empty-state">Loading...</div>;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Contacts & Leads</h1>
          <p className="page-subtitle">{contacts.length} contacts in {currentBusinessUnit?.name || `all ${scopeLabel.toLowerCase()}`}</p>
        </div>
        <div className="flex-gap">
          <div className="view-toggle">
            <button className={`btn-icon ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')} title="Table View">
              <List size={18} />
            </button>
            <button className={`btn-icon ${viewMode === 'kanban' ? 'active' : ''}`} onClick={() => setViewMode('kanban')} title="Pipeline View">
              <KanbanIcon size={18} />
            </button>
          </div>
          <select className="input select" style={{width:130, padding:'4px 8px'}} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
            <option value="All">All Statuses</option>
            {['New Lead','Contacted','Qualified','Proposal Sent','Won','Lost'].map(s=><option key={s} value={s}>{s}</option>)}
          </select>
          {canWrite && <button className="btn btn-primary" onClick={openNew}>+ Add Contact</button>}
        </div>
      </div>

      <style jsx>{`
        .view-toggle {
          display: flex;
          background: var(--bg-tertiary);
          padding: 4px;
          border-radius: var(--radius-md);
          border: 1px solid var(--border-subtle);
          margin-right: 8px;
        }
        .view-toggle .btn-icon {
          padding: 4px 8px;
          border-radius: var(--radius-sm);
          color: var(--text-muted);
        }
        .view-toggle .btn-icon.active {
          background: var(--bg-secondary);
          color: var(--accent);
          box-shadow: var(--shadow-sm);
        }
      `}</style>

      {viewMode === 'table' ? (
        <div className="card" style={{padding:16}}>
          <DataTable
            columns={columns}
            data={dataWithEmp}
            searchPlaceholder="Search contacts..."
            onEdit={canWrite ? (id, u) => { updateContact(id, u); toast('Field updated'); } : undefined}
            actions={[
              { label: 'View', onClick: (r) => router.push(`/contacts/${r.id}`) },
              ...(canWrite ? [
                { label: 'Edit', onClick: openEdit },
                { label: 'Delete', onClick: (r) => { deleteContact(r.id); toast('Contact deleted', 'error'); }, danger: true },
              ] : []),
            ]}
          />
        </div>
      ) : (
        <KanbanBoard 
          data={dataWithEmp}
          columns={['New Lead', 'Contacted', 'Qualified', 'Proposal Sent', 'Won', 'Lost']}
          onMove={canWrite ? (id, status) => { updateContact(id, { status }); toast('Stage updated'); } : undefined}
          onEdit={(item) => router.push(`/contacts/${item.id}`)}
        />
      )}

      <Modal open={!!drawer} onClose={close} title={drawer === 'new' ? 'New Contact' : 'Edit Contact'}
        footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>}>
        <div className="form-group">
          <label className="form-label">Name</label>
          <input className="input" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
        </div>
        <div className="grid-2">
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="input" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} />
          </div>
          <div className="form-group">
            <label className="form-label">Phone</label>
            <input className="input" value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} />
          </div>
        </div>
        <div className="grid-2">
          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="input select" value={form.status} onChange={e => setForm(f => ({...f, status: e.target.value}))}>
              {['New Lead','Contacted','Qualified','Proposal Sent','Won','Lost'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Source</label>
            <select className="input select" value={form.source} onChange={e => setForm(f => ({...f, source: e.target.value}))}>
              {['Facebook Ads','Website','Referral','Cold Call','Google Ads'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Assigned To</label>
          <select className="input select" value={form.assignedTo} onChange={e => setForm(f => ({...f, assignedTo: e.target.value}))}>
            {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">{scopeLabel}</label>
          <select
            className="input select"
            value={form.businessUnitId || form.primaryBusinessUnitId || ''}
            onChange={e => setForm(f => ({...f, businessUnitId: e.target.value, primaryBusinessUnitId: e.target.value}))}
          >
            {canUseConsolidatedScope && <option value="">Unassigned</option>}
            {accessibleBusinessUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea className="input" rows={3} 
            value={Array.isArray(form.notes) ? (form.notes[form.notes.length - 1]?.text || '') : form.notes} 
            onChange={e => {
              const text = e.target.value;
              setForm(f => {
                const newNotes = Array.isArray(f.notes) ? [...f.notes] : [{ text: f.notes, date: new Date().toISOString().slice(0,10) }];
                if (newNotes.length > 0) {
                  newNotes[newNotes.length - 1] = { ...newNotes[newNotes.length - 1], text, date: new Date().toISOString().slice(0,10) };
                } else {
                  newNotes.push({ text, date: new Date().toISOString().slice(0,10) });
                }
                return { ...f, notes: newNotes };
              });
            }} 
            style={{resize:'vertical'}} 
          />
          <div style={{fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 4}}>
            Editing the latest note. Full timeline available in Contact Details.
          </div>
        </div>
      </Modal>
    </div>
  );
}
