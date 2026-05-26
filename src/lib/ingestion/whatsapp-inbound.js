import {
  resolveMetaWhatsAppBusinessUnitMapping,
} from '../messaging/providers/meta.js';
import {
  recordInboundLeadAssignmentActivity,
  resolveDefaultInboundLeadOwnerUserId,
} from '../crm/assignment.js';
import {
  recordConversationMessage,
  whatsappConversationMessageInput,
} from '../conversations/service.js';

export const WHATSAPP_INBOUND_BATCH_SOURCE_NAME = 'WhatsApp';
export const WHATSAPP_INBOUND_BATCH_SOURCE_TYPE = 'whatsapp_inbound';
export const WHATSAPP_INBOUND_SOURCE_SHEET = 'whatsapp_inbound';
export const WHATSAPP_INBOUND_FILE_PREFIX = 'whatsapp-inbound';
export const WHATSAPP_INBOUND_REVIEW_TYPE = 'whatsapp_inbound_review';

function cleanText(value) {
  return String(value || '').trim();
}

export function normalizeWhatsAppPhoneIdentity(value) {
  return cleanText(value).replace(/\D+/g, '');
}

function formattedWhatsAppPhone(value) {
  const digits = normalizeWhatsAppPhoneIdentity(value);
  return digits ? `+${digits}` : null;
}

function whatsappMessageText(event) {
  const text = cleanText(event.text);
  if (text) return text;
  if (Array.isArray(event.attachments) && event.attachments.length) {
    return `[WhatsApp ${cleanText(event.messageType) || 'attachment'}]`;
  }
  return '[WhatsApp message]';
}

export function whatsappInboundEventKey(event) {
  if (event.messageId) return `whatsapp-message:${event.phoneNumberId || 'unknown'}:${event.messageId}`;
  return [
    'whatsapp-fallback',
    event.phoneNumberId || 'unknown',
    event.waId || event.from || 'unknown',
    event.timestamp || 'unknown',
    event.messageType || 'unknown',
    event.text || '[attachment]',
  ].join(':');
}

