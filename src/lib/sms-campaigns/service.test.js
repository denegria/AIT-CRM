import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SMS_CAMPAIGN_BLOCK_CODES,
  SMS_CAMPAIGN_STATUSES,
  approveSmsCampaign,
  buildSmsCampaignAudiencePreview,
  createSmsCampaign,
  evaluateSmsCampaignLaunchPolicy,
  loadSmsCampaignAudienceCandidates,
  requestSmsCampaignLaunch,
} from './service.js';
import { SMS_CONSENT_STATUSES } from '../communication-consent/sms-consent.js';

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
}

function campaignRow(overrides = {}) {
  return {
    id: 'campaign-1',
    organization_id: 'org-1',
    business_unit_id: 'bu-1',
    business_unit_name: 'AIT USA Institute',
    name: 'June retargeting',
    status: SMS_CAMPAIGN_STATUSES.DRAFT,
    audience_filter_json: {},
    message_body: 'Hi {{first_name}}, ready to enroll?',
    sender_provider: 'telnyx',
    sender_account_id: '',
    send_window_json: {},
    throttle_per_hour: 120,
    provider_readiness_json: {},
    compliance_readiness_json: {},
    approved_by_user_id: null,
    approved_at: null,
    scheduled_at: null,
    launched_at: null,
    paused_at: null,
    cancelled_at: null,
    completed_at: null,
    created_by_user_id: 'user-1',
    updated_by_user_id: 'user-1',
    metadata_json: {},
    created_at: new Date('2026-06-29T16:00:00.000Z'),
    updated_at: new Date('2026-06-29T16:00:00.000Z'),
    ...overrides,
  };
}

function audienceRows() {
  return [
    {
      contact_id: 'contact-ok',
      contact_name: 'Ada Enroll',
      phone: '+15550001111',
      lead_id: 'lead-ok',
      consent_status: SMS_CONSENT_STATUSES.OPTED_IN,
      is_do_not_call: false,
      is_wrong_number: false,
    },
    {
      contact_id: 'contact-duplicate',
      contact_name: 'Ada Duplicate',
      phone: '(555) 000-1111',
      lead_id: 'lead-duplicate',
      consent_status: SMS_CONSENT_STATUSES.OPTED_IN,
      is_do_not_call: false,
      is_wrong_number: false,
    },
    {
      contact_id: 'contact-optout',
      contact_name: 'Grace Optout',
      phone: '+15550002222',
      lead_id: 'lead-optout',
      consent_status: SMS_CONSENT_STATUSES.OPTED_OUT,
      is_do_not_call: false,
      is_wrong_number: false,
    },
    {
      contact_id: 'contact-missing',
      contact_name: 'No Phone',
      phone: '',
      lead_id: 'lead-missing',
      consent_status: null,
      is_do_not_call: false,
      is_wrong_number: false,
    },
  ];
}

