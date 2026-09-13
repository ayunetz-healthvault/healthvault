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
| KOO-00 | Verified | Baseline reconciled against `ecb38d2`; both gates re-run |
| KOO-01 | Implemented locally | Both shells built; 24 web captures; **native device checks open** |
| KOO-02 | Implemented locally | Cognito wired and tested against a faked provider; **live pool unverified** |
| KOO-03 | Implemented locally | Model, policy, routes, invitations, migration; **DynamoDB semantics unrun here** |
| KOO-04 | Implemented locally | Encrypted per-account vault, protected originals; **device checks open** |
| KOO-05 | Implemented locally | Outbox, classification, pull with tombstones, honest status line; follow-ups now pull as well as push |
| KOO-06 | Implemented locally | Real create/presign/PUT/complete with resume; **local-stack protocol test unrun** |
| KOO-07 | Implemented locally | Worker, leases, idempotency, DLQ, double grant/consent check; a withdrawal mid-run now ends in a state a screen can show |
| KOO-08 | Implemented locally | Backend review/corrections/versioning plus the native review screen |
| KOO-09 | Partly implemented | Family overview reads real roles and pulled records; attention rules tested |
| KOO-10 | Implemented locally | Schedules confirmed by a person, doses from `occurrences.ts`, Today wired to both, and both shared over `/v1` |
| KOO-11 | Implemented locally | Observation entry and visit preparation built on the tested model; shared over `/v1` in both directions |
| KOO-12 | Implemented locally | Follow-up CRUD over `/v1`, one identity end to end, shared both ways; per-device calendar confirmation kept |
| KOO-13 | Implemented locally | Consent stored, versioned and enforced; per-record export saved to a file; erasure fenced by a durable tombstone, resumable, swept by prefix |
| KOO-14 | Blocked | Startup safety guard implemented and tested; **every cloud step needs an account this session has none of** |
| KOO-15 | Partly satisfied | Both gates run and recorded below; **no device, no cloud, no live provider journey** |

## Environment limitations in this session

Recorded once, here, because several stories' evidence depends on them. None is
a defect in the checked-out code.

| Limitation | Effect | How it was established |
| --- | --- | --- |
| Docker image registry unreachable (`production.cloudfront.docker.com` → 403 through the session proxy) | `npm run stack:up` starts the daemon but pulls no images, so MinIO / DynamoDB Local / ElasticMQ never run. The 92 stack-dependent backend tests stay skipped. | `docker compose pull` → `Forbidden` on the layer fetch; proxy status reports `connect_rejected` for that host. Re-checked at the end of this work; unchanged |
| Tesseract language data unreachable (`cdn.jsdelivr.net` → 403 through the session proxy) | `backend/test/integration/tesseractOcr.test.ts` (6 tests) fails on a network fetch, not on OCR behaviour. The repository's own `SKIP_OCR_TESTS=1` escape hatch is used for a clean gate. | The suite's own error names the fetch: `eng.traineddata.gz. Response code: 403`. Re-checked at the end of this work; unchanged |
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

### Outcome

Done and committed as `22e1b11` and `06c947d`. `/v1/parents` was removed rather
than kept alongside `/v1/patients` — two live layouts for the same thing is how
one of them gets forgotten. Object keys moved from `owners/<accountId>/` to
`patients/<patientId>/` so revoking a helper moves no bytes and deleting a
record is one prefix.

The sharing screens are built. `app/me/family.tsx` names helpers, states each
one's permissions in plain words, issues an invitation whose token is shown
once, and states what revocation does *not* reach.

## KOO-04 — Encrypt and isolate records and original files on the phone

**Status: Implemented locally.** Commit `94d4663`. ADR-006.

| Criterion | State | Evidence |
| --- | --- | --- |
| Encrypted store, maintained implementation, compatible with the Expo build; SecureStore holds keys not payloads | Satisfied | `vaultCrypto.ts` (XChaCha20-Poly1305, `@noble/ciphers`); 17 tests including a wrong key failing rather than returning plausible data |
| Originals protected separately; pending ones out of evictable cache | Satisfied | `protectedFiles.ts`; 12 tests. ADR-006 § 5 states plainly that the record key does **not** cover these files |
| Everything partitioned by account; switching, sign-out and wipe expose nothing | Satisfied | `accountSwitch.test.ts`, 11 tests |
| Migration verifies encrypted write/read before removing plaintext | Satisfied | 7 migration tests, including a write that reports success and stores nothing |
| Backup inclusion/exclusion and restore behaviour; lost keys give an explicit recovery flow | Partly | `describeKeyLoss()` is asserted not to say "your records are lost"; **backup exclusion is unverified on a device** |
| App lock honoured, and not described as encryption | Satisfied | New callout on `app/settings/security.tsx` |
| Unuploaded originals survive restart; cleanup only after confirmed upload; bounded without silent deletion | Satisfied | Over the limit, capture refuses and says why — pending work is never evicted |

