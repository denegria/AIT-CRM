function normalizedEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizedPhone(value) {
  return typeof value === 'string' ? value.replace(/[^0-9+]/g, '') : '';
}

function contactIds(rows = []) {
  return [...new Set(rows.map((row) => row.id).filter(Boolean))].sort();
}

/**
 * Resolves the supplied normalized identity evidence without choosing between
 * candidates. Callers must use `status` to explicitly attach, create, or
 * place the submission in review.
 */
export async function classifyContactIdentity(client, { organizationId, email, phone }) {
  const evidence = {
    email: normalizedEmail(email),
    phone: normalizedPhone(phone),
  };
  const [emailResult, phoneResult] = await Promise.all([
    evidence.email
      ? client.query(
        'select id from contacts where organization_id = $1 and lower(email) = $2 order by id asc',
        [organizationId, evidence.email],
      )
      : Promise.resolve({ rows: [] }),
    evidence.phone
      ? client.query(
        "select id from contacts where organization_id = $1 and regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g') = $2 order by id asc",
        [organizationId, evidence.phone],
      )
      : Promise.resolve({ rows: [] }),
  ]);
  const matches = {
    email: contactIds(emailResult.rows),
    phone: contactIds(phoneResult.rows),
  };
  const resolvedIds = [...new Set([...matches.email, ...matches.phone])].sort();

  if (matches.email.length > 1 || matches.phone.length > 1) {
    return {
      status: 'ambiguous',
      reason: matches.email.length > 1 ? 'email_matches_multiple_contacts' : 'phone_matches_multiple_contacts',
      evidence,
      matches,
      contactId: null,
    };
  }
  if (matches.email[0] && matches.phone[0] && matches.email[0] !== matches.phone[0]) {
    return {
      status: 'ambiguous',
      reason: 'email_and_phone_resolve_to_different_contacts',
      evidence,
      matches,
      contactId: null,
    };
  }
  if (resolvedIds.length === 1) {
    return {
      status: 'exact',
      reason: 'identifiers_resolve_to_one_contact',
      evidence,
      matches,
      contactId: resolvedIds[0],
    };
  }
  return {
    status: 'new',
    reason: 'no_matching_contact',
    evidence,
    matches,
    contactId: null,
  };
}