function createServiceClient({ campaign = campaignRow(), candidates = audienceRows() } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      async query(sql, params = []) {
        const normalized = normalizeSql(sql);
        calls.push({ sql: normalized, params });

        if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
          return { rows: [] };
        }
        if (normalized.startsWith('insert into sms_campaigns')) {
          return {
            rows: [campaignRow({
              id: 'campaign-created',
              organization_id: params[0],
              business_unit_id: params[1],
              name: params[2],
              status: params[3],
              audience_filter_json: JSON.parse(params[4]),
              message_body: params[5],
              sender_provider: params[6],
              sender_account_id: params[7],
              send_window_json: JSON.parse(params[8]),
              throttle_per_hour: params[9],
              provider_readiness_json: JSON.parse(params[10]),
              compliance_readiness_json: JSON.parse(params[11]),
              scheduled_at: params[12],
              created_by_user_id: params[13],
              updated_by_user_id: params[14],
              metadata_json: JSON.parse(params[15]),
            })],
          };
        }
        if (normalized.startsWith('insert into sms_campaign_events')) {
          return { rows: [{ id: `event-${calls.length}` }] };
        }
        if (normalized.startsWith('select c.*, bu.name as business_unit_name')) {
          return { rows: [campaign] };
        }
        if (normalized.startsWith('select c.id::text as contact_id')) {
          return { rows: candidates };
        }
        if (normalized.startsWith('delete from sms_campaign_recipients')) {
          return { rows: [] };
        }
        if (normalized.startsWith('insert into sms_campaign_recipients')) {
          return { rows: [{ id: `recipient-${calls.length}` }] };
        }
        if (normalized.startsWith('update sms_campaigns')) {
          return {
            rows: [campaignRow({
              ...campaign,
              status: params[0],
              updated_by_user_id: params[1],
              approved_by_user_id: normalized.includes('approved_by_user_id = $5') ? params[4] : campaign.approved_by_user_id,
              approved_at: normalized.includes('approved_at = now()') ? new Date('2026-06-29T16:05:00.000Z') : campaign.approved_at,
            })],
          };
        }
        if (normalized.startsWith('update sms_campaign_recipients')) {
          return { rows: [{ id: `recipient-update-${calls.length}` }] };
        }

        throw new Error('Unexpected query: ' + normalized);
      },
    },
  };
}

test('builds SMS campaign audience preview with consent, duplicate, and missing-phone explanations', () => {
  const preview = buildSmsCampaignAudiencePreview(audienceRows(), {
    messageBody: 'Hi {{first_name}}, ready to enroll?',
  });

  assert.equal(preview.total, 4);
  assert.equal(preview.includedCount, 1);
  assert.equal(preview.blockedCount, 3);
  assert.equal(preview.duplicateCount, 1);
  assert.equal(preview.included[0].messagePreview, 'Hi Ada, ready to enroll?');
  assert.equal(preview.reasonCounts.duplicate_phone, 1);
  assert.equal(preview.reasonCounts.sms_opted_out, 1);
  assert.equal(preview.reasonCounts.phone_missing, 1);
  assert.equal(preview.reasonCounts.sms_consent_missing, 1);
});

test('launch policy explains every hard blocker before real sends exist', () => {
  const policy = evaluateSmsCampaignLaunchPolicy({
    campaign: {
      status: SMS_CAMPAIGN_STATUSES.DRAFT,
      messageBody: '',
      senderAccountId: '',
      providerReadinessJson: {},
      complianceReadinessJson: {},
    },
    preview: { includedCount: 0 },
  });

  assert.equal(policy.blocked, true);
  assert.deepEqual(policy.blockers.map((blocker) => blocker.code), [
    SMS_CAMPAIGN_BLOCK_CODES.CAMPAIGN_NOT_APPROVED,
    SMS_CAMPAIGN_BLOCK_CODES.MESSAGE_BODY_MISSING,
    SMS_CAMPAIGN_BLOCK_CODES.SENDER_MISSING,
    SMS_CAMPAIGN_BLOCK_CODES.PROVIDER_NOT_READY,
    SMS_CAMPAIGN_BLOCK_CODES.COMPLIANCE_NOT_READY,
    SMS_CAMPAIGN_BLOCK_CODES.AUDIENCE_EMPTY,
    SMS_CAMPAIGN_BLOCK_CODES.LIVE_SEND_DISABLED,
  ]);
});