**Defects found by writing the tests.** Two ordering bugs, both of which deleted
data and both of which read as correct: sign-out cleared the store while the
storage was still attached, so the persist middleware saved an empty vault over
the account's records; and hydration cleared before rehydrating, writing an
empty vault and then reading back what it had just written. The second only
appeared to work because the write and the read raced.

**Open:** keychain backing on real hardware, backup exclusion, Data Protection
while locked. Expo Go is not evidence for any of these.

## KOO-05 — Synchronize shared records with honest offline states

**Status: Implemented locally.** Commits `96441d9`, `06c947d`.

| Criterion | State | Evidence |
| --- | --- | --- |
| Reconcile with the backend; local writes alone do not update the shared record | Satisfied | `reconcile.ts` pulls; `outbox.ts` pushes; 9 + 40 tests |
| Durable encrypted outbox, mutation ids, versions, bounded retries, backoff; a timeout after commit does not duplicate | Satisfied | The id is generated once and reused on every retry — asserted directly |
| Saved locally / syncing / synced / failed / conflict distinguished; last sync shown | Satisfied | `SyncStatus`, 8 tests; the time only advances when something was acknowledged |
| Tombstones so deletions are not resurrected | Satisfied | A record the server no longer returns is removed; `removedPatientIds` |
| Shared records come *down*, not only up | Satisfied | Follow-ups are pulled with each record's documents; `mergeFollowUps` keeps an unsent change and drops one deleted elsewhere; 14 tests across `mergeFollowUps` and `pullService` |
| One identity for a record created offline | Satisfied | The device's id travels with the create and the server takes it; a retry after a lost response returns the same task rather than a second one |
| Stale writes rejected after revocation; inaccessible records cleared | Satisfied | 401/403/404 → `rejected`, never retried, never silently dropped |
| Conflicts surfaced, not overwritten by a device clock | Satisfied | 409 → `conflict`, stops, needs a person |
| Explicit retry controls; demo storage separate from live | Satisfied | `retryNow` keeps the attempt history so a hopeless change cannot be retried forever one tap at a time |

## KOO-06 — Connect durable document capture to the existing upload API

**Status: Implemented locally.** Commit `04502db`.

| Criterion | State | Evidence |
| --- | --- | --- |
| Reuse capture/gallery/PDF; confirm patient, date, category; consistent limits | Satisfied | `MAX_PAGES` states where the number comes from |
| create → presign → PUT → complete; server ids tracked, not local ones | Satisfied | 17 tests; a resumed upload does not create the document twice |
| Progress and bytes persisted; expired URLs renewed; resume without duplicates | Satisfied | URLs are requested during the upload and deliberately never persisted |
| Content type, page bounds, exact page set validated | Partly | Client-side bounds and type; **byte-level sniffing is the backend's `FileValidator`, unchanged and unrun against the stack here** |
| Recoverable dispatch; a claimed key followed by queue failure leaves no stuck document | Satisfied | Completion is idempotent on the processing state itself |
| Awaiting upload / uploading / queued / failed exposed separately | Satisfied | Session state plus processing status |
| Grants enforced for URL issuance and completion; no identifiers in object names or logs | Satisfied | `requireAccess` before signing; keys carry no name or filename |

**Removed rather than kept:** the demo build's simulated transfer. A progress
bar reaching 100% having sent nothing is exactly the detail somebody
demonstrates the app with and then believes.

## KOO-07 — Process queued reports and persist validated AI summaries

**Status: Implemented locally.** Commit `4d61092`.

