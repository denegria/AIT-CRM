export const WORKFLOW_KEYS = {
  DEFAULT: 'default',
  AIT_USA: 'ait_usa',
  AIT_SIGNS: 'ait_signs',
};

export const WORKFLOW_DEFINITIONS = {
  [WORKFLOW_KEYS.DEFAULT]: {
    key: WORKFLOW_KEYS.DEFAULT,
    label: 'General Sales Pipeline',
    statuses: ['New Lead', 'Contacted', 'Qualified', 'Proposal Sent', 'Won', 'Lost'],
    activeStatuses: ['New Lead', 'Contacted', 'Qualified', 'Proposal Sent'],
    closedStatuses: ['Won', 'Lost'],
    terminalStatuses: ['Won', 'Lost'],
  },
  [WORKFLOW_KEYS.AIT_USA]: {
    key: WORKFLOW_KEYS.AIT_USA,
    label: 'AIT USA Enrollment Pipeline',
    statuses: ['New Lead', 'Follow Up', 'Enrolled', 'Completed / Previous Student'],
    activeStatuses: ['New Lead', 'Follow Up', 'Enrolled'],
    closedStatuses: ['Completed / Previous Student'],
    terminalStatuses: ['Completed / Previous Student'],
  },
  [WORKFLOW_KEYS.AIT_SIGNS]: {
    key: WORKFLOW_KEYS.AIT_SIGNS,
    label: 'AIT Signs Work Pipeline',
    statuses: ['Intake', 'Estimate', 'Work Order', 'Fulfillment', 'Invoice / Payment'],
    activeStatuses: ['Intake', 'Estimate', 'Work Order', 'Fulfillment'],
    closedStatuses: ['Invoice / Payment'],
    terminalStatuses: ['Invoice / Payment'],
    operationalStatuses: ['Estimate', 'Work Order', 'Fulfillment', 'Invoice / Payment'],
  },
};

export const LIFECYCLE_STATUSES = [
  ...new Set(Object.values(WORKFLOW_DEFINITIONS).flatMap((workflow) => workflow.statuses)),
];
export const ACTIVE_LIFECYCLE_STATUSES = [
  ...new Set(Object.values(WORKFLOW_DEFINITIONS).flatMap((workflow) => workflow.activeStatuses)),
];
export const CLOSED_LIFECYCLE_STATUSES = [
  ...new Set(Object.values(WORKFLOW_DEFINITIONS).flatMap((workflow) => workflow.closedStatuses)),
];

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

const WORKFLOW_ALIASES = {
  [WORKFLOW_KEYS.AIT_USA]: new Map([
    ['new', 'New Lead'],
    ['new lead', 'New Lead'],
    ['lead', 'New Lead'],
    ['unworked', 'New Lead'],
    ['unworked lead', 'New Lead'],
    ['needs first outreach', 'New Lead'],
    ['contacted', 'Follow Up'],
    ['called', 'Follow Up'],
    ['follow up', 'Follow Up'],
    ['followup', 'Follow Up'],
    ['reached out', 'Follow Up'],
    ['qualified', 'Follow Up'],
    ['proposal', 'Follow Up'],
    ['proposal sent', 'Follow Up'],
    ['estimate', 'Follow Up'],
    ['enrolled', 'Enrolled'],
    ['matriculated', 'Enrolled'],
    ['registered', 'Enrolled'],
    ['won', 'Enrolled'],
    ['closed won', 'Enrolled'],
    ['sold', 'Enrolled'],
    ['completed', 'Completed / Previous Student'],
    ['fulfilled', 'Completed / Previous Student'],
    ['previous student', 'Completed / Previous Student'],
    ['previously enrolled', 'Completed / Previous Student'],
    ['completed previous student', 'Completed / Previous Student'],
    ['completed previous', 'Completed / Previous Student'],
    ['lost', 'Completed / Previous Student'],
    ['closed lost', 'Completed / Previous Student'],
  ]),
  [WORKFLOW_KEYS.AIT_SIGNS]: new Map([
    ['new', 'Intake'],
    ['new lead', 'Intake'],
    ['lead', 'Intake'],
    ['intake', 'Intake'],
    ['unworked', 'Intake'],
    ['contacted', 'Estimate'],
    ['qualified', 'Estimate'],
    ['proposal', 'Estimate'],
    ['proposal sent', 'Estimate'],
    ['estimate', 'Estimate'],
    ['estimate sent', 'Estimate'],
    ['estimate review', 'Estimate'],
    ['pending estimate', 'Estimate'],
    ['pending', 'Work Order'],
    ['approved', 'Work Order'],
    ['converted to work order', 'Work Order'],
    ['work order', 'Work Order'],
    ['won', 'Work Order'],
    ['closed won', 'Work Order'],
    ['in progress', 'Fulfillment'],
    ['in production', 'Fulfillment'],
    ['production', 'Fulfillment'],
    ['ready to deliver', 'Fulfillment'],
    ['ready for delivery', 'Fulfillment'],
    ['fulfillment', 'Fulfillment'],
    ['fulfilled', 'Invoice / Payment'],
    ['completed', 'Invoice / Payment'],
    ['delivered paid', 'Invoice / Payment'],
    ['pending collection', 'Invoice / Payment'],
    ['invoice', 'Invoice / Payment'],
    ['payment', 'Invoice / Payment'],
    ['payment snapshot', 'Invoice / Payment'],
    ['paid', 'Invoice / Payment'],
    ['lost', 'Invoice / Payment'],
    ['closed lost', 'Invoice / Payment'],
    ['rejected', 'Invoice / Payment'],
    ['canceled', 'Invoice / Payment'],
    ['cancelled', 'Invoice / Payment'],
  ]),
};

