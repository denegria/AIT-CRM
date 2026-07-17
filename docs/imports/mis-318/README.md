# MIS-318 student roster manifest lanes

This directory tracks the lineage and current state of the Bound Brook and
Plainfield student-roster work. Row-level files contain private student data and
are intentionally stored under the repo-local, Git-ignored
`private-imports/mis-318/` vault. The current review workbooks are attached to
the relevant Linear issues. The private vault also contains canonical JSON
execution manifests for the dry-run/apply service; their hashes and sizes are
tracked here without publishing student data.

## Lanes

1. **Inactive students / dropped-course history** — final identity and course
   action manifest. Data apply is held pending product gates, dry-run review,
   and explicit approval. Historical rows retain course and campus but do not
   fabricate class-section assignments; their `class_section_id` remains null
   unless a future evidence-backed reconciliation supplies a real section.
2. **Active enrollments** — current-contact and active-course manifest generated
   from the corrected 147-student roster. Data apply is held pending identity
   review and product gates. The source class-section key is preserved so a
   future attendance model can attach to real class sections rather than
   growing date columns or flattening schedules into Contact notes.
3. **Attendance** — absolute last. Existing extracted attendance files are
   archived for lineage only and are not approved manifests. They must be
   regenerated and revalidated against the final active-enrollment manifest and
   original workbooks before use.

Linear ownership: inactive `MIS-318`, active enrollment `MIS-323`, and
attendance `MIS-272`. Product gates are `MIS-319` through `MIS-322`, plus
collision-safe Contact merge slice `MIS-324`.

## Privacy and source of truth

- Never commit the original XLSX files, cleaned row-level workbooks, production
  snapshots, or row-level manifests to Git.
- `manifest-index.json` is the tracked, non-PII inventory. It records relative
  vault paths, hashes, sizes, counts, lane state, and required product gates.
- The original source workbooks remain immutable. All transformations must keep
  source sheet/cell lineage and pass the manifest validators.
- For the inactive lane, a usable phone in the original workbook is the
  owner-approved authoritative Contact primary. Existing CRM phones, absorbed
  duplicate-Contact phones, and other valid source numbers remain phone
  history; they are never discarded merely because the workbook phone becomes
  primary.
- Production data writes remain separately approval-gated.
- Current product gates are tracked in `manifest-index.json`: controlled
  Computer/Math courses, Contact phone history, first-class class sections with
  multiple active enrollments, and an idempotent manifest dry-run/apply path.

## Rebuild

From the repository root:

```bash
python3 scripts/imports/mis-318-build-manifests.py \
  --source-root /root/.openclaw/giuseppe-workspace/runtime/imports/ait-usa-student-rosters-20260716 \
  --vault-root private-imports/mis-318

python3 scripts/imports/mis-318-validate-manifests.py \
  --source-root /root/.openclaw/giuseppe-workspace/runtime/imports/ait-usa-student-rosters-20260716 \
  --vault-root private-imports/mis-318
```

The builder is read-only with respect to CRM data. It consumes the verified
production snapshot and local workbook artifacts; it never connects to or
writes to a database.

## Dry-run and apply

`MIS-322` verifies the JSON content hash, source workbook checksum, row counts,
lane ordering, freshness, and per-row idempotency keys. Attendance manifests
are rejected. Dry-run writes only a private JSON report.

```bash
DATABASE_URL=... node scripts/imports/run-roster-manifest.mjs \
  --mode dry-run \
  --manifest private-imports/mis-318/manifests/execution/ait-usa-inactive-student-actions-v1.json \
  --source-workbook private-imports/mis-318/manifests/ait-usa-inactive-student-final-action-manifest.xlsx \
  --output private-imports/mis-318/reports/inactive-dry-run.json
```

Apply additionally requires an unexpired manifest-specific HMAC approval,
`AIT_CRM_IMPORT_APPROVAL_SECRET`, and an exact `--confirm-target-host` value.
It rechecks live Contact identity, lifecycle, course duplicates, lane order,
and prior idempotency keys inside a transaction with an advisory lock.

Physical duplicate-Contact merges are intentionally a hard dry-run blocker.
The current inactive manifest contains merge proposals whose related records
must be safely reparented and collision-tested before those rows can apply.
The engine will not archive or delete a duplicate Contact merely to make the
import proceed. All data remains held pending final production dry-run review
and explicit production-write approval.
