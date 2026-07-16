# MIS-324 duplicate Contact merge policy

The roster importer may merge only duplicate Contact IDs explicitly listed in
an approved, hash-verified manifest. Different-name shared-phone families are
never merge candidates.

Before each merge, the service reads PostgreSQL's foreign-key catalog and
counts every row related to the duplicate Contact. An unknown relationship
aborts the transaction. Known policies are:

- Reparent ordinary lead, task, communication, note, activity, financial, and
  related-person rows to the canonical Contact.
- Consolidate matching phone-history rows while preserving do-not-call,
  wrong-number, channel-consent, and source metadata. Keep distinct historical
  numbers.
- Consolidate matching channel-consent rows conservatively: opt-out wins, and
  the absorbed row is preserved in merge metadata while consent events are
  reparented.
- Preserve colliding active course and follow-up-sequence rows by marking the
  duplicate row `merged_duplicate` before reparenting it.
- Preserve duplicate campaign-recipient delivery evidence with a null Contact
  reference and explicit merge metadata when the canonical Contact already has
  a row in that campaign.
- OR Contact-level do-not-call and wrong-number flags, fill only missing
  canonical profile fields, then archive the duplicate Contact with the audit
  run reference.

Every apply is transaction-bound, advisory-locked, idempotent, and recorded in
`contact_merge_runs`. The source Contact is not hard-deleted. A post-merge
inventory must show zero remaining non-audit relationships or the transaction
rolls back.

Production merge/apply remains separately approval-gated.
