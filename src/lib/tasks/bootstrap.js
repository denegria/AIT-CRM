import { TASK_STATUSES } from './constants.js';

function toIsoDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function toDisplayPriority(value) {
  if (!value) return 'Medium';
  return String(value)
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ');
}

export function toBootstrapTask(row = {}, contactLookup = new Map()) {
  const contact = contactLookup.get(row.contactId);
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    businessUnitId: row.businessUnitId || '',
    contactId: row.contactId || '',
    leadId: row.leadId || '',
    workOrderId: row.workOrderId || '',
    client: row.client || row.contactName || contact?.name || '',
    ownerUserId: row.ownerUserId || row.assignedTo || '',
    assignedTo: row.ownerUserId || row.assignedTo || '',
    dueAt: row.dueAt?.toISOString?.() || row.dueAt || '',
    dueDate: toIsoDate(row.dueAt || row.dueDate),
    completed: Boolean(row.completedAt || row.status === TASK_STATUSES.COMPLETED || row.completed),
    completedAt: row.completedAt?.toISOString?.() || row.completedAt || '',
    priority: toDisplayPriority(row.priority),
    taskType: row.taskType,
    status: row.status,
    taskStatus: row.status,
    sourceType: row.sourceType || '',
    sourceLabel: row.sourceLabel || '',
    createdAt: row.createdAt?.toISOString?.() || row.createdAt || '',
    updatedAt: row.updatedAt?.toISOString?.() || row.updatedAt || '',
  };
}

export function toBootstrapTasks(rows = [], contacts = []) {
  const contactLookup = new Map((contacts || []).map((contact) => [contact.id, contact]));
  return rows.map((row) => toBootstrapTask(row, contactLookup));
}

export async function loadDeferredTasks({ fetcher = globalThis.fetch, contacts = [] } = {}) {
  const response = await fetcher('/api/tasks', { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Tasks could not load.');
  return toBootstrapTasks(payload.tasks || [], contacts);
}
