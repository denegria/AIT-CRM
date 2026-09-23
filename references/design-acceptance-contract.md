# MIS-426 Tasks Workflow Consolidation — 2026-09-23

## Workload metric strip addendum — 2026-09-23

- Problem: the four equal workload cards use saturated colored top borders that read like binder tabs or selectable navigation even though the metrics are read-only.
- Visual direction: replace them with one compact neutral workload strip containing four label/value pairs separated by subtle dividers.
- Semantic color is limited to a nonzero Overdue value. Zero values and all other metrics remain neutral.
- The strip stays read-only with no pointer, hover, selected, focus, or filtering behavior. Metric-filter interaction remains a separate future decision.
- Responsive behavior: four columns at desktop widths and a contained 2x2 grid at 760px and below.
- Locked: metric values and labels, page header, alert, filters, rows, Task Detail, permissions, mutations, and all CRM data behavior.
- Evidence: matched 1920x1080 before/after screenshots plus 1536x960 and narrow-layout overflow checks.

## Workflow and problem

- Office employees scan Tasks at `1920 x 1080`; `1536 x 960` is the WFH regression viewport.
- The current queue exposes five summary tiles, six simultaneous filters, repeated navigation, overlapping ownership actions, and four row actions for a small amount of work.
- Task Detail visually promotes linked-record navigation while hiding the task-resolution workflow.

## Interaction model and visual direction

- The queue keeps four compact read-only workload metrics. The operational unassigned-lead alert owns the only unassigned shortcut.
- Due, Owner, and Task Type remain visible. Status, Link, and Division move behind one explicit `Filters` disclosure without losing their values or behavior.
- A standard follow-up row presents `Log outcome`, `Contact`, and `More`. The linked title remains the route to Task Detail; the duplicate `Review` action and duplicate `Assign to me` action are removed.
- A linked task without a hydrated contact name says `Linked contact`, never `No contact linked`.
- Task Detail promotes `Log outcome`, keeps Contact secondary, removes duplicate `Open Queue`, exposes owner assignment in Metadata, and moves cancellation into `More`.
- Typography and control targets match the upgraded Contacts/Pipeline scale while preserving the information density needed at both desktop widths.

## Locked behavior and non-goals

- Preserve permissions, exact follow-up selection, structured outcome recording, assignment mutations, cancellation/approval semantics, edit/create flows, recurring tasks, task counts, filters, linked records, and task history.
- No backend, API contract, RBAC, database, production, or CRM business-data changes.
- No new task lifecycle, bulk workflow, mobile redesign, or performance architecture.

## Acceptance evidence

- Authenticated live staging at `1920 x 1080` and `1536 x 960`.
- Prove the three-control row hierarchy, secondary-filter disclosure, truthful contact state, outcome-first Task Detail, owner assignment affordance, no overflow/browser errors, and GET-only visual QA.

# MIS-426 Tasks Final Cleanup — 2026-09-23

## Workflow and problem

- The accepted Tasks workflow is functionally complete, but its default queue still looks filtered because the globally locked division counts toward the secondary-filter badge.
- Result count and division scope repeat in the page and queue headers; Reset appears before any employee-controlled filter changes; and `Show queue` does not name the unassigned view it opens.

## Interaction model and visual direction

- The page header owns result count and division scope. The queue header identifies the work area without repeating them.
- The Filters badge counts only Status, Link, and a business-unit choice when the global route is not already locked to one division.
- A fixed route division is omitted from secondary filters. Reset appears only after a user-controlled filter differs from its default.
- The unassigned alert action says `View unassigned`.

## Locked behavior and non-goals

- Preserve workload metrics, Due/Owner/Task Type filters, Status/Link behavior, all-division business-unit filtering, row actions, inline assignment, cancellation approvals, task counts, Task Detail, permissions, and mutations.
- No backend, API, schema, RBAC, data, metric-tile interaction, row/detail redesign, or production change.

## Acceptance evidence

- Primary: authenticated live staging at `1920 x 1080`; regression: `1536 x 960`.
- Prove no phantom default badge, no duplicate queue count/division copy, contextual Reset visibility, truthful `View unassigned`, zero overflow/browser errors, and GET-only QA.

# MIS-426 Pipeline Card Information Polish — 2026-09-23

## Workflow and problem

- Office employees scan the Pipeline at `1920 x 1080`; `1536 x 960` is the WFH regression viewport.
- Pipeline structure, scrolling, performance, and primary actions are accepted. Remaining friction is repeated card metadata, an unlabeled Last Touch value, and an overexposed secondary stage control.

## Interaction model and visual direction

- Last Touch is visible text in the metadata row: `Last touch · Jun 1, 2026`. Missing activity remains `No touch recorded`; the source value is available as a tooltip.
- Desktop Move remains the keyboard alternative to drag-and-drop but is disclosed only while a card is hovered or contains focus. Coarse-pointer and narrow layouts retain visible movement controls.
- The known default `AIT USA Seguimiento Central Workbook` source is omitted from cards because the board is already scoped to that workflow. Exceptional sources such as `Website Form` remain visible.
- Unassigned cards use the neutral user icon plus `Unassigned`; initials are reserved for named employees.
- The close rail owns one instruction in its header. Individual outcome targets show only outcome and count.

## Locked behavior and non-goals

- Preserve Next Step, contextual `Log outreach` / `Log follow-up` actions, card click navigation, drag/drop, keyboard movement, permissions, bulk assignment, close outcomes, lane geometry, full-height close rail, fixed desktop shell, independent lane scrolling, and the 66-card initial render budget.
- No backend, API, data, RBAC, lifecycle, mutation, mobile-workflow, or production changes.
- No typography-scale, toolbar, column, card-density, or layout redesign.

## Acceptance evidence

- Primary: authenticated live staging at `1920 x 1080`.
- Regression: authenticated live staging at `1536 x 960`.
- Prove human-readable Last Touch labels, exceptional/default source behavior, desktop hover/focus Move disclosure, coarse-pointer/narrow safety, neutral Unassigned identity, single close instruction, zero overflow/browser errors, preserved 66-card budget, and GET-only QA.

# MIS-426 Contacts Directory Acceptance Contract

## Typography normalization addendum — 2026-09-22

- Workflow: office employees scan the AIT USA Contacts directory at `1920 x 1080`, with `1536 x 960` as the WFH regression viewport.
- Visual direction: match the hierarchy already used by upgraded Payments, Book Fulfillment, and Contact Detail surfaces without changing the accepted directory composition.
- AIT USA Contacts uses a `var(--text-3xl)` page title, a 13px subtitle, 12px contact names, 11px contact metadata and operational values, 10px Source text, and 10px table headers.
- Compact action labels remain at the existing utility size so the approved 112px contextual buttons, 4px button gap, and 180px Actions track do not move.
- Locked invariants: column order and widths, 57px-class row density, sticky header, explicit View navigation, contextual action states, filters, sorting, pagination, permissions, and all CRM read/write behavior.
- Evidence: matched authenticated before/after screenshots at `1920 x 1080`, rendered font-size measurements, and a `1536 x 960` overflow regression check.
- Non-goals: any grid rebalance, copy change, action change, new interaction, backend change, data write, or production promotion.

## Workflow and problem

- AIT USA employees use Contacts to find a person, understand the current inquiry context, and decide whether outreach is needed.
- The current directory behaves like a wide export: separate email and phone columns, usually-empty location columns, verbose source metadata, and equal View/Edit actions push the useful context off-screen.

## Interaction model and visual direction

- The row is the navigation target. Clicking the row, pressing Enter or Space while it is focused, or following the explicit contact-name link opens Contact Detail.
- Standalone View and Edit actions are removed. Profile editing remains owned by Contact Detail.
- The default AIT USA desktop hierarchy is `Name / Contact`, `Enrollment`, `Owner`, `Next step`, `Last touch`, and `Source`. Email, phone, locations, and Last edited remain available through Columns.
- Next step is compact, truthful operational context. A conditional `Log follow-up` action opens the existing structured outreach flow only when outreach can safely be recorded.
- `Start outreach` is not introduced as a separate action. Retargeting never defaults to scheduling; scheduling is an optional outcome after a specific future commitment is agreed.
- The search field is widened because lookup is the directory's primary job. Existing filters, column selection, creation, sorting, and pagination remain available.

