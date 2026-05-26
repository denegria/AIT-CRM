import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  messageChannelSettings,
  messageTemplates,
} from '../../db/schema.js';
import {
  FOLLOW_UP_CHANNELS,
  MESSAGE_TEMPLATE_CHANNELS,
  MESSAGE_TEMPLATE_CHANNEL_LABELS,
  MESSAGE_TEMPLATE_PROVIDER_STATUSES,
  MESSAGE_TEMPLATE_PURPOSE_LABELS,
  MESSAGE_TEMPLATE_PURPOSES,
  MESSAGE_TEMPLATE_STATUSES,
  isSupportedFollowUpChannel,
  isSupportedProviderStatus,
  isSupportedTemplateChannel,
  isSupportedTemplatePurpose,
  isSupportedTemplateStatus,
} from './constants.js';

function cleanText(value) {
  return String(value || '').trim();
}

function cleanNullableText(value) {
  const text = cleanText(value);
  return text || null;
}

function cleanLower(value) {
  return cleanText(value).toLowerCase();
}

function cleanJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isoTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
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

export function messageChannelScopeKey({ businessUnitId = null, intakeRouteKey = 'default' } = {}) {
  const routeKey = cleanText(intakeRouteKey) || 'default';
  const unitId = cleanNullableText(businessUnitId);
  return unitId ? `business_unit:${unitId}:route:${routeKey}` : `organization:route:${routeKey}`;
}

export function canEnableMessageTemplate({ channel, status, providerStatus } = {}) {
  const normalizedChannel = cleanLower(channel || MESSAGE_TEMPLATE_CHANNELS.ALL);
  const normalizedStatus = cleanLower(status || MESSAGE_TEMPLATE_STATUSES.DRAFT);
  const normalizedProviderStatus = cleanLower(providerStatus || MESSAGE_TEMPLATE_PROVIDER_STATUSES.NOT_REQUIRED);

  if (normalizedStatus !== MESSAGE_TEMPLATE_STATUSES.ACTIVE) return false;
  if (
    normalizedChannel === MESSAGE_TEMPLATE_CHANNELS.WHATSAPP
    || normalizedChannel === MESSAGE_TEMPLATE_CHANNELS.ALL
  ) {
    return normalizedProviderStatus === MESSAGE_TEMPLATE_PROVIDER_STATUSES.APPROVED;
  }
  return true;
}

export function normalizeMessageTemplateDraft(input = {}) {
  const channel = cleanLower(input.channel || MESSAGE_TEMPLATE_CHANNELS.ALL);
  const purpose = cleanLower(input.purpose || MESSAGE_TEMPLATE_PURPOSES.MANUAL_FOLLOW_UP);
  const status = cleanLower(input.status || MESSAGE_TEMPLATE_STATUSES.DRAFT);
  const providerStatus = cleanLower(input.providerStatus || (
    channel === MESSAGE_TEMPLATE_CHANNELS.WHATSAPP
      ? MESSAGE_TEMPLATE_PROVIDER_STATUSES.NOT_SUBMITTED
      : MESSAGE_TEMPLATE_PROVIDER_STATUSES.NOT_REQUIRED
  ));
  const displayName = cleanText(input.displayName);
  const bodyText = cleanText(input.bodyText);
  const isEnabled = Boolean(input.isEnabled);

  if (!isSupportedTemplateChannel(channel)) {
    throw new Error(`Template channel must be one of: ${Object.values(MESSAGE_TEMPLATE_CHANNELS).join(', ')}.`);
  }
  if (!isSupportedTemplatePurpose(purpose)) {
    throw new Error(`Template purpose must be one of: ${Object.values(MESSAGE_TEMPLATE_PURPOSES).join(', ')}.`);
  }
  if (!isSupportedTemplateStatus(status)) {
    throw new Error(`Template status must be one of: ${Object.values(MESSAGE_TEMPLATE_STATUSES).join(', ')}.`);
  }
  if (!isSupportedProviderStatus(providerStatus)) {
    throw new Error(`Provider status must be one of: ${Object.values(MESSAGE_TEMPLATE_PROVIDER_STATUSES).join(', ')}.`);
  }
  if (!displayName) throw new Error('Template display name is required.');
  if (!bodyText) throw new Error('Template body text is required.');
  if (isEnabled && !canEnableMessageTemplate({ channel, status, providerStatus })) {
    throw new Error('Only active templates can be enabled. WhatsApp-applicable templates must also be provider approved.');
  }

  return {
    businessUnitId: cleanNullableText(input.businessUnitId),
    channel,
    purpose,
    displayName,
    bodyText,
    status,
    providerStatus,
    isEnabled,
    metadataJson: cleanJsonObject(input.metadataJson),
  };
}

