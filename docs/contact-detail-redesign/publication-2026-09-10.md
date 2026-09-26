# MIS-408 documentation publication — September 10, 2026

## Issue

[MIS-408 — Detailed contact workspace redesign](https://linear.app/mission-control-v2/issue/MIS-408/ait-crm-detailed-contact-workspace-redesign-preserved-tabs-direct), Todo. Application implementation remains paused.

## Brief/reference

[Current handoff](verification-and-handoff.md), [parity contract](functionality-parity.md), [board contract](design-board-spec.md). Alvaro approved the review recommendations, the missing-source fallback fix as implementation scope, and publication of the updated planning package. No CRM mutations, provider sends or production promotion are included.

## Candidate commit

Fresh base `74ef179524a3df435ac88fece68e2634239a88d3` from `origin/staging`. This file travels with the documentation candidate; the exact published commit and deployment outcome are recorded in MIS-408 to avoid a self-referential commit field.

## Scope and files

Documentation/artwork only under `docs/contact-detail-redesign/`: revised README, handoff, parity Markdown/CSV, board contract, three versioned generated boards, prompt record and this packet. Original boards retained as historical references. No `src/`, schema, configuration, dependencies or existing fixture edits.

## Validation

`npm run validate` passed locally on the fresh issue worktree (exit 0): repository contract; standard suite 742 tests, 740 passed / 2 skipped / 0 failed; focused TSX/route suite 66 passed / 0 failed; lint and production build passed. Total 806 passing tests, two pre-existing skips. Node 24.15.0 locally; GitHub workflow uses Node 22. No environment files or credentials were copied into the worktree and no live database/provider actions were performed.

Documentation checks: all 56 unique IDs and six matrix columns match the CSV; every implementation row remains Not implemented / Not exercised; all 18 original profile-ledger entries and other domain ledgers retained; relative links resolve; `git diff --check` clean; all changes restricted to the documentation package. Images inspected against source references and saved with matching bytes. These results validate the publication, not the unimplemented redesign. Exact GitHub/Node-22 CI and staging deployment results are recorded in MIS-408 after publication.

## Browser evidence / image inspection

No new application UI exists to exercise; authenticated app/browser mutation QA is not applicable to this documentation-only diff. The three supplied-reference image revisions were visually inspected. They show the intended retained tabs, independent source save scopes and populated enrollment actions. They are not implemented screens.

Remaining artwork limits, governed by text:

- The Record board was refined to restore the general Edit opportunity action, remove duplicate inquiry/program presentation and omit an unsupported last-edited author. Real implementations must not invent actor/date/source evidence.
- Record and Enrollments examples illustrate different moments in a fictional relationship, not a synchronized fixture timeline.
- No-opportunity source editing is illustrated in the separate contact editor example. Closed/conflict/denied/failed/dirty states and other populated tabs remain required textual contracts and future implementation QA.
- Generated row actions are illustrative: Complete/End still invoke the existing confirmation/editor, never immediate mutation on row selection. Eligibility and permissions govern all controls.

## Deployment URL

Staging application alias: https://ait-crm-git-staging-alvaros-projects-efb8ae58.vercel.app . Any deployment is Git-triggered documentation publication, not a working redesigned contact page. Exact deployment/commit outcome will be recorded in MIS-408 after verification. No manual deployment or production promotion.

## Sentry status

No new Sentry telemetry query is needed to validate a docs-only diff. No customer records, provider payloads or source corrections were executed or transmitted to telemetry. No claim of a clean application runtime is made from documentation validation.

## Approval state and residual risk

Documentation/board update and issue creation authorized; application implementation pending subsequent instruction. All 56 tracker rows remain Not implemented / Not exercised. Source split and unknown-source correction are specified, not fixed in running code. Exact-task ordering is an explicit proposed implementation contract. Live CRM mutation QA requires separate disposable-record authority and verified staging DB target. Production is untouched.
