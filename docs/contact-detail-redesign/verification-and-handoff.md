# AIT CRM Contact workspace — final design and staging handoff

> Repository edition: published documentation only. Application implementation remains paused. This public edition preserves the specification, replaces machine-local source links with repository links, and references authenticated captures through the private evidence index. Historical audit statements below describe the audit pass, not this documentation publication.

September 7, 2026. Selected direction: Round 3 Contact & linked records as the landing page, with Section workspace editing inside a scoped editor. This supersedes the unverified field-ownership assumptions in Round 3. It is one design, shown in record and editing states, not another option set.

## Decision

Use this direction when implementation resumes. **Implementation is paused at the user's request.** A contact appears once, followed by its current AIT USA opportunity and actual enrollments. Activity and Conversations are separate destinations. A section index appears only while editing an opportunity. The normal record has neither a profile sidebar nor a second local section index.

The [functionality parity contract](functionality-parity.md) is the complete companion specification for the inspected detail-page capabilities: 50 mapped rows, full field ledgers, role rules and per-capability acceptance checks. There are no intentional capability removals. Mapping is complete for this inspected inventory; implemented/runtime parity is not yet verified. The [CSV tracker](functionality-parity.csv) starts with every implementation result unverified. Existing editors and related workflows must remain reachable in every slice until their replacements pass the relevant checks.

The schema supports this separation without requiring a new entity or migration for the initial release. It does **not** justify presenting every inquiry event as an independently editable inquiry record. The earlier invented second inquiry is removed from the initial concept.

