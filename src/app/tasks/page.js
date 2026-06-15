'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlarmClock,
  CheckCircle2,
  Pencil,
  ExternalLink,
  FilterX,
  Plus,
  RefreshCcw,
  Repeat2,
  X,
  UserPlus,
} from 'lucide-react';
import { useCRM } from '@/lib/store';
import { isAssignableEmployee } from '@/lib/crm/assignable-employees.js';
import { lifecycleBucket } from '@/lib/contact-directory-view.js';
import {
  isTaskClosed,
  isTaskCompletedToday,
  isTaskCurrentWork,
  isTaskDueToday,
  isTaskOpen,
  isTaskOverdue,
  isTaskUpcoming,
  taskDateKey,
} from '@/lib/tasks/visibility.js';
import { useToast } from '@/components/Toast';
import s from './FollowUpQueue.module.css';

const TASK_TYPE_OPTIONS = [
  ['all', 'All Types'],
  ['first_outreach', 'First Outreach'],
  ['follow_up', 'Follow Up'],
  ['appointment', 'Appointment'],
  ['document_request', 'Docs'],
  ['payment_follow_up', 'Payment'],
  ['manual_reminder', 'Manual'],
];

const DUE_OPTIONS = [
  ['work', 'Current Work'],
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

const TASK_CREATE_TYPE_OPTIONS = TASK_TYPE_OPTIONS.filter(([value]) => value !== 'all');
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

function dateKey(value) {
  return taskDateKey(value);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
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
    taskType: task.taskType || 'manual_reminder',
    dueDate: dateKey(task.dueAt),
    ownerUserId: task.ownerUserId || '',
    businessUnitId: task.businessUnitId || '',
    contactId: task.contactId || '',
    priority: task.priority || 'medium',
    recurrenceFrequency: task.recurrence?.frequency || 'none',
  };
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
  if (dueFilter === 'all') return true;
  if (dueFilter === 'unassigned') return !task.ownerUserId && isTaskOpen(task);
  if (dueFilter === 'today') return isTaskDueToday(task, today);
  if (dueFilter === 'overdue') return isTaskOverdue(task, today);
  if (dueFilter === 'upcoming') return isTaskUpcoming(task, today);
  return isTaskCurrentWork(task, today);
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

function optionLabel(options, value) {
  return options.find(([optionValue]) => optionValue === value)?.[1] || titleCase(value);
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
  } = useCRM();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const prefillSignatureRef = useRef('');
  const [queueTasks, setQueueTasks] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [filters, setFilters] = useState({
    due: 'work',
    ownerUserId: 'all',
    businessUnitId: currentBusinessUnitId === 'all' || currentBusinessUnitId === 'unassigned' ? 'all' : currentBusinessUnitId,
    taskType: 'all',
    status: 'all',
    link: 'all',
  });
  const [loading, setLoading] = useState(dataSource === 'postgres');
  const [error, setError] = useState('');
  const [busyTaskId, setBusyTaskId] = useState('');
  const [completionTaskId, setCompletionTaskId] = useState('');
  const [followUpDrafts, setFollowUpDrafts] = useState({});
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createDraft, setCreateDraft] = useState(() => defaultCreateDraft({
    currentBusinessUnitId,
    accessibleBusinessUnits,
    currentUser,
  }));
  const [createContactSearch, setCreateContactSearch] = useState('');
  const [editTaskId, setEditTaskId] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const [editDraft, setEditDraft] = useState(() => editDraftFromTask({}));

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

  const visibleAssignees = assignees.length ? assignees : fallbackAssignees;
  const accessibleContacts = allContacts?.length ? allContacts : contacts;
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
        return {
          contact,
          label: context.length ? `${name} - ${context.join(' - ')}` : name,
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
      setQueueTasks((payload.tasks || []).map((task) => normalizeTask(task, accessibleContacts)));
      setAssignees(payload.users || []);
    } catch (err) {
      setError(err.message || 'Task queue could not load.');
    } finally {
      setLoading(false);
    }
  }, [accessibleContacts, contacts, currentUser?.id, dataSource, fallbackAssignees, filters.businessUnitId, filters.ownerUserId, filters.status, filters.taskType, tasks]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) readTasks();
    });
    return () => {
      cancelled = true;
    };
  }, [readTasks]);

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

  const stats = useMemo(() => {
    const today = todayKey();
    const currentWork = queueTasks.filter((task) => isTaskCurrentWork(task, today)).length;
    const dueToday = queueTasks.filter((task) => isTaskDueToday(task, today)).length;
    const overdue = queueTasks.filter((task) => isTaskOverdue(task, today)).length;
    const completedToday = queueTasks.filter((task) => isTaskCompletedToday(task, today)).length;
    return { currentWork, dueToday, overdue, completedToday };
  }, [queueTasks]);

  async function applyTaskAction(task, action, payload = {}) {
    if (!access.canWriteCrm) return;
    setBusyTaskId(task.id);
    setError('');
    try {
      if (dataSource === 'postgres') {
        const response = await fetch('/api/tasks', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: task.id, action, ...payload }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Task update failed.');
        const nextTask = normalizeTask(result.task, contacts);
        setQueueTasks((prev) => prev.map((row) => (row.id === task.id ? nextTask : row)));
        if (result.nextTask) {
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
        });
      } else {
        const localPatch = {
          ...(action === 'complete' ? { completed: true, status: 'completed', taskStatus: 'completed' } : {}),
          ...(action === 'snooze' ? { dueDate: dateKey(payload.snoozedUntil), dueAt: payload.snoozedUntil, status: 'snoozed', taskStatus: 'snoozed' } : {}),
          ...(action === 'assign' ? { assignedTo: payload.ownerUserId || '', ownerUserId: payload.ownerUserId || '' } : {}),
        };
        updateTask(task.id, localPatch);
        setQueueTasks((prev) => prev.map((row) => (row.id === task.id ? normalizeTask({ ...row, ...localPatch }, contacts) : row)));
      }
      toast(action === 'complete' ? 'Task completed' : action === 'snooze' ? 'Task snoozed' : 'Task assigned');
      if (action === 'complete') {
        setCompletionTaskId('');
        setFollowUpDrafts((prev) => {
          const next = { ...prev };
          delete next[task.id];
          return next;
        });
      }
    } catch (err) {
      setError(err.message || 'Task update failed.');
      toast(err.message || 'Task update failed.');
    } finally {
      setBusyTaskId('');
    }
  }

  function followUpDraft(taskId, task = null) {
    return {
      outcome: 'reached_interested',
      note: '',
      nextDueDate: '',
      nextOwnerUserId: task?.ownerUserId || defaultOwnerUserId(currentUser, visibleAssignees),
      ...(followUpDrafts[taskId] || {}),
    };
  }

  function updateFollowUpDraft(taskId, patch) {
    setFollowUpDrafts((prev) => ({
      ...prev,
      [taskId]: {
        outcome: 'reached_interested',
        note: '',
        nextDueDate: '',
        ...(prev[taskId] || {}),
        ...patch,
      },
    }));
  }

  function openCreatePanel(overrides = {}) {
    const baseDraft = defaultCreateDraft({ currentBusinessUnitId, accessibleBusinessUnits, currentUser });
    setCreateDraft({
      ...baseDraft,
      ...overrides,
      ownerUserId: overrides.ownerUserId || baseDraft.ownerUserId || defaultOwnerUserId(currentUser, visibleAssignees),
    });
    setCreateContactSearch('');
    setCreateError('');
    setCreateOpen(true);
  }

  function updateCreateDraft(patch) {
    setCreateDraft((prev) => ({ ...prev, ...patch }));
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
  }

  function openEditPanel(task) {
    setEditTaskId(task.id);
    setEditDraft(editDraftFromTask(task));
    setEditError('');
    setCompletionTaskId('');
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
  }

  function updateEditContact(contactId) {
    const selectedContact = (accessibleContacts || []).find((contact) => contact.id === contactId);
    const businessUnitId = selectedContact?.businessUnitId || selectedContact?.primaryBusinessUnitId || editDraft.businessUnitId;
    setEditDraft((prev) => ({
      ...prev,
      contactId,
      businessUnitId,
    }));
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
      setCreateDraft({
        ...defaultCreateDraft({ currentBusinessUnitId, accessibleBusinessUnits, currentUser }),
        title: `${taskType === 'first_outreach' ? 'First outreach' : 'Follow up'} - ${selectedContact.name || selectedContact.client || 'contact'}`,
        taskType,
        businessUnitId,
        contactId,
        ownerUserId: selectedContact.assignedTo || defaultOwnerUserId(currentUser, visibleAssignees),
      });
      setCreateContactSearch(selectedContact.name || selectedContact.client || '');
      setCreateError('');
      setCreateOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, [accessibleBusinessUnits, accessibleContacts, currentBusinessUnitId, currentUser, searchParams, visibleAssignees]);

  async function submitCreatedTask(event) {
    event.preventDefault();
    if (!access.canWriteCrm || createBusy) return;
    const title = createDraft.title.trim();
    if (!title) {
      setCreateError('Task title is required.');
      return;
    }
    if (!createDraft.ownerUserId) {
      setCreateError('Task owner is required.');
      return;
    }
    if (!createDraft.dueDate) {
      setCreateError('Task due date is required.');
      return;
    }
    if (!createDraft.businessUnitId) {
      setCreateError(`${scopeLabel} is required.`);
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
          taskType: createDraft.taskType,
          dueAt: dateInputToIso(createDraft.dueDate),
          ownerUserId: createDraft.ownerUserId || null,
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
            taskType: editDraft.taskType,
            dueAt: dateInputToIso(editDraft.dueDate),
            ownerUserId: editDraft.ownerUserId || null,
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
          taskType: editDraft.taskType,
          dueAt: dateInputToIso(editDraft.dueDate),
          dueDate: editDraft.dueDate,
          ownerUserId: editDraft.ownerUserId || '',
          assignedTo: editDraft.ownerUserId || '',
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
      note: draft.note,
      nextDueAt: dateInputToIso(draft.nextDueDate),
      nextOwnerUserId: draft.nextOwnerUserId || task.ownerUserId || null,
    });
  }

  const resetFilters = () => setFilters({
    due: 'work',
    ownerUserId: 'all',
    businessUnitId: currentBusinessUnitId === 'all' || currentBusinessUnitId === 'unassigned' ? 'all' : currentBusinessUnitId,
    taskType: 'all',
    status: 'all',
    link: 'all',
  });
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
  const createTitle = createDraft.title.trim();
  const canSubmitCreate = Boolean(access.canWriteCrm && createTitle && createDraft.dueDate && createDraft.ownerUserId && createDraft.businessUnitId);

  if (!access.canReadCrm) {
    return (
      <div className="fade-in">
        <div className="page-header">
          <div>
            <h1 className="page-title">Tasks</h1>
            <p className="page-subtitle">CRM read access is required.</p>
          </div>
        </div>
        <div className="empty-state">Missing CRM permission.</div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tasks</h1>
          <p className="page-subtitle">
            {currentBusinessUnit?.name || `All ${scopeLabel}`} · {filteredTasks.length} current · {completedTodayTasks.length} done today
          </p>
        </div>
        <div className="flex-gap">
          <button className="btn btn-sm btn-primary" onClick={() => openCreatePanel()} disabled={!access.canWriteCrm}>
            <Plus size={14} />
            New Task
          </button>
          <button className="btn btn-sm" onClick={readTasks} disabled={loading}>
            <RefreshCcw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {createOpen && (
        <form className={s.createPanel} onSubmit={submitCreatedTask}>
          <div className={s.createPanelHeader}>
            <div>
              <h2 className={s.createTitle}>New task</h2>
            </div>
            <button className={`btn btn-sm ${s.iconButton}`} type="button" onClick={() => setCreateOpen(false)} aria-label="Close new task panel">
              <X size={14} />
            </button>
          </div>
          <div className={s.createGrid}>
            <label className={s.createTitleField}>
              <span className="form-label">Title *</span>
              <input
                className="input"
                value={createDraft.title}
                required
                aria-required="true"
                disabled={createBusy}
                onChange={(event) => updateCreateDraft({ title: event.target.value })}
                placeholder="Call client about next step"
              />
            </label>
            <label>
              <span className="form-label">Task Type</span>
              <select className="select" value={createDraft.taskType} disabled={createBusy} onChange={(event) => updateCreateDraft({ taskType: event.target.value })}>
                {TASK_CREATE_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              <span className="form-label">Due Date *</span>
              <input
                className="input"
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
            <label>
              <span className="form-label">Owner *</span>
              <select className="select" value={createDraft.ownerUserId} disabled={createBusy} onChange={(event) => updateCreateDraft({ ownerUserId: event.target.value })}>
                <option value="" disabled>Select owner</option>
                {visibleAssignees.map((user) => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}
              </select>
            </label>
            <label>
              <span className="form-label">{scopeLabel} *</span>
              <select className="select" value={createDraft.businessUnitId} disabled={createBusy} onChange={(event) => updateCreateBusinessUnit(event.target.value)}>
                {accessibleBusinessUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </select>
            </label>
            <label>
              <span className="form-label">Priority</span>
              <select className="select" value={createDraft.priority} disabled={createBusy} onChange={(event) => updateCreateDraft({ priority: event.target.value })}>
                {TASK_PRIORITY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className={`${s.createContactField} ${s.contactPicker}`}>
              <span className="form-label">Contact</span>
              <input
                className="input"
                value={createContactSearch}
                disabled={createBusy}
                onChange={(event) => setCreateContactSearch(event.target.value)}
                placeholder="Search contact by name, email, phone, or status"
              />
              <select className="select" value={createDraft.contactId} disabled={createBusy} onChange={(event) => updateCreateContact(event.target.value)}>
                <option value="">No contact linked</option>
                {visibleContactOptions.map(({ contact, label }) => <option key={contact.id} value={contact.id}>{label}</option>)}
              </select>
              <span className={s.contactHint}>
                {contactOptions.length > visibleContactOptions.length
                  ? `Showing ${visibleContactOptions.length} of ${contactOptions.length}. Type to narrow.`
                  : `${contactOptions.length} available contacts`}
              </span>
            </label>
          </div>
          {createError && <div className={s.createError}>{createError}</div>}
          <div className={s.createActions}>
            <button className="btn btn-sm" type="button" disabled={createBusy} onClick={() => setCreateOpen(false)}>Cancel</button>
            <button className="btn btn-sm btn-primary" type="submit" disabled={createBusy || !canSubmitCreate}>
              <Plus size={14} />
              Create Task
            </button>
          </div>
        </form>
      )}

      <div className={s.summaryGrid}>
        <div className={s.summaryTile}><span className={s.summaryValue}>{stats.currentWork}</span><span className={s.summaryLabel}>Current Work</span></div>
        <div className={s.summaryTile}><span className={s.summaryValue}>{stats.dueToday}</span><span className={s.summaryLabel}>Due Today</span></div>
        <div className={s.summaryTile}><span className={s.summaryValue}>{stats.overdue}</span><span className={s.summaryLabel}>Overdue</span></div>
        <div className={s.summaryTile}><span className={s.summaryValue}>{stats.completedToday}</span><span className={s.summaryLabel}>Done Today</span></div>
      </div>

      <div className="card">
        <div className={s.mobileFilterSummary} aria-label="Active task filters">
          <div className={s.mobileFilterText}>
            <span className={s.mobileFilterLabel}>Active filters</span>
            <span className={s.mobileFilterScope}>{activeTaskScope}</span>
            <span className={s.mobileFilterCount}>{loading ? 'Loading tasks' : `${filteredTasks.length} tasks shown`}</span>
          </div>
          <button className="btn btn-sm" type="button" onClick={resetFilters}>
            <FilterX size={14} />
            Reset
          </button>
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
            <select className="select" value={filters.ownerUserId} onChange={(event) => setFilters((prev) => ({ ...prev, ownerUserId: event.target.value }))}>
              <option value="all">All Owners</option>
              {currentUser?.id && <option value="__me">My Tasks</option>}
              {visibleAssignees.map((user) => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}
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
          <div className={s.filterGroup}>
            <span className="form-label">Results</span>
            <div className={s.dueText}>{loading ? 'Loading' : `${filteredTasks.length} tasks`}</div>
          </div>
          <button className="btn btn-sm" onClick={resetFilters}>
            <FilterX size={14} />
            Reset
          </button>
        </div>

        {error && (
          <div className={s.statusRow}>
            <span>{error}</span>
            <button className="btn btn-sm" onClick={readTasks}>Retry</button>
          </div>
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
            const draft = followUpDraft(task.id, task);
            const showFollowUpCompletion = completionTaskId === task.id && task.taskType === 'follow_up';
            const showEditPanel = editTaskId === task.id;
            return (
              <article key={task.id} className={`${s.queueItem} ${isOverdue ? s.queueItemOverdue : ''} ${isToday ? s.queueItemToday : ''}`}>
                <div>
                  <div className={s.taskTitle}>{task.title}</div>
                  {task.description && <div className={s.taskDescription}>{task.description}</div>}
                  <div className={s.metaLine}>
                    <span className={`badge ${taskBadgeClass(task)}`}>{titleCase(task.status)}</span>
                    <span className={`badge badge-${task.priority}`}>{titleCase(task.priority)}</span>
                    <span className="badge badge-draft">{titleCase(task.taskType)}</span>
                    {task.recurrence && <span className="badge badge-pending">{recurrenceLabel(task.recurrence)}</span>}
                  </div>
                </div>
                <div>
                  <div className={s.compactLabel}>Due</div>
                  <div className={`${s.dueText} ${isOverdue ? s.dueTextDanger : ''}`}>{formatDate(task.dueAt)}</div>
                  {task.recurrence && (
                    <div className={s.recurrenceText}>
                      <Repeat2 size={12} />
                      {recurrenceLabel(task.recurrence)}
                    </div>
                  )}
                  <div className={s.mutedText}>{task.contactName || 'No contact linked'}</div>
                </div>
                <label className={s.assigneeSelect}>
                  <span className={s.compactLabel}>Owner</span>
                  <select
                    className="select"
                    value={task.ownerUserId || ''}
                    disabled={!access.canWriteCrm || busyTaskId === task.id}
                    onChange={(event) => applyTaskAction(task, 'assign', { ownerUserId: event.target.value || null })}
                  >
                    <option value="" disabled>Select owner</option>
                    {visibleAssignees.map((user) => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}
                  </select>
                  {assignee?.email && <span className={s.mutedText}>{assignee.email}</span>}
                </label>
                <div className={s.actions}>
                  <button
                    className={`btn btn-sm ${s.iconButton}`}
                    data-tooltip="Edit task"
                    disabled={!access.canWriteCrm || editBusy}
                    onClick={() => (showEditPanel ? setEditTaskId('') : openEditPanel(task))}
                    aria-label="Edit task"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className={`btn btn-sm ${s.iconButton}`}
                    data-tooltip="Assign to me"
                    disabled={!access.canWriteCrm || busyTaskId === task.id || !currentUser?.id}
                    onClick={() => applyTaskAction(task, 'assign', { ownerUserId: currentUser.id })}
                    aria-label="Assign to me"
                  >
                    <UserPlus size={14} />
                  </button>
                  <button
                    className={`btn btn-sm ${s.iconButton}`}
                    data-tooltip="Snooze one day"
                    disabled={!access.canWriteCrm || busyTaskId === task.id || isTaskClosed(task)}
                    onClick={() => applyTaskAction(task, 'snooze', { snoozedUntil: addDays(1) })}
                    aria-label="Snooze one day"
                  >
                    <AlarmClock size={14} />
                  </button>
                  {task.taskType === 'follow_up' ? (
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={!access.canWriteCrm || busyTaskId === task.id || isTaskClosed(task)}
                      onClick={() => setCompletionTaskId((current) => (current === task.id ? '' : task.id))}
                    >
                      <CheckCircle2 size={14} />
                      Complete
                    </button>
                  ) : (
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={!access.canWriteCrm || busyTaskId === task.id || isTaskClosed(task)}
                      onClick={() => applyTaskAction(task, 'complete')}
                    >
                      <CheckCircle2 size={14} />
                      Complete
                    </button>
                  )}
                  {task.contactId && (
                    <Link className={`btn btn-sm ${s.iconButton}`} href={`/contacts/${task.contactId}`} data-tooltip="Open contact" aria-label="Open contact">
                      <ExternalLink size={14} />
                    </Link>
                  )}
                </div>
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
                    <label>
                      <span className="form-label">Owner</span>
                      <select className="select" value={editDraft.ownerUserId} disabled={editBusy} onChange={(event) => updateEditDraft({ ownerUserId: event.target.value })}>
                        <option value="" disabled>Select owner</option>
                        {visibleAssignees.map((user) => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}
                      </select>
                    </label>
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
                      <select className="select" value={editDraft.contactId} disabled={editBusy} onChange={(event) => updateEditContact(event.target.value)}>
                        <option value="">No contact linked</option>
                        {editContactOptions.map(({ contact, label }) => <option key={contact.id} value={contact.id}>{label}</option>)}
                      </select>
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
                {showFollowUpCompletion && (
                  <div className={s.completionPanel}>
                    <label className={s.filterGroup}>
                      <span className="form-label">Outcome</span>
                      <select
                        className="select"
                        value={draft.outcome}
                        disabled={busyTaskId === task.id}
                        onChange={(event) => updateFollowUpDraft(task.id, { outcome: event.target.value })}
                      >
                        {FOLLOW_UP_OUTCOME_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label className={s.filterGroup}>
                      <span className="form-label">Next Due</span>
                      <input
                        className="input"
                        type="date"
                        value={draft.nextDueDate}
                        disabled={busyTaskId === task.id}
                        onChange={(event) => updateFollowUpDraft(task.id, { nextDueDate: event.target.value })}
                      />
                    </label>
                    <label className={s.filterGroup}>
                      <span className="form-label">Next Owner</span>
                      <select
                        className="select"
                        value={draft.nextOwnerUserId}
                        disabled={busyTaskId === task.id}
                        onChange={(event) => updateFollowUpDraft(task.id, { nextOwnerUserId: event.target.value })}
                      >
                        <option value="" disabled>Select owner</option>
                        {visibleAssignees.map((user) => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}
                      </select>
                    </label>
                    <label className={s.completionNote}>
                      <span className="form-label">Note</span>
                      <textarea
                        className="textarea"
                        rows={2}
                        value={draft.note}
                        disabled={busyTaskId === task.id}
                        onChange={(event) => updateFollowUpDraft(task.id, { note: event.target.value })}
                      />
                    </label>
                    <div className={s.completionActions}>
                      <button className="btn btn-sm" type="button" onClick={() => setCompletionTaskId('')} disabled={busyTaskId === task.id}>Cancel</button>
                      <button className="btn btn-sm btn-primary" type="button" onClick={() => submitFollowUpCompletion(task)} disabled={busyTaskId === task.id}>
                        <CheckCircle2 size={14} />
                        Save Outcome
                      </button>
                    </div>
                  </div>
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
                      <div className={s.taskTitle}>{task.title}</div>
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
      </div>
    </div>
  );
}