| Criterion | State | Evidence |
| --- | --- | --- |
| Queue consumer using the existing adapters and orchestrator; stage and failure persisted | Satisfied | `DocumentWorker.ts`, `npm run worker`; 24 tests |
| Leases, idempotent processing, bounded retries, DLQ | Satisfied | The duplicate check asks the record, not a delivery log — the record is what survives a crash |
| Record, grant and consent rechecked at execution **and before commit** | Satisfied | Both checks tested, including withdrawal mid-run |
| Pipeline preserved; originals and identifiers never sent to the LLM | Satisfied | Orchestrator untouched |
| Low confidence / unreadable surfaced as review-needed, not guessed | Satisfied | `ocr_failed` → `manual_review`, not retried |
| Sarvam compatibility verified against docs, then a live synthetic call | **Blocked** | No credential. `SarvamSummaryProvider` still says its real behaviour is unverified |
| Temporary derived files cleaned on success and failure | Satisfied | `finally`, asserted both ways |

## KOO-08 — Review the original beside AI output and preserve corrections

**Status: Partly implemented.** Commit `e8c5f17` (backend).

| Criterion | State | Evidence |
| --- | --- | --- |
| Authorised viewing of every original page | Satisfied (API) | Short-lived read URLs, shorter than upload URLs |
| Original / AI draft / correction / reviewed kept separate | Satisfied | The pipeline's output is written once and never edited |
| Corrections with actor, time and version history | Satisfied | Append-only; changing your mind is another entry |
| A new version invalidates review; concurrent edits conflict | Satisfied | 409 on a stale version, for both correction and review |
| Unclear values stay unknown with visible warnings | Partly | Uncertainties are carried into visit preparation; **the review screen is not rebuilt** |
| Follow-ups stay proposals; creating a task needs separate confirmation | Partly | Model enforces it; **the confirm-to-create UI is not built** |

**Built in round two:** the native review screen, with the original pages beside
what the app read, corrections that name the version they were made against, and
a confirmation step before an AI proposal becomes a schedule or a task.

## KOO-09 to KOO-12 — the two journeys

**Status: Partly implemented.** Commits `06c947d`, `253f378`, `e22041e`,
`1f03a15`.

What is done is the part that is hard to get right and easy to get wrong: the
rules, as pure tested functions.

- **KOO-09.** `attention.ts` decides what "needs attention" may mean —
  administrative facts only, never the absence of one. The caregiver home and
  family screens read real roles and pulled records.
- **KOO-10.** `occurrences.ts`, 25 tests. A dose with nothing recorded is
  `null`, never "missed". Two taps on one tablet make one event. Undo appends
  and is marked, so "corrected to missed" stays distinguishable from "that was
  undone". Times resolve in the patient's zone across a daylight-saving change.
- **KOO-11.** `visitPreparation.ts`, 14 tests. Observations kept in the person's
  own words with no severity scale; uncertainties carried forward rather than
  dropped for a cleaner summary; a helper's note attributed as a helper's.
- **KOO-12.** Per-device calendar mappings, and calendar entries that no longer
  carry the record. Three existing tests asserted the old behaviour and were
  replaced with the reason recorded beside them.

**Built in rounds two and three:** the screens that use them. Today reads
`occurrences.ts`; observation entry and visit preparation are built; follow-up
CRUD went to `/v1` and, in round three, gained one identity end to end and a pull
path, so a task created on one phone reaches the other. Observations, treatments
and dose events still have no endpoint and stay on the device that recorded
them.

## KOO-13 — Privacy choices, export and deletion

**Status: Partly implemented.** Commit `bcb9343`. `DATA_HANDLING.md`.

Consent is three independent records with the notice version pinned, enforced in
the worker before the provider call and again before the result is written. A
missing answer is not permission. `DATA_HANDLING.md` records retention, the
difference between leaving a family and deleting a record, and what deletion
cannot reach.

**Built since:** the consent store and its endpoints (round two), the per-record
export and deletion (round two), and in rounds three and four the parts of both
that were still promises — an export that writes a file for the person to keep,
and an erasure that fences every write with a condition carried into the write
itself, sweeps objects by prefix, survives interruption, and leaves a tombstone
so a paused write cannot resurrect the record afterwards.

**What the export is not.** A snapshot, not a backup: the links to the original
pages inside it are short-lived and stop working, so a file kept for a year holds
the summaries, corrections and consent history but not the scans. The response
says how long those links last, and the screen repeats it.

## KOO-14 — Controlled cloud environment and operational recovery

**Status: Blocked.** Commit `9f9fde5`. `DEPLOYMENT.md`.

