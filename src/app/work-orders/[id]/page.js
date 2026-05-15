'use client';
import { useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useCRM } from '@/lib/store';
import { useToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import s from './WorkOrderDetail.module.css';
import { 
  ArrowLeft, ClipboardList, User, Calendar, AlertCircle,
  Plus, MessageSquare, Edit3, CheckCircle, Clock
} from 'lucide-react';
import { generateWorkOrderPDF } from '@/lib/pdf';

export default function WorkOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { workOrders, contacts, employees, accessibleBusinessUnits, updateWorkOrder, loaded, access } = useCRM();
  const [activeTab, setActiveTab] = useState('timeline');
  const [noteInput, setNoteInput] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const workOrder = useMemo(() => workOrders.find(wo => wo.id === params.id), [workOrders, params.id]);
  const relatedContact = useMemo(() => contacts.find(c => c.id === workOrder?.contactId), [contacts, workOrder]);
  const assignedEmployee = useMemo(() => employees.find(e => e.id === workOrder?.assignedTo), [employees, workOrder]);
  const assignedDivision = useMemo(() => accessibleBusinessUnits.find(u => u.id === workOrder?.businessUnitId), [accessibleBusinessUnits, workOrder]);

  const timeline = useMemo(() => {
    if (!workOrder) return [];
    const notes = (workOrder.notes || []).map(n => ({ ...n, type: 'note', icon: <MessageSquare size={16} /> }));
    // If we had history of status changes, we'd add them here. For now just notes.
    return [...notes].sort((a, b) => b.date.localeCompare(a.date));
  }, [workOrder]);

  // For Edit Modal
  const [editForm, setEditForm] = useState(null);

  const openEditModal = () => {
    if (!access.canWriteWorkOrders) return;
    setEditForm({ ...workOrder });
    setIsEditModalOpen(true);
  };

  const handleEditSave = () => {
    updateWorkOrder(workOrder.id, editForm);
    toast('Work Order updated');
    setIsEditModalOpen(false);
  };

  if (loaded && !workOrder) {
    return <div className="empty-state">Work Order not found</div>;
  }

  const addNote = () => {
    if (!noteInput.trim()) return;
    if (!access.canWriteWorkOrders) return;
    const newNote = {
      text: noteInput,
      date: new Date().toISOString().slice(0, 10),
      id: crypto.randomUUID()
    };
    const updatedNotes = Array.isArray(workOrder.notes) ? [...workOrder.notes, newNote] : [newNote];
    updateWorkOrder(workOrder.id, { notes: updatedNotes });
    setNoteInput('');
    toast('Note added');
  };

  if (!loaded) return <div className="empty-state">Loading...</div>;

  return (
    <div className={s.detailPage + " fade-in"}>
      <div className="page-header" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <button className={s.btnBack} onClick={() => router.push('/work-orders')}>
          <ArrowLeft size={18} /> Back to Work Orders
        </button>
        <div style={{display: 'flex', gap: 8}}>
          <button className="btn" onClick={() => { generateWorkOrderPDF(workOrder); toast('PDF Generated'); }}>
            Export PDF
          </button>
          {access.canWriteWorkOrders && (
            <button className="btn btn-primary" onClick={openEditModal}>
              <Edit3 size={16} style={{marginRight: 8}} /> Edit Order
            </button>
          )}
        </div>
      </div>

      <div className={s.detailLayout}>
        {/* Left Sidebar: Profile */}
        <div className={s.profileCard}>
          <div className={s.profileHeader}>
            <div className={s.profileAvatarLarge} style={{background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-default)'}}>
              <ClipboardList size={32} />
            </div>
            <h1 className={s.profileName}>{workOrder.title}</h1>
            <div style={{display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap'}}>
              <span className={`badge badge-${workOrder.status.toLowerCase().replace(' ', '')}`}>{workOrder.status}</span>
              <span className={`badge badge-${workOrder.priority.toLowerCase()}`}>{workOrder.priority} Priority</span>
            </div>
          </div>

          <div className={s.profileInfo}>
            <div className={s.infoItem}>
              <span style={{color: 'var(--text-muted)', width: 60, fontSize: 10, textTransform: 'uppercase', fontWeight: 600}}>Number</span> 
              <span>{workOrder.number}</span>
            </div>
            <div className={s.infoItem}>
              <span style={{color: 'var(--text-muted)', width: 60, fontSize: 10, textTransform: 'uppercase', fontWeight: 600}}>Client</span> 
              <span>{workOrder.client}</span>
            </div>
            <div className={s.infoItem}>
              <span style={{color: 'var(--text-muted)', width: 60, fontSize: 10, textTransform: 'uppercase', fontWeight: 600}}>Due</span> 
              <span style={{display: 'flex', alignItems: 'center', gap: 4}}>
                <Calendar size={14} /> {workOrder.dueDate || 'No Date'}
              </span>
            </div>
            <div className={s.infoItem}>
              <span style={{color: 'var(--text-muted)', width: 60, fontSize: 10, textTransform: 'uppercase', fontWeight: 600}}>Cost</span> 
              <span>${(workOrder.estimatedCost || 0).toLocaleString()}</span>
            </div>
            <div className={s.infoItem}>
              <span style={{color: 'var(--text-muted)', width: 60, fontSize: 10, textTransform: 'uppercase', fontWeight: 600}}>Division</span> 
              <span>{assignedDivision?.name || 'Unassigned'}</span>
            </div>
          </div>

          <div className={s.profileAssignment}>
            <div className={s.assignmentLabel}>Assigned Technician</div>
            <div className={s.assignmentUser}>
              <div className={s.userAvatarSmall}>{assignedEmployee?.name?.charAt(0) || '?'}</div>
              <span>{assignedEmployee?.name || 'Unassigned'}</span>
            </div>
          </div>
        </div>

        {/* Right Section: Content */}
        <div className={s.contentSection}>
          <div className={s.contentTabs}>
            <button className={`${s.contentTab} ${activeTab === 'timeline' ? s.active : ''}`} onClick={() => setActiveTab('timeline')}>Timeline</button>
            <button className={`${s.contentTab} ${activeTab === 'details' ? s.active : ''}`} onClick={() => setActiveTab('details')}>Details</button>
          </div>

          <div className={s.tabContent}>
            {activeTab === 'timeline' && (
              <div className={s.timelineView}>
                <div className={s.noteBox}>
                  <textarea 
                    placeholder="Add an update or note to this work order..." 
                    value={noteInput}
                    onChange={e => setNoteInput(e.target.value)}
                    disabled={!access.canWriteWorkOrders}
                  />
                  <div className={s.noteBoxFooter}>
                    <button className="btn btn-primary btn-sm" onClick={addNote} disabled={!access.canWriteWorkOrders}>
                      <Plus size={14} /> Post Update
                    </button>
                  </div>
                </div>

                <div className={s.timeline}>
                  {timeline.map((item, i) => (
                    <div key={i} className={s.timelineItem}>
                      <div className={s.timelineIcon}>{item.icon}</div>
                      <div className={s.timelineBody}>
                        <div className={s.timelineMeta}>
                          <span className={s.timelineType}>Update</span>
                          <span className={s.timelineDate}>{item.date}</span>
                        </div>
                        <div className={s.timelineText}>{item.text}</div>
                      </div>
                    </div>
                  ))}
                  {timeline.length === 0 && (
                    <div className={s.timelineEmpty} style={{padding: 32, textAlign: 'center', color: 'var(--text-muted)'}}>
                      No updates recorded yet.
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'details' && (
              <div className="grid-2">
                <div className="card">
                  <div className="card-title">Description</div>
                  <p style={{fontSize: 'var(--text-sm)', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.6}}>
                    {workOrder.description || "No description provided."}
                  </p>
                </div>
                
                <div className="card">
                  <div className="card-title">Associated Contact</div>
                  {relatedContact ? (
                    <div style={{display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)'}}>
                      <div style={{width: 40, height: 40, borderRadius: '50%', background: 'var(--accent)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600}}>
                        {relatedContact.name.charAt(0)}
                      </div>
                      <div style={{flex: 1}}>
                        <div style={{fontWeight: 600, fontSize: 'var(--text-sm)'}}>{relatedContact.name}</div>
                        <div style={{fontSize: 'var(--text-xs)', color: 'var(--text-muted)'}}>{relatedContact.email}</div>
                      </div>
                      <button className="btn btn-sm" onClick={() => router.push(`/contacts/${relatedContact.id}`)}>
                        View
                      </button>
                    </div>
                  ) : (
                    <p style={{fontSize: 'var(--text-sm)', color: 'var(--text-muted)'}}>No contact linked to this work order.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Work Order Modal */}
      {isEditModalOpen && editForm && (
        <Modal 
          open={isEditModalOpen} 
          onClose={() => setIsEditModalOpen(false)} 
          title="Edit Work Order"
          footer={<><button className="btn" onClick={() => setIsEditModalOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={handleEditSave}>Save Changes</button></>}
        >
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Title</label>
              <input className="input" value={editForm.title} onChange={e => setEditForm({...editForm, title: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">Client/Project</label>
              <input className="input" value={editForm.client} onChange={e => setEditForm({...editForm, client: e.target.value})} />
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="input select" value={editForm.status} onChange={e => setEditForm({...editForm, status: e.target.value})}>
                {['Pending', 'In Progress', 'Completed', 'On Hold'].map(st => <option key={st} value={st}>{st}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Priority</label>
              <select className="input select" value={editForm.priority} onChange={e => setEditForm({...editForm, priority: e.target.value})}>
                {['Low', 'Medium', 'High'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Due Date</label>
              <input type="date" className="input" value={editForm.dueDate} onChange={e => setEditForm({...editForm, dueDate: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">Estimated Cost</label>
              <input type="number" className="input" value={editForm.estimatedCost} onChange={e => setEditForm({...editForm, estimatedCost: parseFloat(e.target.value) || 0})} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea className="input" style={{resize: 'vertical', minHeight: 80}} value={editForm.description} onChange={e => setEditForm({...editForm, description: e.target.value})} />
          </div>
        </Modal>
      )}
    </div>
  );
}
