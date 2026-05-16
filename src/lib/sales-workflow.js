export const PIPELINE_STATUSES = ['New Lead', 'Contacted', 'Qualified', 'Proposal Sent', 'Won', 'Lost'];

export const FIRST_OUTREACH_TAGS = ['wix_history', 'needs_first_outreach', 'unworked_lead'];

export const FIRST_OUTREACH_ACTION =
  'Make first outreach by phone/SMS/email; confirm program interest and schedule follow-up.';

function clean(value) {
  return String(value || '').trim();
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

export function pipelineStatusFromLead(lead) {
  if (!lead) return 'New Lead';
  const status = clean(lead.status).toLowerCase();
  if (status.includes('lost')) return 'Lost';
  if (status.includes('won')) return 'Won';
  if (status.includes('proposal') || status.includes('estimate')) return 'Proposal Sent';
  if (status.includes('qualified')) return 'Qualified';
  if (status.includes('contact')) return 'Contacted';
  return 'New Lead';
}

export function workflowFromLead(lead) {
  const notes = clean(lead?.originalNotes);
  const tags = tagsFromLeadNotes(notes);
  const outreachState = textAfter('outreach_state', notes);
  const nextAction = textAfter('next_action', notes);
  const priority = textAfter('priority', notes);
  const currentStage = clean(lead?.currentStage) || pipelineStatusFromLead(lead);
  const sourceName = clean(lead?.sourceName || lead?.sourceType).toLowerCase();
  const needsFirstOutreach =
    tags.includes('needs_first_outreach') ||
    outreachState === 'never_contacted' ||
    (pipelineStatusFromLead(lead) === 'New Lead' && sourceName.includes('wix historical'));

  return {
    status: pipelineStatusFromLead(lead),
    currentStage,
    tags,
    outreachState,
    priority: priority || (needsFirstOutreach ? 'High' : 'Medium'),
    nextAction: nextAction || (needsFirstOutreach ? FIRST_OUTREACH_ACTION : ''),
    needsFirstOutreach,
  };
}
