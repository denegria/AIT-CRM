# MIS-409 — production-language visual polish revision

Objective: repaint the accepted AIT USA contact-detail workspace with
production's visual language while preserving staging's interaction model.

Owner: one `senior-builder` writer; Giuseppe accepts and promotes staging; an
independent `sentry` reviewer supplies the visual/regression verdict.

Repository: `/root/.openclaw/giuseppe-workspace/ait-crm`; worktree:
`/root/.openclaw/giuseppe-workspace/.worktrees/ait-crm-mis-409`.

Branch: `builder/mis-409-contact-workspace-s1` from exact staging application
commit `f316001` plus the Director-authored brief commit.

Validation: focused render/RBAC regressions, `npm run validate`, webpack
production build, repository policy/diff hygiene and independent review.

Delivery: return one local candidate commit and evidence only to the parent
session; branch push and deployment remain Director-owned.

Allowed actions: inspect, patch the scoped UI/tests, run local validation and
commit locally. No data write, provider send, permission/configuration change,
schema migration, branch push, deployment or production mutation.

Access: local verified worktree only for the Builder. Director-only protected
staging QA uses the documented stored credential/bypass references.

Allowed payload: only the existing role- and business-unit-scoped response and
request fields already authorized on the contact page; presentation changes do
not broaden payloads.

Forbidden payload: inaccessible Contact IDs/inquiries, other-business-unit
records, organization-wide metadata, secrets, raw placement evidence and new
raw import fields.

Serialized response contract test: keep the existing restricted and privileged
payload-boundary tests green and add no newly serialized fields.

Stop conditions: stop on any need to alter accepted workflow/data/RBAC, shared
AIT Signs presentation, the global design system, schema or production.

Acceptance: all visual invariants and responsive states pass, the independent
reviewer accepts the candidate, AIT Signs remains unchanged, and the worktree is
clean with no external effects.

## Authority and current state

Alvaro rejected the visual presentation of staging commit
`f316001663315e4c52298a8bd8c120a12c73681c` on September 13, 2026 while
retaining its interaction model and functional behavior. This document is the
governing visual continuation for MIS-409. It supersedes the visual-reference,
surface, profile-header, typography and Activity-presentation portions of
`compact-preview-revision-2026-09-11.md`; every behavioral, RBAC, data,
inquiry-lifecycle and regression contract in that document remains locked.

Staging implementation and in-scope correction are authorized. Production
promotion, production data writes, provider sends, schema changes and AIT Signs
redesign are not authorized.

## Dispatch contract

- **Repository:** `/root/.openclaw/giuseppe-workspace/ait-crm`.
- **Worktree:** `/root/.openclaw/giuseppe-workspace/.worktrees/ait-crm-mis-409`.
- **Branch:** `builder/mis-409-contact-workspace-s1`, starting from exact
  accepted staging application commit `f316001` plus Director-authored brief
  commit.
- **Environment:** local candidate only. The Builder may inspect, patch, test
  and create one local candidate commit. The Builder may not push, deploy,
  mutate staging/production data, send through a provider, change permissions,
  migrate schema or promote production.
- **Writer:** one Senior Builder on `openai/gpt-5.6-terra` with high reasoning.
  Closeout must report actual agent/model/reasoning/fallback evidence.
- **Reviewer:** an independent Sentry agent that did not implement the
  candidate supplies the final visual-fidelity and regression verdict.
- **Validation:** focused render/contract tests, `npm run validate`, production
  webpack build, repository policy/diff hygiene, then Director-controlled
  staging push and authenticated live QA only after candidate acceptance.
- **Stop:** stop on any change to the accepted inquiry/data model, shared AIT
  Signs presentation, global typography outside the scoped AIT USA contact
  surface, or need for production/schema authority.

## Objective / goal

Repaint the accepted AIT USA contact-detail workspace with production's visual
language while preserving staging's interaction model and every accepted
workflow. The result must make the Student Profile rail and main operational
workspace visibly distinct, clarify Contact versus Inquiry versus Enrollment,
and retain fast scanning without restoring Review Context.

