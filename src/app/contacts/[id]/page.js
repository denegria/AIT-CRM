'use client';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCRM } from '@/lib/store';
import { useToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import s from './ContactDetail.module.css';
import { 
  AlertCircle, ArrowLeft, Mail, Phone, MapPin, Calendar, 
  Plus, FileText, ClipboardList, 
  MessageSquare, Edit3, Tag, Activity, CheckSquare, MessageCircle,
  Inbox, Send, DollarSign, Archive, BriefcaseBusiness, CheckCircle2
} from 'lucide-react';
import { PIPELINE_STATUSES } from '@/lib/sales-workflow';

const TIMELINE_FILTERS = [
  { value: 'all', label: 'All history', empty: 'No activity recorded yet.' },
  { value: 'follow_up', label: 'Follow-ups', empty: 'No follow-up attempts recorded yet.' },
  { value: 'work', label: 'Previous work', empty: 'No previous work recorded yet.' },
  { value: 'estimate', label: 'Estimates', empty: 'No estimate history recorded yet.' },
  { value: 'payment', label: 'Payments', empty: 'No payment snapshots recorded yet.' },
  { value: 'note', label: 'Notes', empty: 'No notes recorded yet.' },
  { value: 'task', label: 'Tasks', empty: 'No tasks recorded yet.' },
  { value: 'message', label: 'Messages', empty: 'No messages recorded yet.' },
  { value: 'import', label: 'Source details', empty: 'No standalone source details recorded yet.' },
];

const SNAPSHOT_ITEMS = [
  { key: 'work', label: 'Previous work', icon: ClipboardList, tone: 'work' },
  { key: 'payment', label: 'Payments', icon: DollarSign, tone: 'payment' },
  { key: 'estimate', label: 'Estimates', icon: BriefcaseBusiness, tone: 'estimate' },
  { key: 'follow_up', label: 'Follow-ups', icon: AlertCircle, tone: 'follow_up' },
];

function newManualSendRequestId() {
  return crypto.randomUUID();
}

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
    presentation: {
      category: 'note',
      categoryLabel: 'Note',
      priority: 'primary',
      provenance: null,
      isImported: false,
    },
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

function timelineDateParts(item) {
  const raw = item.timestamp || item.date;
  if (!raw) return { date: '', time: '' };
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return { date: String(raw).slice(0, 10), time: '' };
  }
  return {
    date: new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date),
    time: item.timestamp
      ? new Intl.DateTimeFormat(undefined, {
          hour: 'numeric',
          minute: '2-digit',
        }).format(date)
      : '',
  };
}

function timelineCategory(item) {
  return item.presentation?.category || item.type || 'activity';
}

function timelineCategoryLabel(item) {
  return item.presentation?.categoryLabel || item.typeLabel || item.type || 'Activity';
}

function timelineIcon(item) {
  const category = timelineCategory(item);
  if (category === 'task') return <CheckSquare size={16} />;
  if (category === 'message') return <MessageCircle size={16} />;
  if (category === 'work') return <ClipboardList size={16} />;
  if (category === 'estimate') return <BriefcaseBusiness size={16} />;
  if (category === 'payment') return <DollarSign size={16} />;
  if (category === 'lead') return <Tag size={16} />;
  if (category === 'note') return <MessageSquare size={16} />;
  if (category === 'import') return <Archive size={16} />;
  return <Activity size={16} />;
}

function timelineTone(item) {
  const category = timelineCategory(item);
  const eventType = String(item.eventType || '').toLowerCase();
  const text = String(item.text || '').toLowerCase();
  if (category === 'follow_up') return 'follow_up';
  if (category === 'work') return 'work';
  if (category === 'estimate') return 'estimate';
  if (category === 'payment') return 'payment';
  if (category === 'import') return 'imported';
  if (text.includes('wrong number') || text.includes('disconnected') || text.includes('pbx')) return 'blocked';
  if (item.type === 'message') return 'message';
  if (item.type === 'lead') return 'lead';
  return 'default';
}

function recordStageLabel(record) {
  if (!record?.stageLabel) return '';
  return record.stageLabel;
}

