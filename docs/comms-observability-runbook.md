# Comms Observability Runbook

This runbook covers the safe checks for Messenger/WhatsApp inbound, manual outbound, message templates/settings, and follow-up sequence runs.

## Safety Rules

- Do not call live Meta/provider APIs from diagnostics unless Alvaro explicitly approves that test.
- Do not use live client/customer phone numbers for validation.
- Use Meta test numbers, mocked provider responses, local fixtures, or read-only production checks.
- Never paste provider tokens, webhook secrets, raw request signatures, or full message bodies into Linear, logs, screenshots, or reports.
- Prefer the Comms Ops page and `/api/comms/observability`; both redact provider identifiers and omit message bodies/raw payloads.

## Comms Ops Surface

Admin/settings users can open `/comms-ops`.

The page reads `/api/comms/observability` and shows:

- provider config readiness without secret values
- inbound Messenger/WhatsApp counts, recent redacted event metadata, and channel config state
- manual outbound pending/sent/failed/audit outcomes
- template/settings readiness and blocked reasons
- follow-up enrollment/run/task/draft state
- opt-out, wrong-number, DNC, quiet-hours, prior-inbound/window, BU/owner scope, template approval/enabled, and provider config blockers

Expected behavior:

- Provider IDs are redacted and hashed for correlation.
- Message bodies, raw payloads, access tokens, verify tokens, app secrets, and signatures are not returned.
- Follow-up draft metadata must remain review-only; `autoSendEnabled` should be `false`.

## Webhook Health

Read-only checks:

1. Open `/comms-ops` and confirm Provider Readiness.
2. Confirm webhook verify token and app secret are configured.
3. Confirm Messenger has a page access token or page-token map before outbound tests.
4. Confirm WhatsApp has an access token or token map.
5. Confirm WhatsApp has explicit business-unit routing by phone number id or display number before live traffic.
6. Confirm recent inbound rows show expected channel, status, redacted provider-account hash, and idempotency hash.

Safe HTTP checks:

```bash
curl -i "https://ait-crm-pi.vercel.app/api/webhooks/facebook-leads?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=test"
curl -i "https://ait-crm-pi.vercel.app/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=test"
```

Both wrong-token checks should return HTTP 403. Do not include real verify tokens in shared logs.

Duplicate/idempotency interpretation:

- Inbound duplicate provider events should collapse through the conversation message unique idempotency boundary.
- A normal duplicate replay should not create a second message row.
- The observability surface reports recent idempotency hashes, not raw keys.
- If operators report repeated customer messages, compare the redacted provider-account hash, channel, external message id redaction, and timestamps before assuming a duplicate bug.

## Message And Template Readiness

Check `/comms-ops` first, then Settings if changes are needed.

Messenger readiness requires:

- active channel config for the page/provider account
- channel setting enabled for the intended scope
- prior inbound conversation evidence for manual sends
- open service window for freeform sends
- provider token configured

WhatsApp readiness requires:

- active channel config for the phone number id
- channel setting enabled for the intended scope
- prior inbound conversation evidence for freeform sends
- approved provider template for out-of-window/template sends
- template enabled and active in CRM
- provider template name present in template metadata when sending WhatsApp templates
- WhatsApp access token configured
- WhatsApp business-unit map configured before live traffic

Common template blockers:

- `template_disabled`: template is not enabled.
- `template_not_active`: template is draft or archived.
- `template_not_approved`: WhatsApp-applicable template is not provider approved.
- `channel_setting_missing`: no CRM channel setting exists for the scope.
- `channel_disabled`: CRM channel setting exists but is disabled.

## Manual Outbound Failures

Use `/comms-ops` Manual Outbound Audit.

Interpretation:

- `pending`: audit row was created before provider dispatch or did not get finalized.
- `sent`: provider returned success and the audit row was updated.
- `failed`: provider returned failure or the app recorded a send error.
- `audit_update_failed` / `audit_update_missing`: provider result was known but the audit row could not be updated cleanly.

Common blocked reasons before dispatch:

- `contact_blocked`: DNC or wrong-number contact.
- `quiet_hours`: current time is inside the configured quiet-hour window.
- `recipient_missing`: no safe prior inbound conversation identity.
- `service_window_closed`: Messenger or freeform WhatsApp window is closed.
- `template_required`: WhatsApp freeform is outside the 24-hour window.
- `template_not_enabled` / `template_not_approved`: template cannot be used.
- `provider_config_missing`: required Meta token is missing.
- `channel_config_missing` / `channel_config_inactive`: conversation has no active channel config.

Do not manually retry a failed send by changing request IDs unless the operator intends a new customer-facing send. Existing UI retries should preserve the request ID until success or the draft changes.

## Follow-up Sequence State

Use `/comms-ops` Follow-up Sequence Runs.

Readiness checks:

1. Sequence is active and enabled.
2. Enrollment is active and due.
3. Contact is not DNC or wrong number.
4. Enrollment has not reached max touches.
5. Current time is outside quiet hours, or the enrollment should defer.
6. Prior inbound evidence exists in the same BU/channel scope.
7. Messenger window is open when required.
8. Template exists, is enabled, is active, matches channel, and is provider approved for WhatsApp.
9. Owner has access to the enrollment business unit.

Expected run outcomes:

- `created`: a review task and/or draft metadata was created.
- `blocked`: a run was recorded with blocked reasons.
- quiet-hours-only blocks should defer instead of creating an unnecessary task.
- DNC/wrong-number and max-touch blocks should stop the enrollment.
- Duplicate due-step execution should be idempotent.

Review task/draft safety:

- Sequence-created drafts are review metadata only.
- `autoSendEnabled` must remain `false`.
- Sending must still go through the manual outbound guardrails or a future policy-equivalent send action.

## Production Migration Status

Before assuming the feature is live:

1. Confirm the intended commit is deployed.
2. Confirm all migrations through the current production commit have run.
3. Confirm these tables exist after MIS-47:
   - `conversation_channels`
   - `conversations`
   - `conversation_messages`
   - `message_templates`
   - `message_channel_settings`
   - `follow_up_sequences`
   - `follow_up_sequence_steps`
   - `follow_up_sequence_enrollments`
   - `follow_up_sequence_step_runs`
4. For MIS-49, no new migration is expected. If the schema changes later, stop and review migration risk before production.

## Escalation

Escalate to Sentry QA when:

- a user-flow sequence is unclear
- pending/failed manual outbound audit rows appear inconsistent
- duplicate inbound outcomes create unexpected CRM rows
- follow-up runs skip tasks/drafts or do not advance/defer/stop as expected

Escalate to Titan when:

- a change touches auth/RBAC/org/BU visibility
- provider identifiers or config diagnostics could leak secrets
- a new send path, auto-send behavior, or provider integration is proposed
- diagnostics risk exposing raw message bodies or client numbers
