'use client';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCRM } from '@/lib/store';
import { useToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import PageState, { PageStateAction } from '@/components/PageState';
import { coordinatorUiPolicyForUser } from '@/lib/crm/coordinator-policy.js';
import { aitUsaAssigneeOptionLabel, isEligibleAitUsaAssignee } from '@/lib/crm/ait-usa-assignee.js';
import { generateInvoicePDF, generateEstimatePDF, generateReceiptPDF, generateAitUsaReceiptPDF } from '@/lib/pdf';
import s from './ContactDetail.module.css';
import {
  AlertCircle, ArrowLeft, ArrowRight, Mail, Phone, MapPin, Calendar,
  Plus, FileText, ClipboardList,
  MessageSquare, MessageSquarePlus, Edit3, Tag, Activity, CheckSquare, MessageCircle,
  Inbox, Send, DollarSign, Archive, BriefcaseBusiness, CheckCircle2, RefreshCw,
  GraduationCap, ClipboardCheck, MoreHorizontal
} from 'lucide-react';
import { PIPELINE_STATUSES, isWorkflowStatusClosed, workflowForBusinessUnit } from '@/lib/sales-workflow';
import { buildContactDetailViewModel } from '@/lib/contact-detail-view-model';
import {
  buildContactSidebarInquiry,
  buildContactSidebarNextStep,
  scopedOpenFollowUpTasks,
} from '@/lib/contact-sidebar-model.js';
import { WORKFLOW_KEYS } from '@/lib/crm/lifecycle';
import { schoolLocationForContact, schoolLocationOptions, studentLocationForContact } from '@/lib/school-locations';
import {
  COURSE_RECORD_STATUS_OPTIONS,
  courseNameOptions,
  courseRecordStatusLabel,
  deriveCourseSummary,
  isTerminalCourseRecordStatus,
} from '@/lib/crm/course-records.js';
import { appendContactNote, contactDetailPageState, loadContactTimeline } from '@/lib/contacts/detail-loader.js';
import { useRecordScopeRegistration } from '@/components/RecordScopeContext';
import { InternalNoteComposer } from '@/components/ContactTimelineNoteFields';
import FollowUpOutcomeDialog from '@/components/FollowUpOutcomeDialog';
import AitUsaActivityRecord from './AitUsaActivityRecord';
import OpportunityLifecycleField from '@/components/OpportunityLifecycleField';
import { buildContactProfilePatch } from '@/lib/crm/contact-profile-patch.js';
import {
  buildContactFollowUpLookup,
  followUpSubmissionTaskId,
} from '@/lib/tasks/follow-up-selection.js';
import { initialFollowUpDraftFields } from '@/lib/tasks/follow-up-draft.js';

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

const emptyEstimateForm = {
  number: '',
  type: 'Estimate',
  client: '',
  contactId: '',
  businessUnitId: '',
  date: '',
  dueDate: '',
  status: 'Pending',
  paidAmount: 0,
  items: [{ desc: '', qty: 1, rate: 0 }],
};

const emptyPaymentForm = {
  workOrderId: '',
  amount: '',
  paymentMethod: 'Cash',
  paidAt: '',
  checkNumber: '',
  note: '',
};

const emptyCourseForm = {
  id: '',
  classSectionId: '',
  courseName: '',
  courseLocation: '',
  teacher: '',
  status: 'active',
  startDate: '',
  endDate: '',
  outcomeReason: '',
  notes: '',
};

const COURSE_STATUS_HELP = {
  planned: 'Use when the student is expected to start later.',
  active: 'Use for a class the student is currently attending.',
  completed: 'Use when the course ended successfully.',
  dropped: 'Use when the student left or quit before finishing.',
  cancelled: 'Use when the course never moved forward.',
  transferred: 'Use when the student moved into another class or location.',
};

function classSectionScheduleLabel(section = {}) {
  const days = Array.isArray(section.scheduleDays) ? section.scheduleDays.join(', ') : '';
  const time = [section.startTime, section.endTime].filter(Boolean).join('–');
  return [days, time].filter(Boolean).join(' ');
}

function classSectionDisplayLabel(section = {}) {
  return [
    section.courseName,
    section.teacher,
    section.courseLocation,
    classSectionScheduleLabel(section),
    section.modality === 'online' ? 'Online' : '',
    section.status !== 'active' ? 'Inactive' : '',
  ].filter(Boolean).join(' · ');
}

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
    time: item.timestamp && item.presentation?.timestampPrecision !== 'date'
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

function timelineMatchesFilter(item, filterValue, isAitUsaContact) {
  if (filterValue === 'all') return !isSourceDetailTimelineItem(item);
  if (isAitUsaContact && filterValue === 'import') {
    return Boolean(item.presentation?.isImported || isSourceDetailTimelineItem(item));
  }
  return timelineCategory(item) === filterValue;
}

function timelineCategoryLabel(item) {
  if (timelineCategory(item) === 'note') return 'Internal note';
  return item.presentation?.categoryLabel || item.typeLabel || item.type || 'Activity';
}

function timelineNoteAuthor(item) {
  if (timelineCategory(item) !== 'note') return '';
  return item.actor?.name || 'Unknown user';
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

function canManageAitUsaAssignmentsForUser(user) {
  const roleKeys = [user?.primaryRoleKey, ...(user?.roleKeys || [])].filter(Boolean);
  return roleKeys.some((key) => ['admin', 'senior_coordinator'].includes(String(key).trim()));
}

function financialCategory(record = {}) {
  const type = String(record.type || '').toLowerCase();
  if (type.includes('estimate')) return 'estimate';
  if (type.includes('receipt') || type.includes('invoice') || type.includes('payment')) return 'payment';
  return 'other';
}

function isInvoiceRecord(record = {}) {
  return String(record.type || '').toLowerCase().includes('invoice') && Boolean(record.workOrderId);
}

function isEnrolledWorkflowStatus(status = '') {
  return String(status || '').trim().toLowerCase() === 'enrolled';
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

function compactReviewText(value = '', maxLength = 82) {
  const cleaned = cleanText(value).replace(/\s+/g, ' ');
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function phoneHref(value = '') {
  const digits = cleanText(value).replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : '';
}

function moneyValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function moneyLabel(value) {
  return moneyValue(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function dateForInput(value = '') {
  return value ? String(value).slice(0, 10) : '';
}

function dateInputToIso(value) {
  if (!value) return null;
  const date = new Date(`${value}T09:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function dateTimeInputToIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function taskDateLabel(value) {
  if (!value) return 'No due date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No due date';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function defaultFollowUpDraft(contact = {}, currentUser = null, ownerOptions = []) {
  return {
    ...initialFollowUpDraftFields(),
    nextOwnerUserId: currentUser?.id || ownerOptions[0]?.id || '',
    leadProfile: {
      programInterest: contact?.programInterest || '',
      preferredDay: contact?.preferredDay || '',
      preferredSchedule: contact?.preferredSchedule || '',
      testInterest: contact?.testInterest || '',
      educationLevel: contact?.educationLevel || '',
      schoolName: contact?.schoolName || '',
      locationPreference: contact?.locationPreference || '',
    },
  };
}

function nextWorkflowStatus(currentStatus = '', statuses = []) {
  const uniqueStatuses = [...new Set((statuses || []).filter(Boolean))];
  const currentIndex = uniqueStatuses.findIndex((status) => status === currentStatus);
  if (currentIndex < 0 || currentIndex >= uniqueStatuses.length - 1) return '';
  return uniqueStatuses[currentIndex + 1];
}

export default function ContactDetailPage({ mode = 'contacts' } = {}) {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
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
    contactDirectoryIsDeferred,
    dashboardSummaryIsDeferred,
    pipelineSummaryIsDeferred,
    leanShellIsDeferred,
    updateContact,
    deleteContact,
    addFinancial,
    recordPayment,
    loaded,
    sources,
    employees,
    currentUser,
    access,
    dataSource,
    businessUnits,
    replaceContactFromServer,
  } = useCRM();
  const [activeTab, setActiveTab] = useState('timeline');
  const [timelineFilter, setTimelineFilter] = useState('all');
  const contentTabRefs = useRef([]);
  const timelineMoreRef = useRef(null);
  const [serverTimeline, setServerTimeline] = useState({ contactId: '', reloadKey: -1, items: null, error: false });
  const [timelineReloadKey, setTimelineReloadKey] = useState(0);
  const [serverConversations, setServerConversations] = useState({ contactId: '', reloadKey: -1, items: null, error: false });
  const [conversationReloadKey, setConversationReloadKey] = useState(0);
  const [messageTemplates, setMessageTemplates] = useState([]);
  const [linkedPeople, setLinkedPeople] = useState({ contactId: '', items: [], loading: false, error: '' });
  const [personModal, setPersonModal] = useState(null);
  const [personForm, setPersonForm] = useState(emptyPersonForm);
  const [personDeleteTarget, setPersonDeleteTarget] = useState(null);
  const [personDeleteBusy, setPersonDeleteBusy] = useState(false);
  const [manualSend, setManualSend] = useState({
    channel: 'messenger',
    templateId: '',
    textBody: '',
    requestId: newManualSendRequestId(),
    sending: false,
    blockedReasons: [],
    error: '',
  });
  const ownerOptions = useMemo(() => {
    const mapped = (employees || [])
      .filter((employee) => employee?.id)
      .map((employee) => ({
        id: employee.id,
        label: employee.name || employee.email || 'Unnamed User',
        roleKeys: employee.roleKeys || [],
        businessUnitIds: employee.businessUnitIds || [],
      }));
    if (currentUser?.id && !mapped.some((employee) => employee.id === currentUser.id)) {
      return [
        {
          id: currentUser.id,
          label: currentUser.name || currentUser.email || 'Me',
          roleKeys: [currentUser.primaryRoleKey, ...(currentUser.roleKeys || [])].filter(Boolean),
          businessUnitIds: currentUser.businessUnitIds || [],
        },
        ...mapped,
      ];
    }
    return mapped;
  }, [currentUser, employees]);
  const coordinatorUiPolicy = useMemo(() => coordinatorUiPolicyForUser(currentUser), [currentUser]);
  const canManageAitUsaAssignments = canManageAitUsaAssignmentsForUser(currentUser);
  const [noteInput, setNoteInput] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteComposerOpen, setNoteComposerOpen] = useState(false);
  const noteSaveInFlight = useRef(false);
  const noteInputRef = useRef(null);
  const noteTriggerRef = useRef(null);
  const profileEditTabRefs = useRef([]);
  const followUpActionHandledRef = useRef('');
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpDraft, setFollowUpDraft] = useState(null);
  const [followUpTask, setFollowUpTask] = useState(null);
  const [followUpRequestedTaskId, setFollowUpRequestedTaskId] = useState('');
  const [followUpLeadId, setFollowUpLeadId] = useState(null);
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [followUpResolving, setFollowUpResolving] = useState(false);
  const [followUpError, setFollowUpError] = useState('');
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [startOpportunityOpen, setStartOpportunityOpen] = useState(false);
  const [startOpportunityBusy, setStartOpportunityBusy] = useState(false);
  const [startOpportunityError, setStartOpportunityError] = useState('');
  const [startOpportunityForm, setStartOpportunityForm] = useState({ status: 'New Lead', assignedTo: '', reason: '' });
  const [activeProfileEditTab, setActiveProfileEditTab] = useState('general');
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [estimateModalOpen, setEstimateModalOpen] = useState(false);
  const [estimateForm, setEstimateForm] = useState(emptyEstimateForm);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [invoiceWorkOrderId, setInvoiceWorkOrderId] = useState('');
  const [courseRecordsState, setCourseRecordsState] = useState({ contactId: '', items: [], sections: [], loading: false, error: '' });
  const [courseModal, setCourseModal] = useState(null);
  const [courseForm, setCourseForm] = useState(emptyCourseForm);
  const [courseBusy, setCourseBusy] = useState(false);
  const [courseError, setCourseError] = useState('');
  const [selectedCourseRecordId, setSelectedCourseRecordId] = useState('');
  const [phoneHistoryState, setPhoneHistoryState] = useState({ contactId: '', items: [], loading: false, error: '' });

  useEffect(() => {
    if (noteComposerOpen) noteInputRef.current?.focus();
  }, [noteComposerOpen]);
  const [taskProjection, setTaskProjection] = useState({ key: '', items: [], loading: false, error: '' });
  const [taskProjectionReloadKey, setTaskProjectionReloadKey] = useState(0);

  const scopedContact = useMemo(() => contacts.find(c => c.id === params.id), [contacts, params.id]);
  const allAccessibleContacts = allContacts?.length ? allContacts : contacts;
  const contact = useMemo(() => (
    scopedContact || allAccessibleContacts.find(c => c.id === params.id)
  ), [allAccessibleContacts, params.id, scopedContact]);
  const detailPageState = contactDetailPageState({
    loaded,
    contact,
    deferredBootstrapActive: contactDirectoryIsDeferred ||
      dashboardSummaryIsDeferred ||
      pipelineSummaryIsDeferred ||
      leanShellIsDeferred,
  });
  const useAllLinkedRecords = isClientMode || Boolean(contact && !scopedContact);
  const workOrderSource = useAllLinkedRecords ? (allWorkOrders || workOrders) : workOrders;
  const financialSource = useAllLinkedRecords ? (allFinancials || financials) : financials;
  const contactWorkOrders = useMemo(() => workOrderSource.filter(wo => wo.contactId === params.id), [workOrderSource, params.id]);
  const contactFinancials = useMemo(() => financialSource.filter(f => f.contactId === params.id), [financialSource, params.id]);
  const contactInvoices = useMemo(() => contactFinancials.filter(isInvoiceRecord), [contactFinancials]);
  const contactEstimates = useMemo(() => contactFinancials.filter((record) => financialCategory(record) === 'estimate'), [contactFinancials]);
  const latestInvoice = contactInvoices[0] || null;
  const latestWorkOrder = contactWorkOrders[0] || null;
  const invoiceByWorkOrderId = useMemo(() => {
    const invoices = new Map();
    contactInvoices.forEach((invoice) => {
      if (invoice.workOrderId && !invoices.has(invoice.workOrderId)) invoices.set(invoice.workOrderId, invoice);
    });
    return invoices;
  }, [contactInvoices]);
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
  const assignedOwnerId = contact?.assignedTo || contact?.ownerUserId || '';
  const assignedEmployee = useMemo(() => (
    ownerOptions.find((owner) => owner.id === assignedOwnerId) || null
  ), [assignedOwnerId, ownerOptions]);
  const contactBusinessUnit = businessUnits.find((unit) => unit.id === contact?.businessUnitId || unit.id === contact?.primaryBusinessUnitId);
  useRecordScopeRegistration(contactBusinessUnit, contact?.id ? `contact:${contact.id}` : '');
  const financialContext = useMemo(() => ({ contact, businessUnit: contactBusinessUnit }), [contact, contactBusinessUnit]);
  const estimateTotal = useMemo(() => estimateForm.items.reduce((sum, item) => (
    sum + moneyValue(item.qty || 1) * moneyValue(item.rate)
  ), 0), [estimateForm.items]);
  const selectedPaymentWorkOrder = useMemo(() => (
    contactWorkOrders.find((workOrder) => workOrder.id === paymentForm.workOrderId) || latestWorkOrder
  ), [contactWorkOrders, latestWorkOrder, paymentForm.workOrderId]);
  const selectedPaymentInvoice = useMemo(() => (
    contactInvoices.find((invoice) => invoice.workOrderId && invoice.workOrderId === paymentForm.workOrderId) || latestInvoice
  ), [contactInvoices, latestInvoice, paymentForm.workOrderId]);
  const selectedPaymentWorkOrderTotal = moneyValue(selectedPaymentInvoice?.amount || selectedPaymentWorkOrder?.estimatedCost || selectedPaymentWorkOrder?.amount);
  const selectedPaymentWorkOrderPaid = useMemo(() => contactFinancials
    .filter((record) => record.workOrderId && record.workOrderId === selectedPaymentWorkOrder?.id)
    .filter((record) => financialCategory(record) === 'payment')
    .reduce((sum, record) => sum + moneyValue(record.paidAmount || record.amount), 0), [contactFinancials, selectedPaymentWorkOrder?.id]);
  const selectedPaymentBalance = Math.max(selectedPaymentWorkOrderTotal - selectedPaymentWorkOrderPaid, 0);
  const balanceAfterPayment = Math.max(selectedPaymentBalance - moneyValue(paymentForm.amount), 0);
  const contactWorkflow = workflowForBusinessUnit(contactBusinessUnit);
  const contactStatusOptions = contactWorkflow.statuses;
  const nextStatus = nextWorkflowStatus(contact?.status, contactStatusOptions);
  const isClosedStatusReopen = Boolean(
    editForm &&
    editForm.status &&
    contact?.status &&
    editForm.status !== contact.status &&
    isWorkflowStatusClosed(contact.status, contactBusinessUnit) &&
    !isWorkflowStatusClosed(editForm.status, contactBusinessUnit),
  );
  const isEnteringClosedStatus = Boolean(
    editForm &&
    contact?.hasLeadStatus &&
    editForm.status &&
    editForm.status !== contact.status &&
    isWorkflowStatusClosed(editForm.status, contactBusinessUnit),
  );
  const detailView = buildContactDetailViewModel({
    contact,
    businessUnit: contactBusinessUnit,
    counts: contactRecordCounts,
  });
  const showLinkedPeoplePanel = isClientMode && detailView.workflowKey === WORKFLOW_KEYS.AIT_SIGNS;
  const showSchoolLocationField = detailView.workflowKey === WORKFLOW_KEYS.AIT_USA;
  const isAitUsaContact = detailView.workflowKey === WORKFLOW_KEYS.AIT_USA || /ait usa|institute/i.test(contactBusinessUnit?.name || '');
  const hasCurrentInquiry = !contact?.opportunityConflict && (
    Number(contact?.activeOpportunityCount || 0) === 1 ||
    (Boolean(contact?.opportunityId) && !isWorkflowStatusClosed(contact?.status, contactBusinessUnit))
  );
  const inquiryProfileHeading = contact?.opportunityConflict
    ? 'Inquiry conflict'
    : hasCurrentInquiry
      ? 'Current inquiry'
      : 'Last inquiry';
  const inquiryProfileDisabled = Boolean(contact?.opportunityConflict || !contact?.hasLeadStatus);
  const profileStatusOptions = useMemo(() => (
    isAitUsaContact && !isEnrolledWorkflowStatus(contact?.status)
      ? contactStatusOptions.filter((status) => !isEnrolledWorkflowStatus(status))
      : contactStatusOptions
  ), [contact?.status, contactStatusOptions, isAitUsaContact]);
  const taskProjectionKey = [contact?.id, contactBusinessUnit?.id, currentUser?.id, canManageAitUsaAssignments ? 'all' : 'mine', taskProjectionReloadKey].join(':');
  const currentTaskProjection = taskProjection.key === taskProjectionKey
    ? taskProjection
    : { key: taskProjectionKey, items: [], loading: dataSource === 'postgres' && isAitUsaContact, error: '' };
  const sidebarNextStep = buildContactSidebarNextStep({
    contact,
    tasks: currentTaskProjection.items,
    ownerOptions,
    contactability: detailView.contactability,
    canSeeAllTasks: canManageAitUsaAssignments,
  });
  const instituteInquiry = contact?.enrollmentSignals?.inquiry || {};
  const sidebarInquiry = buildContactSidebarInquiry({
    contact,
    studentLocation: studentLocationForContact(contact),
  });
  const secondaryInquiryFacts = [
    { label: 'Learning location', value: schoolLocationForContact(contact) },
    { label: 'Preferred day', value: cleanText(contact?.preferredDay || instituteInquiry.preferredDay) },
    { label: 'Schedule', value: cleanText(contact?.preferredSchedule || instituteInquiry.preferredSchedule) },
    { label: 'Test interest', value: cleanText(contact?.testInterest || instituteInquiry.testInterest) },
    { label: 'Level', value: cleanText(contact?.educationLevel || instituteInquiry.level) },
    { label: 'School', value: cleanText(contact?.schoolName || instituteInquiry.school) },
  ].filter((item) => item.value);
  const NextStepIcon = sidebarNextStep.kind === 'scheduled'
    ? Calendar
    : sidebarNextStep.kind === 'first_outreach'
      ? Send
    : sidebarNextStep.kind === 'retargeting'
      ? RefreshCw
    : sidebarNextStep.kind === 'missing_contact'
      ? Phone
      : ['overdue', 'restricted', 'inquiry_conflict', 'closed_blocked', 'missing_inquiry'].includes(sidebarNextStep.kind)
        ? AlertCircle
        : sidebarNextStep.kind === 'closed'
          ? CheckCircle2
          : CheckSquare;
  const NextStepActionIcon = ['first_outreach', 'retargeting', 'empty'].includes(sidebarNextStep.kind)
    ? ClipboardCheck
    : ['scheduled', 'overdue'].includes(sidebarNextStep.kind)
      ? CheckCircle2
      : ['multiple', 'inquiry_conflict'].includes(sidebarNextStep.kind)
        ? ClipboardList
        : NextStepIcon;
  const inlineContactabilityStatus = ['missing_email', 'missing_phone'].includes(
    detailView.contactability?.status,
  );
  const canManageContactAssignments = isAitUsaContact
    ? canManageAitUsaAssignments
    : coordinatorUiPolicy.canManageCoordinatorAssignments;
  const aitUsaOwnerOptions = isAitUsaContact
    ? ownerOptions.filter((owner) => (
        isEligibleAitUsaAssignee({ owner, businessUnitId: contactBusinessUnit?.id, actorUserId: currentUser?.id }) ||
        owner.id === contact?.assignedTo
      ))
    : ownerOptions;
  const hasWorkOrders = contactWorkOrders.length > 0;
  const hasInvoices = contactInvoices.length > 0;
  const profileEditTabs = useMemo(() => {
    if (isAitUsaContact) {
      return [
        { id: 'contact', label: 'Contact', summary: 'Identity and contact channels' },
        { id: 'inquiry', label: inquiryProfileHeading, summary: 'Lifecycle, ownership, location, and source' },
        { id: 'preferences', label: 'Inquiry preferences', summary: 'Program, schedule, and background' },
      ];
    }
    return [
      { id: 'general', label: 'General', summary: 'Identity, status, and owner' },
      { id: 'source', label: 'Source & routing', summary: 'Attribution, student location, and learning location' },
    ];
  }, [inquiryProfileHeading, isAitUsaContact]);
  const selectedInvoiceWorkOrder = contactWorkOrders.find((workOrder) => workOrder.id === invoiceWorkOrderId) || null;
  const workOrdersHref = `/work-orders${contact?.id ? `?contactId=${encodeURIComponent(contact.id)}` : ''}`;
  const visibleFinancials = useMemo(() => (
    isAitUsaContact
      ? contactFinancials.filter((record) => {
          const type = String(record.type || '').toLowerCase();
          return financialCategory(record) === 'payment' && !type.includes('invoice');
        })
      : contactFinancials
  ), [contactFinancials, isAitUsaContact]);
  const editSourceOptions = [...new Set([
    ...(sources || []),
    ...(editForm?.source ? [editForm.source] : []),
  ])];
  const editSchoolLocationOptions = schoolLocationOptions(editForm?.address);
  const courseOptions = courseNameOptions(courseForm.courseName);
  const courseLocationOptions = schoolLocationOptions(courseForm.courseLocation);
  const showWorkOrdersTab = detailView.tabs.showWorkOrders;
  const showFinancialsTab = isAitUsaContact
    ? visibleFinancials.length > 0
    : detailView.tabs.showFinancials;
  const showCoursesTab = isAitUsaContact;
  const currentCourseRecords = useMemo(() => (
    showCoursesTab && courseRecordsState.contactId === contact?.id
      ? courseRecordsState.items
      : []
  ), [contact?.id, courseRecordsState.contactId, courseRecordsState.items, showCoursesTab]);
  const currentClassSections = useMemo(() => (
    showCoursesTab && courseRecordsState.contactId === contact?.id
      ? courseRecordsState.sections
      : []
  ), [contact?.id, courseRecordsState.contactId, courseRecordsState.sections, showCoursesTab]);
  const courseSummary = useMemo(() => deriveCourseSummary(currentCourseRecords), [currentCourseRecords]);
  const activeCourseRecord = courseSummary.currentCourse;
  const activeCourseRecords = courseSummary.currentCourses;
  const historicalCourseRecords = useMemo(
    () => courseSummary.records.filter((record) => record.status !== 'active'),
    [courseSummary.records],
  );
  const canStartEnrollment = access.canWriteCrm && hasCurrentInquiry;
  const selectedClassSection = useMemo(() => (
    currentClassSections.find((section) => section.id === courseForm.classSectionId) || null
  ), [courseForm.classSectionId, currentClassSections]);
  const selectedCourseRecord = useMemo(() => (
    currentCourseRecords.find((record) => record.id === selectedCourseRecordId) ||
    activeCourseRecord ||
    currentCourseRecords[0] ||
    null
  ), [activeCourseRecord, currentCourseRecords, selectedCourseRecordId]);
  const courseStartDateRequired = courseForm.status === 'active';
  const courseStatusIsTerminal = isTerminalCourseRecordStatus(courseForm.status);
  const courseStatusLabel = courseRecordStatusLabel(courseForm.status);
  const courseModeLabel = courseForm.id
    ? 'Edit saved enrollment'
    : (courseModal === 'history' ? 'Add past enrollment' : 'Start enrollment');
  const courseStatusOptions = courseForm.id
    ? COURSE_RECORD_STATUS_OPTIONS
    : COURSE_RECORD_STATUS_OPTIONS.filter((option) => (
        courseModal === 'history'
          ? ['completed', 'dropped', 'cancelled', 'transferred'].includes(option.value)
          : option.value === 'active'
      ));
  const canSaveCourseForm = Boolean(cleanText(courseForm.courseName)) &&
    (!courseStartDateRequired || Boolean(courseForm.startDate));
  const financialNotice = !hasWorkOrders
    ? { tone: 'blocked', text: 'Create a work order before generating an invoice.' }
    : (!hasInvoices
        ? { tone: 'warning', text: 'Generate an invoice from a work order before recording a payment.' }
        : { tone: 'ready', text: 'Invoice is ready for payment recording.' });
  const renderedActiveTab =
    (!showLinkedPeoplePanel && activeTab === 'contacts') ||
    (!showWorkOrdersTab && activeTab === 'workorders') ||
    (!showFinancialsTab && activeTab === 'financials') ||
    (!showCoursesTab && activeTab === 'courses')
      ? 'timeline'
      : activeTab;
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
  const timelineSource = useMemo(() => (
    dataSource === 'postgres'
      ? (hasMatchingServerTimeline && serverTimeline.items ? serverTimeline.items : [])
      : fallbackTimeline
  ), [dataSource, fallbackTimeline, hasMatchingServerTimeline, serverTimeline.items]);
  const cleanupAudits = useMemo(() => timelineSource.map(timelineCleanupAudit).filter(Boolean).slice(0, 3), [timelineSource]);
  const timelineCounts = useMemo(() => timelineSource.reduce((counts, item) => {
    const category = isAitUsaContact ? timelineCategory(item) : timelineFilterCategory(item);
    if (!isSourceDetailTimelineItem(item)) counts.all += 1;
    counts[category] = (counts[category] || 0) + 1;
    if (isAitUsaContact && item.presentation?.isImported && category !== 'import') {
      counts.import = (counts.import || 0) + 1;
    }
    return counts;
  }, { all: 0 }), [isAitUsaContact, timelineSource]);
  const renderedTimelineFilter = detailView.timelineFilters.some((filter) => filter.value === timelineFilter) ? timelineFilter : 'all';
  const timeline = useMemo(() => {
    return timelineSource.filter((item) => timelineMatchesFilter(item, renderedTimelineFilter, isAitUsaContact));
  }, [isAitUsaContact, renderedTimelineFilter, timelineSource]);
  const latestReviewActivity = useMemo(() => (
    timelineSource.find((item) => !isSourceDetailTimelineItem(item)) || null
  ), [timelineSource]);
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
  const reviewSummary = [
    {
      label: 'Status',
      value: detailView.workflowTitle || contact?.status || contact?.currentStage || 'No status set',
      detail: detailView.sourceEyebrow || contactBusinessUnit?.name || '',
    },
    {
      label: 'Owner',
      value: assignedEmployee?.label || 'Unassigned',
      detail: assignedEmployee ? 'Assigned coordinator' : 'No coordinator assigned',
      tone: assignedEmployee ? '' : 'warning',
    },
    {
      label: 'Contactability',
      value: detailView.contactability?.label || 'Reachable',
      detail: detailView.contactability?.reason || [
        cleanText(contact?.phone) ? 'Phone on file' : '',
        cleanText(contact?.email) ? 'Email on file' : '',
      ].filter(Boolean).join(' and ') || 'No contact channel on file',
      tone: detailView.contactability?.canFollowUp === false ? 'warning' : '',
    },
    {
      label: 'Latest activity',
      value: latestReviewActivity ? compactReviewText(latestReviewActivity.title || latestReviewActivity.text || timelineCategoryLabel(latestReviewActivity)) : 'No activity recorded',
      detail: latestReviewActivity ? [timelineCategoryLabel(latestReviewActivity), dateLabel(latestReviewActivity)].filter(Boolean).join(' - ') : 'Timeline is empty',
    },
    {
      label: 'Next context',
      value: detailView.workflowNext ? compactReviewText(detailView.workflowNext) : 'No next follow-up recorded',
      detail: detailView.workflowChips?.length ? detailView.workflowChips.join(' - ') : '',
      tone: detailView.workflowNext || detailView.workflowChips?.length ? '' : 'muted',
    },
  ];
  const conversationStatus = dataSource === 'postgres' && contact?.id && !hasMatchingServerConversations
    ? 'loading'
    : hasMatchingServerConversations && serverConversations.error
      ? 'error'
      : 'idle';
  const currentLinkedPeople = linkedPeople.contactId === contact?.id
    ? linkedPeople
    : { contactId: contact?.id || '', items: [], loading: showLinkedPeoplePanel && dataSource === 'postgres', error: '' };
  const contentTabs = [
    { id: 'timeline', label: isAitUsaContact ? 'Activity' : 'Timeline' },
    { id: 'conversations', label: 'Conversations', count: conversationMessages.length },
    ...(showCoursesTab ? [{ id: 'courses', label: isAitUsaContact ? 'Enrollments' : 'Courses', count: currentCourseRecords.length }] : []),
    ...(showLinkedPeoplePanel ? [{ id: 'contacts', label: 'Contacts', count: currentLinkedPeople.items.length }] : []),
    ...(showWorkOrdersTab ? [{ id: 'workorders', label: detailView.tabs.workOrdersLabel, count: contactWorkOrders.length }] : []),
    ...(showFinancialsTab ? [{ id: 'financials', label: detailView.tabs.financialLabel, count: visibleFinancials.length }] : []),
  ];
  const visibleTimelineFilters = detailView.timelineFilters.filter((filter) => {
    if (!isAitUsaContact) return true;
    if (['import', 'system'].includes(filter.value)) return false;
    return filter.value === 'all' || filter.value === renderedTimelineFilter || (timelineCounts[filter.value] || 0) > 0;
  });
  const timelineMoreFilters = isAitUsaContact
    ? detailView.timelineFilters.filter((filter) => (
        ['import', 'system'].includes(filter.value) &&
        ((timelineCounts[filter.value] || 0) > 0 || renderedTimelineFilter === filter.value)
      ))
    : [];
  const timelineMoreCount = isAitUsaContact
    ? timelineSource.filter((item) => timelineMoreFilters.some((filter) => timelineMatchesFilter(item, filter.value, true))).length
    : 0;

  const handleContentTabKeyDown = (event, index) => {
    const lastIndex = contentTabs.length - 1;
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = index === lastIndex ? 0 : index + 1;
    else if (event.key === 'ArrowLeft') nextIndex = index === 0 ? lastIndex : index - 1;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = lastIndex;
    else return;
    event.preventDefault();
    setActiveTab(contentTabs[nextIndex].id);
    requestAnimationFrame(() => contentTabRefs.current[nextIndex]?.focus());
  };

  useEffect(() => {
    if (!isAitUsaContact || !contact?.id || !contactBusinessUnit?.id || dataSource !== 'postgres') return undefined;
    let cancelled = false;
    const requestKey = taskProjectionKey;
    const query = new URLSearchParams({
      contactId: contact.id,
      businessUnitId: contactBusinessUnit.id,
      taskType: 'follow_up',
    });
    fetch(`/api/tasks?${query.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Follow-up tasks could not load.');
        if (!cancelled) {
          setTaskProjection({
            key: requestKey,
            items: scopedOpenFollowUpTasks(payload),
            loading: false,
            error: '',
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setTaskProjection({
            key: requestKey,
            items: [],
            loading: false,
            error: error.message || 'Follow-up tasks could not load.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [contact?.id, contactBusinessUnit?.id, dataSource, isAitUsaContact, taskProjectionKey]);

  useEffect(() => {
    if (!contact?.id || dataSource !== 'postgres') return undefined;
    let cancelled = false;
    const requestContactId = contact.id;
    const requestReloadKey = timelineReloadKey;
    loadContactTimeline(contact.id)
      .then((items) => {
        if (!cancelled) {
          setServerTimeline({
            contactId: requestContactId,
            reloadKey: requestReloadKey,
            items,
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
    if (!showCoursesTab || !contact?.id || dataSource !== 'postgres') {
      return undefined;
    }
    let cancelled = false;
    const requestContactId = contact.id;
    fetch(`/api/contacts/${contact.id}/courses`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Course history load failed.');
        if (!cancelled) {
          const items = Array.isArray(payload.courses) ? payload.courses : [];
          setCourseRecordsState({
            contactId: requestContactId,
            items,
            sections: Array.isArray(payload.classSections) ? payload.classSections : [],
            loading: false,
            error: '',
          });
          setSelectedCourseRecordId((current) => (
            current && items.some((item) => item.id === current)
              ? current
              : items[0]?.id || ''
          ));
        }
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          setCourseRecordsState({
            contactId: requestContactId,
            items: [],
            sections: [],
            loading: false,
            error: error.message || 'Course history load failed.',
          });
          setSelectedCourseRecordId('');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [contact?.id, dataSource, showCoursesTab]);

  useEffect(() => {
    if (!contact?.id || dataSource !== 'postgres') return undefined;
    let cancelled = false;
    const requestContactId = contact.id;
    fetch(`/api/contacts/${contact.id}/phones`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Phone history load failed.');
        if (!cancelled) {
          setPhoneHistoryState({
            contactId: requestContactId,
            items: Array.isArray(payload.phones) ? payload.phones : [],
            loading: false,
            error: '',
          });
        }
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          setPhoneHistoryState({
            contactId: requestContactId,
            items: [],
            loading: false,
            error: error.message || 'Phone history load failed.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [contact?.id, dataSource]);

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
    if (!access.canSendOutboundMessages || !access.canReadSettings || dataSource !== 'postgres') return undefined;
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
  }, [access.canReadSettings, access.canSendOutboundMessages, dataSource]);

  const channelTemplates = useMemo(() => messageTemplates.filter((template) => (
    template.channel === manualSend.channel || template.channel === 'all'
  )), [messageTemplates, manualSend.channel]);

  const openEditModal = () => {
    if (!access.canWriteCrm) return;
    setActiveProfileEditTab(isAitUsaContact ? 'contact' : 'general');
    setEditForm({
      ...contact,
      assignedTo: contact?.assignedTo || '',
      statusChangeReason: '',
      terminalStatusReason: '',
      leadProfile: {
        programInterest: contact?.programInterest || '',
        preferredDay: contact?.preferredDay || '',
        preferredSchedule: contact?.preferredSchedule || '',
        testInterest: contact?.testInterest || '',
        educationLevel: contact?.educationLevel || '',
        schoolName: contact?.schoolName || '',
        locationPreference: contact?.locationPreference || '',
        profileDetails: contact?.profileDetails || '',
        sourceDetail: contact?.sourceDetail || '',
      },
    });
    setStartOpportunityOpen(false);
    setStartOpportunityError('');
    setStartOpportunityForm({
      status: 'New Lead',
      assignedTo: isAitUsaContact && !canManageContactAssignments
        ? ''
        : coordinatorUiPolicy.lockedOwnerUserId || contact?.assignedTo || '',
      reason: '',
    });
    setIsEditModalOpen(true);
  };

  const startOpportunity = async () => {
    if (!contact?.id || !contactBusinessUnit?.id || startOpportunityBusy) return;
    setStartOpportunityBusy(true);
    setStartOpportunityError('');
    try {
      const response = await fetch(`/api/contacts/${contact.id}/opportunities`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          businessUnitId: contactBusinessUnit.id,
          status: startOpportunityForm.status,
          assignedTo: isAitUsaContact && !canManageContactAssignments
            ? ''
            : coordinatorUiPolicy.lockedOwnerUserId || startOpportunityForm.assignedTo || '',
          reason: startOpportunityForm.reason,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Opportunity could not be started.');
      replaceContactFromServer(payload.contact);
      setEditForm((current) => ({ ...current, ...payload.contact, terminalStatusReason: '', statusChangeReason: '' }));
      setStartOpportunityOpen(false);
      setTimelineReloadKey((key) => key + 1);
      toast('Opportunity started');
    } catch (error) {
      setStartOpportunityError(error.message || 'Opportunity could not be started.');
    } finally {
      setStartOpportunityBusy(false);
    }
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

  const deletePerson = async () => {
    const person = personDeleteTarget;
    if (!contact?.id || !person?.id || !access.canWriteCrm) return;
    setPersonDeleteBusy(true);
    try {
      const response = await fetch(`/api/contacts/${contact.id}/people`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: person.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Linked person delete failed.');
      setLinkedPeople({
        contactId: contact.id,
        items: Array.isArray(payload.people) ? payload.people : [],
        loading: false,
        error: '',
      });
      setPersonDeleteTarget(null);
      toast('Linked person removed', 'error');
    } catch (error) {
      toast(error.message || 'Linked person delete failed.', 'error');
    } finally {
      setPersonDeleteBusy(false);
    }
  };

  const openCourseModal = (mode = 'new', record = null) => {
    if (!access.canWriteCrm || !showCoursesTab) return;
    const isEdit = mode === 'edit' && record;
    const isComplete = mode === 'complete' && record;
    const isEnd = mode === 'end' && record;
    setCourseForm(isEdit || isComplete || isEnd ? {
      id: record.id,
      classSectionId: record.classSectionId || '',
      courseName: record.courseName || '',
      courseLocation: record.courseLocation || '',
      teacher: record.teacher || '',
      status: isComplete ? 'completed' : (isEnd ? 'cancelled' : record.status || 'active'),
      startDate: dateForInput(record.startDate),
      endDate: dateForInput(record.endDate) || (isComplete || isEnd ? todayDate() : ''),
      outcomeReason: record.outcomeReason || '',
      notes: record.notes || '',
    } : {
      ...emptyCourseForm,
      courseLocation: mode === 'history' ? '' : schoolLocationForContact(contact),
      status: mode === 'history' ? 'completed' : 'active',
      startDate: mode === 'history' ? '' : todayDate(),
      endDate: mode === 'history' ? todayDate() : '',
    });
    setCourseModal(mode);
    setCourseError('');
  };

  const openEnrollmentCoursePrompt = () => {
    if (!canStartEnrollment || !showCoursesTab || activeCourseRecord) return;
    setActiveTab('courses');
    openCourseModal('start');
  };

  const openEnrollmentWorkspaceFromProfile = () => {
    setIsEditModalOpen(false);
    setActiveTab('courses');
    if (canStartEnrollment && !activeCourseRecord) openCourseModal('start');
  };

  const closeCourseModal = () => {
    if (courseBusy) return;
    setCourseModal(null);
    setCourseForm(emptyCourseForm);
    setCourseError('');
  };

  const updateCourseForm = (patch) => {
    setCourseForm((current) => ({
      ...current,
      ...patch,
    }));
  };

  const selectClassSection = (classSectionId) => {
    const section = currentClassSections.find((item) => item.id === classSectionId);
    updateCourseForm(section ? {
      classSectionId: section.id,
      courseName: section.courseName || '',
      courseLocation: section.courseLocation || '',
      teacher: section.teacher || '',
    } : { classSectionId: '' });
  };

  const saveCourseRecord = async () => {
    if (!contact?.id || !access.canWriteCrm || courseBusy) return;
    if (!cleanText(courseForm.courseName)) {
      setCourseError('Course name is required.');
      return;
    }
    if (courseForm.status === 'active' && !courseForm.startDate) {
      setCourseError('Start date is required for the current course.');
      return;
    }
    setCourseBusy(true);
    setCourseError('');
    try {
      const response = await fetch(`/api/contacts/${contact.id}/courses`, {
        method: courseForm.id ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...courseForm,
          ...(!courseForm.id ? {
            enrollmentIntent: courseModal === 'history' ? 'past_enrollment' : 'start_enrollment',
            opportunityId: contact.opportunityId || '',
          } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Course save failed.');
      const items = Array.isArray(payload.courses) ? payload.courses : [];
      setCourseRecordsState({
        contactId: contact.id,
        items,
        sections: Array.isArray(payload.classSections) ? payload.classSections : currentClassSections,
        loading: false,
        error: '',
      });
      setSelectedCourseRecordId(courseForm.id || items[0]?.id || '');
      if (payload.opportunity) {
        replaceContactFromServer({
          ...contact,
          opportunityId: payload.opportunity.id,
          status: payload.opportunity.status,
          currentStage: payload.opportunity.currentStage || payload.opportunity.status,
          activeOpportunityCount: 1,
          opportunityConflict: false,
        });
        setTimelineReloadKey((current) => current + 1);
        setTaskProjectionReloadKey((current) => current + 1);
      }
      setCourseModal(null);
      setCourseForm(emptyCourseForm);
      toast(courseForm.id
        ? 'Enrollment updated'
        : (courseModal === 'history' ? 'Past enrollment added' : 'Enrollment started'));
    } catch (error) {
      const message = error.message || 'Course save failed.';
      setCourseError(message);
      toast(message, 'error');
    } finally {
      setCourseBusy(false);
    }
  };

  const handleEditSave = () => {
    if (isClosedStatusReopen && !editForm.statusChangeReason) {
      focusProfileEditField(isAitUsaContact ? 'inquiry' : 'general', 'profile-edit-reopen-reason');
      toast('Choose why this closed status is being reopened.', 'error');
      return;
    }
    if (isEnteringClosedStatus && !editForm.terminalStatusReason?.trim()) {
      focusProfileEditField(isAitUsaContact ? 'inquiry' : 'general', 'profile-edit-terminal-reason');
      toast('Add a reason for closing this Opportunity.', 'error');
      return;
    }
    const attemptedEnrollmentTransition = isAitUsaContact &&
      editForm.status !== contact.status &&
      isEnrolledWorkflowStatus(editForm.status);
    if (attemptedEnrollmentTransition) {
      focusProfileEditField('inquiry', 'profile-edit-status');
      toast('Start enrollment from the Enrollments workspace so the enrollment and inquiry update together.', 'error');
      return;
    }
    const profilePatch = buildContactProfilePatch({
      editForm,
      contact,
      isAitUsa: isAitUsaContact,
      lockedOwnerUserId: coordinatorUiPolicy.lockedOwnerUserId,
      canManageAssignments: canManageContactAssignments,
      isClosedStatusReopen,
      isEnteringClosedStatus,
    });
    updateContact(contact.id, profilePatch)
      .then(() => {
        toast('Profile updated');
        setTimelineReloadKey((key) => key + 1);
        setIsEditModalOpen(false);
      })
      .catch((error) => {
        toast(error.message || 'Profile update failed', 'error');
    });
  };

  const handleProfileEditTabKeyDown = (event, tabIndex) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const lastIndex = profileEditTabs.length - 1;
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? lastIndex
        : event.key === 'ArrowRight'
          ? (tabIndex + 1) % profileEditTabs.length
          : (tabIndex - 1 + profileEditTabs.length) % profileEditTabs.length;
    setActiveProfileEditTab(profileEditTabs[nextIndex].id);
    profileEditTabRefs.current[nextIndex]?.focus();
  };

  const focusProfileEditField = (tabId, fieldId) => {
    setActiveProfileEditTab(tabId);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => document.getElementById(fieldId)?.focus());
    });
  };

  const handleArchiveContact = () => {
    if (!contact || archiveBusy || !access.canWriteCrm) return;
    const reason = cleanText(archiveReason) || 'Archived from contact profile.';
    setArchiveBusy(true);
    deleteContact(contact.id, { reason })
      .then((result) => {
        toast(result?.approvalRequested
          ? `Archive approval requested for ${contact.name || singularLabel.toLowerCase()}`
          : `${singularLabel} archived`);
        setArchiveConfirmOpen(false);
        setIsEditModalOpen(false);
        if (!result?.approvalRequested) router.push(isClientMode ? '/clients' : '/contacts');
      })
      .catch((error) => toast(error.message || 'Archive failed', 'error'))
      .finally(() => setArchiveBusy(false));
  };

  const updateEditLeadProfile = (field, value) => {
    setEditForm((current) => ({
      ...current,
      leadProfile: {
        ...(current?.leadProfile || {}),
        [field]: value,
      },
    }));
  };

  const openFollowUpModal = useCallback(() => {
    if (!contact?.id || !access.canWriteCrm) return;
    const requestedTaskId = searchParams.get('taskId') || '';
    const lookup = buildContactFollowUpLookup({
      taskId: requestedTaskId,
      leadId: searchParams.get('leadId') || '',
      hasLeadId: searchParams.has('leadId'),
    });
    setFollowUpDraft(defaultFollowUpDraft(contact, currentUser, ownerOptions));
    setFollowUpTask(null);
    setFollowUpRequestedTaskId(requestedTaskId);
    setFollowUpLeadId(null);
    setFollowUpError('');
    setFollowUpOpen(true);
    if (dataSource !== 'postgres') return;
    setFollowUpResolving(true);

    fetch(`/api/contacts/${contact.id}/follow-up?${lookup.params.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Follow-up task lookup failed.');
        if (!Object.prototype.hasOwnProperty.call(payload, 'leadId')) {
          throw new Error('Follow-up Lead context was not returned. Refresh and try again.');
        }
        if (requestedTaskId && payload.task?.id !== requestedTaskId) {
          throw new Error('The selected follow-up task was not returned. Close this dialog and reopen it from the task queue.');
        }
        setFollowUpTask(payload.task || null);
        setFollowUpLeadId(payload.leadId || null);
      })
      .catch((error) => {
        setFollowUpError(error.message || 'Follow-up task lookup failed.');
      })
      .finally(() => {
        setFollowUpResolving(false);
      });
  }, [access.canWriteCrm, contact, currentUser, dataSource, ownerOptions, searchParams]);

  const closeFollowUpModal = () => {
    if (followUpBusy) return;
    setFollowUpOpen(false);
    setFollowUpDraft(null);
    setFollowUpTask(null);
    setFollowUpRequestedTaskId('');
    setFollowUpLeadId(null);
    setFollowUpResolving(false);
    setFollowUpError('');
    if (searchParams.get('action') === 'log-follow-up') {
      const next = new URLSearchParams(searchParams.toString());
      next.delete('action');
      next.delete('taskId');
      next.delete('contactId');
      next.delete('leadId');
      router.replace(next.toString() ? `?${next.toString()}` : `/contacts/${contact.id}`, { scroll: false });
    }
  };

  useEffect(() => {
    if (searchParams.get('action') !== 'log-follow-up' || !contact?.id || !access.canWriteCrm) return;
    const requestedTaskId = searchParams.get('taskId') || '';
    const lookup = buildContactFollowUpLookup({
      taskId: requestedTaskId,
      leadId: searchParams.get('leadId') || '',
      hasLeadId: searchParams.has('leadId'),
    });
    const signature = `${contact.id}:log-follow-up:${requestedTaskId}:${lookup.selectionKey}`;
    if (followUpActionHandledRef.current === signature) return;
    followUpActionHandledRef.current = signature;
    openFollowUpModal();
  }, [access.canWriteCrm, contact?.id, openFollowUpModal, searchParams]);

  const updateFollowUpDraft = (patch) => {
    setFollowUpDraft((current) => ({
      ...defaultFollowUpDraft(contact, currentUser, ownerOptions),
      ...(current || {}),
      ...patch,
    }));
  };

  const updateFollowUpLeadProfile = (field, value) => {
    setFollowUpDraft((current) => ({
      ...defaultFollowUpDraft(contact, currentUser, ownerOptions),
      ...(current || {}),
      leadProfile: {
        ...((current || {}).leadProfile || {}),
        [field]: value,
      },
    }));
  };

  const submitFollowUpLog = async () => {
    if (!contact?.id || !access.canWriteCrm || !followUpDraft || followUpBusy || followUpResolving || followUpError) return;
    if (!followUpDraft.note.trim()) {
      setFollowUpError('Follow-up note is required.');
      return;
    }
    setFollowUpBusy(true);
    setFollowUpError('');
    try {
      const response = await fetch(`/api/contacts/${contact.id}/follow-up`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          taskId: followUpSubmissionTaskId({
            requestedTaskId: followUpRequestedTaskId,
            task: followUpTask,
          }),
          contactId: contact.id,
          leadId: followUpLeadId,
          outcome: followUpDraft.outcome,
          channel: followUpDraft.channel,
          contactMethod: followUpDraft.contactMethod,
          note: followUpDraft.note,
          nextDueAt: dateInputToIso(followUpDraft.nextDueDate),
          appointmentAt: dateTimeInputToIso(followUpDraft.appointmentAt),
          nextOwnerUserId: coordinatorUiPolicy.lockedOwnerUserId || followUpDraft.nextOwnerUserId || currentUser?.id || null,
          leadProfile: followUpDraft.leadProfile,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Follow-up log failed.');
      setFollowUpOpen(false);
      setFollowUpDraft(null);
      setFollowUpTask(null);
      setFollowUpRequestedTaskId('');
      setFollowUpLeadId(null);
      if (searchParams.get('action') === 'log-follow-up') {
        router.replace(`/contacts/${contact.id}`, { scroll: false });
      }
      setTimelineFilter('all');
      setTimelineReloadKey((key) => key + 1);
      setTaskProjectionReloadKey((key) => key + 1);
      const resultLabel = payload.taskMatched ? 'Follow-up task completed' : 'Follow-up logged';
      toast(payload.nextTask
        ? `${resultLabel} · next task scheduled`
        : `${resultLabel} · no next task scheduled`);
    } catch (error) {
      const message = error.message || 'Follow-up log failed.';
      setFollowUpError(message);
      toast(message, 'error');
    } finally {
      setFollowUpBusy(false);
    }
  };

  const openEstimateModal = () => {
    if (!contact?.id || !access.canWriteFinancials) return;
    const baseAmount = moneyValue(latestWorkOrder?.estimatedCost || latestWorkOrder?.amount);
    setEstimateForm({
      ...emptyEstimateForm,
      number: '',
      client: contact.name || '',
      contactId: contact.id,
      businessUnitId: contact.primaryBusinessUnitId || contact.businessUnitId || contactBusinessUnit?.id || '',
      date: todayDate(),
      dueDate: '',
      items: [{
        desc: latestWorkOrder?.title || `${contact.name || 'Client'} estimate`,
        qty: 1,
        rate: baseAmount,
      }],
    });
    setEstimateModalOpen(true);
  };

  const updateEstimateItem = (index, key, value) => {
    setEstimateForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => (
        itemIndex === index ? { ...item, [key]: value } : item
      )),
    }));
  };

  const addEstimateItem = () => {
    setEstimateForm((current) => ({
      ...current,
      items: [...current.items, { desc: '', qty: 1, rate: 0 }],
    }));
  };

  const removeEstimateItem = (index) => {
    setEstimateForm((current) => ({
      ...current,
      items: current.items.length > 1
        ? current.items.filter((_, itemIndex) => itemIndex !== index)
        : current.items,
    }));
  };

  const saveEstimate = () => {
    if (!contact?.id || !access.canWriteFinancials) return;
    if (estimateTotal <= 0) {
      toast('Estimate needs at least one billable line item.', 'error');
      return;
    }
    addFinancial({
      ...estimateForm,
      type: 'Estimate',
      contactId: contact.id,
      client: contact.name || estimateForm.client,
      businessUnitId: estimateForm.businessUnitId || contact.primaryBusinessUnitId || contact.businessUnitId || '',
      amount: estimateTotal,
      subtotal: estimateTotal,
      tax: 0,
      paidAmount: moneyValue(estimateForm.paidAmount),
      balanceDue: Math.max(estimateTotal - moneyValue(estimateForm.paidAmount), 0),
      date: estimateForm.date || todayDate(),
      items: estimateForm.items.map((item) => ({
        ...item,
        qty: moneyValue(item.qty || 1),
        rate: moneyValue(item.rate),
        amount: moneyValue(item.qty || 1) * moneyValue(item.rate),
      })),
    })
      .then(() => {
        setEstimateModalOpen(false);
        setTimelineReloadKey((key) => key + 1);
        toast('Estimate saved');
      })
      .catch((error) => toast(error.message || 'Estimate save failed.', 'error'));
  };

  const openPaymentModal = (invoice = latestInvoice) => {
    if (!contact?.id || !access.canWriteFinancials) return;
    if (!invoice) {
      toast('Generate an invoice from a work order before recording a payment.', 'error');
      return;
    }
    const workOrder = contactWorkOrders.find((entry) => entry.id === invoice?.workOrderId) || null;
    const workOrderTotal = moneyValue(invoice?.amount || invoice?.balanceDue || workOrder?.estimatedCost || workOrder?.amount);
    const paid = contactFinancials
      .filter((record) => record.workOrderId && record.workOrderId === workOrder?.id)
      .filter((record) => financialCategory(record) === 'payment')
      .reduce((sum, record) => sum + moneyValue(record.paidAmount || record.amount), 0);
    setPaymentForm({
      ...emptyPaymentForm,
      workOrderId: workOrder?.id || '',
      amount: workOrderTotal ? String(Math.max(workOrderTotal - paid, 0)) : '',
      paidAt: todayDate(),
    });
    setPaymentModalOpen(true);
  };

  const savePayment = () => {
    if (!contact?.id || !access.canWriteFinancials) return;
    const amount = moneyValue(paymentForm.amount);
    if (amount <= 0) {
      toast('Payment amount is required.', 'error');
      return;
    }
    const workOrder = contactWorkOrders.find((entry) => entry.id === paymentForm.workOrderId) || null;
    if (!contactInvoices.some((invoice) => invoice.workOrderId && invoice.workOrderId === workOrder?.id)) {
      toast('Generate an invoice from a work order before recording a payment.', 'error');
      return;
    }
    const paymentPayload = {
      contactId: contact.id,
      client: contact.name || '',
      businessUnitId: workOrder?.businessUnitId || contact.primaryBusinessUnitId || contact.businessUnitId || '',
      workOrderId: workOrder?.id || '',
      amount,
      paymentMethod: paymentForm.paymentMethod,
      paidAt: paymentForm.paidAt || todayDate(),
      checkNumber: paymentForm.checkNumber,
      note: paymentForm.note,
    };
    recordPayment(paymentPayload)
      .then(() => {
        setPaymentModalOpen(false);
        setTimelineReloadKey((key) => key + 1);
        toast('Payment recorded');
      })
      .catch((error) => toast(error.message || 'Payment save failed.', 'error'));
  };

  const downloadFinancialPdf = (record) => {
    if (!record) return;
    if (record.type === 'Estimate') generateEstimatePDF(record, financialContext);
    else if (record.type === 'Invoice') generateInvoicePDF(record, financialContext);
    else if (/ait usa|institute/i.test(contactBusinessUnit?.name || '')) generateAitUsaReceiptPDF(record, financialContext);
    else generateReceiptPDF(record, financialContext);
    toast('PDF downloaded');
  };

  const downloadInvoiceFromWorkOrder = (workOrder) => {
    if (!workOrder) {
      toast('Select a work order before generating an invoice.', 'error');
      return;
    }
    const amount = moneyValue(workOrder.estimatedCost || workOrder.amount);
    const paidAmount = contactFinancials
      .filter((record) => record.workOrderId === workOrder.id)
      .filter((record) => financialCategory(record) === 'payment')
      .reduce((sum, record) => sum + moneyValue(record.paidAmount || record.amount), 0);
    const invoice = {
      id: `invoice-${workOrder.id}`,
      number: workOrder.number ? `INV-${workOrder.number}` : `INV-${workOrder.id}`,
      type: 'Invoice',
      client: contact.name || workOrder.client || '',
      contactId: contact.id,
      businessUnitId: workOrder.businessUnitId || contact.primaryBusinessUnitId || contact.businessUnitId || '',
      amount,
      paidAmount,
      balanceDue: Math.max(amount - paidAmount, 0),
      date: todayDate(),
      dueDate: workOrder.dueDate || '',
      status: amount > 0 && paidAmount >= amount ? 'Paid' : 'Pending',
      workOrderId: workOrder.id,
      paymentMethod: '',
      items: [{
        desc: workOrder.title || 'Work order',
        qty: 1,
        rate: amount,
        amount,
      }],
    };
    addFinancial(invoice)
      .then((savedInvoice) => {
        generateInvoicePDF(savedInvoice || invoice, financialContext);
        setTimelineReloadKey((key) => key + 1);
        toast('Invoice saved and downloaded');
      })
      .catch((error) => toast(error.message || 'Invoice save failed.', 'error'));
  };

  const downloadSelectedWorkOrderInvoice = () => {
    if (!selectedInvoiceWorkOrder) {
      toast('Select a work order before generating an invoice.', 'error');
      return;
    }
    downloadInvoiceFromWorkOrder(selectedInvoiceWorkOrder);
  };

  const recordPaymentAgainstInvoice = (invoice = latestInvoice) => {
    if (!invoice) {
      toast('Generate an invoice from a work order before recording a payment.', 'error');
      return;
    }
    openPaymentModal(invoice);
  };

  const moveToNextStatus = () => {
    if (!contact?.id || !nextStatus || statusUpdating || !access.canWriteCrm) return;
    const confirmed = window.confirm(`Move ${contact.name} from ${contact.status} to ${nextStatus}?`);
    if (!confirmed) return;
    const shouldPromptForCourse = isAitUsaContact && isEnrolledWorkflowStatus(nextStatus) && !activeCourseRecord;
    setStatusUpdating(true);
    updateContact(contact.id, { status: nextStatus })
      .then(() => {
        toast(`Status moved to ${nextStatus}`);
        setTimelineReloadKey((key) => key + 1);
        if (shouldPromptForCourse) {
          openEnrollmentCoursePrompt();
        }
      })
      .catch((error) => {
        toast(error.message || 'Status update failed', 'error');
      })
      .finally(() => {
        setStatusUpdating(false);
      });
  };

  if (detailPageState === 'loading') {
    return <PageState tone="loading" title={`Loading ${singularLabel.toLowerCase()}`} copy="Preparing profile, timeline, linked records, and communication history." />;
  }

  if (detailPageState === 'not-found') {
    return (
      <PageState
        tone="not-found"
        title={`${singularLabel} not found`}
        copy={`This ${singularLabel.toLowerCase()} may be outside your current scope or no longer available.`}
        actions={<PageStateAction href="/contacts">Back to Contacts</PageStateAction>}
      />
    );
  }

  const addNote = async (event) => {
    event?.preventDefault();
    if (!noteInput.trim() || !access.canWriteCrm || noteSaving || noteSaveInFlight.current) return;
    const newNote = {
      text: noteInput,
      createdAt: new Date().toISOString(),
      id: crypto.randomUUID()
    };
    noteSaveInFlight.current = true;
    setNoteSaving(true);
    try {
      const save = dataSource === 'postgres'
        ? appendContactNote(contact.id, newNote.text)
        : updateContact(contact.id, {
            notes: Array.isArray(contact.notes) ? [...contact.notes, newNote] : [newNote],
          });
      await save;
      setNoteInput('');
      if (isAitUsaContact) {
        setNoteComposerOpen(false);
        window.requestAnimationFrame(() => noteTriggerRef.current?.focus());
      }
      setTimelineReloadKey((key) => key + 1);
      toast('Note added');
    } catch (error) {
      toast(error.message || 'Note save failed', 'error');
    } finally {
      noteSaveInFlight.current = false;
      setNoteSaving(false);
    }
  };

  const openInternalNoteComposer = () => {
    if (noteComposerOpen) {
      noteInputRef.current?.focus();
      return;
    }
    setNoteComposerOpen(true);
  };

  const cancelInternalNote = () => {
    if (noteSaving) return;
    setNoteInput('');
    setNoteComposerOpen(false);
    window.requestAnimationFrame(() => noteTriggerRef.current?.focus());
  };

  const submitManualSend = () => {
    if (!access.canSendOutboundMessages || !contact?.id || manualSend.sending) return;
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

  const legacyProfileSidebar = (
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
        {phoneHistoryState.contactId === contact.id && phoneHistoryState.items.some((phone) => !phone.isPrimary) && (
          <div className={s.infoItem}>
            <Archive size={16} />
            <div className={s.phoneHistory}>
              <strong>Previous phone numbers</strong>
              {phoneHistoryState.items.filter((phone) => !phone.isPrimary).map((phone) => (
                <span key={phone.id || phone.normalizedPhone}>
                  {phone.phone}
                  {phone.isWrongNumber ? ' · Wrong number' : phone.isDoNotCall ? ' · Do not call' : ' · Historical — do not use for outreach'}
                </span>
              ))}
            </div>
          </div>
        )}
        {phoneHistoryState.contactId === contact.id && phoneHistoryState.error && (
          <div className={s.infoItem}>
            <AlertCircle size={16} />
            <span className={s.missingInfo}>{phoneHistoryState.error}</span>
          </div>
        )}
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
          <div className={s.userAvatarSmall}>{(assignedEmployee?.label || 'U').charAt(0)}</div>
          <span>{assignedEmployee?.label || 'Unassigned'}</span>
        </div>
      </div>

      {access.canWriteCrm && (
        <div className={s.actionPanel} aria-label={`${detailView.profileTitle} actions`}>
          <div className={s.actionPanelHeader}>Actions</div>
          {nextStatus && (!isAitUsaContact || contact.hasLeadStatus) && (
            <button
              className={`${s.statusStepButton} btn btn-block`}
              type="button"
              onClick={moveToNextStatus}
              disabled={statusUpdating}
            >
              <ArrowRight size={16} style={{marginRight: 8}} /> {statusUpdating ? 'Updating...' : `Move to ${nextStatus}`}
            </button>
          )}
          <Link
            className="btn btn-block btn-primary"
            href={`/tasks?contactId=${encodeURIComponent(contact.id)}&taskType=follow_up`}
          >
            <CheckSquare size={16} style={{marginRight: 8}} /> Create Follow-up
          </Link>
          {showWorkOrdersTab && access.canWriteWorkOrders && (
            <Link
              className="btn btn-block"
              href={`/work-orders?contactId=${encodeURIComponent(contact.id)}`}
            >
              <ClipboardList size={16} style={{marginRight: 8}} /> Create Work Order
            </Link>
          )}
          <button className="btn btn-block" onClick={openEditModal}>
            <Edit3 size={16} style={{marginRight: 8}} /> Edit Profile
          </button>
        </div>
      )}
    </div>
  );

  const renderInstituteNextStep = (headingId, className = '') => (
    <section className={`${s.nextStep} ${s[`nextStep_${sidebarNextStep.kind}`] || ''} ${className}`} aria-labelledby={headingId}>
      <div className={s.nextStepHeader}>
        <div>
          <NextStepIcon size={16} />
          <h2 id={headingId}>Next step</h2>
        </div>
        {!currentTaskProjection.loading && !currentTaskProjection.error && (
          <span className={s.nextStepState}>{sidebarNextStep.stateLabel}</span>
        )}
      </div>

      {currentTaskProjection.loading ? (
        <div className={s.nextStepLoading} role="status">Loading follow-up status…</div>
      ) : currentTaskProjection.error ? (
        <div className={s.nextStepError} role="alert">
          <strong>Follow-up status unavailable</strong>
          <span>{currentTaskProjection.error}</span>
          <button type="button" onClick={() => setTaskProjectionReloadKey((key) => key + 1)}>Try again</button>
        </div>
      ) : (
        <>
          <div className={s.nextStepBody}>
            <strong>{sidebarNextStep.title}</strong>
            <p>{sidebarNextStep.detail}</p>
            {sidebarNextStep.dueAt && <span>Due {taskDateLabel(sidebarNextStep.dueAt)}</span>}
            {sidebarNextStep.ownerLabel && <span>Owner: {sidebarNextStep.ownerLabel}</span>}
            {['restricted', 'missing_contact'].includes(sidebarNextStep.kind) && sidebarNextStep.taskCount > 0 && (
              <span>{sidebarNextStep.taskCount} open follow-up{sidebarNextStep.taskCount === 1 ? '' : 's'} remains in the task queue.</span>
            )}
          </div>
          {access.canWriteCrm && sidebarNextStep.actionType !== 'none' && (
            <div className={s.nextStepActions}>
              {sidebarNextStep.actionType === 'disabled' ? (
                <button type="button" className="btn btn-primary btn-block" disabled>
                  <AlertCircle size={16} /> {sidebarNextStep.actionLabel}
                </button>
              ) : sidebarNextStep.actionType === 'edit' ? (
                <button type="button" className="btn btn-primary btn-block" onClick={openEditModal}>
                  <Edit3 size={16} /> {sidebarNextStep.actionLabel}
                </button>
              ) : (
                <Link className="btn btn-primary btn-block" href={sidebarNextStep.actionHref}>
                  <NextStepActionIcon size={16} /> {sidebarNextStep.actionLabel}
                </Link>
              )}
              {sidebarNextStep.openHref && (
                <Link className={s.openTaskLink} href={sidebarNextStep.openHref}>Open task details</Link>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );

  const instituteProfileSidebar = (
    <aside className={`${s.profileCard} ${s.instituteProfileCard}`} aria-label={`${contact.name} contact sidebar`}>
      <div className={s.instituteIdentity}>
        <div className={s.profileAvatarLarge}>{contact.name.charAt(0)}</div>
        <h1 className={s.profileName}>{contact.name}</h1>
      </div>

      <section className={s.sidebarSection} aria-labelledby="contact-sidebar-contact">
        <h2 id="contact-sidebar-contact" className={s.sidebarSectionTitle}>Contact</h2>
        <div className={s.contactChannelList}>
          <div className={s.contactChannel}>
            <Mail size={16} />
            <div>
              <span>Email</span>
              {cleanText(contact.email) ? (
                <a href={`mailto:${cleanText(contact.email)}`}>{contact.email}</a>
              ) : (
                <>
                  <strong className={s.placeholderValue}>Not recorded</strong>
                  {detailView.contactability?.status === 'missing_email' && (
                    <small className={s.channelInlineNotice}>{detailView.contactability.reason}</small>
                  )}
                </>
              )}
            </div>
          </div>
          <div className={s.contactChannel}>
            <Phone size={16} />
            <div>
              <span>Phone</span>
              {cleanText(contact.phone) && !contact.isWrongNumber && !contact.isDoNotCall ? (
                <a href={phoneHref(contact.phone)}>{contact.phone}</a>
              ) : cleanText(contact.phone) ? (
                <strong>{contact.phone}</strong>
              ) : (
                <>
                  <strong className={s.placeholderValue}>Not recorded</strong>
                  {detailView.contactability?.status === 'missing_phone' && (
                    <small className={s.channelInlineNotice}>{detailView.contactability.reason}</small>
                  )}
                </>
              )}
            </div>
          </div>
          {contact.address && (
            <div className={s.contactChannel}>
              <MapPin size={16} />
              <div><span>Intended learning location</span><strong>{contact.address}</strong></div>
            </div>
          )}
        </div>

        {detailView.contactability?.status && detailView.contactability.status !== 'reachable' && !inlineContactabilityStatus && (
          <div className={`${s.channelNotice} ${detailView.contactability.canFollowUp === false ? s.channelNoticeBlocked : ''}`}>
            <AlertCircle size={15} />
            <span><strong>{detailView.contactability.label}</strong>{detailView.contactability.reason ? ` — ${detailView.contactability.reason}` : ''}</span>
          </div>
        )}

        {phoneHistoryState.contactId === contact.id && phoneHistoryState.items.some((phone) => !phone.isPrimary) && (
          <details className={s.otherPhones}>
            <summary>Other phone numbers ({phoneHistoryState.items.filter((phone) => !phone.isPrimary).length})</summary>
            <div className={s.otherPhoneList}>
              {phoneHistoryState.items.filter((phone) => !phone.isPrimary).map((phone) => (
                <div key={phone.id || phone.normalizedPhone} className={s.otherPhoneRow}>
                  <strong>{phone.phone || 'Number unavailable'}</strong>
                  <span>{phone.isWrongNumber ? 'Wrong number' : phone.isDoNotCall ? 'Do not call' : 'Historical — not primary'}</span>
                </div>
              ))}
            </div>
          </details>
        )}
        {phoneHistoryState.contactId === contact.id && phoneHistoryState.error && (
          <div className={s.sidebarInlineError}><AlertCircle size={15} /><span>{phoneHistoryState.error}</span></div>
        )}
      </section>

      <section className={s.sidebarSection} aria-labelledby="contact-sidebar-inquiry">
        <h2 id="contact-sidebar-inquiry" className={s.sidebarSectionTitle}>{sidebarInquiry.heading || 'Current inquiry'}</h2>

        {['active', 'history'].includes(sidebarInquiry.kind) ? (
          <>
            <dl className={s.inquiryFacts}>
              <div><dt>Inquiry status</dt><dd><span className={s.inquiryStage}>{sidebarInquiry.facts.status}</span></dd></div>
              <div><dt>Program</dt><dd className={sidebarInquiry.facts.program === 'Not recorded' ? s.placeholderValue : undefined}>{sidebarInquiry.facts.program}</dd></div>
              <div><dt>Student location</dt><dd className={sidebarInquiry.facts.studentLocation === 'Not recorded' ? s.placeholderValue : undefined}>{sidebarInquiry.facts.studentLocation}</dd></div>
              <div>
                <dt>Inquiry owner</dt>
                <dd className={`${s.inquiryOwner} ${!assignedEmployee ? s.placeholderValue : ''}`}>
                  {assignedEmployee && (
                    <span className={s.userAvatarSmall}>{assignedEmployee.label.charAt(0)}</span>
                  )}
                  <span>{assignedEmployee?.label || 'Unassigned'}</span>
                </dd>
              </div>
            </dl>

            {!!secondaryInquiryFacts.length && (
          <details className={s.inquiryPreferences}>
            <summary>More preferences ({secondaryInquiryFacts.length})</summary>
            <dl className={s.inquiryFacts}>
              {secondaryInquiryFacts.map((fact) => (
                <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
              ))}
            </dl>
          </details>
            )}
          </>
        ) : (
          <div className={`${s.inquiryEmptyState} ${sidebarInquiry.kind === 'conflict' ? s.inquiryEmptyStateConflict : ''}`}>
            <strong>{sidebarInquiry.title}</strong>
            <span>{sidebarInquiry.detail}</span>
          </div>
        )}
      </section>

      {renderInstituteNextStep('contact-sidebar-next-step')}

      {access.canWriteCrm && (
        <div className={s.contactProfileActions}>
          {access.canWriteFinancials && (
            <Link className="btn btn-primary btn-block" href={`/payments?flow=take-payment&contactId=${encodeURIComponent(contact.id)}`}>
              <DollarSign size={16} /> Take payment
            </Link>
          )}
          <button className={`${s.editProfileButton} btn btn-block`} type="button" onClick={openEditModal}>
            <Edit3 size={16} /> Edit profile
          </button>
          <details className={s.contactActionOverflow}>
            <summary aria-label="More contact actions">
              <MoreHorizontal size={16} /> More contact actions
            </summary>
            <div className={s.contactActionOverflowPanel}>
              <strong>Contact actions</strong>
              <span>Archive is separate from profile and inquiry edits.</span>
              <button
                className="btn btn-danger"
                type="button"
                onClick={() => {
                  setArchiveReason('');
                  setArchiveConfirmOpen(true);
                }}
              >
                <Archive size={15} />
                {coordinatorUiPolicy.canArchiveContactsDirectly ? 'Archive contact' : 'Request archive approval'}
              </button>
            </div>
          </details>
        </div>
      )}
    </aside>
  );

  const instituteMobileContext = (
    <section className={s.mobileContactContext} aria-labelledby="mobile-contact-context-name">
      <div className={s.mobileContextIdentity}>
        <div className={s.profileAvatarLarge}>{contact.name.charAt(0)}</div>
        <div className={s.mobileContextIdentityCopy}>
          <span>{sidebarInquiry.heading || 'Current inquiry'}</span>
          <h1 id="mobile-contact-context-name">{contact.name}</h1>
          {['active', 'history'].includes(sidebarInquiry.kind) ? (
            <span className={s.inquiryStage}>{sidebarInquiry.facts.status}</span>
          ) : (
            <small>{sidebarInquiry.title}</small>
          )}
        </div>
      </div>

      {detailView.contactability?.status && detailView.contactability.status !== 'reachable' && !inlineContactabilityStatus && (
        <div className={`${s.channelNotice} ${detailView.contactability.canFollowUp === false ? s.channelNoticeBlocked : ''}`}>
          <AlertCircle size={15} />
          <span><strong>{detailView.contactability.label}</strong>{detailView.contactability.reason ? ` — ${detailView.contactability.reason}` : ''}</span>
        </div>
      )}

      {renderInstituteNextStep('mobile-contact-next-step', s.mobileNextStep)}

      <details className={s.mobileContextDetails}>
        <summary>Contact and inquiry details</summary>
        <div className={s.mobileContextDetailsBody}>
          <div className={s.mobileContextFacts}>
            <div><span>Email</span><strong>{cleanText(contact.email) || 'Not recorded'}</strong></div>
            <div><span>Phone</span><strong>{cleanText(contact.phone) || 'Not recorded'}</strong></div>
            {contact.address && <div><span>Intended learning location</span><strong>{contact.address}</strong></div>}
            {['active', 'history'].includes(sidebarInquiry.kind) && (
              <>
                <div><span>Program</span><strong>{sidebarInquiry.facts.program}</strong></div>
                <div><span>Student location</span><strong>{sidebarInquiry.facts.studentLocation}</strong></div>
                <div><span>Inquiry owner</span><strong>{assignedEmployee?.label || 'Unassigned'}</strong></div>
              </>
            )}
          </div>
          {access.canWriteCrm && (
            <div className={s.mobileContextActions}>
              {access.canWriteFinancials && (
                <Link className="btn btn-primary" href={`/payments?flow=take-payment&contactId=${encodeURIComponent(contact.id)}`}>
                  <DollarSign size={15} /> Take payment
                </Link>
              )}
              <button className="btn" type="button" onClick={openEditModal}>
                <Edit3 size={15} /> Edit profile
              </button>
              <button
                className="btn btn-danger"
                type="button"
                onClick={() => {
                  setArchiveReason('');
                  setArchiveConfirmOpen(true);
                }}
              >
                <Archive size={15} />
                {coordinatorUiPolicy.canArchiveContactsDirectly ? 'Archive contact' : 'Request archive approval'}
              </button>
            </div>
          )}
        </div>
      </details>
    </section>
  );

  const profileSidebar = isAitUsaContact ? instituteProfileSidebar : legacyProfileSidebar;

  return (
    <div className={s.detailPage + " fade-in"}>
      <div className="page-header">
        <button className={s.btnBack} onClick={() => (isClientMode ? router.push('/clients') : router.back())}>
          <ArrowLeft size={18} /> Back to {pluralLabel}
        </button>
      </div>

      <div className={`${s.detailLayout} ${isAitUsaContact ? s.instituteDetailLayout : ''}`}>
        {isAitUsaContact && profileSidebar}
        {isAitUsaContact && instituteMobileContext}
        {/* Main Section: Review content */}
        <div className={s.contentSection}>
          {!isAitUsaContact && (
            <section className={s.reviewContext} aria-label={`${detailView.profileTitle} review context`}>
              <div className={s.reviewContextHeader}>
                <div>
                  <span>Review context</span>
                  <strong>{contact.name}</strong>
                </div>
                <small>{detailView.profileTitle}</small>
              </div>
              <div className={s.reviewGrid}>
                {reviewSummary.map((item) => (
                  <div key={item.label} className={`${s.reviewItem} ${item.tone ? s[`review_${item.tone}`] || '' : ''}`}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    {item.detail && <small>{item.detail}</small>}
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className={s.contentTabs} role="tablist" aria-label="Contact detail sections">
            {contentTabs.map((tab, index) => (
              <button
                key={tab.id}
                ref={(node) => { contentTabRefs.current[index] = node; }}
                id={`contact-tab-${tab.id}`}
                className={`${s.contentTab} ${renderedActiveTab === tab.id ? s.active : ''}`}
                type="button"
                role="tab"
                aria-selected={renderedActiveTab === tab.id}
                aria-controls={`contact-panel-${tab.id}`}
                tabIndex={renderedActiveTab === tab.id ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => handleContentTabKeyDown(event, index)}
              >
                <span>{tab.label}</span>
                {Number.isFinite(tab.count) && <span className={s.contentTabCount}>{tab.count}</span>}
              </button>
            ))}
          </div>

          <div
            className={s.tabContent}
            id={`contact-panel-${renderedActiveTab}`}
            role="tabpanel"
            aria-labelledby={`contact-tab-${renderedActiveTab}`}
          >
            {renderedActiveTab === 'timeline' && (
              <div className={s.timelineView}>
                {!isAitUsaContact && (
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
                )}

                <div className={s.timelineToolbar}>
                  <div className={s.timelineFilters} aria-label={isAitUsaContact ? 'Activity filters' : 'Timeline filters'}>
                    {visibleTimelineFilters.map((filter) => (
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
                    {timelineMoreFilters.length > 0 && (
                      <details
                        ref={timelineMoreRef}
                        className={`${s.timelineMore} ${timelineMoreFilters.some((filter) => filter.value === renderedTimelineFilter) ? s.active : ''}`}
                      >
                        <summary
                          className={`${s.timelineFilter} ${timelineMoreFilters.some((filter) => filter.value === renderedTimelineFilter) ? s.active : ''}`}
                          aria-label={`More Activity filters. ${timelineMoreFilters.map((filter) => `${filter.label}: ${timelineCounts[filter.value] || 0} records`).join('. ')}`}
                        >
                          More
                          <span className={s.timelineFilterCount}>{timelineMoreCount}</span>
                        </summary>
                        <div className={s.timelineMoreMenu}>
                          {timelineMoreFilters.map((filter) => (
                            <button
                              key={filter.value}
                              className={`${s.timelineMoreOption} ${renderedTimelineFilter === filter.value ? s.active : ''}`}
                              type="button"
                              aria-pressed={renderedTimelineFilter === filter.value}
                              onClick={() => {
                                setTimelineFilter(filter.value);
                                timelineMoreRef.current?.removeAttribute('open');
                              }}
                            >
                              <span>{filter.label}</span>
                              <span className={s.timelineFilterCount}>{timelineCounts[filter.value] || 0}</span>
                            </button>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                  <div className={s.timelineToolbarEnd}>
                    {timelineStatus === 'loading' && <div className={s.timelineStatus}>Syncing</div>}
                    {isAitUsaContact && access.canWriteCrm && (
                      <div className={s.timelineActions} aria-label="Activity actions">
                        <button
                          ref={noteTriggerRef}
                          className={`btn btn-sm ${noteComposerOpen ? s.internalNoteActionActive : ''}`}
                          type="button"
                          aria-expanded={noteComposerOpen}
                          aria-controls="contact-internal-note-composer"
                          onClick={openInternalNoteComposer}
                        >
                          <MessageSquarePlus size={14} /> Add internal note
                        </button>
                        <button
                          className={`btn btn-sm ${s.recordOutreachAction}`}
                          type="button"
                          onClick={openFollowUpModal}
                        >
                          <ClipboardCheck size={14} /> Record outreach
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {isAitUsaContact && noteComposerOpen && (
                  <div id="contact-internal-note-composer" className={s.noteComposerRegion}>
                    <InternalNoteComposer
                      value={noteInput}
                      onChange={(event) => setNoteInput(event.target.value)}
                      canWrite={access.canWriteCrm}
                      pending={noteSaving}
                      onSubmit={addNote}
                      onCancel={cancelInternalNote}
                      helpText="Internal context only. Does not record outreach, complete tasks, or schedule follow-up. Saved notes cannot be edited."
                      submitLabel="Save note"
                      textareaRef={noteInputRef}
                      classNames={{
                        noteBox: s.noteBox,
                        noteBoxHeader: s.noteBoxHeader,
                        noteBoxLabel: s.noteBoxLabel,
                        noteBoxHelp: s.noteBoxHelp,
                        noteBoxFooter: s.noteBoxFooter,
                      }}
                    />
                  </div>
                )}

                {timelineStatus === 'loading' && (
                  <PageState
                    tone="loading"
                    size="compact"
                    title="Loading timeline"
                    copy="Fetching activity for this contact."
                  />
                )}
                {timelineStatus === 'error' && (
                  <PageState
                    tone="error"
                    size="compact"
                    title="Timeline unavailable"
                    copy="Activity could not be loaded for this contact."
                    actions={<PageStateAction onClick={() => setTimelineReloadKey((key) => key + 1)}>Try Again</PageStateAction>}
                  />
                )}
                {timelineStatus === 'idle' && <div className={s.timeline}>
                  {timeline.map((item) => {
                    const dateParts = timelineDateParts(item);
                    if (isAitUsaContact) {
                      return (
                        <AitUsaActivityRecord
                          key={item.id}
                          item={item}
                          dateParts={dateParts}
                          fullDateLabel={dateLabel(item)}
                        />
                      );
                    }
                    const provenance = item.presentation?.provenance;
                    const record = item.record;
                    const noteAuthor = timelineNoteAuthor(item);
                    const visibleDetails = [
                      noteAuthor ? `By ${noteAuthor}` : (item.actor?.name ? `By ${item.actor.name}` : ''),
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
                </div>}

                {!isAitUsaContact && (
                  <InternalNoteComposer
                    value={noteInput}
                    onChange={(event) => setNoteInput(event.target.value)}
                    canWrite={access.canWriteCrm}
                    pending={noteSaving}
                    onSubmit={addNote}
                    onOpenFollowUp={openFollowUpModal}
                    classNames={{
                      noteBox: s.noteBox,
                      noteBoxHeader: s.noteBoxHeader,
                      noteBoxLabel: s.noteBoxLabel,
                      noteBoxHelp: s.noteBoxHelp,
                      noteBoxFooter: s.noteBoxFooter,
                    }}
                  />
                )}
              </div>
            )}

            {renderedActiveTab === 'courses' && showCoursesTab && (
              <div className={s.coursesPanel} aria-label="Enrollments">
                <div className={s.courseWorkspaceHeader}>
                  <div className={s.courseHeroMain}>
                    <div className={s.courseHeroIcon}><GraduationCap size={22} /></div>
                    <div>
                      <h2>Enrollments</h2>
                      <p>Current classes first, with completed and ended enrollment history below.</p>
                    </div>
                  </div>
                  {access.canWriteCrm && (
                    <div className={s.courseWorkspaceActions}>
                      <button className="btn btn-sm" type="button" onClick={() => openCourseModal('history')}>
                        <Plus size={14} /> Add past enrollment
                      </button>
                      {canStartEnrollment && (
                        <button className="btn btn-primary btn-sm" type="button" onClick={() => openCourseModal('start')}>
                          <Plus size={14} /> {activeCourseRecords.length ? 'Add another enrollment' : 'Start enrollment'}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {courseRecordsState.error && <div className={s.courseError}>{courseRecordsState.error}</div>}
                {!courseRecordsState.error && !courseRecordsState.loading && currentCourseRecords.length === 0 && (
                  <div className={s.courseEmpty}>
                    <div className="empty-state-title">No enrollments yet</div>
                    <p className="empty-state-copy">
                      {hasCurrentInquiry
                        ? 'Start the current enrollment or add a past enrollment to build this student history.'
                        : 'Add past enrollment history here. Start or reopen an inquiry before creating a current enrollment.'}
                    </p>
                  </div>
                )}

                {currentCourseRecords.length > 0 && (
                  <div className={s.courseHistoryGrid}>
                    <div className={s.courseRecordGroups}>
                      <section className={s.courseRecordGroup} aria-labelledby="active-enrollments-heading">
                        <div className={s.courseSectionHeader}>
                          <strong id="active-enrollments-heading">Active enrollments</strong>
                          <span>{activeCourseRecords.length}</span>
                        </div>
                        {activeCourseRecords.length ? (
                          <div className={s.courseRecordList}>
                            {activeCourseRecords.map((record) => (
                              <button
                                key={record.id}
                                type="button"
                                className={`${s.courseRecordRow} ${selectedCourseRecord?.id === record.id ? s.active : ''}`}
                                onClick={() => setSelectedCourseRecordId(record.id)}
                              >
                                <span className={`${s.courseStatusDot} ${s[`courseStatus_${record.status}`] || ''}`} />
                                <span className={s.courseRecordMain}>
                                  <strong>{record.courseName}</strong>
                                  <small>{[
                                    record.courseLocation || 'Delivery location not set',
                                    record.teacher ? `Teacher: ${record.teacher}` : 'Teacher not assigned',
                                    classSectionScheduleLabel(record.classSection),
                                    record.startDate ? `Started ${record.startDate}` : '',
                                  ].filter(Boolean).join(' · ')}</small>
                                </span>
                                <span className={s.courseRecordStatus}>{courseRecordStatusLabel(record.status)}</span>
                              </button>
                            ))}
                          </div>
                        ) : <p className={s.courseSectionEmpty}>No active enrollments.</p>}
                      </section>

                      <section className={s.courseRecordGroup} aria-labelledby="enrollment-history-heading">
                        <div className={s.courseSectionHeader}>
                          <strong id="enrollment-history-heading">Enrollment history</strong>
                          <span>{historicalCourseRecords.length}</span>
                        </div>
                        {historicalCourseRecords.length ? (
                          <div className={s.courseRecordList}>
                            {historicalCourseRecords.map((record) => (
                              <button
                                key={record.id}
                                type="button"
                                className={`${s.courseRecordRow} ${selectedCourseRecord?.id === record.id ? s.active : ''}`}
                                onClick={() => setSelectedCourseRecordId(record.id)}
                              >
                                <span className={`${s.courseStatusDot} ${s[`courseStatus_${record.status}`] || ''}`} />
                                <span className={s.courseRecordMain}>
                                  <strong>{record.courseName}</strong>
                                  <small>{[
                                    record.courseLocation || 'Delivery location not set',
                                    record.teacher ? `Teacher: ${record.teacher}` : 'Teacher not assigned',
                                    record.startDate ? `Started ${record.startDate}` : '',
                                    record.endDate ? `Ended ${record.endDate}` : '',
                                  ].filter(Boolean).join(' · ')}</small>
                                </span>
                                <span className={s.courseRecordStatus}>{courseRecordStatusLabel(record.status)}</span>
                              </button>
                            ))}
                          </div>
                        ) : <p className={s.courseSectionEmpty}>No past enrollments recorded.</p>}
                      </section>
                    </div>

                    <aside className={s.courseInspector}>
                      {selectedCourseRecord ? (
                        <>
                          <div className={s.courseInspectorHeader}>
                            <span className={`${s.coursePill} ${s[`coursePill_${selectedCourseRecord.status}`] || ''}`}>
                              {courseRecordStatusLabel(selectedCourseRecord.status)}
                            </span>
                            <strong>{selectedCourseRecord.courseName}</strong>
                          </div>
                          <div className={s.courseInspectorDetails}>
                            <div>
                              <span>Started</span>
                              <strong>{selectedCourseRecord.startDate || 'Not set'}</strong>
                            </div>
                            <div>
                              <span>Delivery location</span>
                              <strong>{selectedCourseRecord.courseLocation || 'Delivery location not set'}</strong>
                            </div>
                            <div>
                              <span>Teacher</span>
                              <strong>{selectedCourseRecord.teacher || 'Not assigned'}</strong>
                            </div>
                            <div>
                              <span>Ended</span>
                              <strong>{selectedCourseRecord.endDate || (selectedCourseRecord.status === 'active' ? 'Current' : 'Not set')}</strong>
                            </div>
                            <div className={s.courseInspectorWide}>
                              <span>Class section</span>
                              <strong>{selectedCourseRecord.classSection
                                ? classSectionDisplayLabel(selectedCourseRecord.classSection)
                                : 'Legacy or manually entered course record'}</strong>
                            </div>
                            <div className={s.courseInspectorWide}>
                              <span>Outcome / reason</span>
                              <strong>{selectedCourseRecord.outcomeReason || 'None recorded'}</strong>
                            </div>
                            <div className={s.courseInspectorWide}>
                              <span>Notes</span>
                              <strong>{selectedCourseRecord.notes || 'No notes'}</strong>
                            </div>
                          </div>
                          {access.canWriteCrm && (
                            <div className={s.courseInspectorActions}>
                              <button className="btn btn-sm" type="button" onClick={() => openCourseModal('edit', selectedCourseRecord)}>
                                <Edit3 size={14} /> Edit
                              </button>
                              {selectedCourseRecord.status === 'active' && (
                                <>
                                  <button className="btn btn-sm" type="button" onClick={() => openCourseModal('complete', selectedCourseRecord)}>
                                    <CheckCircle2 size={14} /> Complete
                                  </button>
                                  <button className="btn btn-sm" type="button" onClick={() => openCourseModal('end', selectedCourseRecord)}>
                                    <AlertCircle size={14} /> End
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className={s.courseEmpty}>Select a course record.</div>
                      )}
                    </aside>
                  </div>
                )}
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
                          <button type="button" onClick={() => setPersonDeleteTarget(person)}>Remove</button>
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

                {access.canSendOutboundMessages && dataSource === 'postgres' && (
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
                <div className={s.commandCard}>
                  <div className={s.commandCopy}>
                    <div className={s.commandTitle}>Work orders</div>
                    <p>
                      {isAitUsaContact
                        ? 'Review work connected to this student record.'
                        : 'Create and manage work orders on the Work Orders page, then generate invoices from saved work orders here.'}
                    </p>
                  </div>
                  {access.canWriteWorkOrders && (
                    <div className={s.commandActions}>
                      <Link className="btn btn-primary" href={workOrdersHref}>
                        <ClipboardList size={16} /> Create Work Order
                      </Link>
                    </div>
                  )}
                </div>
                {contactWorkOrders.map((wo) => {
                  const workOrderInvoice = invoiceByWorkOrderId.get(wo.id);
                  return (
                  <div key={wo.id} className={s.recordCard}>
                    <div className={s.recordMain}>
                      <div className={s.recordIcon}><ClipboardList size={20} /></div>
                      <div>
                        <div className={s.recordTitle}>{wo.title}</div>
                        <div className={s.recordSubtitle}>{wo.number} • Due {wo.dueDate}</div>
                      </div>
                    </div>
                    <div className={s.recordActions}>
                      <span className={`badge badge-${wo.status.toLowerCase().replace(' ', '')}`}>{wo.status}</span>
                      {!isAitUsaContact && access.canWriteFinancials && (
                        workOrderInvoice ? (
                          <button className="btn btn-sm" type="button" onClick={() => recordPaymentAgainstInvoice(workOrderInvoice)}>
                            <DollarSign size={14} /> Record Payment
                          </button>
                        ) : (
                          <button className="btn btn-sm" type="button" onClick={() => downloadInvoiceFromWorkOrder(wo)}>
                            <FileText size={14} /> Generate Invoice
                          </button>
                        )
                      )}
                      <Link className="btn btn-sm" href={`/work-orders/${wo.id}`}>Open</Link>
                    </div>
                  </div>
                  );
                })}
                {contactWorkOrders.length === 0 && (
                  <div className={`empty-state ${s.financialEmptyState}`}>
                    <div className="empty-state-title">No work orders linked</div>
                    <p className="empty-state-copy">
                      Create the work order first. For AIT Signs, invoice generation starts from this tab after the work order exists.
                    </p>
                    {access.canWriteWorkOrders && (
                      <div className="empty-state-actions">
                        <Link className="btn btn-primary" href={workOrdersHref}>
                          <ClipboardList size={16} /> Create Work Order
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {renderedActiveTab === 'financials' && (
              <div className={s.recordsList}>
                {isAitUsaContact ? (
                  <div className={s.receiptArchiveHeader}>
                    <div className={s.commandCopy}>
                      <div className={s.commandTitle}>Receipt history</div>
                      <p>Verified receipts for this contact. New transactions are managed in Payments.</p>
                    </div>
                    {access.canReadFinancials && (
                      <Link className="btn" href={`/payments?flow=take-payment&contactId=${encodeURIComponent(contact.id)}`}>
                        <DollarSign size={16} /> Take payment
                      </Link>
                    )}
                  </div>
                ) : access.canWriteFinancials && (
                  <div className={s.commandCard}>
                    <div className={s.commandCopy}>
                      <div className={s.commandTitle}>Financial workflow</div>
                      <p>Estimates can start here. Invoices come from work orders, and payments are recorded against invoices.</p>
                    </div>
                    <div className={s.commandControls}>
                      <label className={s.commandField}>
                        <span>Work order for invoice</span>
                        <select className="input select" value={selectedInvoiceWorkOrder ? invoiceWorkOrderId : ''} onChange={(event) => setInvoiceWorkOrderId(event.target.value)}>
                          <option value="">Select work order</option>
                          {contactWorkOrders.map((workOrder) => (
                            <option key={workOrder.id} value={workOrder.id}>
                              {workOrder.number || 'Work order'} - {workOrder.title || 'Untitled'}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className={s.commandActions}>
                      <button className="btn btn-primary" type="button" onClick={openEstimateModal}>
                        <FileText size={16} /> New Estimate
                      </button>
                      <button className="btn" type="button" onClick={downloadSelectedWorkOrderInvoice}>
                        <FileText size={16} /> Generate Invoice
                      </button>
                      <button className="btn" type="button" onClick={() => recordPaymentAgainstInvoice()}>
                        <DollarSign size={16} /> Record Invoice Payment
                      </button>
                    </div>
                    <div className={`${s.workflowNotice} ${
                      financialNotice.tone === 'ready'
                        ? s.workflowNoticeReady
                        : financialNotice.tone === 'warning'
                          ? s.workflowNoticeWarning
                          : s.workflowNoticeBlocked
                    }`}>
                      {financialNotice.tone === 'ready' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                      {financialNotice.text}
                    </div>
                  </div>
                )}
                {visibleFinancials.map((f) => {
                  const receiptContext = [
                    f.date ? `Paid ${f.date}` : '',
                    f.paymentMethod || '',
                    f.checkNumber ? `Ref ${f.checkNumber}` : '',
                  ].filter(Boolean).join(' · ');
                  return (
                    <div key={f.id} className={s.recordCard}>
                      <div className={s.recordMain}>
                        <div className={s.recordIcon}><FileText size={20} /></div>
                        <div>
                          <div className={s.recordTitle}>
                            {isAitUsaContact ? 'Receipt' : f.type} {f.number}
                          </div>
                          <div className={s.recordSubtitle}>
                            {isAitUsaContact ? (receiptContext || 'Payment receipt') : f.date}
                          </div>
                          {isAitUsaContact && f.note && <div className={s.receiptRecordNote}>{f.note}</div>}
                        </div>
                      </div>
                      <div className={s.recordValue}>
                        <div className={s.valueAmount}>${f.amount.toLocaleString()}</div>
                        <span className={`badge badge-${f.status.toLowerCase()}`}>{f.status}</span>
                        <button className="btn btn-sm" type="button" onClick={() => downloadFinancialPdf(f)}>
                          Download PDF
                        </button>
                      </div>
                    </div>
                  );
                })}
                {!isAitUsaContact && visibleFinancials.length === 0 && (
                  <div className={`empty-state ${s.financialEmptyState}`}>
                    <div className="empty-state-title">No financial records for this contact yet</div>
                    <p className="empty-state-copy">
                      {access.canWriteFinancials
                        ? 'You can create the first estimate from this contact record. Invoices are generated from linked work orders, and payments are recorded against invoices.'
                        : 'No estimates, invoices, receipts, or payments are visible for this contact in the current scope.'}
                    </p>
                    <div className="empty-state-actions">
                      {access.canWriteFinancials ? (
                        <>
                          <button className="btn btn-primary" type="button" onClick={openEstimateModal}>
                            <FileText size={16} /> New Estimate
                          </button>
                          {hasWorkOrders && (
                            <button className="btn" type="button" onClick={downloadSelectedWorkOrderInvoice}>
                              <FileText size={16} /> Generate Invoice
                            </button>
                          )}
                        </>
                      ) : (
                        <Link className="btn btn-primary" href="/contacts">Back to Contacts</Link>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {!isAitUsaContact && profileSidebar}
      </div>

      {courseModal && (
        <Modal
          open={Boolean(courseModal)}
          onClose={closeCourseModal}
          title={courseForm.id ? 'Edit Enrollment' : (courseModal === 'history' ? 'Add Past Enrollment' : 'Start Enrollment')}
          variant="dialog"
          panelClassName="course-editor-dialog-panel"
          footer={(
            <>
              <button className="btn" type="button" onClick={closeCourseModal} disabled={courseBusy}>Cancel</button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={saveCourseRecord}
                disabled={courseBusy || !canSaveCourseForm}
              >
                <CheckCircle2 size={16} /> {courseBusy ? 'Saving...' : 'Save enrollment'}
              </button>
            </>
          )}
        >
          <div className="course-editor-form">
            <div className="contact-dialog-intro">
              <p>{courseModal === 'history'
                ? 'Add an enrollment that already ended without changing the current inquiry.'
                : (courseForm.id
                    ? 'Keep this enrollment accurate as the student moves through the class.'
                    : 'Starting this enrollment also updates the current inquiry status to Enrolled.')}</p>
              <span>{courseModeLabel}</span>
            </div>

            <section className="course-editor-section course-editor-course">
              <div className="contact-dialog-section-header">
                <div>
                  <h2>Course</h2>
                  <p>Choose the course, record its teacher, and keep the delivery location tied to this class record.</p>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Class Section</label>
                <select
                  className="input select"
                  value={courseForm.classSectionId || ''}
                  disabled={courseBusy}
                  data-autofocus
                  onChange={(event) => selectClassSection(event.target.value)}
                >
                  <option value="">No saved section — enter course details manually</option>
                  {currentClassSections
                    .filter((section) => section.status === 'active' || section.id === courseForm.classSectionId)
                    .map((section) => (
                      <option key={section.id} value={section.id}>{classSectionDisplayLabel(section)}</option>
                    ))}
                </select>
                {selectedClassSection && (
                  <small>Section details are shared by every student in this class and stay consistent across enrollments.</small>
                )}
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Course</label>
                  <select
                    className="input select"
                    value={courseForm.courseName || ''}
                    disabled={courseBusy || Boolean(selectedClassSection)}
                    onChange={(event) => updateCourseForm({ courseName: event.target.value })}
                  >
                    <option value="">Select a course</option>
                    {courseOptions.map((course) => (
                      <option key={course} value={course}>{course}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Teacher</label>
                  <input
                    className="input"
                    value={courseForm.teacher || ''}
                    disabled={courseBusy || Boolean(selectedClassSection)}
                    placeholder="Teacher name"
                    onChange={(event) => updateCourseForm({ teacher: event.target.value })}
                  />
                </div>
              </div>
              <div className="form-group">
                  <label className="form-label">Delivery Location</label>
                  <select
                    className="input select"
                    value={courseForm.courseLocation || ''}
                    disabled={courseBusy || Boolean(selectedClassSection)}
                    onChange={(event) => updateCourseForm({ courseLocation: event.target.value })}
                  >
                    <option value="">Delivery location not set</option>
                    {courseLocationOptions.map((location) => (
                      <option key={location} value={location}>{location}</option>
                    ))}
                  </select>
              </div>
            </section>

            <section className="course-editor-section course-editor-status">
              <div className="contact-dialog-section-header">
                <div>
                  <h2>Status</h2>
                  <p>Pick the student course state. The form below adapts to what that state needs.</p>
                </div>
              </div>
              <div className="course-status-grid" role="radiogroup" aria-label="Enrollment status">
                {courseStatusOptions.map((option) => {
                  const selected = courseForm.status === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`course-status-card ${selected ? 'is-active' : ''}`}
                      aria-pressed={selected}
                      disabled={courseBusy}
                      onClick={() => updateCourseForm({
                        status: option.value,
                        endDate: isTerminalCourseRecordStatus(option.value) && !courseForm.endDate
                          ? todayDate()
                          : courseForm.endDate,
                      })}
                    >
                      <strong>{option.label}</strong>
                      <span>{COURSE_STATUS_HELP[option.value] || 'Use when this status best matches the course record.'}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="course-editor-section course-editor-details">
              <div className="contact-dialog-section-header">
                <div>
                  <h2>{courseStatusLabel} details</h2>
                  <p>{courseStatusIsTerminal ? 'Capture when it ended and why.' : 'Capture the planned or current start point.'}</p>
                </div>
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">{courseStartDateRequired ? 'Start Date Required' : 'Start Date'}</label>
                  <input
                    className="input"
                    type="date"
                    required={courseStartDateRequired}
                    value={courseForm.startDate || ''}
                    disabled={courseBusy}
                    onChange={(event) => updateCourseForm({ startDate: event.target.value })}
                  />
                </div>
                {courseStatusIsTerminal ? (
                  <div className="form-group">
                    <label className="form-label">End Date</label>
                    <input
                      className="input"
                      type="date"
                      value={courseForm.endDate || ''}
                      disabled={courseBusy}
                      onChange={(event) => updateCourseForm({ endDate: event.target.value })}
                    />
                  </div>
                ) : (
                  <div className="course-editor-state-note">
                    <strong>{courseForm.status === 'planned' ? 'End date hidden' : 'Active enrollment'}</strong>
                    <span>{courseForm.status === 'planned' ? 'Set an end date after the student completes, drops, cancels, or transfers.' : 'Other class sections can remain active at the same time.'}</span>
                  </div>
                )}
              </div>
              {courseStatusIsTerminal && (
                <div className="form-group">
                  <label className="form-label">Outcome / Reason</label>
                  <input
                    className="input"
                    value={courseForm.outcomeReason || ''}
                    disabled={courseBusy}
                    placeholder="Completed, cancelled halfway, transferred..."
                    onChange={(event) => updateCourseForm({ outcomeReason: event.target.value })}
                  />
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea
                  className="textarea course-editor-notes"
                  rows={3}
                  value={courseForm.notes || ''}
                  disabled={courseBusy}
                  placeholder={courseStatusIsTerminal ? 'Add final outcome context for the timeline.' : 'Add schedule or coordination notes.'}
                  onChange={(event) => updateCourseForm({ notes: event.target.value })}
                />
              </div>
            </section>

            <aside className="course-editor-summary" aria-label="Course save summary">
              <span>Ready to save</span>
              <strong>{courseForm.courseName || 'Course name required'}</strong>
              <p>
                {courseStatusLabel}
                {courseForm.courseLocation ? ` at ${courseForm.courseLocation}` : ''}
                {courseForm.teacher ? ` - Teacher: ${courseForm.teacher}` : ' - Teacher not assigned'}
              </p>
              {courseStartDateRequired && !courseForm.startDate && (
                <small>Current courses need a start date.</small>
              )}
            </aside>

            {courseError && <div className={s.courseError}>{courseError}</div>}
          </div>
        </Modal>
      )}

      <FollowUpOutcomeDialog
        open={followUpOpen}
        onClose={closeFollowUpModal}
        onSubmit={submitFollowUpLog}
        draft={followUpDraft}
        onChange={updateFollowUpDraft}
        onProfileChange={updateFollowUpLeadProfile}
        busy={followUpBusy}
        submitDisabled={followUpResolving || Boolean(followUpError)}
        error={followUpError}
        taskMatchText={followUpResolving
          ? followUpRequestedTaskId
            ? 'Resolving the exact selected follow-up task...'
            : 'Resolving the selected Contact and Lead context...'
          : followUpTask
            ? `Completes this task: ${followUpTask.title || 'Follow-up'} (${taskDateLabel(followUpTask.dueAt)}).`
            : followUpRequestedTaskId
              ? 'The selected follow-up task could not be loaded. Close this dialog and reopen it from the task queue.'
              : 'Records outreach for this Contact. No task is selected for completion.'}
        ownerOptions={ownerOptions}
        canManageAssignments={coordinatorUiPolicy.canManageCoordinatorAssignments}
        showProfile={isAitUsaContact}
        isAitUsa={isAitUsaContact}
        isTaskCompletion={Boolean(followUpRequestedTaskId || followUpTask)}
        title={followUpRequestedTaskId || followUpTask ? 'Complete follow-up' : 'Record outreach'}
      />
      {/* Edit Profile Dialog */}
      {isEditModalOpen && editForm && (
        <Modal
          open={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          title="Edit Profile"
          variant="dialog"
          panelClassName="contact-profile-dialog-panel"
          footer={<><button className="btn" type="button" onClick={() => setIsEditModalOpen(false)}>Cancel</button><button className="btn btn-primary" type="button" onClick={handleEditSave}>Save Changes</button></>}
        >
          <div className="contact-profile-dialog-form">
            {!isAitUsaContact && <div className="contact-dialog-intro">
              <p>Update {contact?.name || singularLabel.toLowerCase()} without leaving the contact record.</p>
              <span>Profile and routing details</span>
            </div>}

            <div className="profile-editor-tabs" role="tablist" aria-label="Profile edit sections">
              {profileEditTabs.map((tab, tabIndex) => {
                const selected = activeProfileEditTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    ref={(node) => { profileEditTabRefs.current[tabIndex] = node; }}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`profile-edit-panel-${tab.id}`}
                    id={`profile-edit-tab-${tab.id}`}
                    tabIndex={selected ? 0 : -1}
                    className={`profile-editor-tab ${selected ? 'is-active' : ''}`}
                    onClick={() => setActiveProfileEditTab(tab.id)}
                    onKeyDown={(event) => handleProfileEditTabKeyDown(event, tabIndex)}
                  >
                    <span>{tab.label}</span>
                    <small>{tab.summary}</small>
                  </button>
                );
              })}
            </div>

            {activeProfileEditTab === 'contact' && isAitUsaContact && (
              <section
                className="contact-profile-dialog-section"
                role="tabpanel"
                id="profile-edit-panel-contact"
                aria-labelledby="profile-edit-tab-contact"
              >
                <div className="contact-dialog-section-header">
                  <div>
                    <h2>Contact details</h2>
                    <p>Permanent identity and contact channels shared across every inquiry.</p>
                  </div>
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-name">Full name</label>
                    <input id="profile-edit-name" className="input" value={editForm.name} autoFocus onChange={e => setEditForm({...editForm, name: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-email">Email</label>
                    <input id="profile-edit-email" className="input" value={editForm.email} onChange={e => setEditForm({...editForm, email: e.target.value})} />
                  </div>
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-phone">Phone</label>
                    <input id="profile-edit-phone" className="input" value={editForm.phone} onChange={e => setEditForm({...editForm, phone: e.target.value})} />
                  </div>
                </div>
              </section>
            )}

            {activeProfileEditTab === 'inquiry' && isAitUsaContact && (
              <section
                className="contact-profile-dialog-section"
                role="tabpanel"
                id="profile-edit-panel-inquiry"
                aria-labelledby="profile-edit-tab-inquiry"
              >
                <div className="contact-dialog-section-header">
                  <div>
                    <h2>{inquiryProfileHeading}</h2>
                    <p>Lifecycle, ownership, locations, and acquisition context for this inquiry.</p>
                  </div>
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-status">Inquiry status</label>
                    <OpportunityLifecycleField
                      isAitUsa={isAitUsaContact}
                      hasLeadStatus={contact.hasLeadStatus}
                      opportunityConflict={contact.opportunityConflict}
                      status={editForm.status}
                      statuses={profileStatusOptions}
                      onStatusChange={e => setEditForm({...editForm, status: e.target.value, terminalStatusReason: ''})}
                      onStart={() => setStartOpportunityOpen(true)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-owner">Inquiry owner</label>
                    {canManageContactAssignments ? (
                      <select
                        id="profile-edit-owner"
                        className="input select"
                        value={editForm.assignedTo || ''}
                        disabled={inquiryProfileDisabled}
                        onChange={e => setEditForm({...editForm, assignedTo: e.target.value})}
                      >
                        <option value="">Unassigned</option>
                        {aitUsaOwnerOptions.map((owner) => (
                          <option key={owner.id} value={owner.id}>{aitUsaAssigneeOptionLabel(owner, currentUser?.id)}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id="profile-edit-owner"
                        className="input"
                        value={assignedEmployee?.label || 'Unassigned'}
                        disabled
                        readOnly
                      />
                    )}
                  </div>
                </div>

                {isAitUsaContact && !contact.hasLeadStatus && startOpportunityOpen && (
                  <div className="profile-editor-account-action" aria-label="Start Opportunity">
                    <div className="grid-2">
                      <div className="form-group">
                        <label className="form-label" htmlFor="start-opportunity-status">Initial inquiry status</label>
                        <select
                          id="start-opportunity-status"
                          className="input select"
                          value={startOpportunityForm.status}
                          onChange={(event) => setStartOpportunityForm((current) => ({ ...current, status: event.target.value }))}
                        >
                          {profileStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
                        </select>
                      </div>
                      {canManageContactAssignments && (
                        <div className="form-group">
                          <label className="form-label" htmlFor="start-opportunity-owner">Inquiry owner</label>
                          <select
                            id="start-opportunity-owner"
                            className="input select"
                            value={startOpportunityForm.assignedTo}
                            onChange={(event) => setStartOpportunityForm((current) => ({ ...current, assignedTo: event.target.value }))}
                          >
                            <option value="">Unassigned</option>
                            {aitUsaOwnerOptions.map((owner) => (
                              <option key={owner.id} value={owner.id}>{aitUsaAssigneeOptionLabel(owner, currentUser?.id)}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="start-opportunity-reason">Reason</label>
                      <textarea
                        id="start-opportunity-reason"
                        className="textarea"
                        rows={2}
                        value={startOpportunityForm.reason}
                        placeholder="Required when the initial status is closed"
                        onChange={(event) => setStartOpportunityForm((current) => ({ ...current, reason: event.target.value }))}
                      />
                    </div>
                    {startOpportunityError && <div className={s.courseError}>{startOpportunityError}</div>}
                    <div>
                      <button className="btn btn-primary" type="button" onClick={startOpportunity} disabled={startOpportunityBusy}>
                        {startOpportunityBusy ? 'Starting…' : 'Start inquiry'}
                      </button>
                    </div>
                  </div>
                )}

                {isClosedStatusReopen && (
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-reopen-reason">Reopen reason</label>
                    <select
                      id="profile-edit-reopen-reason"
                      className="input select"
                      value={editForm.statusChangeReason || ''}
                      onChange={e => setEditForm({...editForm, statusChangeReason: e.target.value})}
                    >
                      <option value="">Choose why this closed status is changing</option>
                      <option value="correction">Correction - closed status was entered by mistake</option>
                      <option value="new_course_follow_up">New course follow-up - previous student is active again</option>
                    </select>
                    <div className="profile-editor-helper">
                      Use correction only for data-entry mistakes. For a new class or program, choose new course follow-up so history shows this is re-engagement, not an erased completion.
                    </div>
                  </div>
                )}
                {isEnteringClosedStatus && (
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-terminal-reason">Outcome reason</label>
                    <textarea
                      id="profile-edit-terminal-reason"
                      className="textarea"
                      rows={2}
                      value={editForm.terminalStatusReason || ''}
                      placeholder="Explain why this inquiry is moving to a closed status"
                      onChange={e => setEditForm({...editForm, terminalStatusReason: e.target.value})}
                    />
                  </div>
                )}

                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-student-location">Student location</label>
                    <input
                      id="profile-edit-student-location"
                      className="input"
                      value={editForm.leadProfile?.locationPreference || ''}
                      placeholder="City, municipality, or address"
                      disabled={inquiryProfileDisabled}
                      onChange={e => updateEditLeadProfile('locationPreference', e.target.value)}
                    />
                    <div className="profile-editor-helper">Where the student currently lives.</div>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-school-location">Intended learning location</label>
                    <select
                      id="profile-edit-school-location"
                      className="input select"
                      value={editForm.address || ''}
                      disabled={inquiryProfileDisabled}
                      onChange={e => setEditForm({...editForm, address: e.target.value})}
                    >
                      <option value="">Not recorded</option>
                      {editSchoolLocationOptions.map((location) => <option key={location} value={location}>{location}</option>)}
                    </select>
                    <div className="profile-editor-helper">The campus or Online option the student intends to use.</div>
                  </div>
                </div>

                {hasCurrentInquiry && (
                  <div className="profile-editor-workflow-note">
                    <div>
                      <strong>Enrollment status is managed in the Enrollments workspace.</strong>
                      <span>Starting enrollment creates the enrollment and updates this inquiry together.</span>
                    </div>
                    <button className="btn" type="button" onClick={openEnrollmentWorkspaceFromProfile}>
                      {activeCourseRecord ? 'Open Enrollments' : 'Start enrollment'}
                    </button>
                  </div>
                )}

                <details className="profile-editor-disclosure">
                  <summary>
                    <span>Source details</span>
                    <small>{[editForm.source, editForm.leadProfile?.sourceDetail].filter((value) => cleanText(value)).length} recorded</small>
                  </summary>
                  <div className="profile-editor-disclosure-body grid-2">
                    <div className="form-group">
                      <label className="form-label" htmlFor="profile-edit-source">Source</label>
                      <select
                        id="profile-edit-source"
                        className="input select"
                        value={editForm.source || ''}
                        disabled={inquiryProfileDisabled}
                        onChange={e => setEditForm({...editForm, source: e.target.value})}
                      >
                        <option value="">Not recorded</option>
                        {editSourceOptions.filter(Boolean).map(src => <option key={src} value={src}>{src}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="profile-edit-source-detail">Source detail</label>
                      <input
                        id="profile-edit-source-detail"
                        className="input"
                        value={editForm.leadProfile?.sourceDetail || ''}
                        disabled={inquiryProfileDisabled}
                        onChange={e => updateEditLeadProfile('sourceDetail', e.target.value)}
                      />
                    </div>
                  </div>
                </details>
              </section>
            )}

            {activeProfileEditTab === 'preferences' && isAitUsaContact && (
              <section
                className="contact-profile-dialog-section"
                role="tabpanel"
                id="profile-edit-panel-preferences"
                aria-labelledby="profile-edit-tab-preferences"
              >
                <div className="contact-dialog-section-header">
                  <div>
                    <h2>Inquiry preferences</h2>
                    <p>Program and scheduling context used for this inquiry’s follow-up.</p>
                  </div>
                </div>
                {inquiryProfileDisabled && (
                  <div className="profile-editor-helper" role="alert">
                    {contact.opportunityConflict
                      ? 'Inquiry preferences are read-only until the active-inquiry conflict is resolved.'
                      : 'This Contact has no inquiry record available for preference edits.'}
                  </div>
                )}
                <div className="grid-2">
                  <div className="form-group profile-editor-span-2">
                    <label className="form-label" htmlFor="profile-edit-program-interest">Program interest</label>
                    <input id="profile-edit-program-interest" className="input" value={editForm.leadProfile?.programInterest || ''} disabled={inquiryProfileDisabled} onChange={e => updateEditLeadProfile('programInterest', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-preferred-day">Preferred day</label>
                    <input id="profile-edit-preferred-day" className="input" value={editForm.leadProfile?.preferredDay || ''} disabled={inquiryProfileDisabled} onChange={e => updateEditLeadProfile('preferredDay', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-preferred-schedule">Preferred schedule</label>
                    <input id="profile-edit-preferred-schedule" className="input" value={editForm.leadProfile?.preferredSchedule || ''} disabled={inquiryProfileDisabled} onChange={e => updateEditLeadProfile('preferredSchedule', e.target.value)} />
                  </div>
                </div>
                <details className="profile-editor-disclosure">
                  <summary>
                    <span>Additional preferences</span>
                    <small>{[
                      editForm.leadProfile?.testInterest,
                      editForm.leadProfile?.educationLevel,
                      editForm.leadProfile?.schoolName,
                      editForm.leadProfile?.profileDetails,
                    ].filter((value) => cleanText(value)).length} recorded</small>
                  </summary>
                  <div className="profile-editor-disclosure-body">
                    <div className="grid-2">
                      <div className="form-group">
                        <label className="form-label" htmlFor="profile-edit-test-interest">Test interest</label>
                        <input id="profile-edit-test-interest" className="input" value={editForm.leadProfile?.testInterest || ''} disabled={inquiryProfileDisabled} onChange={e => updateEditLeadProfile('testInterest', e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor="profile-edit-education-level">Education level</label>
                        <input id="profile-edit-education-level" className="input" value={editForm.leadProfile?.educationLevel || ''} disabled={inquiryProfileDisabled} onChange={e => updateEditLeadProfile('educationLevel', e.target.value)} />
                      </div>
                    </div>
                    <div className="grid-2">
                      <div className="form-group">
                        <label className="form-label" htmlFor="profile-edit-school-name">School</label>
                        <input id="profile-edit-school-name" className="input" value={editForm.leadProfile?.schoolName || ''} disabled={inquiryProfileDisabled} onChange={e => updateEditLeadProfile('schoolName', e.target.value)} />
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="profile-edit-profile-details">Inquiry details</label>
                      <textarea id="profile-edit-profile-details" className="textarea" rows={3} value={editForm.leadProfile?.profileDetails || ''} disabled={inquiryProfileDisabled} onChange={e => updateEditLeadProfile('profileDetails', e.target.value)} />
                      <div className="profile-editor-helper">Persistent inquiry context—not an internal Activity note.</div>
                    </div>
                  </div>
                </details>
              </section>
            )}

            {activeProfileEditTab === 'general' && !isAitUsaContact && (
              <section
                className="contact-profile-dialog-section"
                role="tabpanel"
                id="profile-edit-panel-general"
                aria-labelledby="profile-edit-tab-general"
              >
                <div className="contact-dialog-section-header">
                  <div>
                    <h2>General profile</h2>
                    <p>Update the fields employees reach for most: contact info, status, and ownership.</p>
                  </div>
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-name">Full Name</label>
                    <input id="profile-edit-name" className="input" value={editForm.name} autoFocus onChange={e => setEditForm({...editForm, name: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-email">Email</label>
                    <input id="profile-edit-email" className="input" value={editForm.email} onChange={e => setEditForm({...editForm, email: e.target.value})} />
                  </div>
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-phone">Phone</label>
                    <input id="profile-edit-phone" className="input" value={editForm.phone} onChange={e => setEditForm({...editForm, phone: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-status">Status</label>
                    <OpportunityLifecycleField
                      isAitUsa={isAitUsaContact}
                      hasLeadStatus={contact.hasLeadStatus}
                      opportunityConflict={contact.opportunityConflict}
                      status={editForm.status}
                      statuses={contactStatusOptions || PIPELINE_STATUSES}
                      onStatusChange={e => setEditForm({...editForm, status: e.target.value, terminalStatusReason: ''})}
                      onStart={() => setStartOpportunityOpen(true)}
                    />
                  </div>
                </div>
                {isAitUsaContact && !contact.hasLeadStatus && startOpportunityOpen && (
                  <div className="profile-editor-account-action" aria-label="Start Opportunity">
                    <div className="grid-2">
                      <div className="form-group">
                        <label className="form-label" htmlFor="start-opportunity-status">Initial Opportunity status</label>
                        <select
                          id="start-opportunity-status"
                          className="input select"
                          value={startOpportunityForm.status}
                          onChange={(event) => setStartOpportunityForm((current) => ({ ...current, status: event.target.value }))}
                        >
                          {contactStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
                        </select>
                      </div>
                      {canManageContactAssignments && (
                        <div className="form-group">
                          <label className="form-label" htmlFor="start-opportunity-owner">Assigned To</label>
                          <select
                            id="start-opportunity-owner"
                            className="input select"
                            value={startOpportunityForm.assignedTo}
                            onChange={(event) => setStartOpportunityForm((current) => ({ ...current, assignedTo: event.target.value }))}
                          >
                            <option value="">Unassigned</option>
                            {aitUsaOwnerOptions.map((owner) => (
                              <option key={owner.id} value={owner.id}>
                                {isAitUsaContact ? aitUsaAssigneeOptionLabel(owner, currentUser?.id) : owner.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="start-opportunity-reason">Reason</label>
                      <textarea
                        id="start-opportunity-reason"
                        className="textarea"
                        rows={2}
                        value={startOpportunityForm.reason}
                        placeholder="Required when the initial status is closed"
                        onChange={(event) => setStartOpportunityForm((current) => ({ ...current, reason: event.target.value }))}
                      />
                    </div>
                    {startOpportunityError && <div className={s.courseError}>{startOpportunityError}</div>}
                    <div>
                      <button className="btn btn-primary" type="button" onClick={startOpportunity} disabled={startOpportunityBusy}>
                        {startOpportunityBusy ? 'Starting…' : 'Start opportunity'}
                      </button>
                    </div>
                  </div>
                )}
                {isClosedStatusReopen && (
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-reopen-reason">Reopen reason</label>
                    <select
                      id="profile-edit-reopen-reason"
                      className="input select"
                      value={editForm.statusChangeReason || ''}
                      onChange={e => setEditForm({...editForm, statusChangeReason: e.target.value})}
                    >
                      <option value="">Choose why this closed status is changing</option>
                      <option value="correction">Correction - closed status was entered by mistake</option>
                      <option value="new_course_follow_up">New course follow-up - previous student is active again</option>
                    </select>
                    <div className="profile-editor-helper">
                      Use correction only for data-entry mistakes. For a new class or program, choose new course follow-up so history shows this is re-engagement, not an erased completion.
                    </div>
                  </div>
                )}
                {isEnteringClosedStatus && (
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-terminal-reason">Outcome reason</label>
                    <textarea
                      id="profile-edit-terminal-reason"
                      className="textarea"
                      rows={2}
                      value={editForm.terminalStatusReason || ''}
                      placeholder="Explain why this Opportunity is moving to a closed status"
                      onChange={e => setEditForm({...editForm, terminalStatusReason: e.target.value})}
                    />
                  </div>
                )}
                {canManageContactAssignments ? (
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-owner">Assigned To</label>
                    <select id="profile-edit-owner" className="input select" value={editForm.assignedTo || ''} disabled={Boolean(isAitUsaContact && contact.opportunityConflict)} onChange={e => setEditForm({...editForm, assignedTo: e.target.value})}>
                      <option value="">Unassigned</option>
                      {aitUsaOwnerOptions.map((owner) => (
                        <option key={owner.id} value={owner.id}>
                          {isAitUsaContact ? aitUsaAssigneeOptionLabel(owner, currentUser?.id) : owner.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <input type="hidden" value={editForm.assignedTo || coordinatorUiPolicy.lockedOwnerUserId} readOnly />
                )}
                {access.canWriteCrm ? (
                  <div className="profile-editor-account-action danger-action-panel">
                    <div className="danger-action-copy">
                      <span className="danger-action-eyebrow">
                        <Archive size={14} /> Separate account action
                      </span>
                      <strong>{coordinatorUiPolicy.canArchiveContactsDirectly ? `Archive this ${singularLabel.toLowerCase()}` : 'Request archive approval'}</strong>
                      <p>
                        {coordinatorUiPolicy.canArchiveContactsDirectly
                          ? `This is not saved with profile edits. It opens a separate confirmation before removing the ${singularLabel.toLowerCase()} from normal CRM lists.`
                          : `This is not saved with profile edits. It opens a separate confirmation and the contact stays active unless approved.`}
                      </p>
                    </div>
                    <button
                      className="btn btn-danger"
                      type="button"
                      onClick={() => {
                        setArchiveReason('');
                        setArchiveConfirmOpen(true);
                      }}
                    >
                      {coordinatorUiPolicy.canArchiveContactsDirectly ? `Archive ${singularLabel}` : 'Request Approval'}
                    </button>
                  </div>
                ) : null}
              </section>
            )}

            {activeProfileEditTab === 'source' && !isAitUsaContact && (
              <section
                className="contact-profile-dialog-section"
                role="tabpanel"
                id="profile-edit-panel-source"
                aria-labelledby="profile-edit-tab-source"
              >
                <div className="contact-dialog-section-header">
                  <div>
                    <h2>Source and routing</h2>
                    <p>Keep acquisition source, student location, and learning intent distinct.</p>
                  </div>
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-source">Source</label>
                    <select id="profile-edit-source" className="input select" value={editForm.source} onChange={e => setEditForm({...editForm, source: e.target.value})}>
                      {editSourceOptions.map(src => <option key={src} value={src}>{src}</option>)}
                    </select>
                  </div>
                  {showSchoolLocationField ? (
                    <div className="form-group">
                      <label className="form-label" htmlFor="profile-edit-student-location">Student Location</label>
                      <input id="profile-edit-student-location" className="input" value={editForm.leadProfile?.locationPreference || ''} placeholder="City, municipality, or address" onChange={e => updateEditLeadProfile('locationPreference', e.target.value)} />
                      <div className="profile-editor-helper">Where the student lives; free text from Wix or an employee.</div>
                    </div>
                  ) : null}
                </div>
                <div className="grid-2">
                  {showSchoolLocationField ? (
                    <div className="form-group">
                      <label className="form-label" htmlFor="profile-edit-school-location">Intended Learning Location</label>
                      <select id="profile-edit-school-location" className="input select" value={editForm.address || ''} onChange={e => setEditForm({...editForm, address: e.target.value})}>
                        <option value="">Not specified</option>
                        {editSchoolLocationOptions.map((location) => (
                          <option key={location} value={location}>{location}</option>
                        ))}
                      </select>
                      <div className="profile-editor-helper">The approved campus or Online option the student intends to use.</div>
                    </div>
                  ) : (
                    <div className="form-group">
                      <label className="form-label" htmlFor="profile-edit-address">Address</label>
                      <input id="profile-edit-address" className="input" value={editForm.address || ''} onChange={e => setEditForm({...editForm, address: e.target.value})} />
                    </div>
                  )}
                </div>
              </section>
            )}

          </div>
        </Modal>
      )}

      {archiveConfirmOpen && (
        <Modal
          open={archiveConfirmOpen}
          onClose={() => !archiveBusy && setArchiveConfirmOpen(false)}
          title={coordinatorUiPolicy.canArchiveContactsDirectly ? `Archive ${singularLabel}` : 'Request archive approval'}
          variant="dialog"
          panelClassName="archive-confirm-dialog-panel"
          footer={(
            <>
              <button className="btn" type="button" disabled={archiveBusy} onClick={() => setArchiveConfirmOpen(false)}>Cancel</button>
              <button className="btn btn-danger" type="button" disabled={archiveBusy} onClick={handleArchiveContact}>
                {archiveBusy
                  ? (coordinatorUiPolicy.canArchiveContactsDirectly ? 'Archiving...' : 'Requesting...')
                  : (coordinatorUiPolicy.canArchiveContactsDirectly ? `Archive ${singularLabel}` : 'Request Approval')}
              </button>
            </>
          )}
        >
          <div className="empty-state" style={{padding: 12, marginBottom: 12}}>
            {coordinatorUiPolicy.canArchiveContactsDirectly
              ? `This removes the ${singularLabel.toLowerCase()} from normal CRM lists and selectors. Notes, timeline, lead history, and linked records remain in the database for audit.`
              : `This creates an approval task for a senior coordinator or admin. The ${singularLabel.toLowerCase()} remains active unless the request is approved.`}
          </div>
          <div className="form-group">
            <label className="form-label">Reason</label>
            <textarea
              className="textarea"
              rows={3}
              value={archiveReason}
              disabled={archiveBusy}
              placeholder="Example: Test Facebook lead submitted by staff."
              onChange={(event) => setArchiveReason(event.target.value)}
            />
          </div>
        </Modal>
      )}

      {estimateModalOpen && (
        <Modal
          open={estimateModalOpen}
          onClose={() => setEstimateModalOpen(false)}
          title="New Estimate"
          footer={<><button className="btn" onClick={() => setEstimateModalOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={saveEstimate}>Save Estimate</button></>}
        >
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Client</label>
              <input className="input" value={estimateForm.client} readOnly />
            </div>
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="input select" value={estimateForm.status} onChange={e => setEstimateForm({...estimateForm, status: e.target.value})}>
                {['Draft', 'Pending', 'Approved', 'Rejected'].map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Date</label>
              <input className="input" type="date" value={estimateForm.date} onChange={e => setEstimateForm({...estimateForm, date: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">Valid Until</label>
              <input className="input" type="date" value={estimateForm.dueDate || ''} onChange={e => setEstimateForm({...estimateForm, dueDate: e.target.value})} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Line Items</label>
            {estimateForm.items.map((item, index) => (
              <div key={index} style={{display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap'}}>
                <input className="input" placeholder="Description" value={item.desc} onChange={e => updateEstimateItem(index, 'desc', e.target.value)} style={{flex: '2 1 220px'}} />
                <input className="input" type="number" min="0" step="1" placeholder="Qty" value={item.qty} onChange={e => updateEstimateItem(index, 'qty', Number(e.target.value))} style={{width: 80}} />
                <input className="input" type="number" min="0" step="0.01" placeholder="Rate" value={item.rate} onChange={e => updateEstimateItem(index, 'rate', Number(e.target.value))} style={{width: 110}} />
                <button className="btn-icon" type="button" onClick={() => removeEstimateItem(index)} style={{color: 'var(--danger)'}} aria-label="Remove line item">x</button>
              </div>
            ))}
            <button className="btn btn-sm" type="button" onClick={addEstimateItem}>+ Add Line</button>
          </div>
          <div style={{textAlign: 'right', fontSize: 'var(--text-md)', fontWeight: 700, marginTop: 10}}>
            Total: ${moneyLabel(estimateTotal)}
          </div>
        </Modal>
      )}

      {!isAitUsaContact && paymentModalOpen && (
        <Modal
          open={paymentModalOpen}
          onClose={() => setPaymentModalOpen(false)}
          title="Record Payment"
          footer={<><button className="btn" onClick={() => setPaymentModalOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={savePayment}>Save Payment</button></>}
        >
          <div className="form-group">
            <label className="form-label">Invoice</label>
            <select className="input select" value={paymentForm.workOrderId} onChange={e => setPaymentForm({...paymentForm, workOrderId: e.target.value})}>
              <option value="">Select invoice</option>
              {contactInvoices.map((invoice) => (
                <option key={invoice.id} value={invoice.workOrderId}>
                  {invoice.number || 'Invoice'} - ${moneyLabel(invoice.balanceDue || invoice.amount)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Amount</label>
              <input className="input" type="number" min="0" step="0.01" value={paymentForm.amount} onChange={e => setPaymentForm({...paymentForm, amount: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">Payment Date</label>
              <input className="input" type="date" value={paymentForm.paidAt} onChange={e => setPaymentForm({...paymentForm, paidAt: e.target.value})} />
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Method</label>
              <select className="input select" value={paymentForm.paymentMethod} onChange={e => setPaymentForm({...paymentForm, paymentMethod: e.target.value})}>
                {['Cash', 'Check', 'Card', 'Zelle', 'ACH', 'Other'].map((method) => <option key={method} value={method}>{method}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Check / Reference</label>
              <input className="input" value={paymentForm.checkNumber} onChange={e => setPaymentForm({...paymentForm, checkNumber: e.target.value})} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Payment Note / Partial Payment Memo</label>
            <textarea className="input" rows={3} value={paymentForm.note} onChange={e => setPaymentForm({...paymentForm, note: e.target.value})} />
          </div>
          <div className="card" style={{padding: 12, display: 'grid', gap: 4}}>
            <div style={{display: 'flex', justifyContent: 'space-between'}}>
              <span className="page-subtitle" style={{margin: 0}}>Current balance</span>
              <strong>${moneyLabel(selectedPaymentBalance)}</strong>
            </div>
            <div style={{display: 'flex', justifyContent: 'space-between'}}>
              <span className="page-subtitle" style={{margin: 0}}>Balance after payment</span>
              <strong>${moneyLabel(balanceAfterPayment)}</strong>
            </div>
          </div>
        </Modal>
      )}

      {personModal && (
        <Modal
          open={!!personModal}
          onClose={closePersonModal}
          title={personModal === 'new' ? 'Add Linked Person' : 'Edit Linked Person'}
          variant="dialog"
          panelClassName="linked-person-dialog-panel"
          footer={<><button className="btn" onClick={closePersonModal}>Cancel</button><button className="btn btn-primary" onClick={savePerson}>Save Person</button></>}
        >
          <div className="linked-person-dialog-form">
            <div className="contact-dialog-intro">
              <p>Capture who this person is and the safest way to reach them.</p>
              <span>{personForm.isPrimary ? 'Primary contact' : 'Linked contact'}</span>
            </div>
            <section className="linked-person-section">
              <div className="contact-dialog-section-header">
                <div>
                  <h2>Relationship</h2>
                  <p>Name, role, and whether staff should treat this as the main person.</p>
                </div>
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Name</label>
                  <input className="input" value={personForm.name} data-autofocus onChange={e => setPersonForm({...personForm, name: e.target.value})} />
                </div>
                <div className="form-group">
                  <label className="form-label">Role</label>
                  <input className="input" value={personForm.role} placeholder="Parent, spouse, assistant..." onChange={e => setPersonForm({...personForm, role: e.target.value})} />
                </div>
              </div>
              <label className="linked-person-primary-toggle">
                <input type="checkbox" checked={personForm.isPrimary} onChange={e => setPersonForm({...personForm, isPrimary: e.target.checked})} />
                <span>
                  <strong>Primary person for this client</strong>
                  <small>Use when staff should call or email this person first.</small>
                </span>
              </label>
            </section>
            <section className="linked-person-section">
              <div className="contact-dialog-section-header">
                <div>
                  <h2>Contact methods</h2>
                  <p>Add whichever channel is reliable. Leave unknown fields blank.</p>
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
            </section>
            <section className="linked-person-section linked-person-notes">
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea className="textarea" rows={3} value={personForm.notes} placeholder="Relationship context, call preferences, permissions..." onChange={e => setPersonForm({...personForm, notes: e.target.value})} />
              </div>
            </section>
          </div>
        </Modal>
      )}

      {personDeleteTarget && (
        <Modal
          open={Boolean(personDeleteTarget)}
          onClose={() => !personDeleteBusy && setPersonDeleteTarget(null)}
          title="Remove Linked Person"
          variant="dialog"
          panelClassName="linked-person-remove-dialog-panel"
          footer={(
            <>
              <button className="btn" type="button" disabled={personDeleteBusy} onClick={() => setPersonDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-danger" type="button" disabled={personDeleteBusy} onClick={deletePerson}>
                {personDeleteBusy ? 'Removing...' : 'Remove Person'}
              </button>
            </>
          )}
        >
          <div className="danger-action-panel">
            <div className="danger-action-copy">
              <span className="danger-action-eyebrow">
                <AlertCircle size={14} /> Confirm removal
              </span>
              <strong>Remove {personDeleteTarget.name || 'this linked person'} from this contact?</strong>
              <p>This does not delete the main contact, but it removes this saved relationship from the contact detail page.</p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
