# CRM Workflow Roadmap

AIT CRM should behave like a lightweight operating system for prospects: status is obvious, the next action is visible, and work can be assigned without forcing the team to memorize context.

## Shipped First Slice

- Historical Wix contacts are treated as unworked prospects.
- Wix historical import rows land as `New Lead` with `current_stage=Needs First Outreach`.
- Imported rows are tagged through lead notes as `wix_history`, `needs_first_outreach`, and `unworked_lead`.
- Contacts and Kanban views surface first-outreach flags, next action, tags, and unassigned counts.

## Next Product Slices

1. Persisted task records
   - Add a database-backed task table linked to contact, lead, business unit, and assigned user.
   - Start with task types: first outreach, follow-up, appointment, document request, payment follow-up.

2. Assignment and ownership
   - Use real employee accounts once finalized.
   - Support unassigned queue, owner filter, and quick assign from contact cards.

3. Due dates and flags
   - Store due date, completed date, priority, and SLA state.
   - Show overdue, due today, and no-owner flags in Contacts, Dashboard, and Contact Detail.

4. Pipeline configuration
   - Keep the V1 default stages: New Lead, Contacted, Qualified, Proposal Sent, Won, Lost.
   - Later make stages configurable per division if AIT USA and AIT Signs diverge.

5. Automation rules
   - Auto-create first-outreach tasks for imported/webhook leads.
   - Auto-create follow-up tasks when a lead moves to Contacted or Proposal Sent.
   - Avoid outbound automation until message templates, opt-in posture, and owner routing are approved.

6. Manager visibility
   - Add queue-level reporting: unworked leads, overdue follow-ups, no-owner records, conversion by stage/source, and team workload.

## Guardrails

- Do not mark imported historical leads as contacted unless a user explicitly logs outreach.
- Do not auto-assign historical leads until employee accounts/ownership rules are finalized.
- Keep workflow state visible in list and Kanban views; avoid burying the next action only in notes.
