import {
  META_GRAPH_API_VERSION,
  normalizeMetaLeadFields,
  resolveMetaPageAccessToken,
} from '../messaging/providers/meta.js';

const DEFAULT_CONCURRENCY = 4;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D+/g, '');
}

function likelyMetaTestLead(fieldData = []) {
  const joined = fieldData
    .flatMap((field) => Array.isArray(field?.values) ? field.values : [])
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
  return joined.includes('<test lead:') || joined.includes('test@meta.com') || joined.includes(' dummy data');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function mapConcurrent(items, concurrency, mapper) {
  const output = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length || 1) }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      output[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return output;
}

export async function fetchMetaLeadDetailsWithHeader({
  leadgenId,
  pageId,
  config,
  fetchImpl = globalThis.fetch,
}) {
  const tokenResult = resolveMetaPageAccessToken(pageId, config);
  if (!leadgenId || !tokenResult.ok) {
    return {
      ok: false,
      status: null,
      code: tokenResult.code || 'LEADGEN_ID_MISSING',
    };
  }

  const version = config.graphApiVersion || META_GRAPH_API_VERSION;
  const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(leadgenId)}`);
  url.searchParams.set('fields', 'id,created_time,ad_id,form_id,field_data');

  let response;
  try {
    response = await fetchImpl(url, {
      cache: 'no-store',
      headers: { authorization: `Bearer ${tokenResult.accessToken}` },
    });
  } catch {
    return { ok: false, status: null, code: 'GRAPH_NETWORK_ERROR' };
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      code: body?.error?.code ? `GRAPH_${body.error.code}` : 'GRAPH_RESPONSE_ERROR',
    };
  }
  return { ok: true, status: response.status, lead: body };
}

async function loadPreservedFailures(client, { organizationId, pageId, formId, since }) {
  const result = await client.query(
    `
      select
        nr.id as normalized_record_id,
        nr.source_row_id,
        nr.created_at,
        nr.proposed_contact_json->>'contact_id' as linked_contact_id,
        nr.proposed_lead_json->>'lead_id' as linked_lead_id,
        sr.raw_values_json->>'leadgen_id' as leadgen_id,
        sr.raw_values_json->>'graph_fetch' as prior_graph_fetch
      from import_normalized_records nr
      join import_source_rows sr on sr.id = nr.source_row_id
      join import_batches ib on ib.id = nr.import_batch_id
      where ib.organization_id = $1
        and nr.record_type = 'lead'
        and nr.status = 'needs_review'
        and sr.raw_values_json->>'source' = 'facebook_lead_ads'
        and sr.raw_values_json->>'page_id' = $2
        and sr.raw_values_json->>'form_id' = $3
        and nr.created_at >= $4::timestamptz
      order by nr.created_at asc, nr.id asc
    `,
    [organizationId, pageId, formId, since],
  );
  return result.rows;
}

async function loadContactMatches(client, { organizationId, emails, phones }) {
  if (!emails.length && !phones.length) return [];
  const result = await client.query(
    `
      select
        c.id,
        lower(coalesce(c.email, '')) as email_norm,
        regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') as phone_norm,
        coalesce(c.source_label, '') as source_label,
        coalesce(
          jsonb_agg(
            distinct jsonb_build_object('id', l.id, 'sourceType', l.source_type)
          ) filter (where l.id is not null),
          '[]'::jsonb
        ) as leads
      from contacts c
      left join leads l on l.contact_id = c.id
      where c.organization_id = $1
        and (
          (cardinality($2::text[]) > 0 and lower(coalesce(c.email, '')) = any($2::text[]))
          or (cardinality($3::text[]) > 0 and regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') = any($3::text[]))
        )
      group by c.id, c.email, c.phone, c.source_label
      order by c.id
    `,
    [organizationId, emails, phones],
  );
  return result.rows;
}

export function classifyFacebookLeadContactMatches(details, contacts) {
  const email = normalizeEmail(details.email);
  const phone = normalizePhone(details.phone);
  const byEmail = email ? contacts.filter((contact) => contact.email_norm === email) : [];
  const byPhone = phone ? contacts.filter((contact) => contact.phone_norm === phone) : [];
  const matchedContactIds = unique([...byEmail, ...byPhone].map((contact) => contact.id));
  const common = byEmail.filter((contact) => byPhone.some((candidate) => candidate.id === contact.id));

  let matchType = 'none';
  if (matchedContactIds.length > 1) matchType = 'ambiguous_or_conflicting';
  else if (matchedContactIds.length === 1 && common.length === 1) matchType = 'exact_email_and_phone';
  else if (matchedContactIds.length === 1 && byEmail.length === 1) matchType = 'exact_email';
  else if (matchedContactIds.length === 1 && byPhone.length === 1) matchType = 'exact_phone';

  const matched = contacts.filter((contact) => matchedContactIds.includes(contact.id));
  const matchedLeadIds = unique(matched.flatMap((contact) => (contact.leads || []).map((lead) => lead.id)));
  const matchedFacebookLeadIds = unique(matched.flatMap((contact) => (
    contact.leads || []
  ).filter((lead) => lead.sourceType === 'facebook_lead_ads').map((lead) => lead.id)));

  return {
    matchType,
    matchedContactIds,
    matchedLeadIds,
    matchedFacebookLeadIds,
    matchedContactHasNonFacebookSource: matched.some((contact) => contact.source_label !== 'Facebook Ads'),
  };
}

function recommendedAction(record) {
  if (!record.graphFetched) return 'manual_graph_retry';
  if (record.likelyTest) return 'exclude_test';
  if (record.linkedContactId || record.linkedLeadId) return 'already_linked';
  if (record.matchType === 'ambiguous_or_conflicting') return 'manual_review';
  if (record.matchType !== 'none') return 'attach_existing_candidate';
  return 'create_new_candidate';
}

export async function reconcileFacebookLeadAdsFailures(client, {
  organizationId,
  pageId,
  formId,
  since,
  metaConfig,
  fetchLeadDetails = fetchMetaLeadDetailsWithHeader,
  concurrency = DEFAULT_CONCURRENCY,
}) {
  const preservedRows = await loadPreservedFailures(client, { organizationId, pageId, formId, since });
  const fetched = await mapConcurrent(preservedRows, concurrency, async (row) => ({
    row,
    graph: await fetchLeadDetails({ leadgenId: row.leadgen_id, pageId, config: metaConfig }),
  }));
  const normalized = fetched.map(({ row, graph }) => {
    const details = graph.ok ? normalizeMetaLeadFields(graph.lead?.field_data || []) : {};
    return {
      row,
      graph,
      details: {
        email: normalizeEmail(details.email),
        phone: normalizePhone(details.phone),
        hasEmail: Boolean(details.email),
        hasPhone: Boolean(details.phone),
        likelyTest: graph.ok ? likelyMetaTestLead(graph.lead?.field_data || []) : false,
      },
    };
  });
  const contacts = await loadContactMatches(client, {
    organizationId,
    emails: unique(normalized.map((entry) => entry.details.email)),
    phones: unique(normalized.map((entry) => entry.details.phone)),
  });

  const records = normalized.map(({ row, graph, details }) => {
    const matches = graph.ok ? classifyFacebookLeadContactMatches(details, contacts) : {
      matchType: 'unavailable',
      matchedContactIds: [],
      matchedLeadIds: [],
      matchedFacebookLeadIds: [],
      matchedContactHasNonFacebookSource: false,
    };
    const record = {
      normalizedRecordId: row.normalized_record_id,
      sourceRowId: row.source_row_id,
      leadgenId: row.leadgen_id,
      createdAt: row.created_at,
      priorGraphFetch: row.prior_graph_fetch,
      graphFetched: graph.ok,
      graphStatus: graph.ok ? graph.status || 200 : graph.status || null,
      graphCode: graph.ok ? null : graph.code || 'GRAPH_ERROR',
      hasEmail: details.hasEmail,
      hasPhone: details.hasPhone,
      likelyTest: details.likelyTest,
      linkedContactId: row.linked_contact_id,
      linkedLeadId: row.linked_lead_id,
      ...matches,
    };
    return { ...record, recommendedAction: recommendedAction(record) };
  });

  const count = (predicate) => records.filter(predicate).length;
  return {
    generatedAt: new Date().toISOString(),
    mode: 'dry_run_read_only',
    target: { pageId, formId, since },
    privacy: 'No names, email addresses, phone numbers, or credential values are included.',
    totals: {
      preservedFailureRows: records.length,
      graphFetched: count((record) => record.graphFetched),
      graphFailed: count((record) => !record.graphFetched),
      likelyTests: count((record) => record.likelyTest),
      alreadyLinked: count((record) => record.recommendedAction === 'already_linked'),
      exactExistingContact: count((record) => record.recommendedAction === 'attach_existing_candidate'),
      ambiguousOrConflicting: count((record) => record.recommendedAction === 'manual_review'),
      createNewCandidate: count((record) => record.recommendedAction === 'create_new_candidate'),
      manualGraphRetry: count((record) => record.recommendedAction === 'manual_graph_retry'),
      matchedContactWithNonFacebookSource: count((record) => record.matchedContactHasNonFacebookSource),
    },
    records,
  };
}
