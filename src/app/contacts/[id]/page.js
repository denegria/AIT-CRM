'use client';
import { useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useCRM } from '@/lib/store';
import { useToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import s from './ContactDetail.module.css';
import { 
  ArrowLeft, Mail, Phone, MapPin, Calendar, 
  Plus, FileText, ClipboardList, 
  MessageSquare, Edit3
} from 'lucide-react';

export default function ContactDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { contacts, workOrders, financials, updateContact, loaded, employees, sources, access } = useCRM();
  const [activeTab, setActiveTab] = useState('timeline');
  const [noteInput, setNoteInput] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const contact = useMemo(() => contacts.find(c => c.id === params.id), [contacts, params.id]);
  const contactWorkOrders = useMemo(() => workOrders.filter(wo => wo.contactId === params.id), [workOrders, params.id]);
  const contactFinancials = useMemo(() => financials.filter(f => f.contactId === params.id), [financials, params.id]);
  const assignedEmployee = useMemo(() => employees.find(e => e.id === contact?.assignedTo), [employees, contact]);
  const timeline = useMemo(() => {
    if (!contact) return [];
    const notes = (contact.notes || []).map(n => ({ ...n, type: 'note', icon: <MessageSquare size={16} /> }));
    return [...notes].sort((a, b) => b.date.localeCompare(a.date));
  }, [contact]);

  // For Edit Modal
  const [editForm, setEditForm] = useState(null);

  const openEditModal = () => {
    if (!access.canWriteCrm) return;
    setEditForm({ ...contact });
    setIsEditModalOpen(true);
  };

  const handleEditSave = () => {
    updateContact(contact.id, editForm);
    toast('Profile updated');
    setIsEditModalOpen(false);
  };

  if (loaded && !contact) {
    return <div className="empty-state">Contact not found</div>;
  }

  const addNote = () => {
    if (!noteInput.trim()) return;
    if (!access.canWriteCrm) return;
    const newNote = {
      text: noteInput,
      date: new Date().toISOString().slice(0, 10),
      id: crypto.randomUUID()
    };
    const updatedNotes = Array.isArray(contact.notes) ? [...contact.notes, newNote] : [newNote];
    updateContact(contact.id, { notes: updatedNotes });
    setNoteInput('');
    toast('Note added');
  };

  if (!loaded) return <div className="empty-state">Loading...</div>;

  return (
    <div className={s.detailPage + " fade-in"}>
      <div className="page-header">
        <button className={s.btnBack} onClick={() => router.back()}>
          <ArrowLeft size={18} /> Back to Contacts
        </button>
      </div>

      <div className={s.detailLayout}>
        {/* Left Sidebar: Profile */}
        <div className={s.profileCard}>
          <div className={s.profileHeader}>
            <div className={s.profileAvatarLarge}>{contact.name.charAt(0)}</div>
            <h1 className={s.profileName}>{contact.name}</h1>
            <span className={`badge badge-${contact.status.toLowerCase().replace(' ', '')}`}>{contact.status}</span>
          </div>

          <div className={s.profileInfo}>
            <div className={s.infoItem}><Mail size={16} /> <span>{contact.email}</span></div>
            <div className={s.infoItem}><Phone size={16} /> <span>{contact.phone}</span></div>
            <div className={s.infoItem}><MapPin size={16} /> <span>Austin, TX</span></div>
            <div className={s.infoItem}><Calendar size={16} /> <span>Last contact: {contact.lastContact}</span></div>
          </div>

          <div className={s.profileAssignment}>
            <div className={s.assignmentLabel}>Assigned To</div>
            <div className={s.assignmentUser}>
              <div className={s.userAvatarSmall}>{assignedEmployee?.name?.charAt(0)}</div>
              <span>{assignedEmployee?.name}</span>
            </div>
          </div>
          
          {access.canWriteCrm && (
            <button className="btn btn-block" style={{marginTop: 20}} onClick={openEditModal}>
              <Edit3 size={16} style={{marginRight: 8}} /> Edit Profile
            </button>
          )}
        </div>

        {/* Right Section: Content */}
        <div className={s.contentSection}>
          <div className={s.contentTabs}>
            <button className={`${s.contentTab} ${activeTab === 'timeline' ? s.active : ''}`} onClick={() => setActiveTab('timeline')}>Timeline</button>
            <button className={`${s.contentTab} ${activeTab === 'workorders' ? s.active : ''}`} onClick={() => setActiveTab('workorders')}>Work Orders ({contactWorkOrders.length})</button>
            <button className={`${s.contentTab} ${activeTab === 'financials' ? s.active : ''}`} onClick={() => setActiveTab('financials')}>Financials ({contactFinancials.length})</button>
          </div>

          <div className={s.tabContent}>
            {activeTab === 'timeline' && (
              <div className={s.timelineView}>
                <div className={s.noteBox}>
                  <textarea 
                    placeholder="Type a note or activity update..." 
                    value={noteInput}
                    onChange={e => setNoteInput(e.target.value)}
                    disabled={!access.canWriteCrm}
                  />
                  <div className={s.noteBoxFooter}>
                    <button className="btn btn-primary btn-sm" onClick={addNote} disabled={!access.canWriteCrm}>
                      <Plus size={14} /> Add Note
                    </button>
                  </div>
                </div>

                <div className={s.timeline}>
                  {timeline.map((item, i) => (
                    <div key={i} className={s.timelineItem}>
                      <div className={s.timelineIcon}>{item.icon}</div>
                      <div className={s.timelineBody}>
                        <div className={s.timelineMeta}>
                          <span className={s.timelineType}>Note</span>
                          <span className={s.timelineDate}>{item.date}</span>
                        </div>
                        <div className={s.timelineText}>{item.text}</div>
                      </div>
                    </div>
                  ))}
                  {timeline.length === 0 && (
                    <div className={s.timelineEmpty}>No activity recorded yet.</div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'workorders' && (
              <div className={s.recordsList}>
                {contactWorkOrders.map(wo => (
                  <div key={wo.id} className={s.recordCard}>
                    <div className={s.recordMain}>
                      <div className={s.recordIcon}><ClipboardList size={20} /></div>
                      <div>
                        <div className={s.recordTitle}>{wo.title}</div>
                        <div className={s.recordSubtitle}>{wo.number} • Due {wo.dueDate}</div>
                      </div>
                    </div>
                    <span className={`badge badge-${wo.status.toLowerCase().replace(' ', '')}`}>{wo.status}</span>
                  </div>
                ))}
                {contactWorkOrders.length === 0 && <div className="empty-state">No work orders linked.</div>}
              </div>
            )}

            {activeTab === 'financials' && (
              <div className={s.recordsList}>
                {contactFinancials.map(f => (
                  <div key={f.id} className={s.recordCard}>
                    <div className={s.recordMain}>
                      <div className={s.recordIcon}><FileText size={20} /></div>
                      <div>
                        <div className={s.recordTitle}>{f.type} {f.number}</div>
                        <div className={s.recordSubtitle}>{f.date}</div>
                      </div>
                    </div>
                    <div className={s.recordValue}>
                      <div className={s.valueAmount}>${f.amount.toLocaleString()}</div>
                      <span className={`badge badge-${f.status.toLowerCase()}`}>{f.status}</span>
                    </div>
                  </div>
                ))}
                {contactFinancials.length === 0 && <div className="empty-state">No financial records linked.</div>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Profile Modal */}
      {isEditModalOpen && editForm && (
        <Modal 
          open={isEditModalOpen} 
          onClose={() => setIsEditModalOpen(false)} 
          title="Edit Profile"
          footer={<><button className="btn" onClick={() => setIsEditModalOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={handleEditSave}>Save Changes</button></>}
        >
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input className="input" value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="input" value={editForm.email} onChange={e => setEditForm({...editForm, email: e.target.value})} />
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Phone</label>
              <input className="input" value={editForm.phone} onChange={e => setEditForm({...editForm, phone: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">Source</label>
              <select className="input select" value={editForm.source} onChange={e => setEditForm({...editForm, source: e.target.value})}>
                {sources.map(src => <option key={src} value={src}>{src}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="input select" value={editForm.status} onChange={e => setEditForm({...editForm, status: e.target.value})}>
              {['New Lead', 'Contacted', 'Qualified', 'Proposal Sent', 'Won', 'Lost'].map(st => <option key={st} value={st}>{st}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Assigned To</label>
            <select className="input select" value={editForm.assignedTo} onChange={e => setEditForm({...editForm, assignedTo: e.target.value})}>
              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </div>
        </Modal>
      )}
    </div>
  );
}
