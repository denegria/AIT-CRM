import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCommsObservabilitySnapshot,
  buildProviderConfigDiagnostics,
  redactIdentifier,
  stableRedactedHash,
} from './service.js';

function createClient(resultSets = []) {
  const calls = [];
  return {
    calls,
    client: {
      async query(sql, params = []) {
        calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim().toLowerCase(), params });
        const rows = resultSets.shift();
        if (!rows) return { rows: [] };
        return { rows };
      },
    },
  };
}

test('provider diagnostics report readiness without leaking secret values', () => {
  const diagnostics = buildProviderConfigDiagnostics({
    META_WEBHOOK_VERIFY_TOKEN: 'verify-secret',
    META_APP_SECRET: 'app-secret',
    META_PAGE_ACCESS_TOKEN_MAP: JSON.stringify({ 'page-123456': 'page-token-secret' }),
    META_WHATSAPP_ACCESS_TOKEN: 'wa-secret',
    META_WHATSAPP_BUSINESS_UNIT_MAP: JSON.stringify({ 'phone-number-1': 'Signs' }),
    SMS_WEBHOOK_SHARED_SECRET: 'sms-secret',
    SMS_BUSINESS_UNIT_MAP: JSON.stringify({ '+15552223333': 'Signs' }),
  });

  assert.equal(diagnostics.webhook.verifyTokenConfigured, true);
  assert.equal(diagnostics.webhook.appSecretConfigured, true);
  assert.equal(diagnostics.messenger.mappedAccessTokens.entryCount, 1);
  assert.equal(diagnostics.whatsapp.defaultAccessTokenConfigured, true);
  assert.equal(diagnostics.whatsapp.businessUnitMap.entryCount, 1);
  assert.equal(diagnostics.sms.webhookSharedSecretConfigured, true);
  assert.equal(diagnostics.sms.businessUnitMap.entryCount, 1);
  assert.deepEqual(diagnostics.blockers, []);
  assert.equal(JSON.stringify(diagnostics).includes('page-token-secret'), false);
  assert.equal(JSON.stringify(diagnostics).includes('wa-secret'), false);
  assert.equal(JSON.stringify(diagnostics).includes('sms-secret'), false);
});

test('provider diagnostics list blocked config reasons', () => {
  const diagnostics = buildProviderConfigDiagnostics({});
  const codes = diagnostics.blockers.map((blocker) => blocker.code);

  assert.equal(codes.includes('webhook_verify_token_missing'), true);
  assert.equal(codes.includes('webhook_app_secret_missing'), true);
  assert.equal(codes.includes('messenger_access_token_missing'), true);
  assert.equal(codes.includes('whatsapp_access_token_missing'), true);
  assert.equal(codes.includes('whatsapp_business_unit_map_missing'), true);
  assert.equal(codes.includes('sms_webhook_secret_missing'), true);
  assert.equal(codes.includes('sms_business_unit_map_missing'), true);
});

test('provider diagnostics report the temporary-branch external I/O kill switch', () => {
  const diagnostics = buildProviderConfigDiagnostics({ AIT_CRM_EXTERNAL_IO_DISABLED: 'true' });
  assert.equal(diagnostics.externalIoDisabled, true);
  assert.equal(diagnostics.blockers[0].code, 'external_io_disabled');
});

test('redacts identifiers and returns stable non-secret hashes', () => {
  assert.equal(redactIdentifier('page-1234567890'), 'page...7890');
  assert.equal(stableRedactedHash('page-1234567890'), stableRedactedHash('page-1234567890'));
  assert.notEqual(stableRedactedHash('page-1234567890'), 'page-1234567890');
});

