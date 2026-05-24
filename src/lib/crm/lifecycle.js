export const LIFECYCLE_STATUSES = ['New Lead', 'Contacted', 'Qualified', 'Proposal Sent', 'Won', 'Lost'];
export const ACTIVE_LIFECYCLE_STATUSES = ['New Lead', 'Contacted', 'Qualified', 'Proposal Sent'];
export const CLOSED_LIFECYCLE_STATUSES = ['Won', 'Lost'];

const STATUS_ALIASES = new Map([
  ['new', 'New Lead'],
  ['new lead', 'New Lead'],
  ['lead', 'New Lead'],
  ['unworked', 'New Lead'],
  ['unworked lead', 'New Lead'],
  ['needs first outreach', 'New Lead'],
  ['contacted', 'Contacted'],
  ['called', 'Contacted'],
  ['reached out', 'Contacted'],
  ['qualified', 'Qualified'],
  ['proposal', 'Proposal Sent'],
  ['proposal sent', 'Proposal Sent'],
  ['estimate', 'Proposal Sent'],
  ['estimate sent', 'Proposal Sent'],
  ['won', 'Won'],
  ['closed won', 'Won'],
  ['sold', 'Won'],
  ['lost', 'Lost'],
  ['closed lost', 'Lost'],
]);

function cleanStatus(value) {
  return String(value || '').trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

export function normalizeLifecycleStatus(value) {
  const cleaned = cleanStatus(value);
  if (!cleaned) return null;
  const exact = LIFECYCLE_STATUSES.find((status) => status.toLowerCase() === cleaned.toLowerCase());
  if (exact) return exact;
  return STATUS_ALIASES.get(cleaned.toLowerCase()) || null;
}

export function requireLifecycleStatus(value) {
  const status = normalizeLifecycleStatus(value);
  if (!status) {
    throw new Error(`Invalid lifecycle status. Use one of: ${LIFECYCLE_STATUSES.join(', ')}.`);
  }
  return status;
}

export function isValidLifecycleStatus(value) {
  return Boolean(normalizeLifecycleStatus(value));
}

export function isClosedLifecycleStatus(status) {
  return CLOSED_LIFECYCLE_STATUSES.includes(normalizeLifecycleStatus(status));
}

export function evaluateLifecycleTransition({ fromStatus, toStatus, canReopenClosedStatus = false }) {
  const from = normalizeLifecycleStatus(fromStatus) || 'New Lead';
  const to = requireLifecycleStatus(toStatus);

  if (from === to) {
    return { allowed: true, fromStatus: from, toStatus: to, changed: false };
  }

  if (isClosedLifecycleStatus(from) && !canReopenClosedStatus) {
    return {
      allowed: false,
      fromStatus: from,
      toStatus: to,
      changed: true,
      reason: 'Only all-division users can change a closed lead status.',
    };
  }

  return { allowed: true, fromStatus: from, toStatus: to, changed: true };
}
