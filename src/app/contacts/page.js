'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCRM } from '@/lib/store';
import { useContactWorkflowView } from '@/lib/use-contact-workflow-view';
import { useToast } from '@/components/Toast';
import DataTable from '@/components/DataTable';
import Modal from '@/components/Modal';
import { AlertCircle, UserPlus, UserRoundCheck } from 'lucide-react';
import { isWorkflowStatusClosed } from '@/lib/sales-workflow';

const empty = {
  name: '',
  email: '',
  phone: '',
  status: 'New Lead',
  currentStage: 'Needs First Outreach',
  source: 'Wix Historical Import',
  assignedTo: '',
  tags: ['needs_first_outreach'],
  nextAction: 'Make first outreach by phone/SMS/email; confirm program interest and schedule follow-up.',
  notes: [],
};

function TagList({ tags = [] }) {
  if (!tags.length) return null;
  return (
    <div className="workflow-tags">
      {tags.slice(0, 3).map((tag) => (
        <span key={tag} className="workflow-tag">{tag.replaceAll('_', ' ')}</span>
      ))}
    </div>
  );
}

function WorkflowCell({ row }) {
  return (
    <div className="workflow-cell">
      <div className="workflow-line">
        {row.needsFirstOutreach ? <AlertCircle size={13} /> : <UserRoundCheck size={13} />}
        <span>{row.currentStage || row.status}</span>
      </div>
      {row.nextAction && <div className="workflow-next">{row.nextAction}</div>}
      <TagList tags={row.tags || []} />
    </div>
  );
}