- [Final record board — desktop and mobile](01-contact-workspace.png)
- [Companion scoped editor — desktop and mobile](02-focused-editor.png)
- [Prior audit context, carried-forward findings and archive information](README.md#prior-audit-context)

The boards use fictional names, dates and values. They are design artwork, not an implemented prototype or measured usability result. The record board governs the underlying page; the editor board governs the foreground editor only. Its dimmed backdrop is illustrative and must not introduce a second record panel. The desktop record must include the opportunity's source/date subline, as shown on mobile. Secondary fields and conditional operations omitted from the boards remain mandatory under the parity contract. Its explicit source-correction save scope also supersedes the editor artwork's shorthand “one record per editor.” These textual rules resolve image-generation inconsistencies.

## Five jobs this design supports

1. **Resume the right relationship.** Return from a search or queue and understand which person, division and opportunity are open.
2. **Find a usable way to contact them.** Locate channels and restrictions without reconciling repeated summaries.
3. **Understand the current situation.** Distinguish inquiry preferences, placement evidence, sales status and actual course enrollment.
4. **Do the next piece of work.** Complete a specific task, record an outreach attempt or schedule the next commitment with explicit ownership.
5. **Correct or hand off the record confidently.** Edit the right entity, preserve context and drafts, and understand permission or conflict restrictions.

Expected improvements in speed and confidence are expert design hypotheses. No timing study or operator validation has yet been conducted.

## Verification completed in this pass

| Evidence | Confirmed result | Limit |
|---|---|---|
| Git remote refs, fresh `git ls-remote` | master `71821f03179aeb68cf787502998ce491effe03d0`; staging `c9df0a06a797a477b3daeeada073bb5f14454137` | Matching source trees do not prove data parity. |
| Vercel connector queried using staging alias | READY deployment `dpl_CGLxsyyHHuEVuHJZiiFsfhH6U76g`, staging commit `c9df0a0…`; alias points to `ait-fpfgvd8n4-alvaros-projects-efb8ae58.vercel.app` | Deployment metadata does not identify the exact Neon branch binding. |
| Local source comparison | HEAD `71821f0…`; `git diff c9df0a0… HEAD --stat -- src` empty | Repository source evidence, not deployed database schema inspection. |
| Authenticated staging, QA contact, Administrator | Courses has no enrollments/history; editor mixes identity, status and owner; Source & routing distinguishes student location from learning location | Viewed and dismissed only; no save, enrollment creation or send. |
| Responsive browser, 1440×1000 and 390×844 | Repeated context summary occupies most of mobile's first screen; Courses content starts below it; existing fixed mobile navigation persists | This verifies the current app, not the new artwork's responsive behavior. |
| Authenticated staging, Senior Coordinator | Can open the QA contact, see Conversations empty state, and open status/assignment editor; assignment options include self and regular coordinators | Does not prove a successful write or a populated message thread. |
| Nine focused existing unit suites | 67 passing test cases, process exited 0 | Fixture-only tests; no Postgres connection. |
| Opportunity route and bootstrap fixture suites | 25 passed, 0 failed/skipped | Mocked database dependencies; no live mutations. |
| Subsequent parity pass: authenticated Senior Coordinator, 1440×1000 | Archive dialog/reason, complete secondary profile fields, editable Source and receipt eligibility/entry point inspected | Opened and dismissed only; private evidence IDs 25–28. No action submitted. |
| Subsequent parity pass: six additional existing fixture suites | 19 passed, 0 failed/skipped: phone history, receipt document, financial fields/linkage, archive approvals, note composer | Pure/mock baseline checks; earlier 92 tests were not rerun during this pass. None verifies the unimplemented design. |

Staging origin tested: `https://ait-crm-git-staging-alvaros-projects-efb8ae58.vercel.app` (QA contact identifier withheld from this public edition). Production was not accessed in this pass. Screenshots 20–24 are unchanged browser captures retained in the private evidence archive, separate from the published fictional concepts:

- [20: Admin courses, desktop](README.md#private-evidence-archive)
- [21: Admin Source & routing editor](README.md#private-evidence-archive)
- [22: Mobile courses and navigation](README.md#private-evidence-archive)
- [23: Senior Conversations, no composer](README.md#private-evidence-archive)
- [24: Senior status and assignment editor](README.md#private-evidence-archive)
- [25–28: Additional capability evidence and source mapping](functionality-parity.md)

Remaining coverage gaps: regular-coordinator and read-only authenticated sessions; populated AIT Signs contact detail; multiple-opportunity/conflict and populated enrollment scenarios in the browser; populated communication history; successful save and task completion; keyboard/zoom testing of the proposed implementation. Direct database inspection and exact Neon target verification were not performed. These are release checks, not reasons to invent data or delay the read-only layout slice.

## Confirmed model and implementation constraints

| Information | Current authority | Design and write contract |
|---|---|---|
| Name, email, primary phone | `contacts`; historical phones have their own table and GET endpoint | Contact section and Edit contact. Preserve primary-phone editing plus read-only historical numbers/warnings. There is no existing phone-history add/remove/promote UI to invent. Never infer phone-record identity from array position. |
| Division | `contacts.primaryBusinessUnitId` and opportunity business unit | Preserve record-division context. Do not put division transfer in routine field editing. |
| Intended learning location for AIT USA | Currently `contacts.address`; existing school-location helpers | Contact & preferences, clearly named. Preserve the mapping for this release. Never relabel this value as residential address. AIT Signs keeps its address semantics. |
| Student location | `leads.locationPreference` | Inquiry details inside the identified opportunity; free text. Do not substitute learning location or move storage during a layout refactor. |
| Sales/lifecycle status and coordinator ownership | `leads.status/currentStage` and `leads.assignedUserId` | Label Opportunity status / Opportunity owner. No invented contact lifecycle or contact owner. Task owner remains a different field. |
| Program, preferred day/schedule, qualification, profile notes | Lead profile columns mapped by `lead-profile.js` | Edit the selected opportunity ID. Existing free-text values must survive; do not introduce closed enumerations from the artwork. |
| Placement/result evidence | Derived enrollment signals and source events | Show provenance where available. A placement result is read-only here; it is not the editable education-level field. Do not invent a result date from contact creation time. |
| Acquisition source | Lead source plus contact source fallback; PATCH `source` also updates contact source label | Preserve existing editing through a named Correct acquisition source operation in Source. Explicitly explain that both the selected opportunity's source and contact fallback label change. Original submission provenance remains read-only; sourceDetail remains a separate profile field. Routine opportunity saves must not resend unchanged source. |
| Enrollment | `contact_course_records`, optionally `leadId` and `classSectionId` | Actual record IDs and actual statuses. Contact status Enrolled does not manufacture an enrollment, and current-course text is not proof of a class enrollment. |
| Next task | `tasks`, with task/contact/lead/business-unit IDs and owner | Fetch permitted tasks for this contact/division. History event counts are never an open-task count. |

AIT USA opportunity selection is significant: the bootstrap selects an active opportunity ahead of newer closed history and flags multiple active records. If there is no active opportunity, it can return the most recent closed opportunity. Therefore `hasLeadStatus` alone does not mean **current**. Use active count and lifecycle policy. With multiple active opportunities, do not label a chosen newest row as the current truth.

`POST /api/contacts/:id/opportunities` exists, but no GET collection handler exists there. The initial layout can use the selected bootstrap opportunity. A complete closed-opportunity browser requires a separately reviewed, authorized read projection of actual lead rows. Do not populate it from the timeline's Inquiry count.

Course reads and writes currently authorize/link via `latestLeadForContact`, which chooses newest-created lead; the contact bootstrap uses active-opportunity resolution. This inconsistency must be addressed before extending enrollment editing for multi-opportunity scenarios. The bootstrap course summary also omits course IDs; the courses endpoint returns IDs. Use endpoint records for editing, never infer identity from course name or list position.

## Prioritized friction log additions

These additions extend F1–F13 in the existing audit. Severity expresses operational risk and frequency assumptions, not measured loss.

| Priority / finding | Observed evidence | Inference | Operational consequence and response |
|---|---|---|---|
| P1 — F14: The page blurs contact and opportunity ownership | Source stores owner/status on leads, while the visible General profile form groups them with identity. Current render flattens one selected lead into the contact payload. | Users may treat status and assignment as person-wide facts and misunderstand closed versus current history. | An operator can change the wrong business context or hesitate before handoff. Give the opportunity its own named section/editor, bind writes to its ID, and show conflict/no-active states. |
| P1 — F16: Enrollment context does not use the same opportunity selection | `courses/route.js` calls newest-lead helper; bootstrap selects active before newer closed lead. Course summary payload has no ID, while full course payload does. | With an older active lead and newer closed lead, access or newly linked enrollment context can differ between surfaces. This was not reproduced on live data. | Incorrect linkage or inconsistent access is possible. Gate enrollment editing changes on shared selection policy, explicit record IDs and fixtures for this case. |
| P2 — F15: Field scope is hidden by legacy storage | Browser labels distinguish Student location / Intended learning location. Source maps them to lead locationPreference / contact address. `PATCH source` also updates contact sourceLabel. | A visual regrouping can accidentally introduce cross-entity edits even when the screen appears cleaner. | Routing or attribution could be overwritten. Preserve explicit mappings and the existing source-correction capability with an explained coupled save scope. Original event provenance stays read-only; defer storage migrations. |
| P1 — F2/F6, reinforced: Next work is buried and task counts are historical | Current mobile capture puts a large context summary before courses; prior timeline captures place actions after history. Current snapshot says Tasks 2 based on timeline events. | Users can miss open work or interpret history as a current workload. | Put exact task context before historical content; separate Complete follow-up, Record outreach and Schedule follow-up. |
| P1 — F13, reinforced: Repeated summaries dominate the page | Current staging repeats status, source, owner and contactability in header context and sidebar. Courses empty state offers several enrollment entry points. | Users spend effort reconciling repeated information and deciding which control is authoritative. | Remove duplicate summaries and collapse equivalent empty-state actions to one primary entry. |

F1 directory return continuity, F8 messaging capability clarity and F10 dirty-dismiss protection remain acceptance requirements; the redesign does not supersede those findings.

The parity review also caught omissions in the proposed specification: read-only source would have removed editing, and the boards did not enumerate secondary qualification fields, archive/request approval, the Enrolled-to-course prompt, full receipts, or conditional related work. These are corrected in the parity contract. They are design omissions caught before implementation, not observed deployed regressions.

## Final interaction model

**Normal record.** Keep the existing global navigation. Header contains Back to Contacts, name, division, Edit contact and a restrained overflow. No duplicated channel/owner/status summary. A flat task band follows. One local tab row contains Record, Activity and Conversations. Default to Record for a normal contact visit; preserve explicit incoming task/conversation context.

Record contains Contact & preferences, Current opportunity (or accurately labeled closed/no-active/conflict state), Enrollments, then Receipts access. Preserve conditional Related work when the USA contact has linked work orders or a currently authorized work-order entry point. Desktop uses open property rows and whitespace; mobile uses the same order, with optional opportunity details disclosed below always-visible status and owner. Core contact data is not hidden by default. Historical phone warnings, contactability, timestamps, provenance and meaningful existing highlights retain a clear home under the parity contract. Disclosure expands reading content; Edit opens a scoped editor. They are different actions with different labels. Header More contains Archive contact or Request archive approval according to existing capability policy.

**Task band.** Show the next permitted eligible follow-up with title, due date/time zone, task owner and enough relationship context to distinguish it. Complete follow-up opens the existing outcome workflow with the exact task ID. Record outreach opens the no-task path; it must not complete a task. Schedule follow-up opens the scheduling workflow with explicit contact/division/opportunity and owner selection. No checkbox beside a duplicate completion button. If several tasks exist, show the chosen task and a count-based View tasks entry using actual permitted records. If none exist, say No open follow-up and offer Schedule follow-up / Record outreach. A failed task request is not an empty state.

**Activity.** One chronological feed, one filter family. Human outreach and notes remain distinct from ingestion/system events. Source details disclose within their event. A task event may link to the exact task but does not claim the task remains open. Adding a note is explicit and append-only. Do not copy the full activity feed into Record.

**Conversations.** Preserve readable history wherever permitted. Keep the view available to the senior role. For users without send capability, explain that history is available and sending requires an administrator, without a fake locked tab. For admins, preserve the existing Messenger/WhatsApp composer, templates/custom text, provider/consent/channel readiness checks and blocked reasons. Metadata can move into Message details but remains accessible, including delivery errors and identifiers. A Record outreach button records an action; its six logging channels do not imply six provider Send integrations.

**Editors.** Edit contact is a small contact-only dialog with name, email, phone and the existing contact-wide learning preference; no status/assignment tab is needed. Edit opportunity uses a desktop dialog with a local section index: Inquiry details, Ownership & status, Source. Mobile replaces the index with a section selector in a full-screen dialog. Retain all nine lead-profile fields, including Test, Level, School, Source Detail and Details. The Source section shows provenance, edits sourceDetail, and offers Correct acquisition source as an explicit coupled save operation; protect unsaved opportunity drafts when switching into that save state. Course editing remains separate and keyed by course ID. Archive/request approval is a separate confirmation from Header More. No stacked dialogs or all-record mega-form. Show one clearly explained save scope and explicit Save/Cancel controls. Section changes retain the draft; dismissing a dirty draft requires keep-editing/discard handling.

**Related records.** Manage enrollments and View receipts reuse existing contact-scoped resource surfaces; move them under the record's related sections rather than maintaining competing top-level tabs. Preserve enrollment add/history/edit/complete/end modes, full fields and multiple active courses; preserve receipt generation, eligibility, full payment form and PDF downloads. Use a single Back to record path and preserve scroll/tab state. This is route state on the existing contact page, not a new parallel CRM navigation system. Existing AIT Signs clients retain their current layout, linked people, work orders, estimates and financial operations in the initial USA rollout. New historical opportunity collection browsing is deferred until a true authorized collection is available.

## Implementation-ready acceptance criteria

1. **One authoritative fact.** In Record read mode, email, phone, intended learning location, opportunity owner and opportunity status each have one primary display. The header contains no duplicate summary. Repeating a name as task owner is allowed only with that distinct label and relationship purpose.
2. **Correct current state.** A fixture with an older active and newer closed opportunity displays the active one. A closed-only fixture displays No active opportunity plus Last opportunity (closed), never Current opportunity. Zero leads displays No opportunity and an authorized Start opportunity action. Multiple active rows display a visible conflict and prevent opportunity writes; permitted identity editing remains available.
3. **Scoped contact save.** Edit contact sends only changed contact fields plus ID/context needed for authorization. It never sends status, assignedTo, source, an unchanged full leadProfile, or legacy course fields. Name/email/phone errors are visible next to the fields. Preserve existing clear/normalization semantics.
4. **Scoped opportunity save.** Opening the editor captures the exact opportunity ID. Send changed allowed lead-profile/status/owner fields with that ID. A 409 or changed active opportunity keeps the draft and explains refresh/review; never retarget it to another lead automatically. Reuse locked mutation services and server authorization.
5. **Dependent fields.** Ownership changes use eligible assignees and existing role rules. Closed-status transitions and reopening retain required reasons and lifecycle validation. Changing status never silently creates an enrollment. Preserve the existing Add Enrollment prompt after a successful change to Enrolled when no active course exists. Canceling that subsequent prompt keeps the saved status; a failed status save opens no prompt.
6. **Locations and source.** AIT USA learning preference reads/writes contact address via existing helpers. Student location reads/writes lead locationPreference as free text. Routine opportunity-only saves do not send contact-wide `source`. A separate named source-correction operation preserves the existing coupled write with explicit scope and exact authorized opportunity context. Placement evidence and original submission provenance remain read-only.
7. **Exact next work.** Fetch tasks with contact and division scope; derive counts from returned authorized records. Display task ID-backed context. Open Complete follow-up with that exact ID; rejected/missing/mismatched task cannot fall back to completing another task. Multiple-task fixtures prove the intended task alone is completed in local mocks or separately authorized staging write QA.
8. **Separate outreach and scheduling.** Record outreach explicitly completes no task. Scheduling preserves contact/division/opportunity; unassigned records do not default to an arbitrary first employee. A regular coordinator cannot assign work to another user through an altered payload.
9. **No misleading empty states.** Each task, opportunity, course and conversation request has loading, empty, denied, failed/retry and ready states. Failed requests do not display zero counts or No active enrollment. Counts describe records, not mixed events.
10. **Course identity and context.** Enrollment edits load the full course endpoint response and use its ID. New/edited enrollment flows validate the authorized opportunity/class-section context. Fixtures cover older-active/newer-closed, conflict, no lead, multiple courses and duplicate active section. Do not use name matching as identity.
11. **Legacy course information.** If only legacy course text exists, show it explicitly as legacy information; do not portray it as a real active enrollment. Preserve current/history/planned distinctions and class section/location/teacher fields. Existing financial operations remain in their own permission-controlled workflows.
12. **Draft continuity.** Switching editor sections keeps all fields and validation. Escape, X, Back, Cancel, tab navigation or a changed contact cannot silently discard a dirty draft. Keep editing retains values; explicit discard closes. A failed network save retains inputs and exposes retry. Successful save restores focus to its trigger and refreshes affected projections.
13. **URL and return continuity.** Own view/filter/task/editor context in valid route state where useful. Preserve `action=log-follow-up` and exact task links. Returning to Contacts restores the originating query, filters, page and record focus. Unsupported or stale context fails visibly and safely.
14. **Role behavior.** Admin and senior see assignment controls when authorized; regular coordinator ownership is read-only and API denial is retained. Read-only users see no write controls. Conversations visibility and send capability are independent. Test direct requests as well as hidden/disabled controls.
15. **Mobile.** At 390×844, identity and the primary next-action entry appear before history. Contact channels and opportunity status/owner remain readable; long values wrap without page-wide horizontal scroll. Preserve current bottom navigation and division clearance in read mode. Full-screen editor hides inert global chrome and keeps Save/Cancel reachable with the software keyboard open.
16. **Accessibility and long content.** Test desktop 1440×1000, mobile 390×844, 320px width and 200% zoom. Keyboard-only users can traverse tabs, disclosures, editor sections and dialogs; focus is visible, trapped correctly during a dialog and restored on close. Use real labels, selected/expanded semantics, associated errors and announced save outcomes. Aim for 44px touch targets and verify rendered dimensions.
17. **Activity clarity.** One filter family and one feed. Show system origin for ingestion events rather than presenting them as unknown human authors. No event totals masquerade as open-task or inquiry collection totals. Long history loading cannot unmount the active composer or remove focus.
18. **Division safety.** Initial layout applies to the AIT USA contact detail. Shared components must preserve AIT Signs clients, people, work orders, estimates and financial access. Do not apply AIT USA opportunity selection or student labels to Signs. A populated Signs fixture is required before a shared-shell release.
19. **No lost functionality.** Every applicable P01–P49 row and all field-ledger inputs in the parity contract have a reachable implementation and recorded verification. P50 continuity improvements are separately verified. No existing operation is removed merely because it is absent from an image or scheduled for a later slice. Reuse the existing workflow until its replacement passes.
20. **Source correction.** Correct acquisition source preserves existing options/custom current value, permission and coupled contact/lead write. Scope is explained before save. Original event provenance is unchanged; denied/conflicted saves retain the draft. The ordinary contact/opportunity editors never silently submit source as an incidental unchanged field.
21. **Archive outcomes.** Direct archive and request approval have distinct labels, confirmation and success states. A request leaves the contact active and preserves approval-task reuse; direct archive preserves history and returns appropriately. Existing reason/default behavior and server permission checks remain intact.
22. **Complete qualification/outreach fields.** All 18 profile inputs remain supported. The nine outreach outcomes, six logging channels, attempted method, note, optional next task/owner, seven optional profile fields and normalized status/contactability effects remain intact. Ctrl/Cmd+Enter note submission and failure draft retention are preserved.
23. **Receipts.** Eligible users can generate a receipt using all five payment inputs and bound contact/division context. Keep the existing Enrolled status/stage eligibility, not a new course-existence requirement. Save precedes PDF generation. Retry after a download failure targets the saved financial record without another payment; existing receipts remain downloadable.
24. **Enrollment lifecycle.** Preserve add enrollment, add history, edit, complete and end actions; all nine course fields; six statuses; saved-section and manual modes; adaptive dates/outcomes; and multiple distinct active courses. Keep duplicate-active validation and full record IDs. The course-context mismatch in F16 remains a gate on changed enrollment linkage behavior.
25. **Conditional and shared resources.** USA related work remains visible when applicable. Signs retains linked-person CRUD/primary designation, work-order entry/opening, estimates, invoice generation, payment recording, balance previews and all PDF downloads. The USA three-tab board cannot justify removing these capabilities.

## Small delivery slices, ordered by user impact

| Order | Slice and visible outcome | Scope / dependencies | Validation and exit |
|---|---|---|---|
| 1 | **One readable record.** Remove repeated review/sidebar summaries; introduce Record default and Contact/Opportunity/Enrollment sections; make existing outreach/scheduling entries reachable near the top on mobile. | AIT USA layout and view-model projection only, preserve current resource components and services. No new inquiry table, migration or history browser. Show real empty/conflict labels. Keep existing mutation flows, including source editing and archive, reachable until their replacements are verified. Preserve conditional related work and the Signs branch. | Desktop/mobile read-only QA plus no-lead, closed-only, conflict, legacy course and long-field fixtures. AC1,2,6,9,11,15,18,19,25. |
| 2 | **Trustworthy next action.** Replace event-derived task summary with current permitted tasks and explicit Complete/Record/Schedule intents. | Existing tasks GET filtering and follow-up dialog; exact IDs and owner context. Can develop independently of editor redesign, after slice 1 shell contracts settle. | Exact-task, multiple-task, stale, unassigned and denied fixtures; task route compatibility. AC7–9,13. |
| 3 | **Focused, safe corrections.** Separate contact and opportunity editors with section navigation only inside the latter; preserve drafts. | Existing PATCH and locked opportunity mutation services; changed-field payload builders; full profile ledger; explicit coupled source correction; archive/request approval in More. Preserve status shortcuts and Enrolled-to-course prompt. No opportunity history editing. | Contact-only patch, full field round trips, source scope, archive/request outcomes, dependency reasons, conflict/409, role policy, keyboard and dirty-dismiss fixtures. AC3–6,12,14–16,19–22. |
| 4 | **Related records that stay in context.** Integrate enrollment/receipt resource views with one return path and full record IDs. | Align course access/linkage selection with the existing AIT USA opportunity policy before expanding enrollment mutations. Reuse every existing course/class-section and financial workflow; prior slices retain their working forms. Preserve conditional USA work and all Signs operations. | Older-active/newer-closed, multiple-course, duplicate-section, receipt eligibility, save/download and shared Signs fixtures; authorized read QA. Live writes require disposable staging QA authorization and database target confirmation. AC10,11,13,18,19,23–25. |
| 5 | **Understand the relationship history.** Consolidate Activity filters and clarify system events and conversation capabilities. | Preserve all note/outreach actions, history metadata, existing admin Messenger/WhatsApp templates/custom composer and delivery states throughout the rollout. A new closed-opportunity collection is a separate optional extension requiring an authorized GET projection; no synthetic inquiries from timeline counts. | Populated long-history, system events, authorized/denied conversation fixtures, template/custom behavior, count accuracy and return continuity. AC9,13,14,17,19,22. |

Before any slice that ships new write behavior: confirm the exact staging database target and use explicit disposable QA records. First implement in an isolated issue-bound worktree from a freshly verified base; one writer per source area. No Linear issue has yet been assigned for these slices. Create no new UI framework; retain CSS Modules, shared tokens, existing domain services and reusable dialogs. Do not split this into parallel writers editing the same contact page.

## Frontend handoff

Keep the existing contact route as coordinator, but extract small components around actual responsibilities: identity header, next-task band, contact fields, opportunity section/editor, related records and activity/conversation views. Prefer one contact workspace view model carrying contact ID, division, selected opportunity ID/resolution, actual courses/tasks, permissions and per-resource request state. Do not duplicate independent owner/status drafts across header, sidebar and dialog.

Use existing `contact-detail-view-model.js` and lifecycle/assignment policies as the basis. Extend the detail loader for scoped resource reads instead of expanding the entire global bootstrap or downloading all organization leads to render one page. Use the full courses endpoint for editable records. Add an authorized historical opportunity projection only when slice 5 needs it. Reuse error mapping and existing locked server mutation paths; UI permission affordances are not authorization.

Primary source references (all inspected locally, matching staging `src/` tree in this pass):

- [Contacts and leads schema](<../../src/db/schema.js#L130>) and [course records](<../../src/db/schema.js#L336>)
- [Opportunity resolution / active-first selection](<../../src/lib/crm/ait-usa-opportunities.js#L70>) and [locked mutation protection](<../../src/lib/crm/ait-usa-opportunities.js#L219>)
- [Flattened bootstrap selection](<../../src/lib/bootstrap-data.js#L258>)
- [Contact PATCH and source coupling](<../../src/app/api/contacts/route.js#L353>)
- [Existing profile payload builder](<../../src/lib/crm/contact-profile-patch.js#L26>)
- [Location controls and mappings](<../../src/app/contacts/[id]/page.js#L3128>)
- [Lead-profile fields](<../../src/lib/crm/lead-profile.js#L3>)
- [Course context loader and endpoint](<../../src/app/api/contacts/[id]/courses/route.js#L25>) and [newest-lead helper](<../../src/lib/crm/write-helpers.js#L7>)
- [Full course payload versus summary](<../../src/lib/crm/course-records.js#L99>)
- [Task GET filters](<../../src/app/api/tasks/route.js#L365>) and [exact follow-up selection](<../../src/lib/tasks/follow-up-selection.js#L43>)
- [Assignment roles](<../../src/lib/crm/ait-usa-assignment-policy.js#L8>) and [manual send permission](<../../src/app/api/contacts/[id]/conversations/route.js#L91>)

## Validation commands and work boundary

Existing unit tests run in this pass:

```text
node --test --test-reporter=dot src/lib/crm/ait-usa-opportunities.test.js src/lib/crm/contact-profile-patch.test.js src/lib/crm/course-records.test.js src/lib/crm/lead-profile.test.js src/lib/contact-detail-view-model.test.js src/lib/ait-usa-enrollment-signals.test.js src/lib/tasks/follow-up-selection.test.js src/lib/crm/ait-usa-assignment-policy.test.js src/lib/crm/access.test.js
```

Result: 67 passing dots, exit 0. The route/bootstrap fixture command used PowerShell environment syntax:

```powershell
$env:TSX_TSCONFIG_PATH='jsconfig.json'
node --import tsx --import ./scripts/register-test-module-hooks.mjs --test --test-reporter=spec src/app/contacts/ait-usa-opportunity-route.test.js src/lib/bootstrap-data.ait-usa-opportunity.test.js
```

Result: 25 passed, zero failures/skips. Total 92 existing fixture tests passed in the earlier design-verification pass. The subsequent parity pass ran six additional baseline suites with 19 passed, zero failures/skips; its exact command and limits are in the parity contract. The earlier 92 were not rerun in that pass. No new tests or application code were written. Lint/build were unnecessary for this documentation/design change. Those checks and rendered interaction QA belong to each implementation slice.

Files changed: local audit/design artifacts only. Existing modified `AGENTS.md` and untracked `docs/ait-usa-crm-audit-implementation-handoff.md` remain untouched. No commit, worktree, push, PR, merge or deployment was created. Database target directly touched: none; staging application reads and authorized QA sign-in only. CRM record writes, outbound messages, role changes and customer-impacting actions: none.

The concept, 50-row parity mapping and field contracts are ready for implementation review. Implementation is paused at the user's request; no app work starts from this document alone. Staging deployment and write-based QA remain separate authorized steps. This document does not claim that the new experience is implemented, runtime-equivalent or accepted by operators.