The startup guard is implemented and tested: production with no provider key,
production against the local stack, and production at debug logging all refuse
to boot. `DEPLOYMENT.md` picks CDK over SAM with the reason, lists what must
exist, what must not ship, the content-free signals worth alarming on, and
runbooks.

**Every cloud step is blocked** on an account and authorisation this session
does not have. None is marked complete.

## KOO-15 — Demonstrate both journeys and record the release decision

**Status: Partly satisfied.**

### Gates actually run, at the end of this work

Commit `bf13ab5`, 2026-09-09, after wiring the daily-care records to `/v1`.
Earlier rounds' numbers are kept in their own sections below so the rounds can
be compared (`a999da8`: 844 app / 590 backend; `9c0aa01`: 885 app / 628
backend; `134c9dc`: 897 app / 643 backend).

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` (app) | **pass**, exit 0 |
| `npx eslint .` (app) | **pass**, exit 0 |
| `npx jest` (app) | **pass** — **933 tests / 59 suites** (371 at baseline) |
| `npx tsc --noEmit` (backend) | **pass**, exit 0 |
| `npx eslint .` (backend) | **pass**, exit 0 |
| `SKIP_OCR_TESTS=1 npx vitest run` (backend) | **pass** — **670 passed, 92 skipped** (410 / 79 at baseline) |
| `npx vitest run` (backend, no skip) | **fail** — the same 6 `tesseractOcr` tests, unchanged from baseline and environmental |

### The two blocked gates, with their actual errors

Both were re-checked at the end of this work. Neither has moved, and neither is
a defect in this branch.

**The local stack cannot start.** In this session there is no Docker daemon at
all — `docker compose pull` answers:

```
unable to get image 'amazon/dynamodb-local:2.5.2': failed to connect to the
docker API at unix:///var/run/docker.sock: no such file or directory
```

In the previous session the daemon ran and the registry refused the image
layers:

```
failed to copy: httpReadSeeker: failed open: failed to do request:
Get "https://production.cloudfront.docker.com/registry-v2/.../data?...": Forbidden
```

and the network policy confirmed it: `production.cloudfront.docker.com:443 ->
connect_rejected (gateway answered 403 to CONNECT)`. Either way DynamoDB Local,
MinIO and ElasticMQ never come up, and the 92 stack-dependent tests stay
skipped.

**OCR language data cannot be downloaded.** Running the OCR suite without
`SKIP_OCR_TESTS=1` produces:

```
Error: Network error while fetching
https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz.
Response code: 403
```

Six tests then time out at 30s each. The repository's own `SKIP_OCR_TESTS`
switch exists for exactly this; it is recorded here rather than hidden.

### What the 92 skipped backend tests are

Not incidental. They are every test that needs the local stack: the `/v1` API
end to end, the record repository's tenant-isolation tests, the ADR-005
conditional-write and migration tests, and PDF processing. They are **written
and unrun**, and the conditional writes they cover are the one part of KOO-03
that a fake cannot demonstrate.

### The synthetic two-account journey

The reviewer asked for a demonstration that a second account sees the right
thing. What exists, and what it is worth:

| Step | Where it is proven | What it does not prove |
| --- | --- | --- |
| Second account pulls queued, failed, review-needed and completed reports and sees each state correctly | `src/services/sync/pullService.test.ts` — a synthetic server, the real `pullRecords`, the real merge, the real vault store | It ran against a fake `fetch`, not against the Fastify app |
| The completed summary can actually be opened | same file — `selectSummaryForDocument` returns the pulled summary | as above |
| Refresh and relaunch do not duplicate or lose records | `mergeDocuments.test.ts`, `pullService.test.ts` | as above |
| Revocation removes the record, its documents and its summaries from the second device | `pullService.test.ts` | as above |
| A synthetic report produces a persisted summary only with consent, and none without | `backend/test/integration/consentWiring.test.ts` — the real worker, the real repository port, the same `consentFor` wiring `worker.ts` uses | It used the in-memory repository fake, not DynamoDB Local |
| Grants, roles and refusals on every `/v1` route | `backend/test/unit/*Routes.test.ts` — the real Fastify app via `app.inject`, real tokens | Storage is the in-memory fake, so conditional writes and key shapes are untested |
| One account creates a follow-up, the second sees it, completes it, and the completion comes back | `src/services/sync/pullService.test.ts` (both directions through the real merge and store) and `backend/test/unit/followUpRoutes.test.ts` (create → lost response → retry → edit → delete, as one task) | The two halves are proven separately, against a fake `fetch` and an in-memory store. No request has crossed a network |
| An erasure that is interrupted, and a write that races it | `backend/test/unit/privacyRights.test.ts`, and the adapter's own paging in `patientRecordRepository.test.ts` against a faked DynamoDB client | The fence and the paging are proven; DynamoDB's real page boundaries and its conditional writes are not |

**No document has travelled from a camera through upload, a worker, a provider
and back to a second account's screen.** That needs the local stack at minimum.
Nothing in the table above substitutes for it, and none of it is offered as a
substitute.

### Readiness

| Level | State |
| --- | --- |
| **Demo ready** | Yes, for both shells and the flows built on the local vault. The demonstration build seeds fictional records, cannot reach a server, and says so above the fold |
| **Synthetic cloud pilot ready** | **No.** Requires the local stack, then a cloud environment; neither has been exercised |
| **Real-patient pilot approved** | **No.** Requires everything above plus the privacy, provider, legal and operational gates in `DATA_HANDLING.md`, none of which is closed |

## Review round two — what the owner asked for, and what happened

Six items on PR #1. Each is recorded here with what changed and what is still
open.

| # | Item | Outcome |
| --- | --- | --- |
| 1 | Consent persisted, versioned, authorised, and wired into the worker | **Fixed.** `CONSENT#<purpose>#<decidedAt>` items, append-only; `GET/POST /v1/patients/:id/consent` and `/consent/history`; new `manage_consent` action held by `self` and `manager` only; a stale notice version is refused with 409; `worker.ts` now passes `patients.listConsent`. 27 tests across `consentRoutes` and `consentWiring` |
| 2 | Reconciliation inventing document completion | **Fixed.** The list route joins processing state and `hasSummary`; `toAppStatus` writes out every branch; `needs_review` added to the app; completed summaries are fetched during a pull so `ready` means openable. 37 tests across `reconcile`, `mergeDocuments`, `pullService`, `documentListing` |
| 3 | The parent Today dose flow | **Fixed.** Schedules confirmed by a person, doses from `occurrences.ts`, both answers offered explicitly, undo append-only, the answered dose held on screen. One real defect found by its own test: `dosesPerDayFrom` read "thrice daily" as one dose a day |
| 4 | Review screen, observations, visit prep, follow-up CRUD | **Fixed.** All four, plus the outbox connected to a sender for the first time. AI proposals open a confirmation and never create anything themselves |
| 5 | Export and deletion with per-record permissions | **Fixed.** Per-record export naming the role it was produced under; `self`-only record deletion with a typed name; account deletion that refuses to strand a record and names the ones that would be. Two false promises removed from the UI — a seven-day grace period and an emailed download link, neither of which existed |
| 6 | Evidence gaps | **Partly closed.** Gates re-run and recorded above with the commit SHA; the synthetic two-account journey is proven at the level stated in the table above. The two blocked gates are unchanged, with their actual errors recorded |

## Review round three — the five functional blockers

Posted on PR #1 against `49484d2`. All five were locally executable and all five
are fixed; each is its own commit, and each is stated below with what it does
not cover.

| # | Item | Outcome | Commit |
| --- | --- | --- | --- |
| 1 | Follow-up creation lost its identity; a retry could duplicate the task | **Fixed** | `8d6bef5` |
| 2 | Shared follow-ups had no pull path | **Fixed** | `3f6baf0` |
| 3 | Record deletion could report success while retaining data | **Fixed** | `527048b` |
| 4 | Withdrawing consent mid-job left a permanent `processing` state | **Fixed** | `51c3dbe` |
| 5 | The per-parent export asked for the whole account and produced no file | **Fixed** | `9c0aa01` |

**1 — Identity.** The device's id travels with the create and the server takes
it, so a task keeps one identity from the moment somebody types it. The create
is idempotent on that id: a POST naming a task that already exists returns it
with a 200, no second row and no second audit entry. The id is constrained to
characters that cannot forge a sort key, and a response carrying a different id
fails loudly rather than being reconciled silently — the alternative surfaces
much later as a 404 on an edit, a long way from its cause. `missed` was added to
the statuses the server accepts: the app has always had it, so "we missed
Thursday's clinic" was being saved on one phone and rejected on its way to
everybody else's.

**2 — Pull.** Follow-ups are fetched with each record's documents, in the same
pass and under the same failure handling. `mergeFollowUps` holds the rules: a
change still in the outbox keeps this device's row, otherwise the server wins,
and a task the server no longer returns has been deleted by somebody — unless
that record was not pulled at all, in which case a failed request is evidence of
nothing. A status or kind this app does not recognise reads as `scheduled` and
`other` rather than being cast, because an unknown status must never render as
done. Observations, treatments and dose events remain local-only, as before, and
`mutationSender` still refuses them explicitly rather than queueing against a
route that does not exist.

**3 — Deletion.** Two defects. The sweep ignored `LastEvaluatedKey`, so a record
larger than one query page lost its first page and kept the rest while reporting
that it was gone; every query in the repository had the same shape, so listing a
large record was silently truncated too. And nothing recorded that a deletion was
under way, so an upload signed a minute earlier or a worker finishing an older
job wrote rows in behind the sweep. A deletion is now an operation: a marker goes
down first and every write path answers `410 Gone` while it stands, bytes go
before rows, grants are revoked with the caller's own last, and the marker comes
down only at the end — which is what makes a second call a resume rather than a
fresh deletion of a record that is already half gone. A resume does not ask for
the typed name again, because the profile row it would be checked against is
already deleted; it is still `self` only.

**4 — Consent withdrawn mid-run.** The result was correctly discarded and the
document was left saying `processing` for ever, with the job acknowledged and
nothing left in the queue to move it. It now ends at `manual_review` /
`ai_not_permitted`, which is terminal on purpose — and
`POST .../processing/resume` is the way back for somebody who changes their mind,
taking `manage_consent` rather than `upload_document`, because the decision being
acted on is the consent decision itself.

**5 — Export.** The per-parent screen called the account-wide endpoint, so
somebody helping with two parents got both people's histories from a button
naming one of them. It now calls the per-patient endpoint and writes the file to
the share sheet, so the copy can actually leave. The file is deleted as soon as
the sheet closes: a JSON file holding a medical history, sitting in app storage
where no deletion path knows about it, is the second copy the export is designed
not to create.

**What these do not prove.** Every test above ran against a fake `fetch`, the
in-memory repository, or a faked DynamoDB client. The two blocked gates are
unchanged. **No document has travelled from a camera through upload, a worker, a
provider and back to a second account's screen**, and no follow-up has crossed a
real network between two accounts. The readiness levels below are unchanged.

## Review round four — five findings against the round-three work

Reviewed at `f63f6e7`, with four of the five reproduced by the reviewer against
the fetched source. All five are fixed.

| # | Item | Outcome | Commit |
| --- | --- | --- | --- |
| 1 | The deletion marker did not atomically prevent writes | **Fixed** | `c44c649` |
| 2 | Follow-up creation was a check-then-write, not idempotent under concurrency | **Fixed** | `dc788ec` |
| 3 | A pending local deletion was undone by the next pull | **Fixed** | `d0656f8` |
| 4 | Calendar ids from another device were applied locally | **Fixed** | `b9e3c47` |
| 5 | A failed queue send made the resume endpoint unretryable | **Fixed** | `ea3b39e` |

**1 — The write guard.** Round three read the marker and then wrote, which is a
race whatever the gap: the erasure could complete between the two, and the
summary landed in the partition it had just emptied. The condition now travels
with the write — every clinical write is a transaction carrying a check that the
marker does not exist — so it is evaluated at commit rather than when the handler
last looked. That covers the two writes that were missed as well: the
`processing` row at the start of a run, and the failure row in the catch path.
The marker is no longer removed at the end but becomes a **tombstone**, which is
what refuses a write that was paused during the sweep and resumed after it: the
one row an erasure leaves behind, holding a patient id, who asked and when.
Objects are swept **by prefix** rather than by keys derived from rows, because
bytes uploaded through a URL signed before the deletion have no row to derive a
key from; the prefix is swept again after the rows go, and the response reports
the window in which a presigned URL can still write, rather than implying the
bytes are certainly all gone.

**2 — The claim.** A read followed by a write is not idempotency. One item per
follow-up id, written with `attribute_not_exists` in the same transaction as the
row, so exactly one of two racing creates commits; the loser is answered with the
task that exists. Keyed by the id alone, because the row's key contains the due
date and a rescheduled task would otherwise escape its own guard — rescheduling
is now a move, in one transaction, leaving the claim alone. The claim outlives
the row, carrying `deletedAt`, so a delayed duplicate cannot resurrect a deleted
appointment.

**3 — Pending deletions.** The merge knew which ids had queued changes but not
what they were, and a delete has no local row to protect: the screen removes it
before queueing the request. The operation now travels with the id. An
unreadable outbox is a third answer, `unknown`, and stops the follow-up merge
entirely — reading a queue error as "no local changes" is exactly how somebody's
deletion comes back.

**4 — Calendar ids.** `calendarMappings` was written, tested and had no caller.
It has one now: the screen asks the device mapping whether *this* phone has an
event, nothing about an event is pushed, a pulled follow-up always arrives with a
null event id, and `attachCalendarEvent` is gone from the store.

**5 — Resume.** A queue refusal restores the record and answers 503 retryable,
instead of leaving the report queued with the state a retry needs already spent.
A resume whose response was lost re-enqueues rather than being refused.

**What these still do not prove.** The transaction conditions and the claim are
DynamoDB semantics, and the 92 stack-dependent tests remain unrun, so they are
demonstrated against the in-memory fake and a faked DynamoDB client — the fake
models the refusals, which is what the routes are written against, but only the
real service can show two writers actually racing. The share sheet still needs an
iPhone. The rest of the limits below are unchanged.

## Daily care reaches the shared record

The last shared-care acceptance criterion that was unstarted rather than
blocked. Observations, treatments and dose events were built, tested, encrypted
and stored on one phone; `mutationSender` refused them explicitly because no
endpoint existed. `/v1/patients/:id/observations`, `/treatments` and
`/dose-events` now exist, the app sends to them, and a pull brings back what
the other carer recorded.

| Piece | Where |
| --- | --- |
| Endpoints, repository records, guarded writes | `cf96c87` |
| Sending: `mutationSender`, `dailyCare.ts`, five screens | `d0866b0` |
| Pulling: `reconcile`, `mergeDailyCare`, the store | `bf13ab5` |

The properties that make these safe to share, each with a test:

- **A note is words and nothing else.** No severity, no triage category, no
  clinical term; a test asserts the stored keys, so adding one has to be
  deliberate. Editing carries the version it was made against, because two
  family members editing one note is not a rare case here.
- **A medicine cannot exist without a confirmation.** `confirmedBy` and
  `confirmedAt` are required and the pipeline has no path to write one.
  Stopping supersedes; a repeated stop keeps the first date.
- **A dose event is append-only, everywhere.** No PATCH, no DELETE, on the
  server or in the sender. Undo appends and says it is an undo. `recordedBySelf`
  comes from the grant on both notes and doses, never the body.

**Two real defects the wiring found**, both fixed with the work:

1. **A fast double tap recorded two events for one tablet.** `recordDose`
   refuses to produce an event when the occurrence already says what the tap
   says — but both handlers of a double tap read the same occurrence, taken
   before either ran. The store is the only place that can see the truth, so it
   drops a repeat and returns what it actually recorded; the screens send that
   answer rather than what they hoped to record.
2. **An undo tapped in the same millisecond as the dose was ignored.**
   `occurrencesForDay` ordered by `recordedAt` and broke ties with the id, whose
   suffix is random — so half the time the undo lost and the person watched
   their correction vanish. The supersedes chain decides now; the clock only
   orders what is left. Found because a date-dependent test began failing when
   the clock passed midnight, which means it had been there all along.

**Still only sent from where the screens exist.** Observation edit and deletion,
and stopping a medicine, have endpoints and queue helpers but no screen calls
them yet — the store actions have had no callers since they were written. That
is the same "built and unwired" pattern this branch has hit repeatedly, and it
is recorded here rather than left to be found.

## Resume checkpoint

Next, in order:

1. **Get the local stack running** in an environment that can reach a container
   registry, and run the four skipped integration suites. They remain the
   highest-value unrun evidence in the repository.
2. **Run the two-account journey against the real stack**, end to end, with a
   synthetic report going through the worker.
3. **Build the screens for the paths that now exist but nothing calls**:
   editing and deleting a note, and stopping a medicine. The endpoints, the
   queue helpers and the store actions are all there and tested; no screen uses
   them.
4. **Exercise the export and the share sheet on a device.** The file is written
   and offered; whether the sheet behaves as intended on iOS and Android is
   untested here, like everything else native in this branch.
5. Everything in `DEPLOYMENT.md` § "What is blocked", once there is an account.
