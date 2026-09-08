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
| KOO-01 | Implemented locally | Both shells built and captured; native device checks open |
| KOO-02 | Implemented locally | Cognito wired and tested against a faked provider; live pool unverified |
| KOO-03 | In progress | Model, policy, routes and migration done and tested; `/v1/parents` and `/v1/documents` not yet moved; DynamoDB semantics unrun here |
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

Superseded — see KOO-01 below.

## KOO-01 — Apply the approved native design to both experiences

**Status: Implemented locally.** Two acceptance criteria are partly open; both
are named below rather than folded into the others.

- **Date / branch / starting commit:** 8 September 2026 · `claude/koode-implementation-le3t6j` · from `cc3fdf9`
- **Commits:** `328141a` (KOO-01a, palette and contrast rule), `88f0ff5` (KOO-01b/c, both shells)
- **Child tasks:** KOO-01a design tokens · KOO-01b caregiver shell · KOO-01c parent shell

### Existing implementation reused

`src/components/ui/*` whole, `ParentCard`, `FollowUpCard`, `DocumentCard`, the
document components, `selectParentStats` and the follow-up selectors, and the
existing capture / document / parent / follow-up routes. No component was
rewritten; `Card` gained two tones, `Text` and `Button` gained density, `Badge`
was fixed. The screens are new.

### Acceptance criteria

| Criterion | State | Evidence |
| --- | --- | --- |
| Palette, card hierarchy, spacing and typography from the reference, on shared tokens | Satisfied | `src/theme/tokens.ts`; 76 assertions in `tokens.test.ts`; the captures |
| Both navigation shells, on explicitly synthetic fixtures | Satisfied | `app/care/*`, `app/me/*`; the demonstration badge is on every home screen |
| Parent actions large, labels plain, patient context unambiguous; no persona switch in a live build | Satisfied | `density.comfortable`; `IdentityHeader` names the account on every screen; the preview control is behind `isDemoBuild()` and `resolveExperience` has no setter |
| Existing routes preserved, redirects added where they moved | Satisfied | `/schedule` and `/settings` still resolve; `app/schedule.tsx` picks per experience |
| First-use, empty, loading, failure and offline states; no invented medicine or health claim | Satisfied | `me-today` no-treatment state; `care-home` empty attention copy; both asserted in `__tests__/app/` |
| Compact and large phone, 200% text, screen reader, contrast, focus and touch checks | **Partly satisfied** | Compact/large/narrow captured on web; contrast asserted; **native text scaling and screen-reader checks not done — no device or emulator in this session** |

### Commands actually run

| Command | Result |
| --- | --- |
| `npm run verify` | pass — typecheck, lint, **496 tests / 31 suites** (371 at baseline) |
| `npx expo start --web` + Playwright | 24 captures, all three profiles, both shells |

New tests: 76 palette/scale, 9 experience resolution, 14 attention rules, 10
route guard, 16 screen tests across the two homes.

### Evidence

`docs/koode/evidence/koo-01/` — captures, the capture script, and a README
stating plainly what web preview does and does not prove.

### Defects found and fixed while doing this

- **Every deep link was lost on a cold start.** `useRouteGuard` decided the user
  was signed out during the window between the persisted store rehydrating and
  the token being read out of secure storage, redirected to sign-in, and then
  bounced to `/` — discarding the URL that was actually opened. The guard's own
  comment claimed the opposite. It now waits for `restoreAttempted` and keeps
  the intended route across the gate. Ten tests, including the exact
  regression. Found by pointing a browser at `/me`; invisible to the suite.
- **The demonstration badge clipped** to "…these records are fictio" at the
  parent's text size — the one label that must be readable. It wraps now.
- **"My health" truncated to "My hea…"** in the parent tab bar.

### Decisions

- **Two URL spaces, `/care` and `/me`, not one shell that swaps tabs.** The
  experiences differ in what may be read, so a single route rendering either is
  one refactor away from showing the wrong person's record.
- **Experience is derived, never set.** `resolveExperience` reads only the
  account's relationship to records. The reference's "Compare views" switch is a
  design-review surface; shipping it would make it an impersonation control.
- **The reference's muted grey was changed.** `#626D65` is 4.44:1 on peach. The
  rejected value is pinned in a test next to the replacement.
- **The parent's Today card shows the no-treatment state.** A confirmed schedule
  is a different record from an AI's reading of a prescription and does not
  exist until KOO-10. A placeholder dose on the phone of the person whose record
  it is reads as an instruction to take a drug.

### External gates still unverified

- [ ] Native rendering on Android and iOS
- [ ] Native text scaling at 200%
- [ ] TalkBack / VoiceOver pass over both shells

### Next precise action

Superseded — see KOO-02 below.

## KOO-02 — Sign in to a real account and select the correct experience

**Status: Implemented locally.** One acceptance criterion is blocked on a user
pool; the rest are satisfied and tested.

- **Commit:** `0696131` · **ADR:** `docs/architecture/adr/004-mobile-authentication.md`

