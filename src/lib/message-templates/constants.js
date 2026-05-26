export const MESSAGE_TEMPLATE_CHANNELS = Object.freeze({
  ALL: 'all',
  MESSENGER: 'messenger',
  WHATSAPP: 'whatsapp',
});

export const MESSAGE_TEMPLATE_PURPOSES = Object.freeze({
  WARMUP: 'warmup',
  QUALIFICATION: 'qualification',
  HANDOFF: 'handoff',
  OPT_OUT: 'opt_out',
  MANUAL_FOLLOW_UP: 'manual_follow_up',
  FALLBACK: 'fallback',
});

export const MESSAGE_TEMPLATE_STATUSES = Object.freeze({
  DRAFT: 'draft',
  ACTIVE: 'active',
  ARCHIVED: 'archived',
});

export const MESSAGE_TEMPLATE_PROVIDER_STATUSES = Object.freeze({
  NOT_REQUIRED: 'not_required',
  NOT_SUBMITTED: 'not_submitted',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

export const FOLLOW_UP_CHANNELS = Object.freeze([
  MESSAGE_TEMPLATE_CHANNELS.MESSENGER,
  MESSAGE_TEMPLATE_CHANNELS.WHATSAPP,
]);

export const MESSAGE_TEMPLATE_CHANNEL_LABELS = Object.freeze({
  [MESSAGE_TEMPLATE_CHANNELS.ALL]: 'All Channels',
  [MESSAGE_TEMPLATE_CHANNELS.MESSENGER]: 'Messenger',
  [MESSAGE_TEMPLATE_CHANNELS.WHATSAPP]: 'WhatsApp',
});

export const MESSAGE_TEMPLATE_PURPOSE_LABELS = Object.freeze({
  [MESSAGE_TEMPLATE_PURPOSES.WARMUP]: 'Warm Lead Warmup',
  [MESSAGE_TEMPLATE_PURPOSES.QUALIFICATION]: 'Qualification',
  [MESSAGE_TEMPLATE_PURPOSES.HANDOFF]: 'Handoff',
  [MESSAGE_TEMPLATE_PURPOSES.OPT_OUT]: 'Opt Out',
  [MESSAGE_TEMPLATE_PURPOSES.MANUAL_FOLLOW_UP]: 'Manual Follow-up',
  [MESSAGE_TEMPLATE_PURPOSES.FALLBACK]: 'Fallback',
});

export function isSupportedTemplateChannel(value) {
  return Object.values(MESSAGE_TEMPLATE_CHANNELS).includes(String(value || '').trim().toLowerCase());
}

export function isSupportedFollowUpChannel(value) {
  return FOLLOW_UP_CHANNELS.includes(String(value || '').trim().toLowerCase());
}

export function isSupportedTemplatePurpose(value) {
  return Object.values(MESSAGE_TEMPLATE_PURPOSES).includes(String(value || '').trim().toLowerCase());
}

export function isSupportedTemplateStatus(value) {
  return Object.values(MESSAGE_TEMPLATE_STATUSES).includes(String(value || '').trim().toLowerCase());
}

export function isSupportedProviderStatus(value) {
  return Object.values(MESSAGE_TEMPLATE_PROVIDER_STATUSES).includes(String(value || '').trim().toLowerCase());
}