function recordStageAria(record) {
  if (!record?.stages?.length) return '';
  const steps = record.stages.map((step) => `${step.label} ${step.state}`).join(', ');
  return `${record.label || 'Record'} stage: ${steps}`;
}

function recordKindClass(record) {
  if (record?.kind === 'work_order') return s.recordWork;
  if (record?.kind === 'estimate') return s.recordEstimate;
  if (record?.kind === 'payment_snapshot') return s.recordPayment;
  if (record?.kind === 'website_lead') return s.recordLead;
  return '';
}

function latestTimelineItem(items, category) {
  return items.find((item) => timelineCategory(item) === category);
}

function snapshotDetail(items, category) {
  const latest = latestTimelineItem(items, category);
  if (!latest) return 'No matching history yet';
  return `Latest ${dateLabel(latest)}`;
}

function timelineEmptyText(filterValue) {
  return TIMELINE_FILTERS.find((filter) => filter.value === filterValue)?.empty || 'No activity recorded yet.';
}

function normalizedBusinessLabel(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function conversationDateLabel(message) {
  return dateLabel({ timestamp: message.timestamp || message.createdAt });
}

function conversationSourceLabel(message) {
  return message.channelConfig?.label || `${message.providerLabel || 'Provider'} ${message.channelLabel || 'Channel'}`;
}

function messageIdentityLabel(message) {
  if (message.direction === 'outbound') {
    return message.identities?.recipient ? `To ${message.identities.recipient}` : '';
  }
  return message.identities?.sender ? `From ${message.identities.sender}` : '';
}

export default function ContactDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const {
    contacts,
    workOrders,
    financials,
    updateContact,
    loaded,
    employees,
    sources,
    access,
    dataSource,
    businessUnits,
  } = useCRM();
  const [activeTab, setActiveTab] = useState('timeline');
  const [timelineFilter, setTimelineFilter] = useState('all');
  const [serverTimeline, setServerTimeline] = useState({ contactId: '', reloadKey: -1, items: null, error: false });
  const [timelineReloadKey, setTimelineReloadKey] = useState(0);
  const [serverConversations, setServerConversations] = useState({ contactId: '', reloadKey: -1, items: null, error: false });
  const [conversationReloadKey, setConversationReloadKey] = useState(0);
  const [messageTemplates, setMessageTemplates] = useState([]);
  const [manualSend, setManualSend] = useState({
    channel: 'messenger',
    templateId: '',
    textBody: '',
    requestId: newManualSendRequestId(),
    sending: false,
    blockedReasons: [],
    error: '',
  });
  const [noteInput, setNoteInput] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const contact = useMemo(() => contacts.find(c => c.id === params.id), [contacts, params.id]);
  const contactWorkOrders = useMemo(() => workOrders.filter(wo => wo.contactId === params.id), [workOrders, params.id]);
  const contactFinancials = useMemo(() => financials.filter(f => f.contactId === params.id), [financials, params.id]);
  const contactBusinessUnit = businessUnits.find((unit) => unit.id === contact?.businessUnitId || unit.id === contact?.primaryBusinessUnitId);
  const unitLabel = normalizedBusinessLabel(contactBusinessUnit?.name || contactBusinessUnit?.label);
  const sourceLabel = normalizedBusinessLabel(contact?.source);
  const isAitUsaContact = unitLabel.includes('ait usa') || sourceLabel.includes('ait usa');
  const showWorkOrdersTab = !isAitUsaContact;
  const renderedActiveTab = !showWorkOrdersTab && activeTab === 'workorders' ? 'timeline' : activeTab;
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
    const category = timelineCategory(item);
    counts[category] = (counts[category] || 0) + 1;
    return counts;
  }, { all: 0 }), [timelineSource]);
  const timeline = useMemo(() => {
    if (timelineFilter === 'all') return timelineSource;
    return timelineSource.filter((item) => timelineCategory(item) === timelineFilter);
  }, [timelineFilter, timelineSource]);
  const timelineSnapshot = useMemo(() => SNAPSHOT_ITEMS.map((item) => ({
    ...item,
    count: timelineCounts[item.key] || 0,
    detail: snapshotDetail(timelineSource, item.key),
  })), [timelineCounts, timelineSource]);
  const hasMatchingServerConversations = serverConversations.contactId === contact?.id && serverConversations.reloadKey === conversationReloadKey;
  const conversationMessages = hasMatchingServerConversations && serverConversations.items ? serverConversations.items : [];
  const conversationStatus = dataSource === 'postgres' && contact?.id && !hasMatchingServerConversations
    ? 'loading'
    : hasMatchingServerConversations && serverConversations.error
      ? 'error'
      : 'idle';

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

  useEffect(() => {
    if (!contact?.id || dataSource !== 'postgres') return undefined;
    let cancelled = false;
    const requestContactId = contact.id;
    const requestReloadKey = conversationReloadKey;
    fetch(`/api/contacts/${contact.id}/conversations`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Conversation load failed.');
        if (!cancelled) {
          setServerConversations({
            contactId: requestContactId,
            reloadKey: requestReloadKey,
            items: Array.isArray(payload.messages) ? payload.messages : [],
            error: false,
          });
        }
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          setServerConversations({
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
  }, [contact?.id, dataSource, conversationReloadKey]);

  useEffect(() => {
    if (!access.canWriteCrm || !access.canReadSettings || dataSource !== 'postgres') return undefined;
    let cancelled = false;
    fetch('/api/message-templates?purpose=manual_follow_up&status=active', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Template load failed.');
        if (!cancelled) {
          setMessageTemplates(Array.isArray(payload.templates) ? payload.templates.filter((template) => template.isEnabled) : []);
        }
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setMessageTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [access.canReadSettings, access.canWriteCrm, dataSource]);

  const channelTemplates = useMemo(() => messageTemplates.filter((template) => (
    template.channel === manualSend.channel || template.channel === 'all'
  )), [messageTemplates, manualSend.channel]);

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

  const submitManualSend = () => {
    if (!access.canWriteCrm || !contact?.id || manualSend.sending) return;
    const requestId = manualSend.requestId || newManualSendRequestId();
    setManualSend((current) => ({ ...current, sending: true, blockedReasons: [], error: '' }));
    fetch(`/api/contacts/${contact.id}/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channel: manualSend.channel,
        templateId: manualSend.templateId || null,
        textBody: manualSend.textBody,
        requestId,
      }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(payload.error || 'Manual send blocked.');
          error.payload = payload;
          throw error;
        }
        setManualSend((current) => ({
          ...current,
          sending: false,
          requestId: newManualSendRequestId(),
          textBody: '',
          blockedReasons: [],
          error: payload.audit?.ok === false
            ? (payload.audit.message || 'Message sent, but the audit update needs review.')
            : '',
        }));
        setConversationReloadKey((key) => key + 1);
        setTimelineReloadKey((key) => key + 1);
        toast(payload.audit?.ok === false ? 'Message sent, audit needs review' : 'Message sent', payload.audit?.ok === false ? 'error' : 'success');
      })
      .catch((error) => {
        const blockedReasons = Array.isArray(error.payload?.reasons) ? error.payload.reasons : [];
        setManualSend((current) => ({
          ...current,
          sending: false,
          blockedReasons,
          error: blockedReasons.length ? '' : (error.message || 'Manual send failed'),
        }));
        toast(blockedReasons[0]?.message || error.message || 'Manual send failed', 'error');
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
            <div className={s.profileTitleBlock}>
              <div className={s.profileNameRow}>
                <h1 className={s.profileName}>{contact.name}</h1>
                <span className={`badge badge-${contact.status.toLowerCase().replace(' ', '')}`}>{contact.status}</span>
              </div>
              {contact.source && <div className={s.profileSource}>Source: {contact.source}</div>}
            </div>
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
            <button className={`${s.contentTab} ${renderedActiveTab === 'timeline' ? s.active : ''}`} onClick={() => setActiveTab('timeline')}>Timeline</button>
            <button className={`${s.contentTab} ${renderedActiveTab === 'conversations' ? s.active : ''}`} onClick={() => setActiveTab('conversations')}>Conversations ({conversationMessages.length})</button>
            {showWorkOrdersTab && (
              <button className={`${s.contentTab} ${renderedActiveTab === 'workorders' ? s.active : ''}`} onClick={() => setActiveTab('workorders')}>Work Orders ({contactWorkOrders.length})</button>
            )}
            <button className={`${s.contentTab} ${renderedActiveTab === 'financials' ? s.active : ''}`} onClick={() => setActiveTab('financials')}>Financials ({contactFinancials.length})</button>
          </div>

          <div className={s.tabContent}>
            {renderedActiveTab === 'timeline' && (
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

                <div className={s.snapshotStrip} aria-label="Current contact snapshot">
                  {timelineSnapshot.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={`${s.snapshotItem} ${s[`snapshot_${item.tone}`] || ''}`}
                        onClick={() => setTimelineFilter(item.key)}
                        aria-label={`${item.label}: ${item.count} records. ${item.detail}`}
                      >
                        <span className={s.snapshotIcon}><Icon size={15} /></span>
                        <span className={s.snapshotCopy}>
                          <span>{item.label}</span>
                          <strong>{item.count}</strong>
                        </span>
                        <small>{item.detail}</small>
                      </button>
                    );
                  })}
                </div>

                <div className={s.timelineToolbar}>
                  <div className={s.timelineFilters} aria-label="Timeline filters">
                    {TIMELINE_FILTERS.map((filter) => (
                      <button
                        key={filter.value}
                        className={`${s.timelineFilter} ${timelineFilter === filter.value ? s.active : ''}`}
                        onClick={() => setTimelineFilter(filter.value)}
                        type="button"
                        aria-pressed={timelineFilter === filter.value}
                        aria-label={`${filter.label}: ${timelineCounts[filter.value] || 0} records`}
                      >
                        {filter.label}
                        <span className={s.timelineFilterCount}>{timelineCounts[filter.value] || 0}</span>
                        {timelineFilter === filter.value && <span className={s.srOnly}> selected</span>}
                      </button>
                    ))}
                  </div>
                  {timelineStatus === 'loading' && <div className={s.timelineStatus}>Syncing</div>}
                  {timelineStatus === 'error' && <div className={s.timelineStatus}>Using cached timeline</div>}
                </div>

                <div className={s.timeline}>
                  {timeline.map((item) => {
                    const dateParts = timelineDateParts(item);
                    const provenance = item.presentation?.provenance;
                    const record = item.record;
                    const visibleDetails = [
                      item.actor?.name ? `By ${item.actor.name}` : '',
                      item.businessUnit?.name || '',
                      ...(item.linkedRecords || [])
                        .filter((linkedRecord) => {
                          if (linkedRecord.type === 'contact') return false;
                          if (record?.kind === 'work_order' && linkedRecord.type === 'work_order') return false;
                          if (record?.kind === 'estimate' && linkedRecord.type === 'estimate') return false;
                          return true;
                        })
                        .map((linkedRecord) => linkedRecord.label),
                    ].filter(Boolean);
                    return (
                      <div key={item.id} className={`${s.timelineItem} ${s[`tone_${timelineTone(item)}`] || ''}`}>
                        <div className={s.timelineIcon}>{timelineIcon(item)}</div>
                        <div className={s.timelineBody}>
                          <div className={s.timelineMeta}>
                            <div className={s.timelineTypeGroup}>
                              <span className={s.timelineType}>{timelineCategoryLabel(item)}</span>
                              {item.presentation?.isImported && <span className={s.timelineEventType}>Imported history</span>}
                            </div>
                            <time className={s.timelineDateStack} dateTime={item.timestamp || item.date || undefined} title={dateLabel(item)}>
                              <span>{dateParts.date}</span>
                              {dateParts.time && <strong>{dateParts.time}</strong>}
                            </time>
                          </div>
                          {!record && item.title && item.title !== item.typeLabel && (
                            <div className={s.timelineTitle}>{item.title}</div>
                          )}
                          {record && (
                            <div className={`${s.timelineRecord} ${recordKindClass(record)}`}>
                              <div className={s.timelineRecordHeader}>
                                <div className={s.timelineRecordTitleBlock}>
                                  <span className={s.timelineRecordKind}>{record.label}</span>
                                  <strong>{record.title}</strong>
                                </div>
                                {(recordStageLabel(record) || record.href) && (
                                  <div className={s.timelineRecordActions}>
                                    {recordStageLabel(record) && (
                                      <span className={s.timelineStageBadge}>
                                        {recordStageLabel(record) === 'Completed' && <CheckCircle2 size={12} />}
                                        {recordStageLabel(record)}
                                      </span>
                                    )}
                                    {record.href && (
                                      <Link className={s.timelineRecordLink} href={record.href}>
                                        Open
                                      </Link>
                                    )}
                                  </div>
                                )}
                              </div>
                              {!!record.meta?.length && (
                                <div className={s.timelineRecordMeta}>
                                  {record.meta.map((meta) => <span key={`${item.id}-${meta}`}>{meta}</span>)}
                                </div>
                              )}
                              {!!record.stages?.length && (
                                <ol className={s.timelineStages} aria-label={recordStageAria(record)}>
                                  {record.stages.map((step) => (
                                    <li key={`${item.id}-${step.label}`} className={s[`stage_${step.state}`] || ''}>
                                      <span />
                                      <small>{step.label}</small>
                                    </li>
                                  ))}
                                </ol>
                              )}
                            </div>
                          )}
                          {item.text && <div className={`${s.timelineText} ${record ? s.timelineTextSecondary : ''}`}>{item.text}</div>}
                          {(visibleDetails.length > 0 || provenance) && (
                            <div className={s.timelineDetails}>
                              {visibleDetails.map((detail) => <span key={`${item.id}-${detail}`}>{detail}</span>)}
                              {provenance && (
                                <details className={s.timelineProvenance}>
                                  <summary>Source details</summary>
                                  <div>
                                    {provenance.sourceKind && <span>{provenance.sourceKind}</span>}
                                    {provenance.sourceLabel && (
                                      <span>{provenance.sourceLabel}{provenance.sourceRow ? ` row ${provenance.sourceRow}` : ''}</span>
                                    )}
                                    {provenance.eventType && <span>{provenance.eventType}</span>}
                                    {provenance.rawText && <pre className={s.timelineRawText}>{provenance.rawText}</pre>}
                                  </div>
                                </details>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {timeline.length === 0 && (
                    <div className={s.timelineEmpty}>{timelineEmptyText(timelineFilter)}</div>
                  )}
                </div>
              </div>
            )}

            {renderedActiveTab === 'conversations' && (
              <div className={s.conversationView}>
                <div className={s.conversationToolbar}>
                  <div className={s.conversationTitle}>
                    <MessageCircle size={17} />
                    <span>{conversationMessages.length} messages</span>
                  </div>
                  {conversationStatus === 'loading' && <div className={s.timelineStatus}>Syncing</div>}
                  {conversationStatus === 'error' && <div className={s.timelineStatus}>Conversation sync unavailable</div>}
                </div>

                {access.canWriteCrm && dataSource === 'postgres' && (
                  <div className={s.manualSendBox}>
                    <div className={s.manualSendControls}>
                      <label className={s.manualSendField}>
                        <span>Channel</span>
                        <select
                          className="input select"
                          value={manualSend.channel}
                          onChange={(event) => setManualSend((current) => ({
                            ...current,
                            channel: event.target.value,
                            templateId: '',
                            requestId: newManualSendRequestId(),
                            blockedReasons: [],
                            error: '',
                          }))}
                          disabled={manualSend.sending}
                        >
                          <option value="messenger">Messenger</option>
                          <option value="whatsapp">WhatsApp</option>
                        </select>
                      </label>
                      <label className={s.manualSendField}>
                        <span>Template</span>
                        <select
                          className="input select"
                          value={manualSend.templateId}
                          onChange={(event) => setManualSend((current) => ({
                            ...current,
                            templateId: event.target.value,
                            textBody: event.target.value ? '' : current.textBody,
                            requestId: newManualSendRequestId(),
                            blockedReasons: [],
                            error: '',
                          }))}
                          disabled={manualSend.sending}
                        >
                          <option value="">No template</option>
                          {channelTemplates.map((template) => (
                            <option key={template.id} value={template.id}>{template.displayName}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <textarea
                      className={s.manualSendText}
                      placeholder={manualSend.templateId ? 'Template body will be used' : 'Type a manual reply...'}
                      value={manualSend.textBody}
                      onChange={(event) => setManualSend((current) => ({
                        ...current,
                        textBody: event.target.value,
                        requestId: newManualSendRequestId(),
                        blockedReasons: [],
                        error: '',
                      }))}
                      disabled={manualSend.sending || Boolean(manualSend.templateId)}
                    />
                    {(manualSend.blockedReasons.length > 0 || manualSend.error) && (
                      <div className={s.manualSendBlocked}>
                        <AlertCircle size={15} />
                        <div>
                          {manualSend.blockedReasons.length > 0
                            ? manualSend.blockedReasons.map((reason) => (
                              <div key={reason.code}>{reason.message}</div>
                            ))
                            : <div>{manualSend.error}</div>}
                        </div>
                      </div>
                    )}
                    <div className={s.manualSendFooter}>
                      <button
                        className="btn btn-primary btn-sm"
                        type="button"
                        onClick={submitManualSend}
                        disabled={manualSend.sending || (!manualSend.textBody.trim() && !manualSend.templateId)}
                      >
                        <Send size={14} /> {manualSend.sending ? 'Sending' : 'Send'}
                      </button>
                    </div>
                  </div>
                )}

                <div className={s.conversationList}>
                  {conversationMessages.map((message) => (
                    <div
                      key={message.id}
                      className={`${s.conversationMessage} ${message.direction === 'outbound' ? s.outbound : s.inbound}`}
                    >
                      <div className={s.conversationIcon}>
                        {message.direction === 'outbound' ? <Send size={15} /> : <Inbox size={15} />}
                      </div>
                      <div className={s.conversationBody}>
                        <div className={s.conversationMeta}>
                          <div className={s.conversationBadges}>
                            <span className={s.providerBadge}>{message.providerLabel}</span>
                            <span className={s.channelBadge}>{message.channelLabel}</span>
                            <span className={s.directionBadge}>{message.directionLabel}</span>
                            <span className={`${s.statusBadge} ${message.deliveryStatus === 'failed' ? s.failed : ''}`}>
                              {message.deliveryStatusLabel}
                            </span>
                          </div>
                          <span className={s.conversationDate}>{conversationDateLabel(message)}</span>
                        </div>
                        <div className={s.conversationText}>
                          {message.text || <span className={s.mutedText}>No message body captured.</span>}
                        </div>
                        <div className={s.conversationDetails}>
                          <span>{conversationSourceLabel(message)}</span>
                          {messageIdentityLabel(message) && <span>{messageIdentityLabel(message)}</span>}
                          {message.businessUnit?.name && <span>{message.businessUnit.name}</span>}
                          {message.contact?.name && <span>Contact: {message.contact.name}</span>}
                          {message.lead?.status && <span>Lead: {message.lead.status}</span>}
                          {message.conversation?.statusLabel && <span>Conversation: {message.conversation.statusLabel}</span>}
                          {message.identities?.thread && <span>Thread: {message.identities.thread}</span>}
                          {message.externalMessageId && <span>Message: {message.externalMessageId}</span>}
                          {message.error?.message && <span>{message.error.message}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                  {conversationMessages.length === 0 && (
                    <div className={s.timelineEmpty}>No conversation messages recorded yet.</div>
                  )}
                </div>
              </div>
            )}

            {showWorkOrdersTab && renderedActiveTab === 'workorders' && (
              <div className={s.recordsList}>
                {contactWorkOrders.map(wo => (
                  <Link key={wo.id} className={`${s.recordCard} ${s.recordLinkCard}`} href={`/work-orders/${wo.id}`}>
                    <div className={s.recordMain}>
                      <div className={s.recordIcon}><ClipboardList size={20} /></div>
                      <div>
                        <div className={s.recordTitle}>{wo.title}</div>
                        <div className={s.recordSubtitle}>{wo.number} • Due {wo.dueDate}</div>
                      </div>
                    </div>
                    <span className={`badge badge-${wo.status.toLowerCase().replace(' ', '')}`}>{wo.status}</span>
                  </Link>
                ))}
                {contactWorkOrders.length === 0 && <div className="empty-state">No work orders linked.</div>}
              </div>
            )}

            {renderedActiveTab === 'financials' && (
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
