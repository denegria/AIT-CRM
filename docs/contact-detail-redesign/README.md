# Contact detail redesign: design and functionality handoff

Revised September 10, 2026. **Application implementation is paused.** This package contains the selected visual direction, governing workflow contracts and a complete capability tracker; no redesigned application code is implemented by this publication.

## Current issue and authority

- Delivery issue: [MIS-408 — Detailed contact workspace redesign](https://linear.app/mission-control-v2/issue/MIS-408/ait-crm-detailed-contact-workspace-redesign-preserved-tabs-direct), Todo pending implementation instruction.
- Related historical exploration: [MIS-242](https://linear.app/mission-control-v2/issue/MIS-242/ait-crm-ui-full-contact-detail-page-rework-exploration). Its old sidebar-preservation wording is not the selected design.
- Alvaro approved the review recommendations and unknown-source fix, and requested updated documents/boards and a Linear issue. This publication changes documentation/artwork only. Application work, live mutation QA and production promotion remain separate steps.

## Read in this order

1. [Design, interaction, tab and acceptance contract](verification-and-handoff.md).
2. [Functionality parity and source correction contract](functionality-parity.md): 56 rows, including all 50 original inventory/continuity rows and six explicit improvement checks; all original field ledgers preserved.
3. [Per-capability tracker](functionality-parity.csv): every implementation result remains Not implemented / Not exercised.
4. [Board specifications and state coverage](design-board-spec.md), then the revised boards below.
5. [Current publication release packet](publication-2026-09-10.md) for actual validation/deployment status. September 7 audit results are historical baseline evidence, not a new runtime pass.

## Revised boards — one design, different states

- [Record workspace, desktop](01-contact-workspace-v2.png): clean person/opportunity facts and retained operational tabs.
- [Focused source editors](02-focused-editor-v2.png): separate opportunity and contact-only examples; no opportunity required for contact maintenance.
- [Populated Enrollments tab](03-enrollments-workspace.png): actual records, direct actions and selected history details within the tab.

These are fictional-data design artwork, not screenshots of implemented software. Text and field ledgers govern omitted conditional states. The original [September 7 Record board](01-contact-workspace.png) and [editor board](02-focused-editor.png) remain **historical, superseded interaction references**. Preserve their light visual style, not their three-tab limit or coupled source assumption. The revised boards are not three competing design options.

## September 10 changes that govern implementation

- Keep every applicable production destination: Activity, Conversations, Enrollments, Receipts/Financials, Work Orders and Signs linked People, plus Record as the clean overview. Records and actions live directly inside their tabs; no gateway-only Manage/View replacement. Optional full-detail links use existing routes.
- Remove repeated summary/context panels, duplicate creation CTAs and competing draft state, not useful operational navigation.
- Separate contact-source and exact-opportunity-source corrections. Legacy contacts need no artificial opportunity; preserve actual evidence and never guess first-touch history.
- Replace sample attribution fallback with Unknown/Not recorded. This is an approved read-path fix, not authorization for data repair/backfill.
- Define next-task ordering, preserve combined follow-up/next-task saves, direct owner/status editing, receipt download retry safety, and directory/resource return continuity.
- Desktop-first. Maintain basic responsiveness/accessibility without a new phone-first design workstream.
- No intentional capability removals. Existing forms remain reachable in each slice until their replacements pass. AIT Signs semantics and conditional USA work remain protected.

## Publication baseline

Fresh base: staging documentation commit `74ef179524a3df435ac88fece68e2634239a88d3`. Its application source matches production-lane `71821f03179aeb68cf787502998ce491effe03d0` and pre-doc staging `c9df0a06a797a477b3daeeada073bb5f14454137` in the September 10 comparison. Source equality is not proof of deployed runtime or database equality.

The previous September 7 publication reported a Windows validation failure (11 executable-spawn errors and one line-ending-sensitive fixture hash); those are not current Linux results. Consult the current release packet. Historical audit observations and private evidence remain below. Do not include customer records, QA credentials or authenticated screenshots in this public repository.

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
| F15 — Legacy field mappings | Preserve distinct locations; September 10 separates contact/opportunity source corrections rather than retaining coupled saves. |
| F16 — Course/opportunity selection mismatch | Align changed enrollment linkage/access behavior with the active-opportunity policy and use actual course IDs. |

The final handoff separates observed evidence from inferred consequences. The parity contract additionally identifies design omissions caught before implementation, including source editing, secondary fields, archive approvals, the Enrolled-to-course prompt, receipts and conditional related work.
