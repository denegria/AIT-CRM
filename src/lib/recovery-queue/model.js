export const RECOVERY_QUEUE_LANES = Object.freeze([
  {
    key: 'overdue',
    label: 'Overdue commitments',
    description: 'Open commitments past due.',
    group: 'immediate',
  },
  {
    key: 'duplicate_follow_up',
    label: 'Duplicate follow-ups',
    description: 'Contacts with multiple open follow-up tasks.',
    group: 'immediate',
  },
  {
    key: 'unassigned',
    label: 'Unassigned work',
    description: 'Contactable opportunities without an owner.',
    group: 'backlog',
    privileged: true,
  },
  {
    key: 'first_contact',
    label: 'Awaiting first contact',
    description: 'New opportunities without recorded employee outreach.',
    group: 'backlog',
  },
  {
    key: 'no_commitment',
    label: 'No next commitment',
    description: 'Active opportunities without an open dated task.',
    group: 'backlog',
  },
]);

export const DEFAULT_RECOVERY_QUEUE_LANE = 'first_contact';
export const DEFAULT_RECOVERY_QUEUE_PAGE_SIZE = 25;
export const MAX_RECOVERY_QUEUE_PAGE_SIZE = 100;

function integer(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function availableRecoveryQueueLanes({ canViewUnassigned = false } = {}) {
  return RECOVERY_QUEUE_LANES.filter((lane) => !lane.privileged || canViewUnassigned);
}

export function normalizeRecoveryQueueRequest({
  lane,
  page,
  pageSize,
  canViewUnassigned = false,
} = {}) {
  const lanes = availableRecoveryQueueLanes({ canViewUnassigned });
  const allowedLaneKeys = new Set(lanes.map((entry) => entry.key));
  const normalizedLane = allowedLaneKeys.has(String(lane || ''))
    ? String(lane)
    : DEFAULT_RECOVERY_QUEUE_LANE;
  return {
    lane: normalizedLane,
    page: integer(page, 1),
    pageSize: Math.min(integer(pageSize, DEFAULT_RECOVERY_QUEUE_PAGE_SIZE), MAX_RECOVERY_QUEUE_PAGE_SIZE),
    canViewUnassigned: Boolean(canViewUnassigned),
    lanes,
  };
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toRecoveryQueueItem(row = {}) {
  return {
    key: String(row.item_key || ''),
    lane: String(row.lane || ''),
    reason: String(row.reason || ''),
    contact: {
      id: String(row.contact_id || ''),
      name: String(row.contact_name || 'Unnamed contact'),
      phone: String(row.contact_phone || ''),
      email: String(row.contact_email || ''),
    },
    opportunity: row.lead_id ? {
      id: String(row.lead_id),
      status: String(row.lead_status || ''),
      source: String(row.lead_source || ''),
      assignedUserId: String(row.assigned_user_id || ''),
      assignedUserName: String(row.assigned_user_name || ''),
      createdAt: iso(row.lead_created_at),
    } : null,
    task: row.task_id ? {
      id: String(row.task_id),
      title: String(row.task_title || ''),
      status: String(row.task_status || ''),
      dueAt: iso(row.task_due_at),
      ownerUserId: String(row.task_owner_user_id || ''),
      ownerUserName: String(row.task_owner_user_name || ''),
    } : null,
    ageDays: number(row.age_days),
    urgency: String(row.urgency || 'standard'),
    relatedTaskCount: number(row.related_task_count),
    relatedTasks: Array.isArray(row.related_tasks) ? row.related_tasks
      .filter((task) => task?.id)
      .map((task) => ({
        id: String(task.id),
        title: String(task.title || 'Follow-up task'),
        dueAt: iso(task.dueAt),
      })) : [],
  };
}

export function buildRecoveryQueuePayload(rows = [], request = {}, countOverride = null) {
  const normalized = normalizeRecoveryQueueRequest(request);
  const allowedLaneKeys = new Set(normalized.lanes.map((lane) => lane.key));
  const visibleRows = rows.filter((row) => allowedLaneKeys.has(String(row.lane || '')));
  const counts = Object.fromEntries(normalized.lanes.map((lane) => [
    lane.key,
    number(countOverride?.[lane.key]),
  ]));
  if (!countOverride) {
    for (const row of visibleRows) counts[row.lane] += 1;
  }

  const laneRows = visibleRows.filter((row) => row.lane === normalized.lane);
  const total = countOverride ? counts[normalized.lane] || 0 : laneRows.length;
  const totalPages = Math.max(1, Math.ceil(total / normalized.pageSize));
  const page = Math.min(normalized.page, totalPages);
  const start = (page - 1) * normalized.pageSize;

  return {
    generatedAt: new Date().toISOString(),
    lane: normalized.lane,
    lanes: normalized.lanes.map((lane) => ({ ...lane, count: counts[lane.key] || 0 })),
    items: (countOverride ? laneRows : laneRows.slice(start, start + normalized.pageSize)).map(toRecoveryQueueItem),
    pagination: {
      page,
      pageSize: normalized.pageSize,
      total,
      totalPages,
    },
  };
}
