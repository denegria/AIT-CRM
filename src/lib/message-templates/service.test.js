import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MESSAGE_TEMPLATE_CHANNELS,
  MESSAGE_TEMPLATE_PROVIDER_STATUSES,
  MESSAGE_TEMPLATE_PURPOSES,
  MESSAGE_TEMPLATE_STATUSES,
} from './constants.js';
import {
  assertTemplateRegistryCannotSend,
  canEnableMessageTemplate,
  messageChannelScopeKey,
  normalizeMessageChannelSettingDraft,
  normalizeMessageTemplateDraft,
  sendMessageFromTemplate,
  toMessageChannelSettingPayload,
  toMessageTemplatePayload,
} from './service.js';

test('normalizes draft-safe templates with disabled defaults', () => {
  const draft = normalizeMessageTemplateDraft({
    displayName: ' Warm lead intro ',
    bodyText: ' Hi {{contact.name}}, thanks for reaching out. ',
  });

  assert.equal(draft.channel, MESSAGE_TEMPLATE_CHANNELS.ALL);
  assert.equal(draft.purpose, MESSAGE_TEMPLATE_PURPOSES.MANUAL_FOLLOW_UP);
  assert.equal(draft.status, MESSAGE_TEMPLATE_STATUSES.DRAFT);
  assert.equal(draft.providerStatus, MESSAGE_TEMPLATE_PROVIDER_STATUSES.NOT_REQUIRED);
  assert.equal(draft.isEnabled, false);
  assert.equal(draft.displayName, 'Warm lead intro');
  assert.equal(draft.bodyText, 'Hi {{contact.name}}, thanks for reaching out.');
});

test('validates required template fields and supported channels', () => {
  assert.throws(
    () => normalizeMessageTemplateDraft({ channel: 'sms', displayName: 'SMS', bodyText: 'Hello' }),
    /Template channel must be one of/,
  );
  assert.throws(
    () => normalizeMessageTemplateDraft({ displayName: '', bodyText: 'Hello' }),
    /Template display name is required/,
  );
  assert.throws(
    () => normalizeMessageTemplateDraft({ displayName: 'Empty', bodyText: '' }),
    /Template body text is required/,
  );
});

test('requires active approved WhatsApp templates before enabling', () => {
  assert.equal(canEnableMessageTemplate({
    channel: MESSAGE_TEMPLATE_CHANNELS.MESSENGER,
    status: MESSAGE_TEMPLATE_STATUSES.ACTIVE,
    providerStatus: MESSAGE_TEMPLATE_PROVIDER_STATUSES.NOT_REQUIRED,
  }), true);

  assert.equal(canEnableMessageTemplate({
    channel: MESSAGE_TEMPLATE_CHANNELS.WHATSAPP,
    status: MESSAGE_TEMPLATE_STATUSES.ACTIVE,
    providerStatus: MESSAGE_TEMPLATE_PROVIDER_STATUSES.PENDING,
  }), false);
  assert.equal(canEnableMessageTemplate({
    channel: MESSAGE_TEMPLATE_CHANNELS.ALL,
    status: MESSAGE_TEMPLATE_STATUSES.ACTIVE,
    providerStatus: MESSAGE_TEMPLATE_PROVIDER_STATUSES.NOT_REQUIRED,
  }), false);
  assert.equal(canEnableMessageTemplate({
    channel: MESSAGE_TEMPLATE_CHANNELS.ALL,
    status: MESSAGE_TEMPLATE_STATUSES.ACTIVE,
    providerStatus: MESSAGE_TEMPLATE_PROVIDER_STATUSES.APPROVED,
  }), true);

  assert.throws(
    () => normalizeMessageTemplateDraft({
      channel: MESSAGE_TEMPLATE_CHANNELS.WHATSAPP,
      purpose: MESSAGE_TEMPLATE_PURPOSES.WARMUP,
      displayName: 'WA warmup',
      bodyText: 'Thanks for contacting us.',
      status: MESSAGE_TEMPLATE_STATUSES.ACTIVE,
      providerStatus: MESSAGE_TEMPLATE_PROVIDER_STATUSES.PENDING,
      isEnabled: true,
    }),
    /WhatsApp-applicable templates must also be provider approved/,
  );
  assert.throws(
    () => normalizeMessageTemplateDraft({
      channel: MESSAGE_TEMPLATE_CHANNELS.ALL,
      purpose: MESSAGE_TEMPLATE_PURPOSES.WARMUP,
      displayName: 'Any-channel warmup',
      bodyText: 'Thanks for contacting us.',
      status: MESSAGE_TEMPLATE_STATUSES.ACTIVE,
      providerStatus: MESSAGE_TEMPLATE_PROVIDER_STATUSES.NOT_REQUIRED,
      isEnabled: true,
    }),
    /WhatsApp-applicable templates must also be provider approved/,
  );
});

test('normalizes channel settings without assuming phone-number ownership by business unit', () => {
  const orgSetting = normalizeMessageChannelSettingDraft({
    channel: MESSAGE_TEMPLATE_CHANNELS.WHATSAPP,
    isEnabled: true,
  });
  const businessUnitSetting = normalizeMessageChannelSettingDraft({
    businessUnitId: 'bu-1',
    intakeRouteKey: 'shared-client-wa',
    channel: MESSAGE_TEMPLATE_CHANNELS.WHATSAPP,
    isEnabled: false,
  });

  assert.equal(orgSetting.scopeKey, 'organization:route:default');
  assert.equal(businessUnitSetting.scopeKey, 'business_unit:bu-1:route:shared-client-wa');
  assert.equal(messageChannelScopeKey({ businessUnitId: 'bu-2', intakeRouteKey: 'shared-client-wa' }), 'business_unit:bu-2:route:shared-client-wa');
  assert.throws(
    () => normalizeMessageChannelSettingDraft({ channel: 'all' }),
    /Follow-up channel must be one of/,
  );
});

test('formats registry payloads for API/UI consumers', () => {
  const template = toMessageTemplatePayload({
    id: 'template-1',
    organizationId: 'org-1',
    businessUnitId: null,
    channel: 'messenger',
    purpose: 'warmup',
    displayName: 'Intro',
    bodyText: 'Hello',
    status: 'active',
    providerStatus: 'not_required',
    isEnabled: true,
    metadataJson: { tags: ['warm'] },
    createdAt: new Date('2026-05-26T12:00:00.000Z'),
    updatedAt: new Date('2026-05-26T12:30:00.000Z'),
  });
  const setting = toMessageChannelSettingPayload({
    id: 'setting-1',
    organizationId: 'org-1',
    businessUnitId: null,
    scopeKey: 'organization:route:default',
    channel: 'messenger',
    isEnabled: false,
    settingsJson: {},
  });

  assert.equal(template.channelLabel, 'Messenger');
  assert.equal(template.purposeLabel, 'Warm Lead Warmup');
  assert.equal(template.businessUnitId, '');
  assert.equal(template.canEnable, true);
  assert.equal(template.createdAt, '2026-05-26T12:00:00.000Z');
  assert.equal(setting.channelLabel, 'Messenger');
  assert.equal(setting.isEnabled, false);
});

test('registry slice exposes no outbound send path', async () => {
  assert.throws(
    () => assertTemplateRegistryCannotSend(),
    /Outbound sending is not implemented/,
  );
  await assert.rejects(
    () => sendMessageFromTemplate(),
    /Outbound sending is not implemented/,
  );
});
