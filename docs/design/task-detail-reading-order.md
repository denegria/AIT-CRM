# Task Detail reading order — staging acceptance contract

## Problem and direction

- Employee job: read the task, identify the person and relevant work, check due date/owner, then log the result.
- Current friction: a compressed briefing competes with a permanent metadata rail and a large empty main area.
- Chosen model: one work-first reading column. Task briefing → contact/related work → due and owner → Log outcome → history → collapsed record details.
- Visual direction: use the existing CRM design system, a restrained 900px reading width, clear section dividers, and no filler cards.
- Reference classification: the owner screenshot is inspiration/evidence of the old problem, not a faithful-reference mockup.

## Locked behavior

- Preserve status/priority, division context and queue return path, task assignment permissions, cancellation/approval actions, linked-record access checks, and outcome route behavior.
- Contact navigation lives beside the contact identity; Log outcome appears after the briefing for eligible tasks only.
- Type, source, creator, and timestamps remain available under Record details.
- No schema, API, permission, CRM data, production, or generic Tasks queue change.

## Responsive and evidence

- Primary CSS viewport: 1536×960. Regression: 1920×1080 and 390×844 at 100% zoom.
- Briefing, contact, due/owner, action, history, and disclosure must retain that order without horizontal overflow. Long descriptions, long contact names, and longer history must grow vertically.
- Closeout requires lint, webpack build, focused Tasks tests, rendered desktop/mobile staging screenshots, read-only outcome navigation/cancel check, and browser console check. No task or contact data writes.
