export const CONVERSATION_CHANNELS = Object.freeze({
  MESSENGER: 'messenger',
  WHATSAPP: 'whatsapp',
});

export const CONVERSATION_PROVIDERS = Object.freeze({
  META: 'meta',
});

export const MESSAGE_DIRECTIONS = Object.freeze({
  INBOUND: 'inbound',
  OUTBOUND: 'outbound',
});

export const MESSAGE_DELIVERY_STATUSES = Object.freeze({
  RECEIVED: 'received',
  PENDING: 'pending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  READ: 'read',
  BLOCKED: 'blocked',
});

export const CONVERSATION_STATUSES = Object.freeze({
  OPEN: 'open',
  CLOSED: 'closed',
  ARCHIVED: 'archived',
});

export const CONVERSATION_CHANNEL_LABELS = Object.freeze({
  [CONVERSATION_CHANNELS.MESSENGER]: 'Messenger',
  [CONVERSATION_CHANNELS.WHATSAPP]: 'WhatsApp',
});

export const MESSAGE_STATUS_LABELS = Object.freeze({
  [MESSAGE_DELIVERY_STATUSES.RECEIVED]: 'Received',
  [MESSAGE_DELIVERY_STATUSES.PENDING]: 'Pending',
  [MESSAGE_DELIVERY_STATUSES.SENT]: 'Sent',
  [MESSAGE_DELIVERY_STATUSES.DELIVERED]: 'Delivered',
  [MESSAGE_DELIVERY_STATUSES.FAILED]: 'Failed',
  [MESSAGE_DELIVERY_STATUSES.READ]: 'Read',
  [MESSAGE_DELIVERY_STATUSES.BLOCKED]: 'Blocked',
});

export function isSupportedConversationChannel(value) {
  return Object.values(CONVERSATION_CHANNELS).includes(String(value || '').trim().toLowerCase());
}

export function isSupportedMessageDirection(value) {
  return Object.values(MESSAGE_DIRECTIONS).includes(String(value || '').trim().toLowerCase());
}

export function isSupportedMessageStatus(value) {
  return Object.values(MESSAGE_DELIVERY_STATUSES).includes(String(value || '').trim().toLowerCase());
}