## Locked behavior and state

- Exact open dated commitments suppress the generic Log follow-up shortcut and render as scheduled work; existing task and Contact Detail flows remain authoritative.
- New leads with no genuine interaction show `Needs first outreach`; active inquiries with prior interaction and no commitment show `Needs next follow-up`; eligible closed Retargeting records show `Ready for retargeting`.
- Not Interested, Do Not Contact, wrong-number, missing-channel, inquiry-conflict, and neutral closed states do not receive a generic outreach shortcut.
- The existing follow-up dialog records the attempt and outcome. A next due date is created only when the operator records an agreed future commitment.
- AIT Signs and generic all-division directory modes retain their existing columns and actions in this slice.
- No CRM business-data write, schema migration, campaign behavior, or lifecycle policy change is part of this presentation and navigation slice.

## Responsive acceptance

- Primary viewport: `1440 x 1000` CSS pixels at DPR 1.
- Regression viewport: `390 x 844` CSS pixels at DPR 1.
- Mobile keeps the same row/card navigation model, removes equal-width View/Edit actions, and limits the default card to identity/contact, enrollment, owner, next step, and last touch.
- Matched before/after evidence must use the authenticated staging-backed Contacts route at the same viewport and comparable loaded state.

## Non-goals

- Turning Contacts into a second Pipeline, Tasks queue, or campaign workspace.
- Adding per-contact drip-campaign scheduling, task creation, new outreach mutations, KPI cards, or a desktop card layout.
- Redesigning AIT Signs Clients, Work Orders, Financials, or unrelated operator routes.

# MIS-426 Contact Detail Review Context Acceptance Contract

## Workflow and problem

- AIT USA staff need the contact's timeline and next actionable work immediately; the five-field Review context panel repeats status, owner, contactability, activity, and generic next-context summaries already available in the profile and timeline.
- Removing the duplicate panel reduces vertical and visual competition without deleting source data or actions.

## Interaction model and visual direction

- AIT USA Contact Detail begins its main column with the existing content tabs and timeline workspace.
- AIT Signs retains the existing Review context panel until its client workflow is reviewed separately.
- No generic summary is relocated into another card in this slice.

## Locked behavior and state

- Profile identity, workflow state, contactability warnings, assignment, actions, tabs, timeline records, permissions, and business-unit detection remain unchanged.
- Review context styles stay available for non-AIT-USA workflows.
- No data read, write, RBAC, API, or navigation behavior changes.

## Desktop acceptance and evidence

- Primary viewport: `1440 x 1000` CSS pixels at DPR 1.
- Compare the same authenticated AIT USA contact and loaded timeline state before and after the change.
- The after state has no Review context landmark or visible summary panel; content tabs move into its former position without new overflow.
- A focused regression test proves that AIT USA owns the conditional removal while the panel remains in the non-AIT-USA render path.

## Non-goals

- Mobile redesign or responsive acceptance for this element pass.
- AIT Signs Contact Detail redesign.
- Reworking the profile sidebar, timeline, task band, tabs, or contact-detail information architecture beyond this approved removal.

# MIS-426 Contact Sidebar Acceptance Contract

## Workflow and problem

- AIT USA employees need stable contact truth, the current inquiry, and the exact next follow-up without scanning duplicated tiles or acquisition metadata.
- The existing Enrollment Profile pane mixes contact identity, inquiry state, source, enrollment facts, activity freshness, ownership, and competing actions. It is lifecycle-inaccurate for leads and visually treats every datum as equally important.

## Interaction model and hierarchy

- The element group is the Contact sidebar. It has no visible overarching title; the contact's name anchors the pane.
- One outer surface contains three identifiable sections separated by dividers: Contact, Current inquiry or Last inquiry, and Next step.
- Contact contains primary email, primary phone, address when present, and restriction or missing-channel guidance beside the affected channel. Alternate phone numbers remain collapsed until requested.
- An active Opportunity is labeled Current inquiry. When all inquiries are closed, the most recent truthful record is labeled Last inquiry instead of presenting a blank current state.
- Both inquiry states label the canonical Lead lifecycle as Inquiry status. Program uses only the explicit Lead profile value; acquisition/import descriptors must never be relabeled as a program. Student location and inquiry owner are always-visible core facts. Missing core facts say Not recorded or Unassigned rather than leaving an apparently blank section.
- A Contact without any inquiry history is treated as a data-integrity exception and offers no normal outreach action. Multiple active Opportunities show an explicit conflict state instead of presenting one as authoritative.
- Next step reflects exact follow-up task truth and owns the single workflow-primary action. Edit profile remains a secondary action.

## Task-aware states

- No open follow-up task on an actionable active inquiry: show No follow-up recorded and Log follow-up.
- A New Lead that still needs first outreach: show Needs first outreach in Next step with Log follow-up. This operational state must not replace Inquiry status.
- One current task: show its title, due state, and owner with Open follow-up and a direct Log outcome action when permitted.
- One overdue task: identify it as overdue and prioritize Log outcome.
- Multiple open tasks: show the count and Review follow-ups instead of implying one canonical task.
- Outreach blocked or a primary channel missing: show the exact restriction or missing-channel state. A hard Do Not Contact restriction remains non-actionable; a correctable channel problem routes to Update contact info or Add contact info.
- Multiple active inquiries: show an inquiry-conflict state and Review inquiries in the exact pipeline search instead of presenting one inquiry as authoritative. A dedicated resolver remains outside this slice.
- Any exact open follow-up task remains authoritative even when the latest inquiry is closed.
- Retargeting with no open task: show Ready for retargeting with Log follow-up. Retargeting indicates eligibility for renewed outreach, not that outreach is already due or scheduled.
- Not Interested or a hard Do Not Contact restriction: show outreach as closed or blocked with no scheduling action.
- Dropped / Quit and Course Completed with no open task: show a neutral closed state with no primary action.
- Icons reinforce these states, but text labels carry the meaning. Pills are reserved for true workflow states.

## Visual direction and content growth

- Desktop target width is approximately 328px. Use calm spacing, clear section labels, and labeled rows rather than a grid of mini-cards.
- Only Next step receives a lightly tinted background. Do not nest independent cards or introduce a sidebar scrollbar.
- Inquiry owner includes a small avatar or initial for recognition. Core inquiry fields remain identifiable even when missing; genuinely optional secondary preferences disappear when empty.
- Missing email or phone guidance is consolidated with the affected channel rather than repeated in a second warning card. A no-channel, DNC, or wrong-number condition may retain one explicit blocking notice.
- Missing values remain visible but visually recede. Unassigned shows no fake avatar; owner initials are reserved for real employees.
- Next-step state icons describe the state while CTA icons describe the action. Recording outreach uses the existing clipboard-check action icon instead of implying a scheduled commitment.
- Compact uppercase labels remain legible at the desktop acceptance viewport; section and channel labels use an 11px floor without increasing sidebar density.
- Dense records may include all preferences, multiple phone numbers, restrictions, an assigned inquiry, and an active task. Lower-priority preferences and alternate phones use progressive disclosure.

## Locked behavior and scope

- This redesign applies only to AIT USA. AIT Signs retains its current sidebar, labels, fields, actions, and styling.
- Assignment remains inquiry-level data from the selected active Lead or Opportunity. It must be labeled Inquiry owner; no contact-owner concept is invented.
- Existing edit tabs, permissions, follow-up mutation flow, task detail routes, timeline, business-unit detection, and the already accepted Review context removal remain intact.
- Current, completed, and ended course summaries stay out of this sidebar and remain owned by Courses.

## Desktop acceptance and evidence

- Primary viewport: `1440 x 1000` CSS pixels at DPR 1.
- Compare the same authenticated AIT USA contact and loaded timeline state before and after the change.
- Validate sparse New Lead, populated or enrolled student, missing phone or outreach restriction, current and overdue follow-up, multiple open follow-ups, and multiple active inquiries through focused model tests and representative rendered evidence.
- The page has no horizontal overflow, clipped sidebar actions, nested scrollbar, duplicate stage/source/contactability summary, or competing primary actions.

## Non-goals

- Mobile redesign or responsive acceptance for this element pass.
- AIT Signs Contact Detail redesign.
- A permanent Contact owner field, inquiry-history redesign, task schema change, new follow-up mutation, or acquisition-source relocation in this slice.
- Committing, pushing, or deploying before the full Contact Detail page is accepted.

