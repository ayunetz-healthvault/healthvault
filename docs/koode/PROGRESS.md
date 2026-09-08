# Koode implementation progress

Planning package prepared 8 September 2026. Implementation began the same day on
branch `claude/koode-implementation-le3t6j`. This file is the live ledger: the
table is the status, the per-story sections below carry the evidence.

Statuses: Not started / In progress / Implemented locally / Blocked / Verified.
**Verified** is used only when the story's acceptance evidence is satisfied.
External gates are listed as separate checklist items; a missing live test is
never hidden by closing the parent story.

| Story | Status | Evidence / blocker |
| --- | --- | --- |
| KOO-00 | Implemented locally | Baseline reconciled against `ecb38d2`; see below |
| KOO-01 | Not started | Approved interactive design bundled |
| KOO-02 | Not started | |
| KOO-03 | Not started | |
| KOO-04 | Not started | |
| KOO-05 | Not started | |
| KOO-06 | Not started | |
| KOO-07 | Not started | |
| KOO-08 | Not started | |
| KOO-09 | Not started | |
| KOO-10 | Not started | |
| KOO-11 | Not started | |
| KOO-12 | Not started | |
| KOO-13 | Not started | |
| KOO-14 | Not started | Cloud execution/credentials must be verified in implementing session |
| KOO-15 | Not started | |

## Environment limitations in this session

Recorded once, here, because several stories' evidence depends on them. None is
a defect in the checked-out code.

| Limitation | Effect | How it was established |
| --- | --- | --- |
| Docker image registry unreachable (`production.cloudfront.docker.com` → 403 through the session proxy) | `npm run stack:up` starts the daemon but pulls no images, so MinIO / DynamoDB Local / ElasticMQ never run. The 72 stack-dependent backend tests stay skipped. | `npm run stack:up`; `docker ps` empty |
| Tesseract language data unreachable (`cdn.jsdelivr.net` and `github.com` → 403 through the session proxy) | `backend/test/integration/tesseractOcr.test.ts` (6 tests) fails on a network fetch, not on OCR behaviour. The repository's own `SKIP_OCR_TESTS=1` escape hatch is used for a clean gate. | `curl` to both hosts; failure text names the fetch |
| No physical device, simulator or emulator | Native screenshots, native encryption and device calendar writes cannot be captured here. Web preview is not a substitute and is not claimed as one. | No Android/iOS toolchain in the container |
| No AWS account, Cognito user pool or Sarvam credential | Live auth, live provider calls and IAM/residency claims cannot be tested. | No credentials present; none requested |

Because of the first two, every backend gate in this file is run as
`SKIP_OCR_TESTS=1 npm run backend:verify` and the skipped counts are reported
rather than omitted.

## KOO-00 — Reconcile the baseline and plan the first slice

