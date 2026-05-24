'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCRM } from '@/lib/store';
import { useToast } from '@/components/Toast';
import DataTable from '@/components/DataTable';
import KanbanBoard from '@/components/KanbanBoard';
import Modal from '@/components/Modal';
import { AlertCircle, Clock3, LayoutDashboard as KanbanIcon, List, UserPlus, UserRoundCheck } from 'lucide-react';
import { PIPELINE_STATUSES } from '@/lib/sales-workflow';

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
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'kanban'
  const [statusFilter, setStatusFilter] = useState('All');
  const [workflowFilter, setWorkflowFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');

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

  const empName = (id) => employees.find(e => e.id === id)?.name || (id ? id : 'Unassigned');
  const unitName = (id) => accessibleBusinessUnits.find((unit) => unit.id === id)?.name || 'Unassigned';
  const workflowStats = {
    needsFirstOutreach: contacts.filter((contact) => contact.needsFirstOutreach).length,
    unassigned: contacts.filter((contact) => !contact.assignedTo).length,
    active: contacts.filter((contact) => !['Won', 'Lost'].includes(contact.status)).length,
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
    { key: 'lastContact', label: 'Last Contact', sortable: true },
  ];

  const filteredContacts = contacts.filter((contact) => {
    const statusMatch = statusFilter === 'All' || contact.status === statusFilter;
    const workflowMatch =
      workflowFilter === 'all' ||
      (workflowFilter === 'needs_first_outreach' && contact.needsFirstOutreach) ||
      (workflowFilter === 'unassigned' && !contact.assignedTo) ||
      (workflowFilter === 'active' && !['Won', 'Lost'].includes(contact.status));
    const ownerMatch =
      ownerFilter === 'all' ||
      (ownerFilter === 'unassigned' && !contact.assignedTo) ||
      contact.assignedTo === ownerFilter;
    return statusMatch && workflowMatch && ownerMatch;
  });
  const dataWithEmp = filteredContacts.map(c => ({ ...c, assignedLabel: empName(c.assignedTo), divisionLabel: unitName(c.businessUnitId || c.primaryBusinessUnitId) }));

  if (!loaded) return <div className="empty-state">Loading...</div>;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Contacts & Leads</h1>
          <p className="page-subtitle">{contacts.length} contacts in {currentBusinessUnit?.name || `all ${scopeLabel.toLowerCase()}`}</p>
        </div>
        <div className="flex-gap contacts-header-actions">
          <div className="view-toggle">
            <button className={`btn-icon ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')} title="Table View">
              <List size={18} />
            </button>
            <button className={`btn-icon ${viewMode === 'kanban' ? 'active' : ''}`} onClick={() => setViewMode('kanban')} title="Pipeline View">
              <KanbanIcon size={18} />
            </button>
          </div>
          <select className="input select contacts-filter" style={{width:130, padding:'4px 8px'}} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
            <option value="All">All Statuses</option>
            {PIPELINE_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
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
        .workflow-strip {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 16px;
        }
        .workflow-stat {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 58px;
          padding: 12px 14px;
          background: var(--bg-secondary);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
        }
        .workflow-stat strong {
          display: block;
          font-size: var(--text-xl);
          line-height: 1;
        }
        .workflow-stat span {
          color: var(--text-secondary);
          font-size: var(--text-xs);
        }
        .workflow-stat svg { color: var(--accent); }
        .workflow-cell { min-width: 190px; max-width: 260px; }
        .workflow-line {
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--text-primary);
          font-weight: 600;
          font-size: var(--text-xs);
        }
        .workflow-line svg {
          color: var(--warning);
          flex: 0 0 auto;
        }
        .workflow-next {
          margin-top: 4px;
          color: var(--text-secondary);
          font-size: var(--text-xs);
          line-height: 1.35;
          white-space: normal;
        }
        .workflow-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: 6px;
        }
        .workflow-tag {
          padding: 2px 6px;
          border-radius: 999px;
          background: var(--warning-muted);
          color: var(--warning);
          font-size: 10px;
          font-weight: 600;
          text-transform: capitalize;
        }
        .contacts-header-actions {
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        @media (max-width: 900px) and (min-width: 641px) {
          .workflow-strip {
            gap: 8px;
          }
          .workflow-stat {
            min-height: 48px;
            padding: 9px 10px;
            gap: 8px;
          }
          .workflow-stat strong {
            font-size: var(--text-lg);
          }
          .workflow-stat span {
            font-size: 10px;
            line-height: 1.15;
          }
          .workflow-stat svg {
            width: 15px;
            height: 15px;
          }
          .contacts-header-actions {
            gap: 6px;
          }
        }
        @media (max-width: 640px) {
          .workflow-strip { grid-template-columns: 1fr; }
          .contacts-header-actions {
            width: 100%;
            justify-content: stretch;
          }
          .contacts-header-actions :global(.btn),
          .contacts-header-actions :global(.input),
          .contacts-filter {
            flex: 1 1 100%;
            width: 100% !important;
          }
          .view-toggle {
            width: 100%;
            margin-right: 0;
          }
          .view-toggle .btn-icon {
            flex: 1;
            justify-content: center;
          }
        }
      `}</style>

      <div className="workflow-strip">
        <div className="workflow-stat">
          <AlertCircle size={18} />
          <div><strong>{workflowStats.needsFirstOutreach}</strong><span>need first outreach</span></div>
        </div>
        <div className="workflow-stat">
          <Clock3 size={18} />
          <div><strong>{workflowStats.active}</strong><span>active pipeline</span></div>
        </div>
        <div className="workflow-stat">
          <UserRoundCheck size={18} />
          <div><strong>{workflowStats.unassigned}</strong><span>unassigned contacts</span></div>
        </div>
      </div>

      {viewMode === 'table' ? (
        <div className="card" style={{padding:16}}>
          <DataTable
            columns={columns}
            data={dataWithEmp}
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
          />
        </div>
      ) : (
        <KanbanBoard 
          data={dataWithEmp}
          columns={PIPELINE_STATUSES}
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
              {PIPELINE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
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
