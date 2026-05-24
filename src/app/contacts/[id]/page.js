'use client';
import { useEffect, useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useCRM } from '@/lib/store';
import { useToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import s from './ContactDetail.module.css';
import { 
  AlertCircle, ArrowLeft, Mail, Phone, MapPin, Calendar, 
  Plus, FileText, ClipboardList, 
  MessageSquare, Edit3, Tag, Activity, CheckSquare, MessageCircle
} from 'lucide-react';
import { PIPELINE_STATUSES } from '@/lib/sales-workflow';

const TIMELINE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'note', label: 'Notes' },
  { value: 'task', label: 'Tasks' },
  { value: 'message', label: 'Messages' },
  { value: 'work_order', label: 'Work orders' },
  { value: 'lead', label: 'Leads' },
  { value: 'activity', label: 'Activity' },
];

function noteTimelineItem(note) {
  return {
    id: `note:${note.id || note.date || note.text}`,
    type: 'note',
    typeLabel: 'Note',
    title: 'Note',
    text: note.text || note.body || '',
    date: note.date || note.createdAt || '',
    timestamp: note.timestamp || note.createdAt || note.date || '',
    linkedRecords: [],
  };
}

function dateLabel(item) {
  const raw = item.timestamp || item.date;
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return String(raw).slice(0, 10);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: item.timestamp ? 'numeric' : undefined,
    minute: item.timestamp ? '2-digit' : undefined,
  }).format(date);
}

function timelineIcon(type) {
  if (type === 'task') return <CheckSquare size={16} />;
  if (type === 'message') return <MessageCircle size={16} />;
  if (type === 'work_order') return <ClipboardList size={16} />;
  if (type === 'lead') return <Tag size={16} />;
  if (type === 'note') return <MessageSquare size={16} />;
  return <Activity size={16} />;
}

