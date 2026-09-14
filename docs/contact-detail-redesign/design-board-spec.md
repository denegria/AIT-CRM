# Revised board contract — September 11, 2026

Issue: [MIS-408](https://linear.app/mission-control-v2/issue/MIS-408/ait-crm-detailed-contact-workspace-redesign-preserved-tabs-direct).

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

## Approach

Revise the selected artwork; do not start another visual exploration. Keep the white/navy/blue product language, restrained dividers, existing typography/icon character and focused editors. The owner considers the interface sufficiently simplified. Further changes must improve a specific operator job, not add decoration or another context panel.

The three revised images are states of one design, not alternatives. They are fictional-data concept art generated with the built-in image tool from the original supplied boards. They are not runtime screenshots, measured layouts or proof of interactions. Original images remain available as historical style references, but their three-tab consolidation and coupled source operation are superseded.

## Board 01 — Record workspace

[Revised Record image](01-contact-workspace-v3.png)

- Desktop reference: 1440×1000; no phone inset. The fictional contact has conditional linked work, so Work Orders is applicable.
- Preserve existing global sidebar. One identity header, compact next-task band and one local tab row. No duplicate profile sidebar or repeated review-context grid.
- Tab row: Record, Activity, Conversations, Enrollments, Receipts, Work Orders for the illustrated USA state. Signs uses its existing applicable Financials/linked Contacts or People destinations; do not apply student labels to Signs.
- Record contains Contact & preferences and the correctly resolved opportunity only. Enrollments/receipts render inside their own tabs, not duplicate overview collections or gateway links.
- Contact source and Inquiry source have distinct labels; corrections live inside their respective editors, not prominent Correct source links in Record. Display actual values only, Unknown when absent. Do not claim stored contact source is immutable first-touch truth.
- Contact channels, relevant restrictions, intended learning location, last touch and last edit retain one main display. Phone-history/provenance disclosures remain available. Show last-edit author only when verified data exists; never infer it from owner/current user.
- Opportunity owns status/owner/program/inquiry date and qualifications. Placement evidence remains read-only and separate from editable education level. If both inquiry title and program encode the same fact, a concise program/title subline can replace duplicate rows; preserve source/date provenance.
- Change owner/status opens the same opportunity editor at Ownership & status. Retain a general Edit entry within Current inquiry for program/qualification corrections even if an image omits it. A read disclosure such as More inquiry details is not an unlabeled substitute for editing.
- Restriction warnings live beside relevant channels/actions, including outside Record when acting in Conversations or follow-up. Do not invent a warning in the normal reachable mock just to advertise this feature.

## Board 02 — Scoped editing

[Revised editor image](02-focused-editor-v3.png)

- Desktop comparison sheet of two separate editor examples, not simultaneous modal layers or a combined multi-entity form.
- Inquiry example: exact selected inquiry in the title/subtitle; Inquiry details / Ownership & status / Source section index; Source selected to explain changed attribution scope. Source Detail and original submission evidence remain distinct.
- Copy: **Updates this inquiry only. Contact source stays unchanged.**
- Contact-only example: name/email/phone/intended learning location/Contact source; no opportunity lifecycle or owner fields. This example explicitly covers a legacy contact without an opportunity.
- Copy: **Updates this contact only. No inquiry is created.**
- Independent examples can show different valid relationship states for illustrative purposes; they do not imply two dialogs open together or two simultaneous drafts on one contact.
- Each editor has one Save/Cancel footer and visible unsaved/error feedback. Failed saves retain drafts. Closed status changes retain existing reason rules; no stacked dialogs or hidden second source-save mode.
- The old generic `source` PATCH is not the new contract. The server must enforce independent write effects before these labels ship.

## Board 03 — Populated Enrollments tab

[Populated Enrollments image](03-enrollments-workspace.png)

- Same contact workspace shell/style and one selected Enrollments tab; real records render immediately inside it.
- Multiple distinct active courses are visible with useful course/teacher/location/start-date context. Row actions name the target record; Complete/End open the existing contextual confirmation/editor rather than mutating on selection.
- One Add enrollment primary action and one Add history secondary action, not three duplicated CTAs across summary/toolbar/empty state.
- Historical rows retain dates/status and a selected-record inspector or inline disclosure. Notes/outcome are tied to that exact enrollment, not the contact in general.
- Preserve saved-section/manual modes, all course fields/statuses and duplicate-active validation even when not drawn.
- No gateway Manage button, external navigation prerequisite, invented attendance feature, new attachments or copied contact summary inside the tab.
- Optional existing full-detail destinations may be linked with return state; do not build a new page merely to make the mock navigable.

## Other tab states — mandatory implementation contract

These are not separately illustrated in this revision; they remain required and must be captured on the implementation before acceptance.

| Tab | Populated state and direct actions | Empty/blocked state |
|---|---|---|
| Activity | One filter family, event history/links, independently reachable Add note; distinguish persistent profile details from chronological notes. | Empty history still permits authorized notes. Loading/error does not unmount a draft or become zero events. |
| Conversations | Message history/body and disclosed metadata; admin templates/custom composer under existing channel/consent policy. | Senior can read without composer. Explain send readiness/denial and failed history separately. |
| Receipts | Number/date/amount/status; direct Download PDF for saved records and Generate student receipt for eligible users. | Explain existing Enrolled eligibility; do not invent a course-existence requirement. Save success with download failure offers Download again against the saved financial ID. |
| Work Orders | Title/number/due/status and exact Open; existing Create Work Order route; Signs invoice/payment actions when permitted. | Preserve current conditional USA applicability and authorized creation. Existing dedicated work-order workflow remains valid; no new redirect-only tab. |
| Financials (Signs) | Existing estimate/invoice/payment types, line items, linkage, balance previews and PDF actions. | No receipt-only filtering or student eligibility on Signs. Preserve allowed creation even without existing documents. |
| People / linked Contacts (Signs) | Named people, role/primary marker, channels, notes; add/edit/primary/remove. | Empty list still offers authorized Add linked person. Account identity is not replaced by a person's fields. |

## Additional conditional states

- **No active inquiry:** quiet normal Contact view/source editing, permitted history/resources and a secondary Start inquiry action only for an actual new business relationship. No forced backfill or blank fictitious current opportunity.
- **Closed-only:** Last inquiry (closed), not Current inquiry. Preserve allowed transitions/reasons; new relationship creation is explicit.
- **Multiple active conflict:** visible conflict; do not claim a newest lead is the current truth. Preserve independently authorized contact operations and deny ambiguous opportunity mutations.
- **Multiple tasks:** deterministic eligible-task selection, exact incoming links and View tasks. A stale explicit task never silently becomes another task.
- **DNC/wrong phone/history-only number:** preserve normalized restrictions and adjacent explanations; historical numbers are not promoted into active outreach destinations.
- **Denied, failed, loading, empty, ready:** distinct per resource. Show zero counts only after a successful authorized read; never derive workload counts from historical events.

## Small visual refinements — no new design system

1. Use aligned property rows and quieter secondary metadata. Avoid cards nested in cards.
2. Keep the identity/task header compact so populated tab content remains visible on normal desktop heights. Use one clear primary action per context, not several identical blue buttons competing inside the same toolbar.
3. Use consistent action verbs: Add enrollment, Add history, Generate receipt, Download PDF, Change owner/status, Edit. A disclosure reads View details; a mutation opens an explicitly labeled editor.
4. Preserve selected tabs, filters, resource selection and scroll on return. Use stable IDs, never label/name matching.
5. Do not duplicate program information as both an inquiry-type field and identical program row without a reason; use one informative title and retain distinct data only.
6. Keep focus, visible labels, associated errors and announced save outcomes. At compact desktop/zoom, wrap or adapt tabs without hiding required destinations behind a new nested menu system.

Desktop-first at 1440×1000 and 1280×800. Basic narrow-width smoke preserves legibility and reachable actions, not a new mobile-optimization project. Actual UI acceptance needs rendered desktop, keyboard/zoom and bounded responsive evidence, plus operator task walkthroughs; generated artwork cannot pass those checks.

The v3 editor artwork labels the existing Source detail field “Inquiry source detail”; this is not an extra input or a storage change. The original 18-field ledger still governs.

## Generation and review record

Built-in image generation was used, with the original Record/editor images attached as references and the revised Record image used to align the populated tab state. Prompts specified the retained style, exact tabs, fictional names/dates, independent source scopes, no gateway navigation and no new platform features. Original prompts are retained in [board-prompts.md](board-prompts.md); the current v3 edits use [inquiry-board-prompts.md](inquiry-board-prompts.md). The publication packet records image inspection and any remaining artwork limitations.