# MIS-426 Contact Detail Navigation Acceptance Contract

## Workflow and problem

- AIT USA employees need to move between activity, conversations, enrollments, and receipts without interpreting three overlapping navigation layers.
- The current primary tabs, four-card snapshot strip, and timeline filter chips repeat Inquiry, Outreach, Messages, and Tasks with different vocabulary and equal visual weight.

## Interaction model and hierarchy

- The primary workspace tabs remain the only page-level navigation layer: Activity, Conversations, Enrollments, and Receipts when available.
- Counts render as quiet badges rather than parenthesized label text.
- Activity owns one compact filter row. All activity is always visible; Inquiries, Outreach, Messages, Tasks, and Notes appear only when they contain records or are currently selected.
- Import history remains reachable under a low-priority More control only when import-history records exist.
- The four-card Inquiry / Outreach / Messages / Tasks snapshot strip is removed for AIT USA because its counts and click behavior duplicate the Activity filters. Non-AIT-USA workflows keep their current snapshot strip.

## Locked behavior and accessibility

- Activity remains the default workspace and preserves existing timeline records, counts, filter behavior, loading/error/empty states, source provenance, note composer, permissions, and mutations.
- Conversations, Enrollments, Receipts, AIT Signs tabs, and their existing content remain functionally unchanged.
- The tab row exposes tablist/tab/tabpanel semantics, aria-selected state, visible focus, and Left/Right/Home/End keyboard navigation.
- Filter chips retain pressed-state semantics and visible focus. Choosing Import history closes the More disclosure and leaves the selected filter visibly represented.

## Desktop acceptance and evidence

- Primary viewport: `1440 x 1000` CSS pixels at DPR 1.
- Compare the same authenticated AIT USA contact and loaded Activity state before and after.
- The after state has no AIT USA snapshot-card strip, no duplicated zero-count category chips, and no horizontal page overflow.
- Activity, Conversations, Enrollments, and conditional Receipts remain reachable; the timeline begins higher without changing record content.

## Non-goals

- Timeline record/card redesign, note-composer redesign, Conversations/Enrollments/Receipts content redesign, or mobile acceptance.
- Adding the archived Inquiries workspace, changing inquiry data, changing task behavior, or modifying AIT Signs navigation/content.
- Committing, pushing, or deploying before the full Contact Detail page is accepted.

# MIS-426 Activity Actions Acceptance Contract

## Workflow and problem

- Employees must distinguish internal context from completed outreach and future task planning without interpreting neighboring buttons inside one form.
- The current Activity footer places `Log Follow-up` inside the internal-note form, which visually suggests two submission paths for the same text even though the mutations have different data, task, and lifecycle effects.

## Interaction model and hierarchy

- AIT USA exposes two separate, compact Activity actions: `Add internal note` and `Record outreach`.
- `Add internal note` expands an inline composer in the Activity panel. The composer is collapsed by default, labels the content as internal-only, warns that saved notes are append-only, and submits with `Save note`.
- `Record outreach` opens the existing structured outreach workflow for outcome, channel, required summary, and optional next scheduling. Exact task entry continues to use the existing task-aware `Complete follow-up` title and task-match behavior.
- Future task creation and scheduling remain owned by the sidebar Next step action. Internal note, recorded outreach, and future follow-up are not presented as interchangeable actions.
- The Activity action buttons remain visually secondary to the sidebar's task-aware primary action.
- `Add internal note` uses a message-plus icon and gains a restrained active treatment while its composer is expanded. `Record outreach` uses a clipboard-check icon so it reads as structured outcome logging rather than sending a message.

## Locked behavior and accessibility

- AIT USA note writes remain append-only timeline notes and do not change status, complete tasks, or schedule work.
- The existing follow-up API, task resolution, outcome validation, permissions, and optional enrollment-profile update remain unchanged.
- The Add internal note trigger exposes expanded state and a controlled region; opening moves focus to the textarea. Cancel discards the unsaved draft and collapses the composer. Successful save clears and collapses it.
- AIT Signs keeps its existing always-visible note composer and `Log Follow-up` action in this slice.

## Desktop acceptance and evidence

- Primary viewport: `1440 x 1000` CSS pixels at DPR 1.
- Compare the same authenticated AIT USA contact and loaded Activity state before and after.
- The default after state has no always-open empty textarea and no follow-up action inside the note form.
- Capture the expanded internal-note state once to prove helper copy, Save note, Cancel, focus, and separation from Record outreach.
- No horizontal overflow, timeline-content change, database write, commit, push, or deployment.

## Non-goals

- Redesigning the structured follow-up dialog, changing task selection, changing note storage, or adding a new activity type.
- Reworking AIT Signs, Conversations, Enrollments, Receipts, timeline records, or mobile layouts.

# MIS-426 Activity Records Acceptance Contract

## Workflow and problem

- AIT USA employees need to scan what happened, who or what caused it, its operational result, and whether deeper source evidence exists without reading raw import or machine payloads.
- The current universal record renderer gives imported inquiries, repeated outreach, employee notes, task events, and system workflow events the same tall composition. It repeats division and linked-record labels, duplicates titles, leaks raw provenance into the primary layer, and classifies unrecognized system events as Internal note.

## Interaction model and taxonomy

- Keep the existing chronological timeline rail. Each item uses one shared shell with five semantic record templates: Inquiry, Outreach, Internal note, Task, and System / workflow.
- Import is provenance, not a semantic record type. Imported inquiry and outreach records keep their semantic category and gain a restrained `Imported` indicator plus conditional Source details. More -> Import history includes every imported record across categories.
- System / workflow is a distinct semantic category. Machine-originated placement, portal, advisor-handoff, profile-sync, and similar events must never appear as Internal note or receive a fake Unknown user attribution.
- Activity records remain read-only history. Creation and workflow actions stay in the accepted Activity toolbar and sidebar Next step surfaces.

## Shared visual shell

- Preserve the rail and left marker. Use a category or channel icon with a neutral default tone; color cannot be the only category or status signal.
- Header order: semantic category at left, at most one useful status indicator beside it, and the truthful date/time at right.
- Content order: one human title, one concise body when it adds information, then one compact metadata row. Do not render a bordered card inside the timeline item.
- Metadata is plain labeled text or short separators, not a grid of mini-cards. Show no more than four primary facts; lower-value facts and machine provenance stay collapsed.
- Remove `AIT USA Institute`, generic `Lead`, duplicate task-title chips, and other values already guaranteed by the page context.
- Employee-authored or exact-time events show date and time. Source-derived records known only to date precision show the date without a fabricated `12:00 AM`.
- Simple inquiry transitions, outreach attempts, task events, and system events target an approximately 80-116px record height. Notes may grow naturally but collapse behind Show more after roughly five text lines.
- At `1440x1000`, at least five short outreach records should be visible beneath the Activity toolbar without a nested scrollbar.

## Inquiry template

- Lead capture uses an inquiry icon, category `Inquiry`, and a human title such as `Inquiry captured` or `Facebook inquiry received`.
- Status transition uses category `Inquiry` and a title that states the result, such as `Inquiry moved to Follow Up`; previous status appears as compact secondary metadata when available.
- One status pill may show the canonical inquiry status. Do not repeat that status in the title, body, and metadata.
- Primary metadata may include actual program, student location, for whom, age band, inquiry owner, or transition actor when present and trustworthy. Acquisition source may appear once as a labeled secondary fact when it helps identify the capture channel.
- Provider IDs, external submission IDs, workbook names, hashes, row IDs, policy keys, import keys, and raw form payloads appear only under Source details.
- Records proven to represent the same imported submission are consolidated by a stable submission/source identity. Ambiguous records remain separate rather than being guessed together.

## Outreach template

- Use category `Outreach`; choose a channel icon when known (phone, email, SMS/WhatsApp, or in-person) and a neutral outreach icon otherwise.
- The title is the human outcome: `No answer`, `Left voicemail`, `Reached - interested`, `Appointment scheduled`, or another normalized outcome. Do not title every record `Follow-up attempt` when the outcome is known.
- Primary metadata order: channel or contact method, employee, and next commitment. Show the summary/body only when it adds context beyond the normalized outcome.
- An exact scheduled next follow-up shows its due date once. Do not repeat linked task titles or generic Lead/division labels.
- Repeated short outreach events use the compact shell; imported outreach keeps a quiet Imported indicator and optional Source details without becoming an import-style card.

