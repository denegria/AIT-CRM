# MIS-184 Status And Task Readiness Packet

Generated: 2026-06-10T23:26:03.394Z

## Safe DB Fingerprint

- Target base URL: https://ait-crm-git-staging-alvaros-projects-efb8ae58.vercel.app
- Host suffix: us-east-1.aws.neon.tech
- Database: neondb
- Neon branch id: br-broad-hill-aptjpyea
- Neon project id: plain-band-07005942

## Assumptions

- AIT Signs active pipeline remains runtime-classified by current work since 2025-01-01 or follow-up touch since 2026-01-01.
- Source/history-only AIT Signs rows stay searchable but should not generate employee tasks.
- No task backfill should run until the first batch is reviewed by division and contactability.

## Totals

- Contacts: 1209
- Leads: 368
- Tasks: 0
- Candidate task rows in CSV: 368

## AIT Signs

- Workflow: ait_signs
- Contacts: 906
- Leads: 65
- Existing tasks: 0
- Task-ready records before explicit approval: 65
- First outreach/follow-up candidates before explicit approval: 65
- Manual/skip records before task generation: 790

### Computed Statuses

- Invoice / Payment: 760
- Fulfillment: 64
- Intake: 55
- Estimate: 23
- Work Order: 4

### Computed Stages

- Invoice / Payment: 756
- Fulfillment: 64
- Intake: 58
- Estimate: 23
- Work Order: 5

### Buckets

- Source history: 784
- Current work: 120
- 2026 follow-up: 2

### Raw Lead Statuses

- New Lead: 53
- Lost: 6
- Won: 2

### Contactability

- missing_email: 761
- no_contact_channel: 145

## AIT USA Institute

- Workflow: ait_usa
- Contacts: 303
- Leads: 303
- Existing tasks: 0
- Task-ready records before explicit approval: 303
- First outreach/follow-up candidates before explicit approval: 303
- Manual/skip records before task generation: 0

### Computed Statuses

- New Lead: 303

### Computed Stages

- New Lead: 303

### Buckets

- New Lead: 303

### Raw Lead Statuses

- New Lead: 303

### Contactability

- reachable: 276
- missing_phone: 26
- missing_email: 1

## Recommendation

Next issue: [AIT CRM Data] Build task activation approval packet from normalized statuses

- Use current runtime lifecycle buckets instead of mutating contact statuses first.
- Generate a read-only candidate list for AIT Signs current-work/2026-follow-up rows and AIT USA New Lead/Follow Up rows with at least one usable contact channel.
- Group candidates by division, owner, status, contactability, and reason.
- Keep source-history, DNC/wrong-number/no-channel, closed/completed, and low-evidence records out of the first task batch.
- Only after approval, add idempotent task creation using sourceType=system/sourceId policy keys.

## Candidate CSV

- `docs/mis-184-task-activation-candidates.csv` contains the read-only candidate list for review.
- Columns include contact id, division, computed status/stage, bucket, contactability, touch evidence, proposed task type, and reason.

No database writes were performed by this packet generator.