export default function ContactDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { contacts, workOrders, financials, updateContact, loaded, employees, sources, access, dataSource } = useCRM();
  const [activeTab, setActiveTab] = useState('timeline');
  const [timelineFilter, setTimelineFilter] = useState('all');
  const [serverTimeline, setServerTimeline] = useState({ contactId: '', reloadKey: -1, items: null, error: false });
  const [timelineReloadKey, setTimelineReloadKey] = useState(0);
  const [noteInput, setNoteInput] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const contact = useMemo(() => contacts.find(c => c.id === params.id), [contacts, params.id]);
  const contactWorkOrders = useMemo(() => workOrders.filter(wo => wo.contactId === params.id), [workOrders, params.id]);
  const contactFinancials = useMemo(() => financials.filter(f => f.contactId === params.id), [financials, params.id]);
  const assignedEmployee = useMemo(() => employees.find(e => e.id === contact?.assignedTo), [employees, contact]);
  const fallbackTimeline = useMemo(() => {
    if (!contact) return [];
    if (Array.isArray(contact.timeline) && contact.timeline.length) return contact.timeline;
    return (contact.notes || []).map(noteTimelineItem).sort((a, b) => (b.timestamp || b.date).localeCompare(a.timestamp || a.date));
  }, [contact]);
  const hasMatchingServerTimeline = serverTimeline.contactId === contact?.id && serverTimeline.reloadKey === timelineReloadKey;
  const timelineStatus = dataSource === 'postgres' && contact?.id && !hasMatchingServerTimeline
    ? 'loading'
    : hasMatchingServerTimeline && serverTimeline.error
      ? 'error'
      : 'idle';
  const timelineSource = hasMatchingServerTimeline && serverTimeline.items ? serverTimeline.items : fallbackTimeline;
  const timelineCounts = useMemo(() => timelineSource.reduce((counts, item) => {
    counts.all += 1;
    counts[item.type] = (counts[item.type] || 0) + 1;
    return counts;
  }, { all: 0 }), [timelineSource]);
  const timeline = useMemo(() => {
    if (timelineFilter === 'all') return timelineSource;
    return timelineSource.filter((item) => item.type === timelineFilter);
  }, [timelineFilter, timelineSource]);

  useEffect(() => {
    if (!contact?.id || dataSource !== 'postgres') return undefined;
    let cancelled = false;
    const requestContactId = contact.id;
    const requestReloadKey = timelineReloadKey;
    fetch(`/api/contacts/${contact.id}/timeline`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Timeline load failed.');
        if (!cancelled) {
          setServerTimeline({
            contactId: requestContactId,
            reloadKey: requestReloadKey,
            items: Array.isArray(payload.timeline) ? payload.timeline : [],
            error: false,
          });
        }
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          setServerTimeline({
            contactId: requestContactId,
            reloadKey: requestReloadKey,
            items: null,
            error: true,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [contact?.id, dataSource, timelineReloadKey]);

  // For Edit Modal
  const [editForm, setEditForm] = useState(null);

  const openEditModal = () => {
    if (!access.canWriteCrm) return;
    setEditForm({ ...contact });
    setIsEditModalOpen(true);
  };

  const handleEditSave = () => {
    updateContact(contact.id, editForm)
      .then(() => {
        toast('Profile updated');
        setTimelineReloadKey((key) => key + 1);
        setIsEditModalOpen(false);
      })
      .catch((error) => {
        toast(error.message || 'Profile update failed', 'error');
      });
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
    updateContact(contact.id, { notes: updatedNotes })
      .then(() => {
        setNoteInput('');
        setTimelineReloadKey((key) => key + 1);
        toast('Note added');
      })
      .catch((error) => {
        toast(error.message || 'Note save failed', 'error');
      });
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

          {(contact.currentStage || contact.nextAction || contact.tags?.length) && (
            <div className={s.workflowCard}>
              <div className={s.workflowHeader}>
                <AlertCircle size={15} />
                <span>{contact.currentStage || contact.status}</span>
              </div>
              {contact.nextAction && <div className={s.workflowNext}>{contact.nextAction}</div>}
              {!!contact.tags?.length && (
                <div className={s.workflowTags}>
                  {contact.tags.map((tag) => (
                    <span key={tag} className={s.workflowTag}><Tag size={11} /> {tag.replaceAll('_', ' ')}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className={s.profileInfo}>
            <div className={s.infoItem}><Mail size={16} /> <span>{contact.email}</span></div>
            <div className={s.infoItem}><Phone size={16} /> <span>{contact.phone}</span></div>
            {contact.address && <div className={s.infoItem}><MapPin size={16} /> <span>{contact.address}</span></div>}
            <div className={s.infoItem}><Calendar size={16} /> <span>Last contact: {contact.lastContact}</span></div>
          </div>

          <div className={s.profileAssignment}>
            <div className={s.assignmentLabel}>Assigned To</div>
            <div className={s.assignmentUser}>
              <div className={s.userAvatarSmall}>{assignedEmployee?.name?.charAt(0)}</div>
              <span>{assignedEmployee?.name || 'Unassigned'}</span>
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

                <div className={s.timelineToolbar}>
                  <div className={s.timelineFilters} aria-label="Timeline filters">
                    {TIMELINE_FILTERS.map((filter) => (
                      <button
                        key={filter.value}
                        className={`${s.timelineFilter} ${timelineFilter === filter.value ? s.active : ''}`}
                        onClick={() => setTimelineFilter(filter.value)}
                        type="button"
                      >
                        {filter.label}
                        <span>{timelineCounts[filter.value] || 0}</span>
                      </button>
                    ))}
                  </div>
                  {timelineStatus === 'loading' && <div className={s.timelineStatus}>Syncing</div>}
                  {timelineStatus === 'error' && <div className={s.timelineStatus}>Using cached timeline</div>}
                </div>

                <div className={s.timeline}>
                  {timeline.map((item) => (
                    <div key={item.id} className={s.timelineItem}>
                      <div className={s.timelineIcon}>{timelineIcon(item.type)}</div>
                      <div className={s.timelineBody}>
                        <div className={s.timelineMeta}>
                          <span className={s.timelineType}>{item.typeLabel || item.type}</span>
                          <span className={s.timelineDate}>{dateLabel(item)}</span>
                        </div>
                        {item.title && item.title !== item.typeLabel && (
                          <div className={s.timelineTitle}>{item.title}</div>
                        )}
                        <div className={s.timelineText}>{item.text}</div>
                        <div className={s.timelineDetails}>
                          {item.actor?.name && <span>By {item.actor.name}</span>}
                          {item.source?.label && <span>{item.source.label}{item.source.row ? ` row ${item.source.row}` : ''}</span>}
                          {item.businessUnit?.name && <span>{item.businessUnit.name}</span>}
                          {(item.linkedRecords || [])
                            .filter((record) => record.type !== 'contact')
                            .map((record) => <span key={`${item.id}-${record.type}-${record.id}`}>{record.label}</span>)}
                        </div>
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
              {PIPELINE_STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Assigned To</label>
            <select className="input select" value={editForm.assignedTo} onChange={e => setEditForm({...editForm, assignedTo: e.target.value})}>
              <option value="">Unassigned</option>
              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </div>
        </Modal>
      )}
    </div>
  );
}
