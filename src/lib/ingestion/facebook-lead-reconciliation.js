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

function canonicalNanpPhone(value) {
  const digits = normalizePhone(value);
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return '';
}

function normalizeIdentityText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function phoneSuffixMatches(left, right, length = 7) {
  const leftPhone = normalizePhone(left);
  const rightPhone = normalizePhone(right);
  if (leftPhone.length < length || rightPhone.length < length) return false;
  return leftPhone.slice(-length) === rightPhone.slice(-length);
}

function likelyMetaTestLead(fieldData = []) {
  const joined = fieldData
    .flatMap((field) => Array.isArray(field?.values) ? field.values : [])
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
  return joined.includes('<test lead:') || joined.includes('test@meta.com') || joined.includes(' dummy data');
}

function hasMetaNameField(fieldData = []) {
  const names = new Set([
    'full_name', 'name', 'nombre', 'contact_name',
    'first_name', 'firstname', 'last_name', 'lastname',
  ]);
  return fieldData.some((field) => {
    const key = String(field?.name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    return names.has(key) && Array.isArray(field?.values) && field.values.some(Boolean);
  });
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

async function loadContactCandidatePool(client, { organizationId }) {
  const result = await client.query(
    `
      select
        c.id,
        c.name,
        c.company_name,
        c.address,
        c.created_at,
        (c.archived_at is not null) as is_archived,
        lower(coalesce(c.email, '')) as email_norm,
        regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') as phone_norm,
        coalesce(c.source_label, '') as source_label,
        coalesce(
          (
            select jsonb_agg(distinct cpn.normalized_phone)
            from contact_phone_numbers cpn
            where cpn.contact_id = c.id
              and cpn.organization_id = c.organization_id
              and cpn.retired_at is null
          ),
          '[]'::jsonb
        ) as additional_phone_norms,
        coalesce(
          jsonb_agg(
            distinct jsonb_build_object(
              'id', l.id,
              'sourceType', l.source_type,
              'createdAt', l.created_at
            )
          ) filter (where l.id is not null),
          '[]'::jsonb
        ) as leads
      from contacts c
      left join leads l on l.contact_id = c.id
      where c.organization_id = $1
      group by c.id, c.name, c.company_name, c.address, c.created_at, c.archived_at,
        c.email, c.phone, c.source_label, c.organization_id
      order by c.id
    `,
    [organizationId],
  );
  return result.rows.map((row) => ({
    ...row,
    name_norm: normalizeIdentityText(row.name),
    company_norm: normalizeIdentityText(row.company_name),
    address_norm: normalizeIdentityText(row.address),
    phone_norms: unique([row.phone_norm, ...(row.additional_phone_norms || [])].map(normalizePhone)),
  }));
}

export function classifyFacebookLeadContactMatches(details, contacts) {
  const email = normalizeEmail(details.email);
  const phone = normalizePhone(details.phone);
  const canonicalPhone = canonicalNanpPhone(phone);
  const byEmail = email ? contacts.filter((contact) => contact.email_norm === email) : [];
  const exactByPhone = phone ? contacts.filter((contact) => (
    unique([contact.phone_norm, ...(contact.phone_norms || [])]).includes(phone)
  )) : [];
  const canonicalByPhone = canonicalPhone ? contacts.filter((contact) => (
    unique([contact.phone_norm, ...(contact.phone_norms || [])])
      .some((candidate) => canonicalNanpPhone(candidate) === canonicalPhone)
  )) : [];
  const byPhone = unique([...exactByPhone, ...canonicalByPhone].map((contact) => contact.id))
    .map((id) => contacts.find((contact) => contact.id === id));
  const matchedContactIds = unique([...byEmail, ...byPhone].map((contact) => contact.id));
  const common = byEmail.filter((contact) => byPhone.some((candidate) => candidate.id === contact.id));

  let matchType = 'none';
  if (matchedContactIds.length > 1) matchType = 'ambiguous_or_conflicting';
  else if (matchedContactIds.length === 1 && common.length === 1) matchType = 'exact_email_and_phone';
  else if (matchedContactIds.length === 1 && byEmail.length === 1) matchType = 'exact_email';
  else if (matchedContactIds.length === 1 && exactByPhone.length === 1) matchType = 'exact_phone';
  else if (matchedContactIds.length === 1 && canonicalByPhone.length === 1) matchType = 'canonical_phone';

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
    matchedBy: {
      email: Boolean(byEmail.length),
      exactPhone: Boolean(exactByPhone.length),
      canonicalNanpPhone: Boolean(canonicalByPhone.length && !exactByPhone.length),
    },
  };
}

function hoursBetween(left, right) {
  const leftMs = Date.parse(left || '');
  const rightMs = Date.parse(right || '');
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return null;
  return Math.round((Math.abs(leftMs - rightMs) / 3_600_000) * 10) / 10;
}

export function classifyFacebookLeadBroaderMatches(details, contacts, leadCreatedAt) {
  const name = normalizeIdentityText(details.name);
  if (!name) {
    return {
      broaderMatchType: 'none',
      broaderCandidateCount: 0,
      broaderContactCandidates: [],
      broaderCandidateHasNonFacebookSource: false,
    };
  }

  const company = normalizeIdentityText(details.company);
  const address = normalizeIdentityText(details.address);
  const phone = normalizePhone(details.phone);
  const candidates = contacts.filter((contact) => contact.name_norm === name).map((contact) => {
    const candidatePhones = unique([contact.phone_norm, ...(contact.phone_norms || [])]);
    const evidence = ['exact_normalized_name'];
    if (phone && candidatePhones.some((candidatePhone) => phoneSuffixMatches(phone, candidatePhone))) {
      evidence.push('phone_last_7');
    }
    if (company && contact.company_norm === company) evidence.push('exact_normalized_company');
    if (address && contact.address_norm === address) evidence.push('exact_normalized_address');
    const createdDistanceHours = hoursBetween(leadCreatedAt, contact.created_at);
    if (createdDistanceHours !== null && createdDistanceHours <= 30 * 24) {
      evidence.push('created_within_30_days');
    }
    const identityCorroborated = evidence.some((item) => [
      'phone_last_7',
      'exact_normalized_company',
      'exact_normalized_address',
    ].includes(item));
    return {
      contactId: contact.id,
      sourceCategory: contact.source_label === 'Facebook Ads' ? 'facebook_ads' : 'non_facebook',
      isArchived: Boolean(contact.is_archived),
      existingLeadIds: unique((contact.leads || []).map((lead) => lead.id)),
      evidence,
      identityCorroborated,
      createdDistanceHours,
    };
  });

  let broaderMatchType = 'none';
  if (candidates.length > 1) broaderMatchType = 'ambiguous_manual_candidates';
  else if (candidates.length === 1 && candidates[0].identityCorroborated) {
    broaderMatchType = 'strong_manual_candidate';
  } else if (candidates.length === 1) broaderMatchType = 'possible_manual_candidate';

  return {
    broaderMatchType,
    broaderCandidateCount: candidates.length,
    broaderContactCandidates: candidates.map(({ identityCorroborated, ...candidate }) => candidate),
    broaderCandidateHasNonFacebookSource: candidates.some((candidate) => (
      candidate.sourceCategory === 'non_facebook'
    )),
  };
}

function recommendedAction(record) {
  if (!record.graphFetched) return 'manual_graph_retry';
  if (record.likelyTest) return 'exclude_test';
  if (record.linkedContactId || record.linkedLeadId) return 'already_linked';
  if (record.matchType === 'ambiguous_or_conflicting') return 'manual_review_conflicting_contact_points';
  if (record.matchType !== 'none') return 'exact_existing_contact_candidate';
  if (record.broaderMatchType === 'ambiguous_manual_candidates') return 'manual_review_ambiguous_candidates';
  if (record.broaderMatchType !== 'none') return 'manual_review_existing_candidate';
  return 'unmatched_after_manual_scan';
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
    const fieldData = graph.ok ? graph.lead?.field_data || [] : [];
    const details = graph.ok ? normalizeMetaLeadFields(fieldData) : {};
    const hasName = hasMetaNameField(fieldData);
    return {
      row,
      graph,
      details: {
        name: hasName ? normalizeIdentityText(details.name) : '',
        email: normalizeEmail(details.email),
        phone: normalizePhone(details.phone),
        company: normalizeIdentityText(details.company),
        address: normalizeIdentityText(details.address),
        hasEmail: Boolean(details.email),
        hasPhone: Boolean(details.phone),
        hasName,
        hasCompany: Boolean(details.company),
        hasAddress: Boolean(details.address),
        likelyTest: graph.ok ? likelyMetaTestLead(graph.lead?.field_data || []) : false,
      },
      leadCreatedAt: graph.ok ? graph.lead?.created_time || row.created_at : row.created_at,
    };
  });
  const contacts = await loadContactCandidatePool(client, { organizationId });

  const records = normalized.map(({ row, graph, details, leadCreatedAt }) => {
    const matches = graph.ok ? classifyFacebookLeadContactMatches(details, contacts) : {
      matchType: 'unavailable',
      matchedContactIds: [],
      matchedLeadIds: [],
      matchedFacebookLeadIds: [],
      matchedContactHasNonFacebookSource: false,
      matchedBy: { email: false, exactPhone: false, canonicalNanpPhone: false },
    };
    const broaderMatches = graph.ok && matches.matchType === 'none'
      ? classifyFacebookLeadBroaderMatches(details, contacts, leadCreatedAt)
      : {
          broaderMatchType: 'not_evaluated',
          broaderCandidateCount: 0,
          broaderContactCandidates: [],
          broaderCandidateHasNonFacebookSource: false,
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
      hasName: details.hasName,
      hasCompany: details.hasCompany,
      hasAddress: details.hasAddress,
      likelyTest: details.likelyTest,
      linkedContactId: row.linked_contact_id,
      linkedLeadId: row.linked_lead_id,
      ...matches,
      ...broaderMatches,
    };
    return { ...record, recommendedAction: recommendedAction(record) };
  });

  const count = (predicate) => records.filter(predicate).length;
  return {
    generatedAt: new Date().toISOString(),
    mode: 'dry_run_read_only',
    recoveryWritesPerformed: 0,
    target: { pageId, formId, since },
    privacy: 'No names, email addresses, phone numbers, or credential values are included.',
    matchingPolicy: {
      contactPoolScanned: contacts.length,
      exact: 'Normalized full email, full phone, or equivalent 10/11-digit NANP phone across primary and secondary numbers.',
      strongManualCandidate: 'One exact normalized-name candidate plus matching phone last 7, company, or address.',
      possibleManualCandidate: 'One exact normalized-name candidate without another identity signal.',
      ambiguousManualCandidates: 'More than one exact normalized-name candidate; manual review required.',
      automaticAttachments: false,
      automaticLeadCreation: false,
    },
    mergePolicy: {
      employeeDataOverwrite: false,
      existingContact: 'Reuse the existing Contact and fill only currently blank fields from Meta.',
      existingHistory: 'Preserve notes, tasks, ownership, lifecycle status, and follow-up history in place.',
      oneActiveOpportunity: 'Reuse it and fill only blank Facebook profile fields; append the form answers as sourced history.',
      noActiveOpportunity: 'Create one Facebook Lead Ads Opportunity under the existing Contact after approval.',
      multipleActiveOpportunities: 'Stop for manual review; never choose one automatically.',
    },
    totals: {
      preservedFailureRows: records.length,
      graphFetched: count((record) => record.graphFetched),
      graphFailed: count((record) => !record.graphFetched),
      likelyTests: count((record) => record.likelyTest),
      alreadyLinked: count((record) => record.recommendedAction === 'already_linked'),
      exactExistingContactCandidates: count((record) => record.recommendedAction === 'exact_existing_contact_candidate'),
      conflictingContactPointCandidates: count((record) => (
        record.recommendedAction === 'manual_review_conflicting_contact_points'
      )),
      strongManualCandidates: count((record) => record.broaderMatchType === 'strong_manual_candidate'),
      possibleManualCandidates: count((record) => record.broaderMatchType === 'possible_manual_candidate'),
      ambiguousManualCandidates: count((record) => record.broaderMatchType === 'ambiguous_manual_candidates'),
      unmatchedAfterManualScan: count((record) => record.recommendedAction === 'unmatched_after_manual_scan'),
      manualGraphRetry: count((record) => record.recommendedAction === 'manual_graph_retry'),
      matchedContactWithNonFacebookSource: count((record) => record.matchedContactHasNonFacebookSource),
      broaderCandidateWithNonFacebookSource: count((record) => record.broaderCandidateHasNonFacebookSource),
    },
    records,
  };
}
