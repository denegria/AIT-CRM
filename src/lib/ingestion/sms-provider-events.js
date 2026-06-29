import {
  recordInboundLeadAssignmentActivity,
  resolveDefaultInboundLeadOwnerUserId,
} from '../crm/assignment.js';
import {
  recordConversationMessage,
  smsConversationMessageInput,
  updateConversationMessageDeliveryStatus,
} from '../conversations/service.js';
import {
  SMS_CONSENT_EVENT_TYPES,
  SMS_CONSENT_SOURCE_TYPES,
  classifySmsKeyword,
  recordSmsConsentEvent,
} from '../communication-consent/sms-consent.js';
import {
  SMS_EVENT_KINDS,
  normalizeSmsPhone,
  resolveSmsBusinessUnitMapping,
  smsProviderEventKey,
} from '../messaging/providers/sms.js';

export const SMS_PROVIDER_BATCH_SOURCE_NAME = 'SMS Provider';
export const SMS_PROVIDER_BATCH_SOURCE_TYPE = 'sms_provider_webhook';
export const SMS_PROVIDER_SOURCE_SHEET = 'sms_provider_webhook';
export const SMS_PROVIDER_FILE_PREFIX = 'sms-provider';
export const SMS_PROVIDER_REVIEW_TYPE = 'sms_provider_review';

function cleanText(value) {
  return String(value || '').trim();
}

function cleanNullableText(value) {
  const text = cleanText(value);
  return text || null;
}

function phoneDigits(value) {
  return normalizeSmsPhone(value).replace(/\D+/g, '');
}

function smsMessageText(event) {
  return cleanText(event.text) || '[SMS message]';
}

export async function findOrCreateSmsProviderBatch(client, organizationId, options = {}) {
  const sourceName = options.sourceName || SMS_PROVIDER_BATCH_SOURCE_NAME;
  const sourceType = options.sourceType || SMS_PROVIDER_BATCH_SOURCE_TYPE;
  const filePrefix = options.filePrefix || SMS_PROVIDER_FILE_PREFIX;
  const sheetName = options.sheetName || SMS_PROVIDER_SOURCE_SHEET;
  const day = new Date().toISOString().slice(0, 10);
  const fileName = `${filePrefix}-${day}`;

  const existing = await client.query(
    `
      select id
      from import_batches
      where organization_id = $1 and source_type = $2 and file_name = $3
      order by created_at desc
      limit 1
    `,
    [organizationId, sourceType, fileName],
  );
  if (existing.rows[0]?.id) return existing.rows[0].id;

  const inserted = await client.query(
    `
      insert into import_batches
      (organization_id, source_name, source_type, file_name, sheet_name, status)
      values ($1, $2, $3, $4, $5, 'staging')
      returning id
    `,
    [organizationId, sourceName, sourceType, fileName, sheetName],
  );
  return inserted.rows[0]?.id || null;
}

async function nextRowNumber(client, batchId) {
  const result = await client.query(
    'select coalesce(max(source_row_number), 0)::int as max_row from import_source_rows where import_batch_id = $1',
    [batchId],
  );
  return Number(result.rows[0]?.max_row || 0) + 1;
}

async function lockedNextRowNumber(client, batchId) {
  await client.query('select id from import_batches where id = $1 for update', [batchId]);
  return nextRowNumber(client, batchId);
}

async function lockWebhookEvent(client, eventKey) {
  if (!eventKey) return;
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [eventKey]);
}

