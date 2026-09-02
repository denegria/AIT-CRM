import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FACEBOOK_LEAD_ADS_DETAIL_LABEL,
  FACEBOOK_LEAD_ADS_SOURCE_LABEL,
  FACEBOOK_MESSENGER_SOURCE_LABEL,
  canonicalLeadSourceChannel,
  leadSourceDetail,
} from './source-attribution.js';

test('canonicalLeadSourceChannel keeps Facebook Lead Ads separate from Messenger', () => {
  assert.equal(canonicalLeadSourceChannel({ sourceType: 'facebook_lead_ads' }), FACEBOOK_LEAD_ADS_SOURCE_LABEL);
  assert.equal(canonicalLeadSourceChannel({ sourceName: 'Facebook Ads' }), FACEBOOK_LEAD_ADS_SOURCE_LABEL);
  assert.equal(canonicalLeadSourceChannel({ sourceKey: 'facebook_webhook' }), FACEBOOK_LEAD_ADS_SOURCE_LABEL);
  assert.equal(canonicalLeadSourceChannel({ sourceType: 'facebook_messenger' }), FACEBOOK_MESSENGER_SOURCE_LABEL);
  assert.equal(canonicalLeadSourceChannel({ sourceName: 'Facebook Messenger' }), FACEBOOK_MESSENGER_SOURCE_LABEL);
  assert.equal(canonicalLeadSourceChannel({
    sourceType: 'facebook_messenger',
    sourceKey: 'facebook_webhook',
  }), FACEBOOK_MESSENGER_SOURCE_LABEL);
});

test('Lead Ads receive the lead-form detail without changing Messenger details', () => {
  assert.equal(leadSourceDetail(FACEBOOK_LEAD_ADS_SOURCE_LABEL), FACEBOOK_LEAD_ADS_DETAIL_LABEL);
  assert.equal(leadSourceDetail(FACEBOOK_MESSENGER_SOURCE_LABEL), '');
});
