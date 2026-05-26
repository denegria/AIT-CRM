import {
  CONVERSATION_CHANNELS,
  CONVERSATION_PROVIDERS,
  CONVERSATION_STATUSES,
  MESSAGE_DELIVERY_STATUSES,
  MESSAGE_DIRECTIONS,
  isSupportedConversationChannel,
  isSupportedMessageDirection,
  isSupportedMessageStatus,
} from './constants.js';

function cleanText(value) {
  return String(value || '').trim();
}

function cleanNullableText(value) {
  const text = cleanText(value);
  return text || null;
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

export async function recordConversationMessage(client, input) {
  const message = normalizeConversationMessageInput(input);
  await client.query('begin');
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
          delivery_status = excluded.delivery_status,
          raw_payload_json = excluded.raw_payload_json,
          error_code = excluded.error_code,
          error_message = excluded.error_message,
          updated_at = now()
        returning id, (xmax = 0) as inserted
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
      ],
    );

    await client.query('commit');
    return {
      conversationId,
      messageId: inserted.rows[0]?.id || null,
      inserted: Boolean(inserted.rows[0]?.inserted),
      idempotencyKey: message.idempotencyKey,
      conversationKey: conversationIdentityKey(message),
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}