## Internal note template

- Use category `Internal note`, a note icon, the note body, author, and truthful timestamp.
- Employee-authored notes never show `Imported history`, Source details, business unit, or linked Lead labels.
- Imported workbook notes are not employee Internal notes. They belong to Import history and use a neutral imported-history title with the original row collapsed under Source details.
- If a note has no resolvable author, omit attribution rather than displaying `Unknown user`; data-integrity diagnostics remain outside the employee card.

## Task template

- Use category `Task`, a task-state icon, and the task title once.
- The event action appears as the status indicator or concise secondary text: Created, Completed, Canceled, Reassigned, Rescheduled, or Reopened.
- Primary metadata order: current or resulting status, owner, and due date. Priority appears only when it is exceptional or operationally meaningful.
- Owner and due-date changes use explicit before -> after text when both values exist. The actor appears only when it adds information distinct from the owner.
- Do not repeat `Task: <title>`, generic Lead, or division chips. Task history remains read-only here; task actions stay in the sidebar/task workspace.

## System / workflow template

- Use category `System`, a workflow icon, and a mapped human title such as `Placement review created`, `Advisor handoff requested`, `Portal account activated`, or `Placement result claimed`.
- Render only operationally useful metadata from the safe payload: placement level/status, review state, communication preference, or another explicitly mapped field.
- Raw snake_case event names, correlation IDs, idempotency keys, internal URLs, hashes, and machine payload dumps are never primary content.
- Omit author when the event is machine-generated. Never display `By Unknown user`.
- System events remain visible in All activity. A conditional System history option may live under More beside Import history when records exist, avoiding another permanent chip.

## Locked behavior, permissions, and scope

- Timeline ordering, server-side business-unit scoping, RBAC, source records, note/follow-up/task mutations, and existing Activity actions remain unchanged.
- AIT Signs keeps its existing record renderer and Signs-specific work/estimate/payment templates in this slice.
- Activity filters remain count-bearing and keyboard reachable. Inquiry, Outreach, Tasks, and Notes use semantic categories; Import history is a provenance facet; System history is a conditional low-priority facet.
- Conversations and Enrollments remain owned by their dedicated tabs. This slice does not invent message or course-history records absent from the staging evidence.

## Desktop acceptance and evidence

- Primary viewport: `1440 x 1000` CSS pixels at DPR 1. Mobile redesign is out of scope.
- Matched before/after evidence must cover Quinto (captured/imported inquiry), Hector (repeated outreach), Mildred (employee note), Denegri QA (task), Denegri QA (system workflow), and Sixto (status transition plus noisy import).
- Browser checks prove no horizontal overflow, no nested timeline scrollbar, truthful filter counts, functional Source details disclosure, and preserved record ordering.
- Focused tests lock semantic classification, imported provenance faceting, system-event mapping, task metadata projection, date-only precision, and duplicate-submission consolidation rules.
- Screenshot review can verify hierarchy and density; keyboard focus, accessible names, contrast, and details/summary behavior require browser/DOM checks.

## Non-goals

- Changing source data, mutating or deleting duplicate historical events, adding a new database schema, or rewriting provider ingestion.
- Redesigning the Activity toolbar, sidebar, Conversations, Enrollments, Receipts, structured outreach dialog, or AIT Signs records.
- Committing, pushing, or deploying before the full Contact Detail page is accepted.

# MIS-426 Enrollments Workspace Acceptance Contract

## Workflow and information hierarchy

- AIT USA uses one Enrollments workspace with one header, one empty state, and one canonical action for each intent.
- `Start enrollment` creates a current enrollment. `Add past enrollment` backfills a completed or otherwise ended enrollment without changing the current inquiry lifecycle.
- Starting a current enrollment and moving the selected active inquiry to `Enrolled` are one server-owned transaction. A partial course-only or status-only success is never accepted.
- Starting requires exactly one active AIT USA inquiry. Missing, closed-only, changed, or conflicting inquiry state fails closed with a refresh/review message.
- When records exist, active enrollments appear first and ended records appear under `Enrollment history`. Active records are not repeated in history.

## Interaction and content

- Empty state: `No enrollments yet`, one primary `Start enrollment` action, and one secondary `Add past enrollment` action in the workspace header.
- With an active record, the primary action becomes `Add another enrollment`; saved edit, complete, and end controls retain their current behavior.
- Course/class terminology remains inside record fields where it names the curriculum. Workspace, action, history, modal, and save labels use Enrollment consistently.
- The Start enrollment dialog fixes the new record to Current and states that saving also updates the current inquiry to Enrolled.
- The Add past enrollment dialog exposes only ended statuses and never changes inquiry status.
- AIT Signs and all non-AIT-USA course surfaces remain unchanged.

## Desktop acceptance and evidence

- Primary viewport: `1440 x 1000` CSS pixels at DPR 1. Mobile redesign is outside this slice.
- Matched before/after evidence uses the same real staging-backed Contact and the loaded empty Enrollments state.
- Current staging contains no normalized enrollment records, so active/history density is validated by focused component/source and workflow tests rather than fabricated screenshot data.
- Browser checks prove one empty state, one instance of each action, no horizontal overflow, and no CRM mutation during evidence capture.

## Non-goals

- Creating synthetic staging enrollment records, changing class-section schema, redesigning the enrollment editor fields, or adding billing/attendance behavior.
- Reopening a closed inquiry automatically, starting a new inquiry, or resolving multiple active inquiries from the Enrollments workspace.
- Committing, pushing, deploying, or writing CRM data before the complete Contact Detail page is accepted.

# MIS-426 Edit Profile Dialog Acceptance Contract

## Workflow and ownership model

- AIT USA profile editing is random-access maintenance, not a sequential setup flow. The dialog uses three directly accessible tabs: `Contact`, dynamic `Current inquiry` or `Last inquiry`, and `Inquiry preferences`.
- Contact owns name, email, and phone. Inquiry owns lifecycle status, owner, acquisition source, source detail, student location, intended learning location, program interest, preferences, and inquiry details.
- Internal notes remain append-only Activity records. Contactability restrictions remain controlled by outreach outcomes. Archive remains a separate contact-level action outside the save dialog.
- The selected Contact and Inquiry edits remain one server-owned save request. Hidden-tab validation opens the relevant tab and moves focus to the invalid control.

## Interaction and hierarchy

- Tabs preserve direct switching and standard tab keyboard behavior; no Back/Next wizard controls or full-panel accordion stack is introduced.
- `Source details` is a lower-priority disclosure inside the Inquiry tab. Test, level, school, and Inquiry details are grouped under an `Additional preferences` disclosure.
- AIT USA labels are explicit: `Inquiry status`, `Inquiry owner`, `Student location`, `Intended learning location`, and `Inquiry details`. Missing inquiry data never masquerades as Contact data.
- Multiple-active-inquiry conflicts keep Contact editable while Inquiry and Inquiry preferences fail closed with an explicit review message.
- A closed selected record is labeled `Last inquiry`. Existing guarded close/reopen reasons remain required.
- AIT Signs keeps its existing editor and field ownership.

## Enrollment and destructive-action guardrails

- `Enrolled` is not offered as a normal target status in Edit profile. Starting enrollment remains the only workflow that creates the current enrollment and moves the active inquiry to Enrolled atomically.
- The Inquiry tab may route to the Enrollments workspace, but no Start enrollment form is nested in Edit profile.
- Archive or request-archive appears under a separate Contact overflow action and retains its existing confirmation and permission behavior.

## Desktop acceptance and evidence

- Primary viewport: `1440 x 1000` CSS pixels at DPR 1. Mobile redesign remains outside this slice.
- Matched before/after evidence uses the same real staging-backed Contact and shows Contact plus the populated Inquiry and Preferences states.
- Browser checks prove direct tab switching, Arrow-key tab navigation, disclosure behavior, cross-tab validation focus, no horizontal overflow, and no CRM mutation during capture.
- Focused tests lock field ownership, Enrolled-option exclusion, conflict-safe serialization, Archive separation, and AIT Signs preservation.

## Non-goals

