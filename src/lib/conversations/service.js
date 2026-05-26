import {
  CONVERSATION_CHANNELS,
  CONVERSATION_CHANNEL_LABELS,
  CONVERSATION_PROVIDERS,
  CONVERSATION_STATUSES,
  MESSAGE_DELIVERY_STATUSES,
  MESSAGE_DIRECTIONS,
  MESSAGE_STATUS_LABELS,
  isSupportedConversationChannel,
  isSupportedMessageDirection,
  isSupportedMessageStatus,
} from './constants.js';

const MESSAGE_DIRECTION_LABELS = Object.freeze({
  [MESSAGE_DIRECTIONS.INBOUND]: 'Inbound',
  [MESSAGE_DIRECTIONS.OUTBOUND]: 'Outbound',
});

const CONVERSATION_STATUS_LABELS = Object.freeze({
  [CONVERSATION_STATUSES.OPEN]: 'Open',
  [CONVERSATION_STATUSES.CLOSED]: 'Closed',
  [CONVERSATION_STATUSES.ARCHIVED]: 'Archived',
});

const PROVIDER_LABELS = Object.freeze({
  [CONVERSATION_PROVIDERS.META]: 'Meta',
});

function cleanText(value) {
  return String(value || '').trim();
}

function cleanNullableText(value) {
  const text = cleanText(value);
  return text || null;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ''),
  );
}

