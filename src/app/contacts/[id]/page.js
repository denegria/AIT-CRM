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
  Inbox, Send, DollarSign, Archive, BriefcaseBusiness, CheckCircle2,
  GraduationCap
} from 'lucide-react';
import { PIPELINE_STATUSES, workflowForBusinessUnit } from '@/lib/sales-workflow';
import { buildContactDetailViewModel } from '@/lib/contact-detail-view-model';
import { WORKFLOW_KEYS } from '@/lib/crm/lifecycle';

const SNAPSHOT_ICONS = {
  estimate: BriefcaseBusiness,
  follow_up: AlertCircle,
  lead: GraduationCap,
  message: MessageCircle,
  payment: DollarSign,
  task: CheckSquare,
  work: ClipboardList,
};

const emptyPersonForm = {
  id: '',
  name: '',
  role: '',
  phone: '',
  email: '',
  notes: '',
  isPrimary: false,
};

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

function isSourceDetailTimelineItem(item) {
  const category = timelineCategory(item);
  const sourceKind = item.presentation?.provenance?.sourceKind || '';
  if (category === 'import') return true;
  return ['Cleanup audit', 'Imported workbook note'].includes(sourceKind);
}

function timelineFilterCategory(item) {
  return isSourceDetailTimelineItem(item) ? 'import' : timelineCategory(item);
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

function snapshotDetail(items, category, linkedRecordCount = 0, emptyText = 'No matching history yet') {
  const latest = latestTimelineItem(items, category);
  if (!latest && linkedRecordCount > 0 && category !== 'follow_up') {
    return `${linkedRecordCount} linked ${linkedRecordCount === 1 ? 'record' : 'records'}`;
  }
  if (!latest) return emptyText;
  if (linkedRecordCount > 0 && category !== 'follow_up') {
    return `${linkedRecordCount} linked ${linkedRecordCount === 1 ? 'record' : 'records'} · Latest ${dateLabel(latest)}`;
  }
  return `Latest ${dateLabel(latest)}`;
}

function financialCategory(record = {}) {
  const type = String(record.type || '').toLowerCase();
  if (type.includes('estimate')) return 'estimate';
  if (type.includes('receipt') || type.includes('invoice') || type.includes('payment')) return 'payment';
  return 'other';
}

function timelineEmptyText(filterValue, filters) {
  return filters.find((filter) => filter.value === filterValue)?.empty || 'No activity recorded yet.';
}

function timelineCleanupAudit(item = {}) {
  const provenance = item.presentation?.provenance;
  if (provenance?.sourceKind !== 'Cleanup audit') return null;
  const rawText = provenance.rawText || item.text || '';
  const mergedNames = [...String(rawText).matchAll(/(?:^|\n)-\s*name=([^|\n]+)/g)]
    .map((match) => cleanText(match[1]))
    .filter(Boolean);
  const legacyMergedNames = mergedNames.length ? [] : [...String(rawText).matchAll(/(?:^|\n)-\s*([^|\n]+)/g)]
    .map((match) => cleanText(match[1]))
    .filter((value) => value && !value.includes(':'));
  const aliases = mergedNames.length ? mergedNames : legacyMergedNames;
  const retained = String(rawText).match(/Canonical (?:contact )?retained as:\s*([^\n.]+)/i)?.[1]
    || String(rawText).match(/Contact retained as:\s*([^\n.]+)/i)?.[1]
    || '';
  const phone = String(rawText).match(/Primary phone set (?:from|to):\s*([^\n.]+)/i)?.[1] || '';
  return {
    id: item.id,
    title: retained ? `Retained ${retained}` : item.title || 'Cleanup audit',
    detail: aliases.length
      ? `Merged ${aliases.slice(0, 3).join(', ')}${aliases.length > 3 ? ', ...' : ''}`
      : (phone ? `Primary phone ${phone}` : item.text || 'Cleanup provenance recorded'),
  };
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

function cleanText(value = '') {
  return String(value || '').trim();
}

function phoneHref(value = '') {
  const digits = cleanText(value).replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : '';
}

export default function ContactDetailPage({ mode = 'contacts' } = {}) {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const isClientMode = mode === 'clients';
  const singularLabel = isClientMode ? 'Client' : 'Contact';
  const pluralLabel = isClientMode ? 'Clients' : 'Contacts';
  const {
    contacts,
    allContacts,
    workOrders,
    allWorkOrders,
    financials,
    allFinancials,
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
  const [linkedPeople, setLinkedPeople] = useState({ contactId: '', items: [], loading: false, error: '' });
  const [personModal, setPersonModal] = useState(null);
  const [personForm, setPersonForm] = useState(emptyPersonForm);
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

  const contactSource = isClientMode ? (allContacts || contacts) : contacts;
  const workOrderSource = isClientMode ? (allWorkOrders || workOrders) : workOrders;
  const financialSource = isClientMode ? (allFinancials || financials) : financials;
  const contact = useMemo(() => contactSource.find(c => c.id === params.id), [contactSource, params.id]);
  const contactWorkOrders = useMemo(() => workOrderSource.filter(wo => wo.contactId === params.id), [workOrderSource, params.id]);
  const contactFinancials = useMemo(() => financialSource.filter(f => f.contactId === params.id), [financialSource, params.id]);
  const contactFinancialCounts = useMemo(() => contactFinancials.reduce((counts, record) => {
    const category = financialCategory(record);
    counts[category] = (counts[category] || 0) + 1;
    return counts;
  }, {}), [contactFinancials]);
  const contactRecordCounts = useMemo(() => ({
    work: contactWorkOrders.length,
    estimate: contactFinancialCounts.estimate || 0,
    payment: contactFinancialCounts.payment || 0,
  }), [contactFinancialCounts, contactWorkOrders.length]);
  const contactBusinessUnit = businessUnits.find((unit) => unit.id === contact?.businessUnitId || unit.id === contact?.primaryBusinessUnitId);
  const contactStatusOptions = workflowForBusinessUnit(contactBusinessUnit).statuses;
  const detailView = buildContactDetailViewModel({
    contact,
    businessUnit: contactBusinessUnit,
    counts: contactRecordCounts,
  });
  const showLinkedPeoplePanel = isClientMode && detailView.workflowKey === WORKFLOW_KEYS.AIT_SIGNS;
  const showWorkOrdersTab = detailView.tabs.showWorkOrders;
  const showFinancialsTab = detailView.tabs.showFinancials;
  const renderedActiveTab =
    (!showLinkedPeoplePanel && activeTab === 'contacts') ||
    (!showWorkOrdersTab && activeTab === 'workorders') ||
    (!showFinancialsTab && activeTab === 'financials')
      ? 'timeline'
      : activeTab;
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
  const cleanupAudits = useMemo(() => timelineSource.map(timelineCleanupAudit).filter(Boolean).slice(0, 3), [timelineSource]);
  const timelineCounts = useMemo(() => timelineSource.reduce((counts, item) => {
    const category = timelineFilterCategory(item);
    if (!isSourceDetailTimelineItem(item)) counts.all += 1;
    counts[category] = (counts[category] || 0) + 1;
    return counts;
  }, { all: 0 }), [timelineSource]);
  const renderedTimelineFilter = detailView.timelineFilters.some((filter) => filter.value === timelineFilter) ? timelineFilter : 'all';
  const timeline = useMemo(() => {
    if (renderedTimelineFilter === 'all') return timelineSource.filter((item) => !isSourceDetailTimelineItem(item));
    return timelineSource.filter((item) => timelineFilterCategory(item) === renderedTimelineFilter);
  }, [renderedTimelineFilter, timelineSource]);
  const hasMatchingServerConversations = serverConversations.contactId === contact?.id && serverConversations.reloadKey === conversationReloadKey;
  const conversationMessages = hasMatchingServerConversations && serverConversations.items ? serverConversations.items : [];
  const linkedSnapshotCounts = {
    work: contactWorkOrders.length,
    estimate: contactFinancialCounts.estimate || 0,
    payment: contactFinancialCounts.payment || 0,
    follow_up: timelineCounts.follow_up || 0,
    lead: timelineCounts.lead || 0,
    message: Math.max(timelineCounts.message || 0, conversationMessages.length),
    task: timelineCounts.task || 0,
  };
  const timelineSnapshot = detailView.snapshotItems.map((item) => {
    const linkedCount = linkedSnapshotCounts[item.key] || 0;
    return {
      ...item,
      count: Math.max(timelineCounts[item.key] || 0, linkedCount),
      detail: snapshotDetail(timelineSource, item.key, linkedCount, item.empty),
    };
  });
  const conversationStatus = dataSource === 'postgres' && contact?.id && !hasMatchingServerConversations
    ? 'loading'
    : hasMatchingServerConversations && serverConversations.error
      ? 'error'
      : 'idle';
  const currentLinkedPeople = linkedPeople.contactId === contact?.id
    ? linkedPeople
    : { contactId: contact?.id || '', items: [], loading: showLinkedPeoplePanel && dataSource === 'postgres', error: '' };

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
    if (!showLinkedPeoplePanel || !contact?.id || dataSource !== 'postgres') {
      return undefined;
    }
    let cancelled = false;
    const requestContactId = contact.id;
    fetch(`/api/contacts/${contact.id}/people`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Linked people load failed.');
        if (!cancelled) {
          setLinkedPeople({
            contactId: requestContactId,
            items: Array.isArray(payload.people) ? payload.people : [],
            loading: false,
            error: '',
          });
        }
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          setLinkedPeople({
            contactId: requestContactId,
            items: [],
            loading: false,
            error: error.message || 'Linked people load failed.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [contact?.id, dataSource, showLinkedPeoplePanel]);

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

  const openPersonModal = (person = null) => {
    if (!access.canWriteCrm) return;
    setPersonForm(person ? { ...emptyPersonForm, ...person } : emptyPersonForm);
    setPersonModal(person ? 'edit' : 'new');
  };

  const closePersonModal = () => {
    setPersonModal(null);
    setPersonForm(emptyPersonForm);
  };

  const savePerson = () => {
    if (!contact?.id || !personForm.name.trim()) return;
    const isEdit = personModal === 'edit';
    fetch(`/api/contacts/${contact.id}/people`, {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(personForm),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Linked person save failed.');
        setLinkedPeople({
          contactId: contact.id,
          items: Array.isArray(payload.people) ? payload.people : [],
          loading: false,
          error: '',
        });
        closePersonModal();
        toast(isEdit ? 'Linked person updated' : 'Linked person added');
      })
      .catch((error) => toast(error.message || 'Linked person save failed.', 'error'));
  };

  const deletePerson = (person) => {
    if (!contact?.id || !person?.id || !access.canWriteCrm) return;
    fetch(`/api/contacts/${contact.id}/people`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: person.id }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Linked person delete failed.');
        setLinkedPeople({
          contactId: contact.id,
          items: Array.isArray(payload.people) ? payload.people : [],
          loading: false,
          error: '',
        });
        toast('Linked person removed', 'error');
      })
      .catch((error) => toast(error.message || 'Linked person delete failed.', 'error'));
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
    return <div className="empty-state">{singularLabel} not found</div>;
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
        <button className={s.btnBack} onClick={() => (isClientMode ? router.push('/clients') : router.back())}>
          <ArrowLeft size={18} /> Back to {pluralLabel}
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
              <div className={s.profileRole}>{detailView.profileTitle}</div>
              {detailView.sourceEyebrow && <div className={s.profileSource}>{detailView.sourceEyebrow}</div>}
            </div>
          </div>

          {(detailView.workflowTitle || detailView.workflowNext || detailView.workflowChips?.length) && (
            <div className={s.workflowCard}>
              <div className={s.workflowHeader}>
                <AlertCircle size={15} />
                <span>{detailView.workflowTitle}</span>
              </div>
              {detailView.workflowNext && <div className={s.workflowNext}>{detailView.workflowNext}</div>}
              {!!detailView.workflowChips?.length && (
                <div className={s.workflowTags}>
                  {detailView.workflowChips.map((tag) => (
                    <span key={tag} className={s.workflowTag}><Tag size={11} /> {tag.replaceAll('_', ' ')}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {access.canReadImportReview && !!cleanupAudits.length && (
            <div className={s.cleanupSummary} aria-label="Cleanup provenance">
              <div className={s.cleanupSummaryHeader}>
                <Archive size={15} />
                <span>Cleanup provenance</span>
              </div>
              {cleanupAudits.map((audit) => (
                <div key={audit.id} className={s.cleanupSummaryItem}>
                  <strong>{audit.title}</strong>
                  <span>{audit.detail}</span>
                </div>
              ))}
            </div>
          )}

          <div className={s.profileInfo}>
            <div className={s.infoItem}>
              <Mail size={16} />
              {cleanText(contact.email) ? (
                <a className={s.infoLink} href={`mailto:${cleanText(contact.email)}`}>{contact.email}</a>
              ) : (
                <span className={s.missingInfo}>Missing email</span>
              )}
            </div>
            <div className={s.infoItem}>
              <Phone size={16} />
              {cleanText(contact.phone) ? (
                <a className={s.infoLink} href={phoneHref(contact.phone)}>{contact.phone}</a>
              ) : (
                <span className={s.missingInfo}>Missing phone</span>
              )}
            </div>
            {contact.address && <div className={s.infoItem}><MapPin size={16} /> <span>{contact.address}</span></div>}
            <div className={s.infoItem}><Calendar size={16} /> <span>Last touch: {contact.lastTouch || contact.lastContact || 'None'}</span></div>
            <div className={s.infoItem}><Edit3 size={16} /> <span>Last edited: {contact.lastEdited || 'None'}</span></div>
            {detailView.contactability?.status && detailView.contactability.status !== 'reachable' && (
              <div className={s.infoItem}>
                <AlertCircle size={16} />
                <span>{detailView.contactability.reason || detailView.contactability.label}</span>
              </div>
            )}
          </div>

          {!!detailView.highlights?.length && (
            <div className={s.highlightGrid} aria-label={`${detailView.profileTitle} summary`}>
              {detailView.highlights.map((item) => (
                <div key={`${item.label}-${item.value}`} className={`${s.highlightItem} ${item.tone ? s[`highlight_${item.tone}`] || '' : ''}`}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          )}

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
            {showLinkedPeoplePanel && (
              <button className={`${s.contentTab} ${renderedActiveTab === 'contacts' ? s.active : ''}`} onClick={() => setActiveTab('contacts')}>Contacts ({currentLinkedPeople.items.length})</button>
            )}
            {showWorkOrdersTab && (
              <button className={`${s.contentTab} ${renderedActiveTab === 'workorders' ? s.active : ''}`} onClick={() => setActiveTab('workorders')}>{detailView.tabs.workOrdersLabel} ({contactWorkOrders.length})</button>
            )}
            {showFinancialsTab && (
              <button className={`${s.contentTab} ${renderedActiveTab === 'financials' ? s.active : ''}`} onClick={() => setActiveTab('financials')}>{detailView.tabs.financialLabel} ({contactFinancials.length})</button>
            )}
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

                <div className={s.snapshotStrip} aria-label={`Current ${singularLabel.toLowerCase()} snapshot`}>
                  {timelineSnapshot.map((item) => {
                    const Icon = SNAPSHOT_ICONS[item.icon] || Activity;
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
                    {detailView.timelineFilters.map((filter) => (
                      <button
                        key={filter.value}
                        className={`${s.timelineFilter} ${renderedTimelineFilter === filter.value ? s.active : ''}`}
                        onClick={() => setTimelineFilter(filter.value)}
                        type="button"
                        aria-pressed={renderedTimelineFilter === filter.value}
                        aria-label={`${filter.label}: ${timelineCounts[filter.value] || 0} records`}
                      >
                        {filter.label}
                        <span className={s.timelineFilterCount}>{timelineCounts[filter.value] || 0}</span>
                        {renderedTimelineFilter === filter.value && <span className={s.srOnly}> selected</span>}
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
                      item.presentation?.sourceGroupLabel || '',
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
                    <div className={s.timelineEmpty}>{timelineEmptyText(renderedTimelineFilter, detailView.timelineFilters)}</div>
                  )}
                </div>
              </div>
            )}

            {renderedActiveTab === 'contacts' && showLinkedPeoplePanel && (
              <div className={s.peoplePanel} aria-label="Linked contacts">
                <div className={s.peopleHeader}>
                  <div>
                    <strong>Contacts</strong>
                    <span>{currentLinkedPeople.loading ? 'Loading' : `${currentLinkedPeople.items.length} saved`}</span>
                  </div>
                  {access.canWriteCrm && (
                    <button className="btn btn-sm" type="button" onClick={() => openPersonModal()}>
                      <Plus size={14} /> Add
                    </button>
                  )}
                </div>
                {currentLinkedPeople.error && <div className={s.peopleEmpty}>{currentLinkedPeople.error}</div>}
                {!currentLinkedPeople.error && currentLinkedPeople.items.length === 0 && !currentLinkedPeople.loading && (
                  <div className={s.peopleEmpty}>No contacts linked to this client yet.</div>
                )}
                <div className={s.peopleList}>
                  {currentLinkedPeople.items.map((person) => (
                    <div key={person.id} className={s.personCard}>
                      <div className={s.personTopline}>
                        <strong>{person.name}</strong>
                        {person.isPrimary && <span>Primary</span>}
                      </div>
                      {person.role && <div className={s.personRole}>{person.role}</div>}
                      <div className={s.personMethods}>
                        {person.phone && <a href={phoneHref(person.phone)}><Phone size={13} /> {person.phone}</a>}
                        {person.email && <a href={`mailto:${person.email}`}><Mail size={13} /> {person.email}</a>}
                      </div>
                      {person.notes && <div className={s.personNotes}>{person.notes}</div>}
                      {access.canWriteCrm && (
                        <div className={s.personActions}>
                          <button type="button" onClick={() => openPersonModal(person)}>Edit</button>
                          <button type="button" onClick={() => deletePerson(person)}>Remove</button>
                        </div>
                      )}
                    </div>
                  ))}
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
              {[...new Set([...(contactStatusOptions || PIPELINE_STATUSES), ...(editForm.status ? [editForm.status] : [])])].map(st => <option key={st} value={st}>{st}</option>)}
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

      {personModal && (
        <Modal
          open={!!personModal}
          onClose={closePersonModal}
          title={personModal === 'new' ? 'Add Linked Person' : 'Edit Linked Person'}
          footer={<><button className="btn" onClick={closePersonModal}>Cancel</button><button className="btn btn-primary" onClick={savePerson}>Save</button></>}
        >
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Name</label>
              <input className="input" value={personForm.name} onChange={e => setPersonForm({...personForm, name: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">Role</label>
              <input className="input" value={personForm.role} onChange={e => setPersonForm({...personForm, role: e.target.value})} />
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Phone</label>
              <input className="input" value={personForm.phone} onChange={e => setPersonForm({...personForm, phone: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="input" value={personForm.email} onChange={e => setPersonForm({...personForm, email: e.target.value})} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="input" rows={3} value={personForm.notes} onChange={e => setPersonForm({...personForm, notes: e.target.value})} />
          </div>
          <label className={s.primaryToggle}>
            <input type="checkbox" checked={personForm.isPrimary} onChange={e => setPersonForm({...personForm, isPrimary: e.target.checked})} />
            Primary person for this client
          </label>
        </Modal>
      )}
    </div>
  );
}
