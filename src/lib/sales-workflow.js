import {
  LIFECYCLE_STATUSES,
  WORKFLOW_DEFINITIONS,
  WORKFLOW_KEYS,
  lifecycleWorkflowForBusinessUnit,
  lifecycleWorkflowForKey,
  normalizeLifecycleStatus,
  workflowKeyForBusinessUnit,
} from './crm/lifecycle.js';

export const PIPELINE_STATUSES = LIFECYCLE_STATUSES;

export const FIRST_OUTREACH_TAGS = ['wix_history', 'needs_first_outreach', 'unworked_lead'];

export const FIRST_OUTREACH_ACTION =
  'Make first outreach by phone/SMS/email; confirm program interest and schedule follow-up.';

const AIT_SIGNS_CURRENT_PIPELINE_START = '2025-01-01';
const AIT_SIGNS_RECENT_FOLLOW_UP_START = '2026-01-01';

function clean(value) {
  return String(value || '').trim();
}

function normalized(value) {
  return clean(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function textAfter(label, text) {
  const pattern = new RegExp(label + '=([^|]+)', 'i');
  const match = clean(text).match(pattern);
  return clean(match?.[1]);
}

export function normalizeWorkflowTags(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return clean(value)
    .split(/[;,]/)
    .map(clean)
    .filter(Boolean);
}

export function tagsFromLeadNotes(notes) {
  const raw = textAfter('tags', notes);
  return normalizeWorkflowTags(raw);
}

function newestDateValue(records = [], dateFields = ['updatedAt', 'createdAt']) {
  return records.reduce((latest, record) => {
    for (const field of dateFields) {
      const raw = record?.[field];
      if (!raw) continue;
      const time = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
      if (!Number.isNaN(time) && time > latest) return time;
    }
    return latest;
  }, 0);
}

function hasRows(rows) {
  return Array.isArray(rows) && rows.length > 0;
}

function dateValue(value) {
  if (!value || String(value).toLowerCase() === 'none') return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function isOnOrAfter(value, isoDate) {
  const time = dateValue(value);
  return Boolean(time && time >= dateValue(isoDate));
}

function isImportedAitSignsSource(value) {
  const source = normalized(value);
  const importedSourceLabels = new Set([
    'archive',
    'estimate',
    'payment snapshot',
    'spreadsheet',
    'work order',
    'xlsx',
  ]);
  return source.includes('ait signs import') ||
    importedSourceLabels.has(source) ||
    [
      'interesados',
      'estimados',
      'work order',
      'terminados',
      'pagados',
      'sheet',
    ].some((label) => source.includes(label));
}

function isImportedAitSignsArtifactSheet(value) {
  const sourceSheet = normalized(value);
  return [
    'estimados',
    'terminados',
    'pagados',
    'spreadsheet',
    'work order',
  ].some((label) => sourceSheet.includes(label));
}

function isImportedAitSignsArtifactEvent(row = {}) {
  const eventType = normalized(row.eventType);
  if (eventType === 'import promoted note') return true;
  return isImportedAitSignsArtifactSheet(row.sourceSheet);
}

function aitSignsStatusFromRelated({ workOrders = [], estimates = [], paymentSnapshots = [], financials = [] } = {}) {
  const paymentLikeFinancials = financials.filter((item) => {
    const type = normalized(item.type);
    const status = normalized(item.status);
    return type.includes('invoice') || type.includes('receipt') || status === 'paid';
  });
  if (hasRows(paymentSnapshots) || hasRows(paymentLikeFinancials)) return 'Invoice / Payment';

  if (hasRows(workOrders)) {
    const statuses = workOrders.map((order) => normalized(order.status));
    if (statuses.some((status) => ['completed', 'paid', 'delivered paid', 'pending collection'].includes(status))) {
      return 'Invoice / Payment';
    }
    if (statuses.some((status) => ['in progress', 'in production', 'ready to deliver', 'ready for delivery', 'fulfillment'].includes(status))) {
      return 'Fulfillment';
    }
    return 'Work Order';
  }

  const estimateLikeFinancials = financials.filter((item) => normalized(item.type).includes('estimate'));
  if (hasRows(estimates) || hasRows(estimateLikeFinancials)) return 'Estimate';
  return null;
}

function businessUnitById(businessUnits = [], id = '') {
  return (businessUnits || []).find((unit) => unit.id === id) || null;
}

export function workflowForBusinessUnit(businessUnit = null) {
  return lifecycleWorkflowForBusinessUnit(businessUnit);
}

export function workflowForContact(contact = {}, businessUnits = []) {
  const businessUnit = contact.businessUnit || businessUnitById(
    businessUnits,
    contact.businessUnitId || contact.primaryBusinessUnitId,
  );
  return workflowForBusinessUnit(businessUnit || contact.businessUnitName || contact.divisionLabel || '');
}

export function workflowColumnsForBusinessUnit(businessUnit = null) {
  const workflow = workflowForBusinessUnit(businessUnit);
  return workflow.statuses.map((status) => ({
    id: status,
    label: status,
    isTerminal: workflow.terminalStatuses.includes(status),
    isOperational: Boolean(workflow.operationalStatuses?.includes(status)),
  }));
}

export function pipelineStatusFromLead(lead, options = {}) {
  const workflow = options.workflowKey
    ? lifecycleWorkflowForKey(options.workflowKey)
    : workflowForBusinessUnit(options.businessUnit || options.businessUnitName || '');
  if (workflow.key === WORKFLOW_KEYS.AIT_SIGNS) {
    const relatedStatus = aitSignsStatusFromRelated(options);
    if (relatedStatus) return relatedStatus;
  }
  if (!lead) return workflow.statuses[0];
  const canonicalStatus = normalizeLifecycleStatus(lead.status, { workflowKey: workflow.key });
  if (canonicalStatus) return canonicalStatus;
  const status = clean(lead.status).toLowerCase();
  if (workflow.key === WORKFLOW_KEYS.AIT_USA) {
    if (status.includes('previous') || status.includes('complete') || status.includes('fulfilled')) return 'Completed / Previous Student';
    if (status.includes('enroll') || status.includes('matric') || status.includes('won')) return 'Enrolled';
    if (status.includes('follow') || status.includes('contact') || status.includes('qualified')) return 'Follow Up';
    return workflow.statuses[0];
  }
  if (workflow.key === WORKFLOW_KEYS.AIT_SIGNS) {
    if (status.includes('invoice') || status.includes('payment') || status.includes('paid') || status.includes('complete')) return 'Invoice / Payment';
    if (status.includes('fulfill') || status.includes('progress') || status.includes('production')) return 'Fulfillment';
    if (status.includes('work order') || status.includes('won')) return 'Work Order';
    if (status.includes('proposal') || status.includes('estimate') || status.includes('qualified') || status.includes('contact')) return 'Estimate';
    return workflow.statuses[0];
  }
  if (status.includes('lost')) return 'Lost';
  if (status.includes('won')) return 'Won';
  if (status.includes('proposal') || status.includes('estimate')) return 'Proposal Sent';
  if (status.includes('qualified')) return 'Qualified';
  if (status.includes('contact')) return 'Contacted';
  return WORKFLOW_DEFINITIONS[WORKFLOW_KEYS.DEFAULT].statuses[0];
}

export function workflowFromLead(lead, options = {}) {
  const workflow = options.workflowKey
    ? lifecycleWorkflowForKey(options.workflowKey)
    : workflowForBusinessUnit(options.businessUnit || options.businessUnitName || '');
  const notes = clean(lead?.originalNotes);
  const tags = tagsFromLeadNotes(notes);
  const outreachState = textAfter('outreach_state', notes);
  const nextAction = textAfter('next_action', notes);
  const priority = textAfter('priority', notes);
  const status = pipelineStatusFromLead(lead, { ...options, workflowKey: workflow.key });
  const currentStage = normalizeLifecycleStatus(lead?.currentStage, { workflowKey: workflow.key }) || status;
  const sourceName = clean(lead?.sourceName || lead?.sourceType).toLowerCase();
  const needsFirstOutreach =
    tags.includes('needs_first_outreach') ||
    outreachState === 'never_contacted' ||
    (status === workflow.statuses[0] && sourceName.includes('wix historical'));

  return {
    workflowKey: workflow.key,
    workflowLabel: workflow.label,
    status,
    currentStage,
    tags,
    outreachState,
    priority: priority || (needsFirstOutreach ? 'High' : 'Medium'),
    nextAction: nextAction || (needsFirstOutreach ? FIRST_OUTREACH_ACTION : ''),
    needsFirstOutreach,
  };
}

export function workflowFromContact(contact = {}, options = {}) {
  const businessUnit = options.businessUnit || businessUnitById(
    options.businessUnits,
    contact.businessUnitId || contact.primaryBusinessUnitId,
  );
  const workflowKey = workflowKeyForBusinessUnit(businessUnit || contact.businessUnitName || contact.divisionLabel || '');
  const leadLike = {
    status: contact.status,
    currentStage: contact.currentStage,
    sourceName: contact.source,
    sourceType: contact.source,
    originalNotes: contact.originalNotes || contact.notesText || '',
  };
  const workflow = workflowFromLead(leadLike, {
    ...options,
    businessUnit,
    workflowKey,
  });
  return {
    ...workflow,
    lastActivityAt: Math.max(
      newestDateValue(options.workOrders || [], ['updatedAt', 'createdAt', 'dueDate', 'deliveryDate']),
      newestDateValue(options.estimates || [], ['updatedAt', 'createdAt', 'date', 'dueDate']),
      newestDateValue(options.paymentSnapshots || [], ['paidAt', 'createdAt', 'updatedAt']),
      newestDateValue(options.financials || [], ['date', 'dueDate', 'createdAt', 'updatedAt']),
    ),
  };
}

export function isPipelineEligibleContact(contact = {}, options = {}) {
  const businessUnit = options.businessUnit || businessUnitById(
    options.businessUnits,
    contact.businessUnitId || contact.primaryBusinessUnitId,
  );
  const workflowKey = workflowKeyForBusinessUnit(businessUnit || contact.businessUnitName || contact.divisionLabel || '');
  if (workflowKey !== WORKFLOW_KEYS.AIT_SIGNS) return true;

  const hasLead = Boolean(contact.hasLeadStatus || contact.leadId);
  const hasOperationalRecord = hasRows(options.workOrders) ||
    hasRows(options.estimates) ||
    hasRows(options.paymentSnapshots) ||
    hasRows(options.financials);
  const importArtifactSignal = [
    contact.source,
    contact.sourceLabel,
    contact.sourceType,
  ].some(isImportedAitSignsSource) ||
    hasRows(options.activityEvents?.filter(isImportedAitSignsArtifactEvent)) ||
    hasRows(options.events?.filter(isImportedAitSignsArtifactEvent));

  const hasCurrentTouch = isOnOrAfter(
    options.lastTouch || contact.lastTouch || contact.lastContact,
    AIT_SIGNS_CURRENT_PIPELINE_START,
  );
  const hasPastTouch = Boolean(dateValue(options.lastTouch || contact.lastTouch || contact.lastContact)) && !hasCurrentTouch;
  const hasRecentFollowUp = isOnOrAfter(
    options.lastFollowUpTouch || contact.lastFollowUpTouch,
    AIT_SIGNS_RECENT_FOLLOW_UP_START,
  );

  if (hasCurrentTouch || hasRecentFollowUp) return true;
  if (hasPastTouch) return false;
  if (importArtifactSignal || hasOperationalRecord) return false;
  if (hasLead) return true;

  return !importArtifactSignal;
}

export function isWorkflowStatusClosed(status, businessUnit = null) {
  const workflow = workflowForBusinessUnit(businessUnit);
  return workflow.closedStatuses.includes(normalizeLifecycleStatus(status, { workflowKey: workflow.key }));
}