- Adding a Contact lifecycle status, postal-address schema, inquiry resolver, new contactability controls, or editable internal notes.
- Changing lifecycle policy, enrollment schema, Archive permissions, source catalogs, or AIT Signs behavior.
- Committing, pushing, deploying, or writing CRM data before the complete Contact Detail page is accepted.

# MIS-390 Design Acceptance Contract

## Workflow model

- The existing Dashboard and Tasks controls remain the only generic task-edit entry points.
- Each generic mutation carries the `updatedAt` value loaded with that exact task.
- A current edit succeeds once and returns the next task version.
- A stale edit changes nothing and asks the employee to refresh before retrying.
- Exact follow-up completion and cancellation approval keep their existing workflows.

## Interaction and hierarchy

- No new control, dialog, queue, or task framework is introduced.
- Current edits preserve the existing pending, success, and saved states.
- A stale inline edit remains open and renders `This task changed. Refresh the queue and try again.` through the existing error region.
- Dashboard completion remains reload-backed; a rejected stale completion stays open and visible.

## Responsive acceptance

- Desktop basis: 1440 x 900.
- Mobile basis: 390 x 844.
- Existing task cards, inline edit fields, and completion controls must not change size or produce new overflow.

## Accessibility and states

- Existing pending controls remain disabled and expose their current busy status.
- Existing inline error regions continue to announce rejected updates.
- The server returns structured `task_version_required` and `task_stale_write` errors; client text tells the employee to refresh.
- A stale update emits no task event or activity event.

## Non-goals

- New task entities, version columns, or migrations.
- Changes to follow-up outcome logging or next-follow-up creation.
- Changes to cancellation or removal-approval policy.
- Recovery Queue v1.

# AIT CRM Facebook + Assignment Hotfix Acceptance Contract

## Workflow and permissions

- A regular AIT USA Coordinator can edit records already assigned to them, but cannot assign, reassign, or unassign ownership from the UI, direct API calls, or bulk actions.
- A Senior Coordinator or administrator can continue assigning AIT USA Opportunities to eligible regular Coordinators.
- An active Senior Coordinator who belongs to AIT USA can additionally assign an AIT USA Opportunity to themself; that exception does not make other Senior Coordinators, administrators, or Sales Managers eligible assignees.
- Existing ownership-change audit behavior remains intact.

## Interaction and hierarchy

- The current Senior Coordinator appears in AIT USA owner selects as `<Name> (You)`.
- Existing eligible regular Coordinator options remain unchanged.
- Existing legacy owners stay visible while editing their record so the form does not silently discard historical state.
- Contacts and Pipeline filters present `Facebook Lead Ads` and `Facebook Messenger` as separate source choices.
- AIT USA source details identify Facebook Lead Ads as a `Lead form ad`.

## Responsive and accessibility acceptance

- Desktop basis: 1440 x 900. Mobile basis: 390 x 844.
- Existing native select behavior, labels, focus order, and error regions remain unchanged.
- No new modal, warning banner, or horizontal overflow is introduced.

## Non-goals

- Meta token replacement or Meta application configuration changes.
- Automated replay, repair, or deduplication of the 65 preserved failed submissions.
- A new ingestion-degradation warning surface.
- A broader assignment-policy redesign or changes to non-AIT-USA assignment rules.

# MIS-418 Book Fulfillment Acceptance Contract

## Workflow and problem

- A verified $95 registration/book bundle creates one durable fulfillment record that staff can work without reading payment metadata.
- The authoritative policy is fixed: United States in-person students pick up the physical book; United States online students receive digital access and a shipped physical book; students outside the United States receive digital fulfillment.
- The operational worklist exposes paid bundles that still need digital delivery, pickup preparation/completion, or shipment. It is not a generic task inbox and does not move money.

## Interaction model

- `/fulfillment` is a dedicated AIT USA worklist with three action lanes: Digital delivery, Pickup, and Shipment.
- A United States online registration can appear in both Digital delivery and Shipment until both obligations are complete; it remains one fulfillment record.
- Staff may claim an item, add an operational note, mark a pickup ready or picked up, record a shipment with carrier/tracking, or mark digital access delivered.
- The registration-derived fulfillment mode is immutable in the worklist. Staff transitions progress the obligation but cannot silently change pickup, shipment, or digital policy.

## Visual direction and hierarchy

- Product-native CRM styling: compact operational cards, lane counts first, student and age second, then owner/progress and the single next action.
- Shipping addresses appear only inside shipment items and are never rendered in digital or pickup lanes.
- Pending, stale, empty, denied, and mutation-error states remain explicit. Successful mutations refresh the canonical server state.

## Locked behavior, permissions, and state

- Queue reads require CRM access and organization/business-unit scope. Mutations additionally require CRM write access.
- Address snapshots are returned only for authorized shipment-lane reads and are excluded from logs, analytics, URLs, activity messages, and provider/payment payloads.
- Duplicate registrations or callbacks produce at most one fulfillment record per payment request.
- Payment verification activates fulfillment work. Fulfillment-transition failure must not regress or roll back verified payment state.
- Overall completion is derived only when every required digital and physical component is complete.

## Responsive acceptance

- Primary desktop viewport: 1440 x 900. Regression viewport: 390 x 844.
- Lane navigation may scroll horizontally on narrow screens; work cards stack actions below content without horizontal page overflow.
- Long student names, notes, carrier names, tracking references, and address lines wrap or truncate inside the card instead of changing the page width.

## Content growth assumptions

- Lane counts may reach four digits.
- Notes may contain several sentences; the list shows bounded content while preserving the full server value for editing.
- Tracking and address values are treated as untrusted text and rendered as text only.

## Required evidence

- Policy-matrix, idempotency, transition, privacy, and permission tests.
- Full repository tests, lint, and both production builds in the warm lane.
- Rollback-only staging database proof followed by the additive migration, then authenticated staging walkthrough at desktop and mobile widths.

## Non-goals

- Changing the $95 bundle price, tax treatment, payment ledger, or Dejavoo contract.
- Customer-facing registration or portal UI; those remain MIS-421 and MIS-420.
- Shipping-label purchasing, carrier APIs, inventory management, email delivery, or automated fulfillment messages.
- Production deployment or production data writes.

# MIS-419 Staff Checkout and Collections Acceptance Contract

## Workflow and problem

- `/collections` is the AIT USA staff desk for creating a registration checkout and working balances after the request exists. It does not replace the financial-document archive.
- Due, partially paid, and overdue are derived from exact verified allocations and the immutable original due date. A partial payment never extends or rewrites that date.
- Student, payer, enrollment, charge, payment request, transaction, receipt, and fulfillment remain visibly separate records.

## Interaction model

- The primary surface is a queue-detail workspace: balance lanes and search on the left, the selected student's complete commerce trail and next action on the right.
- New checkout is a guided inline composer using the approved server-side catalog. It supports an existing or identity-matched student, a separate payer, section assignment, the locked fulfillment policy, and optional regional tuition prepayment.
- A hosted payment URL is revealed once after an explicit action. CRM persists only the safe provider origin and correlation identifier—not the URL token or card data.
- Manual payments accept only non-card methods and require auditable method, actor, amount, and reference metadata. They share ledger allocation and receipt invariants with verified provider payments without pretending to be Dejavoo.

## Locked behavior and safety

- Reads require financial read access; all checkout, hosted-link, and manual-payment writes require financial write access plus exact AIT USA scope.
- Hosted-link creation never retries automatically. A started, created, or uncertain attempt blocks another provider request until reviewed.
- Duplicate checkout and manual-payment submissions are idempotent. A replay cannot create a second payment request, provider transaction, allocation, or receipt.
- United States in-person students use pickup; United States online students use shipment plus digital delivery; students outside the United States use digital delivery.
- Production provider execution remains fail-closed and production is outside this slice.

## Responsive and state acceptance

- Desktop basis: 1440 x 900. Mobile basis: 390 x 844.
- On mobile, lanes scroll horizontally, the queue precedes detail, forms collapse to one column, and no payment reference or long student identity creates page overflow.
- Loading, empty, denied, provider-uncertain, stale, validation, and mutation failure states are explicit. Successful writes refresh canonical server state.

## Required evidence

- RBAC, queue derivation, exact-money, duplicate/retry, manual-payment, receipt, hosted-link redaction, and registration/ledger regression tests.
- Full repository tests, lint, Turbopack build, and webpack build in the warm lane.
- Authenticated staging walkthrough for desktop and mobile with synthetic data removed afterward.

