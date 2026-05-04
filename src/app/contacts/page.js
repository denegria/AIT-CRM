'use client';
import { useState } from 'react';
import { useCRM } from '@/lib/store';
import DataTable from '@/components/DataTable';
import Modal from '@/components/Modal';

const empty = { name:'', email:'', phone:'', status:'New Lead', source:'Facebook Ads', assignedTo:'emp-1', notes:'' };

export default function ContactsPage() {
  const { contacts, addContact, updateContact, deleteContact, employees, loaded } = useCRM();
  const [drawer, setDrawer] = useState(null); // null | 'new' | contact object
  const [form, setForm] = useState(empty);

  const openNew = () => { setForm(empty); setDrawer('new'); };
  const openEdit = (row) => { setForm({ ...row }); setDrawer(row); };
  const close = () => setDrawer(null);

  const save = () => {
    if (!form.name.trim()) return;
    if (drawer === 'new') addContact(form);
    else updateContact(drawer.id, form);
    close();
  };

  const empName = (id) => employees.find(e => e.id === id)?.name || id;

  const columns = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'email', label: 'Email', sortable: true },
    { key: 'phone', label: 'Phone' },
    { key: 'status', label: 'Status', type: 'badge', sortable: true },
    { key: 'source', label: 'Source', sortable: true },
    { key: 'lastContact', label: 'Last Contact', sortable: true },
  ];

  const dataWithEmp = contacts.map(c => ({ ...c, assignedLabel: empName(c.assignedTo) }));

  if (!loaded) return <div className="empty-state">Loading...</div>;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Contacts & Leads</h1>
          <p className="page-subtitle">{contacts.length} total contacts</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Add Contact</button>
      </div>

      <div className="card" style={{padding:16}}>
        <DataTable
          columns={columns}
          data={dataWithEmp}
          searchPlaceholder="Search contacts..."
          onEdit={(id, u) => updateContact(id, u)}
          actions={[
            { label: 'Edit', onClick: openEdit },
            { label: 'Delete', onClick: (r) => deleteContact(r.id), danger: true },
          ]}
        />
      </div>

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
          <label className="form-label">Notes</label>
          <textarea className="input" rows={3} value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} style={{resize:'vertical'}} />
        </div>
      </Modal>
    </div>
  );
}
