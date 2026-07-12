import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTIFICATION_SOURCES,
  buildInboundLeadNotification,
  createInboundLeadNotification,
} from './service.js';
import {
  canReadInboundLeadNotifications,
  canReadNotification,
} from './access.js';

function session(roleKeys, overrides = {}) {
  return {
    user: {
      id: 'user-1',
      roleKeys,
      businessUnitIds: ['bu-1'],
      canAccessAllBusinessUnits: false,
      ...overrides,
    },
  };
}

test('builds reusable inbound lead notifications with contact deep links', () => {
  const notification = buildInboundLeadNotification({
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    contactId: 'contact-1',
    leadId: 'lead-1',
    sourceType: NOTIFICATION_SOURCES.FACEBOOK_LEAD_ADS,
    sourceName: 'Facebook Ads',
    contactName: 'Ada Lovelace',
    detail: 'Submitted the AIT USA lead form.',
    idempotencyKey: 'facebook:leadgen-1',
    metadata: { leadgenId: 'leadgen-1' },
  });

  assert.equal(notification.type, 'inbound_lead');
  assert.equal(notification.sourceType, 'facebook_lead_ads');
  assert.equal(notification.title, 'Ada Lovelace - Facebook lead');
  assert.equal(notification.body, 'Submitted the AIT USA lead form. Open the contact to assign and follow up.');
  assert.equal(notification.href, '/contacts/contact-1?leadId=lead-1');
  assert.deepEqual(notification.metadataJson, {
    sourceName: 'Facebook Ads',
    leadgenId: 'leadgen-1',
  });
});

test('persists inbound lead notifications idempotently', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      return { rows: [{ id: 'notification-1' }] };
    },
  };

  const result = await createInboundLeadNotification(client, {
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    contactId: 'contact-1',
    leadId: 'lead-1',
    sourceType: NOTIFICATION_SOURCES.WEBSITE,
    sourceName: 'Website Form',
    contactName: 'Wix Lead',
    idempotencyKey: 'website:submission-1',
  });

  assert.deepEqual(result, { inserted: true, notificationId: 'notification-1' });
  assert.equal(calls[0].sql.startsWith('insert into notifications'), true);
  assert.equal(calls[0].sql.includes('on conflict (organization_id, idempotency_key) do nothing'), true);
  assert.deepEqual(calls[0].params.slice(0, 6), [
    'org-1',
    'bu-1',
    null,
    'inbound_lead',
    'website_form',
    'Wix Lead - Website Form',
  ]);
});

test('regular coordinators cannot read broad inbound lead notifications', () => {
  const notification = {
    type: 'inbound_lead',
    businessUnitId: 'bu-1',
    userId: null,
  };

  assert.equal(canReadInboundLeadNotifications(session(['account_coordinator'])), false);
  assert.equal(canReadNotification(session(['account_coordinator']), notification), false);
});

test('senior coordinators can read inbound lead notifications for their business units', () => {
  const notification = {
    type: 'inbound_lead',
    businessUnitId: 'bu-1',
    userId: null,
  };

  assert.equal(canReadInboundLeadNotifications(session(['account_coordinator', 'senior_coordinator'])), true);
  assert.equal(canReadNotification(session(['account_coordinator', 'senior_coordinator']), notification), true);
});