export default function ContactsPage() {
  const {
    contacts,
    workOrders,
    financials,
    addContact,
    updateContact,
    deleteContact,
    employees,
    loaded,
    access,
    accessibleBusinessUnits,
    currentBusinessUnitId,
    currentBusinessUnit,
    currentUser,
    canUseConsolidatedScope,
    scopeLabel,
  } = useCRM();
  const { toast } = useToast();
  const router = useRouter();
  const [drawer, setDrawer] = useState(null); // null | 'new' | contact object
  const [form, setForm] = useState(empty);
  const [statusFilter, setStatusFilter] = useState('All');
  const [workflowFilter, setWorkflowFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');

  const canWrite = access.canWriteCrm;
  const {
    businessUnitById,
    contactRows,
    currentScopedBusinessUnitId,
    defaultBusinessUnitId,
    statusOptions,
    statusOptionsForBusinessUnitId,
  } = useContactWorkflowView({
    contacts,
    workOrders,
    financials,
    employees,
    accessibleBusinessUnits,
    currentBusinessUnitId,
    currentBusinessUnit,
  });
  const openNew = () => {
    if (!canWrite) return;
    const defaultStatuses = statusOptionsForBusinessUnitId(defaultBusinessUnitId);
    setForm({
      ...empty,
      status: defaultStatuses[0] || empty.status,
      currentStage: defaultStatuses[0] || empty.status,
      businessUnitId: defaultBusinessUnitId,
      primaryBusinessUnitId: defaultBusinessUnitId,
    });
    setDrawer('new');
  };
  const openEdit = (row) => { if (!canWrite) return; setForm({ ...row }); setDrawer(row); };
  const close = () => setDrawer(null);

  const save = () => {
    if (!form.name.trim()) return;
    if (drawer === 'new') {
      addContact(form)
        .then(() => {
          toast('Contact created successfully');
          close();
        })
        .catch((error) => toast(error?.message || 'Contact create failed.', 'error'));
    } else {
      updateContact(drawer.id, form)
        .then(() => {
          toast('Contact updated successfully');
          close();
        })
        .catch((error) => toast(error?.message || 'Contact update failed.', 'error'));
    }
  };

  const columns = [
    { key: 'name', label: 'Name', sortable: true, editable: true },
    { key: 'email', label: 'Email', sortable: true, editable: true },
    { key: 'phone', label: 'Phone', editable: true },
    { key: 'status', label: 'Status', type: 'badge', sortable: true },
    { key: 'workflow', label: 'Next Step', sortable: false, render: (row) => <WorkflowCell row={row} /> },
    { key: 'assignedLabel', label: 'Owner', sortable: true },
    { key: 'divisionLabel', label: scopeLabel, sortable: true },
    { key: 'source', label: 'Source', sortable: true },
    { key: 'lastTouch', label: 'Last Touch', sortable: true },
    { key: 'lastEdited', label: 'Last Edited', sortable: true },
  ];

  const filteredContacts = contactRows.filter((contact) => {
    const statusMatch = statusFilter === 'All' || contact.status === statusFilter;
    const businessUnit = businessUnitById.get(contact.businessUnitId || contact.primaryBusinessUnitId) || null;
    const workflowMatch =
      workflowFilter === 'all' ||
      (workflowFilter === 'needs_first_outreach' && contact.needsFirstOutreach) ||
      (workflowFilter === 'unassigned' && !contact.assignedTo) ||
      (workflowFilter === 'active' && !isWorkflowStatusClosed(contact.status, businessUnit));
    const ownerMatch =
      ownerFilter === 'all' ||
      (ownerFilter === 'unassigned' && !contact.assignedTo) ||
      contact.assignedTo === ownerFilter;
    return statusMatch && workflowMatch && ownerMatch;
  });

  if (!loaded) return <div className="empty-state">Loading...</div>;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Contacts</h1>
          <p className="page-subtitle">{contacts.length} contacts in {currentBusinessUnit?.name || `all ${scopeLabel.toLowerCase()}`}</p>
        </div>
        <div className="flex-gap contacts-header-actions">
          <select className="input select contacts-filter" style={{width:130, padding:'4px 8px'}} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
            <option value="All">All Statuses</option>
            {statusOptions.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input select contacts-filter contacts-workflow-filter" style={{width:180, padding:'4px 8px'}} value={workflowFilter} onChange={e=>setWorkflowFilter(e.target.value)}>
            <option value="all">All Workflows</option>
            <option value="needs_first_outreach">Needs First Outreach</option>
            <option value="active">Active Pipeline</option>
            <option value="unassigned">Unassigned</option>
          </select>
          <select className="input select contacts-filter" style={{width:150, padding:'4px 8px'}} value={ownerFilter} onChange={e=>setOwnerFilter(e.target.value)}>
            <option value="all">All Owners</option>
            <option value="unassigned">Unassigned</option>
            {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
          </select>
          {canWrite && <button className="btn btn-primary" onClick={openNew}>+ Add Contact</button>}
        </div>
      </div>

      <div className="card" style={{padding:16}}>
        <DataTable
          columns={columns}
          data={filteredContacts}
          searchPlaceholder="Search contacts..."
          onEdit={canWrite ? (id, u) => {
            updateContact(id, u)
              .then(() => toast('Field updated'))
              .catch((error) => toast(error?.message || 'Update failed.', 'error'));
          } : undefined}
          actions={[
            { label: 'View', onClick: (r) => router.push(`/contacts/${r.id}`) },
            ...(canWrite ? [
              ...(currentUser?.id ? [{
                label: 'Assign to me',
                icon: <UserPlus size={14} />,
                onClick: (r) => {
                  updateContact(r.id, { assignedTo: currentUser.id })
                    .then(() => toast('Contact assigned'))
                    .catch((error) => toast(error?.message || 'Assignment failed.', 'error'));
                },
              }] : []),
              { label: 'Edit', onClick: openEdit },
              { label: 'Delete', onClick: (r) => { deleteContact(r.id); toast('Contact deleted', 'error'); }, danger: true },
            ] : []),
          ]}
          mobileBadges={['status']}
          mobileFields={['phone', 'workflow', 'assignedLabel', 'divisionLabel', 'lastTouch', 'lastEdited']}
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
              {[
                ...new Set([
                  ...(statusOptionsForBusinessUnitId(form.businessUnitId || form.primaryBusinessUnitId) || []),
                  ...(form.status ? [form.status] : []),
                ]),
              ].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Source</label>
            <select className="input select" value={form.source} onChange={e => setForm(f => ({...f, source: e.target.value}))}>
              {['Wix Historical Import','Website','Facebook Ads','Referral','Cold Call','Google Ads'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Assigned To</label>
          <select className="input select" value={form.assignedTo} onChange={e => setForm(f => ({...f, assignedTo: e.target.value}))}>
            <option value="">Unassigned</option>
            {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">{scopeLabel}</label>
          <select
            className="input select"
            value={form.businessUnitId || form.primaryBusinessUnitId || ''}
            onChange={e => {
              const nextBusinessUnitId = e.target.value;
              const nextStatuses = statusOptionsForBusinessUnitId(nextBusinessUnitId);
              setForm(f => ({
                ...f,
                businessUnitId: nextBusinessUnitId,
                primaryBusinessUnitId: nextBusinessUnitId,
                status: nextStatuses.includes(f.status) ? f.status : nextStatuses[0] || f.status,
              }));
            }}
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
