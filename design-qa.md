# MIS-409 design QA

## Current revision — compact preview and navigation

**In progress; not yet accepted.** Alvaro’s September 11 14:52 review replaces the old top-down Record layout with a compact two-rail workspace. The governing [revision contract](docs/contact-detail-redesign/compact-preview-revision-2026-09-11.md) supersedes the prior visual target. New evidence will be added after deployment and live checks.

## Previous revision result (historical)

previous visual result: passed

This passes the returned **visual correction** in the reviewed Record, Contact editor, Inquiry editor, and populated Enrollments/history states. It does not claim completed regular-account authentication or persisted database-save testing.

## References and deployment

- Record: docs/contact-detail-redesign/01-contact-workspace-v3.png,1506×1045.
- Editors: docs/contact-detail-redesign/02-focused-editor-v3.png,1586×992 composite.
- Enrollments: docs/contact-detail-redesign/03-enrollments-workspace.png,1505×1045.
- Reviewed application commit:1e34fb9908c6e945c23ef85901da9ca2eb798b40.
- Canonical live staging, authenticated AIT USA senior session, Light,1506×1045. Browser appVersion independently matched exact SHA.
- Git-triggered Vercel dpl_2QVyjxCiBNRNsHXvknX3FZuXQbeA Ready; GitHub CI34606847944 passed.
- Full validation:747 standard +74 focused =821 passing,2 skipped; repository contract, lint/build passed.
- Reference and corresponding final browser image opened together for each state; editor comparison uses modal region rather than backdrop.
- Private screenshots/report outside public repository: workspace artifacts/ait-crm-design-fidelity-20260911/live/1e34fb9-*.png and qa.md. No customer screenshots or credentials committed.

## Verified corrections

1. Record: flat white sections, aligned property rows, selected field order,80px avatar, underline tabs,44px header/task controls, quiet contextual Edit.
2. Contact:590px single-column dialog, five46px inputs in selected order, readable labels, source scope note. Archive remains available through More actions and separate confirmation.
3. Inquiry:870px dialog; Inquiry details, Ownership & status, Source; full-width source selector, scope helper directly below, source-detail textarea. Contact identity fields absent. Original submission derives only from actual submission evidence; reviewed record truthfully shows absent state.
4. Enrollments: full-width1198px current/history tables; identical header tracks; direct Edit/Complete/End; single Add enrollment/Add history; history-only count; row-specific expand/collapse and compact outcome/notes/Edit history.
5. Populated check used three fictional browser-memory-only GET-response fixtures:two active and one completed, including classSection=null. No DB fixtures or writes. Previous null scheduleDays crash reproduced before correction and did not recur.
6. Actions opened correct course/status forms; history Edit selected the historical course rather than an active record. Cancel made no requests or changes; browser errors empty.
7.390px smoke:document width390; tables scroll inside containers; Inquiry stays within viewport and Escape closes. Hard navigation removed fixture and restored real Record/zero-course state.

## Scope boundaries and P3 follow-ups

- Existing shared sidebar, permission-conditional tabs, real missing values, and empty next-work state remain truthful rather than copying fictional board content.
- P3 only:existing Current versus Active wording, ISO date formatting, singular record-count copy, and small shared-font/token differences. No remaining P0/P1/P2 visual finding in reviewed states.
- Regular-account live access and persisted source save/reload remain separately unverified. Server-route tests cover assignment ownership and isolated source update/clear behavior; browser fixture is not evidence of DB persistence.
- AIT Signs styles remain outside USA-scoped edits. No production promotion, DB migration/write, or provider send. Full MIS-409 functional acceptance remains separately tracked.
- Authorized sequence: automated checks → staging Git push → automatic deployment → live visual QA → repair/redeploy/recheck. Local-preview access is not a pre-push blocker.
