'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCRM } from '@/lib/store';
import { useToast } from '@/components/Toast';
import DataTable from '@/components/DataTable';
import Modal from '@/components/Modal';
import { generateWorkOrderPDF } from '@/lib/pdf';

const empty = { number:'', title:'', client:'', contactId:'', businessUnitId:'', estimateId:'', priority:'Medium', status:'Pending', assignedTo:'', dueDate:'', description:'', estimatedCost:0 };

function isEstimateRecord(record = {}) {
  const type = String(record.type || '').toLowerCase();
  return type.includes('estimate');
}

function moneyLabel(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
}

function canAssignEmployeeToBusinessUnit(employee = {}, businessUnitId = '') {
  if (!employee?.id || !businessUnitId) return Boolean(employee?.id);
  const roleKeys = Array.isArray(employee.roleKeys) ? employee.roleKeys : [];
  if (roleKeys.includes('admin')) return true;
  const unitIds = Array.isArray(employee.businessUnitIds) ? employee.businessUnitIds.filter(Boolean) : [];
  return unitIds.includes(businessUnitId);
}

function firstAssigneeForBusinessUnit(employees = [], businessUnitId = '') {
  return employees.find((employee) => canAssignEmployeeToBusinessUnit(employee, businessUnitId));
}

function draftFromEstimate(form, estimate) {
  if (!estimate) return { ...form, estimateId: '' };
  const estimateLabel = estimate.number || 'estimate';
  const firstItem = Array.isArray(estimate.items) ? estimate.items[0] : null;
  const amount = Number(estimate.amount || estimate.balanceDue || estimate.subtotal || form.estimatedCost || 0);
  return {
    ...form,
    estimateId: estimate.id,
    title: form.title || firstItem?.desc || `Work order for ${form.client || 'client'}`,
    description: form.description || `Linked to ${estimateLabel}.`,
    estimatedCost: Number.isFinite(amount) ? amount : form.estimatedCost,
  };
}

