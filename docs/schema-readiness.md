# Reconciled schema readiness

`drizzle/reconciled-schema-manifest.json` is the release-safety baseline accepted from MIS-379. It preserves two different facts without conflating them:

- migrations `0000` through `0012` are the exact Drizzle journal prefix verified in production;
- the 15 SQL files after `0012` are repository baseline inputs whose historical apply order and journal provenance are unknown.

The unjournaled files must not be replayed or inserted into `drizzle.__drizzle_migrations` to make the history look complete. Full replay or reconciliation testing still requires a separately approved disposable clone.

## Canonical contracts

- Manifest fingerprint: recursively sort every JSON object key, preserve array order, serialize compact JSON, append one LF byte, encode as UTF-8, and hash the resulting bytes with SHA-256.
- File fingerprint: SHA-256 over the raw file bytes.
- Drizzle export fingerprint: SHA-256 over the raw stdout bytes from `drizzle-kit export --config drizzle.config.mjs`, including Drizzle's final newline. The accepted hash is `0336c9507c380e03d8ab53d4e00c17f528bb3f9068308193493caf5115eedf25`. This is a schema-declaration reproducibility check, not a migration-from-zero test.
- Catalog fingerprint: every aggregate uses the public schema. Rows are sorted by the fields documented below, fields are joined with `|`, rows are joined with LF, and PostgreSQL computes MD5 over the resulting text.

The catalog fields are:

- tables: `table_name`, ordered by `table_name`;
- columns: `table_name`, `ordinal_position`, `column_name`, `data_type`, `udt_name`, `is_nullable`, and `coalesce(column_default, '')`, ordered by table and ordinal position;
- indexes: `tablename`, `indexname`, and `indexdef` from `pg_indexes`, ordered by table and index name;
- constraints: `conrelid::regclass::text`, `conname`, `contype`, and `pg_get_constraintdef(oid, true)`, ordered by relation and constraint name.

The accepted canonical manifest SHA-256 is `ecd129516f4c87bb8815a76bfc6197b854848cd73cd49cd8b32067417a1bd1fe`; the verifier pins it outside the manifest so a manifest-only edit cannot silently redefine the baseline.

The readiness implementation owns the exact read-only SQL corresponding to that contract. It compares all four counts and all four digests, all 13 journal rows (`id`, `hash`, and `created_at`), and the exact definitions of the two known SQL-only indexes:

- `contact_people_primary_contact_idx`
- `contacts_org_archived_created_idx`

## Duplicate migration policy

The historical `0016` collision is grandfathered only as the exact two paths and raw hashes in the manifest. This exception records a known defect; it does not establish an apply order. Any changed collision or any new duplicate identifier fails readiness. New migrations must use an unused identifier at or above `0027`.

Because Drizzle metadata still ends at `0012`, the guarded `db:generate`, `db:migrate`, and `db:push` wrappers currently block before the Drizzle binary executes, even when the read-only baseline passes. An approved lineage cutover must establish a unique `0027`-or-later baseline before those guards can be opened. Direct `npx drizzle-kit`, `node_modules/.bin/drizzle-kit`, and `node_modules/drizzle-kit/bin.cjs` mutation commands are prohibited while this policy is closed.

## Real Postgres reconstruction from zero

`npm run verify:schema-from-zero` is a real PostgreSQL harness, not part of ordinary local validation. It applies the manifest's 28-file reconstructed baseline in one transaction, compares the resulting catalog and both SQL-only indexes with the same production fingerprint contract, always rolls the transaction back, and verifies that the target is empty afterward. It never creates or inserts Drizzle journal rows.

The reconstruction order is authoritative only for disposable validation. It does not claim to recover the historical order of the 15 unjournaled files.

The harness has no default target and intentionally ignores `DATABASE_URL`. It requires all of these dedicated values:

- `SCHEMA_FROM_ZERO_DATABASE_URL` with exactly one `sslmode=verify-full` query parameter and a direct non-pooler endpoint;
- `SCHEMA_FROM_ZERO_EXPECTED_HOST`, matching that URL exactly;
- `SCHEMA_FROM_ZERO_EXPECTED_PROJECT_ID`, matching the audited AIT CRM Neon project;
- `SCHEMA_FROM_ZERO_EXPECTED_BRANCH_ID`, identifying a separately approved disposable branch;
- `SCHEMA_FROM_ZERO_TARGET_LABEL`, beginning with `qa-mis-380-`;
- `SCHEMA_FROM_ZERO_CONFIRM=MIS-380_RECONSTRUCT:<branch-id>:<database>`;
- `SCHEMA_FROM_ZERO_EXECUTE=1`.

The connection URL contract is intentionally narrow: every query parameter other than `sslmode`, duplicate keys (including case/percent-encoded spellings), connection overrides (also including encoded spellings), URL fragments, pooler endpoints, and trailing-dot hostnames are rejected before a PostgreSQL client is constructed. The harness decodes and validates the URL authority fields, database, port, and the sole TLS mode, then gives `pg.Client` a new configuration object containing only those validated fields and `ssl.rejectUnauthorized=true`; it never gives the driver the original connection string.

Known staging hosts are rejected before connection. Production and staging branch IDs are rejected both from the supplied contract and again from the actual Neon identity before `BEGIN`; this protects production when endpoint hostnames rotate. The target must have zero public relations/routines and no `drizzle` schema before any SQL is applied.

Status for MIS-380: **pending approved disposable-clone validation**. The approved disposable Neon branch must expose a separately created empty test database for this from-zero run; a normal production clone is not empty and is therefore rejected. This harness was fixture-tested but was not connected to or executed against PostgreSQL in the implementation lane.

## Local verification

Run:

```bash
npm run verify:schema
npm run test:schema
```

`verify:schema` is code-only. It reads repository files and runs the deterministic Drizzle export; it does not connect to a database or claim a migration result. `verify:production` runs the same repository gate before its existing HTTP/environment checks and, when database checks are enabled, compares the live read-only catalog and journal with the exact manifest.
