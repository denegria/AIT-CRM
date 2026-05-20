import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import {
  META_PAGE_ACCESS_TOKEN_MISSING_REASON,
  createMetaProviderConfig,
  fetchMetaLeadDetails,
  fetchMetaMessengerProfile,
  parseMetaPageAccessTokenMap,
  parseMetaPageBusinessUnitMap,
  resolveMetaPageAccessToken,
  resolveMetaPageBusinessUnitMapping,
  validateMetaAppSecretSignature,
  verifyMetaWebhookChallenge,
} from './meta.js';

test('validates Meta app-secret signatures without accepting malformed headers', () => {
  const bodyText = JSON.stringify({ object: 'page', entry: [] });
  const config = { appSecret: 'app-secret' };
  const signature = createHmac('sha256', config.appSecret).update(bodyText).digest('hex');

  assert.deepEqual(
    validateMetaAppSecretSignature({ bodyText, signatureHeader: `sha256=${signature}`, config }),
    { ok: true },
  );
  assert.equal(validateMetaAppSecretSignature({ bodyText, signatureHeader: `sha256=${signature.slice(1)}`, config }).ok, false);
  assert.equal(validateMetaAppSecretSignature({ bodyText, signatureHeader: signature, config }).code, 'SIGNATURE_MISSING');
  assert.equal(validateMetaAppSecretSignature({ bodyText, signatureHeader: `sha256=${signature}`, config: {} }).code, 'APP_SECRET_MISSING');
});

test('verifies Meta challenge tokens using provider config', () => {
  const config = createMetaProviderConfig({
    facebookVerifyToken: 'facebook-token',
    metaVerifyToken: 'meta-token',
  });

  assert.deepEqual(
    verifyMetaWebhookChallenge({
      mode: 'subscribe',
      verifyToken: 'facebook-token',
      challenge: 'challenge-value',
      config,
    }),
    { ok: true, challenge: 'challenge-value' },
  );
  assert.equal(verifyMetaWebhookChallenge({ mode: 'subscribe', verifyToken: 'wrong', config }).code, 'VERIFY_TOKEN_MISMATCH');
});

test('parses page token and business-unit maps with default token fallback', () => {
  const config = createMetaProviderConfig({
    defaultPageAccessToken: 'default-token',
    pageAccessTokenMapRaw: JSON.stringify({ 'page-1': 'mapped-token' }),
    pageBusinessUnitMapRaw: JSON.stringify({ 'page-1': 'Main Signs' }),
  });

  assert.deepEqual(parseMetaPageAccessTokenMap('not-json'), {});
  assert.deepEqual(parseMetaPageBusinessUnitMap('[]'), {});
  assert.deepEqual(resolveMetaPageAccessToken('page-1', config), {
    ok: true,
    accessToken: 'mapped-token',
    source: 'page_map',
  });
  assert.deepEqual(resolveMetaPageAccessToken('page-2', config), {
    ok: true,
    accessToken: 'default-token',
    source: 'default',
  });
  assert.deepEqual(resolveMetaPageBusinessUnitMapping('page-1', config), {
    ok: true,
    businessUnit: 'Main Signs',
    source: 'page_map',
  });
  assert.deepEqual(resolveMetaPageBusinessUnitMapping('page-2', config), {
    ok: false,
    businessUnit: null,
    source: null,
  });
});

test('returns structured missing-token errors before calling Graph', async () => {
  let called = false;
  const result = await fetchMetaLeadDetails({
    leadgenId: 'lead-1',
    pageId: 'page-1',
    config: createMetaProviderConfig(),
    fetchImpl: async () => {
      called = true;
      throw new Error('should not call fetch without a page token');
    },
  });

  assert.equal(called, false);
  assert.deepEqual(result, {
    ok: false,
    code: 'PAGE_ACCESS_TOKEN_MISSING',
    reason: META_PAGE_ACCESS_TOKEN_MISSING_REASON,
  });
});

test('returns structured errors for failed lead Graph responses', async () => {
  const calls = [];
  const config = createMetaProviderConfig({
    defaultPageAccessToken: 'default-token',
    pageAccessTokenMapRaw: JSON.stringify({ 'page-1': 'mapped-token' }),
  });

  const result = await fetchMetaLeadDetails({
    leadgenId: 'lead-1',
    pageId: 'page-1',
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: false,
        status: 400,
        async json() {
          return { error: { message: 'Invalid lead id', code: 190 } };
        },
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].url.pathname, '/v24.0/lead-1');
  assert.equal(calls[0].url.searchParams.get('access_token'), 'mapped-token');
  assert.equal(calls[0].url.searchParams.get('fields'), 'id,created_time,ad_id,form_id,page_id,field_data');
  assert.deepEqual(result, {
    ok: false,
    code: 'GRAPH_RESPONSE_ERROR',
    reason: 'Invalid lead id',
    graphStatus: 400,
    graphError: { message: 'Invalid lead id', code: 190 },
  });
});

test('returns structured errors for failed Messenger profile Graph responses', async () => {
  const config = createMetaProviderConfig({ defaultPageAccessToken: 'default-token' });

  const result = await fetchMetaMessengerProfile({
    senderId: 'sender-1',
    pageId: 'page-2',
    config,
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      async json() {
        throw new Error('invalid json');
      },
    }),
  });

  assert.deepEqual(result, {
    ok: false,
    code: 'GRAPH_RESPONSE_ERROR',
    reason: 'Graph API returned 503',
    graphStatus: 503,
    graphError: null,
  });
});

test('returns structured errors for Graph network failures', async () => {
  const config = createMetaProviderConfig({ defaultPageAccessToken: 'default-token' });

  const leadResult = await fetchMetaLeadDetails({
    leadgenId: 'lead-1',
    pageId: 'page-1',
    config,
    fetchImpl: async () => {
      throw new Error('socket closed');
    },
  });

  assert.deepEqual(leadResult, {
    ok: false,
    code: 'GRAPH_NETWORK_ERROR',
    reason: 'Meta Graph request failed.',
    graphStatus: null,
    graphError: { message: 'socket closed' },
  });

  const profileResult = await fetchMetaMessengerProfile({
    senderId: 'sender-1',
    pageId: 'page-1',
    config,
    fetchImpl: async () => {
      throw new Error('socket closed');
    },
  });

  assert.deepEqual(profileResult, {
    ok: false,
    code: 'GRAPH_NETWORK_ERROR',
    reason: 'Meta Graph request failed.',
    graphStatus: null,
    graphError: { message: 'socket closed' },
  });
});