## Non-goals

- Customer-facing registration or portal payment UI.
- Card entry, terminal integration, refunds, payment-plan scheduling, collections messaging automation, or production deployment.

# MIS-426 Contact Detail Receipts Acceptance Contract

## Workflow and problem

- AIT USA employees need Contact Detail to preserve verified receipt history without creating a second, weaker payment workflow beside Collections.
- The existing `Generate Student Receipt` action is mislabeled payment entry: it records an unscoped payment, permits Card without provider correlation, and bypasses charge, payer, allocation, idempotency, and receipt invariants owned by Collections.

## Interaction model and hierarchy

- Contact Detail Receipts is a read-only archive, not a payment-entry workspace.
- The Receipts tab appears for AIT USA only when at least one receipt record exists for the selected contact. A zero-receipt contact has no empty Receipts workspace or duplicate creation prompt.
- When receipts exist, the workspace has one compact archive header, one `Open Collections` route for authorized financial employees, and receipt rows showing receipt number, amount, paid date, status, available method/reference context, and `Download PDF`.
- Payment requests, checkouts, manual payments, provider payments, allocations, and receipt creation remain exclusively in `/collections`.

## Locked behavior and permissions

- Existing receipt documents and legacy payment snapshots remain readable and downloadable through the current business-unit and financial-read scope.
- AIT USA Contact Detail exposes no `Generate Student Receipt` action, payment modal, or call to the legacy payment mutation.
- AIT Signs retains its existing estimates, invoices, payments, empty states, permissions, and payment dialog.
- If a stale URL or previously selected tab points at Receipts after the last receipt disappears, the page falls back to Activity.

## Desktop acceptance and evidence

- Primary viewport: `1440 x 1000` CSS pixels at DPR 1.
- Matched evidence uses the same real enrolled AIT USA contact that currently shows the duplicate empty receipt workflow; the after state proves the zero-record tab is absent and the remaining workspace tabs do not overflow.
- Because staging contains no normalized or legacy receipt rows, populated archive rendering is test-backed rather than represented by fabricated screenshot data.

## Non-goals

- Redesigning Collections, creating contact-scoped Collections deep links, adding receipt data, changing the ledger schema, or migrating historical payments.
- Changing AIT Signs financial workflows, global navigation, receipt PDF branding, or production data.
- Committing, pushing, deploying, or writing CRM data before the complete Contact Detail page is accepted.

# MIS-426 Record Outreach / Complete Follow-up Acceptance Contract

## Workflow and ownership

- One conditional dialog serves both ad-hoc outreach and exact-task completion; its title and commit label explicitly say `Record outreach` or `Complete follow-up`.
- The route remains the authority for lifecycle changes, contactability flags, task reconciliation, appointment commitments, and profile updates. The client never performs a second mutation to complete those effects.
- Exact-task selection, stale-task rejection, business-unit scope, owner controls, and transactional writes remain intact.

## Outcome behavior

- A concise `This will…` summary states the selected outcome's lifecycle, contactability, task, and scheduling effects before submission.
- AIT USA never offers `Enrolled / won` in this dialog. Enrollment remains exclusively in the atomic Start enrollment workflow.
- `Appointment scheduled` requires an appointment date and time and creates an appointment task in the same transaction as the outreach record.
- `Do not contact` visibly explains that contactability is blocked, the inquiry moves to Not Interested, and remaining automated follow-up tasks are canceled.
- `Reached - not interested` applies the same terminal task reconciliation without setting Do Not Contact.
- `Wrong number` identifies the current phone as unusable while preserving non-phone channels.
- No answer and voicemail may schedule another attempt or explicitly leave the contact in the coverage queue without a dated task.

## Interaction and hierarchy

- The dialog remains a single outcome-focused form: result/channel, conditional next commitment, required operator note, optional inquiry preferences, then the impact summary and commit action.
- `Attempted` becomes the channel-aware optional `Number or address used` field and is hidden for in-person outreach.
- `Update inquiry preferences` appears only for plausible conversation outcomes. Primary preferences appear first; test, level, and school remain under `Additional preferences`.
- Ordinary outreach uses quiet context copy; an exact task match retains a distinct task summary.
- The required note and required appointment date/time expose accessible required, invalid, error, and focus behavior. Conditional form changes are announced with descriptive status text.

## Responsive acceptance and evidence

- Primary desktop viewport: `1440 x 1000` CSS pixels at DPR 1.
- The default, no-answer, appointment, DNC, and exact-task states fit without horizontal overflow; expanded preferences may scroll inside the dialog without moving the page.
- Matched before/after evidence uses the same real staging-backed contact states captured during the approved audit. No CRM write is required for visual verification.

## Non-goals

- Restoring direct enrollment, creating a separate appointment entity, redesigning the Tasks workspace, or changing AIT Signs lifecycle semantics.
- Sending messages, making provider calls, committing, pushing, deploying, or writing CRM data.

# MIS-426 Responsive Contact Context Acceptance Contract

## Workflow and problem

- On desktop, the AIT USA Contact Detail sidebar is visually first but appears
  after the workspace in DOM and keyboard order.
- At phone widths, Activity renders before the student identity, inquiry, and
  Next step, so employees lose essential context before acting.

## Interaction model and hierarchy

- Desktop keeps the accepted sticky left sidebar and workspace composition.
- DOM, keyboard, and visual order agree: contact context precedes the workspace
  for AIT USA.
- At `390x844`, show a compact context card before the workspace tabs containing
  student identity, inquiry status, and the exact Next step.
- Secondary contact and inquiry facts live behind one inline disclosure; do not
  use a drawer, modal, or duplicate workflow surface.
- Keep Edit profile and archive access available from the disclosed details.

## Locked behavior and semantics

- Reuse the existing current-inquiry and exact-task projections; do not create a
  second status or task model.
- Keep contactability, assignment permissions, and archive approval behavior
  unchanged.
- Label `contact.address` as **Intended learning location** for AIT USA because
  it stores the campus/Online choice, not a postal address.
- AIT Signs remains on its existing responsive and sidebar path.

## Responsive and accessibility acceptance

- Primary viewport: `1440x1000`; regression viewport: `390x844`.
- Desktop remains visually unchanged except for the semantic location label.
- Mobile shows identity and Next step before the Activity tabs without
  horizontal overflow or a nested page scrollbar.
- Remove the fixed AIT USA mobile tab-panel minimum height so short content does
  not push context unnecessarily far down the page.
- Hidden desktop/mobile variants do not create duplicate focus stops.

## Evidence and non-goals

- Provide matched before/after mobile evidence and a desktop regression capture.
- Verify DOM/focus order, zero horizontal overflow, and unchanged AIT Signs
  source path.
- Do not redesign Activity records, Conversations, Enrollments, Receipts, Edit
  Profile, or the global mobile navigation in this slice.

# MIS-426 Payments Workspace Acceptance Contract

## Workflow and problem

- The employee-facing workspace is named **Payments**. `Collections` describes
  only overdue follow-up, not registration payments, ordinary balances,
  prepayments, account credit, portal self-pay, terminal payments, receipts,
  and reconciliation.
- One authoritative payment pipeline serves every entry point and channel:
  student/payer -> charge or allocation -> payment method -> provider/manual
  confirmation -> ledger -> receipt.
- A front-desk employee may start **Take payment** from Payments by finding the
  student, or from Contact Detail with the student preselected. Both paths use
  the same server actions and accounting invariants.

## Interaction model and visual direction

- Product-native CRM styling is the visual authority; the approved staging
  audit screenshots are used in inspiration mode, not as a faithful reference.
- Payments exposes two primary intents: **Take payment** and **New
  registration**. Open balances, Overdue, Recent payments, and Reconciliation
  remain operational views below those entry points.
- A sequential composer is justified because money movement is consequential:
  **Student & payer**, **What this payment covers**, **Payment method**, then
  **Review & confirm**. Contact Detail deep links skip already-known student
  selection without creating a second workflow.
- Payment intent and payment method remain separate. Existing balance, a real
  future installment, account credit, or registration/book purchase may use a
  secure link, physical terminal, or supported non-card method.
- On compact screens, the composer, queue, and detail are mutually exclusive
  workspaces rather than one long stack. Search occupies its own row and no
  lane, identity, or reference may widen the page.

