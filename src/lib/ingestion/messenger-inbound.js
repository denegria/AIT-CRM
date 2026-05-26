import {
  fetchMetaMessengerProfile,
  resolveMetaPageBusinessUnitMapping,
} from '../messaging/providers/meta.js';
import {
  recordInboundLeadAssignmentActivity,
  resolveDefaultInboundLeadOwnerUserId,
} from '../crm/assignment.js';
import {
  messengerConversationMessageInput,
  recordConversationMessage,
} from '../conversations/service.js';

export const MESSENGER_INBOUND_BATCH_SOURCE_NAME = 'Facebook Messenger';
export const MESSENGER_INBOUND_BATCH_SOURCE_TYPE = 'facebook_messenger';
export const MESSENGER_INBOUND_SOURCE_SHEET = 'facebook_messenger';
export const MESSENGER_INBOUND_FILE_PREFIX = 'facebook-messenger';
export const MESSENGER_INBOUND_REVIEW_TYPE = 'facebook_messenger_review';

export function messengerInboundEventKey(event) {
  if (event.messageId) return `facebook-messenger-message:${event.pageId || 'unknown'}:${event.messageId}`;
  return [
    'facebook-messenger-fallback',
    event.pageId || 'unknown',
    event.senderId || 'unknown',
    event.timestamp || 'unknown',
    event.postbackPayload || event.text || '[attachment]',
  ].join(':');
}