export async function findOrCreateWhatsAppInboundBatch(client, organizationId, options = {}) {
  const sourceName = options.sourceName || WHATSAPP_INBOUND_BATCH_SOURCE_NAME;
  const sourceType = options.sourceType || WHATSAPP_INBOUND_BATCH_SOURCE_TYPE;
  const filePrefix = options.filePrefix || WHATSAPP_INBOUND_FILE_PREFIX;
  const sheetName = options.sheetName || WHATSAPP_INBOUND_SOURCE_SHEET;
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

export async function resolveWhatsAppBusinessUnitRoute(client, organizationId, event, metaConfig = {}) {
  let channelId = null;
  if (event.phoneNumberId) {
    const channelResult = await client.query(
      `
        select cc.id, cc.business_unit_id::text as business_unit_id
        from conversation_channels cc
        left join business_units bu
          on bu.id = cc.business_unit_id
          and bu.organization_id = cc.organization_id
          and bu.is_active = true
        where cc.organization_id = $1
          and cc.provider = 'meta'
          and cc.channel = 'whatsapp'
          and cc.provider_account_id = $2
          and cc.is_active = true
          and (cc.business_unit_id is null or bu.id is not null)
        order by cc.created_at desc
        limit 1
      `,
      [organizationId, event.phoneNumberId],
    );
    channelId = channelResult.rows[0]?.id || null;
    if (channelResult.rows[0]?.business_unit_id) {
      return { businessUnitId: channelResult.rows[0].business_unit_id, channelId };
    }
  }

  const mapped = resolveMetaWhatsAppBusinessUnitMapping(
    event.phoneNumberId,
    event.displayPhoneNumber,
    metaConfig,
  ).businessUnit;
  const mappedBusinessUnitId = await resolveMappedBusinessUnitId(client, organizationId, mapped);
  if (mappedBusinessUnitId) return { businessUnitId: mappedBusinessUnitId, channelId };

  return {
    businessUnitId: await resolveFallbackBusinessUnitId(client, organizationId),
    channelId,
  };
}

async function hasWhatsAppMessageId(client, organizationId, messageId, phoneNumberId) {
  if (!messageId) return false;
  const result = await client.query(
    `
      select 1
      from conversation_messages
      where organization_id = $1
        and provider = 'meta'
        and channel = 'whatsapp'
        and provider_account_id = $2
        and external_message_id = $3
      limit 1
    `,
    [organizationId, phoneNumberId || '', messageId],
  );
  return Boolean(result.rows.length);
}

async function findExistingWhatsAppLead(client, organizationId, businessUnitId, event) {
  if (!businessUnitId || !event.waId) return null;

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
        and conv.provider = 'meta'
        and conv.channel = 'whatsapp'
        and conv.provider_account_id = $2
        and conv.external_participant_id = $3
        and (conv.business_unit_id is null or conv.business_unit_id::text = $4)
        and (c.id is not null or l.id is not null)
      order by conv.updated_at desc
      limit 1
    `,
    [organizationId, event.phoneNumberId || '', event.waId, businessUnitId],
  );
  if (conversationResult.rows[0]?.contact_id || conversationResult.rows[0]?.lead_id) {
    return {
      contactId: conversationResult.rows[0].contact_id || null,
      leadId: conversationResult.rows[0].lead_id || null,
    };
  }

  const phoneDigits = normalizeWhatsAppPhoneIdentity(event.waId || event.from);
  if (!phoneDigits) return null;
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
    [organizationId, phoneDigits, businessUnitId],
  );
  const row = contactResult.rows[0] || null;
  if (!row?.contact_id) return null;
  return {
    contactId: row.contact_id || null,
    leadId: row.lead_id || null,
  };
}

export function classifyWhatsAppInboundEvent(event) {
  if (!event.phoneNumberId) return { action: 'ignore', reason: 'Missing WhatsApp phone number id.' };
  if (!event.waId && !event.from) return { action: 'ignore', reason: 'Missing WhatsApp sender id.' };
  if (!event.messageId) return { action: 'ignore', reason: 'Missing WhatsApp message id.' };

  const text = cleanText(event.text);
  const hasAttachments = Array.isArray(event.attachments) && event.attachments.length > 0;
  const messageType = cleanText(event.messageType).toLowerCase();
  if (!text && !hasAttachments) {
    return { action: 'review', reason: 'No message text or supported attachment payload.' };
  }
  if (messageType && messageType !== 'text' && !text) {
    return { action: 'review', reason: `WhatsApp ${messageType} message requires review.` };
  }

  const suspiciousPatterns = [
    /\b(?:crypto|forex|casino|porn|xxx|loan offer|investment opportunity)\b/i,
    /(?:t\.me|telegram\.me|bit\.ly|tinyurl\.com)\//i,
  ];
  if (text.length > 2000 || suspiciousPatterns.some((pattern) => pattern.test(text))) {
    return { action: 'review', reason: 'Message matched basic spam filter.' };
  }

  return { action: 'promote', reason: null };
}

export function whatsappInboundDisplayName(event) {
  const name = cleanText(event.contactProfileName);
  if (name) return name;
  const identity = cleanText(event.waId || event.from);
  return `WhatsApp User ${identity.slice(-6) || 'Unknown'}`;
}

async function createWhatsAppContactAndLead(client, organizationId, businessUnitId, event, sourceRowId, existingContactId = null) {
  if (!businessUnitId) return { contactId: existingContactId, leadId: null, reason: 'No business unit found' };
  const assignedUserId = await resolveDefaultInboundLeadOwnerUserId(client, {
    organizationId,
    businessUnitId,
    sourceType: WHATSAPP_INBOUND_BATCH_SOURCE_TYPE,
    sourceKey: event.waId || event.messageId || sourceRowId,
  });

  let contactId = existingContactId || null;
  let createdContact = false;
  if (!contactId) {
    const contact = await client.query(
      `
        insert into contacts
        (organization_id, primary_business_unit_id, name, phone, source_label)
        values ($1, $2, $3, $4, 'WhatsApp')
        returning id
      `,
      [
        organizationId,
        businessUnitId,
        whatsappInboundDisplayName(event),
        formattedWhatsAppPhone(event.waId || event.from),
      ],
    );
    contactId = contact.rows[0]?.id || null;
    createdContact = Boolean(contactId);
  }

  const lead = await client.query(
    `
      insert into leads
      (organization_id, business_unit_id, contact_id, source_type, source_name, status, current_stage, original_notes, assigned_user_id)
      values ($1, $2, $3, 'whatsapp_inbound', 'WhatsApp', 'New Lead', 'New Lead', $4, $5)
      returning id
    `,
    [
      organizationId,
      businessUnitId,
      contactId,
      `WhatsApp wa_id=${event.waId || event.from || 'unknown'} phone_number_id=${event.phoneNumberId || 'unknown'} source_row_id=${sourceRowId || 'unknown'}`,
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

async function logWhatsAppActivity(client, organizationId, businessUnitId, event, crmIds, rowNumber) {
  await client.query(
    `
      insert into activity_events
      (organization_id, business_unit_id, contact_id, lead_id, event_type, message, source_sheet, source_row, occurred_at)
      values ($1, $2, $3, $4, 'whatsapp_message', $5, $6, $7, $8)
    `,
    [
      organizationId,
      businessUnitId,
      crmIds.contactId || null,
      crmIds.leadId || null,
      whatsappMessageText(event),
      WHATSAPP_INBOUND_SOURCE_SHEET,
      rowNumber,
      event.timestamp ? new Date(Number(event.timestamp) * 1000) : new Date(),
    ],
  );
}

function whatsappEventResult(event, values = {}) {
  const attachments = Array.isArray(event.attachments) ? event.attachments : [];
  return {
    eventKey: whatsappInboundEventKey(event),
    provider: 'meta',
    channel: 'whatsapp',
    entryId: event.entryId || null,
    conversationKey: event.phoneNumberId && event.waId ? `meta:whatsapp:${event.phoneNumberId}:${event.waId}` : null,
    messageType: event.messageType || 'unknown',
    waId: event.waId || null,
    from: event.from || null,
    phoneNumberId: event.phoneNumberId || null,
    displayPhoneNumber: event.displayPhoneNumber || null,
    messageId: event.messageId || null,
    timestamp: event.timestamp || null,
    messageText: event.text || null,
    attachments,
    attachmentCount: attachments.length,
    ...values,
  };
}

export async function persistWhatsAppInboundEvent(
  client,
  { organizationId, batchId, rowNumber, event, metaConfig },
) {
  const classification = classifyWhatsAppInboundEvent(event);
  if (classification.action === 'ignore') {
    return whatsappEventResult(event, {
      inserted: false,
      promoted: false,
      linked: false,
      review: false,
      classificationAction: classification.action,
      classificationReason: classification.reason,
      skippedReason: classification.reason,
    });
  }

  const route = await resolveWhatsAppBusinessUnitRoute(client, organizationId, event, metaConfig);
  const businessUnitId = route.businessUnitId || null;
  if (event.messageId && await hasWhatsAppMessageId(client, organizationId, event.messageId, event.phoneNumberId)) {
    return whatsappEventResult(event, {
      inserted: false,
      promoted: false,
      linked: false,
      review: false,
      classificationAction: classification.action,
      classificationReason: classification.reason,
      skippedReason: 'duplicate_whatsapp_message_id',
      businessUnitId,
      channelId: route.channelId,
    });
  }

  const existing = await findExistingWhatsAppLead(client, organizationId, businessUnitId, event);
  const rawValues = {
    source: WHATSAPP_INBOUND_BATCH_SOURCE_TYPE,
    whatsapp_wa_id: event.waId,
    from: event.from || null,
    phone_number_id: event.phoneNumberId,
    display_phone_number: event.displayPhoneNumber || null,
    message_id: event.messageId,
    message_type: event.messageType,
    text: event.text || null,
    attachments: Array.isArray(event.attachments) ? event.attachments : [],
    timestamp: event.timestamp,
    contact_profile_name: event.contactProfileName || null,
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
    [batchId, WHATSAPP_INBOUND_SOURCE_SHEET, rowNumber, JSON.stringify(rawValues), rawText],
  );
  const sourceRowId = sourceRow.rows[0]?.id;
  if (!sourceRowId) {
    return whatsappEventResult(event, {
      inserted: false,
      promoted: false,
      linked: false,
      review: false,
      classificationAction: classification.action,
      classificationReason: classification.reason,
      skippedReason: 'source_row_insert_failed',
      businessUnitId,
      channelId: route.channelId,
    });
  }

  let crmWrite = existing || { contactId: null, leadId: null, reason: null };
  let action = crmWrite.leadId ? 'linked_message' : 'review_whatsapp_message';
  const hadExistingContact = Boolean(crmWrite.contactId);
  const hadExistingLead = Boolean(crmWrite.leadId);
  if (classification.action === 'promote' && !crmWrite.leadId) {
    crmWrite = await createWhatsAppContactAndLead(
      client,
      organizationId,
      businessUnitId,
      event,
      sourceRowId,
      crmWrite.contactId,
    );
    action = crmWrite.leadId
      ? (crmWrite.createdContact ? 'created_whatsapp_lead' : 'created_whatsapp_lead_for_contact')
      : 'review_whatsapp_message';
  } else if (classification.action === 'review') {
    action = crmWrite.leadId ? 'linked_message_needs_review' : 'review_whatsapp_message';
  }

  if (crmWrite.leadId) {
    await logWhatsAppActivity(client, organizationId, businessUnitId, event, crmWrite, rowNumber);
  }

  const conversationWrite = await recordConversationMessage(
    client,
    whatsappConversationMessageInput({
      organizationId,
      businessUnitId,
      contactId: crmWrite.contactId,
      leadId: crmWrite.leadId,
      channelId: route.channelId,
      phoneNumberId: event.phoneNumberId,
      waId: event.waId || event.from,
      messageId: event.messageId,
      text: whatsappMessageText(event),
      timestamp: event.timestamp,
      raw: event.raw || {},
    }),
    { useTransaction: false },
  );

  const needsReview = classification.action !== 'promote' || !crmWrite.leadId;
  const proposedContact = {
    name: whatsappInboundDisplayName(event),
    phone: formattedWhatsAppPhone(event.waId || event.from),
    source_label: 'WhatsApp',
    business_unit_id: businessUnitId,
    contact_id: crmWrite.contactId,
    whatsapp_wa_id: event.waId,
    phone_number_id: event.phoneNumberId,
    display_phone_number: event.displayPhoneNumber || null,
  };
  const proposedLead = {
    source_type: WHATSAPP_INBOUND_BATCH_SOURCE_TYPE,
    source_name: 'WhatsApp',
    whatsapp_wa_id: event.waId,
    phone_number_id: event.phoneNumberId,
    message_id: event.messageId,
    message_type: event.messageType,
    status: 'New Lead',
    current_stage: 'New Lead',
    business_unit_id: businessUnitId,
    contact_id: crmWrite.contactId,
    lead_id: crmWrite.leadId,
    assigned_user_id: crmWrite.assignedUserId || null,
    first_message: whatsappMessageText(event),
    notes: !needsReview
      ? 'WhatsApp message captured and linked to CRM lead.'
      : `WhatsApp message captured but needs review: ${crmWrite.reason || classification.reason || 'unknown reason'}`,
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
      !needsReview ? 0.8 : 0.3,
      !needsReview ? 'promoted' : 'needs_review',
    ],
  );
  const normalizedId = normalized.rows[0]?.id || null;

  await client.query(
    `
      insert into import_review_items
      (import_batch_id, source_row_id, review_type, reason, review_status, proposed_resolution_json)
      values ($1, $2, 'whatsapp_inbound_review', $3, $4, $5::jsonb)
    `,
    [
      batchId,
      sourceRowId,
      !needsReview
        ? 'WhatsApp message captured and linked to CRM.'
        : `WhatsApp message needs review: ${crmWrite.reason || classification.reason || 'unknown reason'}.`,
      !needsReview ? 'resolved' : 'pending',
      JSON.stringify({
        action,
        normalizedRecordId: normalizedId,
        contactId: crmWrite.contactId,
        leadId: crmWrite.leadId,
      }),
    ],
  );

  return whatsappEventResult(event, {
    inserted: true,
    promoted: Boolean(crmWrite.leadId && !hadExistingLead),
    linked: Boolean(hadExistingLead),
    review: needsReview,
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

function emptyWhatsAppInboundResult(batchId = null) {
  return {
    received: 0,
    inserted: 0,
    promoted: 0,
    linked: 0,
    review: 0,
    skipped: 0,
    batchId,
    eventResults: [],
  };
}

export async function ingestWhatsAppInboundEvents(
  client,
  { organizationId, batchId: preparedBatchId = null, events = [], metaConfig },
) {
  if (!events.length) return emptyWhatsAppInboundResult(preparedBatchId);

  const batchId = preparedBatchId || await findOrCreateWhatsAppInboundBatch(client, organizationId);
  if (!batchId) {
    return {
      ...emptyWhatsAppInboundResult(null),
      received: events.length,
      skipped: events.length,
      reason: 'Failed to resolve WhatsApp import batch',
    };
  }

  let inserted = 0;
  let promoted = 0;
  let linked = 0;
  let review = 0;
  let skipped = 0;
  const eventResults = [];

  for (const event of events) {
    const eventKey = whatsappInboundEventKey(event);
    const stored = await withSerializedWebhookEvent(client, eventKey, async () => {
      const rowNumber = await lockedNextRowNumber(client, batchId);
      return persistWhatsAppInboundEvent(client, {
        organizationId,
        batchId,
        rowNumber,
        event,
        metaConfig,
      });
    });
    eventResults.push(stored);

    if (stored.inserted) {
      inserted += 1;
      if (stored.promoted) promoted += 1;
      if (stored.linked) linked += 1;
      if (stored.review) review += 1;
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
    batchId,
    eventResults,
  };
}
