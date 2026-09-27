// Called inside the CRM event-ingestion transaction after the Portal's verified
// result claim has resolved to one existing student contact. Never infer a
// student from the payer or create an enrollment here.
export async function linkClaimedPlacementToRegistration(client, {
  organizationId, businessUnitId, contactId, placement,
}) {
  const portalAccountId = String(placement?.portalAccountId || '');
  const attemptId = String(placement?.attemptId || '');
  const recommendedLevel = String(placement?.recommendedLevelLabel || '');
  if (!portalAccountId || !attemptId || !recommendedLevel) return { status: 'legacy_event' };

  const candidates = await client.query(
    `select id, metadata_json from contact_course_records
      where organization_id = $1 and business_unit_id = $2 and contact_id = $3
        and status = 'planned'
        and metadata_json->>'programCode' = 'english_program'
        and metadata_json->>'registrationState' in ('payment_pending', 'payment_verified')
      order by created_at desc limit 2 for update`,
    [organizationId, businessUnitId, contactId],
  );
  if (!candidates.rows.length) return { status: 'no_registration' };
  if (candidates.rows.length !== 1) return { status: 'ambiguous_registration' };
  const record = candidates.rows[0];
  const metadata = typeof record.metadata_json === 'string'
    ? JSON.parse(record.metadata_json) : record.metadata_json || {};
  if (metadata.portalAccountId && metadata.portalAccountId !== portalAccountId) {
    return { status: 'account_conflict' };
  }
  if (metadata.placement?.attemptId) {
    return { status: metadata.placement.attemptId === attemptId ? 'already_linked' : 'attempt_conflict' };
  }
  const nextPlacement = {
    attemptId,
    resultId: placement.resultId,
    recommendedLevel,
    reviewStatus: 'pending',
    finalLevel: null,
  };
  await client.query(
    `update contact_course_records
        set metadata_json = jsonb_set(jsonb_set(jsonb_set(metadata_json,
              '{portalAccountId}', to_jsonb($5::text), true),
              '{placement}', $6::jsonb, true),
              '{placementState}', to_jsonb('recommended'::text), true),
            updated_at = now()
      where id = $4 and organization_id = $1 and business_unit_id = $2 and contact_id = $3`,
    [organizationId, businessUnitId, contactId, record.id, portalAccountId, JSON.stringify(nextPlacement)],
  );
  return { status: 'linked', enrollmentId: record.id };
}
