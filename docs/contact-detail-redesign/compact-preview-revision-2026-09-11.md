# MIS-409 — compact contact workspace continuation

## Authority and current status

Alvaro approved this continuation on September 12, 2026 after reviewing deployed staging commit `28e02a9`. The compact two-rail structure is retained, but the rendered workspace is approximately 10–15% under-scaled. The earlier top-to-bottom Record boards remain historical and are not implementation authority.

This document is the governing implementation brief for [MIS-409](https://linear.app/mission-control-v2/issue/MIS-409), within [MIS-408](https://linear.app/mission-control-v2/issue/MIS-408). Staging implementation and in-scope correction are authorized. Production promotion, production data writes, provider sends and schema migration are not authorized.

Reference classification is **inspiration mode**. The deployed compact staging workspace and the owner-supplied September 12 screenshots establish the accepted two-rail structure and density direction; this brief names the intentional sizing and workflow changes. Superseded v3 Record artwork is not a faithful target.

## Dispatch contract

- **Objective:** implement the approved AIT USA compact contact-workspace continuation without changing established production behavior outside the named scope.
- **Owner:** one Senior Builder writer using `openai/gpt-5.6-terra` with high reasoning; record actual routing and any fallback in closeout.
- **Repository:** `/root/.openclaw/giuseppe-workspace/ait-crm`.
- **Worktree:** use a fresh verified issue worktree based on `origin/staging`; do not implement in the retained documentation worktree if it is stale or dirty.
- **Source branch:** `origin/staging` at the exact verified start SHA. Target branch is a fresh MIS-409 implementation branch. After candidate acceptance and successful validation, delivery proceeds only through the mapped staging lane.
- **Allowed actions:**
  - inspect the repository and existing behavior;
  - change and test the in-scope application and test files;
  - create a candidate commit;
  - deliver it through staging only after the Director accepts the candidate and local validation passes.
  No production data write, production promotion, external provider send or schema mutation is authorized without explicit approval.
- **Access:** protected staging QA must follow `runtime/docs/ait-crm-protected-staging-access.md` and use stored credential/bypass references without exposing values. The staging database fingerprint must be verified before any authorized staging fixture write.
- **Validation:** `npm run validate`, focused inquiry/identity/RBAC contract tests, a render-path test suite, independent review, exact CI/deployment verification and authenticated staging browser QA at the named viewports.
- **Delivery:** return the candidate commit, actual agent/model/reasoning/fallback, changed-file summary, test results, independent-review result, exact staging deployment/CI identity, browser evidence, residual risks and explicit confirmation that production was untouched.
- **Acceptance:** every check in this brief passes, no preserved workflow regresses, and the exact deployed staging commit is proven before MIS-409 can be considered ready for owner production approval.
- **Canonical label:** use the database-backed business-unit label already provided by the application; do not hard-code a live business-unit name into shared UI logic.

## User outcome

An AIT USA employee should identify the person, understand the current or latest inquiry, and perform the next operational job without navigating through a large Record page or managing database objects. Returning students keep one durable Contact, distinct inquiry cycles, and actual course/enrollment history without forcing extra steps into the common single-inquiry flow.

## Chosen interaction model

At desktop 100% browser zoom, retain two left-side areas and a wide operational workspace:

1. **Global app navigation:** keep the 64px collapsed icon rail. Pointer entry, keyboard focus or the explicit toggle opens the approximately 232px labeled menu as an overlay without shifting content. Selecting a destination collapses it. Scope, theme, account and mobile controls remain reachable without hover.
2. **Contact preview:** retain the persistent AIT USA secondary rail at approximately 292–304px. Keep identity, usable channels/restrictions, current or latest inquiry, coordinator, program and next work visible across tabs. When more than one inquiry exists, add a compact selector; do not add permanent controls for the single-inquiry case.
3. **Main workspace:** consume the available width instead of leaving a large unused right gutter. Use **Activity** by default, then **Inquiries (n)**, **Conversations (n)**, **Enrollments (n)**, **Receipts (n)** and conditional **Work Orders (n)**. Tabs render their records and actions directly.

Increase the current compact scale without returning to the oversized Record composition:

- body and operational metadata generally 14–15px; muted labels no smaller than 13px where they carry meaning;
- principal contact/workspace headings 22–24px;
- tab labels approximately 15px;
- common desktop controls approximately 36–40px high;
- preserve compact rows/cards, restrained dividers and the current information density;
- no CSS `zoom`, transforms, fixed screenshot-scale hacks or document-wide overflow.

At 1440px the main workspace should use the remaining content width. At wider screens it may grow to a bounded readable maximum rather than centering a narrow 1280px island with wasted space. At narrower widths, stack/disclose the preview without hiding identity or creating nested page scrollbars.

## Inquiry ownership and history

The durable model remains:

- **Contact:** the person across time.
- **Inquiry/Opportunity:** one admissions or sales-intent cycle.
- **Enrollment:** one actual course or level record.

No schema redesign is required. The `leads` collection already supports multiple inquiries for one Contact, and course records already belong to the Contact with an optional inquiry link.

### Inquiries workspace

The new tab is a read-first list/detail workspace, not a second pipeline:

- list every exact inquiry ID available to the role with program, lifecycle status, owner, opened date, source and last activity;
- default to the active inquiry, otherwise the latest closed inquiry;
- selecting a row changes the detail without changing the persistent Contact identity;
- show Overview, Placement and Source/History as compact sections in one selected-inquiry detail; do not add nested sub-tabs in this pass;
- provide permission-gated Edit inquiry and the existing exact status/owner actions against the selected inquiry ID;
- show multiple-active conflicts explicitly and block ambiguous inquiry writes; never synthesize inquiry records from Activity events;
- Activity continues to show inquiry and placement events chronologically.

**Allowed payload:** exact role- and business-unit-scoped Contact identity fields already visible on this page; permitted inquiry IDs, program, status, owner, opened date, editable/source attribution, last activity; and the privacy-safe placement summary named below.

**Forbidden payload:** other-business-unit records, unpermitted inquiries, raw placement answers, reviewer rationale, review tokens, hidden academic evidence, internal authorization metadata and fields not already approved for the current role. Add a serialized-response payload-boundary contract test proving these fields are absent.

RBAC fixtures must include a regular coordinator account with restricted records and a senior coordinator or administrator account with privileged records. Null or unassigned owner behavior: permitted records remain visible with an explicit Unassigned state; no owner is inferred and no organization-wide metadata is returned.

### Placement

Placement belongs inside its exact inquiry. Show only privacy-safe CRM evidence: review/test state, recommended or final level when available, last update and the authorized **Open placement review** action. AIT USA remains authoritative for academic evidence and review audit. CRM must not copy raw answers, reviewer rationale, tokens or infer a result date. Ambiguous contact/inquiry linkage creates or retains review work instead of guessing. Do not add a top-level Placement tab.

### When an inquiry exists

Create a new inquiry only for demonstrated new intent:

- a new form submission;
- a completed placement/advisor-handoff flow;
- a response to retargeting;
- a materially new course/program request;
- a walk-in, phone call or referral that staff confirms as an inquiry.

Do not create a new inquiry for normal English-level progression, an ordinary continuation/resumption, a retargeting send without engagement, or a profile correction. Level progression remains multiple Enrollment records under the Contact and may retain the originating inquiry relationship. Reopening is not a primary action; it remains a permissioned correction to the exact closed inquiry with the existing reason and conflict guards.

## Manual entry semantics

AIT USA employees create an inquiry; the system creates or reuses the underlying Contact.

- Pipeline entry label: **Add inquiry**.
- Contacts-directory entry label: **Add prospective student**.
- Both open one combined Identity + Inquiry form and submit once.
- Preserve the current transactional Contact + initial Opportunity creation path.
- Before inserting a new Contact, safely detect exact existing identity. An exact permitted match offers/uses **Add inquiry to existing contact**. Ambiguous matches stop for review. Do not auto-merge.
- Do not expose ordinary **Create contact** or **Add contact only** actions in the AIT USA employee flow. Contact-only records remain an import/migration/administrative concern and may remain valid for other business units.

## Preserved workflows and boundaries

- Preserve every existing follow-up/outreach action, exact task/deep-link identity, due date/owner context and optional next follow-up behavior. Presentation may become a compact next-action strip; behavior and server policy remain unchanged.
- Preserve separate Contact and Inquiry edit scopes, independent contact/inquiry source saves, all profile fields, phone history and wrong-number/DNC restrictions, provenance, persistent details, chronological notes and Activity filters.
- Preserve direct Enrollment lifecycle actions, receipt creation/download, conditional Work Orders, archive versus request-approval policy, loading/error/empty states and return continuity.
- AIT Signs is **regression-only**. Shared navigation, contact-page and global-style changes must not redesign or relabel its People/Contacts, Work Orders, estimates, invoices, payments or Financials workflows.
- No production promotion, provider send, permission expansion, data backfill, automatic merge, schema migration or new inquiry per course level.

## Delivery slices

1. **Read/UI slice:** widen the usable workspace, increase the compact scale, add the exact role-scoped inquiries read projection, selector and list/detail surface, and surface existing placement-review links. Existing mutation behavior remains unchanged in this slice.
2. **Manual-entry safety slice:** rename AIT USA entry points and add exact-identity reuse/review behavior around the existing transactional create path. Keep route-owned authorization, business-unit scope, lifecycle rules and user-facing conflicts; reuse focused identity mechanics rather than hiding policy in a generic service.
3. **Acceptance slice:** automated validation, independent review, staging deployment and authenticated browser QA. Repair in-scope failures on the same candidate; production remains a separate approval gate.

One authoritative writer owns the implementation. Avoid parallel edits to the shared contact page, Contacts directory and Pipeline entry points.

## Acceptance checks

- Primary CSS viewport: 1440×1000 at 100% browser zoom. Regression: 1280×900, 1024×768, 768×900 and 390px overflow/navigation smoke.
- Confirm the workspace is visibly 10–15% larger than `28e02a9` while retaining compact density and using the available right-side width.
- Preview persists across every applicable tab; selector appears only with multiple inquiries; single/no/closed/conflict/long-content states are truthful.
- Inquiries count/list/detail use exact permitted records and stable IDs. Active/latest selection, role restrictions, stale selection and multiple-active conflict behavior are covered.
- Placement evidence and employee-review links appear only for exact authorized associations. No raw or forbidden academic data reaches the CRM response.
- `Add inquiry`/`Add prospective student` remains one save. New identity creates Contact + Opportunity transactionally; exact existing identity creates only the new inquiry after confirmation; ambiguous identity creates neither and stops for review.
- Verify normal English progression does not create another inquiry. Verify engaged retargeting/new program intent can create one, while a send alone cannot.
- Preserve Activity notes/filters, Conversations, Enrollment/history actions, Receipts, conditional Work Orders, task actions, archive/request approval, deep links and source isolation.
- Run `npm run validate`, focused inquiry/identity/RBAC tests and render-path tests. Then push only to staging, verify exact GitHub CI and Vercel Ready deployment, and perform authenticated live QA. Keep real regular-role and persisted-save results distinct from fixture evidence.
- Run AIT Signs desktop/compact regression coverage because shared modules changed; no Signs redesign is accepted by this issue.

## Stop conditions

**Stop conditions:** stop rather than infer when identity matching is ambiguous, an inquiry cannot be scoped to the current Contact/business unit, placement linkage is not exact, the brief would require a schema migration, or a change would alter AIT Signs semantics. No test data may be written to production.

## Evidence and delivery report

Closeout must record the actual writer agent ID, model, reasoning level and fallback status; candidate commit; focused/full validation; independent reviewer; matching-viewport screenshots; exact staging deployment/CI; authenticated role coverage; residual differences; and explicit confirmation that production was untouched.
