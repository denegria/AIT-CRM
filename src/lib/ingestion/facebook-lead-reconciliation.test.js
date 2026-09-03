import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyFacebookLeadContactMatches,
  fetchMetaLeadDetailsWithHeader,
  reconcileFacebookLeadAdsFailures,
} from './facebook-lead-reconciliation.js';

test('fetches Meta lead details with an authorization header and no credential in the URL', async () => {
  const seen = {};
  const result = await fetchMetaLeadDetailsWithHeader({
    leadgenId: 'lead-1',
    pageId: 'page-1',
    config: { defaultPageAccessToken: 'secret-token', graphApiVersion: 'v25.0' },
    fetchImpl: async (url, options) => {
      seen.url = String(url);
      seen.authorization = options.headers.authorization;
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'lead-1', field_data: [] }),
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(seen.authorization, 'Bearer secret-token');
  assert.equal(seen.url.includes('secret-token'), false);
  assert.match(seen.url, /fields=/);
});

test('classifies one contact matching both normalized channels', () => {
  const result = classifyFacebookLeadContactMatches(
    { email: 'Person@Example.com', phone: '+1 (305) 555-0100' },
    [{
      id: 'contact-1',
      email_norm: 'person@example.com',
      phone_norm: '13055550100',
      source_label: 'Manual entry',
      leads: [{ id: 'lead-existing', sourceType: 'website' }],
    }],
  );

  assert.equal(result.matchType, 'exact_email_and_phone');
  assert.deepEqual(result.matchedContactIds, ['contact-1']);
  assert.deepEqual(result.matchedLeadIds, ['lead-existing']);
  assert.equal(result.matchedContactHasNonFacebookSource, true);
});

test('classifies conflicting email and phone matches for manual review', () => {
  const result = classifyFacebookLeadContactMatches(
    { email: 'person@example.com', phone: '13055550100' },
    [
      { id: 'contact-email', email_norm: 'person@example.com', phone_norm: '', source_label: '', leads: [] },
      { id: 'contact-phone', email_norm: '', phone_norm: '13055550100', source_label: '', leads: [] },
    ],
  );

  assert.equal(result.matchType, 'ambiguous_or_conflicting');
  assert.deepEqual(result.matchedContactIds.sort(), ['contact-email', 'contact-phone']);
});

test('builds a PII-free dry-run manifest without database writes', async () => {
  const queries = [];
  const client = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      queries.push(normalized);
      if (normalized.includes('from import_normalized_records')) {
        return {
          rows: [
            {
              normalized_record_id: 'normalized-1',
              source_row_id: 'source-1',
              created_at: '2026-08-20T12:00:00.000Z',
              linked_contact_id: null,
              linked_lead_id: null,
              leadgen_id: 'leadgen-1',
              prior_graph_fetch: 'failed',
            },
            {
              normalized_record_id: 'normalized-2',
              source_row_id: 'source-2',
              created_at: '2026-08-21T12:00:00.000Z',
              linked_contact_id: null,
              linked_lead_id: null,
              leadgen_id: 'leadgen-2',
              prior_graph_fetch: 'failed',
            },
          ],
        };
      }
      if (normalized.includes('from contacts')) {
        return {
          rows: [{
            id: 'contact-1',
            email_norm: 'existing@example.com',
            phone_norm: '',
            source_label: 'Manual entry',
            leads: [],
          }],
        };
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const leadPayloads = {
    'leadgen-1': [{ name: 'email', values: ['existing@example.com'] }],
    'leadgen-2': [{ name: 'phone_number', values: ['+1 305 555 0101'] }],
  };

  const manifest = await reconcileFacebookLeadAdsFailures(client, {
    organizationId: 'organization-1',
    pageId: 'page-1',
    formId: 'form-1',
    since: '2026-08-16T00:00:00.000Z',
    metaConfig: {},
    fetchLeadDetails: async ({ leadgenId }) => ({
      ok: true,
      status: 200,
      lead: { id: leadgenId, field_data: leadPayloads[leadgenId] },
    }),
  });

  assert.equal(manifest.mode, 'dry_run_read_only');
  assert.equal(manifest.totals.preservedFailureRows, 2);
  assert.equal(manifest.totals.graphFetched, 2);
  assert.equal(manifest.totals.exactExistingContact, 1);
  assert.equal(manifest.totals.createNewCandidate, 1);
  assert.equal(manifest.records[0].recommendedAction, 'attach_existing_candidate');
  assert.equal(manifest.records[1].recommendedAction, 'create_new_candidate');
  assert.equal(JSON.stringify(manifest).includes('existing@example.com'), false);
  assert.equal(JSON.stringify(manifest).includes('13055550101'), false);
  assert.equal(queries.some((sql) => /\b(insert|update|delete)\b/.test(sql)), false);
});