test('creates SMS campaign drafts and records audit events', async () => {
  const { client, calls } = createServiceClient();

  const campaign = await createSmsCampaign(client, {
    organizationId: 'org-1',
    actorUserId: 'user-1',
    values: {
      businessUnitId: 'bu-1',
      name: 'June retargeting',
      messageBody: 'Hi {{first_name}}, ready to enroll?',
      senderProvider: 'telnyx',
      throttlePerHour: 80,
      metadataJson: { source: 'test' },
    },
  });

  assert.equal(campaign.id, 'campaign-created');
  assert.equal(campaign.status, SMS_CAMPAIGN_STATUSES.DRAFT);
  assert.equal(campaign.throttlePerHour, 80);

  const insert = calls.find((call) => call.sql.startsWith('insert into sms_campaigns'));
  assert.equal(insert.params[0], 'org-1');
  assert.equal(insert.params[1], 'bu-1');
  assert.equal(insert.params[5], 'Hi {{first_name}}, ready to enroll?');

  const audit = calls.find((call) => call.sql.startsWith('insert into sms_campaign_events'));
  assert.equal(audit.params[2], 'created');
  assert.equal(audit.params[4], SMS_CAMPAIGN_STATUSES.DRAFT);
});

test('passes audience filters into campaign candidate loading', async () => {
  const { client, calls } = createServiceClient();

  await loadSmsCampaignAudienceCandidates(client, {
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    audienceFilterJson: {
      leadStatuses: ['Retargeting', 'Retargeting', ''],
      leadStages: ['Follow Up'],
      sourceTypes: ['website_form'],
    },
    limit: 25,
  });

  const query = calls.find((call) => call.sql.startsWith('select c.id::text as contact_id'));
  assert.deepEqual(query.params[4], ['Retargeting']);
  assert.deepEqual(query.params[5], ['Follow Up']);
  assert.deepEqual(query.params[6], ['website_form']);
  assert.equal(query.params[7], 25);
});

test('approves campaigns through a transactional state transition', async () => {
  const { client, calls } = createServiceClient();

  const campaign = await approveSmsCampaign(client, {
    organizationId: 'org-1',
    campaignId: 'campaign-1',
    actorUserId: 'user-1',
  });

  assert.equal(campaign.status, SMS_CAMPAIGN_STATUSES.APPROVED);
  assert.equal(calls[0].sql, 'begin');
  assert.equal(calls.at(-1).sql, 'commit');

  const update = calls.find((call) => call.sql.startsWith('update sms_campaigns'));
  assert.equal(update.params[0], SMS_CAMPAIGN_STATUSES.APPROVED);
  assert.equal(update.params[4], 'user-1');
});

test('launch requests snapshot recipients and move to launch_blocked without sending', async () => {
  const { client, calls } = createServiceClient({
    campaign: campaignRow({
      status: SMS_CAMPAIGN_STATUSES.APPROVED,
      sender_account_id: '+15552223333',
      provider_readiness_json: {
        providerConfigured: true,
        callbacksReady: true,
        senderMapped: true,
      },
      compliance_readiness_json: {
        tenDlcRegistered: true,
        privacyPolicyReady: true,
        termsReady: true,
        optInPathApproved: true,
        stopHelpCopyApproved: true,
      },
    }),
  });

  const result = await requestSmsCampaignLaunch(client, {
    organizationId: 'org-1',
    campaignId: 'campaign-1',
    actorUserId: 'user-1',
  });

  assert.equal(result.campaign.status, SMS_CAMPAIGN_STATUSES.LAUNCH_BLOCKED);
  assert.equal(result.preview.includedCount, 1);
  assert.deepEqual(result.policy.blockers.map((blocker) => blocker.code), [
    SMS_CAMPAIGN_BLOCK_CODES.LIVE_SEND_DISABLED,
  ]);
  assert.equal(calls.some((call) => call.sql.startsWith('insert into sms_campaign_recipients')), true);

  const update = calls.find((call) => call.sql.startsWith('update sms_campaigns'));
  assert.equal(update.params[0], SMS_CAMPAIGN_STATUSES.LAUNCH_BLOCKED);
  const launchEvent = calls.filter((call) => call.sql.startsWith('insert into sms_campaign_events')).at(-1);
  assert.equal(launchEvent.params[2], 'launch_blocked');
});