async function withSerializedWebhookEvent(client, eventKey, handler) {
  await client.query('begin');
  try {
    await lockWebhookEvent(client, eventKey);
    const result = await handler();
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

function smsProviderCandidates(event) {
  return [...new Set([
    event.providerAccountId,
    event.ownedNumber,
    event.recipientPhone,
    event.senderPhone,
  ].map((value) => cleanText(value)).filter(Boolean))];
}

async function resolveMappedBusinessUnitId(client, organizationId, mapped) {
  if (!mapped) return null;
  const mappedResult = await client.query(
    `
      select id
      from business_units
      where organization_id = $1
        and is_active = true
        and (id::text = $2 or lower(name) = lower($2))
      limit 1
    `,
    [organizationId, String(mapped)],
  );
  return mappedResult.rows[0]?.id || null;
}

async function resolveFallbackBusinessUnitId(client, organizationId) {
  const result = await client.query(
    `
      select id
      from business_units
      where organization_id = $1 and is_active = true
      order by name asc
      limit 1
    `,
    [organizationId],
  );
  return result.rows[0]?.id || null;
}

export async function resolveSmsBusinessUnitRoute(client, organizationId, event, smsConfig = {}) {
  const candidates = smsProviderCandidates(event);
  let channelId = null;
  if (candidates.length) {
    const channelResult = await client.query(
      `
        select cc.id, cc.business_unit_id::text as business_unit_id
        from conversation_channels cc
        left join business_units bu
          on bu.id = cc.business_unit_id
          and bu.organization_id = cc.organization_id
          and bu.is_active = true
        where cc.organization_id = $1
          and cc.provider = $2
          and cc.channel = 'sms'
          and cc.provider_account_id = any($3::text[])
          and cc.is_active = true
          and (cc.business_unit_id is null or bu.id is not null)
        order by cc.created_at desc
        limit 1
      `,
      [organizationId, event.provider, candidates],
    );
    channelId = channelResult.rows[0]?.id || null;
    if (channelResult.rows[0]?.business_unit_id) {
      return { businessUnitId: channelResult.rows[0].business_unit_id, channelId };
    }
  }

  const mapped = resolveSmsBusinessUnitMapping(event, smsConfig).businessUnit;
  const mappedBusinessUnitId = await resolveMappedBusinessUnitId(client, organizationId, mapped);
  if (mappedBusinessUnitId) return { businessUnitId: mappedBusinessUnitId, channelId };

  return {
    businessUnitId: await resolveFallbackBusinessUnitId(client, organizationId),
    channelId,
  };
}

async function hasSmsMessageId(client, organizationId, event) {
  if (!event.messageId) return false;
  const result = await client.query(
    `
      select 1
      from conversation_messages
      where organization_id = $1
        and provider = $2
        and channel = 'sms'
        and external_message_id = $3
      limit 1
    `,
    [organizationId, event.provider, event.messageId],
  );
  return Boolean(result.rows.length);
}

async function findExistingSmsLead(client, organizationId, businessUnitId, event) {
  if (!businessUnitId || !event.participantPhone) return null;

  const conversationResult = await client.query(
    `
      select c.id::text as contact_id, l.id::text as lead_id
      from conversations conv
      left join contacts c
        on c.id = conv.contact_id
        and c.organization_id = conv.organization_id
        and c.primary_business_unit_id::text = $4
      left join leads l
        on l.id = conv.lead_id
        and l.organization_id = conv.organization_id
        and l.business_unit_id::text = $4
      where conv.organization_id = $1
        and conv.provider = $2
        and conv.channel = 'sms'
        and conv.provider_account_id = $3
        and conv.external_participant_id = $5
        and (conv.business_unit_id is null or conv.business_unit_id::text = $4)
        and (c.id is not null or l.id is not null)
      order by conv.updated_at desc
      limit 1
    `,
    [organizationId, event.provider, event.providerAccountId || '', businessUnitId, event.participantPhone],
  );
  if (conversationResult.rows[0]?.contact_id || conversationResult.rows[0]?.lead_id) {
    return {
      contactId: conversationResult.rows[0].contact_id || null,
      leadId: conversationResult.rows[0].lead_id || null,
    };
  }

  const digits = phoneDigits(event.participantPhone);
  if (!digits) return null;
  const contactResult = await client.query(
    `
      select c.id::text as contact_id, l.id::text as lead_id
      from contacts c
      left join lateral (
        select id
        from leads l
        where l.organization_id = c.organization_id
          and l.contact_id = c.id
          and l.business_unit_id::text = $3
        order by l.updated_at desc, l.created_at desc
        limit 1
      ) l on true
      where c.organization_id = $1
        and c.primary_business_unit_id::text = $3
        and regexp_replace(coalesce(c.phone, ''), '[^0-9]+', '', 'g') = $2
      order by (l.id is null), c.updated_at desc
      limit 1
    `,
    [organizationId, digits, businessUnitId],
  );
  const row = contactResult.rows[0] || null;
  if (!row?.contact_id) return null;
  return {
    contactId: row.contact_id || null,
    leadId: row.lead_id || null,
  };
}

export function classifySmsProviderInboundEvent(event) {
  if (event.kind !== SMS_EVENT_KINDS.INBOUND_MESSAGE) return { action: 'ignore', reason: 'Not an inbound SMS message.' };
  if (!event.provider) return { action: 'ignore', reason: 'Missing SMS provider.' };
  if (!event.providerAccountId) return { action: 'ignore', reason: 'Missing SMS provider account identity.' };
  if (!event.participantPhone) return { action: 'ignore', reason: 'Missing SMS sender phone.' };
  if (!event.messageId) return { action: 'ignore', reason: 'Missing SMS provider message id.' };

  const text = cleanText(event.text);
  if (!text) return { action: 'review', reason: 'No SMS message text captured.' };
  if (text.length > 1600) return { action: 'review', reason: 'SMS message exceeded review length threshold.' };

  return { action: 'promote', reason: null };
}

export function smsProviderDisplayName(event) {
  const phone = cleanText(event.participantPhone);
  return `SMS User ${phone.slice(-6) || 'Unknown'}`;
}

async function createSmsContactAndLead(client, organizationId, businessUnitId, event, sourceRowId, existingContactId = null) {
  if (!businessUnitId) return { contactId: existingContactId, leadId: null, reason: 'No business unit found' };
  const assignedUserId = await resolveDefaultInboundLeadOwnerUserId(client, {
    organizationId,
    businessUnitId,
    sourceType: SMS_PROVIDER_BATCH_SOURCE_TYPE,
    sourceKey: event.participantPhone || event.messageId || sourceRowId,
  });

  let contactId = existingContactId || null;
  let createdContact = false;
  if (!contactId) {
    const contact = await client.query(
      `
        insert into contacts
        (organization_id, primary_business_unit_id, name, phone, source_label)
        values ($1, $2, $3, $4, 'SMS')
        returning id
      `,
      [
        organizationId,
        businessUnitId,
        smsProviderDisplayName(event),
        event.participantPhone,
      ],
    );
    contactId = contact.rows[0]?.id || null;
    createdContact = Boolean(contactId);
  }

  const lead = await client.query(
    `
      insert into leads
      (organization_id, business_unit_id, contact_id, source_type, source_name, status, current_stage, original_notes, assigned_user_id)
      values ($1, $2, $3, 'sms_provider_webhook', 'SMS', 'New Lead', 'New Lead', $4, $5)
      returning id
    `,
    [
      organizationId,
      businessUnitId,
      contactId,
      `SMS provider=${event.provider || 'unknown'} participant=${event.participantPhone || 'unknown'} provider_account_id=${event.providerAccountId || 'unknown'} source_row_id=${sourceRowId || 'unknown'}`,
      assignedUserId,
    ],
  );

  const leadId = lead.rows[0]?.id || null;
  await recordInboundLeadAssignmentActivity(client, {
    organizationId,
    businessUnitId,
    contactId,
    leadId,
    ownerUserId: assignedUserId,
  });

  return { contactId, leadId, assignedUserId, createdContact, reason: null };
}

async function logSmsActivity(client, organizationId, businessUnitId, event, crmIds, rowNumber) {
  await client.query(
    `
      insert into activity_events
      (organization_id, business_unit_id, contact_id, lead_id, event_type, message, source_sheet, source_row, occurred_at)
      values ($1, $2, $3, $4, 'sms_message', $5, $6, $7, $8)
    `,
    [
      organizationId,
      businessUnitId,
      crmIds.contactId || null,
      crmIds.leadId || null,
      smsMessageText(event),
      SMS_PROVIDER_SOURCE_SHEET,
      rowNumber,
      event.occurredAt || new Date(),
    ],
  );
}

async function recordSmsConsentIfNeeded(client, organizationId, businessUnitId, event, contactId) {
  const keyword = classifySmsKeyword(event.consentKeyword || event.text || '');
  if (!keyword.eventType || !contactId) return null;

  return recordSmsConsentEvent(client, {
    organizationId,
    contactId,
    businessUnitId,
    eventType: keyword.eventType,
    sourceType: SMS_CONSENT_SOURCE_TYPES.PROVIDER_WEBHOOK,
    sourceReference: event.messageId,
    provider: event.provider,
    providerEventId: event.eventId,
    idempotencyKey: `${event.provider}:sms-consent:${event.eventId || event.messageId}:${keyword.eventType}`,
    optOutReason: keyword.eventType === SMS_CONSENT_EVENT_TYPES.OPT_OUT ? keyword.keyword : null,
    metadataJson: {
      providerEventType: event.eventType,
      providerAccountId: event.providerAccountId,
      participantPhone: event.participantPhone,
    },
    occurredAt: event.occurredAt,
  }, { useTransaction: false });
}

function smsEventResult(event, values = {}) {
  return {
    eventKey: smsProviderEventKey(event),
    provider: event.provider || null,
    channel: 'sms',
    kind: event.kind || null,
    eventType: event.eventType || null,
    eventId: event.eventId || null,
    conversationKey: event.providerAccountId && event.participantPhone
      ? `${event.provider}:sms:${event.providerAccountId}:${event.participantPhone}`
      : null,
    providerAccountId: event.providerAccountId || null,
    ownedNumber: event.ownedNumber || null,
    participantPhone: event.participantPhone || null,
    messageId: event.messageId || null,
    deliveryStatus: event.deliveryStatus || null,
    timestamp: event.occurredAt instanceof Date ? event.occurredAt.toISOString() : null,
    messageText: event.text || null,
    ...values,
  };
}

export async function persistSmsInboundEvent(
  client,
  { organizationId, batchId, rowNumber, event, smsConfig },
) {
  const classification = classifySmsProviderInboundEvent(event);
  if (classification.action === 'ignore') {
    return smsEventResult(event, {
      inserted: false,
      promoted: false,
      linked: false,
      review: false,
      consentRecorded: false,
      classificationAction: classification.action,
      classificationReason: classification.reason,
      skippedReason: classification.reason,
    });
  }

  const route = await resolveSmsBusinessUnitRoute(client, organizationId, event, smsConfig);
  const businessUnitId = route.businessUnitId || null;
  if (await hasSmsMessageId(client, organizationId, event)) {
    return smsEventResult(event, {
      inserted: false,
      promoted: false,
      linked: false,
      review: false,
      consentRecorded: false,
      classificationAction: classification.action,
      classificationReason: classification.reason,
      skippedReason: 'duplicate_sms_message_id',
      businessUnitId,
      channelId: route.channelId,
    });
  }

  const existing = await findExistingSmsLead(client, organizationId, businessUnitId, event);
  const rawValues = {
    source: SMS_PROVIDER_BATCH_SOURCE_TYPE,
    provider: event.provider,
    event_type: event.eventType,
    event_id: event.eventId,
    message_id: event.messageId,
    provider_account_id: event.providerAccountId,
    owned_number: event.ownedNumber,
    participant_phone: event.participantPhone,
    sender_phone: event.senderPhone,
    recipient_phone: event.recipientPhone,
    text: event.text || null,
    timestamp: event.occurredAt instanceof Date ? event.occurredAt.toISOString() : null,
    raw: event.raw,
  };
  const rawText = JSON.stringify(rawValues);

  const sourceRow = await client.query(
    `
      insert into import_source_rows
      (import_batch_id, source_sheet, source_row_number, raw_values_json, raw_text, parse_status)
      values ($1, $2, $3, $4::jsonb, $5, 'parsed')
      returning id
    `,
    [batchId, SMS_PROVIDER_SOURCE_SHEET, rowNumber, JSON.stringify(rawValues), rawText],
  );
  const sourceRowId = sourceRow.rows[0]?.id;
  if (!sourceRowId) {
    return smsEventResult(event, {
      inserted: false,
      promoted: false,
      linked: false,
      review: false,
      consentRecorded: false,
      classificationAction: classification.action,
      classificationReason: classification.reason,
      skippedReason: 'source_row_insert_failed',
      businessUnitId,
      channelId: route.channelId,
    });
  }

  let crmWrite = existing || { contactId: null, leadId: null, reason: null };
  let action = crmWrite.leadId ? 'linked_message' : 'review_sms_message';
  const hadExistingContact = Boolean(crmWrite.contactId);
  const hadExistingLead = Boolean(crmWrite.leadId);
  if (classification.action === 'promote' && !crmWrite.leadId) {
    crmWrite = await createSmsContactAndLead(
      client,
      organizationId,
      businessUnitId,
      event,
      sourceRowId,
      crmWrite.contactId,
    );
    action = crmWrite.leadId
      ? (crmWrite.createdContact ? 'created_sms_lead' : 'created_sms_lead_for_contact')
      : 'review_sms_message';
  } else if (classification.action === 'review') {
    action = crmWrite.leadId ? 'linked_message_needs_review' : 'review_sms_message';
  }

  if (crmWrite.leadId) {
    await logSmsActivity(client, organizationId, businessUnitId, event, crmWrite, rowNumber);
  }

  const conversationWrite = await recordConversationMessage(
    client,
    smsConversationMessageInput({
      organizationId,
      businessUnitId,
      contactId: crmWrite.contactId,
      leadId: crmWrite.leadId,
      channelId: route.channelId,
      provider: event.provider,
      providerAccountId: event.providerAccountId,
      participantPhone: event.participantPhone,
      messageId: event.messageId,
      text: smsMessageText(event),
      timestamp: event.occurredAt,
      raw: event.raw || {},
    }),
    { useTransaction: false, preserveExistingOnConflict: true },
  );

  const consentWrite = await recordSmsConsentIfNeeded(client, organizationId, businessUnitId, event, crmWrite.contactId);
  const needsReview = classification.action !== 'promote' || !crmWrite.leadId;
  const proposedContact = {
    name: smsProviderDisplayName(event),
    phone: event.participantPhone,
    source_label: 'SMS',
    business_unit_id: businessUnitId,
    contact_id: crmWrite.contactId,
    provider: event.provider,
    provider_account_id: event.providerAccountId,
  };
  const proposedLead = {
    source_type: SMS_PROVIDER_BATCH_SOURCE_TYPE,
    source_name: 'SMS',
    provider: event.provider,
    provider_account_id: event.providerAccountId,
    message_id: event.messageId,
    status: 'New Lead',
    current_stage: 'New Lead',
    business_unit_id: businessUnitId,
    contact_id: crmWrite.contactId,
    lead_id: crmWrite.leadId,
    assigned_user_id: crmWrite.assignedUserId || null,
    first_message: smsMessageText(event),
    notes: !needsReview
      ? 'SMS message captured and linked to CRM lead.'
      : `SMS message captured but needs review: ${crmWrite.reason || classification.reason || 'unknown reason'}`,
  };

  const normalized = await client.query(
    `
      insert into import_normalized_records
      (import_batch_id, source_row_id, record_type, proposed_contact_json, proposed_lead_json, confidence_score, status)
      values ($1, $2, 'lead', $3::jsonb, $4::jsonb, $5, $6)
      returning id
    `,
    [
      batchId,
      sourceRowId,
      JSON.stringify(proposedContact),
      JSON.stringify(proposedLead),
      !needsReview ? 0.78 : 0.3,
      !needsReview ? 'promoted' : 'needs_review',
    ],
  );
  const normalizedId = normalized.rows[0]?.id || null;

  await client.query(
    `
      insert into import_review_items
      (import_batch_id, source_row_id, review_type, reason, review_status, proposed_resolution_json)
      values ($1, $2, 'sms_provider_review', $3, $4, $5::jsonb)
    `,
    [
      batchId,
      sourceRowId,
      !needsReview
        ? 'SMS message captured and linked to CRM.'
        : `SMS message needs review: ${crmWrite.reason || classification.reason || 'unknown reason'}.`,
      !needsReview ? 'resolved' : 'pending',
      JSON.stringify({
        action,
        normalizedRecordId: normalizedId,
        contactId: crmWrite.contactId,
        leadId: crmWrite.leadId,
        consentEventId: consentWrite?.eventId || null,
      }),
    ],
  );

  return smsEventResult(event, {
    inserted: true,
    promoted: Boolean(crmWrite.leadId && !hadExistingLead),
    linked: Boolean(hadExistingLead),
    review: needsReview,
    consentRecorded: Boolean(consentWrite && !consentWrite.duplicate),
    consentDuplicate: Boolean(consentWrite?.duplicate),
    consentEventType: consentWrite?.eventType || null,
    consentStatus: consentWrite?.consentStatus || null,
    classificationAction: classification.action,
    classificationReason: classification.reason,
    action,
    businessUnitId,
    channelId: route.channelId,
    sourceRowId,
    sourceRowNumber: rowNumber,
    normalizedRecordId: normalizedId,
    contactId: crmWrite.contactId,
    leadId: crmWrite.leadId,
    conversationId: conversationWrite.conversationId,
    conversationMessageId: conversationWrite.messageId,
    conversationMessageInserted: conversationWrite.inserted,
    conversationIdempotencyKey: conversationWrite.idempotencyKey,
    providerConversationKey: conversationWrite.conversationKey,
    existingContact: hadExistingContact,
    existingLead: hadExistingLead,
  });
}

export async function persistSmsDeliveryStatusEvent(client, { organizationId, event }) {
  if (event.kind !== SMS_EVENT_KINDS.DELIVERY_STATUS) {
    return smsEventResult(event, {
      deliveryUpdated: false,
      skippedReason: 'not_delivery_status_event',
    });
  }
  if (!event.messageId) {
    return smsEventResult(event, {
      deliveryUpdated: false,
      skippedReason: 'missing_provider_message_id',
    });
  }

  const existing = await client.query(
    `
      select id
      from conversation_messages
      where organization_id = $1
        and provider = $2
        and channel = 'sms'
        and external_message_id = $3
      order by created_at desc
      limit 1
    `,
    [organizationId, event.provider, event.messageId],
  );
  const messageId = existing.rows[0]?.id || null;
  if (!messageId) {
    return smsEventResult(event, {
      deliveryUpdated: false,
      skippedReason: 'outbound_sms_message_not_found',
    });
  }

  const updated = await updateConversationMessageDeliveryStatus(client, {
    organizationId,
    messageId,
    deliveryStatus: event.deliveryStatus,
    externalMessageId: event.messageId,
    rawPayloadJson: event.raw || {},
    errorCode: cleanNullableText(event.errorCode),
    errorMessage: cleanNullableText(event.errorMessage),
  });

  return smsEventResult(event, {
    deliveryUpdated: Boolean(updated),
    conversationMessageId: updated?.id || messageId,
    deliveryStatus: updated?.delivery_status || event.deliveryStatus,
    errorCode: updated?.error_code || null,
    errorMessage: updated?.error_message || null,
  });
}

function emptySmsProviderResult(batchId = null) {
  return {
    received: 0,
    inserted: 0,
    promoted: 0,
    linked: 0,
    review: 0,
    skipped: 0,
    consentRecorded: 0,
    deliveryUpdated: 0,
    batchId,
    eventResults: [],
  };
}

export async function ingestSmsProviderEvents(
  client,
  { organizationId, batchId: preparedBatchId = null, events = [], smsConfig = {} },
) {
  if (!events.length) return emptySmsProviderResult(preparedBatchId);

  const inboundEvents = events.filter((event) => event.kind === SMS_EVENT_KINDS.INBOUND_MESSAGE);
  const batchId = inboundEvents.length
    ? preparedBatchId || await findOrCreateSmsProviderBatch(client, organizationId)
    : preparedBatchId;
  if (inboundEvents.length && !batchId) {
    return {
      ...emptySmsProviderResult(null),
      received: events.length,
      skipped: events.length,
      reason: 'Failed to resolve SMS provider import batch',
    };
  }

  let inserted = 0;
  let promoted = 0;
  let linked = 0;
  let review = 0;
  let skipped = 0;
  let consentRecorded = 0;
  let deliveryUpdated = 0;
  const eventResults = [];

  for (const event of events) {
    const eventKey = smsProviderEventKey(event);
    const stored = await withSerializedWebhookEvent(client, eventKey, async () => {
      if (event.kind === SMS_EVENT_KINDS.DELIVERY_STATUS) {
        return persistSmsDeliveryStatusEvent(client, { organizationId, event });
      }
      const rowNumber = await lockedNextRowNumber(client, batchId);
      return persistSmsInboundEvent(client, {
        organizationId,
        batchId,
        rowNumber,
        event,
        smsConfig,
      });
    });
    eventResults.push(stored);

    if (stored.inserted) {
      inserted += 1;
      if (stored.promoted) promoted += 1;
      if (stored.linked) linked += 1;
      if (stored.review) review += 1;
      if (stored.consentRecorded) consentRecorded += 1;
    } else if (stored.deliveryUpdated) {
      deliveryUpdated += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    received: events.length,
    inserted,
    promoted,
    linked,
    review,
    skipped,
    consentRecorded,
    deliveryUpdated,
    batchId,
    eventResults,
  };
}
