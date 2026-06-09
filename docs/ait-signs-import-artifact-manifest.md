# AIT Signs Import Artifact Manifest

Generated for MIS-172 on 2026-06-09.

## Current Repo Artifacts

The live staging repo keeps only the current actionable Import Review inputs:

- `docs/mis-171-ait-signs-import-review-page-set-aside.csv`
- `docs/mis-171-ait-signs-import-review-page-set-aside.json`
- `docs/mis-171-ait-signs-after-final-rough-review-remaining.csv`
- `docs/mis-171-ait-signs-after-final-rough-review-remaining.json`
- `docs/mis-171-ait-signs-after-final-rough-review-remaining.md`

These describe the 37 pending AIT Signs rows that should be handled by the future Import Review page.

## Archived Evidence

Generated historical evidence was archived outside the app repo:

- Archive directory: `/root/.openclaw/giuseppe-workspace/runtime/ait-crm-artifacts/20260609T174016Z-mis-172-artifact-cleanup`
- Tracked archive: `tracked-artifacts.tgz`
- Tracked extra archive: `tracked-extra-artifacts.tar.gz`
- Local-only archive: `untracked-local-artifacts.tgz`
- Ignored local archive: `ignored-local-artifacts.tgz`
- Checksums: `SHA256SUMS`

The archive includes:

- 255 tracked generated artifacts/scripts removed from the staging repo.
- 48 local-only untracked generated artifacts moved out of the worktree.
- 2 ignored local generated artifacts moved out of the worktree.
- The old 86 MB `docs/ait-usa-import-staging.json` dump.

## Linear Trail

The import-review cleanup and approval trail is tracked in Linear MIS-156 through MIS-172. The later narrowed apply issues are the authoritative write records:

- MIS-168: approved source-row actions
- MIS-170: rough-match approvals
- MIS-171: final rough-review directions
- MIS-172: artifact cleanup and Linear closeout

## Guardrail

This cleanup changed repo artifacts only. It did not perform database writes, change product behavior, modify parser semantics, or alter import-review statuses.