export function normalizeMessageChannelSettingDraft(input = {}) {
  const channel = cleanLower(input.channel);
  if (!isSupportedFollowUpChannel(channel)) {
    throw new Error(`Follow-up channel must be one of: ${FOLLOW_UP_CHANNELS.join(', ')}.`);
  }

  const businessUnitId = cleanNullableText(input.businessUnitId);
  const intakeRouteKey = cleanText(input.intakeRouteKey) || 'default';
  return {
    businessUnitId,
    scopeKey: messageChannelScopeKey({ businessUnitId, intakeRouteKey }),
    intakeRouteKey,
    channel,
    isEnabled: Boolean(input.isEnabled),
    settingsJson: cleanJsonObject(input.settingsJson),
  };
}

export function assertTemplateRegistryCannotSend() {
  throw new Error('Outbound sending is not implemented in the MIS-45 message template registry slice.');
}

export async function sendMessageFromTemplate() {
  assertTemplateRegistryCannotSend();
}

export function toMessageTemplatePayload(row) {
  if (!row) return null;
  const channel = cleanLower(row.channel || MESSAGE_TEMPLATE_CHANNELS.ALL);
  const purpose = cleanLower(row.purpose || MESSAGE_TEMPLATE_PURPOSES.MANUAL_FOLLOW_UP);
  const status = cleanLower(row.status || MESSAGE_TEMPLATE_STATUSES.DRAFT);
  const providerStatus = cleanLower(row.providerStatus || MESSAGE_TEMPLATE_PROVIDER_STATUSES.NOT_REQUIRED);
  return {
    id: row.id,
    organizationId: row.organizationId,
    businessUnitId: row.businessUnitId || '',
    channel,
    channelLabel: MESSAGE_TEMPLATE_CHANNEL_LABELS[channel] || titleCaseValue(channel, 'Channel'),
    purpose,
    purposeLabel: MESSAGE_TEMPLATE_PURPOSE_LABELS[purpose] || titleCaseValue(purpose, 'Purpose'),
    displayName: row.displayName || '',
    bodyText: row.bodyText || '',
    status,
    statusLabel: titleCaseValue(status, 'Status'),
    providerStatus,
    providerStatusLabel: titleCaseValue(providerStatus, 'Provider Status'),
    isEnabled: Boolean(row.isEnabled),
    canEnable: canEnableMessageTemplate({ channel, status, providerStatus }),
    metadataJson: row.metadataJson || {},
    createdAt: isoTimestamp(row.createdAt),
    updatedAt: isoTimestamp(row.updatedAt),
  };
}

export function toMessageChannelSettingPayload(row) {
  if (!row) return null;
  const channel = cleanLower(row.channel);
  return {
    id: row.id,
    organizationId: row.organizationId,
    businessUnitId: row.businessUnitId || '',
    scopeKey: row.scopeKey || messageChannelScopeKey({
      businessUnitId: row.businessUnitId,
      intakeRouteKey: row.intakeRouteKey,
    }),
    intakeRouteKey: row.intakeRouteKey || 'default',
    channel,
    channelLabel: MESSAGE_TEMPLATE_CHANNEL_LABELS[channel] || titleCaseValue(channel, 'Channel'),
    isEnabled: Boolean(row.isEnabled),
    settingsJson: row.settingsJson || {},
    createdAt: isoTimestamp(row.createdAt),
    updatedAt: isoTimestamp(row.updatedAt),
  };
}

