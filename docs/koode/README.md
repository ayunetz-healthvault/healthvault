# Koode implementation handoff

Prepared 8 September 2026. User-approved direction: the family and individual-parent display created in this conversation.

## Start here

1. Read [CLAUDE_PROMPT.md](CLAUDE_PROMPT.md).
2. Read [BASELINE.md](BASELINE.md) and reconcile it with the current checkout.
3. Read [DESIGN.md](DESIGN.md) and open [the interactive reference](design-reference/index.html) locally.
4. Implement [STORIES.md](STORIES.md) in its dependency order, recording evidence in [PROGRESS.md](PROGRESS.md).

The hosted reference is https://koode-family-companion.sujay-live.chatgpt.site . It is private and may not be accessible to an agent; the local reference is the portable handoff. The files in `design-reference/` are a browser design concept, not the mobile application or production code. They use fictional health data and session-only state.

## Scope

Keep Expo/React Native, the existing backend services, S3-compatible objects, DynamoDB records and SQS-compatible queue. Extend the current application into a shared family health platform with two experiences:

- **Family caregiver:** who needs attention, each parent's records, document review, upcoming visits and assigned next steps.
- **Individual parent:** their own Today screen, confirmed medicine schedule, document capture, symptoms and appointments, with control over family access.

A parent profile inside a caregiver's account is not yet a parent login. Sharing is a backend capability, not a UI toggle alone. The current owner-partitioned data model must evolve deliberately rather than giving another account unrestricted access to the original owner's partition.

## Milestones

| Milestone | Stories | Demonstrable outcome |
| --- | --- | --- |
| M1 · Visual direction | KOO-00–01 | Reusable native design system and two fixture-driven home screens |
| M2 · Identity and records | KOO-02–05 | Separate accounts, permission-scoped records, encrypted offline state and sync |
| M3 · Report-to-summary | KOO-06–08 | Durable upload, asynchronous processing, source-linked human review |
| M4 · Family and parent journeys | KOO-09–12 | Connected dashboards, medicine recording, visit preparation and tasks |
| M5 · Pilot readiness | KOO-13–15 | Privacy operations, deployment configuration and recorded acceptance evidence |

These are delivery milestones, not time or budget estimates. KOO-00 must break oversized stories into child tasks while retaining the acceptance criteria and stable story IDs.

## Relationship to existing plans

This handoff supplements `docs/architecture/phase-1.md`, `phase-2.md`, ADRs and `progress.md`; it does not mark the old plan completed or replace it. The baseline below was checked against commit `ecb38d284bacc7989aa7fe20470fa6582dc60a90`. Existing source takes precedence over stale implementation claims; user-approved requirements take precedence over earlier product assumptions. Record conflicts and deliberate architecture changes explicitly.

Cloud resource provisioning, paid provider calls, sending invitations to real people and production release are not performed by this documentation change. Develop and test with synthetic records. Read and obey the repository's existing real-data and production gates.
