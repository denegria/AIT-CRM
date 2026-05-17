'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Calendar, ClipboardList, Edit3, FileText, User } from 'lucide-react';
import { useCRM } from '@/lib/store';
import { useToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import { generateWorkOrderPDF } from '@/lib/pdf';
import s from './WorkOrderDetail.module.css';

function badgeKey(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function money(value) {
  return Number(value || 0).toLocaleString();
}

export default function WorkOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const {
    workOrders,
    contacts,
    employees,
    accessibleBusinessUnits,
    updateWorkOrder,
    loaded,
    access,
    scopeLabel,
  } = useCRM();
  const [activeTab, setActiveTab] = useState('overview');
  const [editForm, setEditForm] = useState(null);
  const canWriteWorkOrders = Boolean(access?.canWriteWorkOrders);

  const workOrder = useMemo(
    () => workOrders.find((row) => row.id === params.id),
    [params.id, workOrders]
  );
  const relatedContact = useMemo(
    () => contacts.find((contact) => contact.id === workOrder?.contactId),
    [contacts, workOrder?.contactId]
  );
  const assignedEmployee = useMemo(
    () => employees.find((employee) => employee.id === workOrder?.assignedTo),
    [employees, workOrder?.assignedTo]
  );
  const assignedDivision = useMemo(
    () => accessibleBusinessUnits.find((unit) => unit.id === workOrder?.businessUnitId),
    [accessibleBusinessUnits, workOrder?.businessUnitId]
  );

  function openEditModal() {
    if (!canWriteWorkOrders || !workOrder) return;
    setEditForm({ ...workOrder });
  }

  async function handleEditSave() {
    if (!editForm || !workOrder) return;
    try {
      await updateWorkOrder(workOrder.id, editForm);
      toast('Work order updated');
      setEditForm(null);
    } catch (error) {
      toast(error?.message || 'Work order update failed.', 'error');
    }
  }

  if (!loaded) return <div className="empty-state">Loading...</div>;
  if (!workOrder) return <div className="empty-state">Work order not found</div>;

  return (
    <div className={s.detailPage + ' fade-in'}>
      <div className="page-header">
        <button className={s.btnBack} onClick={() => router.push('/work-orders')}>
          <ArrowLeft size={18} /> Back to Work Orders
        </button>
        <div className={s.headerActions}>
          <button className="btn" onClick={() => { generateWorkOrderPDF(workOrder); toast('PDF generated'); }}>
            <FileText size={16} /> Export PDF
          </button>
          {canWriteWorkOrders && (
            <button className="btn btn-primary" onClick={openEditModal}>
              <Edit3 size={16} /> Edit Order
            </button>
          )}
        </div>
      </div>

      <div className={s.detailLayout}>
        <aside className={s.profileCard}>
          <div className={s.profileHeader}>
            <div className={s.profileIcon}><ClipboardList size={32} /></div>
            <h1 className={s.profileName}>{workOrder.title}</h1>
            <div className={s.badgeStack}>
              <span className={`badge badge-${badgeKey(workOrder.status)}`}>{workOrder.status}</span>
              <span className={`badge badge-${badgeKey(workOrder.priority)}`}>{workOrder.priority} Priority</span>
            </div>
          </div>

          <div className={s.profileInfo}>
            <div className={s.infoItem}>
              <span className={s.infoLabel}>Number</span>
              <span>{workOrder.number || 'Unassigned'}</span>
            </div>
            <div className={s.infoItem}>
              <span className={s.infoLabel}>Client</span>
              <span>{workOrder.client || relatedContact?.name || 'Unassigned'}</span>
            </div>
            <div className={s.infoItem}>
              <span className={s.infoLabel}>Due</span>
              <span>{workOrder.dueDate || 'No date'}</span>
            </div>
            <div className={s.infoItem}>
              <span className={s.infoLabel}>Cost</span>
              <span>$${money(workOrder.estimatedCost)}</span>
            </div>
            <div className={s.infoItem}>
              <span className={s.infoLabel}>{scopeLabel}</span>
              <span>{assignedDivision?.name || 'Unassigned'}</span>
            </div>
          </div>

          <div className={s.assignment}>
            <div className={s.assignmentLabel}>Assigned Technician</div>
            <div className={s.assignmentUser}>
              <div className={s.userAvatar}>{assignedEmployee?.name?.charAt(0) || '?'}</div>
              <span>{assignedEmployee?.name || 'Unassigned'}</span>
            </div>
          </div>
        </aside>

        <main className={s.contentSection}>
          <div className={s.contentTabs}>
            <button className={`${s.contentTab} ${activeTab === 'overview' ? s.active : ''}`} onClick={() => setActiveTab('overview')}>
              Overview
            </button>
            <button className={`${s.contentTab} ${activeTab === 'description' ? s.active : ''}`} onClick={() => setActiveTab('description')}>
              Description
            </button>
          </div>

          <section className={s.contentPanel}>
            {activeTab === 'overview' && (
              <>
                <div className={s.detailGrid}>
                  <div className={s.detailItem}>
                    <div className={s.detailLabel}>Status</div>
                    <div className={s.detailValue}>{workOrder.status}</div>
                  </div>
                  <div className={s.detailItem}>
                    <div className={s.detailLabel}>Priority</div>
                    <div className={s.detailValue}>{workOrder.priority}</div>
                  </div>
                  <div className={s.detailItem}>
                    <div className={s.detailLabel}>Due date</div>
                    <div className={s.detailValue}><Calendar size={14} /> {workOrder.dueDate || 'No date'}</div>
                  </div>
                  <div className={s.detailItem}>
                    <div className={s.detailLabel}>Estimated cost</div>
                    <div className={s.detailValue}>$${money(workOrder.estimatedCost)}</div>
                  </div>
                </div>
                {relatedContact && (
                  <Link className={s.linkedContact} href={`/contacts/${relatedContact.id}`}>
                    <User size={16} /> Open linked contact: {relatedContact.name}
                  </Link>
                )}
              </>
            )}

            {activeTab === 'description' && (
              <div className={s.description}>
                {workOrder.description || 'No description captured yet.'}
              </div>
            )}
          </section>
        </main>
      </div>

      {editForm && (
        <Modal
          open={!!editForm}
          onClose={() => setEditForm(null)}
          title="Edit Work Order"
          footer={<><button className="btn" onClick={() => setEditForm(null)}>Cancel</button><button className="btn btn-primary" onClick={handleEditSave}>Save</button></>}
        >
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">WO Number</label>
              <input className="input" value={editForm.number || ''} onChange={(event) => setEditForm((form) => ({ ...form, number: event.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Due Date</label>
              <input className="input" type="date" value={editForm.dueDate || ''} onChange={(event) => setEditForm((form) => ({ ...form, dueDate: event.target.value }))} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Title</label>
            <input className="input" value={editForm.title || ''} onChange={(event) => setEditForm((form) => ({ ...form, title: event.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Client</label>
            <select className="input select" value={editForm.contactId || ''} onChange={(event) => {
              const contact = contacts.find((row) => row.id === event.target.value);
              setEditForm((form) => ({
                ...form,
                contactId: event.target.value,
                client: contact?.name || '',
                businessUnitId: contact?.businessUnitId || contact?.primaryBusinessUnitId || form.businessUnitId || '',
              }));
            }}>
              <option value="">Select client</option>
              {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
            </select>
          </div>
          <div className="grid-3">
            <div className="form-group">
              <label className="form-label">{scopeLabel}</label>
              <select className="input select" value={editForm.businessUnitId || ''} onChange={(event) => setEditForm((form) => ({ ...form, businessUnitId: event.target.value }))}>
                {accessibleBusinessUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Priority</label>
              <select className="input select" value={editForm.priority || 'Medium'} onChange={(event) => setEditForm((form) => ({ ...form, priority: event.target.value }))}>
                {['Low', 'Medium', 'High'].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="input select" value={editForm.status || 'Pending'} onChange={(event) => setEditForm((form) => ({ ...form, status: event.target.value }))}>
                {['Pending', 'In Progress', 'Completed', 'On Hold'].map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Assigned To</label>
              <select className="input select" value={editForm.assignedTo || ''} onChange={(event) => setEditForm((form) => ({ ...form, assignedTo: event.target.value }))}>
                <option value="">Unassigned</option>
                {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Estimated Cost ($)</label>
            <input className="input" type="number" value={editForm.estimatedCost || 0} onChange={(event) => setEditForm((form) => ({ ...form, estimatedCost: Number(event.target.value) }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea className="input" rows={4} value={editForm.description || ''} onChange={(event) => setEditForm((form) => ({ ...form, description: event.target.value }))} style={{resize:'vertical'}} />
          </div>
        </Modal>
      )}
    </div>
  );
}