function isoTimestamp(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function titleCaseValue(value, fallback = '') {
  const text = cleanText(value);
  if (!text) return fallback;
  return text
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeKeyPart(value, fallback = 'unknown') {
  return cleanText(value).replaceAll(':', '_') || fallback;
}

function normalizeTimestamp(value, fallback = new Date()) {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date;
}

function assertRequired(value, fieldName) {
  if (!cleanText(value)) {
    throw new Error(`${fieldName} is required`);
  }
}

function rowMessage(row) {
  return row?.message || row || {};
}

function rowPayload(row, key) {
  const value = row?.[key];
  return value && value.id ? value : null;
}

function providerLabel(value) {
  const provider = cleanText(value).toLowerCase();
  return PROVIDER_LABELS[provider] || titleCaseValue(provider, 'Provider');
}

function channelLabel(value) {
  const channel = cleanText(value).toLowerCase();
  return CONVERSATION_CHANNEL_LABELS[channel] || titleCaseValue(channel, 'Channel');
}

function directionLabel(value) {
  const direction = cleanText(value).toLowerCase();
  return MESSAGE_DIRECTION_LABELS[direction] || titleCaseValue(direction, 'Direction');
}

function statusLabel(value, labels, fallback = 'Status') {
  const status = cleanText(value).toLowerCase();
  return labels[status] || titleCaseValue(status, fallback);
}

export function conversationRowBusinessUnitId(row) {
  return rowMessage(row).businessUnitId || row?.conversation?.businessUnitId || '';
}

export function filterConversationRowsForBusinessUnit(rows = [], businessUnitIds = null) {
  if (!Array.isArray(businessUnitIds)) return rows;
  const allowed = new Set(businessUnitIds);
  return rows.filter((row) => {
    const businessUnitId = conversationRowBusinessUnitId(row);
    return !businessUnitId || allowed.has(businessUnitId);
  });
}

export function conversationIdentityKey({
  organizationId,
  provider,
  channel,
  providerAccountId,
  providerThreadId,
  externalParticipantId,
}) {
  return [
    normalizeKeyPart(organizationId),
    normalizeKeyPart(provider),
    normalizeKeyPart(channel),
    normalizeKeyPart(providerAccountId),
    normalizeKeyPart(providerThreadId),
    normalizeKeyPart(externalParticipantId),
  ].join(':');
}

export function formatConversationMessageRow(row = {}) {
  const message = rowMessage(row);
  const conversation = row?.conversation || {};
  const channelConfig = rowPayload(row, 'channelConfig');
  const contact = rowPayload(row, 'contact');
  const lead = rowPayload(row, 'lead');
  const businessUnit = rowPayload(row, 'businessUnit');
  const provider = cleanText(message.provider || conversation.provider || channelConfig?.provider).toLowerCase();
  const channel = cleanText(message.channel || conversation.channel || channelConfig?.channel).toLowerCase();
  const deliveryStatus = cleanText(message.deliveryStatus).toLowerCase();
  const direction = cleanText(message.direction).toLowerCase();
  const conversationStatus = cleanText(conversation.status).toLowerCase();

  return compactObject({
    id: message.id || '',
    conversationId: message.conversationId || conversation.id || '',
    provider,
    providerLabel: providerLabel(provider),
    channel,
    channelLabel: channelLabel(channel),
    direction,
    directionLabel: directionLabel(direction),
    deliveryStatus,
    deliveryStatusLabel: statusLabel(deliveryStatus, MESSAGE_STATUS_LABELS, 'Status'),
    text: message.textBody || '',
    timestamp: isoTimestamp(message.occurredAt || message.createdAt),
    createdAt: isoTimestamp(message.createdAt),
    externalMessageId: message.externalMessageId || '',
    identities: compactObject({
      sender: message.senderIdentity || '',
      recipient: message.recipientIdentity || '',
      participant: conversation.externalParticipantId || '',
      thread: message.providerThreadId || conversation.providerThreadId || '',
      providerAccount: message.providerAccountId || conversation.providerAccountId || channelConfig?.providerAccountId || '',
    }),
    conversation: compactObject({
      id: conversation.id || message.conversationId || '',
      status: conversationStatus,
      statusLabel: statusLabel(conversationStatus, CONVERSATION_STATUS_LABELS, 'Status'),
      providerThreadId: conversation.providerThreadId || message.providerThreadId || '',
      externalParticipantId: conversation.externalParticipantId || '',
      lastMessageAt: isoTimestamp(conversation.lastMessageAt),
    }),
    channelConfig: channelConfig ? compactObject({
      id: channelConfig.id,
      label: channelConfig.label || '',
      providerAccountId: channelConfig.providerAccountId || '',
      isActive: channelConfig.isActive,
    }) : null,
    contact: contact ? compactObject({
      id: contact.id,
      name: contact.name || '',
      email: contact.email || '',
      phone: contact.phone || '',
    }) : message.contactId ? { id: message.contactId } : null,
    lead: lead ? compactObject({
      id: lead.id,
      status: lead.status || '',
      sourceName: lead.sourceName || '',
      sourceType: lead.sourceType || '',
    }) : message.leadId ? { id: message.leadId } : null,
    businessUnit: businessUnit ? compactObject({
      id: businessUnit.id,
      name: businessUnit.name || '',
      label: businessUnit.label || '',
      color: businessUnit.color || '',
    }) : message.businessUnitId ? { id: message.businessUnitId } : null,
    error: compactObject({
      code: message.errorCode || '',
      message: message.errorMessage || '',
    }),
  });
}

export function formatConversationMessages(rows = [], { businessUnitIds = null } = {}) {
  return filterConversationRowsForBusinessUnit(rows, businessUnitIds)
    .map(formatConversationMessageRow)
    .sort((left, right) => (right.timestamp || '').localeCompare(left.timestamp || ''));
}

export function messageIdempotencyKey({
  provider,
  channel,
  providerAccountId,
  externalMessageId,
  providerThreadId,
  direction,
  occurredAt,
  textBody,
}) {
  if (externalMessageId) {
    return [
      normalizeKeyPart(provider),
      normalizeKeyPart(channel),
      normalizeKeyPart(providerAccountId),
      normalizeKeyPart(externalMessageId),
    ].join(':');
  }

  return [
    normalizeKeyPart(provider),
    normalizeKeyPart(channel),
    normalizeKeyPart(providerAccountId),
    normalizeKeyPart(providerThreadId),
    normalizeKeyPart(direction),
    normalizeKeyPart(occurredAt ? normalizeTimestamp(occurredAt).toISOString() : ''),
    normalizeKeyPart(textBody || '[no-text]'),
  ].join(':');
}

export function normalizeConversationMessageInput(input = {}) {
  const provider = cleanText(input.provider || CONVERSATION_PROVIDERS.META).toLowerCase();
  const channel = cleanText(input.channel).toLowerCase();
  const direction = cleanText(input.direction || MESSAGE_DIRECTIONS.INBOUND).toLowerCase();
  const deliveryStatus = cleanText(input.deliveryStatus || (
    direction === MESSAGE_DIRECTIONS.INBOUND
      ? MESSAGE_DELIVERY_STATUSES.RECEIVED
      : MESSAGE_DELIVERY_STATUSES.PENDING
  )).toLowerCase();

  assertRequired(input.organizationId, 'organizationId');
  assertRequired(input.providerAccountId, 'providerAccountId');
  assertRequired(input.providerThreadId, 'providerThreadId');
  assertRequired(input.externalParticipantId, 'externalParticipantId');

  if (!isSupportedConversationChannel(channel)) {
    throw new Error(`Unsupported conversation channel: ${input.channel || ''}`);
  }
  if (!isSupportedMessageDirection(direction)) {
    throw new Error(`Unsupported message direction: ${input.direction || ''}`);
  }
  if (!isSupportedMessageStatus(deliveryStatus)) {
    throw new Error(`Unsupported message delivery status: ${input.deliveryStatus || ''}`);
  }

  const occurredAt = normalizeTimestamp(input.occurredAt);
  const externalMessageId = cleanNullableText(input.externalMessageId);
  const textBody = cleanNullableText(input.textBody);
  const idempotencyKey = cleanText(input.idempotencyKey) || messageIdempotencyKey({
    provider,
    channel,
    providerAccountId: input.providerAccountId,
    externalMessageId,
    providerThreadId: input.providerThreadId,
    direction,
    occurredAt,
    textBody,
  });

  return {
    organizationId: cleanText(input.organizationId),
    businessUnitId: cleanNullableText(input.businessUnitId),
    contactId: cleanNullableText(input.contactId),
    leadId: cleanNullableText(input.leadId),
    channelId: cleanNullableText(input.channelId),
    provider,
    channel,
    providerAccountId: cleanText(input.providerAccountId),
    providerThreadId: cleanText(input.providerThreadId),
    externalParticipantId: cleanText(input.externalParticipantId),
    conversationStatus: cleanText(input.conversationStatus || CONVERSATION_STATUSES.OPEN).toLowerCase(),
    direction,
    deliveryStatus,
    externalMessageId,
    idempotencyKey,
    senderIdentity: cleanNullableText(input.senderIdentity),
    recipientIdentity: cleanNullableText(input.recipientIdentity),
    textBody,
    rawPayloadJson: input.rawPayloadJson && typeof input.rawPayloadJson === 'object' ? input.rawPayloadJson : {},
    errorCode: cleanNullableText(input.errorCode),
    errorMessage: cleanNullableText(input.errorMessage),
    occurredAt,
  };
}

export function messengerConversationMessageInput({
  organizationId,
  businessUnitId = null,
  contactId = null,
  leadId = null,
  pageId,
  senderId,
  messageId,
  text = null,
  timestamp = null,
  raw = {},
}) {
  return normalizeConversationMessageInput({
    organizationId,
    businessUnitId,
    contactId,
    leadId,
    provider: CONVERSATION_PROVIDERS.META,
    channel: CONVERSATION_CHANNELS.MESSENGER,
    direction: MESSAGE_DIRECTIONS.INBOUND,
    deliveryStatus: MESSAGE_DELIVERY_STATUSES.RECEIVED,
    providerAccountId: pageId,
    providerThreadId: senderId,
    externalParticipantId: senderId,
    externalMessageId: messageId,
    senderIdentity: senderId,
    recipientIdentity: pageId,
    textBody: text,
    rawPayloadJson: raw,
    occurredAt: timestamp ? new Date(Number(timestamp)) : new Date(),
  });
}

export function whatsappConversationMessageInput({
  organizationId,
  businessUnitId = null,
  contactId = null,
  leadId = null,
  channelId = null,
  phoneNumberId,
  waId,
  messageId,
  text = null,
  timestamp = null,
  raw = {},
}) {
  const occurredAt = timestamp ? new Date(Number(timestamp) * 1000) : new Date();
  return normalizeConversationMessageInput({
    organizationId,
    businessUnitId,
    contactId,
    leadId,
    channelId,
    provider: CONVERSATION_PROVIDERS.META,
    channel: CONVERSATION_CHANNELS.WHATSAPP,
    direction: MESSAGE_DIRECTIONS.INBOUND,
    deliveryStatus: MESSAGE_DELIVERY_STATUSES.RECEIVED,
    providerAccountId: phoneNumberId,
    providerThreadId: waId,
    externalParticipantId: waId,
    externalMessageId: messageId,
    senderIdentity: waId,
    recipientIdentity: phoneNumberId,
    textBody: text,
    rawPayloadJson: raw,
    occurredAt,
  });
}

export function manualOutboundConversationMessageInput({
  organizationId,
  businessUnitId = null,
  contactId = null,
  leadId = null,
  channelId = null,
  channel,
  providerAccountId,
  providerThreadId,
  externalParticipantId,
  senderIdentity,
  recipientIdentity,
  text = null,
  requestId,
  raw = {},
  occurredAt = new Date(),
}) {
  const normalizedChannel = cleanText(channel).toLowerCase();
  const idempotencyKey = [
    normalizeKeyPart(CONVERSATION_PROVIDERS.META),
    normalizeKeyPart(normalizedChannel),
    normalizeKeyPart(providerAccountId),
    'manual',
    normalizeKeyPart(requestId),
  ].join(':');

  return normalizeConversationMessageInput({
    organizationId,
    businessUnitId,
    contactId,
    leadId,
    channelId,
    provider: CONVERSATION_PROVIDERS.META,
    channel: normalizedChannel,
    direction: MESSAGE_DIRECTIONS.OUTBOUND,
    deliveryStatus: MESSAGE_DELIVERY_STATUSES.PENDING,
    providerAccountId,
    providerThreadId,
    externalParticipantId,
    idempotencyKey,
    senderIdentity,
    recipientIdentity,
    textBody: text,
    rawPayloadJson: raw,
    occurredAt,
  });
}

export async function recordConversationMessage(client, input, options = {}) {
  const message = normalizeConversationMessageInput(input);
  const useTransaction = options.useTransaction !== false;
  const preserveExistingOnConflict = options.preserveExistingOnConflict === true;
  if (useTransaction) await client.query('begin');
  try {
    const conversation = await client.query(
      `
        insert into conversations
        (
          organization_id,
          business_unit_id,
          contact_id,
          lead_id,
          channel_id,
          channel,
          provider,
          provider_account_id,
          provider_thread_id,
          external_participant_id,
          status,
          last_message_at,
          metadata_json
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, '{}'::jsonb)
        on conflict (
          organization_id,
          provider,
          channel,
          provider_account_id,
          provider_thread_id,
          external_participant_id
        )
        do update set
          business_unit_id = coalesce(excluded.business_unit_id, conversations.business_unit_id),
          contact_id = coalesce(excluded.contact_id, conversations.contact_id),
          lead_id = coalesce(excluded.lead_id, conversations.lead_id),
          channel_id = coalesce(excluded.channel_id, conversations.channel_id),
          last_message_at = greatest(coalesce(conversations.last_message_at, excluded.last_message_at), excluded.last_message_at),
          updated_at = now()
        returning id
      `,
      [
        message.organizationId,
        message.businessUnitId,
        message.contactId,
        message.leadId,
        message.channelId,
        message.channel,
        message.provider,
        message.providerAccountId,
        message.providerThreadId,
        message.externalParticipantId,
        message.conversationStatus,
        message.occurredAt,
      ],
    );
    const conversationId = conversation.rows[0]?.id;
    if (!conversationId) {
      throw new Error('Conversation insert did not return an id');
    }

    const inserted = await client.query(
      `
        insert into conversation_messages
        (
          conversation_id,
          organization_id,
          business_unit_id,
          contact_id,
          lead_id,
          channel,
          provider,
          direction,
          delivery_status,
          provider_account_id,
          provider_thread_id,
          external_message_id,
          idempotency_key,
          sender_identity,
          recipient_identity,
          text_body,
          raw_payload_json,
          error_code,
          error_message,
          occurred_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19, $20)
        on conflict (organization_id, provider, channel, idempotency_key)
        do update set
          delivery_status = case when $21::boolean then conversation_messages.delivery_status else excluded.delivery_status end,
          raw_payload_json = case when $21::boolean then conversation_messages.raw_payload_json else excluded.raw_payload_json end,
          error_code = case when $21::boolean then conversation_messages.error_code else excluded.error_code end,
          error_message = case when $21::boolean then conversation_messages.error_message else excluded.error_message end,
          updated_at = now()
        returning
          id,
          (xmax = 0) as inserted,
          delivery_status,
          external_message_id,
          error_code,
          error_message
      `,
      [
        conversationId,
        message.organizationId,
        message.businessUnitId,
        message.contactId,
        message.leadId,
        message.channel,
        message.provider,
        message.direction,
        message.deliveryStatus,
        message.providerAccountId,
        message.providerThreadId,
        message.externalMessageId,
        message.idempotencyKey,
        message.senderIdentity,
        message.recipientIdentity,
        message.textBody,
        JSON.stringify(message.rawPayloadJson),
        message.errorCode,
        message.errorMessage,
        message.occurredAt,
        preserveExistingOnConflict,
      ],
    );

    if (useTransaction) await client.query('commit');
    return {
      conversationId,
      messageId: inserted.rows[0]?.id || null,
      inserted: Boolean(inserted.rows[0]?.inserted),
      idempotencyKey: message.idempotencyKey,
      conversationKey: conversationIdentityKey(message),
      deliveryStatus: inserted.rows[0]?.delivery_status || message.deliveryStatus,
      externalMessageId: inserted.rows[0]?.external_message_id || null,
      errorCode: inserted.rows[0]?.error_code || null,
      errorMessage: inserted.rows[0]?.error_message || null,
    };
  } catch (error) {
    if (useTransaction) await client.query('rollback');
    throw error;
  }
}

export async function updateConversationMessageDeliveryStatus(client, {
  organizationId,
  messageId,
  deliveryStatus,
  externalMessageId = null,
  rawPayloadJson = null,
  errorCode = null,
  errorMessage = null,
}) {
  const status = cleanText(deliveryStatus).toLowerCase();
  assertRequired(organizationId, 'organizationId');
  assertRequired(messageId, 'messageId');
  if (!isSupportedMessageStatus(status)) {
    throw new Error(`Unsupported message delivery status: ${deliveryStatus || ''}`);
  }

  const result = await client.query(
    `
      update conversation_messages
      set
        delivery_status = $3,
        external_message_id = coalesce($4, external_message_id),
        raw_payload_json = coalesce($5::jsonb, raw_payload_json),
        error_code = $6,
        error_message = $7,
        updated_at = now()
      where organization_id = $1 and id = $2
      returning id, delivery_status, external_message_id, error_code, error_message
    `,
    [
      cleanText(organizationId),
      cleanText(messageId),
      status,
      cleanNullableText(externalMessageId),
      rawPayloadJson && typeof rawPayloadJson === 'object' ? JSON.stringify(rawPayloadJson) : null,
      cleanNullableText(errorCode),
      cleanNullableText(errorMessage),
    ],
  );

  return result.rows[0] || null;
}

export async function listContactConversationMessages({
  db,
  organizationId,
  contactId,
  businessUnitIds = null,
  limit = 50,
}) {
  const [
    { and, desc, eq, inArray, isNull, or, sql },
    {
      businessUnits,
      contacts,
      conversationChannels,
      conversationMessages,
      conversations,
      leads,
    },
  ] = await Promise.all([
    import('drizzle-orm'),
    import('../../db/schema.js'),
  ]);
  const pageLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  const effectiveBusinessUnitId = sql`coalesce(${conversationMessages.businessUnitId}, ${conversations.businessUnitId})`;
  const conditions = [
    eq(conversationMessages.organizationId, organizationId),
    eq(conversations.organizationId, organizationId),
    or(eq(conversationMessages.contactId, contactId), eq(conversations.contactId, contactId)),
  ];

  if (Array.isArray(businessUnitIds)) {
    conditions.push(
      businessUnitIds.length
        ? or(isNull(effectiveBusinessUnitId), inArray(effectiveBusinessUnitId, businessUnitIds))
        : isNull(effectiveBusinessUnitId),
    );
  }

  const rows = await db
    .select({
      message: conversationMessages,
      conversation: conversations,
      channelConfig: conversationChannels,
      contact: {
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        phone: contacts.phone,
      },
      lead: {
        id: leads.id,
        status: leads.status,
        sourceName: leads.sourceName,
        sourceType: leads.sourceType,
      },
      businessUnit: {
        id: businessUnits.id,
        name: businessUnits.name,
        label: businessUnits.label,
        color: businessUnits.color,
      },
    })
    .from(conversationMessages)
    .innerJoin(conversations, eq(conversationMessages.conversationId, conversations.id))
    .leftJoin(conversationChannels, eq(conversations.channelId, conversationChannels.id))
    .leftJoin(contacts, eq(conversationMessages.contactId, contacts.id))
    .leftJoin(leads, eq(conversationMessages.leadId, leads.id))
    .leftJoin(businessUnits, eq(effectiveBusinessUnitId, businessUnits.id))
    .where(and(...conditions))
    .orderBy(desc(conversationMessages.occurredAt), desc(conversationMessages.createdAt))
    .limit(pageLimit);

  return formatConversationMessages(rows, { businessUnitIds });
}