### Visual consistency polish

- The existing CRM shell, tokens, typography scale, and eight-pixel surface
  radius are the visual authority. Payments must read as another operational
  CRM workspace rather than a separately branded mini-product.
- `Take payment` is the single filled-blue launch action. `New registration`
  remains an outlined secondary action, while the green provider-security card
  remains visible as a durable trust guarantee.
- Selected Payments workspaces use the theme-aware CRM accent instead of a
  hard-coded near-black treatment. Semantic success, warning, and danger colors
  remain reserved for their existing financial states.
- The page uses the standard CRM title scale without a decorative money-
  operations eyebrow. Refresh belongs to the workspace toolbar, not the global
  page header.
- Launch actions disappear while the sequential payment composer is active so
  the current financial task owns the viewport. Empty states use content-sized
  spacing rather than a tall blank panel.
- On mobile, the workspace rail keeps its horizontal behavior but exposes a
  visible overflow cue, and the refresh label may collapse while retaining an
  accessible name.

## Locked financial behavior and permissions

- Financial read/write permissions and exact AIT USA business-unit scope remain
  server enforced. AIT Signs and portal payment authorization are unchanged.
- Existing or future charges may receive a full or partial amount no greater
  than their verified remaining balance. A future installment is selectable
  only when a real future-dated charge exists; the UI never invents a schedule.
- Account credit is an explicit unapplied allocation with a durable payment
  request, verified transaction, receipt, and activity trail. It is never
  represented as a fake charge.
- Payer may differ from student, but both contacts must resolve inside the same
  organization and business unit.
- Hosted-link and terminal attempts remain mutually exclusive. Unknown terminal
  outcomes lock another payment attempt until bounded recovery resolves them.
- Card data never enters CRM. Manual collection is limited to supported
  non-card methods and requires the existing audit/reference rules.
- Refunds, reversals, chargebacks, voiding, and split-tender orchestration remain
  read-only/escalation states until a dedicated allocation policy is approved.

## Responsive and accessibility acceptance

- Primary viewport: `1440x1000`; regression viewports: `1024x768` and
  `390x844`.
- The guided flow exposes current step, completed context, validation errors,
  disabled/pending actions, terminal readiness, and unknown/recovery states in
  text as well as color.
- Searchable student selection is keyboard operable, labels remain explicit,
  conditional content is announced, and focus moves to the first invalid field
  or the next step heading.
- Long names, emails, references, and descriptions wrap or truncate inside
  their containers with zero horizontal page overflow.

## Required evidence

- Focused tests cover payment-intent normalization, charge/balance validation,
  account-credit allocation, payer scope, idempotency, portal/provider
  regression, direct Contact Detail entry, and responsive source contracts.
- Run the selected `ui` and `schema-api` validation profiles plus the webpack
  production build fallback for the known worktree/Turbopack limitation.
- Capture matched desktop and mobile states using authenticated staging-backed
  identities without submitting CRM or provider writes. Populated financial
  states that staging lacks remain explicitly test-backed acceptance debt.

## Non-goals

- New installment scheduling, refund allocation, chargeback operations,
  split-tender settlement, production provider execution, or production deploy.
- Changing portal self-pay authorization, Dejavoo credentials, receipt PDF
  branding, Book Fulfillment policy, or AIT Signs financial workflows.

# MIS-426 Book Fulfillment Shell Acceptance Contract

## Workflow and problem

- AIT USA staff need to see whether any verified bundles require digital delivery, pickup preparation/completion, or shipment, then enter the correct operational queue without interpreting a separate mini-design system.
- The existing page uses three oversized lane cards, repeats the selected lane title and description, gives Refresh page-level visual priority, and renders a large lane-specific empty panel even when every lane is clear.
- On mobile, the horizontally scrolling lane cards visibly clip the next lane without an explicit workspace cue and consume most of the first viewport.

## Interaction model and visual direction

- Book Fulfillment remains a queue workspace with three random-access lanes: Digital, Pickup, and Shipment.
- Compact CRM-blue tabs carry the canonical lane labels and counts. The selected lane owns one worklist panel; lane descriptions live in that panel rather than being repeated inside navigation.
- When all three counts are zero, one page-level all-clear state replaces the selected-lane panel. Staff can still inspect the compact lane tabs, but do not see three conceptual empty states.
- When any lane contains work, selecting a lane shows its existing queue and lane-specific empty state when appropriate.
- The address-privacy rule appears only beside the selected Shipment address. The global Scope row is removed because the persistent division selector already establishes AIT USA context. Refresh moves into the worklist/all-clear toolbar.
- Reference mode: inspiration from the accepted Payments and Contact Detail CRM shell. Existing AIT CRM typography, blue accent, neutral surfaces, 8px radii, and button hierarchy are authoritative.

## Locked behavior, permissions, and state

- Fulfillment policy, verified-payment activation, Digital/Pickup/Shipment eligibility, counts, pagination, assignments, notes, tracking, transitions, stale-write protection, address privacy, RBAC, and business-unit scope remain unchanged.
- Shipment addresses continue to be returned only for the Shipment lane.
- Populated work-item cards remain functionally unchanged in this slice; their queue/detail redesign is the next element group.
- Loading, denied, and fatal error behavior continue to use PageState.

## Responsive and visual invariants

- Primary viewport: `1440 x 1000` CSS pixels.
- Regression viewports: `1024 x 768` and `390 x 844`.
- Desktop places title/context first, compact lane tabs second, and one worklist/all-clear surface third.
- Mobile keeps title, lane tabs, and the beginning of the workspace inside the first viewport. Shipment privacy context appears only when its protected address is visible. The lane row provides a visible horizontal-scroll cue without clipping page content.
- No horizontal page overflow, nested scrollbar, duplicated selected-lane description, or oversized empty panel.

## Evidence required

- Matched desktop and mobile before/after screenshots using authenticated staging-backed reads.
- Focused component/source tests for all-clear versus lane-specific empty behavior, navigation semantics, Refresh placement, and locked populated-item rendering.
- UI validation profile: targeted tests, full ESLint, webpack production build, and read-only browser smoke with zero write requests.

## Non-goals

- Work-item queue/detail redesign, search, assignment filters, bulk actions, confirmation dialogs, policy changes, schema/API/service changes, or new fulfillment integrations.
- AIT Signs fulfillment changes.
- Commit, push, staging deployment, production promotion, or CRM writes before Alvaro accepts the page candidate.

# MIS-426 Book Fulfillment Work Item Acceptance Contract

## Workflow and problem

- AIT USA fulfillment staff need to scan active work, choose one record, understand its truthful current stage, and complete the next safe action without editing every record at once.
- The existing populated state renders every item as a full editable card. Notes, tracking fields, ownership, metadata, and completion actions compete for attention; mobile stacks these work forms into one long page.
- Completion actions immediately remove records from the active queue without first stating the consequence.

## Interaction model and visual direction

- The approved Book Fulfillment shell and Digital / Pickup / Shipment lanes remain authoritative.
- Each populated lane renders a compact queue of selectable rows. A row shows student, human-readable stage, waiting time, and a selection chevron. The primary action lives only in the selected detail. Assignment remains a backend concurrency/audit concern rather than primary queue content.
- Desktop uses a queue-and-detail workspace. Selecting a row reveals one dedicated work-item panel beside the queue; only that record exposes address, tracking, note, assignment, and workflow actions.
- Mobile shows one surface at a time: queue first, then the selected work item with an explicit Back to queue action. It must not stack multiple editable work items.
- The selected work item has one primary next action based on lane and stage. Explicit Claim is removed from the UI; the existing server action auto-assigns the acting employee when operational work is completed. Save note remains secondary, and Operational note uses progressive disclosure unless it already contains content.
- Student identity links directly to Contact Detail. Raw status strings are replaced with human-readable stage copy.
- `Mark ready` remains immediate because the item stays active. `Confirm access sent`, `Mark picked up`, and `Mark shipped` open an outcome-focused confirmation that states the item will leave the active queue after success.
- Digital delivery is currently manual. The Digital lane remains as a temporary operational obligation, but its stage and confirmation must say `Needs manual delivery` and `Confirm access sent`. The confirmation explicitly requires the employee to have sent or granted access outside the CRM; the CRM only records completion.
- Presentation simplification: remove the duplicate global scope row, localize privacy copy to Shipment, omit lane-name eyebrows from selected details, and show a detail stage badge only for Pickup where it communicates real progression. Exact payment-verification timestamps stay out of the primary workspace; waiting age remains visible. The Digital manual-handoff prerequisite is a quiet inline rule rather than a competing information card.
- Reference mode: inspiration from the accepted Fulfillment shell and CRM operational workspaces. Existing typography, CRM blue, neutral surfaces, eight-pixel radii, and semantic colors remain authoritative.

