import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyFacebookLeadBroaderMatches,
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

test('matches a nameless manual contact by an equivalent NANP phone across primary or secondary numbers', () => {
  const result = classifyFacebookLeadContactMatches(
    { phone: '+1 (305) 555-0100' },
    [{
      id: 'contact-1',
      email_norm: '',
      phone_norm: '',
      phone_norms: ['3055550100'],
      source_label: 'Cold Call',
      leads: [{ id: 'lead-existing', sourceType: 'manual' }],
    }],
  );

  assert.equal(result.matchType, 'canonical_phone');
  assert.deepEqual(result.matchedContactIds, ['contact-1']);
  assert.deepEqual(result.matchedBy, {
    email: false,
    exactPhone: false,
    canonicalNanpPhone: true,
  });
  assert.equal(result.matchedContactHasNonFacebookSource, true);
});

test('keeps equivalent NANP phone ownership across multiple contacts ambiguous', () => {
  const result = classifyFacebookLeadContactMatches(
    { phone: '+1 305 555 0100' },
    [
      { id: 'contact-1', email_norm: '', phone_norm: '3055550100', source_label: '', leads: [] },
      { id: 'contact-2', email_norm: '', phone_norm: '13055550100', source_label: '', leads: [] },
    ],
  );

  assert.equal(result.matchType, 'ambiguous_or_conflicting');
  assert.deepEqual(result.matchedContactIds.sort(), ['contact-1', 'contact-2']);
});

test('classifies a unique exact-name match with identity corroboration as a strong manual candidate', () => {
  const result = classifyFacebookLeadBroaderMatches(
    {
      name: 'José Example',
      phone: '+1 (305) 555-0100',
      company: 'Example & Sons',
    },
    [{
      id: 'contact-1',
      name_norm: 'jose example',
      company_norm: 'example sons',
      address_norm: '',
      phone_norm: '3055550100',
      phone_norms: ['3055550100'],
      source_label: 'Cold Call',
      created_at: '2026-08-21T12:00:00.000Z',
      is_archived: false,
      leads: [{ id: 'lead-existing', sourceType: 'manual' }],
    }],
    '2026-08-20T12:00:00.000Z',
  );

  assert.equal(result.broaderMatchType, 'strong_manual_candidate');
  assert.equal(result.broaderCandidateCount, 1);
  assert.equal(result.broaderCandidateHasNonFacebookSource, true);
  assert.deepEqual(result.broaderContactCandidates[0].evidence, [
    'exact_normalized_name',
    'phone_last_7',
    'exact_normalized_company',
    'created_within_30_days',
  ]);
});

test('keeps duplicate exact-name contacts in the ambiguous manual-review bucket', () => {
  const contacts = ['contact-1', 'contact-2'].map((id) => ({
    id,
    name_norm: 'alex smith',
    company_norm: '',
    address_norm: '',
    phone_norm: '',
    phone_norms: [],
    source_label: 'Manual entry',
    leads: [],
  }));
  const result = classifyFacebookLeadBroaderMatches({ name: 'Alex Smith' }, contacts, null);

  assert.equal(result.broaderMatchType, 'ambiguous_manual_candidates');
  assert.equal(result.broaderCandidateCount, 2);
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
            name: 'Existing Person',
            company_name: null,
            address: null,
            created_at: '2026-08-19T12:00:00.000Z',
            is_archived: false,
            email_norm: 'existing@example.com',
            phone_norm: '',
            additional_phone_norms: [],
            source_label: 'Manual entry',
            leads: [],
          }],
        };
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const leadPayloads = {
    'leadgen-1': [
      { name: 'full_name', values: ['Existing Person'] },
      { name: 'email', values: ['existing@example.com'] },
    ],
    'leadgen-2': [
      { name: 'full_name', values: ['Unmatched Person'] },
      { name: 'phone_number', values: ['+1 305 555 0101'] },
    ],
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
      lead: {
        id: leadgenId,
        created_time: '2026-08-20T12:00:00.000Z',
        field_data: leadPayloads[leadgenId],
      },
    }),
  });

  assert.equal(manifest.mode, 'dry_run_read_only');
  assert.equal(manifest.recoveryWritesPerformed, 0);
  assert.equal(manifest.matchingPolicy.contactPoolScanned, 1);
  assert.equal(manifest.matchingPolicy.automaticAttachments, false);
  assert.equal(manifest.matchingPolicy.automaticLeadCreation, false);
  assert.equal(manifest.mergePolicy.employeeDataOverwrite, false);
  assert.equal(manifest.totals.preservedFailureRows, 2);
  assert.equal(manifest.totals.graphFetched, 2);
  assert.equal(manifest.totals.exactExistingContactCandidates, 1);
  assert.equal(manifest.totals.unmatchedAfterManualScan, 1);
  assert.equal(manifest.records[0].recommendedAction, 'exact_existing_contact_candidate');
  assert.equal(manifest.records[1].recommendedAction, 'unmatched_after_manual_scan');
  assert.equal(JSON.stringify(manifest).includes('existing@example.com'), false);
  assert.equal(JSON.stringify(manifest).includes('13055550101'), false);
  assert.equal(JSON.stringify(manifest).includes('Existing Person'), false);
  assert.equal(JSON.stringify(manifest).includes('Unmatched Person'), false);
  assert.equal(queries.some((sql) => /\b(insert|update|delete)\b/.test(sql)), false);
});
