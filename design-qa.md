# MIS-409 design QA

## Authorized delivery sequence

On September 11 Alvaro clarified: automated validation (tests, lint, build) precedes staging Git push; authenticated visual QA runs against the resulting live staging deployment. A local-preview browser restriction is not a pre-push gate. Visual acceptance remains required before this issue is complete.

## Comparison targets

- Record: `docs/contact-detail-redesign/01-contact-workspace-v3.png`, 1506×1045 pixels.
- Editors composite: `docs/contact-detail-redesign/02-focused-editor-v3.png`, 1586×992 pixels.
- Enrollments: `docs/contact-detail-redesign/03-enrollments-workspace.png`, 1505×1045 pixels.
- Browser: authenticated senior AIT USA, Light, 1506×1045 CSS pixels. Reference and implementation opened together per state. Composite editor board is compared to the actual modal region, not its backdrop. Real missing values and permission-conditional navigation must remain truthful; fictional board values are not inserted into CRM.

## Deployed comparison at 253307c

Exact browser appVersion matched 253307c5f24db3082e56896c595f568a7671f9d5. Git-triggered Vercel deployment and GitHub CI were Ready/passed. Private screenshots and detailed evidence live outside the public repository in the workspace artifact report `artifacts/ait-crm-design-fidelity-20260911/live/qa.md`.

1. Flat sections and underline tabs now render, but P2 pill controls and shadows remain: CSS Module selectors mistakenly hash literal global button classes.
2. P1 Contact editor remains wide with sidebar and two-column identity fields rather than the selected compact single-column editor. Intended literal editor selectors suffer the same scoping error.
3. P2 Contact source is positioned in the right column and Date opened last, inconsistent with the selected Record board. Header/avatar, typography, spacing, and white surface also need the measured correction.
4. P2 empty enrollment history duplicates the Add enrollment action with Start Course.
5. Populated Enrollments is not verified: a bounded read-only check of 19 currently enrolled directory contacts found no course records, and the attendance class list was empty. This does not prove no populated contact exists anywhere.

A focused correction is in progress. Capture its exact deployed version and compare the same states again before passing.

## Remaining acceptance

- Post-fix Record and scoped Contact/Inquiry comparison.
- Populated Enrollments and history/action comparison.
- Regular-coordinator live role coverage and persisted source-save/reload coverage remain separately outstanding; read-only senior QA does not establish them.
- Preserve AIT Signs styling and functional permissions.

## Final result

final result: blocked

This is an acceptance status, not a prohibition on the authorized staging deployment.