function cleanStatus(value) {
  return String(value || '').trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function normalizedBusinessLabel(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function workflowKeyFromBusinessLabel(label) {
  const normalized = normalizedBusinessLabel(label);
  if (!normalized) return WORKFLOW_KEYS.DEFAULT;
  if (normalized.includes('ait usa') || normalized.includes('institute')) return WORKFLOW_KEYS.AIT_USA;
  if (normalized.includes('ait signs') || normalized === 'signs' || normalized.endsWith(' signs')) return WORKFLOW_KEYS.AIT_SIGNS;
  return WORKFLOW_KEYS.DEFAULT;
}

export function workflowKeyForBusinessUnit(businessUnit = null) {
  if (typeof businessUnit === 'string') return workflowKeyFromBusinessLabel(businessUnit);
  return workflowKeyFromBusinessLabel(businessUnit?.name || businessUnit?.label || businessUnit?.businessUnitName || '');
}

export function lifecycleWorkflowForBusinessUnit(businessUnit = null) {
  return WORKFLOW_DEFINITIONS[workflowKeyForBusinessUnit(businessUnit)] || WORKFLOW_DEFINITIONS[WORKFLOW_KEYS.DEFAULT];
}

export function lifecycleWorkflowForKey(workflowKey = WORKFLOW_KEYS.DEFAULT) {
  return WORKFLOW_DEFINITIONS[workflowKey] || WORKFLOW_DEFINITIONS[WORKFLOW_KEYS.DEFAULT];
}

export function normalizeLifecycleStatus(value, options = {}) {
  const cleaned = cleanStatus(value);
  if (!cleaned) return null;
  const workflowKey = options.workflowKey || workflowKeyForBusinessUnit(options.businessUnit || options.businessUnitName || '');
  const workflow = lifecycleWorkflowForKey(workflowKey);
  const exact = workflow.statuses.find((status) => status.toLowerCase() === cleaned.toLowerCase());
  if (exact) return exact;
  const workflowAlias = WORKFLOW_ALIASES[workflow.key]?.get(cleaned.toLowerCase());
  if (workflowAlias) return workflowAlias;
  if (workflow.key !== WORKFLOW_KEYS.DEFAULT) return null;
  const globalExact = LIFECYCLE_STATUSES.find((status) => status.toLowerCase() === cleaned.toLowerCase());
  if (globalExact) return globalExact;
  return STATUS_ALIASES.get(cleaned.toLowerCase()) || null;
}

export function requireLifecycleStatus(value, options = {}) {
  const status = normalizeLifecycleStatus(value, options);
  if (!status) {
    const workflow = lifecycleWorkflowForKey(options.workflowKey || workflowKeyForBusinessUnit(options.businessUnit || options.businessUnitName || ''));
    throw new Error(`Invalid lifecycle status. Use one of: ${workflow.statuses.join(', ')}.`);
  }
  return status;
}

export function isValidLifecycleStatus(value, options = {}) {
  return Boolean(normalizeLifecycleStatus(value, options));
}

export function isClosedLifecycleStatus(status, options = {}) {
  const workflow = lifecycleWorkflowForKey(options.workflowKey || workflowKeyForBusinessUnit(options.businessUnit || options.businessUnitName || ''));
  return workflow.closedStatuses.includes(normalizeLifecycleStatus(status, options));
}

export function evaluateLifecycleTransition({
  fromStatus,
  toStatus,
  businessUnit = null,
  businessUnitName = '',
  workflowKey = '',
  canReopenClosedStatus = false,
}) {
  const workflow = lifecycleWorkflowForKey(workflowKey || workflowKeyForBusinessUnit(businessUnit || businessUnitName || ''));
  const options = { workflowKey: workflow.key };
  const from = normalizeLifecycleStatus(fromStatus, options) || workflow.statuses[0];
  const to = requireLifecycleStatus(toStatus, options);

  if (from === to) {
    return { allowed: true, fromStatus: from, toStatus: to, changed: false };
  }

  if (isClosedLifecycleStatus(from, options) && !canReopenClosedStatus) {
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
