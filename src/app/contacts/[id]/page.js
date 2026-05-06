'use client';
import { useState, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useCRM } from '@/lib/store';
import { useToast } from '@/components/Toast';
import { 
  ArrowLeft, Mail, Phone, MapPin, Calendar, 
  Clock, Plus, FileText, ClipboardList, Send, 
  CheckCircle, MessageSquare, Edit3
} from 'lucide-react';

export default function ContactDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { contacts, workOrders, financials, updateContact, loaded, employees } = useCRM();
  const [activeTab, setActiveTab] = useState('timeline');
  const [noteInput, setNoteInput] = useState('');

  const contact = useMemo(() => contacts.find(c => c.id === params.id), [contacts, params.id]);
  const contactWorkOrders = useMemo(() => workOrders.filter(wo => wo.contactId === params.id), [workOrders, params.id]);
  const contactFinancials = useMemo(() => financials.filter(f => f.contactId === params.id), [financials, params.id]);
  const assignedEmployee = useMemo(() => employees.find(e => e.id === contact?.assignedTo), [employees, contact]);

  if (loaded && !contact) {
    return <div className="empty-state">Contact not found</div>;
  }

  const addNote = () => {
    if (!noteInput.trim()) return;
    const newNote = {
      text: noteInput,
      date: new Date().toISOString().slice(0, 10),
      id: crypto.randomUUID()
    };
    const updatedNotes = Array.isArray(contact.notes) ? [...contact.notes, newNote] : [newNote];
    updateContact(contact.id, { notes: updatedNotes });
    setNoteInput('');
    toast('Note added to timeline');
  };

  const timeline = useMemo(() => {
    if (!contact) return [];
    const notes = (contact.notes || []).map(n => ({ ...n, type: 'note', icon: <MessageSquare size={16} /> }));
    // We could add status changes or related record creations to this list if we tracked them
    return [...notes].sort((a, b) => b.date.localeCompare(a.date));
  }, [contact]);

  if (!loaded) return <div className="empty-state">Loading...</div>;

  return (
    <div className="detail-page fade-in">
      <div className="page-header">
        <button className="btn-back" onClick={() => router.back()}>
          <ArrowLeft size={18} /> Back to Contacts
        </button>
      </div>

      <div className="detail-layout">
        {/* Left Sidebar: Profile */}
        <div className="profile-card">
          <div className="profile-header">
            <div className="profile-avatar">{contact.name.charAt(0)}</div>
            <h1 className="profile-name">{contact.name}</h1>
            <span className={`badge badge-${contact.status.toLowerCase().replace(' ', '')}`}>{contact.status}</span>
          </div>

          <div className="profile-info">
            <div className="info-item"><Mail size={16} /> <span>{contact.email}</span></div>
            <div className="info-item"><Phone size={16} /> <span>{contact.phone}</span></div>
            <div className="info-item"><MapPin size={16} /> <span>Austin, TX</span></div>
            <div className="info-item"><Calendar size={16} /> <span>Last contact: {contact.lastContact}</span></div>
          </div>

          <div className="profile-assignment">
            <div className="assignment-label">Assigned To</div>
            <div className="assignment-user">
              <div className="user-avatar">{assignedEmployee?.name?.charAt(0)}</div>
              <span>{assignedEmployee?.name}</span>
            </div>
          </div>
          
          <button className="btn btn-block" style={{marginTop: 20}}>
            <Edit3 size={16} style={{marginRight: 8}} /> Edit Profile
          </button>
        </div>

        {/* Right Section: Content */}
        <div className="content-section">
          <div className="content-tabs">
            <button className={`content-tab ${activeTab === 'timeline' ? 'active' : ''}`} onClick={() => setActiveTab('timeline')}>Timeline</button>
            <button className={`content-tab ${activeTab === 'workorders' ? 'active' : ''}`} onClick={() => setActiveTab('workorders')}>Work Orders ({contactWorkOrders.length})</button>
            <button className={`content-tab ${activeTab === 'financials' ? 'active' : ''}`} onClick={() => setActiveTab('financials')}>Financials ({contactFinancials.length})</button>
          </div>

          <div className="tab-content">
            {activeTab === 'timeline' && (
              <div className="timeline-view">
                <div className="note-box">
                  <textarea 
                    className="input" 
                    placeholder="Type a note or activity update..." 
                    value={noteInput}
                    onChange={e => setNoteInput(e.target.value)}
                  />
                  <div className="note-box-footer">
                    <button className="btn btn-primary btn-sm" onClick={addNote}>
                      <Plus size={14} /> Add Note
                    </button>
                  </div>
                </div>

                <div className="timeline">
                  {timeline.map((item, i) => (
                    <div key={i} className="timeline-item">
                      <div className="timeline-icon">{item.icon}</div>
                      <div className="timeline-body">
                        <div className="timeline-meta">
                          <span className="timeline-type">Note</span>
                          <span className="timeline-date">{item.date}</span>
                        </div>
                        <div className="timeline-text">{item.text}</div>
                      </div>
                    </div>
                  ))}
                  {timeline.length === 0 && (
                    <div className="timeline-empty">No activity recorded yet.</div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'workorders' && (
              <div className="records-list">
                {contactWorkOrders.map(wo => (
                  <div key={wo.id} className="record-card">
                    <div className="record-main">
                      <div className="record-icon"><ClipboardList size={20} /></div>
                      <div>
                        <div className="record-title">{wo.title}</div>
                        <div className="record-subtitle">{wo.number} • Due {wo.dueDate}</div>
                      </div>
                    </div>
                    <span className={`badge badge-${wo.status.toLowerCase().replace(' ', '')}`}>{wo.status}</span>
                  </div>
                ))}
                {contactWorkOrders.length === 0 && <div className="empty-state">No work orders linked.</div>}
              </div>
            )}

            {activeTab === 'financials' && (
              <div className="records-list">
                {contactFinancials.map(f => (
                  <div key={f.id} className="record-card">
                    <div className="record-main">
                      <div className="record-icon"><FileText size={20} /></div>
                      <div>
                        <div className="record-title">{f.type} {f.number}</div>
                        <div className="record-subtitle">{f.date}</div>
                      </div>
                    </div>
                    <div className="record-value">
                      <div className="value-amount">${f.amount.toLocaleString()}</div>
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

      <style jsx>{`
        .detail-page {
          max-width: 1200px;
          margin: 0 auto;
        }
        .btn-back {
          background: none;
          border: none;
          color: var(--text-muted);
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          font-size: var(--text-sm);
          padding: 8px 0;
        }
        .btn-back:hover { color: var(--text-primary); }

        .detail-layout {
          display: grid;
          grid-template-columns: 320px 1fr;
          gap: 24px;
          margin-top: 16px;
        }

        .profile-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-xl);
          padding: 24px;
          height: fit-content;
          position: sticky;
          top: 24px;
        }
        .profile-header {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          margin-bottom: 24px;
        }
        .profile-avatar {
          width: 80px;
          height: 80px;
          background: var(--accent);
          color: white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 32px;
          font-weight: 700;
          margin-bottom: 16px;
          box-shadow: var(--shadow-md);
        }
        .profile-name {
          font-size: 22px;
          font-weight: 700;
          margin-bottom: 8px;
        }
        
        .profile-info {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-bottom: 24px;
          padding: 16px 0;
          border-top: 1px solid var(--border-subtle);
          border-bottom: 1px solid var(--border-subtle);
        }
        .info-item {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: var(--text-sm);
          color: var(--text-secondary);
        }

        .profile-assignment {
          background: var(--bg-tertiary);
          padding: 12px;
          border-radius: var(--radius-md);
        }
        .assignment-label {
          font-size: 10px;
          text-transform: uppercase;
          color: var(--text-muted);
          font-weight: 700;
          margin-bottom: 8px;
        }
        .assignment-user {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: var(--text-sm);
          font-weight: 500;
        }

        .content-section {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .content-tabs {
          display: flex;
          gap: 8px;
          border-bottom: 1px solid var(--border-subtle);
          padding-bottom: 0;
        }
        .content-tab {
          background: none;
          border: none;
          padding: 12px 16px;
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--text-muted);
          cursor: pointer;
          position: relative;
        }
        .content-tab.active {
          color: var(--accent);
        }
        .content-tab.active::after {
          content: '';
          position: absolute;
          bottom: -1px;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--accent);
        }

        .tab-content {
          background: var(--bg-secondary);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-xl);
          min-height: 500px;
          padding: 24px;
        }

        .note-box {
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          overflow: hidden;
          margin-bottom: 24px;
          background: var(--bg-tertiary);
        }
        .note-box textarea {
          border: none;
          background: none;
          padding: 16px;
          width: 100%;
          min-height: 100px;
          resize: none;
          font-size: var(--text-sm);
        }
        .note-box-footer {
          padding: 8px 16px;
          display: flex;
          justify-content: flex-end;
          border-top: 1px solid var(--border-subtle);
          background: var(--bg-secondary);
        }

        .timeline {
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        .timeline-item {
          display: flex;
          gap: 16px;
          padding-bottom: 24px;
          position: relative;
        }
        .timeline-item::before {
          content: '';
          position: absolute;
          left: 17px;
          top: 36px;
          bottom: 0;
          width: 2px;
          background: var(--border-subtle);
        }
        .timeline-item:last-child::before { display: none; }
        
        .timeline-icon {
          width: 36px;
          height: 36px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-subtle);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          flex-shrink: 0;
          z-index: 1;
        }
        .timeline-body {
          flex: 1;
          background: var(--bg-tertiary);
          padding: 16px;
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-subtle);
        }
        .timeline-meta {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .timeline-type {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .timeline-date {
          font-size: var(--text-xs);
          color: var(--text-muted);
        }
        .timeline-text {
          font-size: var(--text-sm);
          color: var(--text-primary);
          line-height: 1.5;
        }

        .records-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .record-card {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
        }
        .record-main {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .record-icon {
          width: 40px;
          height: 40px;
          background: var(--bg-secondary);
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--accent);
        }
        .record-title {
          font-weight: 600;
          font-size: var(--text-sm);
        }
        .record-subtitle {
          font-size: var(--text-xs);
          color: var(--text-muted);
          margin-top: 2px;
        }
        .record-value {
          text-align: right;
        }
        .value-amount {
          font-weight: 700;
          font-size: var(--text-md);
          margin-bottom: 4px;
        }
      `}</style>
    </div>
  );
}
