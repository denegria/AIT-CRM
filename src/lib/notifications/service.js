export const NOTIFICATION_TYPES = {
  INBOUND_LEAD: 'inbound_lead',
};

export const NOTIFICATION_SOURCES = {
  WEBSITE: 'website_form',
  FACEBOOK_LEAD_ADS: 'facebook_lead_ads',
};

function cleanText(value) {
  return String(value || '').trim();
}

function notificationHref({ contactId, leadId }) {
  if (contactId) return `/contacts/${contactId}${leadId ? `?leadId=${leadId}` : ''}`;
  if (leadId) return `/pipeline?leadId=${leadId}`;
  return '/pipeline';
}

function inboundLeadDisplayLabel(sourceType, sourceName) {
  if (sourceType === NOTIFICATION_SOURCES.FACEBOOK_LEAD_ADS) return 'Facebook lead';
  return cleanText(sourceName) || 'Website lead';
}

function inboundLeadSourceLabel(sourceType, sourceName) {
  const sourceLabel = cleanText(sourceName);
  if (sourceLabel) return sourceLabel;
  if (sourceType === NOTIFICATION_SOURCES.FACEBOOK_LEAD_ADS) return 'Facebook Ads';
  return 'Website Form';
}

function inboundLeadTitle({ contactName, sourceType, sourceName }) {
  const name = cleanText(contactName) || 'New lead';
  const sourceLabel = inboundLeadDisplayLabel(sourceType, sourceName);
  return `${name} - ${sourceLabel}`;
}

export function buildInboundLeadNotification({
  organizationId,
  businessUnitId,
  contactId,
  leadId,
  sourceType,
  sourceName,
  contactName,
  detail,
  idempotencyKey,
  metadata = {},
} = {}) {
  const sourceLabel = inboundLeadSourceLabel(sourceType, sourceName);
  const title = inboundLeadTitle({ contactName, sourceType, sourceName: sourceLabel });
  const name = cleanText(contactName) || 'A new lead';
  const bodyDetail = cleanText(detail);
  return {
    organizationId,
    businessUnitId: businessUnitId || null,
    userId: null,
    type: NOTIFICATION_TYPES.INBOUND_LEAD,
    sourceType,
    title,
    body: bodyDetail ? `${bodyDetail} Open the contact to assign and follow up.` : `${name} came in from ${sourceLabel}. Open the contact to assign and follow up.`,
    href: notificationHref({ contactId, leadId }),
    contactId: contactId || null,
    leadId: leadId || null,
    metadataJson: {
      sourceName: sourceLabel,
      ...metadata,
    },
    idempotencyKey: idempotencyKey || null,
  };
}

export async function createNotification(client, notification) {
  if (!notification?.organizationId || !notification?.type || !notification?.title) {
    return { inserted: false, reason: 'invalid_notification' };
  }

  const inserted = await client.query(
    `
      insert into notifications
      (organization_id, business_unit_id, user_id, type, source_type, title, body, href, contact_id, lead_id, metadata_json, idempotency_key)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
      on conflict (organization_id, idempotency_key) do nothing
      returning id
    `,
    [
      notification.organizationId,
      notification.businessUnitId || null,
      notification.userId || null,
      notification.type,
      notification.sourceType || null,
      notification.title,
      notification.body || null,
      notification.href || null,
      notification.contactId || null,
      notification.leadId || null,
      JSON.stringify(notification.metadataJson || {}),
      notification.idempotencyKey || null,
    ],
  );

  return {
    inserted: Boolean(inserted.rows[0]?.id),
    notificationId: inserted.rows[0]?.id || null,
  };
}

export async function createInboundLeadNotification(client, input) {
  return createNotification(client, buildInboundLeadNotification(input));
}