- **Date / branch / starting commit:** 8 September 2026 · `claude/koode-implementation-le3t6j` · `ecb38d2` (the commit BASELINE.md was reviewed against, and still HEAD of this branch's history at start)
- **Working tree:** clean at start. The only change made before this entry is the handoff package itself, committed as `af5c18f`. No unrelated user changes existed to preserve.
- **Repository instructions:** no `AGENTS.md` and no `CLAUDE.md` anywhere in the tree — re-checked, confirming BASELINE.md. `.claude/launch.json` defines only an `expo-web` preview target. The binding instructions are therefore `README.md`, `docs/architecture/` and this handoff.

### Baseline verification actually run

| Command | Result |
| --- | --- |
| `npm run verify` | **pass** — typecheck, lint, 371 tests / 25 suites |
| `npm run backend:verify` | **fail** — 411 passed, **6 failed**, 72 skipped. All six failures are `tesseractOcr.test.ts` network fetches (403), pre-existing and environmental |
| `SKIP_OCR_TESTS=1 npm run backend:verify` | **pass** — 410 passed, 79 skipped, 0 failed |

The 371 frontend figure matches the count recorded in `docs/architecture/progress.md`;
it was re-run here rather than copied. The backend count differs from that
document's 486 because the local stack is unavailable in this session, so
stack-dependent suites skip instead of running.

### Baseline reconciliation

BASELINE.md was checked line by line against the source. It is accurate. Two
clarifications worth carrying forward:

- **Ownership is genuinely single-tenant, and cleanly so.** `keys.ts` can only
  build a key from a verified token subject, and `installAuthentication` fails
  at boot if any `/v1` route forgets its guard. This is a good foundation to
  extend, not something to work around: the grant model in KOO-03 has to
  preserve the property that a handler cannot address another tenant's data,
  while changing *what* a partition is keyed on.
- **The queue is a real adapter with no consumer.** `JobQueue` implements
  enqueue/receive/acknowledge against SQS-compatible ElasticMQ, and
  `DocumentProcessingOrchestrator` implements the whole pipeline. KOO-07 is
  therefore a worker entrypoint plus lease/idempotency/DLQ handling, not a new
  pipeline.

### Story classification

| Story | Classification | What already exists to reuse |
| --- | --- | --- |
| KOO-01 | Extension | `src/theme/tokens.ts`, `src/components/ui/*`, `ParentCard`, `FollowUpCard`, document components, expo-router tabs |
| KOO-02 | Integration | `authService` interface shape, `TokenVerifier`, `localIssuer`, route guard, `sessionStore` |
| KOO-03 | New capability + migration | `keys.ts`, `RecordRepository`, `callerOf`/`notFound`, the boot-time auth guard |
| KOO-04 | Replacement | `secureStorage`, `persistence`, `captureService`, `appLock` |
| KOO-05 | Integration (new outbox) | `vaultStore`, `api/client`, `endpoints`, `/v1` routes |
| KOO-06 | Integration + hardening | `capture/*`, `uploadService`, `/v1/documents` upload protocol, `ObjectStore` |
| KOO-07 | New worker over existing pipeline | `JobQueue`, `DocumentProcessingOrchestrator`, OCR/PDF/redaction/validation services |
| KOO-08 | Extension | `app/document/[id]`, `FindingRow`, `MedicineRow`, `SourceBadge`, summary types |
| KOO-09 | Extension | caregiver dashboard, `ParentCard`, vault selectors |
| KOO-10 | New capability | parent routes are new; `MedicineRow` and source components reused |
| KOO-11 | New + extension | `questionsForDoctor` in summaries; observation entities are new |
| KOO-12 | Extension + new routes | follow-up store/screens/types, `calendarService` |
| KOO-13 | Integration + missing backend | `accountService` client contracts, privacy screens |
| KOO-14 | Deployment readiness | `stack.ts`, ADR-003, `docker-compose.yml` |
| KOO-15 | Acceptance | everything above |

No story is already satisfied. The closest is KOO-01, where the component
library and token scale exist but neither the approved palette nor either
navigation shell does.

### Overlap with the existing P1/P2 plan

`docs/architecture/progress.md` records P1-01..P1-14 done, and in Phase 2:
P2-00 (local stack), P2-04a (record repository), P2-03a (identity port) and
P2-05a (the `/v1` API). Phase 2 overall is marked "building locally". Nothing
there is being marked done or undone by this backlog. Three points of contact:

- **P2-05 (worker) is KOO-07.** Same work, and KOO-07's acceptance criteria are
  strictly larger. It will be implemented once and recorded in both files.
- **P2 § 4's suggested key schema is already superseded** by the two documented
  divergences in `keys.ts`. KOO-03 adds a third change — patient partitions —
  which needs its own ADR rather than an edit to phase-2.md.
- **Phase-2's Textract discussion stays a documented option.** Tesseract is not
  being replaced. Recorded here so a later reader does not read KOO-07 as an
  OCR migration.

Stale comments found and *not* trusted: `endpoints.ts` documents document keys
as `DOC#<parentId>#<documentId>`, which `keys.ts` deliberately does not do; and
`persistence.ts` / `vaultStore.ts` carry `TODO(security)` and `TODO(backend)`
markers that KOO-04 and KOO-05 will resolve. These are comments describing an
older intent, not a description of current behaviour.

### Bounded implementation sequence

Dependency order from STORIES.md, with the two oversized stories split. Child
tasks keep the parent's acceptance criteria; no criterion is dropped.

| Slice | Contents |
| --- | --- |
| KOO-01a | Approved palette and type scale in `tokens.ts`, plus the shared primitives the two shells need |
| KOO-01b | Caregiver Home / Family / Calendar / To-do shell on synthetic fixtures |
| KOO-01c | Parent Today / My health / Calendar / Family shell on synthetic fixtures |
| KOO-02 | Cognito integration, refresh/revocation, experience resolution from identity |
| KOO-03a | ADR, patient/grant key layout, access repository, invitations |
| KOO-03b | Patient-scoped record repository and the additive migration |
| KOO-03c | Grant enforcement on every `/v1` route, with the negative-test matrix |
| KOO-03d | Family/sharing screens: grants, invitations, revocation |
| KOO-04 | Encrypted account-partitioned vault, protected originals, migration |
| KOO-05 | Sync service and durable outbox |
| KOO-06 | Durable capture-to-upload against the real protocol |
| KOO-07 | Worker entrypoint, leases, idempotency, DLQ, `/v1` polling |
| KOO-08 | Original-beside-draft review, versioned corrections |
| KOO-09..12 | The two journeys, on real data |
| KOO-13 | Consent versioning, export, deletion |
| KOO-14 | Reproducible configuration and runbooks (cloud execution blocked) |
| KOO-15 | Acceptance evidence and readiness levels |

### Next precise action

KOO-01a: extend `src/theme/tokens.ts` with the approved palette as a named
scheme, keeping the existing accessibility floors, then build the shared
primitives the two navigation shells need.