### Acceptance criteria

| Criterion | State | Evidence |
| --- | --- | --- |
| Configured Cognito sign-up, verification, sign-in and recovery; demo sessions kept separate | Satisfied in code, **live flow unverified** | `cognitoClient.ts`, `app/(auth)/confirm.tsx`, `app/(auth)/reset-password.tsx`; 27 tests against a faked `fetch` |
| Expiry, refresh, server-side revocation; credentials cleared on logout | Satisfied | Refresh margin, single in-flight refresh, `GlobalSignOut` before local clear |
| Parent onboarding establishes their own record; a UI role is not an authorization grant | Satisfied by KOO-03 | `subject: 'me' \| 'someone_else'` on `POST /v1/patients` produces a `self` or `manager` grant |
| A user can have a self record and helper access without one flag granting everything | Satisfied | Grants are per record; `resolveExperience` reads them and grants nothing |
| Deep links and private routes protected; live mode never falls back to demo | Satisfied | `useRouteGuard` (10 tests); `assertLiveConfigured` (3 tests) |
| Backend verifier and dev-issuer safeguards reused; no client secret in the bundle | Satisfied | Verifier untouched; `assertNoClientSecret` throws, asserted |

### Commands actually run

`npm run verify` — pass, 532 tests / 33 suites.

### External gates still unverified

- [ ] A synthetic-account sign-in against a real Cognito user pool. **No pool
      exists.** Every request shape here is unexercised against AWS.
- [ ] Pool configuration: `ALLOW_USER_PASSWORD_AUTH`, no client secret, email
      alias with verification, `name` and `locale` writable. Carried into KOO-14.

### Decisions

- `USER_PASSWORD_AUTH` over hand-written SRP. Hand-rolled crypto in an app
  holding medical records is a worse risk than a password over verified TLS to
  its own identity provider; `amazon-cognito-identity-js` is the right way to
  get SRP, once there is a pool to test it against. ADR-004 § 2.
- Token expiry is stored from the provider's response, not read from the token's
  `exp`. The client cannot verify a signature, so nothing that matters may
  depend on what a token says about itself.

## KOO-03 — Give each parent a shared record with explicit access grants

**Status: In progress.** The model, policy, routes, invitations and migration
are done and tested. Two things remain: moving `/v1/parents` and
`/v1/documents` onto patient partitions, and the mobile sharing screens.

- **Commit:** `1f4cd73` · **ADR:** `docs/architecture/adr/005-patient-identity-and-access-grants.md`

### Acceptance criteria

| Criterion | State | Evidence |
| --- | --- | --- |
| ADR for patient identity, ownership, actor identity and per-record grants; additive migration | Satisfied | ADR-005; `migrateOwnerToPatientPartitions` deletes nothing |
| At least owner/self, contributor and read-only; grantor, grantee, scope, status, timestamps; helpers cannot self-grant | Satisfied | `policy.ts`, 19 tests; helper-escalation refused, 3 tests |
| Expiring single-use invitations through authenticated accounts; a token alone reads nothing | Satisfied | 8 invitation tests including expired, spent, withdrawn and unauthenticated |
| Caregiver profiles stay usable, no auto-linking by name/phone/email; explicit claim flow defined | Satisfied | Migration grants `manager`; auto-linking explicitly not implemented, ADR-005 § 6 |
| Grants checked on every record API, URL issuance, sync, task action and queued job | **Partly** | Enforced on every route in `access.ts`; `/v1/parents` and `/v1/documents` still owner-partitioned — next slice |
| Revocation denies subsequent operations; bounded lifetime of issued links and cached copies documented | Satisfied | Revocation tests use the *same* token afterwards; limits stated in ADR-005 |
| Who added/changed each item; audit free of clinical text; revocation view and denied state | **Partly** | `appendAudit` on create/invite/accept/revoke, asserted to carry no name; the revocation *view* is the mobile slice |

### Commands actually run

| Command | Result |
| --- | --- |
| `SKIP_OCR_TESTS=1 npm run backend:verify` | pass — **458 passed, 91 skipped** (410/79 before) |

48 new backend tests: 19 policy, 29 routes.

### Baseline failures and skipped checks

The 91 skipped include **13 new tests in `test/integration/access.test.ts`** —
concurrent self-grant claims, two devices racing to accept one invitation,
double revocation, the `GSI2` reverse query, hash-only token storage, and the
migration end to end including its dry run and re-run. These need real DynamoDB
and **were not run**: the Docker image registry is unreachable in this session,
so the local stack cannot start. They are written and unrun, and the conditional
writes they cover are the one part of this story a fake cannot demonstrate.

### Next precise action

KOO-03d: move `/v1/parents` and `/v1/documents` onto patient partitions behind
`requireAccess`, then build the sharing screens — named helpers, exact
permissions, pending invitations, revocation — replacing the "not built yet"
notices now on `app/care/family.tsx` and `app/me/family.tsx`.
