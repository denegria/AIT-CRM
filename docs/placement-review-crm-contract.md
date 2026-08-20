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

The placement object must contain opaque `reviewId` and `resultId`, and its
public `reviewStatus` must match the event suffix. `confirmed` and `adjusted`
also require a public `finalLevelKey`. The allowlist permits only opaque IDs,
public status/level keys, channel preference, verified-email/mobile booleans,
and versioned channel-consent evidence. It rejects raw answers, writing,
reviewer rationale, account/claim tokens, and provider data.

Each event is transactionally locked by its existing idempotency key. A replay
returns acknowledgement without another timeline entry, task, notification, or
delivery record. The CRM appends one privacy-safe `aitusa.<eventType>` timeline
event; it contains no learner response, rationale, or token.

## CRM task and RBAC

CRM creates or reuses exactly one task with source ID `review:<opaque-review-id>`:

- title: `Review placement result`
- source type: `aitusa_placement_review`
- deep link: `/employee/placement-reviews?review=<opaque-id>`
- assignment: active AIT USA Senior Coordinator first; organization Admin only
  as a documented fallback. No eligible reviewer fails the acknowledgement so
  the AIT USA outbox can retry/dead-letter safely.

`confirmed` and `adjusted` complete that exact task only in the same committed
transaction that records CRM acknowledgement. `additional_review_required`
reopens that same task. Task events retain CRM workflow audit without claiming
academic authorship.

## Delivery posture and recovery

Provider delivery is deliberately **disabled** in this implementation. A
verified account email is recorded as the durable `queued` baseline, but it is
not dispatched. SMS is always suppressed unless a separate future implementation
has both service-SMS consent and explicitly approved Telnyx/profile readiness;
marketing consent is never used. Automated WhatsApp is suppressed.

Existing task metadata and task events record privacy-safe delivery outcomes
(`queued`, `sent`, `delivered`, `failed`, `bounced`, `opted_out`, `suppressed`)
with correlation IDs. The transport-free
`recordPlacementReviewDeliveryOutcome` service is the future callback/retry
boundary: `failed`, `bounced`, `opted_out`, and `suppressed` reopen the CRM
task/due date for a safe correction, preference change, or resend. It does not
alter academic state or create a second placement decision.

No provider credentials, recipient values, message bodies, raw review content,
or tokens are stored in this workflow.

## Frontend contract assumptions

The AIT USA employee queue must authorize the signed-in employee independently
and accept only the opaque `review` query value. The queue owns the actual
review data and action audit. CRM does not construct a result URL, expose a
learner identity in the link, or assume that an email/SMS/WhatsApp dispatch has
occurred merely because it recorded a delivery state.
