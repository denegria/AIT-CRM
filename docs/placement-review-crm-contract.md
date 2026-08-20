# AIT USA placement-review CRM contract (MIS-398)

## Authority boundary

AIT USA owns placement evidence, final academic state, reviewer audit, and the
learner-facing result. CRM only acknowledges authenticated outbox events and
orchestrates the assigned task, CRM timeline, internal notification, and
delivery recovery. A CRM delivery problem never changes an academic decision.

## Event intake

`POST /api/webhooks/website-leads` accepts the existing authenticated
`aitusa-crm-event-v1` contract and the following idempotent event types:

- `placement_review_created`
- `placement_review_started`
- `placement_review_confirmed`
- `placement_review_adjusted`
- `placement_review_additional_review_required`

Review events have an exact envelope: common fields plus `source`, `placement`,
and `consent`. `placement` contains only opaque `reviewId`/`resultId`/
`attemptId`, a required positive monotonic `revision`, public `state`, and
`finalLevel` (maximum 120 characters) when final. `consent.sourceUrl`, when
present, is a relative path only; `consent` otherwise contains only preference
and channel-specific evidence. No legacy lead, practice, UTM, scoring/count,
contact, raw-answer, writing, rationale, token, or provider fields are
accepted. The canonical state map is `created → pending`,
`started → in_review`, with `confirmed`, `adjusted`, and
`additional_review_required` exact. Only final states carry `finalLevel`.

`docs/fixtures/aitusa-placement-review-crm-envelope-v1.json` is a required,
portable vendored copy of the AIT USA producer fixture. Its adjacent provenance
file records source ownership, source commit, schema version, and SHA-256; the
contract test fails if either the file or checksum changes unexpectedly.

Each event is transactionally locked by its existing idempotency key. A replay
returns acknowledgement without another timeline entry, task, notification, or
delivery record. The CRM appends one privacy-safe `aitusa.<eventType>` timeline
event; it contains no learner response, rationale, or token.

Authenticated placement-review events require an explicit active
`WEBSITE_LEADS_BUSINESS_UNIT_MAP.aitusa_refresh` mapping. They never inherit
the generic website-lead/first-business-unit fallback. CRM synchronizes the
review-ID task even without a contact or when identity linkage is ambiguous.

## CRM task and RBAC

CRM creates or reuses exactly one task with source ID `review:<opaque-review-id>`:

- title: `Review placement result`
- source type: `aitusa_placement_review`
- deep link: `/employee/placement-reviews?review=<opaque-id>`
- assignment: active AIT USA Senior Coordinator first; organization Admin only
  as a documented fallback. No eligible reviewer fails the acknowledgement so
  the AIT USA outbox can retry/dead-letter safely.

`confirmed` and `adjusted` complete that exact task only in the same committed
transaction that records CRM acknowledgement. Stale `created`/`started` events
cannot regress a final task; only `additional_review_required` reopens it.
CRM stores the last acknowledged `placement.revision`; delayed or duplicate
revisions are acknowledged without task mutation, so an old additional-review
event cannot reopen a newer decision. Task events retain CRM workflow audit without claiming academic authorship.

## Delivery posture and recovery

Provider delivery is deliberately **disabled** in this implementation. A
verified account email plus advisor-email consent is recorded as the durable
`queued` baseline, but it is not dispatched. SMS is always suppressed unless a
future implementation has service-SMS consent, **verified mobile**, and approved
Telnyx/profile readiness; marketing consent is never used. Automated WhatsApp
is suppressed.

Existing task metadata and task events record privacy-safe delivery outcomes
(`queued`, `sent`, `delivered`, `failed`, `bounced`, `opted_out`, `suppressed`)
with correlation IDs. The transport-free
`recordPlacementReviewDeliveryOutcome` is the transaction/advisory-lock-safe
callback/retry boundary. `failed`, `bounced`, `opted_out`, and `suppressed`
reopen or keep open CRM work. Failed, bounce, opt-out, suppression, DNC, and
wrong-number outcomes are sticky and cannot be silently re-queued; they force
the task open until explicit recovery. A later academic confirmation can update
review metadata but cannot erase or complete delivery recovery work. It never
alters academic state or creates a second placement decision.

No provider credentials, recipient values, message bodies, raw review content,
or tokens are stored in this workflow.

## Frontend contract assumptions

The AIT USA employee queue must authorize the signed-in employee independently
and accept only the opaque `review` query value. The queue owns the actual
review data and action audit. CRM does not construct a result URL, expose a
learner identity in the link, or assume that an email/SMS/WhatsApp dispatch has
occurred merely because it recorded a delivery state.
