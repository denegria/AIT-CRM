# AIT CRM Contact workspace — final design and staging handoff

> Repository edition: published documentation only. Application implementation remains paused. This public edition preserves the specification, replaces machine-local source links with repository links, and references authenticated captures through the private evidence index. Historical audit statements below describe the audit pass, not this documentation publication.

Revised September 11, 2026 for [MIS-408](https://linear.app/mission-control-v2/issue/MIS-408/ait-crm-detailed-contact-workspace-redesign-preserved-tabs-direct). Keep the selected clean visual style and focused editors, but **retain every applicable production operational tab** with its records and actions rendered directly. This supersedes the September 7 three-tab consolidation, gateway-only resource navigation, coupled source-correction requirement, and mobile-led emphasis. It is a revision of the selected design, not a new option set. Alvaro approved the recommendations and unknown-source fix; this delivery updates documentation and boards only. Application implementation remains paused.

## September 11 refinement — one workspace, simpler language

This approved amendment governs AIT USA operator-facing copy. Keep the existing internal opportunity/lead entity, IDs, lifecycle, history and authorization; this is not a schema rename or removal of inquiry cycles. A contact is the person; an inquiry is one admissions/business cycle; an enrollment is an actual course record. Do not apply student/inquiry labels to AIT Signs indiscriminately.

- **Edit contact:** stays in the page header; name, email, phone, contact-wide learning preference and Contact source. It works without an inquiry.
- **Current inquiry → Edit:** a small action aligned with that section heading opens **Edit inquiry**. It contains program interest, qualifications, preferred days/schedule, student location, inquiry owner/status and Inquiry source. The selected internal opportunity ID is captured; no automatic retargeting.
- Inside Current inquiry, use concise **Status**, **Owner**, **Inquiry source** labels. **Change owner** and **Change status** retain direct access to the same editor/draft and existing reason/permission rules.
- Source correction remains available inside each relevant editor. Remove prominent **Correct source** links from Record; do not add another scope-switch menu. Keep original evidence read-only.
- **No active inquiry** is a quiet supported state, including legacy contacts. Keep independently authorized contact edits and enrollment/history/resources available. **Start inquiry** is secondary and only for actual new business, never mandatory profile setup or backfill. Closed-only history is **Last inquiry (closed)**; multiple-active conflicts remain explicit and block ambiguous inquiry writes.
- Coordinate terminology across AIT USA contact detail and Pipeline headings, card labels, actions and confirmations in the same release slice. Preserve route compatibility and internal identifiers; do not globally replace technical opportunity references or Signs vocabulary. This is a copy-consistency pass, not a full Pipeline redesign.
- First-time/returning status must come from verified actual study/enrollment history, **not inquiry count, lead creation dates or pipeline Enrolled status alone**. Planned/cancelled inquiries or course records are not proof of prior study. Incomplete legacy evidence stays **Unknown**, not automatically first-time. Do not add a new badge or migration merely for this refinement. If later displayed, define qualifying history and the reporting date explicitly and prove the rule with fixtures before release.

All existing field ledgers, separate source effects and 56 parity rows remain required. This amendment changes presentation and makes classification evidence explicit; it does not authorize application implementation or live data writes.

## Decision

Use this direction when implementation resumes. **Implementation is paused at the user's request.** A contact appears once in Record with its selected AIT USA opportunity. Activity, Conversations, Enrollments, Receipts/Financials, Work Orders and Signs People remain first-class destinations where applicable. A section index appears only while editing an opportunity. The normal record has neither a profile sidebar nor a second local section index.

The [functionality parity contract](functionality-parity.md) is the complete companion specification for the inspected detail-page capabilities: 56 tracked rows (50 original inventory/continuity rows plus six explicit improvement contracts), full field ledgers, role rules and per-capability acceptance checks. There are no intentional capability removals; source corrections deliberately improve on the old coupled-save behavior, as specified below. Mapping is complete for this inspected inventory; implemented/runtime parity is not yet verified. The [CSV tracker](functionality-parity.csv) starts with every implementation result unverified. Existing editors and related workflows must remain reachable in every slice until their replacements pass the relevant checks.

The schema supports this separation without requiring a new entity or migration for the initial release. It does **not** justify presenting every inquiry event as an independently editable inquiry record. The earlier invented second inquiry is removed from the initial concept.

- [Revised desktop Record board](01-contact-workspace-v3.png)
- [Revised scoped source-editor board](02-focused-editor-v3.png)
- [Populated Enrollments tab board](03-enrollments-workspace.png)
- [Board specifications, state coverage and visual acceptance](design-board-spec.md)
- [Prior audit context and private evidence archive](README.md#prior-audit-context)

The boards use fictional data and are illustrative design artwork, not implemented prototypes or measured usability results. The original September 7 images remain historical references only. The field ledgers, tab contract and scoped save rules govern any omitted/conditional state or image inconsistency. Do not implement only the controls visible in an image. Desktop is the priority; basic responsive usability stays, without a new phone-first exploration. Revised boards show one design in different states, not alternatives requiring a new selection round.

## Five jobs this design supports

1. **Resume the right relationship.** Return from a search or queue and understand which person, division and opportunity are open.
2. **Find a usable way to contact them.** Locate channels and restrictions without reconciling repeated summaries.
3. **Understand the current situation.** Distinguish inquiry preferences, placement evidence, sales status and actual course enrollment.
4. **Do the next piece of work.** Complete a specific task, record an outreach attempt or schedule the next commitment with explicit ownership.
5. **Correct or hand off the record confidently.** Edit the right entity, preserve context and drafts, and understand permission or conflict restrictions.

Expected improvements in speed and confidence are expert design hypotheses. No timing study or operator validation has yet been conducted.

## Historical verification — September 7 baseline

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
| Contact source | `contacts.sourceLabel`, independently present for legacy/no-opportunity contacts | Correct contact source changes only this contact label. Available to authorized users without creating an opportunity. Do not claim the stored label is immutable first-touch truth after historical coupled corrections. |
| Opportunity source | Selected lead `sourceName` / `sourceType`; old PATCH `source` couples contact and lead labels | Correct opportunity source changes only the exact authorized opportunity. Source Detail remains a separate profile field. Implement explicit server-side save scopes; changing labels over the old coupled payload is insufficient. Original submission/import events remain read-only. |
| Missing attribution | Current bootstrap can fall back to `seedData.SOURCES[index % length]` | Replace sample-source fallback for database-backed records with Unknown/Not recorded. Never present contact fallback as evidence of the opportunity's own origin; retain raw fields/evidence. No data backfill or invented acquisition history. |
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
| P2 — F15: Field scope is hidden by legacy storage | Browser labels distinguish Student location / Intended learning location. Source maps them to lead locationPreference / contact address. `PATCH source` also updates contact sourceLabel. | A visual regrouping can accidentally introduce cross-entity edits even when the screen appears cleaner. | Routing or attribution could be overwritten. Preserve explicit location mappings and source correction; the September 10 amendment replaces coupled source saves with independent contact/opportunity corrections. Original event provenance stays read-only; defer storage migrations. |
| P1 — F2/F6, reinforced: Next work is buried and task counts are historical | Current mobile capture puts a large context summary before courses; prior timeline captures place actions after history. Current snapshot says Tasks 2 based on timeline events. | Users can miss open work or interpret history as a current workload. | Put exact task context before historical content; separate Complete follow-up, Record outreach and Schedule follow-up. |
| P1 — F13, reinforced: Repeated summaries dominate the page | Current staging repeats status, source, owner and contactability in header context and sidebar. Courses empty state offers several enrollment entry points. | Users spend effort reconciling repeated information and deciding which control is authoritative. | Remove duplicate summaries and collapse equivalent empty-state actions to one primary entry. |

F1 directory return continuity, F8 messaging capability clarity and F10 dirty-dismiss protection remain acceptance requirements; the redesign does not supersede those findings.

The parity review also caught omissions in the proposed specification: read-only source would have removed editing, and the boards did not enumerate secondary qualification fields, archive/request approval, the Enrolled-to-course prompt, full receipts, or conditional related work. These are corrected in the parity contract. They are design omissions caught before implementation, not observed deployed regressions.

## Final interaction model

**Normal record.** Keep existing global navigation. Header contains Back to Contacts, name, division, Edit contact and restrained overflow. No duplicated channel/owner/status summary. A compact task band follows. One local tab row contains Record plus all applicable operational tabs from the contract below. Default to Record for ordinary entry; preserve explicit task/conversation/resource links. No second local navigation index in read mode.

Record contains Contact & preferences and Current inquiry, or accurately labeled closed/no-opportunity/conflict state. Keep person channels, contact source and contact metadata in Contact; opportunity status/owner, program, inquiry source/date, qualifications and placement evidence in Current inquiry. No duplicated enrollment/receipt collections or gateway-only Manage buttons below these sections. Phone history/provenance may disclose; contact restrictions remain visible by the affected channel/action. Persistent profile notes are distinct from chronological Activity notes. Header More contains Archive contact or Request archive approval under current policy.

**First-class tab contract.** Preserve applicability and authorization, not a fixed tab count. Rename only when helpful; old routes/deep links retain compatibility.

| Production destination | Revised destination | Contents and direct actions |
|---|---|---|
| Timeline | Activity | One chronological feed/filter family; Add note and exact linked events. Keep all applicable historical categories; task-event counts are not open-task counts. |
| Conversations | Conversations | Readable message history/details and permitted Messenger/WhatsApp composer; delivery errors and readiness. |
| Courses (USA) | Enrollments | Actual current/planned/history records; Add enrollment, Add history, select/edit, Complete, End. No mandatory Manage navigation before seeing records or opening forms. |
| Receipts (USA) | Receipts | Actual saved receipts and direct Generate student receipt / Download PDF under existing eligibility and permissions. |
| Financials (Signs/other applicable workflows) | Financials | Existing document types, estimates, invoices, linked payments/balance previews and downloads; keep original financial rules. |
| Work Orders (including conditional USA work) | Work Orders | Linked work rows, status/due/number, applicable financial actions and exact Open links. Preserve existing contact-scoped Create Work Order route; full work-order creation remains a dedicated workflow. |
| Contacts (Signs linked people) | People, or retain Contacts until Signs is separately refined | Names/roles/primary/channel details plus add/edit/designate primary/remove. Preserve Signs account versus person distinction. |

Click tab → see its records → invoke a relevant action. A contextual dialog is acceptable. An optional Open full details link uses an existing destination; do not invent a parallel full-page resource solely for this redesign. Preserve selected record, filters and tab on return. One primary creation action per tab, with contextual row actions; do not repeat the same CTA in toolbar, summary and empty-state panel. A zero count alone must not hide an otherwise authorized tab with a useful creation action. Retain current policy for conditional tabs; do not broaden resource access.

**Task band.** Show the selected permitted open follow-up with title, due date/time zone, task owner and relationship context. Complete follow-up opens the existing outcome workflow with that exact ID. Record outreach uses the no-task path and completes no task. Schedule follow-up preserves contact/division/opportunity and explicit owner rules. Keep optional next-follow-up creation inside the outcome save. If several eligible tasks exist, View tasks exposes the actual permitted set; zero tasks offers Schedule follow-up / Record outreach, and a failed read is not zero.

Selection contract: honor a valid incoming exact task first. Invalid/stale/mismatched explicit context shows an error and never substitutes another task. For ordinary entry, order eligible open follow-ups by oldest overdue dueAt, then earliest upcoming dueAt, then undated; ties use oldest createdAt then stable ID. Evaluate the current instant consistently and display the configured user's time zone. Exclude completed/cancelled and unauthorized records using existing lifecycle/access policy. Listing visibility and permission to complete remain separate. Explicit no-lead task context remains valid where supported. This deterministic default is a proposed implementation contract, not a claim about current ordering.

**Activity.** One feed and one filter family; distinguish human outreach/notes from system events. Source details disclose within events. Keep Add note reachable while history loads; do not copy the feed into Record or confuse persistent profile details with a new chronological note.

**Conversations.** Preserve readable history wherever permitted, including senior roles without sending. For admins, preserve current templates/custom text and provider/consent/channel checks. Metadata can disclose but includes delivery errors/IDs. Distinguish Not sent, Failed, and Sent with audit issue; retry never resends an already accepted operation. Six outreach logging channels do not imply six send integrations. Relevant restrictions remain visible while acting in this tab.

**Editors.** Edit contact contains name, email, phone, existing contact-wide learning preference and independently scoped Contact source. No lifecycle/assignment tab. Edit inquiry uses Inquiry details, Ownership & status, Source; retain every lead-profile field. Change owner and Change status open this same editor at Ownership & status; use one draft/save path and retain Move to [status] confirmation/reason rules. Source corrects only the selected opportunity and preserves sourceDetail/provenance distinctions. Contact-source correction works without an opportunity. Both preserve current/custom values and clearing; neither silently patches the other entity. No stacked dialogs, all-record mega-form, new autosave path or source-driven artificial opportunity creation. A compact viewport may replace the editor index with a selector; desktop is authoritative. Explicit Save/Cancel, draft retention, conflict/retry and focus restoration are mandatory.

**Enrollment/receipt resources.** Render existing contact-scoped resource components inside their retained tabs, then refine duplicate summaries/actions. Use real course and financial IDs. Keep every enrollment mode, plural active courses and all financial fields/rules. Resolve course-context selection before changing linkage/access behavior; preserve historical record linkage rather than automatically relinking to the active opportunity. Existing Signs layout/resources remain intact until separately verified; shared components still require regression checks. A new closed-opportunity collection remains optional/deferred until an authorized actual-lead read projection exists.

## Implementation-ready acceptance criteria

1. **One authoritative fact.** In Record read mode, email, phone, intended learning location, opportunity owner and opportunity status each have one primary display. The header contains no duplicate summary. Repeating a name as task owner is allowed only with that distinct label and relationship purpose.
2. **Correct current state.** A fixture with an older active and newer closed opportunity displays the active one. A closed-only fixture displays No active inquiry plus Last inquiry (closed), never Current inquiry. Zero leads displays the quiet No active inquiry state. An authorized Start inquiry action remains secondary and optional for genuine new business; contact editing and existing resources remain usable without it. Multiple active rows display a visible conflict and prevent opportunity writes; permitted identity editing remains available.
3. **Scoped contact save.** Edit contact sends only changed contact fields plus ID/context needed for authorization. It never sends status, assignedTo, the ambiguous legacy coupled `source` payload, an unchanged full leadProfile, or legacy course fields. A changed contact-source value uses the explicit contact-only server contract. Name/email/phone errors are visible next to the fields. Preserve existing clear/normalization semantics.
4. **Scoped opportunity save.** Opening the editor captures the exact opportunity ID. Send changed allowed lead-profile/status/owner fields with that ID. A 409 or changed active opportunity keeps the draft and explains refresh/review; never retarget it to another lead automatically. Reuse locked mutation services and server authorization.
5. **Dependent fields.** Ownership changes use eligible assignees and existing role rules. Closed-status transitions and reopening retain required reasons and lifecycle validation. Changing status never silently creates an enrollment. Preserve the existing Add Enrollment prompt after a successful change to Enrolled when no active course exists. Canceling that subsequent prompt keeps the saved status; a failed status save opens no prompt.
6. **Locations and source.** AIT USA learning preference reads/writes contact address via existing helpers. Student location reads/writes lead locationPreference as free text. Routine opportunity-only saves do not send contact-wide `source`. Independent named contact-source and opportunity-source corrections replace the coupled write under P51; no-opportunity contact correction remains supported. Placement evidence and original submission provenance remain read-only.
7. **Exact next work.** Fetch tasks with contact and division scope; derive counts from returned authorized records. Display task ID-backed context. Open Complete follow-up with that exact ID; rejected/missing/mismatched task cannot fall back to completing another task. Multiple-task fixtures prove the intended task alone is completed in local mocks or separately authorized staging write QA.
8. **Separate outreach and scheduling.** Record outreach explicitly completes no task. Scheduling preserves contact/division/opportunity; unassigned records do not default to an arbitrary first employee. A regular coordinator cannot assign work to another user through an altered payload.
9. **No misleading empty states.** Each task, opportunity, course and conversation request has loading, empty, denied, failed/retry and ready states. Failed requests do not display zero counts or No active enrollment. Counts describe records, not mixed events.
10. **Course identity and context.** Enrollment edits load the full course endpoint response and use its ID. New/edited enrollment flows validate the authorized opportunity/class-section context. Fixtures cover older-active/newer-closed, conflict, no lead, multiple courses and duplicate active section. Do not use name matching as identity.
11. **Legacy course information.** If only legacy course text exists, show it explicitly as legacy information; do not portray it as a real active enrollment. Preserve current/history/planned distinctions and class section/location/teacher fields. Existing financial operations remain in their own permission-controlled workflows.
12. **Draft continuity.** Switching editor sections keeps all fields and validation. Escape, X, Back, Cancel, tab navigation or a changed contact cannot silently discard a dirty draft. Keep editing retains values; explicit discard closes. A failed network save retains inputs and exposes retry. Successful save restores focus to its trigger and refreshes affected projections.
13. **URL and return continuity.** Own view/filter/task/editor context in valid route state where useful. Preserve `action=log-follow-up` and exact task links. Returning to Contacts restores the originating query, filters, page and record focus. Unsupported or stale context fails visibly and safely.
14. **Role behavior.** Admin and senior see assignment controls when authorized; regular coordinator ownership is read-only and API denial is retained. Read-only users see no write controls. Conversations visibility and send capability are independent. Test direct requests as well as hidden/disabled controls.
15. **Desktop-first, responsive baseline.** Validate main workflows at 1440×1000 and compact desktop 1280×800. Basic narrow-width smoke retains readable channels/program/status, reachable tabs/actions and Save/Cancel, no page-wide overflow, and no broken existing navigation. A mobile-first redesign, extra phone concept round or exhaustive device matrix is not required.
16. **Accessibility and long content.** Test desktop and 200% zoom plus a bounded 390px/320px responsive smoke. Keyboard-only users can traverse tabs, disclosures, editor sections and dialogs; focus is visible, trapped correctly during a dialog and restored on close. Use real labels, selected/expanded semantics, associated errors and announced save outcomes. Aim for 44px touch targets and verify rendered dimensions.
17. **Activity clarity.** One filter family and one feed. Show system origin for ingestion events rather than presenting them as unknown human authors. No event totals masquerade as open-task or inquiry collection totals. Long history loading cannot unmount the active composer or remove focus.
18. **Division safety.** Initial layout applies to the AIT USA contact detail. Shared components must preserve AIT Signs clients, people, work orders, estimates and financial access. Do not apply AIT USA opportunity selection or student labels to Signs. A populated Signs fixture is required before a shared-shell release.
19. **No lost functionality.** Every applicable P01–P49 row and all field-ledger inputs in the parity contract have a reachable implementation and recorded verification. P50–P56 improvement contracts are separately verified; source capability is preserved while P51 deliberately replaces coupled write behavior. No existing operation is removed merely because it is absent from an image or scheduled for a later slice. Reuse the existing workflow until its replacement passes.
20. **Source correction and truthfulness.** Preserve options/current custom values, clearing and role checks. Contact correction updates contact only, including no-opportunity contacts; opportunity correction updates exact lead only. Denied/stale/conflicted writes preserve the draft, never retarget or cross-write. Original events remain unchanged. Neither ordinary editor resends unchanged attribution. Missing stored source is Unknown/Not recorded, never a sample channel. Do not silently reinterpret contact fallback as original opportunity evidence.
21. **Archive outcomes.** Direct archive and request approval have distinct labels, confirmation and success states. A request leaves the contact active and preserves approval-task reuse; direct archive preserves history and returns appropriately. Existing reason/default behavior and server permission checks remain intact.
22. **Complete qualification/outreach fields.** All 18 original profile inputs remain supported; source is expanded into two explicit scopes rather than losing either contact or opportunity correction. The nine outreach outcomes, six logging channels, attempted method, note, optional next task/owner, seven optional profile fields and normalized status/contactability effects remain intact. Ctrl/Cmd+Enter note submission and failure draft retention are preserved.
23. **Receipts.** Eligible users can generate a receipt using all five payment inputs and bound contact/division context. Keep the existing Enrolled status/stage eligibility, not a new course-existence requirement. Save precedes PDF generation. Retry after a download failure targets the saved financial record without another payment; existing receipts remain downloadable.
24. **Enrollment lifecycle.** Preserve add enrollment, add history, edit, complete and end actions; all nine course fields; six statuses; saved-section and manual modes; adaptive dates/outcomes; and multiple distinct active courses. Keep duplicate-active validation and full record IDs. The course-context mismatch in F16 remains a gate on changed enrollment linkage behavior.
25. **Conditional and shared resources.** USA related work remains visible when applicable. Signs retains linked-person CRUD/primary designation, work-order entry/opening, estimates, invoice generation, payment recording, balance previews and all PDF downloads. The USA boards cannot justify removing these tabs or capabilities.

26. **In-tab productivity.** Every applicable production tab remains directly selectable and renders records/actions, not a gateway button. Empty-state creation stays reachable where authorized. Enrollments and receipts do not require a second navigation before their existing forms. Preserve existing dedicated work-order workflow links. No duplicated collection in Record.
27. **Task ordering.** Verify the task-band ordering above with overdue/upcoming/undated/tied tasks and valid/invalid explicit task links. Show counts from actual permitted records; no silent substitute completion.
28. **Quick correction.** Change owner/status opens the existing scoped editor section in one action; single draft/save implementation and full reasons/policies retained.
29. **Operator acceptance.** With representative roles and comparable fixtures, complete channel/program identification, exact follow-up plus next task, owner/status correction, enrollment/history, receipt/download, and filtered-queue return. Record success, wrong turns and unnecessary navigation versus the current flow. Common jobs must not gain mandatory navigation steps; parity checkboxes alone do not prove simplicity.

## Small delivery slices, ordered by user impact

| Order | Slice and visible outcome | Scope / dependencies | Validation and exit |
|---|---|---|---|
| 1 | **One readable record.** Remove repeated review/sidebar summaries; introduce Record default with Contact/Current inquiry facts and retain operational tabs with in-tab records/actions; keep the task band compact. | AIT USA layout and view-model projection only, preserve current resource components and services. No new inquiry table, migration or history browser. Show real empty/conflict labels. Keep existing mutation flows, including source editing and archive, reachable until their replacements are verified. Preserve conditional related work and the Signs branch. | Desktop read-only QA and basic responsive smoke plus no-lead, closed-only, conflict, legacy course and long-field fixtures. AC1,2,6,9,11,15,18,19,25. |
| 2 | **Trustworthy next action.** Replace event-derived task summary with current permitted tasks and explicit Complete/Record/Schedule intents. | Existing tasks GET filtering and follow-up dialog; exact IDs and owner context. Can develop independently of editor redesign, after slice 1 shell contracts settle. | Exact-task, multiple-task, stale, unassigned and denied fixtures; task route compatibility. AC7–9,13. |
| 3 | **Focused, safe corrections.** Separate contact and opportunity editors with section navigation only inside the latter; preserve drafts. | Existing PATCH and locked opportunity mutation services; changed-field payload builders; full profile ledger; independent source correction and unknown-attribution read fix; archive/request approval in More. Preserve status shortcuts and Enrolled-to-course prompt. No opportunity history editing. | Contact-only patch, full field round trips, source scope, archive/request outcomes, dependency reasons, conflict/409, role policy, keyboard and dirty-dismiss fixtures. AC3–6,12,14–16,19–22. |
| 4 | **Related records that stay in context.** Refine populated enrollment/receipt tabs with direct actions, optional detail links and full record IDs. | Align course access/linkage selection with the existing AIT USA opportunity policy before expanding enrollment mutations. Reuse every existing course/class-section and financial workflow; prior slices retain their working forms. Preserve conditional USA work and all Signs operations. | Older-active/newer-closed, multiple-course, duplicate-section, receipt eligibility, save/download and shared Signs fixtures; authorized read QA. Live writes require disposable staging QA authorization and database target confirmation. AC10,11,13,18,19,23–25. |
| 5 | **Understand the relationship history.** Consolidate Activity filters and clarify system events and conversation capabilities. | Preserve all note/outreach actions, history metadata, existing admin Messenger/WhatsApp templates/custom composer and delivery states throughout the rollout. A new closed-opportunity collection is a separate optional extension requiring an authorized GET projection; no synthetic inquiries from timeline counts. | Populated long-history, system events, authorized/denied conversation fixtures, template/custom behavior, count accuracy and return continuity. AC9,13,14,17,19,22. |

Before any slice that ships new write behavior: confirm the exact staging database target and use explicit disposable QA records. First implement in an isolated issue-bound worktree from a freshly verified base; one writer per source area. [MIS-408](https://linear.app/mission-control-v2/issue/MIS-408/ait-crm-detailed-contact-workspace-redesign-preserved-tabs-direct) owns this work; the current delivery is documentation/artwork only. Create no new UI framework; retain CSS Modules, shared tokens, existing domain services and reusable dialogs. Do not split this into parallel writers editing the same contact page.

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

## Historical validation commands and work boundary — September 7

Existing unit tests run in this pass:

```text
node --test --test-reporter=dot src/lib/crm/ait-usa-opportunities.test.js src/lib/crm/contact-profile-patch.test.js src/lib/crm/course-records.test.js src/lib/crm/lead-profile.test.js src/lib/contact-detail-view-model.test.js src/lib/ait-usa-enrollment-signals.test.js src/lib/tasks/follow-up-selection.test.js src/lib/crm/ait-usa-assignment-policy.test.js src/lib/crm/access.test.js
```

Result: 67 passing dots, exit 0. The route/bootstrap fixture command used PowerShell environment syntax:

```powershell
$env:TSX_TSCONFIG_PATH='jsconfig.json'
node --import tsx --import ./scripts/register-test-module-hooks.mjs --test --test-reporter=spec src/app/contacts/ait-usa-opportunity-route.test.js src/lib/bootstrap-data.ait-usa-opportunity.test.js
```

Result: 25 passed, zero failures/skips. Total 92 existing fixture tests passed in the earlier design-verification pass. The subsequent parity pass ran six additional baseline suites with 19 passed, zero failures/skips; its exact command and limits are in the parity contract. The earlier 92 were not rerun in that pass. No new tests or application code were written in that historical audit. The current repository contract requires `npm run validate` for every publication candidate; current results are recorded separately in the release packet. Historical fixture results do not verify this redesign.

Files changed: local audit/design artifacts only. Existing modified `AGENTS.md` and untracked `docs/ait-usa-crm-audit-implementation-handoff.md` remain untouched. No commit, worktree, push, PR, merge or deployment was created. Database target directly touched: none; staging application reads and authorized QA sign-in only. CRM record writes, outbound messages, role changes and customer-impacting actions: none.

The original concept and 50-row mapping formed the September 7 baseline. The revised 56-row contract and current publication results are indexed in README. Implementation is paused at the user's request; no app work starts from this document alone. Staging deployment and write-based QA remain separate authorized steps. This document does not claim that the new experience is implemented, runtime-equivalent or accepted by operators.
