'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  CheckCircle2,
  Pencil,
  ExternalLink,
  FilterX,
  ListTodo,
  MoreHorizontal,
  Plus,
  RefreshCcw,
  Repeat2,
  ShieldAlert,
  X,
  UserPlus,
} from 'lucide-react';
import { useCRM } from '@/lib/store';
import { isAssignableEmployee } from '@/lib/crm/assignable-employees.js';
import { coordinatorUiPolicyForUser } from '@/lib/crm/coordinator-policy.js';
import PageState, { PageStateAction } from '@/components/PageState';
import { lifecycleBucket } from '@/lib/contact-directory-view.js';
import {
  routeBusinessUnitFilterForGlobalScope,
  syncRouteBusinessUnitFilter,
} from '@/lib/division-scope.js';
import {
  isTaskClosed,
  isTaskCompletedToday,
  isTaskCurrentWork,
  isTaskDueToday,
  isTaskOpen,
  isTaskOverdue,
  isTaskUpcoming,
  taskMatchesDueView,
  taskDateKey,
} from '@/lib/tasks/visibility.js';
import { useToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import FollowUpOutcomeDialog from '@/components/FollowUpOutcomeDialog';
import { TaskCancellationDialog } from '@/components/TaskCancellationDialog';
import { TaskRemovalDecisionDialog } from '@/components/TaskRemovalDecisionDialog';
import { fetchTaskContactOptions } from '@/lib/tasks/contact-options-loader.js';
import {
  canReviewTaskRemovalApprovals,
  taskRemovalApprovalState,
} from '@/lib/tasks/removal-approval-view.js';
import {
  TASK_CANCELLATION_DECISIONS,
  taskCancellationDecision,
} from '@/lib/tasks/cancellation-policy.js';
import s from './FollowUpQueue.module.css';

const TASK_TYPE_OPTIONS = [
  ['all', 'All Types'],
  ['first_outreach', 'First Outreach'],
  ['follow_up', 'Follow Up'],
  ['appointment', 'Appointment'],
  ['document_request', 'Docs'],
  ['payment_follow_up', 'Payment'],
  ['manual_reminder', 'Manual'],
  ['archive_approval', 'Archive Approval'],
  ['task_removal_approval', 'Task Removal Approval'],
];

const DUE_OPTIONS = [
  ['open', 'All Open Tasks'],
  ['work', 'Due Now (Overdue + Today)'],
  ['today', 'Due Today'],
  ['overdue', 'Overdue'],
  ['upcoming', 'Upcoming'],
  ['all', 'All Tasks'],
];

const STATUS_OPTIONS = [
  ['all', 'All Statuses'],
  ['open', 'Open'],
  ['in_progress', 'In Progress'],
  ['snoozed', 'Snoozed'],
  ['completed', 'Completed'],
  ['canceled', 'Canceled'],
];

const LINK_OPTIONS = [
  ['all', 'All Links'],
  ['contact', 'Linked Contact'],
  ['unlinked', 'No Contact'],
  ['recurring', 'Recurring'],
];

const DUE_OPTION_VALUES = new Set(DUE_OPTIONS.map(([value]) => value));
const STATUS_OPTION_VALUES = new Set(STATUS_OPTIONS.map(([value]) => value));
const LINK_OPTION_VALUES = new Set(LINK_OPTIONS.map(([value]) => value));

const TASK_CREATE_TYPE_OPTIONS = TASK_TYPE_OPTIONS.filter(([value]) => !['all', 'archive_approval', 'task_removal_approval'].includes(value));
const TASK_PRIORITY_OPTIONS = [
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['urgent', 'Urgent'],
];
const TASK_RECURRENCE_OPTIONS = [
  ['none', 'Does Not Repeat'],
  ['daily', 'Daily'],
  ['weekly', 'Weekly'],
  ['biweekly', 'Biweekly'],
  ['monthly', 'Monthly'],
];
const CREATE_DRAFT_FIELDS = [
  'title',
  'description',
  'taskType',
  'dueDate',
  'ownerUserId',
  'businessUnitId',
  'contactId',
  'priority',
  'recurrenceFrequency',
];

function dateKey(value) {
  return taskDateKey(value);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function dateInputToIso(value) {
  if (!value) return null;
  const date = new Date(`${value}T09:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function formatDate(value) {
  const key = dateKey(value);
  if (!key) return 'No due date';
  const today = todayKey();
  if (key === today) return 'Today';
  const date = new Date(value);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function titleCase(value) {
  return String(value || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function defaultBusinessUnitId(currentBusinessUnitId, accessibleBusinessUnits = []) {
  if (currentBusinessUnitId && currentBusinessUnitId !== 'all' && currentBusinessUnitId !== 'unassigned') {
    return currentBusinessUnitId;
  }
  return accessibleBusinessUnits[0]?.id || '';
}

function defaultCreateDraft({ currentBusinessUnitId, accessibleBusinessUnits, currentUser }) {
  return {
    title: '',
    description: '',
    taskType: 'manual_reminder',
    dueDate: todayKey(),
    ownerUserId: currentUser?.id || '',
    businessUnitId: defaultBusinessUnitId(currentBusinessUnitId, accessibleBusinessUnits),
    contactId: '',
    priority: 'medium',
    recurrenceFrequency: 'none',
  };
}

function defaultOwnerUserId(currentUser, assignees = []) {
  return currentUser?.id || assignees[0]?.id || '';
}

function editDraftFromTask(task) {
  return {
    title: task.title || '',
    description: task.description || '',
    taskType: task.taskType || 'manual_reminder',
    dueDate: dateKey(task.dueAt),
    ownerUserId: task.ownerUserId || '',
    businessUnitId: task.businessUnitId || '',
    contactId: task.contactId || '',
    priority: task.priority || 'medium',
    recurrenceFrequency: task.recurrence?.frequency || 'none',
  };
}

function taskTypeForFilter(value) {
  return TASK_CREATE_TYPE_OPTIONS.some(([optionValue]) => optionValue === value)
    ? value
    : '';
}

function ownerForFilter(value, currentUser, visibleAssignees = []) {
  if (value === '__me') return currentUser?.id || '';
  if (!value || value === 'all' || value === 'unassigned') return '';
  return visibleAssignees.some((user) => user.id === value) ? value : '';
}

function dueDateForFilter(value) {
  if (value === 'upcoming') {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  }
  return todayKey();
}

function normalizeTask(task, contacts = []) {
  const contact = contacts.find((row) => row.id === task.contactId);
  const status = task.status || task.taskStatus || (task.completed ? 'completed' : 'open');
  const dueAt = task.dueAt || task.dueDate || null;
  const ownerUserId = task.ownerUserId || task.assignedTo || '';
  return {
    ...task,
    dueAt,
    ownerUserId,
    status,
    taskType: task.taskType || 'manual_reminder',
    priority: String(task.priority || 'medium').toLowerCase(),
    contactName: task.contactName || task.client || contact?.name || '',
    recurrence: task.metadataJson?.recurrence || null,
  };
}

function taskMatchesDue(task, dueFilter) {
  const today = todayKey();
  if (dueFilter === 'unassigned') return !task.ownerUserId && isTaskOpen(task);
  return taskMatchesDueView(task, dueFilter, today);
}

function taskBadgeClass(task) {
  if (task.status === 'completed') return 'badge-completed';
  if (task.status === 'canceled') return 'badge-lost';
  if (dateKey(task.dueAt) && dateKey(task.dueAt) < todayKey() && !isTaskClosed(task)) return 'badge-overdue';
  if (task.status === 'snoozed') return 'badge-pending';
  return 'badge-contacted';
}

function recurrenceLabel(recurrence) {
  if (!recurrence?.frequency || recurrence.frequency === 'none') return '';
  const match = TASK_RECURRENCE_OPTIONS.find(([value]) => value === recurrence.frequency);
  return match?.[1] || titleCase(recurrence.frequency);
}

function isUnassignedInboundLeadFollowUp(task = {}) {
  return isTaskOpen(task) &&
    task.taskType === 'follow_up' &&
    !task.ownerUserId &&
    task.sourceType === 'automation' &&
    task.sourceLabel === 'New lead follow-up';
}

function isFacebookLeadFollowUp(task = {}) {
  return isUnassignedInboundLeadFollowUp(task) &&
    String(task.sourceId || '').startsWith('facebook_lead_ads:');
}

function canReviewArchiveApprovals(user = {}) {
  const roleKeys = [user.primaryRoleKey, ...(Array.isArray(user.roleKeys) ? user.roleKeys : [])].filter(Boolean);
  return roleKeys.includes('admin') || roleKeys.includes('senior_coordinator');
}

function optionLabel(options, value) {
  return options.find(([optionValue]) => optionValue === value)?.[1] || titleCase(value);
}

function mergeContactsById(current = [], incoming = []) {
  const byId = new Map(current.map((contact) => [contact.id, contact]));
  let changed = false;
  for (const contact of incoming) {
    if (!contact?.id) continue;
    const previous = byId.get(contact.id);
    if (!previous || Object.entries(contact).some(([key, value]) => previous[key] !== value)) {
      byId.set(contact.id, { ...(previous || {}), ...contact });
      changed = true;
    }
  }
  return changed ? [...byId.values()] : current;
}

export default function FollowUpQueuePage() {
  const {
    tasks,
    contacts,
    allContacts,
    employees,
    accessibleBusinessUnits,
    currentBusinessUnitId,
    currentBusinessUnit,
    currentUser,
    access,
    dataSource,
    scopeLabel,
    addTask,
    updateTask,
    leanShellIsDeferred,
  } = useCRM();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const coordinatorUiPolicy = useMemo(() => coordinatorUiPolicyForUser(currentUser), [currentUser]);
  const canReviewArchiveApprovalTasks = useMemo(() => canReviewArchiveApprovals(currentUser), [currentUser]);
  const canReviewTaskRemovalApprovalTasks = useMemo(
    () => canReviewTaskRemovalApprovals(currentUser),
    [currentUser],
  );
  const lockedTaskOwnerFilter = coordinatorUiPolicy.ownerScoped && currentUser?.id ? '__me' : '';
  const prefillSignatureRef = useRef('');
  const newTaskTriggerRef = useRef(null);
  const createFormRef = useRef(null);
  const createDiscardConfirmedRef = useRef(false);
  const [queueTasks, setQueueTasks] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [filters, setFilters] = useState({
    due: DUE_OPTION_VALUES.has(searchParams.get('due')) ? searchParams.get('due') : 'open',
    ownerUserId: lockedTaskOwnerFilter || searchParams.get('ownerUserId') || (searchParams.get('mine') === 'true' ? '__me' : 'all'),
    businessUnitId: searchParams.get('businessUnitId') || routeBusinessUnitFilterForGlobalScope(currentBusinessUnitId),
    taskType: TASK_TYPE_OPTIONS.some(([value]) => value === searchParams.get('taskType')) ? searchParams.get('taskType') : 'all',
    status: STATUS_OPTION_VALUES.has(searchParams.get('status')) ? searchParams.get('status') : 'all',
    link: LINK_OPTION_VALUES.has(searchParams.get('link')) ? searchParams.get('link') : 'all',
  });
  const [loading, setLoading] = useState(dataSource === 'postgres');
  const [error, setError] = useState('');
  const [busyTaskId, setBusyTaskId] = useState('');
  const [completionTaskId, setCompletionTaskId] = useState('');
  const [followUpDrafts, setFollowUpDrafts] = useState({});
  const [archiveDecisionDrafts, setArchiveDecisionDrafts] = useState({});
  const [removalDecisionDrafts, setRemovalDecisionDrafts] = useState({});
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createDraft, setCreateDraft] = useState(() => defaultCreateDraft({
    currentBusinessUnitId,
    accessibleBusinessUnits,
    currentUser,
  }));
  const [createInitialDraft, setCreateInitialDraft] = useState(() => defaultCreateDraft({
    currentBusinessUnitId,
    accessibleBusinessUnits,
    currentUser,
  }));
  const [createContactSearch, setCreateContactSearch] = useState('');
  const [editContactSearch, setEditContactSearch] = useState('');
  const [taskContacts, setTaskContacts] = useState(() => allContacts?.length ? allContacts : contacts);
  const [taskContactsLoading, setTaskContactsLoading] = useState(false);
  const [taskContactsError, setTaskContactsError] = useState('');
  const [createDiscardConfirmationOpen, setCreateDiscardConfirmationOpen] = useState(false);
  const [editTaskId, setEditTaskId] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const [editDraft, setEditDraft] = useState(() => editDraftFromTask({}));
  const [actionPanelTaskId, setActionPanelTaskId] = useState('');
  const [confirmTaskAction, setConfirmTaskAction] = useState(null);
  const [cancellationDraft, setCancellationDraft] = useState(null);

  const fallbackAssignees = useMemo(() => {
    const mappedEmployees = (employees || []).map((employee) => ({
      id: employee.id,
      name: employee.name,
      email: employee.email || '',
    }));
    if (
      !currentUser?.id ||
      mappedEmployees.some((employee) => employee.id === currentUser.id) ||
      !isAssignableEmployee(currentUser)
    ) {
      return mappedEmployees;
    }
    return [
      { id: currentUser.id, name: currentUser.name || currentUser.email || 'Me', email: currentUser.email || '' },
      ...mappedEmployees,
    ];
  }, [currentUser, employees]);

  const visibleAssignees = useMemo(() => {
    const options = assignees.length ? assignees : fallbackAssignees;
    if (!coordinatorUiPolicy.ownerScoped || !currentUser?.id) return options;
    const current = options.find((user) => user.id === currentUser.id) || {
      id: currentUser.id,
      name: currentUser.name || currentUser.email || 'Me',
      email: currentUser.email || '',
    };
    return [current];
  }, [assignees, coordinatorUiPolicy.ownerScoped, currentUser, fallbackAssignees]);
  const accessibleContacts = leanShellIsDeferred
    ? taskContacts
    : allContacts?.length ? allContacts : contacts;
  const businessUnitById = useMemo(
    () => new Map((accessibleBusinessUnits || []).map((unit) => [unit.id, unit])),
    [accessibleBusinessUnits],
  );
  const accessibleBusinessUnitIds = useMemo(
    () => new Set((accessibleBusinessUnits || []).map((unit) => unit.id)),
    [accessibleBusinessUnits],
  );
  const contactOptionsForBusinessUnit = useCallback((businessUnitId) => {
    return (accessibleContacts || [])
      .filter((contact) => {
        const contactBusinessUnitId = contact.businessUnitId || contact.primaryBusinessUnitId || '';
        if (!contactBusinessUnitId) return false;
        if (!accessibleBusinessUnitIds.has(contactBusinessUnitId)) return false;
        return !businessUnitId || contactBusinessUnitId === businessUnitId;
      })
      .map((contact) => {
        const businessUnitId = contact.businessUnitId || contact.primaryBusinessUnitId || '';
        const bucket = lifecycleBucket(contact);
        const status = contact.currentStage || contact.status || '';
        const context = [
          businessUnitById.get(businessUnitId)?.name || contact.businessUnitName || contact.divisionLabel || '',
          bucket.label,
          status && status !== bucket.label ? status : '',
        ].filter(Boolean);
        const name = contact.name || contact.client || 'Unnamed contact';
        const channel = contact.phone || contact.email || 'No contact channel';
        return {
          contact,
          label: [name, channel, ...context].filter(Boolean).join(' - '),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [accessibleBusinessUnitIds, accessibleContacts, businessUnitById]);

  const contactOptions = useMemo(
    () => contactOptionsForBusinessUnit(createDraft.businessUnitId),
    [contactOptionsForBusinessUnit, createDraft.businessUnitId],
  );
  const visibleContactOptions = useMemo(() => {
    const query = createContactSearch.trim().toLowerCase();
    const selected = contactOptions.find(({ contact }) => contact.id === createDraft.contactId);
    const matches = query
      ? contactOptions.filter(({ label, contact }) => {
          return [
            label,
            contact.email,
            contact.phone,
            contact.status,
            contact.currentStage,
          ]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query));
        })
      : contactOptions;
    const limited = matches.slice(0, 35);
    if (selected && !limited.some(({ contact }) => contact.id === selected.contact.id)) {
      return [selected, ...limited];
    }
    return limited;
  }, [contactOptions, createContactSearch, createDraft.contactId]);

  const editContactOptions = useMemo(
    () => contactOptionsForBusinessUnit(editDraft.businessUnitId),
    [contactOptionsForBusinessUnit, editDraft.businessUnitId],
  );
  const visibleEditContactOptions = useMemo(() => {
    const query = editContactSearch.trim().toLowerCase();
    if (!query) return editContactOptions.slice(0, 35);
    const selected = editContactOptions.find(({ contact }) => contact.id === editDraft.contactId);
    const matches = editContactOptions.filter(({ label, contact }) => [
      label,
      contact.email,
      contact.phone,
      contact.status,
      contact.currentStage,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query)));
    const limited = matches.slice(0, 35);
    if (selected && !limited.some(({ contact }) => contact.id === selected.contact.id)) {
      return [selected, ...limited];
    }
    return limited;
  }, [editContactOptions, editContactSearch, editDraft.contactId]);
  const selectedCreateContact = useMemo(
    () => (accessibleContacts || []).find((contact) => contact.id === createDraft.contactId) || null,
    [accessibleContacts, createDraft.contactId],
  );
  const selectedEditContact = useMemo(
    () => (accessibleContacts || []).find((contact) => contact.id === editDraft.contactId) || null,
    [accessibleContacts, editDraft.contactId],
  );

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setFilters((prev) => syncRouteBusinessUnitFilter(prev, currentBusinessUnitId));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentBusinessUnitId]);

  const readTasks = useCallback(async () => {
    if (dataSource !== 'postgres') {
      setQueueTasks((tasks || []).map((task) => normalizeTask(task, contacts)));
      setAssignees(fallbackAssignees);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (filters.businessUnitId !== 'all') params.set('businessUnitId', filters.businessUnitId);
    if (filters.ownerUserId !== 'all' && filters.ownerUserId !== 'unassigned') {
      params.set('ownerUserId', filters.ownerUserId === '__me' ? currentUser?.id || '' : filters.ownerUserId);
    }
    if (filters.ownerUserId === 'unassigned') params.set('unassigned', 'true');
    if (filters.taskType !== 'all') params.set('taskType', filters.taskType);
    if (filters.status !== 'all') params.set('status', filters.status);

    try {
      const response = await fetch(`/api/tasks?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Task queue could not load.');
      if (leanShellIsDeferred) {
        setTaskContacts((current) => mergeContactsById(current, payload.contacts || []));
      }
      setQueueTasks((payload.tasks || []).map((task) => normalizeTask(task, payload.contacts || [])));
      setAssignees(payload.users || []);
    } catch (err) {
      setError(err.message || 'Task queue could not load.');
    } finally {
      setLoading(false);
    }
  }, [contacts, currentUser?.id, dataSource, fallbackAssignees, filters.businessUnitId, filters.ownerUserId, filters.status, filters.taskType, leanShellIsDeferred, tasks]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) readTasks();
    });
    return () => {
      cancelled = true;
    };
  }, [readTasks]);

  useEffect(() => {
    if (!leanShellIsDeferred || !createOpen) return undefined;
    const search = createContactSearch.trim();
    const selectedName = selectedCreateContact?.name || '';
    const searchRepresentsSelected = Boolean(createDraft.contactId && selectedName && search.includes(selectedName));
    if (search.length === 1) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setTaskContactsLoading(true);
      setTaskContactsError('');
      fetchTaskContactOptions({
        businessUnitId: createDraft.businessUnitId,
        query: search && !searchRepresentsSelected ? search : '',
        contactId: searchRepresentsSelected ? createDraft.contactId : '',
        signal: controller.signal,
      })
        .then((rows) => setTaskContacts((current) => mergeContactsById(current, rows)))
        .catch((error) => {
          if (error?.name !== 'AbortError') setTaskContactsError(error.message || 'Task contacts could not load.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setTaskContactsLoading(false);
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [createContactSearch, createDraft.businessUnitId, createDraft.contactId, createOpen, leanShellIsDeferred, selectedCreateContact?.name]);

  useEffect(() => {
    if (!leanShellIsDeferred || !editTaskId) return undefined;
    const selectedName = selectedEditContact?.name || '';
    const search = editContactSearch.trim();
    if (search.length === 1) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setTaskContactsLoading(true);
      setTaskContactsError('');
      fetchTaskContactOptions({
        businessUnitId: editDraft.businessUnitId,
        query: search && search !== selectedName ? search : '',
        contactId: !search || search === selectedName ? editDraft.contactId : '',
        signal: controller.signal,
      })
        .then((rows) => setTaskContacts((current) => mergeContactsById(current, rows)))
        .catch((error) => {
          if (error?.name !== 'AbortError') setTaskContactsError(error.message || 'Task contacts could not load.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setTaskContactsLoading(false);
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [editContactSearch, editDraft.businessUnitId, editDraft.contactId, editTaskId, leanShellIsDeferred, selectedEditContact?.name]);

  useEffect(() => {
    if (!leanShellIsDeferred) return undefined;
    const contactId = searchParams.get('contactId') || '';
    if (!contactId || taskContacts.some((contact) => contact.id === contactId)) return undefined;
    const controller = new AbortController();
    fetchTaskContactOptions({ contactId, signal: controller.signal })
      .then((rows) => setTaskContacts((current) => mergeContactsById(current, rows)))
      .catch((error) => {
        if (error?.name !== 'AbortError') setTaskContactsError(error.message || 'Task contact could not load.');
      });
    return () => controller.abort();
  }, [leanShellIsDeferred, searchParams, taskContacts]);

  const filteredTasks = useMemo(() => {
    return queueTasks
      .filter((task) => taskMatchesDue(task, filters.due))
      .filter((task) => filters.ownerUserId === 'all' || filters.ownerUserId === 'unassigned' || task.ownerUserId === (filters.ownerUserId === '__me' ? currentUser?.id : filters.ownerUserId))
      .filter((task) => filters.ownerUserId !== 'unassigned' || !task.ownerUserId)
      .filter((task) => filters.businessUnitId === 'all' || task.businessUnitId === filters.businessUnitId)
      .filter((task) => filters.taskType === 'all' || task.taskType === filters.taskType)
      .filter((task) => filters.status === 'all' || task.status === filters.status)
      .filter((task) => {
        if (filters.link === 'contact') return Boolean(task.contactId);
        if (filters.link === 'unlinked') return !task.contactId;
        if (filters.link === 'recurring') return Boolean(task.recurrence);
        return true;
      })
      .sort((a, b) => {
        const aKey = dateKey(a.dueAt) || '9999-12-31';
        const bKey = dateKey(b.dueAt) || '9999-12-31';
        if (aKey !== bKey) return aKey.localeCompare(bKey);
        return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });
  }, [currentUser?.id, filters, queueTasks]);

  const completedTodayTasks = useMemo(() => {
    return queueTasks
      .filter((task) => isTaskCompletedToday(task, todayKey()))
      .filter((task) => filters.ownerUserId === 'all' || filters.ownerUserId === 'unassigned' || task.ownerUserId === (filters.ownerUserId === '__me' ? currentUser?.id : filters.ownerUserId))
      .filter((task) => filters.ownerUserId !== 'unassigned' || !task.ownerUserId)
      .filter((task) => filters.businessUnitId === 'all' || task.businessUnitId === filters.businessUnitId)
      .filter((task) => filters.taskType === 'all' || task.taskType === filters.taskType)
      .filter((task) => {
        if (filters.link === 'contact') return Boolean(task.contactId);
        if (filters.link === 'unlinked') return !task.contactId;
        if (filters.link === 'recurring') return Boolean(task.recurrence);
        return true;
      })
      .sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
  }, [currentUser?.id, filters.businessUnitId, filters.link, filters.ownerUserId, filters.taskType, queueTasks]);

  const unassignedLeadFollowUps = useMemo(
    () => queueTasks.filter(isUnassignedInboundLeadFollowUp),
    [queueTasks],
  );

  const unassignedFacebookFollowUps = useMemo(
    () => unassignedLeadFollowUps.filter(isFacebookLeadFollowUp),
    [unassignedLeadFollowUps],
  );

  const stats = useMemo(() => {
    const today = todayKey();
    const currentWork = queueTasks.filter((task) => isTaskCurrentWork(task, today)).length;
    const dueToday = queueTasks.filter((task) => isTaskDueToday(task, today)).length;
    const overdue = queueTasks.filter((task) => isTaskOverdue(task, today)).length;
    const completedToday = queueTasks.filter((task) => isTaskCompletedToday(task, today)).length;
    const unassigned = queueTasks.filter((task) => isTaskOpen(task) && !task.ownerUserId).length;
    return { currentWork, dueToday, overdue, unassigned, completedToday };
  }, [queueTasks]);

  const showUnassignedLeadFollowUps = () => setFilters((prev) => ({
    ...prev,
    due: 'open',
    ownerUserId: coordinatorUiPolicy.ownerScoped ? '__me' : 'unassigned',
    taskType: 'follow_up',
    status: 'open',
    link: 'contact',
  }));

  async function applyTaskAction(task, action, payload = {}) {
    if (!access.canWriteCrm) return;
    setBusyTaskId(task.id);
    setError('');
    let createdNextTask = false;
    let cancellationApprovalRequested = false;
    try {
      if (dataSource === 'postgres') {
        const response = await fetch('/api/tasks', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: task.id, action, ...payload }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Task update failed.');
        cancellationApprovalRequested = Boolean(result.approvalRequested);
        const nextTask = normalizeTask(result.task, contacts);
        setQueueTasks((prev) => prev.map((row) => (row.id === task.id ? nextTask : row)));
        if (result.targetTask) {
          const normalizedTargetTask = normalizeTask(result.targetTask, contacts);
          setQueueTasks((prev) => prev.map((row) => (row.id === normalizedTargetTask.id ? normalizedTargetTask : row)));
        }
        if (result.nextTask) {
          createdNextTask = true;
          const normalizedNextTask = normalizeTask(result.nextTask, contacts);
          setQueueTasks((prev) => [normalizedNextTask, ...prev]);
          addTask({
            ...normalizedNextTask,
            taskStatus: normalizedNextTask.status,
            completed: normalizedNextTask.status === 'completed',
            assignedTo: normalizedNextTask.ownerUserId,
            dueDate: dateKey(normalizedNextTask.dueAt),
          });
        }
        updateTask(task.id, {
          taskStatus: nextTask.status,
          status: nextTask.status,
          completed: nextTask.status === 'completed',
          assignedTo: nextTask.ownerUserId,
          ownerUserId: nextTask.ownerUserId,
          dueDate: dateKey(nextTask.dueAt),
          dueAt: nextTask.dueAt,
          metadataJson: nextTask.metadataJson,
        });
      } else {
        const localPatch = {
          ...(action === 'complete' ? { completed: true, status: 'completed', taskStatus: 'completed' } : {}),
          ...(action === 'snooze' ? { dueDate: dateKey(payload.snoozedUntil), dueAt: payload.snoozedUntil, status: 'snoozed', taskStatus: 'snoozed' } : {}),
          ...(action === 'assign' ? { assignedTo: payload.ownerUserId || '', ownerUserId: payload.ownerUserId || '' } : {}),
          ...(action === 'cancel' ? { status: 'canceled', taskStatus: 'canceled', canceledAt: new Date().toISOString() } : {}),
        };
        updateTask(task.id, localPatch);
        setQueueTasks((prev) => prev.map((row) => (row.id === task.id ? normalizeTask({ ...row, ...localPatch }, contacts) : row)));
      }
      toast(action === 'approve_archive'
        ? 'Archive request approved'
        : action === 'deny_archive'
          ? 'Archive request denied'
          : action === 'approve_task_removal'
            ? 'Task removal approved'
            : action === 'deny_task_removal'
              ? 'Task removal denied'
              : action === 'request_cancel' || action === 'request_removal'
                ? 'Task removal requested'
                : action === 'cancel'
                  ? cancellationApprovalRequested
                    ? 'Task cancellation requested'
                    : 'Task canceled'
                  : action === 'complete'
                    ? task.taskType === 'follow_up'
                      ? createdNextTask
                        ? 'Follow-up completed · next task scheduled'
                        : 'Follow-up completed · no next task scheduled'
                      : 'Task completed'
                    : action === 'snooze'
                      ? 'Task snoozed'
                      : 'Task assigned');
      if (action === 'complete') {
        setCompletionTaskId('');
        setFollowUpDrafts((prev) => {
          const next = { ...prev };
          delete next[task.id];
          return next;
        });
      }
      if (action === 'approve_archive' || action === 'deny_archive') {
        setArchiveDecisionDrafts((prev) => {
          const next = { ...prev };
          delete next[task.id];
          return next;
        });
      }
      if (action === 'approve_task_removal' || action === 'deny_task_removal') {
        setRemovalDecisionDrafts((prev) => {
          const next = { ...prev };
          delete next[task.id];
          return next;
        });
      }
      return true;
    } catch (err) {
      setError(err.message || 'Task update failed.');
      toast(err.message || 'Task update failed.');
      return false;
    } finally {
      setBusyTaskId('');
    }
  }

  function followUpDraft(taskId, task = null) {
    const contact = accessibleContacts.find((row) => row.id === task?.contactId);
    const savedDraft = followUpDrafts[taskId] || {};
    const leadProfile = {
      programInterest: contact?.programInterest || '',
      preferredDay: contact?.preferredDay || '',
      preferredSchedule: contact?.preferredSchedule || '',
      testInterest: contact?.testInterest || '',
      educationLevel: contact?.educationLevel || '',
      schoolName: contact?.schoolName || '',
      locationPreference: contact?.locationPreference || '',
      ...(savedDraft.leadProfile || {}),
    };
    return {
      outcome: 'reached_interested',
      channel: 'phone',
      contactMethod: '',
      note: '',
      nextDueDate: '',
      nextOwnerUserId: task?.ownerUserId || defaultOwnerUserId(currentUser, visibleAssignees),
      ...savedDraft,
      leadProfile,
    };
  }

  function updateFollowUpDraft(taskId, patch) {
    setFollowUpDrafts((prev) => ({
      ...prev,
      [taskId]: {
        outcome: 'reached_interested',
        channel: 'phone',
        contactMethod: '',
        note: '',
        nextDueDate: '',
        leadProfile: {},
        ...(prev[taskId] || {}),
        ...patch,
      },
    }));
  }

  function updateFollowUpLeadProfile(taskId, field, value) {
    setFollowUpDrafts((prev) => ({
      ...prev,
      [taskId]: {
        outcome: 'reached_interested',
        channel: 'phone',
        contactMethod: '',
        note: '',
        nextDueDate: '',
        ...(prev[taskId] || {}),
        leadProfile: {
          ...(prev[taskId]?.leadProfile || {}),
          [field]: value,
        },
      },
    }));
  }

  function openCreatePanel(overrides = {}) {
    const baseDraft = defaultCreateDraft({ currentBusinessUnitId, accessibleBusinessUnits, currentUser });
    const scopedTaskType = taskTypeForFilter(filters.taskType);
    const scopedOwner = ownerForFilter(filters.ownerUserId, currentUser, visibleAssignees);
    const scopedBusinessUnit = filters.businessUnitId && filters.businessUnitId !== 'all'
      ? filters.businessUnitId
      : '';
    const nextDraft = {
      ...baseDraft,
      taskType: scopedTaskType || baseDraft.taskType,
      dueDate: dueDateForFilter(filters.due),
      businessUnitId: scopedBusinessUnit || baseDraft.businessUnitId,
      ownerUserId: scopedOwner || baseDraft.ownerUserId || defaultOwnerUserId(currentUser, visibleAssignees),
      ...overrides,
      ownerUserId: coordinatorUiPolicy.lockedOwnerUserId ||
        overrides.ownerUserId ||
        scopedOwner ||
        baseDraft.ownerUserId ||
        defaultOwnerUserId(currentUser, visibleAssignees),
    };
    setCreateDraft(nextDraft);
    setCreateInitialDraft(nextDraft);
    setCreateContactSearch('');
    setCreateError('');
    createDiscardConfirmedRef.current = false;
    setCreateDiscardConfirmationOpen(false);
    setCreateOpen(true);
  }

  function updateCreateDraft(patch) {
    setCreateDraft((prev) => ({ ...prev, ...patch }));
    if (createError) setCreateError('');
  }

  function updateCreateBusinessUnit(businessUnitId) {
    setCreateDraft((prev) => {
      const selectedContact = (accessibleContacts || []).find((contact) => contact.id === prev.contactId);
      const contactBusinessUnitId = selectedContact?.businessUnitId || selectedContact?.primaryBusinessUnitId || '';
      return {
        ...prev,
        businessUnitId,
        contactId: contactBusinessUnitId === businessUnitId ? prev.contactId : '',
      };
    });
    setCreateContactSearch('');
    if (createError) setCreateError('');
  }

  function updateCreateContact(contactId) {
    const selectedContact = (accessibleContacts || []).find((contact) => contact.id === contactId);
    const businessUnitId = selectedContact?.businessUnitId || selectedContact?.primaryBusinessUnitId || createDraft.businessUnitId;
    const selectedOption = contactOptions.find(({ contact }) => contact.id === contactId);
    setCreateDraft((prev) => ({
      ...prev,
      contactId,
      businessUnitId,
    }));
    setCreateContactSearch(selectedOption?.label || '');
    if (createError) setCreateError('');
  }

  function openEditPanel(task) {
    setEditTaskId(task.id);
    setEditDraft(editDraftFromTask(task));
    setEditContactSearch(task.contactName || '');
    setEditError('');
    setCompletionTaskId('');
    setActionPanelTaskId(task.id);
  }

  function updateEditDraft(patch) {
    setEditDraft((prev) => ({ ...prev, ...patch }));
  }

  function updateEditBusinessUnit(businessUnitId) {
    setEditDraft((prev) => {
      const selectedContact = (accessibleContacts || []).find((contact) => contact.id === prev.contactId);
      const contactBusinessUnitId = selectedContact?.businessUnitId || selectedContact?.primaryBusinessUnitId || '';
      return {
        ...prev,
        businessUnitId,
        contactId: contactBusinessUnitId === businessUnitId ? prev.contactId : '',
      };
    });
    setEditContactSearch('');
  }

  function updateEditContact(contactId) {
    const selectedContact = (accessibleContacts || []).find((contact) => contact.id === contactId);
    const businessUnitId = selectedContact?.businessUnitId || selectedContact?.primaryBusinessUnitId || editDraft.businessUnitId;
    setEditDraft((prev) => ({
      ...prev,
      contactId,
      businessUnitId,
    }));
    setEditContactSearch(selectedContact?.name || '');
  }

  useEffect(() => {
    let cancelled = false;
    const contactId = searchParams.get('contactId') || '';
    if (!contactId) return undefined;
    const taskTypeParam = searchParams.get('taskType') || '';
    const signature = `${contactId}:${taskTypeParam}`;
    if (prefillSignatureRef.current === signature) return undefined;
    const selectedContact = (accessibleContacts || []).find((contact) => contact.id === contactId);
    if (!selectedContact) return undefined;

    const businessUnitId = selectedContact.businessUnitId ||
      selectedContact.primaryBusinessUnitId ||
      defaultBusinessUnitId(currentBusinessUnitId, accessibleBusinessUnits);
    const taskType = TASK_CREATE_TYPE_OPTIONS.some(([value]) => value === taskTypeParam)
      ? taskTypeParam
      : 'follow_up';
    prefillSignatureRef.current = signature;
    queueMicrotask(() => {
      if (cancelled) return;
      const nextDraft = {
        ...defaultCreateDraft({ currentBusinessUnitId, accessibleBusinessUnits, currentUser }),
        title: `${taskType === 'first_outreach' ? 'First outreach' : 'Follow up'} - ${selectedContact.name || selectedContact.client || 'contact'}`,
        taskType,
        businessUnitId,
        contactId,
        ownerUserId: selectedContact.assignedTo || defaultOwnerUserId(currentUser, visibleAssignees),
        ...(coordinatorUiPolicy.lockedOwnerUserId ? { ownerUserId: coordinatorUiPolicy.lockedOwnerUserId } : {}),
      };
      setCreateDraft(nextDraft);
      setCreateInitialDraft(nextDraft);
      setCreateContactSearch(selectedContact.name || selectedContact.client || '');
      setCreateError('');
      createDiscardConfirmedRef.current = false;
      setCreateDiscardConfirmationOpen(false);
      setCreateOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, [accessibleBusinessUnits, accessibleContacts, coordinatorUiPolicy.lockedOwnerUserId, currentBusinessUnitId, currentUser, searchParams, visibleAssignees]);

  async function submitCreatedTask(event) {
    event.preventDefault();
    if (!access.canWriteCrm || createBusy) return;
    const title = createDraft.title.trim();
    if (!title) {
      showCreateValidationError('Task title is required.', 'title');
      return;
    }
    if (!createDraft.ownerUserId) {
      showCreateValidationError('Task owner is required.', 'ownerUserId');
      return;
    }
    if (!createDraft.dueDate) {
      showCreateValidationError('Task due date is required.', 'dueDate');
      return;
    }
    if (!createDraft.businessUnitId) {
      showCreateValidationError(`${scopeLabel} is required.`, 'businessUnitId');
      return;
    }

    setCreateBusy(true);
    setCreateError('');
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title,
          description: createDraft.description,
          taskType: createDraft.taskType,
          dueAt: dateInputToIso(createDraft.dueDate),
          ownerUserId: createDraft.ownerUserId || null,
          ...(coordinatorUiPolicy.lockedOwnerUserId ? { ownerUserId: coordinatorUiPolicy.lockedOwnerUserId } : {}),
          businessUnitId: createDraft.businessUnitId,
          contactId: createDraft.contactId || null,
          priority: createDraft.priority,
          recurrence: { frequency: createDraft.recurrenceFrequency },
          sourceType: 'manual',
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Task creation failed.');
      const nextTask = normalizeTask(payload.task, accessibleContacts);
      setQueueTasks((prev) => [nextTask, ...prev.filter((task) => task.id !== nextTask.id)]);
      setCreateDraft(defaultCreateDraft({ currentBusinessUnitId, accessibleBusinessUnits, currentUser }));
      setCreateContactSearch('');
      setCreateDiscardConfirmationOpen(false);
      setCreateOpen(false);
      toast('Task created');
    } catch (err) {
      const message = err.message || 'Task creation failed.';
      setCreateError(message);
      toast(message);
    } finally {
      setCreateBusy(false);
    }
  }

  async function submitEditedTask(event) {
    event.preventDefault();
    if (!access.canWriteCrm || editBusy || !editTaskId) return;
    const title = editDraft.title.trim();
    if (!title) {
      setEditError('Task title is required.');
      return;
    }
    if (!editDraft.dueDate) {
      setEditError('Task due date is required.');
      return;
    }
    if (!editDraft.ownerUserId) {
      setEditError('Task owner is required.');
      return;
    }
    if (!editDraft.businessUnitId) {
      setEditError(`${scopeLabel} is required.`);
      return;
    }

    setEditBusy(true);
    setEditError('');
    try {
      if (dataSource === 'postgres') {
        const response = await fetch('/api/tasks', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: editTaskId,
            action: 'update',
            title,
            description: editDraft.description,
            taskType: editDraft.taskType,
            dueAt: dateInputToIso(editDraft.dueDate),
            ownerUserId: editDraft.ownerUserId || null,
            ...(coordinatorUiPolicy.lockedOwnerUserId ? { ownerUserId: coordinatorUiPolicy.lockedOwnerUserId } : {}),
            businessUnitId: editDraft.businessUnitId,
            contactId: editDraft.contactId || null,
            priority: editDraft.priority,
            recurrence: { frequency: editDraft.recurrenceFrequency },
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Task update failed.');
        const nextTask = normalizeTask(payload.task, accessibleContacts);
        setQueueTasks((prev) => prev.map((task) => (task.id === nextTask.id ? nextTask : task)));
        updateTask(editTaskId, {
          ...nextTask,
          assignedTo: nextTask.ownerUserId,
          dueDate: dateKey(nextTask.dueAt),
          taskStatus: nextTask.status,
          completed: nextTask.status === 'completed',
        });
      } else {
        const localPatch = {
          title,
          description: editDraft.description,
          taskType: editDraft.taskType,
          dueAt: dateInputToIso(editDraft.dueDate),
          dueDate: editDraft.dueDate,
          ownerUserId: coordinatorUiPolicy.lockedOwnerUserId || editDraft.ownerUserId || '',
          assignedTo: coordinatorUiPolicy.lockedOwnerUserId || editDraft.ownerUserId || '',
          businessUnitId: editDraft.businessUnitId,
          contactId: editDraft.contactId || '',
          priority: editDraft.priority,
          metadataJson: editDraft.recurrenceFrequency === 'none'
            ? {}
            : { recurrence: { frequency: editDraft.recurrenceFrequency, anchorDate: dateInputToIso(editDraft.dueDate), active: true, source: 'manual' } },
        };
        updateTask(editTaskId, localPatch);
        setQueueTasks((prev) => prev.map((task) => (task.id === editTaskId ? normalizeTask({ ...task, ...localPatch }, contacts) : task)));
      }
      setEditTaskId('');
      toast('Task updated');
    } catch (err) {
      const message = err.message || 'Task update failed.';
      setEditError(message);
      toast(message);
    } finally {
      setEditBusy(false);
    }
  }

  async function submitFollowUpCompletion(task) {
    const draft = followUpDraft(task.id, task);
    await applyTaskAction(task, 'complete', {
      outcome: draft.outcome,
      channel: draft.channel,
      contactMethod: draft.contactMethod,
      note: draft.note,
      leadProfile: draft.leadProfile,
      nextDueAt: dateInputToIso(draft.nextDueDate),
      nextOwnerUserId: draft.nextOwnerUserId || task.ownerUserId || null,
      ...(coordinatorUiPolicy.lockedOwnerUserId ? { nextOwnerUserId: coordinatorUiPolicy.lockedOwnerUserId } : {}),
    });
  }

  function openTaskActionPanel(taskId) {
    setActionPanelTaskId((current) => (current === taskId ? '' : taskId));
  }

  function showCreateValidationError(message, fieldName) {
    setCreateError(message);
    window.requestAnimationFrame(() => {
      createFormRef.current?.elements.namedItem(fieldName)?.focus();
    });
  }

  function closeCreateDialog() {
    if (createBusy) return;
    const isDirty = CREATE_DRAFT_FIELDS.some((field) => createDraft[field] !== createInitialDraft[field]);
    if (isDirty) {
      createDiscardConfirmedRef.current = false;
      setCreateOpen(false);
      setCreateDiscardConfirmationOpen(true);
      return;
    }
    setCreateOpen(false);
  }

  function discardCreateDraft() {
    createDiscardConfirmedRef.current = true;
    setCreateError('');
  }

  function closeCreateDiscardConfirmation() {
    setCreateDiscardConfirmationOpen(false);
    if (!createDiscardConfirmedRef.current) setCreateOpen(true);
    createDiscardConfirmedRef.current = false;
  }

  function toggleFollowUpCompletion(taskId) {
    const nextTaskId = completionTaskId === taskId ? '' : taskId;
    setError('');
    setCompletionTaskId(nextTaskId);
    if (nextTaskId) setEditTaskId((currentEditTaskId) => (currentEditTaskId === taskId ? '' : currentEditTaskId));
  }

  function queueTaskActionConfirmation(task, action, payload = {}) {
    const isComplete = action === 'complete';
    const isRequest = action === 'request_cancel';
    setConfirmTaskAction({
      task,
      action,
      payload,
      title: isComplete
        ? 'Complete this task?'
        : isRequest
          ? 'Request task cancellation?'
          : 'Cancel this task?',
      message: isComplete
        ? `This will mark "${task.title || 'this task'}" completed. Review the task details before confirming.`
        : isRequest
          ? `This will send "${task.title || 'this task'}" for cancellation approval instead of removing it immediately.`
          : `This will cancel "${task.title || 'this task'}" and remove it from current work.`,
      confirmLabel: isComplete
        ? 'Complete Task'
        : isRequest
          ? 'Request Cancel'
          : 'Cancel Task',
      variant: isComplete || isRequest ? 'primary' : 'danger',
    });
  }

  function confirmQueuedTaskAction() {
    const queuedAction = confirmTaskAction;
    if (!queuedAction) return;
    setConfirmTaskAction(null);
    applyTaskAction(queuedAction.task, queuedAction.action, queuedAction.payload);
  }

  function openTaskCancellation(task) {
    const policy = task.cancellationPolicy || taskCancellationDecision({ session: { user: currentUser }, task });
    if (policy.decision === TASK_CANCELLATION_DECISIONS.FORBIDDEN) return;
    setError('');
    setActionPanelTaskId('');
    setCancellationDraft({ task, policy, reason: '' });
  }

  async function submitTaskCancellation() {
    if (!cancellationDraft?.task) return;
    const reason = String(cancellationDraft.reason || '').trim();
    if (!reason) return;
    const succeeded = await applyTaskAction(cancellationDraft.task, 'cancel', { reason });
    if (succeeded) setCancellationDraft(null);
  }

  function openArchiveDecision(task, decision) {
    if (!canReviewArchiveApprovalTasks) return;
    setActionPanelTaskId('');
    setRemovalDecisionDrafts({});
    setArchiveDecisionDrafts({
      [task.id]: {
        decision,
        reason: decision === 'approve'
          ? task.metadataJson?.requestedReason || 'Archive request approved.'
          : '',
      },
    });
  }

  async function submitArchiveDecision(task) {
    const draft = archiveDecisionDrafts[task.id] || {};
    if (!draft.decision) return;
    await applyTaskAction(task, draft.decision === 'approve' ? 'approve_archive' : 'deny_archive', {
      reason: String(draft.reason || '').trim(),
    });
  }

  function openRemovalDecision(task, decision) {
    if (!canReviewTaskRemovalApprovalTasks) return;
    setError('');
    setActionPanelTaskId('');
    setArchiveDecisionDrafts({});
    setRemovalDecisionDrafts({
      [task.id]: {
        decision,
        reason: decision === 'approve'
          ? task.metadataJson?.requestedReason || 'Task cancellation approved.'
          : '',
      },
    });
  }

  async function submitRemovalDecision(task) {
    const draft = removalDecisionDrafts[task.id] || {};
    if (!draft.decision) return;
    await applyTaskAction(task, draft.decision === 'approve' ? 'approve_task_removal' : 'deny_task_removal', {
      reason: String(draft.reason || '').trim(),
    });
  }

  const resetFilters = () => setFilters({
    due: 'open',
    ownerUserId: lockedTaskOwnerFilter || 'all',
    businessUnitId: routeBusinessUnitFilterForGlobalScope(currentBusinessUnitId),
    taskType: 'all',
    status: 'all',
    link: 'all',
  });
  const showCancellationApprovals = () => setFilters((current) => ({
    ...current,
    due: 'open',
    ownerUserId: 'all',
    taskType: 'task_removal_approval',
    status: 'all',
    link: 'all',
  }));
  const activeTaskScope = (() => {
    const parts = [optionLabel(DUE_OPTIONS, filters.due)];
    if (filters.ownerUserId === '__me') {
      parts.push('My Tasks');
    } else if (filters.ownerUserId === 'unassigned') {
      parts.push('Unassigned');
    } else if (filters.ownerUserId !== 'all') {
      const owner = visibleAssignees.find((user) => user.id === filters.ownerUserId);
      parts.push(owner?.name || owner?.email || 'Selected owner');
    }
    if (filters.businessUnitId !== 'all') {
      parts.push(businessUnitById.get(filters.businessUnitId)?.name || currentBusinessUnit?.name || scopeLabel);
    } else if (currentBusinessUnit?.name) {
      parts.push(currentBusinessUnit.name);
    }
    if (filters.taskType !== 'all') parts.push(optionLabel(TASK_TYPE_OPTIONS, filters.taskType));
    if (filters.status !== 'all') parts.push(optionLabel(STATUS_OPTIONS, filters.status));
    if (filters.link !== 'all') parts.push(optionLabel(LINK_OPTIONS, filters.link));
    return parts.filter(Boolean).join(' · ');
  })();
  const archiveDecisionTaskId = Object.keys(archiveDecisionDrafts)[0] || '';
  const activeArchiveDecisionDraft = archiveDecisionTaskId ? archiveDecisionDrafts[archiveDecisionTaskId] : null;
  const activeArchiveDecisionTask = archiveDecisionTaskId
    ? queueTasks.find((task) => task.id === archiveDecisionTaskId)
    : null;
  const removalDecisionTaskId = Object.keys(removalDecisionDrafts)[0] || '';
  const activeRemovalDecisionDraft = removalDecisionTaskId ? removalDecisionDrafts[removalDecisionTaskId] : null;
  const activeRemovalDecisionTask = removalDecisionTaskId
    ? queueTasks.find((task) => task.id === removalDecisionTaskId)
    : null;
  const activeFollowUpTask = completionTaskId
    ? queueTasks.find((task) => task.id === completionTaskId && task.taskType === 'follow_up')
    : null;
  const activeFollowUpDraft = activeFollowUpTask
    ? followUpDraft(activeFollowUpTask.id, activeFollowUpTask)
    : null;
  if (!access.canReadCrm) {
    return (
      <div className="fade-in">
        <div className="page-header">
          <div>
            <h1 className="page-title">Tasks</h1>
            <p className="page-subtitle">CRM read access is required.</p>
          </div>
        </div>
        <PageState
          tone="denied"
          title="Tasks require CRM read access"
          copy="Your account can keep using the CRM surfaces assigned to your role. Ask an administrator if tasks should be added to your access."
          actions={<PageStateAction href="/">Back to Dashboard</PageStateAction>}
        />
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tasks</h1>
          <p className="page-subtitle">
            {currentBusinessUnit?.name || `All ${scopeLabel}`} · {filteredTasks.length} shown · {completedTodayTasks.length} done today
          </p>
        </div>
        <div className="flex-gap">
          <button ref={newTaskTriggerRef} className="btn btn-sm btn-primary" type="button" onClick={() => openCreatePanel()} disabled={!access.canWriteCrm}>
            <Plus size={14} />
            New Task
          </button>
          <button className="btn btn-sm" onClick={readTasks} disabled={loading}>
            <RefreshCcw size={14} />
            Refresh
          </button>
        </div>
      </div>

      <Modal
        open={createOpen}
        onClose={closeCreateDialog}
        title="New Task"
        variant="dialog"
        panelClassName={s.createDialog}
        returnFocusRef={newTaskTriggerRef}
        footer={(
          <>
            <button className="btn btn-sm" type="button" disabled={createBusy} onClick={closeCreateDialog}>Cancel</button>
            <button className="btn btn-sm btn-primary" type="submit" form="new-task-form" disabled={createBusy || !access.canWriteCrm}>
              <Plus size={14} />
              Create Task
            </button>
          </>
        )}
      >
        <form id="new-task-form" ref={createFormRef} className={s.createForm} onSubmit={submitCreatedTask} noValidate>
          <div className={s.createIntro}>
            <p>Set the essentials, then leave the assignee the context they need.</p>
            <span className={s.createRequired}>* Required</span>
          </div>

          <section className={`${s.createSection} ${s.createWhat}`}>
            <div className={s.createSectionHeader}>
              <span className={s.createSectionIndex}>1</span>
              <div>
                <h2 className={s.createSectionTitle}>What</h2>
                <p className={s.createSectionCopy}>Name the work and set its urgency.</p>
              </div>
            </div>
            <label>
              <span className="form-label">Title *</span>
              <input
                className="input"
                name="title"
                value={createDraft.title}
                required
                aria-required="true"
                autoFocus
                disabled={createBusy}
                onChange={(event) => updateCreateDraft({ title: event.target.value })}
                placeholder="Call student about next step"
              />
            </label>
            <div className={s.createSplit}>
              <label>
                <span className="form-label">Task Type</span>
                <select className="select" value={createDraft.taskType} disabled={createBusy} onChange={(event) => updateCreateDraft({ taskType: event.target.value })}>
                  {TASK_CREATE_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>
                <span className="form-label">Priority</span>
                <select className="select" value={createDraft.priority} disabled={createBusy} onChange={(event) => updateCreateDraft({ priority: event.target.value })}>
                  {TASK_PRIORITY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>
          </section>

          <section className={`${s.createSection} ${s.createWho}`}>
            <div className={s.createSectionHeader}>
              <span className={s.createSectionIndex}>2</span>
              <div>
                <h2 className={s.createSectionTitle}>Who</h2>
                <p className={s.createSectionCopy}>Assign responsibility and keep the task in the right division.</p>
              </div>
            </div>
            {coordinatorUiPolicy.canManageCoordinatorAssignments ? (
              <label>
                <span className="form-label">Owner *</span>
                <select className="select" name="ownerUserId" value={createDraft.ownerUserId} disabled={createBusy} onChange={(event) => updateCreateDraft({ ownerUserId: event.target.value })}>
                  <option value="" disabled>Select owner</option>
                  {visibleAssignees.map((user) => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}
                </select>
              </label>
            ) : (
              <input type="hidden" value={coordinatorUiPolicy.lockedOwnerUserId || createDraft.ownerUserId} readOnly />
            )}
            <label>
              <span className="form-label">{scopeLabel} *</span>
              <select className="select" name="businessUnitId" value={createDraft.businessUnitId} disabled={createBusy} onChange={(event) => updateCreateBusinessUnit(event.target.value)}>
                {accessibleBusinessUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </select>
            </label>
          </section>

          <section className={`${s.createSection} ${s.createWhen}`}>
            <div className={s.createSectionHeader}>
              <span className={s.createSectionIndex}>3</span>
              <div>
                <h2 className={s.createSectionTitle}>When</h2>
                <p className={s.createSectionCopy}>Choose the first due date. Recurrence stays optional.</p>
              </div>
            </div>
            <div className={s.createSplit}>
              <label>
                <span className="form-label">Due Date *</span>
                <input
                  className="input"
                  name="dueDate"
                  type="date"
                  value={createDraft.dueDate}
                  required
                  disabled={createBusy}
                  onChange={(event) => updateCreateDraft({ dueDate: event.target.value })}
                />
              </label>
              <label>
                <span className="form-label">Repeats</span>
                <select className="select" value={createDraft.recurrenceFrequency} disabled={createBusy} onChange={(event) => updateCreateDraft({ recurrenceFrequency: event.target.value })}>
                  {TASK_RECURRENCE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>
          </section>

          <section className={`${s.createSection} ${s.createContext}`}>
            <div className={s.createSectionHeader}>
              <span className={s.createSectionIndex}>4</span>
              <div>
                <h2 className={s.createSectionTitle}>Context</h2>
                <p className={s.createSectionCopy}>Link the student or leave clear instructions for the assignee.</p>
              </div>
            </div>
            <label className={s.contactPicker}>
              <span className="form-label">Contact</span>
              <input
                className="input"
                value={createContactSearch}
                disabled={createBusy}
                onChange={(event) => setCreateContactSearch(event.target.value)}
                placeholder="Search name, phone, email, status, source, or location"
              />
              <select className="select" value={createDraft.contactId} disabled={createBusy} onChange={(event) => updateCreateContact(event.target.value)}>
                <option value="">No contact linked</option>
                {visibleContactOptions.map(({ contact, label }) => <option key={contact.id} value={contact.id}>{label}</option>)}
              </select>
              <span className={s.contactHint}>
                {taskContactsLoading
                  ? 'Searching contacts...'
                  : taskContactsError
                    ? taskContactsError
                    : contactOptions.length > visibleContactOptions.length
                  ? `Showing ${visibleContactOptions.length} of ${contactOptions.length}. Type to narrow.`
                  : contactOptions.length === 0
                    ? leanShellIsDeferred ? 'Type at least 2 characters to search contacts.' : 'No contacts available'
                    : `${contactOptions.length} available contacts`}
              </span>
            </label>
            {selectedCreateContact && (
              <div className={s.selectedContact}>
                <span>{selectedCreateContact.name || selectedCreateContact.client || 'Selected contact'}</span>
                <small>{[selectedCreateContact.phone || selectedCreateContact.email || 'No channel', selectedCreateContact.currentStage || selectedCreateContact.status].filter(Boolean).join(' - ')}</small>
              </div>
            )}
            <label>
              <span className="form-label">Description</span>
              <textarea
                className={s.createTextarea}
                rows={3}
                value={createDraft.description}
                disabled={createBusy}
                onChange={(event) => updateCreateDraft({ description: event.target.value })}
                placeholder="Useful context, call notes, or instructions"
              />
            </label>
          </section>

          {createError && <div className={s.createError} role="alert">{createError}</div>}
        </form>
      </Modal>

      <div className={s.summaryGrid}>
        <div className={`${s.summaryTile} ${s.summaryTileCurrent}`}><span className={s.summaryValue}>{stats.currentWork}</span><span className={s.summaryLabel}>Due Now</span></div>
        <div className={`${s.summaryTile} ${s.summaryTileToday}`}><span className={s.summaryValue}>{stats.dueToday}</span><span className={s.summaryLabel}>Due Today</span></div>
        <div className={`${s.summaryTile} ${s.summaryTileOverdue}`}><span className={s.summaryValue}>{stats.overdue}</span><span className={s.summaryLabel}>Overdue</span></div>
        {!coordinatorUiPolicy.ownerScoped && (
          <button className={`${s.summaryTile} ${s.summaryButton}`} type="button" onClick={showUnassignedLeadFollowUps}>
            <span className={s.summaryValue}>{stats.unassigned}</span>
            <span className={s.summaryLabel}>Unassigned</span>
          </button>
        )}
        <div className={`${s.summaryTile} ${s.summaryTileCompleted}`}><span className={s.summaryValue}>{stats.completedToday}</span><span className={s.summaryLabel}>Done Today</span></div>
      </div>

      <section className={`card ${s.queueSurface}`} aria-label="Task queue">
        {!coordinatorUiPolicy.ownerScoped && unassignedLeadFollowUps.length > 0 && (
          <div className={s.intakeAlert}>
            <div className={s.intakeAlertText}>
              <span className={s.intakeAlertTitle}>New lead follow-ups need owners</span>
              <span className={s.intakeAlertCopy}>
                {unassignedLeadFollowUps.length} unassigned lead follow-up{unassignedLeadFollowUps.length === 1 ? '' : 's'}
                {unassignedFacebookFollowUps.length ? ` · ${unassignedFacebookFollowUps.length} Facebook` : ''}.
              </span>
            </div>
            <button className="btn btn-sm btn-primary" type="button" onClick={showUnassignedLeadFollowUps}>
              <ListTodo size={14} />
              Show queue
            </button>
          </div>
        )}
        <div className={s.queueHeader}>
          <div>
            <span className={s.sectionEyebrow}>Work queue</span>
            <h2 className={s.queueTitle}>Tasks</h2>
            <p className={s.queueSubtitle}>{activeTaskScope}</p>
          </div>
          <div className={s.queueHeaderActions}>
            <span className={s.queueCount} aria-live="polite">{loading ? 'Loading tasks' : `${filteredTasks.length} shown`}</span>
            {canReviewTaskRemovalApprovalTasks && (
              <button
                className={`btn btn-sm ${filters.taskType === 'task_removal_approval' ? 'btn-primary' : ''}`}
                type="button"
                onClick={showCancellationApprovals}
              >
                <ShieldAlert size={14} />
                Cancellation Approvals
              </button>
            )}
            <button className="btn btn-sm" type="button" onClick={resetFilters}>
              <FilterX size={14} />
              Reset
            </button>
          </div>
        </div>
        <div className={s.toolbar}>
          <label className={s.filterGroup}>
            <span className="form-label">Due</span>
            <select className="select" value={filters.due} onChange={(event) => setFilters((prev) => ({ ...prev, due: event.target.value }))}>
              {DUE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className={s.filterGroup}>
            <span className="form-label">Owner</span>
            <select
              className="select"
              value={filters.ownerUserId}
              disabled={coordinatorUiPolicy.ownerScoped}
              onChange={(event) => setFilters((prev) => ({ ...prev, ownerUserId: event.target.value }))}
            >
              {coordinatorUiPolicy.ownerScoped ? (
                <option value="__me">My Tasks</option>
              ) : (
                <>
                  <option value="all">All Owners</option>
                  {currentUser?.id && <option value="__me">My Tasks</option>}
                  <option value="unassigned">Unassigned</option>
                  {visibleAssignees.map((user) => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}
                </>
              )}
            </select>
          </label>
          <label className={s.filterGroup}>
            <span className="form-label">{scopeLabel}</span>
            <select className="select" value={filters.businessUnitId} onChange={(event) => setFilters((prev) => ({ ...prev, businessUnitId: event.target.value }))}>
              <option value="all">All {scopeLabel}</option>
              {accessibleBusinessUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
            </select>
          </label>
          <label className={s.filterGroup}>
            <span className="form-label">Task Type</span>
            <select className="select" value={filters.taskType} onChange={(event) => setFilters((prev) => ({ ...prev, taskType: event.target.value }))}>
              {TASK_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className={s.filterGroup}>
            <span className="form-label">Status</span>
            <select className="select" value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
              {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className={s.filterGroup}>
            <span className="form-label">Link</span>
            <select className="select" value={filters.link} onChange={(event) => setFilters((prev) => ({ ...prev, link: event.target.value }))}>
              {LINK_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>

        {error && (
          <PageState
            tone="error"
            size="compact"
            title="Task queue could not load"
            copy={error}
            actions={<PageStateAction onClick={readTasks}>Try Again</PageStateAction>}
          />
        )}

        {!loading && !error && filteredTasks.length === 0 && (
          <div className={`empty-state ${s.recoveryState}`}>
            <div className={s.emptyTitle}>
              {queueTasks.length === 0 ? 'No tasks in this scope' : 'No tasks match the current filters'}
            </div>
            <p className={s.emptyCopy}>
              {queueTasks.length === 0
                ? `There are no tasks available for ${activeTaskScope}.`
                : `${activeTaskScope} is hiding every loaded task.`}
            </p>
            <div className={s.emptyActions}>
              {queueTasks.length > 0 && (
                <button className="btn btn-primary" type="button" onClick={resetFilters}>
                  <FilterX size={14} />
                  Reset Filters
                </button>
              )}
              {access.canWriteCrm ? (
                <button className={`btn ${queueTasks.length === 0 ? 'btn-primary' : ''}`} type="button" onClick={() => openCreatePanel()}>
                  <Plus size={14} />
                  Create Task
                </button>
              ) : (
                <Link className="btn btn-primary" href="/contacts">Open Contacts</Link>
              )}
            </div>
          </div>
        )}

        <div className={s.queueShell}>
          {filteredTasks.map((task) => {
            const key = dateKey(task.dueAt);
            const isOverdue = key && key < todayKey() && !isTaskClosed(task);
            const isToday = key === todayKey() && !isTaskClosed(task);
            const assignee = visibleAssignees.find((user) => user.id === task.ownerUserId);
            const isArchiveApprovalTask = task.taskType === 'archive_approval';
            const isTaskRemovalApprovalTask = task.taskType === 'task_removal_approval';
            const showEditPanel = editTaskId === task.id;
            const removalApproval = taskRemovalApprovalState(task);
            const removalApprovalPending = removalApproval?.decision === 'pending';
            const cancellationPolicy = task.cancellationPolicy || taskCancellationDecision({ session: { user: currentUser }, task });
            const cancellationNeedsApproval = cancellationPolicy.decision === TASK_CANCELLATION_DECISIONS.APPROVAL_REQUIRED;
            const showAssignToMe = coordinatorUiPolicy.canManageCoordinatorAssignments &&
              !isArchiveApprovalTask &&
              !isTaskRemovalApprovalTask &&
              !isTaskClosed(task) &&
              currentUser?.id &&
              task.ownerUserId !== currentUser.id;
            const showCancelAction = !isArchiveApprovalTask &&
              !isTaskRemovalApprovalTask &&
              !isTaskClosed(task) &&
              !removalApprovalPending &&
              cancellationPolicy.decision !== TASK_CANCELLATION_DECISIONS.FORBIDDEN;
            return (
              <article key={task.id} className={`${s.queueItem} ${isTaskRemovalApprovalTask ? s.queueItemApproval : ''} ${isOverdue ? s.queueItemOverdue : ''} ${isToday ? s.queueItemToday : ''}`}>
                <div>
                  <Link className={`${s.taskTitle} ${s.taskTitleLink}`} href={`/tasks/${encodeURIComponent(task.id)}`}>
                    {task.title}
                  </Link>
                  {task.description && <div className={s.taskDescription}>{task.description}</div>}
                  {filters.taskType === 'follow_up' && task.previousFollowUp && (
                    <div className={s.followUpPreview}>
                      <strong>
                        {task.previousFollowUp.outcomeLabel || titleCase(task.previousFollowUp.outcome)}
                        {' · '}{formatDate(task.previousFollowUp.occurredAt)}
                      </strong>
                      <span>{task.previousFollowUp.note}</span>
                    </div>
                  )}
                  <div className={s.metaLine}>
                    <span className={`badge ${taskBadgeClass(task)}`}>{titleCase(task.status)}</span>
                    <span className={`badge badge-${task.priority}`}>{titleCase(task.priority)}</span>
                    <span className="badge badge-draft">{titleCase(task.taskType)}</span>
                    {task.recurrence && <span className="badge badge-pending">{recurrenceLabel(task.recurrence)}</span>}
                  </div>
                  {isTaskRemovalApprovalTask && (
                    <div className={s.approvalSummary}>
                      <strong>{task.metadataJson?.targetTaskTitle || 'Protected task cancellation'}</strong>
                      <span>{task.metadataJson?.requestedReason || 'No reason recorded.'}</span>
                      <small>
                        {task.metadataJson?.requesterName || task.metadataJson?.requesterEmail || 'Coordinator'}
                        {' · '}{task.ownerUserId ? 'Assigned review' : 'Shared queue'}
                      </small>
                    </div>
                  )}
                  {!isTaskRemovalApprovalTask && removalApproval && (
                    <div className={`${s.cancellationState} ${removalApprovalPending ? s.cancellationStatePending : ''}`}>
                      <strong>
                        {removalApprovalPending
                          ? 'Cancellation pending'
                          : removalApproval.decision === 'denied'
                            ? 'Cancellation denied'
                            : removalApproval.decision === 'superseded'
                              ? 'Cancellation request closed'
                              : 'Cancellation approved'}
                      </strong>
                      <span>{removalApproval.decisionReason || removalApproval.requestedReason || 'Awaiting reviewer decision.'}</span>
                    </div>
                  )}
                </div>
                <div className={s.taskSchedule}>
                  <div className={s.compactLabel}>Due</div>
                  <div className={`${s.dueText} ${isOverdue ? s.dueTextDanger : ''}`}>{formatDate(task.dueAt)}</div>
                  {task.recurrence && (
                    <div className={s.recurrenceText}>
                      <Repeat2 size={12} />
                      {recurrenceLabel(task.recurrence)}
                    </div>
                  )}
                  <div className={s.taskContext}>
                    <span className={s.compactLabel}>Contact</span>
                    <span className={s.mutedText}>{task.contactName || 'No contact linked'}</span>
                  </div>
                </div>
                <div className={s.assigneeSelect}>
                  <span className={s.compactLabel}>Owner</span>
                  {coordinatorUiPolicy.canManageCoordinatorAssignments && !isTaskRemovalApprovalTask ? (
                    <select
                      className="select"
                      value={task.ownerUserId || ''}
                      disabled={!access.canWriteCrm || busyTaskId === task.id}
                      onChange={(event) => applyTaskAction(task, 'assign', { ownerUserId: event.target.value || null })}
                    >
                      <option value="" disabled>Select owner</option>
                      {visibleAssignees.map((user) => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}
                    </select>
                  ) : (
                    <div className={s.dueText}>
                      {isTaskRemovalApprovalTask && !task.ownerUserId
                        ? 'Shared queue'
                        : assignee?.name || assignee?.email || 'Me'}
                    </div>
                  )}
                  {assignee?.email && <span className={s.mutedText}>{assignee.email}</span>}
                </div>
                <div className={s.actions}>
                  {isTaskRemovalApprovalTask && canReviewTaskRemovalApprovalTasks && !isTaskClosed(task) && (
                    <>
                      <button
                        className="btn btn-sm"
                        type="button"
                        disabled={!access.canWriteCrm || busyTaskId === task.id}
                        onClick={() => openRemovalDecision(task, 'deny')}
                      >
                        <X size={14} /> Deny
                      </button>
                      <button
                        className="btn btn-sm btn-primary"
                        type="button"
                        disabled={!access.canWriteCrm || busyTaskId === task.id}
                        onClick={() => openRemovalDecision(task, 'approve')}
                      >
                        <CheckCircle2 size={14} /> Approve
                      </button>
                    </>
                  )}
                  {task.taskType === 'follow_up' && !isTaskClosed(task) && (
                    <button
                      className="btn btn-sm btn-primary"
                      type="button"
                      disabled={!access.canWriteCrm || busyTaskId === task.id}
                      onClick={() => toggleFollowUpCompletion(task.id)}
                    >
                      <CheckCircle2 size={14} />
                      Log outcome
                    </button>
                  )}
                  <Link className={`btn btn-sm ${(task.taskType === 'follow_up' && !isTaskClosed(task)) || isTaskRemovalApprovalTask ? '' : 'btn-primary'}`} href={`/tasks/${encodeURIComponent(task.id)}`}>
                    <ListTodo size={14} />
                    Review
                  </Link>
                  {task.contactId && (
                    <Link className="btn btn-sm" href={`/contacts/${encodeURIComponent(task.contactId)}`}>
                      <ExternalLink size={14} />
                      Contact
                    </Link>
                  )}
                  <button
                    className="btn btn-sm"
                    type="button"
                    onClick={() => openTaskActionPanel(task.id)}
                    aria-expanded={actionPanelTaskId === task.id}
                    aria-controls={`task-actions-${task.id}`}
                  >
                    <MoreHorizontal size={14} />
                    Actions
                  </button>
                </div>
                {actionPanelTaskId === task.id && (
                  <div className={s.taskActionsPanel} id={`task-actions-${task.id}`} aria-label={`Task actions for ${task.title}`}>
                    <div className={s.taskActionHeader}>
                      <span className={s.compactLabel}>Task actions</span>
                    </div>
                    <div className={s.taskActionButtons}>
                      <button
                        className="btn btn-sm"
                        type="button"
                        disabled={!access.canWriteCrm || editBusy || isArchiveApprovalTask || isTaskRemovalApprovalTask}
                        onClick={() => (showEditPanel ? setEditTaskId('') : openEditPanel(task))}
                      >
                        <Pencil size={14} />
                        Edit
                      </button>
                      {showAssignToMe && (
                        <button
                          className="btn btn-sm"
                          type="button"
                          disabled={!access.canWriteCrm || busyTaskId === task.id || !currentUser?.id}
                          onClick={() => applyTaskAction(task, 'assign', { ownerUserId: currentUser.id })}
                        >
                          <UserPlus size={14} />
                          Assign to me
                        </button>
                      )}
                      {isArchiveApprovalTask ? (
                        <>
                          <button
                            className="btn btn-sm"
                            type="button"
                            disabled={!access.canWriteCrm || busyTaskId === task.id || isTaskClosed(task) || !canReviewArchiveApprovalTasks}
                            onClick={() => openArchiveDecision(task, 'deny')}
                          >
                            <X size={14} />
                            Deny
                          </button>
                          <button
                            className="btn btn-sm btn-primary"
                            type="button"
                            disabled={!access.canWriteCrm || busyTaskId === task.id || isTaskClosed(task) || !canReviewArchiveApprovalTasks}
                            onClick={() => openArchiveDecision(task, 'approve')}
                          >
                            <CheckCircle2 size={14} />
                            Approve
                          </button>
                        </>
                      ) : isTaskRemovalApprovalTask ? (
                        <span className={s.mutedText}>Use the approval actions on this request.</span>
                      ) : task.taskType === 'follow_up' ? (
                        <button
                          className="btn btn-sm"
                          type="button"
                          disabled={!access.canWriteCrm || busyTaskId === task.id || isTaskClosed(task)}
                          onClick={() => toggleFollowUpCompletion(task.id)}
                        >
                          <CheckCircle2 size={14} />
                          Complete
                        </button>
                      ) : (
                        <button
                          className="btn btn-sm"
                          type="button"
                          disabled={!access.canWriteCrm || busyTaskId === task.id || isTaskClosed(task)}
                          onClick={() => queueTaskActionConfirmation(task, 'complete')}
                        >
                          <CheckCircle2 size={14} />
                          Complete
                        </button>
                      )}
                      {showCancelAction && (
                        <button
                          className={`btn btn-sm ${cancellationNeedsApproval ? '' : 'btn-danger'}`}
                          type="button"
                          disabled={!access.canWriteCrm || busyTaskId === task.id}
                          onClick={() => openTaskCancellation(task)}
                        >
                          <X size={14} />
                          {cancellationNeedsApproval ? 'Request Cancel' : 'Cancel'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {showEditPanel && (
                  <form className={s.editPanel} onSubmit={submitEditedTask}>
                    <label className={s.createTitleField}>
                      <span className="form-label">Title</span>
                      <input
                        className="input"
                        value={editDraft.title}
                        disabled={editBusy}
                        onChange={(event) => updateEditDraft({ title: event.target.value })}
                      />
                    </label>
                    <label className={s.createContactField}>
                      <span className="form-label">Description</span>
                      <textarea
                        className="textarea"
                        rows={2}
                        value={editDraft.description}
                        disabled={editBusy}
                        onChange={(event) => updateEditDraft({ description: event.target.value })}
                      />
                    </label>
                    <label>
                      <span className="form-label">Task Type</span>
                      <select className="select" value={editDraft.taskType} disabled={editBusy} onChange={(event) => updateEditDraft({ taskType: event.target.value })}>
                        {TASK_CREATE_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label>
                      <span className="form-label">Due Date</span>
                      <input
                        className="input"
                        type="date"
                        required
                        value={editDraft.dueDate}
                        disabled={editBusy}
                        onChange={(event) => updateEditDraft({ dueDate: event.target.value })}
                      />
                    </label>
                    <label>
                      <span className="form-label">Repeats</span>
                      <select className="select" value={editDraft.recurrenceFrequency} disabled={editBusy} onChange={(event) => updateEditDraft({ recurrenceFrequency: event.target.value })}>
                        {TASK_RECURRENCE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    {coordinatorUiPolicy.canManageCoordinatorAssignments ? (
                      <label>
                        <span className="form-label">Owner</span>
                        <select className="select" value={editDraft.ownerUserId} disabled={editBusy} onChange={(event) => updateEditDraft({ ownerUserId: event.target.value })}>
                          <option value="" disabled>Select owner</option>
                          {visibleAssignees.map((user) => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}
                        </select>
                      </label>
                    ) : (
                      <input type="hidden" value={coordinatorUiPolicy.lockedOwnerUserId || editDraft.ownerUserId} readOnly />
                    )}
                    <label>
                      <span className="form-label">{scopeLabel}</span>
                      <select className="select" value={editDraft.businessUnitId} disabled={editBusy} onChange={(event) => updateEditBusinessUnit(event.target.value)}>
                        {accessibleBusinessUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                      </select>
                    </label>
                    <label>
                      <span className="form-label">Priority</span>
                      <select className="select" value={editDraft.priority} disabled={editBusy} onChange={(event) => updateEditDraft({ priority: event.target.value })}>
                        {TASK_PRIORITY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label className={s.createContactField}>
                      <span className="form-label">Contact</span>
                      {leanShellIsDeferred && (
                        <input
                          className="input"
                          value={editContactSearch}
                          disabled={editBusy}
                          onChange={(event) => setEditContactSearch(event.target.value)}
                          placeholder="Search name, phone, email, status, source, or location"
                        />
                      )}
                      <select className="select" value={editDraft.contactId} disabled={editBusy} onChange={(event) => updateEditContact(event.target.value)}>
                        <option value="">No contact linked</option>
                        {visibleEditContactOptions.map(({ contact, label }) => <option key={contact.id} value={contact.id}>{label}</option>)}
                      </select>
                      {leanShellIsDeferred && (
                        <span className={s.contactHint}>{taskContactsLoading ? 'Searching contacts...' : taskContactsError || 'Type to search scoped contacts.'}</span>
                      )}
                    </label>
                    {editError && <div className={s.editError}>{editError}</div>}
                    <div className={s.editActions}>
                      <button className="btn btn-sm" type="button" disabled={editBusy} onClick={() => setEditTaskId('')}>Cancel</button>
                      <button className="btn btn-sm btn-primary" type="submit" disabled={editBusy || !access.canWriteCrm}>
                        Save Task
                      </button>
                    </div>
                  </form>
                )}
              </article>
            );
          })}
        </div>

        {completedTodayTasks.length > 0 && (
          <section className={s.completedBacklog} aria-label="Completed tasks today">
            <div className={s.completedBacklogHeader}>
              <div>
                <h2 className={s.completedTitle}>Done today</h2>
                <p className={s.completedSubtitle}>Completed tasks stay here for review without cluttering current work.</p>
              </div>
              <span className="badge badge-completed">{completedTodayTasks.length}</span>
            </div>
            <div className={s.completedList}>
              {completedTodayTasks.map((task) => {
                const assignee = visibleAssignees.find((user) => user.id === task.ownerUserId);
                return (
                  <article key={`completed-${task.id}`} className={s.completedItem}>
                    <div>
                      <Link className={`${s.taskTitle} ${s.taskTitleLink}`} href={`/tasks/${encodeURIComponent(task.id)}`}>
                        {task.title}
                      </Link>
                      <div className={s.metaLine}>
                        <span className="badge badge-completed">Completed</span>
                        <span className={`badge badge-${task.priority}`}>{titleCase(task.priority)}</span>
                        <span className="badge badge-draft">{titleCase(task.taskType)}</span>
                        {task.recurrence && <span className="badge badge-pending">{recurrenceLabel(task.recurrence)}</span>}
                      </div>
                    </div>
                    <div className={s.completedMeta}>
                      <span>{formatTime(task.completedAt) || 'Completed today'}</span>
                      <span>{assignee?.name || assignee?.email || 'Unassigned'}</span>
                      <span>{task.contactName || 'No contact linked'}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </section>
      <FollowUpOutcomeDialog
        open={Boolean(activeFollowUpTask && activeFollowUpDraft)}
        onClose={() => busyTaskId !== activeFollowUpTask?.id && setCompletionTaskId('')}
        onSubmit={() => activeFollowUpTask && submitFollowUpCompletion(activeFollowUpTask)}
        draft={activeFollowUpDraft}
        onChange={(patch) => activeFollowUpTask && updateFollowUpDraft(activeFollowUpTask.id, patch)}
        onProfileChange={(field, value) => activeFollowUpTask && updateFollowUpLeadProfile(activeFollowUpTask.id, field, value)}
        busy={busyTaskId === activeFollowUpTask?.id}
        error={activeFollowUpTask ? error : ''}
        taskMatchText={activeFollowUpTask
          ? `Completes this task: ${activeFollowUpTask.title || 'Follow-up'} (${formatDate(activeFollowUpTask.dueAt)}).`
          : ''}
        ownerOptions={visibleAssignees.map((user) => ({
          id: user.id,
          label: user.name || user.email || 'Unnamed User',
        }))}
        canManageAssignments={coordinatorUiPolicy.canManageCoordinatorAssignments}
        showProfile={Boolean(
          activeFollowUpTask &&
          accessibleContacts.find((contact) => contact.id === activeFollowUpTask.contactId)?.workflowKey === 'ait_usa'
        )}
        title="Log follow-up outcome"
      />
      <ConfirmDialog
        open={!!confirmTaskAction}
        onClose={() => setConfirmTaskAction(null)}
        onConfirm={confirmQueuedTaskAction}
        title={confirmTaskAction?.title || 'Confirm task action'}
        message={confirmTaskAction?.message || ''}
        confirmLabel={confirmTaskAction?.confirmLabel || 'Confirm'}
        variant={confirmTaskAction?.variant || 'danger'}
      />
      <TaskCancellationDialog
        open={Boolean(cancellationDraft?.task)}
        task={cancellationDraft?.task}
        policy={cancellationDraft?.policy}
        reason={cancellationDraft?.reason || ''}
        busy={busyTaskId === cancellationDraft?.task?.id}
        error={cancellationDraft?.task ? error : ''}
        onClose={() => setCancellationDraft(null)}
        onReasonChange={(reason) => setCancellationDraft((current) => current ? { ...current, reason } : current)}
        onSubmit={submitTaskCancellation}
      />
      <Modal
        open={Boolean(activeArchiveDecisionTask && activeArchiveDecisionDraft)}
        onClose={() => busyTaskId !== activeArchiveDecisionTask?.id && setArchiveDecisionDrafts({})}
        title={activeArchiveDecisionDraft?.decision === 'approve' ? 'Approve archive request?' : 'Deny archive request?'}
        variant="dialog"
        panelClassName={s.dangerDecisionDialog}
        footer={(
          <>
            <button
              className="btn"
              type="button"
              disabled={busyTaskId === activeArchiveDecisionTask?.id}
              onClick={() => setArchiveDecisionDrafts({})}
            >
              Cancel
            </button>
            <button
              className={`btn ${activeArchiveDecisionDraft?.decision === 'approve' ? 'btn-primary' : 'btn-danger'}`}
              type="button"
              disabled={
                !activeArchiveDecisionTask ||
                busyTaskId === activeArchiveDecisionTask.id ||
                (activeArchiveDecisionDraft?.decision === 'deny' && !String(activeArchiveDecisionDraft?.reason || '').trim())
              }
              onClick={() => activeArchiveDecisionTask && submitArchiveDecision(activeArchiveDecisionTask)}
            >
              <CheckCircle2 size={14} />
              {activeArchiveDecisionDraft?.decision === 'approve' ? 'Approve Archive' : 'Deny Archive'}
            </button>
          </>
        )}
      >
        <div className={s.dangerDecisionBody}>
          <div className={s.dangerDecisionNotice}>
            <span className={s.dangerDecisionEyebrow}>
              {activeArchiveDecisionDraft?.decision === 'approve' ? 'Final archive approval' : 'Archive request denial'}
            </span>
            <strong>
              {activeArchiveDecisionDraft?.decision === 'approve'
                ? `Archive ${activeArchiveDecisionTask?.contactName || 'this contact'}?`
                : `Deny archive request for ${activeArchiveDecisionTask?.contactName || 'this contact'}?`}
            </strong>
            <p>
              {activeArchiveDecisionDraft?.decision === 'approve'
                ? 'Approving removes the contact from normal CRM lists while preserving history for audit and recovery.'
                : 'Denial keeps the contact active and records why the archive request was rejected.'}
            </p>
          </div>
          {activeArchiveDecisionTask?.metadataJson?.requestedReason && (
            <div className={s.dangerDecisionRequest}>
              <span>Requested reason</span>
              <p>{activeArchiveDecisionTask.metadataJson.requestedReason}</p>
            </div>
          )}
          <label className={s.dangerDecisionField}>
            <span className="form-label">
              {activeArchiveDecisionDraft?.decision === 'approve' ? 'Approval Reason' : 'Denial Reason *'}
            </span>
            <textarea
              className="textarea"
              rows={4}
              value={activeArchiveDecisionDraft?.reason || ''}
              disabled={busyTaskId === activeArchiveDecisionTask?.id}
              placeholder={activeArchiveDecisionDraft?.decision === 'approve' ? 'Why is this archive approved?' : 'Explain why this archive should not proceed.'}
              onChange={(event) => {
                if (!archiveDecisionTaskId) return;
                setArchiveDecisionDrafts({
                  [archiveDecisionTaskId]: {
                    ...activeArchiveDecisionDraft,
                    reason: event.target.value,
                  },
                });
              }}
            />
          </label>
        </div>
      </Modal>
      <TaskRemovalDecisionDialog
        open={Boolean(activeRemovalDecisionTask && activeRemovalDecisionDraft)}
        task={activeRemovalDecisionTask}
        decision={activeRemovalDecisionDraft?.decision || 'approve'}
        reason={activeRemovalDecisionDraft?.reason || ''}
        busy={busyTaskId === activeRemovalDecisionTask?.id}
        error={error}
        onClose={() => busyTaskId !== activeRemovalDecisionTask?.id && setRemovalDecisionDrafts({})}
        onReasonChange={(reason) => {
          if (!removalDecisionTaskId) return;
          setRemovalDecisionDrafts({
            [removalDecisionTaskId]: { ...activeRemovalDecisionDraft, reason },
          });
        }}
        onSubmit={() => activeRemovalDecisionTask && submitRemovalDecision(activeRemovalDecisionTask)}
      />
      <Modal
        open={createDiscardConfirmationOpen}
        onClose={closeCreateDiscardConfirmation}
        title="Discard task draft?"
        variant="dialog"
        footer={(
          <>
            <button className="btn" type="button" onClick={closeCreateDiscardConfirmation}>Keep Editing</button>
            <button className="btn btn-danger" type="button" onClick={() => {
              discardCreateDraft();
              closeCreateDiscardConfirmation();
            }}>
              Discard Draft
            </button>
          </>
        )}
      >
        <p className={s.createDiscardCopy}>Your unsaved task details will be lost.</p>
      </Modal>
    </div>
  );
}
