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
const AIT_USA_RETARGETING_SIGNAL_TOKENS = new Set([
  'exclude active and pipeline',
  'legacy undated retargeting',
  'missing name identity retargeting',
  'retargeting',
  'retargeting only',
  'retargeting pool',
  'retargeting legacy undated',
]);

function clean(value) {
  return String(value || '').trim();
}

function normalized(value) {
  return clean(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function normalizedTokens(values = []) {
  return new Set((Array.isArray(values) ? values : [values]).map(normalized).filter(Boolean));
}

function pipelineWorkflowKey(contact = {}, businessUnit = null) {
  if (businessUnit?.workflowKey) return businessUnit.workflowKey;
  if (contact.workflowKey) return contact.workflowKey;
  return workflowKeyForBusinessUnit(businessUnit || contact.businessUnitName || contact.divisionLabel || '');
}

function contactBusinessUnitHint(contact = {}, businessUnit = null) {
  if (businessUnit) return businessUnit;
  if (contact.workflowKey) return { workflowKey: contact.workflowKey };
  return contact.businessUnit || contact.businessUnitName || contact.divisionLabel || null;
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

function currentUtcYearStartMs(now = Date.now()) {
  const value = now instanceof Date ? now.getTime() : Number(now || Date.now());
  const date = new Date(Number.isFinite(value) ? value : Date.now());
  return Date.UTC(date.getUTCFullYear(), 0, 1);
}

function isBeforeCurrentUtcYear(value, now = Date.now()) {
  const time = dateValue(value);
  return Boolean(time && time < currentUtcYearStartMs(now));
}

function aitUsaSourceDate(contact = {}, options = {}) {
  return [
    options.sourceActivityDate,
    contact.sourceActivityDate,
    options.submittedAt,
    contact.submittedAt,
    options.leadCreatedAt,
    contact.leadCreatedAt,
    options.contactCreatedAt,
    contact.contactCreatedAt,
    contact.createdAt,
  ].find((value) => Boolean(dateValue(value))) || '';
}

function hasAitUsaRetargetingSignal(contact = {}) {
  const values = [
    contact.status,
    contact.currentStage,
    contact.contactabilityStatus,
    contact.qualityDisposition,
    contact.outreachState,
    contact.source,
    contact.sourceLabel,
    contact.sourceType,
    contact.sourceName,
    contact.sourceDetail,
    contact.originalNotes,
    contact.notesText,
    ...(contact.tags || []),
    ...(contact.processPills || []),
  ];
  const tokens = normalizedTokens(values);
  if ([...AIT_USA_RETARGETING_SIGNAL_TOKENS].some((token) => tokens.has(token))) return true;
  return values
    .map(normalized)
    .some((value) => value.includes('retargeting only') || value.includes('legacy undated retargeting'));
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
  if (businessUnit?.workflowKey) return lifecycleWorkflowForKey(businessUnit.workflowKey);
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
    if (status.includes('retarget')) return 'Retargeting';
    if (status.includes('drop') || status.includes('withdraw') || status.includes('quit') || status.includes('stopped attending')) return 'Dropped / Quit';
    if (status.includes('not interested') || status.includes('uninterested') || status.includes('do not contact') || status === 'lost' || status === 'closed lost') return 'Not Interested';
    if (status.includes('complete') || status.includes('fulfilled') || status.includes('graduat') || status.includes('passed')) return 'Course Completed';
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
  const workflowKey = pipelineWorkflowKey(contact, businessUnit);
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
  const workflowKey = pipelineWorkflowKey(contact, businessUnit);
  if (workflowKey === WORKFLOW_KEYS.AIT_USA) {
    if (isWorkflowStatusClosed(contact.status || contact.currentStage, contactBusinessUnitHint(contact, businessUnit))) return false;
    if (hasAitUsaRetargetingSignal(contact)) return false;
    return !isBeforeCurrentUtcYear(aitUsaSourceDate(contact, options), options.now);
  }
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

export function isContactDoNotContact(contact = {}) {
  if (contact.isDoNotCall) return true;
  const tokens = normalizedTokens([
    contact.contactabilityStatus,
    contact.qualityDisposition,
    contact.outreachState,
    ...(contact.tags || []),
    ...(contact.processPills || []),
  ]);
  return ['do not contact', 'do not call', 'dnc'].some((value) => tokens.has(value));
}

export function isWorkflowContactActive(contact = {}, businessUnit = null) {
  return contact.isPipelineEligible !== false &&
    !isContactDoNotContact(contact) &&
    !isWorkflowStatusClosed(contact.status || contact.currentStage, contactBusinessUnitHint(contact, businessUnit));
}
