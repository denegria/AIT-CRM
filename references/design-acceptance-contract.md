# MIS-389 Design Acceptance Contract

## Workflow model

- AIT USA inquiries and manually created Opportunities enter the CRM unassigned.
- Regular Coordinators may record an inquiry but cannot claim or reassign it.
- Senior Coordinators and administrators use the existing owner control to assign an active AIT USA regular Coordinator.
- Other business units retain their existing owner behavior.

## Interaction and hierarchy

- No new queue or primary action is introduced in this slice.
- For regular Coordinators, the AIT USA owner field is replaced by explanatory text: the Opportunity remains unassigned until Senior assignment.
- For Senior/Admin users, the existing owner select remains the assignment control and supports an explicit Unassigned state.
- Status, source, and lifecycle controls retain their existing hierarchy and behavior.

## Responsive acceptance

- Desktop basis: 1440 x 900.
- Mobile basis: 390 x 844.
- The explanatory owner state must wrap without horizontal overflow or obscuring adjacent routing fields.

## Accessibility and states

- The explanatory owner state has a visible `Assigned To` label.
- Server authorization remains authoritative if a stale or crafted client submits an owner.
- API errors distinguish assignment authority, inactive users, role eligibility, and business-unit membership.

## Non-goals

- Recovery Queue v1.
- Bulk reassignment of historical work.
- Changes to AIT Signs routing or ownership.
