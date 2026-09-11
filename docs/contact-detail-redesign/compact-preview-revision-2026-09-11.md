# MIS-409 — compact contact preview and collapsible navigation

## Authority and current status

Alvaro requested this revision on September 11, 2026 at 14:52 UTC after reviewing staging. It **supersedes the top-to-bottom Record composition and oversized scale** of the earlier v3 boards. The previous visual pass remains historical evidence, not acceptance of this new direction. Implementation is authorized; automated validation precedes the normal staging Git push, followed by live QA and in-scope correction. Production is not authorized.

Delivery: [MIS-409](https://linear.app/mission-control-v2/issue/MIS-409), within [MIS-408](https://linear.app/mission-control-v2/issue/MIS-408). No new style-selection round or backend redesign is needed.

## Layout and information ownership

At desktop 100% browser zoom, use two left-side areas and an operational main pane:

1. **Global app navigation:** compact icon rail, approximately 64px. Pointer entry, keyboard focus or an explicit control opens its approximately 232px labeled menu as an overlay, without moving the workspace. Selecting a destination collapses it; it can reopen on re-entry. Keep accessible names and all division/role visibility rules. Preserve scope, theme and account controls. Touch and keyboard must not require hover. Existing mobile navigation remains usable.
2. **Contact preview:** persistent approximately 280–300px secondary rail on AIT USA detail. Compact identity/contact information, restrictions, inquiry status, coordinator, program and next follow-up are available at a glance. Keep contact and inquiry facts clearly separated. Put lower-priority preferences, provenance and longer notes in labeled groups/disclosures, not additional navigation pages. Preview remains present while switching operational tabs.
3. **Main work area:** **Activity** by default, **Conversations**, **Enrollments**, **Receipts**, plus existing applicable Work Orders, Financials and linked People surfaces. Do not show a separate Record tab. Activity is chronological notes/outreach/events; the preview owns current facts. Related tabs show records and actions directly, not gateway-only Manage buttons.

Use compact normal CSS dimensions, around 14px body text, 20–24px principal headings and 32–36px desktop controls. Reduce the large avatar/header and eliminate the oversized empty next-work band. Do not simulate density with CSS zoom or transforms. Long content must wrap or scroll within its own pane; no document-wide horizontal overflow. At narrower widths, stack or disclose the preview without hiding essential identity or trapping navigation.

## Preserved workflows

- **Create follow-up and every existing follow-up action retain their current behavior.** The user explicitly excluded that behavior from this revision.
- Preserve direct, permission-gated status/owner actions and the existing separate Contact/Inquiry editors. Contact maintenance works without an inquiry; inquiry writes retain exact selected lead identity.
- Preserve all original profile inputs, source fields, previous numbers/restrictions, placement evidence, provenance, persistent notes, chronological notes, archive approvals, receipts, enrollment/history row actions and return/deep-link behavior. A disclosure may relocate a fact, not remove it.
- Retain quiet legacy/no-inquiry, closed-only and conflict states. Never invent inquiry history or student classification.
- Existing independent source saves and the Unknown fallback fix remain intact. No data model/schema migration, data backfill, role-policy change, provider send or database QA write is part of this layout revision.
- Shared global navigation interaction applies to the CRM shell. The contact preview and student vocabulary are USA-specific; preserve AIT Signs detail semantics and capabilities.

## Acceptance checks

- Verify actual deployed commit and current authenticated browser, at normal zoom and desktop widths 1440/1280 (or equivalent measured content widths).
- See key identity/contactability, current status/owner/program and next work without scrolling through a full-page Record.
- Activity is the default and no USA Record tab exists. Preview persists across Conversations/Enrollments/Receipts.
- Global rail expands on hover/focus or explicit control and collapses after choosing a route. Re-entry works; opening it does not reflow content. Keyboard Escape/focus and touch access remain usable; no focus is stranded in hidden controls. Scope/select interaction must not unexpectedly collapse the menu.
- Test long labels, notes, no-inquiry/closed/conflict fixtures, and populated enrollment/history row targeting. Browser-only fixtures must be clearly identified; no persisted test data.
- Check desktop table widths, compact viewport, mobile navigation, dialogs and no document overflow. Do not drop useful facts merely to hit a narrow width.
- Run required `npm run validate` and meaningful focused interaction checks. Push validated code to staging, wait for exact Vercel Ready/CI, then live-check and repair actionable failures without another approval round.
- Record limitations precisely: visual fixtures do not prove real regular-account access or persisted saves. Keep broader parity coverage separate from this layout acceptance.

## Evidence

Baseline captured from authenticated staging September 11 after the user review. Private screenshots stay outside this public repository. New implementation/render evidence and exact commit are recorded in the release QA report when completed.
