'use client';
import { useState } from 'react';
import { useCRM } from '@/lib/store';
import DataTable from '@/components/DataTable';
import Modal from '@/components/Modal';

import { useToast } from '@/components/Toast';

const empty = { name:'', email:'', phone:'', status:'New Lead', source:'Facebook Ads', assignedTo:'emp-1', notes: [] };

export default function ContactsPage() {
  const { contacts, addContact, updateContact, deleteContact, employees, loaded } = useCRM();
  const { addToast } = useToast();
  const [drawer, setDrawer] = useState(null); // null | 'new' | contact object
  const [form, setForm] = useState(empty);
  const [statusFilter, setStatusFilter] = useState('');
  const [newNote, setNewNote] = useState('');

  const openNew = () => { setForm(empty); setDrawer('new'); };
  const openEdit = (row) => { setForm({ ...row }); setDrawer(row); };
  const close = () => setDrawer(null);

  const save = () => {
    if (!form.name.trim()) return;
    if (drawer === 'new') {
      addContact(form);
      addToast('Contact added successfully', 'success');
    } else {
      updateContact(drawer.id, form);
      addToast('Contact updated', 'success');
    }
    close();
  };

  const handleDelete = (id) => {
    deleteContact(id);
    addToast('Contact deleted', 'error');
  };

  const addNote = () => {
    if (!newNote.trim()) return;
    const note = { text: newNote, date: new Date().toISOString() };
    setForm(f => ({ ...f, notes: [...(Array.isArray(f.notes) ? f.notes : []), note] }));
    setNewNote('');
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

  const filteredData = contacts
    .filter(c => !statusFilter || c.status === statusFilter)
    .map(c => ({ ...c, assignedLabel: empName(c.assignedTo) }));

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
          data={filteredData}
          searchPlaceholder="Search contacts..."
          onEdit={(id, u) => {
            updateContact(id, u);
            addToast('Updated inline', 'success', 2000);
          }}
          filters={[{ label: 'All Statuses', options: ['New Lead', 'Contacted', 'Qualified', 'Proposal Sent', 'Won', 'Lost'], value: statusFilter, onChange: setStatusFilter }]}
          actions={[
            { label: 'Edit', onClick: openEdit },
            { label: 'Delete', onClick: (r) => handleDelete(r.id), danger: true },
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
        <div className="form-group" style={{marginTop: 16}}>
          <label className="form-label">Activity Timeline & Notes</label>
          <div style={{background: 'var(--bg-tertiary)', padding: 12, borderRadius: 'var(--radius-md)', maxHeight: 150, overflowY: 'auto', marginBottom: 8}}>
            {Array.isArray(form.notes) && form.notes.length > 0 ? (
              form.notes.map((n, i) => (
                <div key={i} style={{marginBottom: 8, fontSize: 'var(--text-sm)', borderBottom: i < form.notes.length-1 ? '1px solid var(--border-subtle)' : 'none', paddingBottom: 4}}>
                  <div style={{fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 2}}>
                    {new Date(n.date).toLocaleString()}
                  </div>
                  <div>{n.text}</div>
                </div>
              ))
            ) : (
              <div style={{fontSize: 'var(--text-sm)', color: 'var(--text-muted)'}}>No notes yet.</div>
            )}
          </div>
          <div style={{display: 'flex', gap: 8}}>
            <input className="input" placeholder="Add a new note..." value={newNote} onChange={e => setNewNote(e.target.value)} onKeyDown={e => e.key === 'Enter' && addNote()} />
            <button className="btn" onClick={addNote}>Add</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
