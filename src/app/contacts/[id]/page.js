'use client';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCRM } from '@/lib/store';
import { useToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import PageState, { PageStateAction } from '@/components/PageState';
import { coordinatorUiPolicyForUser } from '@/lib/crm/coordinator-policy.js';
import { generateInvoicePDF, generateEstimatePDF, generateReceiptPDF, generateAitUsaReceiptPDF } from '@/lib/pdf';
import s from './ContactDetail.module.css';
import {
  AlertCircle, ArrowLeft, ArrowRight, Mail, Phone, MapPin, Calendar,
  Plus, FileText, ClipboardList,
  MessageSquare, Edit3, Tag, Activity, CheckSquare, MessageCircle,
  Inbox, Send, DollarSign, Archive, BriefcaseBusiness, CheckCircle2,
  GraduationCap
} from 'lucide-react';
import { PIPELINE_STATUSES, isWorkflowStatusClosed, workflowForBusinessUnit } from '@/lib/sales-workflow';
import { buildContactDetailViewModel } from '@/lib/contact-detail-view-model';
import { WORKFLOW_KEYS } from '@/lib/crm/lifecycle';
import { schoolLocationForContact, schoolLocationOptions } from '@/lib/school-locations';
import {
  COURSE_RECORD_STATUS_OPTIONS,
  courseNameOptions,
  courseRecordStatusLabel,
  deriveCourseSummary,
  isTerminalCourseRecordStatus,
} from '@/lib/crm/course-records.js';
import { appendContactNote, contactDetailPageState, loadContactTimeline } from '@/lib/contacts/detail-loader.js';
import { useRecordScopeRegistration } from '@/components/RecordScopeContext';

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

const FOLLOW_UP_OUTCOME_OPTIONS = [
  ['reached_interested', 'Reached - interested'],
  ['left_voicemail', 'Left voicemail'],
  ['no_answer', 'No answer'],
  ['appointment_scheduled', 'Appointment scheduled'],
  ['needs_next_follow_up', 'Needs next follow-up'],
  ['reached_not_interested', 'Reached - not interested'],
  ['wrong_number', 'Wrong number'],
  ['do_not_contact', 'Do not contact'],
  ['enrolled_or_won', 'Enrolled / won'],
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

function isInvoiceRecord(record = {}) {
  return String(record.type || '').toLowerCase().includes('invoice') && Boolean(record.workOrderId);
}

function isEnrolledStudent(contact = {}) {
  return String(contact?.currentStage || contact?.status || '').trim().toLowerCase() === 'enrolled';
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
    outcome: 'reached_interested',
    channel: 'phone',
    contactMethod: '',
    note: '',
    nextDueDate: '',
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
      }));
    if (currentUser?.id && !mapped.some((employee) => employee.id === currentUser.id)) {
      return [
        { id: currentUser.id, label: currentUser.name || currentUser.email || 'Me' },
        ...mapped,
      ];
    }
    return mapped;
  }, [currentUser, employees]);
  const coordinatorUiPolicy = useMemo(() => coordinatorUiPolicyForUser(currentUser), [currentUser]);
  const [noteInput, setNoteInput] = useState('');
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpDraft, setFollowUpDraft] = useState(null);
  const [followUpTask, setFollowUpTask] = useState(null);
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [followUpError, setFollowUpError] = useState('');
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState(null);
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
  const detailView = buildContactDetailViewModel({
    contact,
    businessUnit: contactBusinessUnit,
    counts: contactRecordCounts,
  });
  const showLinkedPeoplePanel = isClientMode && detailView.workflowKey === WORKFLOW_KEYS.AIT_SIGNS;
  const showSchoolLocationField = detailView.workflowKey === WORKFLOW_KEYS.AIT_USA;
  const isAitUsaContact = detailView.workflowKey === WORKFLOW_KEYS.AIT_USA || /ait usa|institute/i.test(contactBusinessUnit?.name || '');
  const canGenerateStudentReceipt = !isAitUsaContact || isEnrolledStudent(contact);
  const hasWorkOrders = contactWorkOrders.length > 0;
  const hasInvoices = contactInvoices.length > 0;
  const profileEditTabs = useMemo(() => {
    const tabs = [
      { id: 'general', label: 'General', summary: 'Identity, status, and owner' },
      { id: 'source', label: 'Source & routing', summary: 'Attribution, student location, and learning location' },
    ];
    if (isAitUsaContact) {
      tabs.push({ id: 'enrollment', label: 'Enrollment', summary: 'Program preferences and profile notes' });
    }
    return tabs;
  }, [isAitUsaContact]);
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
  const showFinancialsTab = detailView.tabs.showFinancials || (isAitUsaContact && access.canWriteFinancials);
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
    ? 'Edit saved record'
    : (courseModal === 'history' ? 'Backfill history' : 'Start enrollment');
  const canSaveCourseForm = Boolean(cleanText(courseForm.courseName)) &&
    (!courseStartDateRequired || Boolean(courseForm.startDate));
  const financialNotice = isAitUsaContact
    ? (canGenerateStudentReceipt
        ? { tone: 'ready', text: 'Ready to generate a student receipt.' }
        : { tone: 'blocked', text: 'Student must be Enrolled before generating a receipt.' })
    : (!hasWorkOrders
        ? { tone: 'blocked', text: 'Create a work order before generating an invoice.' }
        : (!hasInvoices
            ? { tone: 'warning', text: 'Generate an invoice from a work order before recording a payment.' }
            : { tone: 'ready', text: 'Invoice is ready for payment recording.' }));
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
    setActiveProfileEditTab('general');
    setEditForm({
      ...contact,
      assignedTo: contact?.assignedTo || '',
      statusChangeReason: '',
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
      startDate: mode === 'enrollment' ? todayDate() : '',
      endDate: mode === 'history' ? todayDate() : '',
    });
    setCourseModal(mode);
    setCourseError('');
  };

  const openEnrollmentCoursePrompt = () => {
    if (!access.canWriteCrm || !showCoursesTab || activeCourseRecord) return;
    setActiveTab('courses');
    openCourseModal('enrollment');
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
        body: JSON.stringify(courseForm),
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
      setCourseModal(null);
      setCourseForm(emptyCourseForm);
      toast(courseForm.id ? 'Course updated' : 'Course added');
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
      setActiveProfileEditTab('general');
      toast('Choose why this closed status is being reopened.', 'error');
      return;
    }
    const shouldPromptForCourse = isAitUsaContact &&
      editForm.status !== contact.status &&
      isEnrolledWorkflowStatus(editForm.status) &&
      !activeCourseRecord;
    const profilePatch = { ...editForm };
    delete profilePatch.notes;
    delete profilePatch.timeline;
    updateContact(contact.id, {
      ...profilePatch,
      ...(coordinatorUiPolicy.lockedOwnerUserId ? { assignedTo: coordinatorUiPolicy.lockedOwnerUserId } : {}),
      statusChangeReason: isClosedStatusReopen ? editForm.statusChangeReason : '',
      ...(editForm.leadProfile ? { leadProfile: editForm.leadProfile } : {}),
    })
      .then(() => {
        toast('Profile updated');
        setTimelineReloadKey((key) => key + 1);
        setIsEditModalOpen(false);
        if (shouldPromptForCourse) {
          openEnrollmentCoursePrompt();
        }
      })
      .catch((error) => {
        toast(error.message || 'Profile update failed', 'error');
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

  const openFollowUpModal = () => {
    if (!contact?.id || !access.canWriteCrm) return;
    setFollowUpDraft(defaultFollowUpDraft(contact, currentUser, ownerOptions));
    setFollowUpTask(null);
    setFollowUpError('');
    setFollowUpOpen(true);
    if (dataSource !== 'postgres') return;

    fetch(`/api/contacts/${contact.id}/follow-up`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Follow-up task lookup failed.');
        setFollowUpTask(payload.task || null);
      })
      .catch((error) => {
        setFollowUpError(error.message || 'Follow-up task lookup failed.');
      });
  };

  const closeFollowUpModal = () => {
    if (followUpBusy) return;
    setFollowUpOpen(false);
    setFollowUpDraft(null);
    setFollowUpTask(null);
    setFollowUpError('');
  };

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
    if (!contact?.id || !access.canWriteCrm || !followUpDraft || followUpBusy) return;
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
          outcome: followUpDraft.outcome,
          channel: followUpDraft.channel,
          contactMethod: followUpDraft.contactMethod,
          note: followUpDraft.note,
          nextDueAt: dateInputToIso(followUpDraft.nextDueDate),
          nextOwnerUserId: coordinatorUiPolicy.lockedOwnerUserId || followUpDraft.nextOwnerUserId || currentUser?.id || null,
          leadProfile: followUpDraft.leadProfile,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Follow-up log failed.');
      setFollowUpOpen(false);
      setFollowUpDraft(null);
      setFollowUpTask(null);
      setTimelineFilter('all');
      setTimelineReloadKey((key) => key + 1);
      toast(payload.taskMatched ? 'Follow-up task completed' : 'Follow-up logged');
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
    if (isAitUsaContact && !canGenerateStudentReceipt) {
      toast('Student must be Enrolled before generating a receipt. Change the status to Enrolled first.', 'error');
      return;
    }
    if (!isAitUsaContact && !invoice) {
      toast('Generate an invoice from a work order before recording a payment.', 'error');
      return;
    }
    const workOrder = isAitUsaContact
      ? null
      : contactWorkOrders.find((entry) => entry.id === invoice?.workOrderId) || null;
    const workOrderTotal = moneyValue(invoice?.amount || invoice?.balanceDue || workOrder?.estimatedCost || workOrder?.amount);
    const paid = contactFinancials
      .filter((record) => record.workOrderId && record.workOrderId === workOrder?.id)
      .filter((record) => financialCategory(record) === 'payment')
      .reduce((sum, record) => sum + moneyValue(record.paidAmount || record.amount), 0);
    setPaymentForm({
      ...emptyPaymentForm,
      workOrderId: isAitUsaContact ? '' : (workOrder?.id || ''),
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
    if (isAitUsaContact && !canGenerateStudentReceipt) {
      toast('Student must be Enrolled before generating a receipt. Change the status to Enrolled first.', 'error');
      return;
    }
    const workOrder = contactWorkOrders.find((entry) => entry.id === paymentForm.workOrderId) || null;
    if (!isAitUsaContact && !contactInvoices.some((invoice) => invoice.workOrderId && invoice.workOrderId === workOrder?.id)) {
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
      .then((receipt) => {
        if (isAitUsaContact) {
          generateAitUsaReceiptPDF(receipt || {
            ...paymentPayload,
            type: 'Receipt',
            number: `REC-${todayDate().replaceAll('-', '')}`,
            status: 'Paid',
          }, financialContext);
        }
        setPaymentModalOpen(false);
        setTimelineReloadKey((key) => key + 1);
        toast(isAitUsaContact ? 'Payment recorded and receipt downloaded' : 'Payment recorded');
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
    if (isAitUsaContact) {
      openPaymentModal();
      return;
    }
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

  const addNote = () => {
    if (!noteInput.trim()) return;
    if (!access.canWriteCrm) return;
    const newNote = {
      text: noteInput,
      createdAt: new Date().toISOString(),
      id: crypto.randomUUID()
    };
    const save = dataSource === 'postgres'
      ? appendContactNote(contact.id, newNote.text)
      : updateContact(contact.id, {
          notes: Array.isArray(contact.notes) ? [...contact.notes, newNote] : [newNote],
        });
    save
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

  const profileSidebar = (
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
          {nextStatus && (
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

  return (
    <div className={s.detailPage + " fade-in"}>
      <div className="page-header">
        <button className={s.btnBack} onClick={() => (isClientMode ? router.push('/clients') : router.back())}>
          <ArrowLeft size={18} /> Back to {pluralLabel}
        </button>
      </div>

      <div className={s.detailLayout}>
        {/* Main Section: Review content */}
        <div className={s.contentSection}>
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

          <div className={s.contentTabs}>
            <button className={`${s.contentTab} ${renderedActiveTab === 'timeline' ? s.active : ''}`} onClick={() => setActiveTab('timeline')}>Timeline</button>
            <button className={`${s.contentTab} ${renderedActiveTab === 'conversations' ? s.active : ''}`} onClick={() => setActiveTab('conversations')}>Conversations ({conversationMessages.length})</button>
            {showCoursesTab && (
              <button className={`${s.contentTab} ${renderedActiveTab === 'courses' ? s.active : ''}`} onClick={() => setActiveTab('courses')}>Courses ({currentCourseRecords.length})</button>
            )}
            {showLinkedPeoplePanel && (
              <button className={`${s.contentTab} ${renderedActiveTab === 'contacts' ? s.active : ''}`} onClick={() => setActiveTab('contacts')}>Contacts ({currentLinkedPeople.items.length})</button>
            )}
            {showWorkOrdersTab && (
              <button className={`${s.contentTab} ${renderedActiveTab === 'workorders' ? s.active : ''}`} onClick={() => setActiveTab('workorders')}>{detailView.tabs.workOrdersLabel} ({contactWorkOrders.length})</button>
            )}
            {showFinancialsTab && (
              <button className={`${s.contentTab} ${renderedActiveTab === 'financials' ? s.active : ''}`} onClick={() => setActiveTab('financials')}>{detailView.tabs.financialLabel} ({visibleFinancials.length})</button>
            )}
          </div>

          <div className={s.tabContent}>
            {renderedActiveTab === 'timeline' && (
              <div className={s.timelineView}>
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
                </div>

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
                </div>}

                <div className={s.noteBox}>
                  <textarea
                    placeholder="Type an internal note..."
                    value={noteInput}
                    onChange={e => setNoteInput(e.target.value)}
                    disabled={!access.canWriteCrm}
                  />
                  <div className={s.noteBoxFooter}>
                    <button className="btn btn-primary btn-sm" onClick={addNote} disabled={!access.canWriteCrm}>
                      <Plus size={14} /> Add Note
                    </button>
                    <button className="btn btn-sm" type="button" onClick={openFollowUpModal} disabled={!access.canWriteCrm}>
                      <AlertCircle size={14} /> Log Follow-up
                    </button>
                  </div>
                </div>
              </div>
            )}

            {renderedActiveTab === 'courses' && showCoursesTab && (
              <div className={s.coursesPanel} aria-label="Courses">
                <div className={s.courseHero}>
                  <div className={s.courseHeroMain}>
                    <div className={s.courseHeroIcon}><GraduationCap size={22} /></div>
                    <div>
                      <span className={s.courseEyebrow}>Active enrollments</span>
                      <h2>{activeCourseRecords.length ? `${activeCourseRecords.length} active` : 'No active enrollments'}</h2>
                      <p>
                        {activeCourseRecords.length
                          ? 'A student can attend more than one class section at the same time.'
                          : 'Start an enrollment when the student joins a class. Older courses stay in history.'}
                      </p>
                      {activeCourseRecords.length > 0 && (
                        <div className={s.courseActiveList}>
                          {activeCourseRecords.map((record) => (
                            <button
                              key={record.id}
                              type="button"
                              className={s.courseActiveItem}
                              onClick={() => setSelectedCourseRecordId(record.id)}
                            >
                              <strong>{record.courseName}</strong>
                              <span>{[
                                record.teacher ? `Teacher: ${record.teacher}` : '',
                                record.courseLocation,
                                classSectionScheduleLabel(record.classSection),
                              ].filter(Boolean).join(' · ') || 'Class details not set'}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {access.canWriteCrm && (
                    <div className={s.courseHeroActions}>
                      <button className="btn btn-primary btn-sm" type="button" onClick={() => openCourseModal('new')}>
                        <Plus size={14} /> Add Enrollment
                      </button>
                    </div>
                  )}
                </div>

                <div className={s.courseToolbar}>
                  <div>
                    <strong>Course history</strong>
                    <span>{courseRecordsState.loading ? 'Loading' : `${currentCourseRecords.length} records`}</span>
                  </div>
                  {access.canWriteCrm && (
                    <div className={s.courseToolbarActions}>
                      <button className="btn btn-sm" type="button" onClick={() => openCourseModal('history')}>
                        <Plus size={14} /> Add History
                      </button>
                      <button className="btn btn-primary btn-sm" type="button" onClick={() => openCourseModal('new')}>
                        <Plus size={14} /> Add Enrollment
                      </button>
                    </div>
                  )}
                </div>

                {courseRecordsState.error && <div className={s.courseError}>{courseRecordsState.error}</div>}
                {!courseRecordsState.error && !courseRecordsState.loading && currentCourseRecords.length === 0 && (
                  <div className={s.courseEmpty}>
                    <div className="empty-state-title">No course history yet</div>
                    <p className="empty-state-copy">Add an active enrollment or backfill a completed course to start the timeline.</p>
                    {access.canWriteCrm && (
                      <button className="btn btn-primary" type="button" onClick={() => openCourseModal('new')}>
                        <Plus size={16} /> Start Course
                      </button>
                    )}
                  </div>
                )}

                {currentCourseRecords.length > 0 && (
                  <div className={s.courseHistoryGrid}>
                    <div className={s.courseRecordList}>
                      {courseSummary.records.map((record) => (
                        <button
                          key={record.id}
                          type="button"
                          className={`${s.courseRecordRow} ${selectedCourseRecord?.id === record.id ? s.active : ''}`}
                          onClick={() => setSelectedCourseRecordId(record.id)}
                        >
                          <span className={`${s.courseStatusDot} ${s[`courseStatus_${record.status}`] || ''}`} />
                          <span className={s.courseRecordMain}>
                            <strong>{record.courseName}</strong>
                            <small>
                              {courseRecordStatusLabel(record.status)}
                              {` - ${record.courseLocation || 'Delivery location not set'}`}
                              {` - ${record.teacher ? `Teacher: ${record.teacher}` : 'Teacher not assigned'}`}
                              {record.classSection ? ` - ${classSectionScheduleLabel(record.classSection) || record.classSection.sectionKey}` : ''}
                              {record.startDate ? ` - ${record.startDate}` : ''}
                              {record.endDate ? ` to ${record.endDate}` : ''}
                            </small>
                          </span>
                          <span className={s.courseRecordStatus}>{courseRecordStatusLabel(record.status)}</span>
                        </button>
                      ))}
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
                {access.canWriteFinancials && (
                  <div className={s.commandCard}>
                    <div className={s.commandCopy}>
                      <div className={s.commandTitle}>{isAitUsaContact ? 'Student receipts' : 'Financial workflow'}</div>
                      <p>
                        {isAitUsaContact
                          ? 'Generate AIT USA receipt PDFs once the student is enrolled.'
                          : 'Estimates can start here. Invoices come from work orders, and payments are recorded against invoices.'}
                      </p>
                    </div>
                    {!isAitUsaContact && (
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
                    )}
                    <div className={s.commandActions}>
                      {!isAitUsaContact && (
                        <>
                          <button className="btn btn-primary" type="button" onClick={openEstimateModal}>
                            <FileText size={16} /> New Estimate
                          </button>
                          <button className="btn" type="button" onClick={downloadSelectedWorkOrderInvoice}>
                            <FileText size={16} /> Generate Invoice
                          </button>
                        </>
                      )}
                      <button className="btn" type="button" onClick={() => recordPaymentAgainstInvoice()}>
                        <DollarSign size={16} /> {isAitUsaContact ? 'Generate Student Receipt' : 'Record Invoice Payment'}
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
                {visibleFinancials.map(f => (
                  <div key={f.id} className={s.recordCard}>
                    <div className={s.recordMain}>
                      <div className={s.recordIcon}><FileText size={20} /></div>
                      <div>
                        <div className={s.recordTitle}>
                          {isAitUsaContact ? 'Receipt' : f.type} {f.number}
                        </div>
                        <div className={s.recordSubtitle}>{f.date}</div>
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
                ))}
                {visibleFinancials.length === 0 && (
                  <div className={`empty-state ${s.financialEmptyState}`}>
                    <div className="empty-state-title">
                      {isAitUsaContact ? 'No receipts for this student yet' : 'No financial records for this contact yet'}
                    </div>
                    <p className="empty-state-copy">
                      {access.canWriteFinancials
                        ? (isAitUsaContact
                            ? 'Change the student status to Enrolled before generating the first AIT USA receipt.'
                            : 'You can create the first estimate from this contact record. Invoices are generated from linked work orders, and payments are recorded against invoices.')
                        : (isAitUsaContact
                            ? 'No receipts are visible for this student in the current scope.'
                            : 'No estimates, invoices, receipts, or payments are visible for this contact in the current scope.')}
                    </p>
                    <div className="empty-state-actions">
                      {access.canWriteFinancials ? (
                        <>
                          {isAitUsaContact ? (
                            <button className="btn btn-primary" type="button" onClick={() => recordPaymentAgainstInvoice()}>
                              <DollarSign size={16} /> Generate Student Receipt
                            </button>
                          ) : (
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
        {profileSidebar}
      </div>

      {courseModal && (
        <Modal
          open={Boolean(courseModal)}
          onClose={closeCourseModal}
          title={courseForm.id ? 'Edit Enrollment' : (courseModal === 'history' ? 'Add Course History' : 'Add Enrollment')}
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
                <CheckCircle2 size={16} /> {courseBusy ? 'Saving...' : 'Save Course'}
              </button>
            </>
          )}
        >
          <div className="course-editor-form">
            <div className="contact-dialog-intro">
              <p>Record the course exactly as the student moved through it. Status changes which dates and outcome details matter.</p>
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
              <div className="course-status-grid" role="radiogroup" aria-label="Course status">
                {COURSE_RECORD_STATUS_OPTIONS.map((option) => {
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

      {followUpOpen && followUpDraft && (
        <Modal
          open={followUpOpen}
          onClose={closeFollowUpModal}
          title="Log Follow-up"
          variant="dialog"
          panelClassName="follow-up-dialog-panel"
          footer={(
            <>
              <button className="btn" type="button" onClick={closeFollowUpModal} disabled={followUpBusy}>Cancel</button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={submitFollowUpLog}
                disabled={followUpBusy || !followUpDraft.note.trim()}
              >
                <CheckCircle2 size={16} /> {followUpBusy ? 'Saving...' : 'Save Outcome'}
              </button>
            </>
          )}
        >
          <div className="follow-up-dialog-form">
            <div className="follow-up-task-match">
              <div>
                <strong>Task match</strong>
                <p>
                  {followUpTask
                    ? `Completes oldest open follow-up task: ${followUpTask.title || 'Follow-up'} (${taskDateLabel(followUpTask.dueAt)}).`
                    : 'No open follow-up task was found. This will log follow-up history directly.'}
                </p>
              </div>
            </div>

            <div className="follow-up-workflow-grid">
              <div className="follow-up-workflow-stack">
                <section className="follow-up-dialog-section">
                  <div className="contact-dialog-section-header">
                    <span className="contact-dialog-section-index">1</span>
                    <div>
                      <h2>What happened?</h2>
                      <p>Capture the result and the channel used before setting the next action.</p>
                    </div>
                  </div>
                  <div className="grid-2">
                    <div className="form-group">
                      <label className="form-label" htmlFor="follow-up-outcome">Outcome</label>
                      <select
                        id="follow-up-outcome"
                        className="input select"
                        value={followUpDraft.outcome}
                        disabled={followUpBusy}
                        onChange={(event) => updateFollowUpDraft({ outcome: event.target.value })}
                      >
                        {FOLLOW_UP_OUTCOME_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="follow-up-channel">Channel</label>
                      <select
                        id="follow-up-channel"
                        className="input select"
                        value={followUpDraft.channel}
                        disabled={followUpBusy}
                        onChange={(event) => updateFollowUpDraft({ channel: event.target.value })}
                      >
                        <option value="phone">Phone</option>
                        <option value="sms">SMS</option>
                        <option value="whatsapp">WhatsApp</option>
                        <option value="email">Email</option>
                        <option value="in_person">In person</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="follow-up-attempted">Attempted</label>
                    <input
                      id="follow-up-attempted"
                      className="input"
                      value={followUpDraft.contactMethod}
                      disabled={followUpBusy}
                      placeholder="Phone or email used"
                      onChange={(event) => updateFollowUpDraft({ contactMethod: event.target.value })}
                    />
                  </div>
                </section>

                <section className="follow-up-dialog-section">
                  <div className="contact-dialog-section-header">
                    <span className="contact-dialog-section-index">2</span>
                    <div>
                      <h2>What happens next?</h2>
                      <p>Set the next follow-up date and owner so the work stays accountable.</p>
                    </div>
                  </div>
                  <div className="grid-2">
                    <div className="form-group">
                      <label className="form-label" htmlFor="follow-up-next-due">Next Due</label>
                      <input
                        id="follow-up-next-due"
                        className="input"
                        type="date"
                        value={followUpDraft.nextDueDate}
                        disabled={followUpBusy}
                        onChange={(event) => updateFollowUpDraft({ nextDueDate: event.target.value })}
                      />
                    </div>
                    {coordinatorUiPolicy.canManageCoordinatorAssignments && (
                      <div className="form-group">
                        <label className="form-label" htmlFor="follow-up-next-owner">Next Owner</label>
                        <select
                          id="follow-up-next-owner"
                          className="input select"
                          value={followUpDraft.nextOwnerUserId}
                          disabled={followUpBusy}
                          onChange={(event) => updateFollowUpDraft({ nextOwnerUserId: event.target.value })}
                        >
                          <option value="" disabled>Select owner</option>
                          {ownerOptions.map((owner) => (
                            <option key={owner.id} value={owner.id}>{owner.label}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </section>
              </div>

              <section className="follow-up-dialog-section follow-up-note-section">
                <div className="contact-dialog-section-header">
                  <span className="contact-dialog-section-index">3</span>
                  <div>
                    <h2>Required note</h2>
                    <p>Write the operator-readable summary that explains the outcome.</p>
                  </div>
                </div>
                <textarea
                  id="follow-up-note"
                  className="textarea follow-up-note-input"
                  rows={8}
                  value={followUpDraft.note}
                  disabled={followUpBusy}
                  placeholder="Example: Spoke with Maria. Interested in evening ESL, asked for Saturday availability, follow up Friday with schedule options."
                  onChange={(event) => updateFollowUpDraft({ note: event.target.value })}
                />
              </section>
            </div>

            {isAitUsaContact && (
              <details className="follow-up-profile-disclosure">
                <summary>
                  <span>Update enrollment profile</span>
                  <small>Optional fields from the conversation</small>
                </summary>
                <div className="follow-up-profile-fields">
                  <div className="grid-2">
                    <div className="form-group">
                      <label className="form-label" htmlFor="follow-up-program">Program</label>
                      <input id="follow-up-program" className="input" value={followUpDraft.leadProfile?.programInterest || ''} disabled={followUpBusy} onChange={(event) => updateFollowUpLeadProfile('programInterest', event.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="follow-up-location">Student Location</label>
                      <input id="follow-up-location" className="input" value={followUpDraft.leadProfile?.locationPreference || ''} disabled={followUpBusy} placeholder="City, municipality, or address" onChange={(event) => updateFollowUpLeadProfile('locationPreference', event.target.value)} />
                    </div>
                  </div>
                  <div className="grid-2">
                    <div className="form-group">
                      <label className="form-label" htmlFor="follow-up-preferred-day">Preferred Day</label>
                      <input id="follow-up-preferred-day" className="input" value={followUpDraft.leadProfile?.preferredDay || ''} disabled={followUpBusy} onChange={(event) => updateFollowUpLeadProfile('preferredDay', event.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="follow-up-schedule">Schedule</label>
                      <input id="follow-up-schedule" className="input" value={followUpDraft.leadProfile?.preferredSchedule || ''} disabled={followUpBusy} onChange={(event) => updateFollowUpLeadProfile('preferredSchedule', event.target.value)} />
                    </div>
                  </div>
                  <div className="grid-2">
                    <div className="form-group">
                      <label className="form-label" htmlFor="follow-up-test">Test</label>
                      <input id="follow-up-test" className="input" value={followUpDraft.leadProfile?.testInterest || ''} disabled={followUpBusy} onChange={(event) => updateFollowUpLeadProfile('testInterest', event.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="follow-up-level">Level</label>
                      <input id="follow-up-level" className="input" value={followUpDraft.leadProfile?.educationLevel || ''} disabled={followUpBusy} onChange={(event) => updateFollowUpLeadProfile('educationLevel', event.target.value)} />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="follow-up-school">School</label>
                    <input id="follow-up-school" className="input" value={followUpDraft.leadProfile?.schoolName || ''} disabled={followUpBusy} onChange={(event) => updateFollowUpLeadProfile('schoolName', event.target.value)} />
                  </div>
                </div>
              </details>
            )}

            {followUpError && <div className={s.followUpError}>{followUpError}</div>}
          </div>
        </Modal>
      )}

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
            <div className="contact-dialog-intro">
              <p>Update {contact?.name || singularLabel.toLowerCase()} without leaving the contact record.</p>
              <span>Profile and routing details</span>
            </div>

            <div className="profile-editor-tabs" role="tablist" aria-label="Profile edit sections">
              {profileEditTabs.map((tab) => {
                const selected = activeProfileEditTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`profile-edit-panel-${tab.id}`}
                    id={`profile-edit-tab-${tab.id}`}
                    className={`profile-editor-tab ${selected ? 'is-active' : ''}`}
                    onClick={() => setActiveProfileEditTab(tab.id)}
                  >
                    <span>{tab.label}</span>
                    <small>{tab.summary}</small>
                  </button>
                );
              })}
            </div>

            {activeProfileEditTab === 'general' && (
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
                    <select id="profile-edit-status" className="input select" value={editForm.status} onChange={e => setEditForm({...editForm, status: e.target.value})}>
                      {[...new Set([...(contactStatusOptions || PIPELINE_STATUSES), ...(editForm.status ? [editForm.status] : [])])].map(st => <option key={st} value={st}>{st}</option>)}
                    </select>
                  </div>
                </div>
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
                {coordinatorUiPolicy.canManageCoordinatorAssignments ? (
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-owner">Assigned To</label>
                    <select id="profile-edit-owner" className="input select" value={editForm.assignedTo || ''} onChange={e => setEditForm({...editForm, assignedTo: e.target.value})}>
                      <option value="">Unassigned</option>
                      {ownerOptions.map((owner) => (
                        <option key={owner.id} value={owner.id}>{owner.label}</option>
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

            {activeProfileEditTab === 'source' && (
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

            {activeProfileEditTab === 'enrollment' && isAitUsaContact && (
              <section
                className="contact-profile-dialog-section"
                role="tabpanel"
                id="profile-edit-panel-enrollment"
                aria-labelledby="profile-edit-tab-enrollment"
              >
                <div className="contact-dialog-section-header">
                  <div>
                    <h2>Enrollment profile</h2>
                    <p>Capture program preferences and background details when they matter for follow-up.</p>
                  </div>
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-program-interest">Program Interest</label>
                    <input id="profile-edit-program-interest" className="input" value={editForm.leadProfile?.programInterest || ''} onChange={e => updateEditLeadProfile('programInterest', e.target.value)} />
                  </div>
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-preferred-day">Preferred Day</label>
                    <input id="profile-edit-preferred-day" className="input" value={editForm.leadProfile?.preferredDay || ''} onChange={e => updateEditLeadProfile('preferredDay', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-preferred-schedule">Preferred Schedule</label>
                    <input id="profile-edit-preferred-schedule" className="input" value={editForm.leadProfile?.preferredSchedule || ''} onChange={e => updateEditLeadProfile('preferredSchedule', e.target.value)} />
                  </div>
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-test-interest">Test</label>
                    <input id="profile-edit-test-interest" className="input" value={editForm.leadProfile?.testInterest || ''} onChange={e => updateEditLeadProfile('testInterest', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-education-level">Level</label>
                    <input id="profile-edit-education-level" className="input" value={editForm.leadProfile?.educationLevel || ''} onChange={e => updateEditLeadProfile('educationLevel', e.target.value)} />
                  </div>
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-school-name">School</label>
                    <input id="profile-edit-school-name" className="input" value={editForm.leadProfile?.schoolName || ''} onChange={e => updateEditLeadProfile('schoolName', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="profile-edit-source-detail">Source Detail</label>
                    <input id="profile-edit-source-detail" className="input" value={editForm.leadProfile?.sourceDetail || ''} onChange={e => updateEditLeadProfile('sourceDetail', e.target.value)} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="profile-edit-profile-details">Profile Details</label>
                  <textarea id="profile-edit-profile-details" className="textarea" rows={3} value={editForm.leadProfile?.profileDetails || ''} onChange={e => updateEditLeadProfile('profileDetails', e.target.value)} />
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

      {paymentModalOpen && (
        <Modal
          open={paymentModalOpen}
          onClose={() => setPaymentModalOpen(false)}
          title={isAitUsaContact ? 'Generate Student Receipt' : 'Record Payment'}
          footer={<><button className="btn" onClick={() => setPaymentModalOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={savePayment}>{isAitUsaContact ? 'Save & Download Receipt' : 'Save Payment'}</button></>}
        >
          {!isAitUsaContact && (
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
          )}
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
            <label className="form-label">{isAitUsaContact ? 'Receipt Memo' : 'Payment Note / Partial Payment Memo'}</label>
            <textarea className="input" rows={3} value={paymentForm.note} onChange={e => setPaymentForm({...paymentForm, note: e.target.value})} />
          </div>
          {!isAitUsaContact && (
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
          )}
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
