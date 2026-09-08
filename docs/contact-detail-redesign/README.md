# Contact detail redesign: design and functionality handoff

September 7, 2026. **Application implementation is paused.** This package publishes the approved audit/design documents to the staging branch; it does not implement the redesigned page.

## Read in this order

1. [Final design, interaction model, acceptance criteria and delivery slices](verification-and-handoff.md).
2. [Functionality parity contract and field ledgers](functionality-parity.md): 50 inventory rows; all 18 profile inputs; role, source-correction, archive, outreach, enrollment, receipt and related-record rules.
3. [Per-capability verification tracker](functionality-parity.csv): every implementation result begins Not implemented / Not exercised.
4. [Record board, desktop and mobile](01-contact-workspace.png) and [focused editor board, desktop and mobile](02-focused-editor.png).

The first redesigned variant is AIT USA contact detail. Existing AIT Signs client functionality must remain available and pass applicable shared-component regression checks. There are no intentional capability removals; the images are illustrative, and the text/field ledgers govern omitted conditional states and image inconsistencies. Mapping completion does not prove runtime parity.

## Publication scope

- User authorization: push the functionality mapping and updated handoff to staging; application implementation remains paused.
- Source branch: fresh origin/staging at c9df0a06a797a477b3daeeada073bb5f14454137. Documentation branch: codex/contact-detail-docs-20260907. The published Git commit identifies the exact candidate.
- Linear issue: none assigned. This is a bounded documentation publication, not a newly started application delivery slice.
- Included: mapping, CSV tracker, updated handoff, two fictional-data design boards and this index.
- Repository source links are relative and portable. Baseline evidence remains dated September 7; do not treat those deployment or data observations as automatically current after later releases.
- Database environment touched: none. Customer-impacting operations: none. No application source/configuration, role, provider, or CRM data changes are part of this package.
- Git-driven staging deployment may follow the push. There is no manual deployment or production promotion in this request.
- Documentation validation: local/repository links resolved; 50 unique matrix IDs; all tracker rows remain Not implemented; no machine-local paths, QA login addresses or QA contact identifier in the published text. The two design boards were visually reviewed as fictional data.
- Full local validation was attempted as required by the staging contract: repository check passed; the standard suite reported 742 tests, 728 passed, 12 failed and 2 skipped. Eleven failures were Windows executable-spawn errors for npm/drizzle-kit; one was the existing placement-review fixture's byte hash after checkout line-ending conversion. The command stopped before later TSX, lint and build steps. Application source, test scripts and existing fixture content were unchanged in Git. GitHub's Linux candidate validation is the subsequent cross-platform check; its status is recorded in GitHub and the accompanying task handoff.
- Existing fixture results inside the audit documents belong to the earlier audit, not this publication validation or a redesign implementation.
- Resume application work only after a subsequent user instruction. Live mutation QA also requires its named database/disposable-record authorization.

## Private evidence archive

This repository is public. Authenticated staging screenshots, account details and the exact QA contact identifier are retained in the local audit archive rather than committed here. No screenshot has been edited to fabricate evidence. Source-grounded findings and the limits of browser coverage remain in the documents.

| Evidence ID | Existing staging view observed | Limit |
|---|---|---|
| 20 | Administrator Courses, desktop | Empty enrollment/history view; no creation. |
| 21 | Administrator Source & routing editor | Location mappings observed; no save. |
| 22 | Mobile Courses and navigation, 390×844 | Existing layout only; no proposed-layout QA. |
| 23 | Senior Coordinator Conversations | Empty history and absent send composer; no send. |
| 24 | Senior Coordinator status/assignment editor | Controls and eligible options observed; no save. |
| 25 | Senior Coordinator archive dialog | Confirmation/reason opened and dismissed; no archive. |
| 26 | Secondary profile fields | Test, Level, School, Source Detail and Details present; no save. |
| 27 | Editable acquisition source and location fields | Existing edit capability observed; no correction submitted. |
| 28 | Receipt entry point and eligibility | Enrolled lifecycle prerequisite observed; no financial creation. |

The archive is maintained with the original Contacts audit outside this public repository. The two published PNG files contain fictional design data and are not authenticated screenshots. Missing live role, populated-data and mutation coverage is explicitly listed in the parity contract.

## Prior audit context

The original broader Contacts audit, detailed-page addendum and discarded concept rounds remain in the local audit archive. This package carries the selected detailed-page direction and its implementation requirements. These finding references explain the carried-forward requirements without requiring access to that archive:

| Finding | Carried-forward requirement |
|---|---|
| F1 — Directory return continuity | Preserve originating query, filters, page and record focus when returning from detail. |
| F2/F6 — Follow-up discoverability/context | Put next work before history; distinguish exact-task completion, outreach logging and scheduling. |
| F8 — Conversation capabilities | Preserve permitted history separately from sending, and explain readiness/blocked states. |
| F10 — Dirty drafts | Keep values across sections and failed saves; protect dismiss/navigation and restore focus. |
| F13 — Repeated summaries | Give facts one primary home and consolidate equivalent navigation/actions. |
| F14 — Contact/opportunity scope | Keep owner/status on the selected opportunity, with exact identity and correct closed/conflict states. |
| F15 — Legacy field mappings | Preserve distinct location fields and explicitly explain coupled acquisition-source correction. |
| F16 — Course/opportunity selection mismatch | Align changed enrollment linkage/access behavior with the active-opportunity policy and use actual course IDs. |

The final handoff separates observed evidence from inferred consequences. The parity contract additionally identifies design omissions caught before implementation, including source editing, secondary fields, archive approvals, the Enrolled-to-course prompt, receipts and conditional related work.