test('live launch sends a single allowlisted recipient and completes the campaign', async () => {
  const { client, calls } = createServiceClient({
    campaign: campaignRow({
      status: SMS_CAMPAIGN_STATUSES.APPROVED,
      sender_account_id: '+15552223333',
      provider_readiness_json: {
        providerConfigured: true,
        callbacksReady: true,
        senderMapped: true,
      },
      compliance_readiness_json: {
        tenDlcRegistered: true,
        privacyPolicyReady: true,
        termsReady: true,
        optInPathApproved: true,
        stopHelpCopyApproved: true,
      },
    }),
    candidates: [audienceRows()[0]],
  });
  const sent = [];

  const result = await requestSmsCampaignLaunch(client, {
    organizationId: 'org-1',
    campaignId: 'campaign-1',
    actorUserId: 'user-1',
    liveSendEnabled: true,
    providerSendReady: true,
    maxLiveRecipients: 1,
    allowedRecipientPhones: ['+15550001111'],
    sendSmsMessage: async ({ campaign, recipient, text }) => {
      sent.push({ campaignId: campaign.id, recipient, text });
      return { ok: true, providerMessageId: 'telnyx-message-1', providerStatus: 'queued' };
    },
  });

  assert.equal(result.campaign.status, SMS_CAMPAIGN_STATUSES.COMPLETED);
  assert.equal(result.policy.ok, true);
  assert.equal(result.sendResults.length, 1);
  assert.equal(result.sendResults[0].providerMessageId, 'telnyx-message-1');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, 'Hi Ada, ready to enroll?');

  const recipientUpdate = calls.find((call) => call.sql.startsWith('update sms_campaign_recipients'));
  assert.equal(recipientUpdate.params[0], 'pending');
  assert.equal(recipientUpdate.params[1], 'telnyx-message-1');

  const campaignUpdates = calls.filter((call) => call.sql.startsWith('update sms_campaigns'));
  assert.deepEqual(campaignUpdates.map((call) => call.params[0]), [
    SMS_CAMPAIGN_STATUSES.LAUNCHING,
    SMS_CAMPAIGN_STATUSES.COMPLETED,
  ]);
});

test('live launch policy blocks recipients outside the staging allowlist', () => {
  const policy = evaluateSmsCampaignLaunchPolicy({
    campaign: {
      status: SMS_CAMPAIGN_STATUSES.APPROVED,
      messageBody: 'Hello',
      senderAccountId: '+15552223333',
      providerReadinessJson: {
        providerConfigured: true,
        callbacksReady: true,
        senderMapped: true,
      },
      complianceReadinessJson: {
        tenDlcRegistered: true,
        privacyPolicyReady: true,
        termsReady: true,
        optInPathApproved: true,
        stopHelpCopyApproved: true,
      },
    },
    preview: {
      includedCount: 1,
      included: [{ normalizedPhone: '+15550001111' }],
    },
    liveSendEnabled: true,
    providerSendReady: true,
    maxLiveRecipients: 1,
    allowedRecipientPhones: ['+15559990000'],
  });

  assert.deepEqual(policy.blockers.map((blocker) => blocker.code), [
    SMS_CAMPAIGN_BLOCK_CODES.RECIPIENT_NOT_ALLOWLISTED,
  ]);
});

test('test send mode skips full provider and compliance readiness checks', () => {
  const policy = evaluateSmsCampaignLaunchPolicy({
    campaign: {
      status: SMS_CAMPAIGN_STATUSES.APPROVED,
      messageBody: 'Hello',
      senderAccountId: '+15552223333',
      providerReadinessJson: {},
      complianceReadinessJson: {},
    },
    preview: {
      includedCount: 1,
      included: [{ normalizedPhone: '+15550001111' }],
    },
    liveSendEnabled: true,
    testSendMode: true,
    providerSendReady: true,
    maxLiveRecipients: 1,
    allowedRecipientPhones: ['+15550001111'],
  });

  assert.deepEqual(policy.blockers, []);
});