## Agent / owner

One `senior-builder` agent is the sole writer. Requested route is
`openai/gpt-5.6-terra` with high reasoning. Giuseppe owns acceptance, staging
promotion and live QA. An independent `sentry` agent that did not implement the
candidate owns the final visual/regression verdict.

## Allowed actions / mutations

The Builder may read the repository and private local reference captures; patch
only AIT USA contact-detail presentation and its focused tests; reuse existing
tokens/components/icons; run local validation; and create one local candidate
commit. The Builder may not push, deploy, change data, call outbound providers,
change runtime configuration, alter permissions, migrate schema, rewrite the
global design system, or modify AIT Signs behavior/presentation.

## Access path

Local implementation uses the verified worktree above. Live/protected staging
is Director-only and follows
`/root/.openclaw/giuseppe-workspace/runtime/docs/ait-crm-protected-staging-access.md`
with stored credential and protection-bypass references; never print values.
The Builder does not log in to or mutate staging or production.

## Delivery contract

The Builder returns only to the parent session with the local candidate SHA,
actual route metadata, changed-file summary, validation results, local capture
paths and residual risks. PR creation, branch push, deployment and provider
mutation are outside Builder authority. Giuseppe may later push
the exact accepted candidate to the mapped `staging` branch under existing
staging authority. Production may be visually compared, but no production write
or promotion is authorized without separate explicit approval.

## Allowed payload contract

Existing role- and business-unit-scoped Contact identity, selected inquiry,
contactability, task, Activity, Conversation, Enrollment, Receipt and
conditional Work Order fields already authorized on the page may render
unchanged. This visual slice may alter presentation and human-readable empty
copy only; it may not broaden any response or request payload.

## Forbidden payload contract

Do not expose other-business-unit Contacts or inquiries, inaccessible Contact
IDs, raw placement answers, reviewer rationale/tokens, hidden academic evidence,
organization-wide owner metadata, secrets, internal authorization details, or
new raw import fields. Raw provenance already authorized for the current role
may remain available only behind the existing `Source details` disclosure.

## RBAC fixtures and null behavior

Regression coverage uses comparable permitted records for one restricted
regular coordinator and one senior coordinator/administrator. The restricted
fixture must receive no hidden Contact ID, inquiry, owner or business-unit data;
the privileged fixture must retain its current authorized controls. Existing
serialized payload-boundary tests remain green. Null/unassigned owners render
the explicit existing `Unassigned` state; no owner is inferred. Null program,
email and activity values use the truthful copy defined below without creating
or inferring data.

## User outcome

An AIT USA employee should immediately know which student is open, distinguish
the person's durable profile from the selected inquiry, and scan Activity or
another operational tab inside one visually coherent workspace. The page should
retain staging's improved workflow but feel as calm, legible and finished as
production.

## Reference classification

Both references are **faithful-reference mode within their declared scope**:

1. Private live capture
   `/root/.openclaw/giuseppe-workspace/runtime/audits/mis-409-visual-reassessment/01-production.png`
   is acceptance authority for typography character, type hierarchy, canvas
   tint, elevated surfaces, border/radius/shadow treatment, restrained semantic
   color, icon treatment, card padding and section rhythm.
2. Private live capture
   `/root/.openclaw/giuseppe-workspace/runtime/audits/mis-409-visual-reassessment/02-staging.png`
   is acceptance authority for the collapsed global navigation, persistent
   secondary rail, Activity-first tab order, exact inquiry workflows and wide
   main-workspace composition.

The captures contain private fixture/customer context. Use them for internal
comparison only; do not copy them into public docs, commits or external systems.

### Explicit permitted deviations

- Do **not** restore production's Review Context section.
- Do **not** restore production's permanently expanded global sidebar.
- Do **not** restore old Contact/Inquiry field walls, duplicate headers or old
  inquiry semantics.