export async function findOrCreateMessengerInboundBatch(client, organizationId, options = {}) {
  const sourceName = options.sourceName || MESSENGER_INBOUND_BATCH_SOURCE_NAME;
  const sourceType = options.sourceType || MESSENGER_INBOUND_BATCH_SOURCE_TYPE;
  const filePrefix = options.filePrefix || MESSENGER_INBOUND_FILE_PREFIX;
  const sheetName = options.sheetName || MESSENGER_INBOUND_SOURCE_SHEET;
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

async function resolveBusinessUnitId(client, organizationId, pageId, metaConfig) {
  const mapped = resolveMetaPageBusinessUnitMapping(pageId, metaConfig).businessUnit;
  if (mapped) {
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
    if (mappedResult.rows[0]?.id) return mappedResult.rows[0].id;
  }

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

async function hasMessengerMessageId(client, organizationId, businessUnitId, messageId, pageId) {
  if (!messageId) return false;
  const result = await client.query(
    `
      select 1
      from import_normalized_records nr
      join import_batches ib on ib.id = nr.import_batch_id
      where ib.organization_id = $1
        and nr.record_type = 'lead'
        and coalesce(nr.proposed_lead_json->>'message_id', '') = $2
        and coalesce(nr.proposed_lead_json->>'page_id', '') = $3
        and ($4 = '' or coalesce(nr.proposed_lead_json->>'business_unit_id', '') = $4)
      limit 1
    `,
    [organizationId, messageId, pageId || '', businessUnitId || ''],
  );
  return Boolean(result.rows.length);
}

async function findExistingMessengerLead(client, organizationId, businessUnitId, senderId, pageId) {
  if (!senderId) return null;
  const result = await client.query(
    `
      select l.id::text as lead_id, l.contact_id::text as contact_id
      from import_normalized_records nr
      join import_batches ib on ib.id = nr.import_batch_id
      join leads l
        on l.id::text = nullif(nr.proposed_lead_json->>'lead_id', '')
        and l.organization_id = ib.organization_id
        and ($4 = '' or l.business_unit_id::text = $4)
      left join contacts c
        on c.id = l.contact_id
        and c.organization_id = ib.organization_id
        and ($4 = '' or c.primary_business_unit_id::text = $4)
      where ib.organization_id = $1
        and nr.record_type = 'lead'
        and coalesce(nr.proposed_lead_json->>'messenger_sender_id', '') = $2
        and coalesce(nr.proposed_lead_json->>'page_id', '') = $3
        and (l.contact_id is null or c.id is not null)
      order by nr.created_at asc
      limit 1
    `,
    [organizationId, senderId, pageId || '', businessUnitId || ''],
  );
  const lead = result.rows[0] || null;
  if (!lead?.lead_id) return null;
  return {
    contactId: lead.contact_id || null,
    leadId: lead.lead_id || null,
  };
}

export function classifyMessengerInboundEvent(event) {
  if (!event.senderId) return { action: 'ignore', reason: 'Missing Messenger sender id.' };
  if (event.senderId === event.pageId) return { action: 'ignore', reason: 'Ignoring Page self-message.' };

  const text = String(event.text || '').trim();
  const hasPostback = Boolean(event.postbackPayload);
  const hasAttachments = Array.isArray(event.attachments) && event.attachments.length > 0;
  if (!text && !hasPostback && !hasAttachments) {
    return { action: 'ignore', reason: 'No message text, attachment, or postback payload.' };
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

export function messengerInboundDisplayName(profile, senderId) {
  const name = String(profile?.name || [profile?.first_name, profile?.last_name].filter(Boolean).join(' ')).trim();
  if (name) return name;
  return `Messenger User ${String(senderId || '').slice(-6) || 'Unknown'}`;
}

async function createMessengerContactAndLead(client, organizationId, businessUnitId, event, profile, sourceRowId) {
  if (!businessUnitId) return { contactId: null, leadId: null, reason: 'No business unit found' };
  const assignedUserId = await resolveDefaultInboundLeadOwnerUserId(client, {
    organizationId,
    businessUnitId,
    sourceType: 'facebook_messenger',
    sourceKey: event.senderId || event.messageId || sourceRowId,
  });

  const contact = await client.query(
    `
      insert into contacts
      (organization_id, primary_business_unit_id, name, source_label)
      values ($1, $2, $3, 'Facebook Messenger')
      returning id
    `,
    [organizationId, businessUnitId, messengerInboundDisplayName(profile, event.senderId)],
  );
  const contactId = contact.rows[0]?.id || null;

  const lead = await client.query(
    `
      insert into leads
      (organization_id, business_unit_id, contact_id, source_type, source_name, status, current_stage, original_notes, assigned_user_id)
      values ($1, $2, $3, 'facebook_messenger', 'Facebook Messenger', 'New Lead', 'New Lead', $4, $5)
      returning id
    `,
    [
      organizationId,
      businessUnitId,
      contactId,
      `Messenger sender_id=${event.senderId || 'unknown'} page_id=${event.pageId || 'unknown'} source_row_id=${sourceRowId || 'unknown'}`,
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

  return { contactId, leadId, assignedUserId, reason: null };
}

async function logMessengerActivity(client, organizationId, businessUnitId, event, crmIds, rowNumber) {
  await client.query(
    `
      insert into activity_events
      (organization_id, business_unit_id, contact_id, lead_id, event_type, message, source_sheet, source_row, occurred_at)
      values ($1, $2, $3, $4, 'facebook_messenger_message', $5, $6, $7, $8)
    `,
    [
      organizationId,
      businessUnitId,
      crmIds.contactId || null,
      crmIds.leadId || null,
      event.text || event.postbackPayload || '[Messenger attachment]',
      MESSENGER_INBOUND_SOURCE_SHEET,
      rowNumber,
      event.timestamp ? new Date(Number(event.timestamp)) : new Date(),
    ],
  );
}

function messengerEventResult(event, values = {}) {
  const attachments = Array.isArray(event.attachments) ? event.attachments : [];
  let messageType = 'unknown';
  if (event.postbackPayload) messageType = 'postback';
  else if (event.text) messageType = 'text';
  else if (attachments.length) messageType = 'attachment';
  return {
    eventKey: messengerInboundEventKey(event),
    provider: 'meta',
    channel: 'messenger',
    entryId: event.entryId || null,
    conversationKey: event.pageId && event.senderId ? `meta:messenger:${event.pageId}:${event.senderId}` : null,
    messageType,
    senderId: event.senderId || null,
    pageId: event.pageId || null,
    messageId: event.messageId || null,
    timestamp: event.timestamp || null,
    messageText: event.text || null,
    postbackPayload: event.postbackPayload || null,
    attachments,
    attachmentCount: attachments.length,
    ...values,
  };
}

export async function persistMessengerInboundEvent(
  client,
  { organizationId, batchId, rowNumber, event, metaConfig, fetchMessengerProfile = fetchMetaMessengerProfile },
) {
  const classification = classifyMessengerInboundEvent(event);
  if (classification.action === 'ignore') {
    return messengerEventResult(event, {
      inserted: false,
      promoted: false,
      linked: false,
      review: false,
      profileFetched: false,
      classificationAction: classification.action,
      classificationReason: classification.reason,
      skippedReason: classification.reason,
    });
  }
  const businessUnitId = await resolveBusinessUnitId(client, organizationId, event.pageId, metaConfig);
  if (event.messageId && await hasMessengerMessageId(client, organizationId, businessUnitId, event.messageId, event.pageId)) {
    return messengerEventResult(event, {
      inserted: false,
      promoted: false,
      linked: false,
      review: false,
      profileFetched: false,
      classificationAction: classification.action,
      classificationReason: classification.reason,
      skippedReason: 'duplicate_messenger_message_id',
    });
  }

  const profileFetch = await fetchMessengerProfile({ senderId: event.senderId, pageId: event.pageId, config: metaConfig });
  const profile = profileFetch.ok ? profileFetch.profile : null;
  const existing = await findExistingMessengerLead(client, organizationId, businessUnitId, event.senderId, event.pageId);

  const rawValues = {
    source: 'facebook_messenger',
    messenger_sender_id: event.senderId,
    page_id: event.pageId,
    message_id: event.messageId,
    text: event.text || null,
    attachments: Array.isArray(event.attachments) ? event.attachments : [],
    postback_payload: event.postbackPayload || null,
    timestamp: event.timestamp,
    profile_fetch: profileFetch.ok ? 'ok' : 'failed',
    profile_fetch_reason: profileFetch.ok ? null : profileFetch.reason,
    profile_fetch_code: profileFetch.ok ? null : profileFetch.code,
    profile,
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
    [batchId, MESSENGER_INBOUND_SOURCE_SHEET, rowNumber, JSON.stringify(rawValues), rawText],
  );
  const sourceRowId = sourceRow.rows[0]?.id;
  if (!sourceRowId) {
    return messengerEventResult(event, {
      inserted: false,
      promoted: false,
      linked: false,
      review: false,
      profileFetched: profileFetch.ok,
      profileFetchReason: profileFetch.ok ? null : profileFetch.reason,
      classificationAction: classification.action,
      classificationReason: classification.reason,
      skippedReason: 'source_row_insert_failed',
    });
  }

  let crmWrite = existing || { contactId: null, leadId: null, reason: null };
  let action = 'linked_message';
  if (!existing && classification.action === 'promote') {
    crmWrite = await createMessengerContactAndLead(client, organizationId, businessUnitId, event, profile, sourceRowId);
    action = crmWrite.leadId ? 'created_messenger_lead' : 'review_messenger_lead';
  } else if (classification.action === 'review') {
    action = 'review_messenger_message';
  }

  if (crmWrite.leadId) {
    await logMessengerActivity(client, organizationId, businessUnitId, event, crmWrite, rowNumber);
  }

  const conversationWrite = await recordConversationMessage(
    client,
    messengerConversationMessageInput({
      organizationId,
      businessUnitId,
      contactId: crmWrite.contactId,
      leadId: crmWrite.leadId,
      pageId: event.pageId,
      senderId: event.senderId,
      messageId: event.messageId,
      text: event.text || event.postbackPayload || (Array.isArray(event.attachments) && event.attachments.length ? '[Messenger attachment]' : null),
      timestamp: event.timestamp,
      raw: event.raw || {},
    }),
    { useTransaction: false },
  );

  const proposedContact = {
    name: messengerInboundDisplayName(profile, event.senderId),
    source_label: 'Facebook Messenger',
    business_unit_id: businessUnitId,
    contact_id: crmWrite.contactId,
    messenger_sender_id: event.senderId,
    page_id: event.pageId,
    profile,
  };
  const proposedLead = {
    source_type: 'facebook_messenger',
    source_name: 'Facebook Messenger',
    messenger_sender_id: event.senderId,
    page_id: event.pageId,
    message_id: event.messageId,
    status: 'New Lead',
    current_stage: 'New Lead',
    business_unit_id: businessUnitId,
    contact_id: crmWrite.contactId,
    lead_id: crmWrite.leadId,
    assigned_user_id: crmWrite.assignedUserId || null,
    first_message: event.text || event.postbackPayload || '[Messenger attachment]',
    profile,
    notes: crmWrite.leadId
      ? 'Messenger message captured and linked to CRM lead.'
      : `Messenger message captured but needs review: ${crmWrite.reason || classification.reason || profileFetch.reason || 'unknown reason'}`,
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
      crmWrite.leadId ? 0.8 : 0.3,
      crmWrite.leadId ? 'promoted' : 'needs_review',
    ],
  );
  const normalizedId = normalized.rows[0]?.id || null;

  await client.query(
    `
      insert into import_review_items
      (import_batch_id, source_row_id, review_type, reason, review_status, proposed_resolution_json)
      values ($1, $2, 'facebook_messenger_review', $3, $4, $5::jsonb)
    `,
    [
      batchId,
      sourceRowId,
      crmWrite.leadId
        ? 'Messenger message captured and linked to CRM.'
        : `Messenger message needs review: ${crmWrite.reason || classification.reason || profileFetch.reason || 'unknown reason'}.`,
      crmWrite.leadId ? 'resolved' : 'pending',
      JSON.stringify({
        action,
        normalizedRecordId: normalizedId,
        contactId: crmWrite.contactId,
        leadId: crmWrite.leadId,
      }),
    ],
  );

  return messengerEventResult(event, {
    inserted: true,
    promoted: Boolean(crmWrite.leadId && !existing),
    linked: Boolean(crmWrite.leadId && existing),
    profileFetched: profileFetch.ok,
    profileFetchReason: profileFetch.ok ? null : profileFetch.reason,
    profileFetchCode: profileFetch.ok ? null : profileFetch.code,
    review: !crmWrite.leadId,
    classificationAction: classification.action,
    classificationReason: classification.reason,
    action,
    businessUnitId,
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
    existingLead: Boolean(existing),
  });
}

function emptyMessengerInboundResult(batchId = null) {
  return {
    received: 0,
    inserted: 0,
    promoted: 0,
    linked: 0,
    review: 0,
    profileFetched: 0,
    skipped: 0,
    batchId,
    eventResults: [],
  };
}

export async function ingestMessengerInboundEvents(
  client,
  { organizationId, batchId: preparedBatchId = null, events = [], metaConfig, fetchMessengerProfile = fetchMetaMessengerProfile },
) {
  if (!events.length) return emptyMessengerInboundResult(preparedBatchId);

  const batchId = preparedBatchId || await findOrCreateMessengerInboundBatch(client, organizationId);
  if (!batchId) {
    return {
      ...emptyMessengerInboundResult(null),
      received: events.length,
      skipped: events.length,
      reason: 'Failed to resolve messenger import batch',
    };
  }

  let inserted = 0;
  let promoted = 0;
  let linked = 0;
  let review = 0;
  let profileFetched = 0;
  let skipped = 0;
  const eventResults = [];

  for (const event of events) {
    const eventKey = messengerInboundEventKey(event);
    const stored = await withSerializedWebhookEvent(client, eventKey, async () => {
      const rowNumber = await lockedNextRowNumber(client, batchId);
      return persistMessengerInboundEvent(client, {
        organizationId,
        batchId,
        rowNumber,
        event,
        metaConfig,
        fetchMessengerProfile,
      });
    });
    eventResults.push(stored);

    if (stored.inserted) {
      inserted += 1;
      if (stored.promoted) promoted += 1;
      if (stored.profileFetched) profileFetched += 1;
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
    profileFetched,
    skipped,
    batchId,
    eventResults,
  };
}