function templateScopeCondition({ table, businessUnitIds = null }) {
  if (!Array.isArray(businessUnitIds)) return undefined;
  if (!businessUnitIds.length) return isNull(table.businessUnitId);
  return or(isNull(table.businessUnitId), inArray(table.businessUnitId, businessUnitIds));
}

export async function listMessageTemplates({
  db,
  organizationId,
  businessUnitIds = null,
  filters = {},
}) {
  const conditions = [eq(messageTemplates.organizationId, organizationId)];
  const scope = templateScopeCondition({ table: messageTemplates, businessUnitIds });
  if (scope) conditions.push(scope);
  if (filters.businessUnitId) conditions.push(eq(messageTemplates.businessUnitId, filters.businessUnitId));
  if (filters.channel) conditions.push(eq(messageTemplates.channel, cleanLower(filters.channel)));
  if (filters.purpose) conditions.push(eq(messageTemplates.purpose, cleanLower(filters.purpose)));
  if (filters.status) conditions.push(eq(messageTemplates.status, cleanLower(filters.status)));

  const rows = await db
    .select()
    .from(messageTemplates)
    .where(and(...conditions))
    .orderBy(asc(messageTemplates.channel), asc(messageTemplates.purpose), asc(messageTemplates.displayName));

  return rows.map(toMessageTemplatePayload);
}

export async function listMessageChannelSettings({
  db,
  organizationId,
  businessUnitIds = null,
  filters = {},
}) {
  const conditions = [eq(messageChannelSettings.organizationId, organizationId)];
  const scope = templateScopeCondition({ table: messageChannelSettings, businessUnitIds });
  if (scope) conditions.push(scope);
  if (filters.businessUnitId) conditions.push(eq(messageChannelSettings.businessUnitId, filters.businessUnitId));
  if (filters.channel) conditions.push(eq(messageChannelSettings.channel, cleanLower(filters.channel)));

  const rows = await db
    .select()
    .from(messageChannelSettings)
    .where(and(...conditions))
    .orderBy(asc(messageChannelSettings.channel), asc(messageChannelSettings.scopeKey));

  return rows.map(toMessageChannelSettingPayload);
}

export async function createMessageTemplate({
  db,
  organizationId,
  actorUserId,
  values,
}) {
  const draft = normalizeMessageTemplateDraft(values);
  const [row] = await db
    .insert(messageTemplates)
    .values({
      organizationId,
      createdByUserId: actorUserId || null,
      updatedByUserId: actorUserId || null,
      ...draft,
    })
    .returning();
  return toMessageTemplatePayload(row);
}

export async function updateMessageTemplate({
  db,
  organizationId,
  actorUserId,
  id,
  values,
}) {
  const draft = normalizeMessageTemplateDraft(values);
  const [row] = await db
    .update(messageTemplates)
    .set({
      ...draft,
      updatedByUserId: actorUserId || null,
      updatedAt: new Date(),
    })
    .where(and(eq(messageTemplates.id, id), eq(messageTemplates.organizationId, organizationId)))
    .returning();

  if (!row) {
    const error = new Error('Template not found.');
    error.status = 404;
    throw error;
  }

  return toMessageTemplatePayload(row);
}

export async function upsertMessageChannelSetting({
  db,
  organizationId,
  actorUserId,
  values,
}) {
  const draft = normalizeMessageChannelSettingDraft(values);
  const [row] = await db
    .insert(messageChannelSettings)
    .values({
      organizationId,
      createdByUserId: actorUserId || null,
      updatedByUserId: actorUserId || null,
      ...draft,
    })
    .onConflictDoUpdate({
      target: [
        messageChannelSettings.organizationId,
        messageChannelSettings.scopeKey,
        messageChannelSettings.channel,
      ],
      set: {
        businessUnitId: draft.businessUnitId,
        intakeRouteKey: draft.intakeRouteKey,
        isEnabled: draft.isEnabled,
        settingsJson: draft.settingsJson,
        updatedByUserId: actorUserId || null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return toMessageChannelSettingPayload(row);
}