- Keep staging's `Inquiries (n)` tab and all accepted exact-ID behavior.
- Improve private/raw provenance disclosure and empty-state copy as specified
  below even where production shows older wording.
- Responsive reflow may change composition below 1180px while preserving the
  same hierarchy and controls.

## Source-to-render map

| Source characteristic | Required render |
| --- | --- |
| Production tinted canvas | Use the existing production theme token treatment behind the contact rail and main workspace; avoid an undifferentiated white page. |
| Production elevated profile card | Restore the existing gradient/elevated background, `var(--radius-xl)` character, subtle border and `var(--shadow-soft)` treatment on the AIT USA profile rail. |
| Production typography | Reuse the existing `Inter` stack and production type values/character: calmer weights, readable line-height, clear label/body contrast and restrained uppercase. Do not add a font package or change global font loading. |
| Production internal cards and semantic accents | Use existing design tokens for inquiry/contactability/status grouping and icons; color communicates meaning rather than decorating every surface. |
| Production timeline cards | Preserve soft elevated event cards, comfortable padding, colored event icons/type badges and clear timestamp hierarchy. |
| Staging collapsed navigation | Retain the 64px collapsed rail and overlay expansion without shifting content. |
| Staging profile + workspace composition | Retain one sticky secondary rail beside one wide operational workspace. |
| Staging tabs and inquiries | Retain Activity, Inquiries, Conversations, Enrollments, Receipts and conditional Work Orders with their accepted behavior. |

## Locked visual and content contract

### Page composition

- Use a lightly tinted canvas with two unmistakable elevated surfaces: the
  sticky Student Profile rail and the main operational workspace.
- Keep a 24–28px desktop gap between the two surfaces and balanced page margins.
- Give the main workspace its own white/elevated background, subtle border,
  14–16px corner character and soft shadow. Tabs and their content live inside
  this surface rather than floating directly on the page canvas.
- Keep the available right-side width; do not return to a narrow centered island
  or reintroduce Review Context above the tabs.

### Student Profile rail

- Desktop width target: 320–340px where the viewport permits it. It remains
  sticky and independently recognizable as the persistent identity anchor.
- Rename the eyebrow from **Enrollment Profile** to **Student Profile**. The
  entire rail is never called an enrollment profile.
- Header order is locked:
  1. avatar plus small `Student Profile` eyebrow/status treatment;
  2. contact name on its own full-width row;
  3. concise source/subtitle when meaningful.
- The avatar must not consume the name's text column. Use a production-like
  avatar size and an 18–20px semibold name with readable line-height. Braulio
  Manuel Acosta should fit on one line at the primary viewport; genuinely long
  names may wrap naturally without clipping, ellipsis or reducing below the
  accepted readable scale.
- Do not duplicate the contact name as a competing heading above the main pane.
- Put the selected **Current inquiry** or **Latest inquiry (closed)** inside its
  own softly tinted internal card with a status-colored edge/icon and the
  existing exact inquiry actions. Keep Contact information and actions in
  separate visually named sections.
- An optional **Current enrollment** card may appear only when a real current
  enrollment exists. Enrollment history and actions remain canonical in the
  Enrollments tab.

### Main workspace, tabs and Activity

- Restore production's calmer type hierarchy and spacing rhythm across tab
  labels, filters, event titles, metadata and timestamps while preserving the
  staging content and tab order.
- The active tab and active filter use a filled/tinted selected state with clear
  contrast. Inactive items remain quiet but visibly interactive.
- Retain production-like colored event icons/type badges and soft event cards.
  Do not use color on every container; reserve it for active, status and event
  meaning.
- Timeline events show human-readable title, source/owner and date first. Raw
  workbook hashes, import keys, source rows and equivalent technical provenance
  remain collapsed behind **Source details**.
- The internal-note composer is a distinct contained surface, not a large flat
  continuation of the page background.

### Copy and empty states