## Locked behavior, permissions, and state

- Fulfillment policy, verified-payment activation, queue eligibility, ordering, counts, pagination, assignment, notes, tracking requirements, transitions, stale-write protection, address privacy, RBAC, and business-unit scope remain unchanged.
- Existing mutation actions and payloads remain canonical: claim, save note, mark digital delivered, mark ready, mark picked up, and mark shipped. The standalone claim action stays supported by the backend but is not exposed in this worklist.
- Shipment address remains available only in Shipment. Carrier and tracking remain required before shipment completion.
- Existing automatic claim-on-operational-action behavior remains; the selected-item UI must not invent a separate ownership mutation.
- The confirmation is a client-side consequence boundary, not a second server mutation or a new approval state.

## Responsive and accessibility acceptance

- Primary viewport: `1440 x 1000` CSS pixels. Regression viewports: `1024 x 768` and `390 x 844`.
- Queue rows are keyboard selectable and expose selected state. Desktop visual, DOM, and focus order remain queue then detail.
- On mobile, opening an item moves focus to the work-item heading; Back returns focus to the originating row.
- Confirmation uses dialog semantics, traps focus, identifies the exact student/action, and returns focus to the triggering action when canceled.
- Error feedback remains announced, saving state disables duplicate actions, and long names, notes, addresses, carriers, and tracking references do not create horizontal overflow.

## Evidence required

- Focused tests cover row/detail selection, manual-digital language, absence of explicit ownership controls, one primary action per state, Contact Detail linking, note disclosure, completion confirmation, and mobile queue/detail behavior.
- Existing model, route, service, shell, and workflow tests remain green; run full ESLint and the webpack production build.
- Render populated Digital, Pickup pending/ready, and Shipment fixtures without CRM writes at desktop and mobile viewports. Also run one authenticated staging-backed empty-state regression because staging contains no fulfillment records.

## Non-goals

- Completed-history UI or query, search, My work, owner filters, SLA/Needs attention, bulk actions, packing lists, labels, pickup identity capture, or notification delivery.
- Sending digital access, pickup-ready messages, or shipment notifications. Automatic digital delivery and exception recovery require a separate provider/portal capability; this worklist must not imply they exist.
- Fulfillment schema, policy, route, service, or provider changes.
- Commit, push, staging deployment, production promotion, or CRM writes before Alvaro accepts the page candidate.

# MIS-426 Contacts Final Column And Action Alignment Contract

## Workflow and problem

- AIT USA employees need to scan identity, lifecycle stage, responsibility,
  source, recent contact history, and the next truthful step before acting.
- The current directory separates the contextual workflow action from `View`
  by 55 px at the primary office viewport, which reads like a missing Edit
  control. First-outreach rows also repeat the same state in the label, detail,
  and action.

## Interaction model and visual direction

- Reference mode: faithful refinement of the accepted live Contacts directory;
  retain its design system, toolbar, density, sticky header, filters, and 57 px
  rows.
- Desktop order is locked to `Contact | Stage | Owner | Source | Last Touch |
  Next Step | Actions`.
- `Stage` communicates lifecycle position; `Next Step` communicates what should
  happen now. Next Step is informational and contains no button.
- The final Actions cell owns one compact right-aligned button group. The
  contextual workflow action appears first and `View` second, with an 8 px gap.
- Contextual action labels remain `Start outreach`, `Record outreach`, and
  `Record follow-up`; they all reuse the existing outreach-recording flow.
- Redundant first-outreach detail is suppressed when the state label and action
  already communicate the same fact.

## Locked behavior, permissions, and state

- Rows remain non-interactive. `View` is the only directory navigation control;
  AIT USA exposes no directory Edit action.
- Existing task/commitment authority, blocked-contact behavior, Retargeting
  semantics, permissions, API routes, and optional scheduling inside the
  outreach outcome flow remain unchanged.
- Closed or otherwise ineligible rows show only `View` in Actions.

## Responsive and visual invariants

- Primary viewport: `1920 x 1080` CSS pixels.
- Regression viewport: `1536 x 960`; mobile receives an obvious-regression
  check only.
- Both action buttons remain visible on one line at primary and regression
  widths with no horizontal page overflow.
- Long source and contact content remains truncated within its column; adding
  optional secondary columns may revert to the existing scrollable auto-layout.

## Evidence required

- Focused source/state tests cover column order, Stage naming, text-only Next
  Step, per-row contextual Actions, View-only ineligible rows, and spacing.
- Run the `ui` validation profile: targeted tests, ESLint, webpack production
  build, and authenticated browser smoke.
- Capture primary and regression screenshots from canonical staging without
  submitting CRM data.

## Non-goals

- Changes to workflow state derivation, scheduling policy, APIs, schemas,
  permissions, filters, toolbar behavior, mobile redesign, or production.

# MIS-426 Tasks Unified Queue Composition Contract

## Workflow and problem

- Employees need one obvious work surface for scanning due work, understanding
  ownership and contact context, and taking the next safe action.
- The accepted Tasks features are individually correct, but the directory reads
  as six similarly weighted bands: workload metrics, owner alert, queue label,
  filters, bordered task cards, and completed history. Multiple filled-blue
  actions and repeated borders fragment the page even though the major type
  scale already matches Contacts and Pipeline.

## Interaction model and visual direction

- The queue becomes the dominant page surface. Its header owns the read-only
  workload metrics, unassigned-owner context, approval entry point, and Reset.
  Due, Owner, and Task Type remain directly beneath that header.
- Active tasks render as divider-separated rows inside the queue surface, not
  cards inside a card. Overdue meaning stays on the due value rather than a red
  structural rail.
- `New Task` is the only default filled-blue page action. `Log outcome` and
  `View unassigned` are secondary outlined actions; approval decisions retain
  their existing semantic treatment.
- Default `Open` status is omitted because membership in the active queue
  already communicates it. Non-default task states, priority, type, recurrence,
  due date, contact context, and ownership remain visible.
- Owner assignment stays inline for authorized coordinators, but uses the same
  compact control scale as the row actions.
- Reference mode: faithful consolidation of the accepted Tasks workflow using
  the dominant-surface and row-divider patterns already established by upgraded
  Contacts and Pipeline.

## Locked behavior, permissions, and state

- `Log outcome -> Contact -> More`, task title navigation, Task Detail,
  cancellation approval, archive approval, edit/complete/cancel behavior,
  filters, business-unit scope, RBAC, stale-write protection, API routes, and
  mutation payloads remain unchanged.
- Workload metrics remain read-only and do not become filters.
- Unassigned follow-up eligibility and Facebook counts remain truthful; only
  their presentation moves into the queue header.
- Completed-today history remains available below active work.

## Responsive and accessibility acceptance

- Primary viewport: `1920 x 1080` CSS pixels. Regression viewport:
  `1536 x 960`; `390 x 844` receives a contained reflow check.
- Queue header content may wrap without overlap. Active rows preserve readable
  source order and all controls remain keyboard reachable with no horizontal
  page overflow.
- The semantic workload `<dl>`, filter labels, task article boundaries, control
  names, focus behavior, and live error messaging remain intact.

## Evidence required

- Focused tests cover integrated queue metrics/context, absence of standalone
  alert and nested task-card treatments, conditional non-default status, and
  secondary row actions while preserving existing workflow access.
- Run repository contract, complete tests, the follow-up workflow suite, full
  ESLint, and the webpack production build.
- Capture matched immediate-before and canonical-staging after screenshots at
  `1920 x 1080`, plus `1536 x 960` and narrow-layout regressions, without CRM
  writes.

## Non-goals

- New task states, filters, metric interactions, bulk actions, sorting,
  pagination, backend/schema/service changes, permission changes, Task Detail
  redesign, production promotion, or CRM data writes.