test('builds scoped comms observability snapshot with redacted operational details', async () => {
  const { client, calls } = createClient([
    [
      { channel: 'messenger', delivery_status: 'received', count: 2, distinct_idempotency_keys: 2, last_at: new Date('2026-05-27T01:00:00.000Z') },
      { channel: 'whatsapp', delivery_status: 'received', count: 1, distinct_idempotency_keys: 1, last_at: new Date('2026-05-27T01:05:00.000Z') },
    ],
    [
      {
        id: 'msg-1',
        business_unit_id: 'bu-1',
        channel: 'whatsapp',
        provider_account_id: 'phone-number-123456',
        external_message_id: 'wamid-123456',
        idempotency_key: 'meta:whatsapp:phone-number-123456:wamid-123456',
        delivery_status: 'received',
        occurred_at: new Date('2026-05-27T01:05:00.000Z'),
        created_at: new Date('2026-05-27T01:05:01.000Z'),
      },
    ],
    [
      { channel: 'messenger', active_count: 1, inactive_count: 0, last_at: new Date('2026-05-27T00:00:00.000Z') },
      { channel: 'whatsapp', active_count: 0, inactive_count: 1, last_at: new Date('2026-05-27T00:10:00.000Z') },
    ],
    [
      { channel: 'messenger', delivery_status: 'sent', count: 3, last_at: new Date('2026-05-27T01:10:00.000Z') },
      { channel: 'whatsapp', delivery_status: 'failed', count: 1, last_at: new Date('2026-05-27T01:11:00.000Z') },
    ],
    [
      { channel: 'whatsapp', error_code: 'GRAPH_RESPONSE_ERROR', count: 1, last_at: new Date('2026-05-27T01:11:00.000Z') },
    ],
    [
      {
        id: 'outbound-1',
        business_unit_id: 'bu-1',
        channel: 'whatsapp',
        delivery_status: 'failed',
        provider_account_id: 'phone-number-123456',
        external_message_id: null,
        idempotency_key: 'meta:whatsapp:phone-number-123456:manual:req-1',
        error_code: 'GRAPH_RESPONSE_ERROR',
        error_message: 'Meta Graph failed for recipient +15551234567 using token EAAB-secret-token and request fbtrace_id=abc123.',
        has_error_message: true,
        occurred_at: new Date('2026-05-27T01:10:00.000Z'),
        updated_at: new Date('2026-05-27T01:11:00.000Z'),
      },
    ],
    [
      {
        id: 'template-1',
        business_unit_id: null,
        channel: 'whatsapp',
        purpose: 'manual_follow_up',
        display_name: 'WA Manual',
        status: 'active',
        provider_status: 'pending',
        is_enabled: true,
        updated_at: new Date('2026-05-27T00:30:00.000Z'),
      },
    ],
    [
      {
        id: 'setting-1',
        business_unit_id: null,
        scope_key: 'organization:route:default',
        intake_route_key: 'default',
        channel: 'whatsapp',
        is_enabled: false,
        updated_at: new Date('2026-05-27T00:35:00.000Z'),
      },
      {
        id: 'setting-2',
        business_unit_id: 'bu-1',
        scope_key: 'business_unit:bu-1:route:default',
        intake_route_key: 'default',
        channel: 'whatsapp',
        is_enabled: true,
        updated_at: new Date('2026-05-27T00:40:00.000Z'),
      },
    ],
    [
      { status: 'active', channel: 'whatsapp', count: 4, next_due_at: new Date('2026-05-27T02:00:00.000Z'), last_at: new Date('2026-05-27T01:00:00.000Z') },
    ],
    [
      { status: 'blocked', count: 2, last_at: new Date('2026-05-27T01:20:00.000Z') },
      { status: 'created', count: 1, last_at: new Date('2026-05-27T01:21:00.000Z') },
    ],
    [
      { blocked_reason: 'quiet_hours,template_not_approved', count: 2, last_at: new Date('2026-05-27T01:20:00.000Z') },
    ],
    [
      {
        id: 'run-1',
        business_unit_id: 'bu-1',
        sequence_id: 'seq-1',
        enrollment_id: 'enrollment-1',
        step_id: 'step-1',
        contact_id: 'contact-1',
        lead_id: 'lead-1',
        task_id: null,
        status: 'blocked',
        blocked_reason: 'quiet_hours,template_not_approved',
        due_at: new Date('2026-05-27T01:00:00.000Z'),
        executed_at: new Date('2026-05-27T01:20:00.000Z'),
        created_at: new Date('2026-05-27T01:20:00.000Z'),
        updated_at: new Date('2026-05-27T01:20:00.000Z'),
      },
    ],
    [
      { dnc_count: 1, wrong_number_count: 2, blocked_count: 3 },
    ],
  ]);

  const snapshot = await buildCommsObservabilitySnapshot(client, {
    organizationId: 'org-1',
    businessUnitIds: ['bu-1'],
    env: {
      META_WEBHOOK_VERIFY_TOKEN: 'verify-secret',
      META_APP_SECRET: 'app-secret',
      META_PAGE_ACCESS_TOKEN: 'page-token',
      META_WHATSAPP_ACCESS_TOKEN: 'wa-token',
      META_WHATSAPP_BUSINESS_UNIT_MAP: JSON.stringify({ 'phone-number-123456': 'Signs' }),
      SMS_WEBHOOK_SHARED_SECRET: 'sms-secret',
      SMS_BUSINESS_UNIT_MAP: JSON.stringify({ '+15552223333': 'Signs' }),
    },
    now: new Date('2026-05-27T03:00:00.000Z'),
  });

  assert.equal(snapshot.generatedAt, '2026-05-27T03:00:00.000Z');
  assert.deepEqual(snapshot.scope.businessUnitIds, ['bu-1']);
  assert.equal(snapshot.inbound.channelConfigs.messenger.status, 'ready');
  assert.equal(snapshot.inbound.channelConfigs.whatsapp.status, 'inactive');
  assert.equal(snapshot.inbound.recent[0].providerAccount.redacted, 'phon...3456');
  assert.equal(JSON.stringify(snapshot).includes('phone-number-123456'), false);
  assert.equal(JSON.stringify(snapshot).includes('verify-secret'), false);
  assert.equal(snapshot.manualOutbound.failures[0].code, 'graph_response_error');
  assert.equal(snapshot.manualOutbound.failures[0].classifier, 'provider_rejected');
  assert.deepEqual(snapshot.manualOutbound.pendingOrFailed[0].error, {
    code: 'graph_response_error',
    classifier: 'provider_rejected',
    hasProviderDetail: true,
  });
  assert.deepEqual(snapshot.templates.templates[0].blockers, ['template_not_approved']);
  assert.deepEqual(snapshot.templates.settings.whatsapp.organizationDefault.blockers, ['channel_disabled']);
  assert.deepEqual(snapshot.templates.settings.whatsapp.effectiveScoped.blockers, []);
  assert.equal(snapshot.templates.settings.whatsapp.effectiveScoped.enabled, true);
  assert.equal(snapshot.templates.settings.whatsapp.effectiveScoped.scopedCount, 2);
  assert.equal(snapshot.templates.settings.whatsapp.effectiveScoped.enabledScopedCount, 1);
  assert.deepEqual(snapshot.followUps.blockers[0].codes, ['quiet_hours', 'template_not_approved']);
  assert.equal(snapshot.contactBlockers.blockedContacts, 3);
  assert.equal(JSON.stringify(snapshot).includes('EAAB-secret-token'), false);
  assert.equal(JSON.stringify(snapshot).includes('+15551234567'), false);
  assert.equal(JSON.stringify(snapshot).includes('fbtrace_id=abc123'), false);
  assert.equal(JSON.stringify(snapshot).includes('Meta Graph failed'), false);
  assert.equal(calls.every((call) => call.params.includes('org-1')), true);
  assert.equal(calls.every((call) => call.params.some((param) => Array.isArray(param) && param.includes('bu-1')) || call.sql.includes('provider =')), true);
});
