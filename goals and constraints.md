# AIT CRM: Goals and Constraints

This document defines the durable product boundaries for AIT CRM. Implementation details may evolve, but changes that weaken these constraints require an explicit product and security review.

## Product goals

- Provide one trustworthy operational system across AIT Signs, AIT USA Institute, AIT Photo & Video, and AIT Taxes.
- Preserve business-unit separation while allowing authorized organization-level visibility.
- Replace spreadsheet-dependent daily work with structured contacts, leads, tasks, classes, enrollments, work orders, notes, and activity history.
- Make every imported or externally sourced record traceable to its origin.
- Give employees focused workflows that are fast on desktop and mobile without exposing data outside their responsibility.
- Support staged automation only after identity, consent, assignment, and data quality are reliable.

## Source-of-truth rules

- PostgreSQL is the CRM system of record.
- Business units are relational scope, not labels or client-side filters.
- Authentication proves identity; the CRM server owns authorization.
- QuickBooks remains the accounting source of truth. CRM financial data is an operational snapshot.
- External providers deliver messages, forms, files, or accounting context; they do not own CRM business rules.
- File contents belong in approved object storage. PostgreSQL stores metadata, ownership, and access policy.

## Access and privacy constraints

- Every database-backed request is scoped by organization, business unit, role, and action permission.
- Administrators may work across authorized business units. Non-admin users are limited to explicit memberships and capabilities.
- UI controls may explain access, but hiding a control is never the security boundary.
- Contact links, financial data, exports, settings, and operational diagnostics are returned only when the server authorizes them.
- Secrets remain in environment or provider configuration. They must not appear in source, fixtures, screenshots, logs, or support notes.
- Documentation and QA evidence use synthetic or fully redacted data.
- Production customer data is never copied into a public artifact.

## Data integrity constraints

- Imported rows retain source type, source reference, and review lineage.
- Phone and email normalization may identify candidates, but uncertain identities are held for review rather than merged automatically.
- Imports are deterministic, approval-gated, directly verified, and safe to replay.
- Data corrections preserve valid history when the product model supports it.
- Concurrent editing uses revision or equivalent conflict detection where silent overwrites would be harmful.
- Destructive changes use explicit targets, database constraints, and a tested recovery path.
- Production migrations and data operations are rehearsed on staging or an isolated Neon branch first.

## Attendance constraints

- Attendance is recorded for one enrollment in one dated class session; it is not a property of a Contact.
- The V1 model uses `class_sessions` and `attendance_records` with existing class sections and enrollments.
- Present, absent, and unmarked are distinct states. Unmarked students cannot be silently converted to absent.
- Session notes and attendance marks are separate revisioned operations so one cannot overwrite the other.
- Submitted attendance is read-only until an authorized senior coordinator or administrator reopens it.
- Regular coordinators may take attendance for accessible AIT USA Institute classes but do not receive Contact-detail links from the roster.
- Historical workbook attendance is intentionally not imported. The operational record begins with the approved forward-looking workflow.

## Import and automation constraints

- Raw source data is staged, classified, and reviewed before promotion.
- Malformed rows, ambiguous mappings, unresolved duplicates, and conflicting values remain held.
- Website and provider ingestion require explicit business-unit routing and idempotency.
- Automated outbound communication requires approved templates, consent rules, owner routing, audit events, and stop conditions for reply, opt-out, or completion.
- Provider payloads are minimized and secret-like fields are redacted from stored audit context.

## Delivery constraints

- `staging` is the validation lane; `master` is the production lane.
- Feature code reaches production only after live staging QA and explicit approval.
- Migrations are applied only to a verified database branch and are checked separately from application deployment.
- Small, reviewable slices are preferred over broad rewrites.
- A feature is not complete until tests, lint, production build, role boundaries, responsive behavior, and relevant live flows have been verified.
- QA fixtures are labeled, synthetic, isolated to staging, and removed after verification.

## Current boundaries

- AIT Signs WordPress/Divi ingestion remains deferred until the public form stack is stable and owned.
- File and attachment workflows remain deferred until approved object storage is configured.
- Financials and Reports support operational visibility but do not replace accounting.
- Historical attendance import, student portal work, scheduling automation, and advanced attendance reporting are outside the first attendance release.
- New providers, permission systems, or core architecture require a separate design and security review.