- `Unknown` program becomes **No program selected**.
- `None` activity becomes **No activity recorded** where that is the meaning.
- `Missing email` becomes **No email on file**; preserve the stronger
  contactability warning copy where operationally relevant.
- Copy must derive from real state; do not hard-code a fixture name, source,
  inquiry status or business-unit label.

## Locked behavior and non-goals

- Preserve the accepted Contact → many inquiries → many enrollments model and
  every exact-ID, stale-write, duplicate/race, placement, permission and manual
  entry guard from the parent brief.
- Preserve all tab content, follow-up/outreach, Contact and Inquiry editors,
  phone history, DNC/wrong-number warnings, Receipts, Enrollment/history,
  conditional Work Orders, archive/request-approval and return/deep-link
  behavior.
- AIT Signs receives regression coverage only. Its labels, People/Contacts
  presentation, Work Orders, estimates, invoices, payments and Financials must
  not be redesigned.
- No new page-level summary, Review Context substitute, dashboard strip,
  duplicated contact identity, new font dependency, global design-system
  rewrite, schema work or data cleanup.

## Responsive contract

- **Primary CSS viewport:** 1440×900 at 100% browser zoom and normal DPR.
- **Regression viewports:** 1280×900, 1024×768, 768×900 and 390×844.
- At 1440px, the name and primary actions remain legible and the main surface
  uses the remaining width without horizontal overflow.
- Below the established stacking breakpoint, profile precedes workspace and all
  content reflows in document order. No nested page scrollbar, clipped tabs or
  horizontal document overflow.
- Long names, source labels, inquiry titles, phone/email values, translated
  strings and at least five inquiries must not break the rail or tabs.

## Acceptance evidence

- Compare production reference and candidate at the same 1440×900 viewport and
  comparable loaded contact state; compare current staging reference and
  candidate on the same basis.
- Independent reviewer must explicitly verdict: canvas/surface separation,
  profile hierarchy, typography character, name treatment, inquiry grouping,
  tab/filter states, event-card rhythm, semantic color restraint and absence of
  Review Context.
- Capture at most: one production reference, one before-staging reference, one
  candidate desktop, one candidate 390px mobile and one AIT Signs regression
  screenshot. Prefer DOM/geometry/console evidence for additional states.
- Verify browser document width at 390px, sticky/stacking behavior, tab and
  inquiry interactions, empty/loading/error/long-content states and zero new
  console/runtime errors.
- Run focused render/contract tests plus the full repository validation profile.
  Closeout names residual visual differences rather than hiding them behind a
  generic severity label.

## Render-path test

Add or update a focused test that executes the actual AIT USA contact-detail
render path and asserts the Student Profile label, one canonical contact name,
Current/Latest inquiry grouping, absence of Review Context, human-readable empty
copy and collapsed raw provenance. Exercise the same component with the AIT
Signs business-unit fixture and assert its existing labels/tab surface remain
unchanged. Keep existing serialized restricted/privileged payload tests green.

## Acceptance / done criteria

Done means the exact local candidate passes focused render/RBAC regressions,
`npm run validate`, webpack production build, repository policy and diff
hygiene; the worktree is clean; the independent reviewer accepts the declared
faithful-reference invariants; no locked behavior or payload changes; AIT Signs
is unchanged; and the Builder reports no push, deployment, data write, provider
mutation or production mutation. Staging and live QA remain subsequent Director
gates, not Builder completion.

## Stop conditions

Stop and report instead of inferring if the visual target requires a new global
font/design-system dependency, changes an accepted workflow or payload, cannot
be scoped away from AIT Signs, cannot preserve 390px reflow, needs data/schema
work, or conflicts with the parent inquiry/RBAC contract. Do not weaken tests or
silently substitute production's old interaction model.

## Expected delivery

Return one clean local candidate commit; exact changed files; actual route
metadata; focused/full validation results; matching-viewport capture paths;
AIT Signs regression evidence; residual differences/risks; and confirmation
that no push, deployment, data write or production action occurred.