export default function WorkOrdersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    workOrders,
    addWorkOrder,
    updateWorkOrder,
    deleteWorkOrder,
    contacts,
    financials,
    employees,
    access,
    loaded,
    role,
    currentUser,
    accessibleBusinessUnits,
    currentBusinessUnitId,
    currentBusinessUnit,
    scopeLabel,
  } = useCRM();
  const { toast } = useToast();
  const [drawer, setDrawer] = useState(null);
  const [form, setForm] = useState(empty);
  const [statusFilter, setStatusFilter] = useState(() => {
    const status = searchParams.get('status');
    return status === 'open' ? 'Open' : status || 'All';
  });
  const [ownerFilter, setOwnerFilter] = useState(() => searchParams.get('ownerUserId') || 'all');
  const contactPrefillRef = useRef('');
  const canWriteWorkOrders = Boolean(access?.canWriteWorkOrders);
  const selectedContact = contacts.find((entry) => entry.id === form.contactId) || null;
  const availableAssignees = useMemo(() => (
    employees.filter((employee) => canAssignEmployeeToBusinessUnit(employee, form.businessUnitId))
  ), [employees, form.businessUnitId]);
  const estimateOptions = useMemo(() => (
    financials
      .filter(isEstimateRecord)
      .filter((estimate) => !form.contactId || estimate.contactId === form.contactId)
      .filter((estimate) => !form.businessUnitId || estimate.businessUnitId === form.businessUnitId)
  ), [financials, form.businessUnitId, form.contactId]);

  const openNew = useCallback((prefillContact = null) => {
    if (!canWriteWorkOrders) return;
    const num = `WO-${String(workOrders.length + 1).padStart(3, '0')}`;
    const businessUnitId = prefillContact?.businessUnitId
      || prefillContact?.primaryBusinessUnitId
      || (currentBusinessUnitId !== 'all' && currentBusinessUnitId !== 'unassigned' ? currentBusinessUnitId : accessibleBusinessUnits[0]?.id || '');
    setForm({
      ...empty,
      number: num,
      businessUnitId,
      contactId: prefillContact?.id || '',
      client: prefillContact?.name || '',
      title: prefillContact?.name ? `Work order for ${prefillContact.name}` : '',
      assignedTo: firstAssigneeForBusinessUnit(employees, businessUnitId)?.id || '',
      dueDate: new Date().toISOString().slice(0,10),
    });
    setDrawer('new');
  }, [accessibleBusinessUnits, canWriteWorkOrders, currentBusinessUnitId, employees, workOrders.length]);

  useEffect(() => {
    if (!loaded || !canWriteWorkOrders || contactPrefillRef.current || typeof window === 'undefined') return;
    const contactId = new URLSearchParams(window.location.search).get('contactId');
    if (!contactId) return;
    const contact = contacts.find((entry) => entry.id === contactId);
    if (!contact) return;
    contactPrefillRef.current = contactId;
    queueMicrotask(() => openNew(contact));
  }, [canWriteWorkOrders, contacts, loaded, openNew]);
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
  const chooseContact = (contactId) => {
    const contact = contacts.find(ct => ct.id === contactId);
    setForm((current) => {
      const businessUnitId = contact?.businessUnitId || contact?.primaryBusinessUnitId || current.businessUnitId || '';
      const assignedTo = canAssignEmployeeToBusinessUnit(employees.find((entry) => entry.id === current.assignedTo), businessUnitId)
        ? current.assignedTo
        : firstAssigneeForBusinessUnit(employees, businessUnitId)?.id || '';
      return {
        ...current,
        contactId,
        client: contact?.name || '',
        businessUnitId,
        estimateId: '',
        assignedTo,
      };
    });
  };
  const chooseBusinessUnit = (businessUnitId) => {
    setForm((current) => {
      const assignedTo = canAssignEmployeeToBusinessUnit(employees.find((entry) => entry.id === current.assignedTo), businessUnitId)
        ? current.assignedTo
        : firstAssigneeForBusinessUnit(employees, businessUnitId)?.id || '';
      return {
        ...current,
        businessUnitId,
        estimateId: '',
        assignedTo,
      };
    });
  };
  const chooseEstimate = (estimateId) => {
    const estimate = estimateOptions.find((entry) => entry.id === estimateId) || null;
    setForm((current) => draftFromEstimate(current, estimate));
  };

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

  const filtered = workOrders
    .filter(w => statusFilter === 'All' || (statusFilter === 'Open' ? w.status !== 'Completed' : w.status === statusFilter))
    .filter(w => ownerFilter === 'all' || w.assignedTo === (ownerFilter === '__me' ? currentUser?.id : ownerFilter));

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
        <button className="btn btn-primary" onClick={openNew} disabled={!canWriteWorkOrders}>+ Create Work Order</button>
      </div>

      <div className="card" style={{padding:16}}>
        <DataTable
          columns={columns}
          data={filtered.map(w => ({ ...w, assignedLabel: empName(w.assignedTo), divisionLabel: unitName(w.businessUnitId) }))}
          searchPlaceholder="Search work orders..."
          emptyState={({ hasRows, hasSearch, clearSearch }) => (
            <div className="empty-state">
              <div className="empty-state-title">
                {hasSearch || statusFilter !== 'All' ? 'No work orders match this view' : 'No work orders in this scope'}
              </div>
              <p className="empty-state-copy">
                {hasSearch || statusFilter !== 'All'
                  ? `Search or status filters are hiding work orders in ${currentBusinessUnit?.name || `all ${scopeLabel.toLowerCase()}`}.`
                  : `No work orders have been created for ${currentBusinessUnit?.name || `all ${scopeLabel.toLowerCase()}`} yet. Work orders usually start from a contact/client record.`}
              </p>
              <div className="empty-state-actions">
                {hasSearch && (
                  <button className="btn btn-primary" type="button" onClick={clearSearch}>
                    Clear Search
                  </button>
                )}
                {!hasSearch && statusFilter !== 'All' && (
                  <button className="btn btn-primary" type="button" onClick={() => setStatusFilter('All')}>
                    Reset Status
                  </button>
                )}
                {workOrders.length === 0 && canWriteWorkOrders && (
                  <button className={`btn ${hasSearch || statusFilter !== 'All' ? '' : 'btn-primary'}`} type="button" onClick={() => router.push('/contacts')}>
                    Create From Contact
                  </button>
                )}
                {workOrders.length === 0 && !canWriteWorkOrders && (
                  <button className="btn btn-primary" type="button" onClick={() => router.push('/contacts')}>
                    Open Contacts
                  </button>
                )}
              </div>
            </div>
          )}
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
                {['Open','Pending','In Progress','Completed','On Hold'].map(s=><option key={s} value={s}>{s}</option>)}
              </select>
              <select className="input select" style={{width:150, padding:'4px 8px'}} value={ownerFilter} onChange={e=>setOwnerFilter(e.target.value)}>
                <option value="all">All Owners</option>
                {currentUser?.id && <option value="__me">Me</option>}
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </select>
              {role === 'admin' && selectedIds.length > 0 && (
                <button className="btn fade-in" onClick={exportSelected} data-tooltip="Sample feature — exports selected rows to CSV">
                  Export Selected ({selectedIds.length})
                </button>
              )}
            </div>
          }
          actions={[
            { label: 'View', onClick: (r) => router.push(`/work-orders/${r.id}`) },
            ...(canWriteWorkOrders ? [{ label: 'Edit', onClick: openEdit }] : []),
            { label: 'Generate PDF', onClick: (r) => { generateWorkOrderPDF(r); toast('PDF generated'); } },
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
          mobileBadges={['status', 'priority']}
          mobileFields={['client', 'divisionLabel', 'dueDate', 'estimatedCost']}
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
            chooseContact(e.target.value);
          }}>
            <option value="">Select client</option>
            {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Linked Estimate (optional)</label>
          <select className="input select" value={form.estimateId || ''} onChange={e => chooseEstimate(e.target.value)}>
            <option value="">No linked estimate</option>
            {estimateOptions.map((estimate) => (
              <option key={estimate.id} value={estimate.id}>
                {estimate.number || 'Estimate'}{estimate.client || selectedContact?.name ? ` - ${estimate.client || selectedContact?.name}` : ''} (${moneyLabel(estimate.amount || estimate.balanceDue)})
              </option>
            ))}
          </select>
        </div>
        <div className="grid-3">
          <div className="form-group">
            <label className="form-label">{scopeLabel}</label>
            <select className="input select" value={form.businessUnitId || ''} onChange={e => chooseBusinessUnit(e.target.value)}>
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
              <option value="">Unassigned</option>
              {form.assignedTo && !availableAssignees.some((employee) => employee.id === form.assignedTo) && (
                <option value={form.assignedTo}>{empName(form.assignedTo)} (outside {scopeLabel.toLowerCase()})</option>
              )}
              {availableAssignees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
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
