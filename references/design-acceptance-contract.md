# MIS-390 Design Acceptance Contract

## Workflow model

- The existing Dashboard and Tasks controls remain the only generic task-edit entry points.
- Each generic mutation carries the `updatedAt` value loaded with that exact task.
- A current edit succeeds once and returns the next task version.
- A stale edit changes nothing and asks the employee to refresh before retrying.
- Exact follow-up completion and cancellation approval keep their existing workflows.

## Interaction and hierarchy

- No new control, dialog, queue, or task framework is introduced.
- Current edits preserve the existing pending, success, and saved states.
- A stale inline edit remains open and renders `This task changed. Refresh the queue and try again.` through the existing error region.
- Dashboard completion remains reload-backed; a rejected stale completion stays open and visible.

## Responsive acceptance

- Desktop basis: 1440 x 900.
- Mobile basis: 390 x 844.
- Existing task cards, inline edit fields, and completion controls must not change size or produce new overflow.

## Accessibility and states

- Existing pending controls remain disabled and expose their current busy status.
- Existing inline error regions continue to announce rejected updates.
- The server returns structured `task_version_required` and `task_stale_write` errors; client text tells the employee to refresh.
- A stale update emits no task event or activity event.

## Non-goals

- New task entities, version columns, or migrations.
- Changes to follow-up outcome logging or next-follow-up creation.
- Changes to cancellation or removal-approval policy.
- Recovery Queue v1.
