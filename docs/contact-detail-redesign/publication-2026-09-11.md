# Inquiry refinement publication — September 11, 2026

Issue: [MIS-408](https://linear.app/mission-control-v2/issue/MIS-408/ait-crm-detailed-contact-workspace-redesign-preserved-tabs-direct). First implementation slice: [MIS-409](https://linear.app/mission-control-v2/issue/MIS-409/ait-crm-contact-workspace-s1-readable-record-retained-tabs-and-inquiry), Todo.

## Scope and authority

Alvaro approved simpler inquiry presentation and requested updated staging docs/Linear plus recommendations for other CRM pages. Fresh documentation candidate from staging `e8e645af49cc40bad5a365e212a61c97b4a0957d`. Changes stay inside this documentation directory; no application code, schema, dependencies, CRM records, messages or production changes.

Handoff, parity/CSV, board specification and README now govern Current inquiry → Edit, header Edit contact, source correction inside scoped editors, quiet legacy states, consistent AIT USA Pipeline terminology and evidence-based student-history semantics. Internal opportunity identifiers/policies remain. All 56 tracked rows and all original field requirements remain unimplemented/unexercised.

## Artwork

- [Record v3](01-contact-workspace-v3.png): inspected; Current inquiry, Edit, Status/Owner, Inquiry source; no prominent source-correction shortcuts. Existing tabs/actions/fictional values retained.
- [Editors v3](02-focused-editor-v3.png): inspected; Edit inquiry, independent source effect, contact-only example. Its Inquiry source detail label represents the existing Source detail field, not an additional field.
- Enrollments artwork unchanged. v2 images and prior prompts remain historical, superseded for terminology/action placement.
- Built-in image tool; exact prompts in [inquiry-board-prompts.md](inquiry-board-prompts.md). Images are concept art, not application evidence.

## Verification and publication

Required local validation and documentation parity/link checks are recorded in the publication completion comment on MIS-408, together with the exact commit, GitHub CI and Git-triggered Vercel deployment. Do not infer a runtime UI pass from documentation validation. No Sentry runtime-clean claim is made for this docs-only publication.

## Other-page review boundary

Read-only live navigation reached Vercel protection, not authenticated CRM pages. The secure sign-in helper failed before it could establish the stored test-account session. No authenticated Pipeline/Tasks/Dashboard screenshots or live UX pass were obtained. Source inspection is useful but provisional and must not be described as a visual audit. The credential values and private browser state are not included in this public repository.

Source-grounded recommendations are tracked in the existing CRM polish issue, not added to the contact redesign's implementation scope. No new full-page redesign is authorized by this review. Authenticated review remains outstanding before prioritizing visual changes or accepting MIS-409.

## Next step

Start MIS-409 when instructed: build the readable Record shell and retained tabs using existing resource components and working forms; coordinate inquiry copy with Pipeline. No further visual-concept round is needed. Then exact-task workflow, safe scoped source/editor contracts, enrollment-context/resource refinements and Activity/Conversations follow in the parent sequence. Live mutation QA requires its separately authorized fixtures/target; production promotion remains separate.
