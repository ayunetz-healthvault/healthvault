# Koode user stories

Each story has stable ID, dependencies, source touchpoints, acceptance criteria and validation evidence. “Implemented” below means code exists in the reviewed baseline, not that a deployment was validated. All stories start **Not started**; use PROGRESS.md as the live status ledger.

Priority: P0 = required for a trustworthy shared-record MVP; P1 = the requested two-persona experience. Both are in scope. Work sequentially by dependencies unless the user later requests parallel work. Split large stories into child tasks without silently dropping acceptance criteria.

## KOO-00 — Reconcile the baseline and plan the first slice

**Priority:** P0 · **Dependencies:** none · **Type:** enabling

As the implementer, I need a trustworthy map of current code so I extend working features rather than rebuilding them.

**Reuse / inspect:** package scripts, current repository instructions, `docs/architecture/`, BASELINE.md, DESIGN.md, `src/theme/`, `src/types/domain.ts`.

**Acceptance criteria**

- [ ] Record current branch/commit, working-tree state and applicable instructions. Preserve unrelated user changes.
- [ ] Reconcile the source baseline with current code and classify every story as new, extension, integration or already satisfied with evidence.
- [ ] Identify the active mobile/backend modes, available local tools, test commands and absent external credentials without printing secrets.
- [ ] Map overlap with the existing P1/P2 plan; keep its completed functionality and note stale comments rather than trusting them.
- [ ] Record a bounded implementation sequence and split stories too large for one reviewable change.
- [ ] Run a baseline check appropriate to the next change; record failures as pre-existing or new. Do not claim unavailable AWS/device/provider checks passed.

**Evidence:** baseline entry and dependency plan in PROGRESS.md. No application rewrite or unrelated dependency upgrade.

## KOO-01 — Apply the approved native design to both experiences

**Priority:** P1 · **Dependencies:** KOO-00 · **Type:** extension

As a caregiver or parent, I want clear, consistent screens that make the next useful action easy to find.

**Touchpoints:** `src/theme/tokens.ts`, `src/components/ui/`, `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx`, `app/parent/[id]/index.tsx`; new parent navigation as needed.

**Acceptance criteria**

- [ ] Adapt the reference's green/cream/peach palette, card hierarchy, spacing and typography using native components and shared tokens.
- [ ] Build caregiver Home/Family/Calendar/To-do and parent Today/My health/Calendar/Family navigation shells, initially with explicitly synthetic fixtures.
- [ ] Make parent main actions large, labels plain, and patient context unambiguous. No comparison toolbar or unrestricted persona impersonation in a live build.
- [ ] Preserve existing capture, document detail, parent edit and follow-up routes; add redirects when routes change.
- [ ] Handle first-use, empty, loading, failure and offline displays; no invented medicine or health-status claims.
- [ ] Complete compact-phone and large-phone checks, native text scaling at 200%, screen-reader labels, contrast and focus/touch checks on changed flows.

**Evidence:** route/interaction checks and screen captures or documented unavailable-device limitation. Live data wiring is in later stories, not falsely marked complete here.

## KOO-02 — Sign in to a real account and select the correct experience

**Priority:** P0 · **Dependencies:** KOO-00 · **Type:** integration

As a parent or caregiver, I want my own account so access to health records does not depend on sharing a password.

**Touchpoints:** `src/services/auth/authService.ts`, `src/state/sessionStore.ts`, `src/navigation/useRouteGuard.ts`, auth/onboarding screens; backend identity config and verifier.

**Acceptance criteria**

- [ ] Replace live mock branches with configured Cognito sign-up, verification, sign-in and recovery. Keep synthetic demo sessions explicitly separate.
- [ ] Implement token expiry, refresh and server-side sign-out/revocation behavior; clear credentials on logout and coordinate vault isolation with KOO-04.
- [ ] Parent onboarding can establish their own record; caregiver onboarding can start a managed profile or request access. A UI role is not an authorization grant.
- [ ] Support a user having a self record and authorized helper access without using one role flag to grant all permissions.
- [ ] Protect deep links and private routes. Live mode fails clearly if auth is unconfigured; it never falls back to demo users or fake tokens.
- [ ] Reuse the existing backend token verifier and development issuer safeguards. Cognito client configuration contains no client secret in the mobile bundle.

**Evidence:** local contract/expiry/error tests; a separate synthetic-account Cognito test when an authorized environment exists. Record live auth as unverified until that test passes; cloud infrastructure is KOO-14.

## KOO-03 — Give each parent a shared record with explicit access grants

**Priority:** P0 · **Dependencies:** KOO-00, KOO-02 · **Type:** new capability / migration

As a parent, I want to decide who can see or contribute to my record and withdraw that access.

**Touchpoints:** `src/types/domain.ts`, backend `services/records/keys.ts`, `RecordRepository.ts`, `routes/v1/shared.ts`, parent/document routes, Family screens.

**Acceptance criteria**

- [ ] Write an ADR for a stable patient/record identity, record ownership or legitimate management authority, actor identity and per-record grants. Preserve S3/DynamoDB; choose an additive migration instead of granting access to a caregiver's entire USER partition.
- [ ] Define at least owner/self, helper contributor and read-only permissions; record grantor, grantee, scope, status and timestamps. Helpers cannot grant themselves access or change ownership.
- [ ] Implement expiring, single-use invitation/acceptance through authenticated accounts. An invitation token alone cannot read records. Test with synthetic recipients; do not send real invitations without user authorization.
- [ ] Existing caregiver-created profiles remain usable by that caregiver, but do not auto-link to a parent by name, phone or email. Define an explicit verified claim/link flow and migration mapping.
- [ ] Check grants on every record API, upload/download URL issuance, sync read/write, task action and queued job. Authorization is not just a client filter.
- [ ] Revocation denies subsequent server operations and prevents stale queued uploads/jobs from publishing unauthorized results. Document the bounded lifetime of already-issued presigned links and offline cached copies.
- [ ] Record who added/changed each item; keep audit metadata free of clinical text. Provide a revocation view and clear permission-denied state.

**Evidence:** two-account positive sharing tests plus unrelated-user, cross-parent, read-only write, forged record ID, expired invitation and revoked-access negative tests. Migration dry-run/rollback on synthetic data, without orphaned documents.

## KOO-04 — Encrypt and isolate records and original files on the phone

**Priority:** P0 · **Dependencies:** KOO-00, KOO-02 · **Type:** replacement of unsafe persistence

As a user, I want offline access without leaving readable health records or another account's data on the device.

**Touchpoints:** `src/services/storage/persistence.ts`, `secureStorage.ts`, `src/state/vaultStore.ts`, session store, capture service and app lock.

**Acceptance criteria**

- [ ] Replace plaintext health-record persistence with an encrypted native store using a maintained implementation compatible with the current Expo native build. Document key generation, storage and loss/recovery; SecureStore holds keys/tokens, not report payloads.
- [ ] Protect original PDFs/images separately; database encryption does not encrypt files referenced by URI. Move pending originals out of evictable picker cache into a durable protected upload area.
- [ ] Partition all cached records, upload queues and files by authenticated account. Switching accounts, sign-out and local wipe must not expose the previous account's content.
- [ ] Migrate existing local records safely: verify encrypted write/read before removing plaintext. On failure, retain recoverable data without silently clearing the vault.
- [ ] Define backup inclusion/exclusion and restore behavior for keys and health files. Lost keys produce an explicit recovery/resync flow, not a blank success state.
- [ ] Honor application lock and background privacy; lock alone is not described as encryption. Revocation/logout purge downloaded material at the next available authorization check, with offline limitations disclosed.
- [ ] Unuploaded originals survive app restart; cleanup occurs only after confirmed durable upload or explicit discard. Bound the cache size without silently deleting pending work.

**Evidence:** app-restart, account-switch, migration failure and file-cleanup tests; inspection of stored artifacts for plaintext fixture values; native-build verification for encryption. Do not claim Expo Go alone validates native encryption.

## KOO-05 — Synchronize shared records with honest offline states

**Priority:** P0 · **Dependencies:** KOO-03, KOO-04 · **Type:** integration

As a family member, I want changes to appear on authorized devices and know when a change is only saved locally.

**Touchpoints:** `src/state/vaultStore.ts`, `src/services/api/{client,endpoints}.ts`, record repository and `/v1` routes; add a sync service/outbox.

**Acceptance criteria**

- [ ] Reconcile parents, documents, summaries and later treatment/note/task records with the backend; remove the assumption that local writes alone update the shared record.
- [ ] Add a durable encrypted outbox with mutation IDs, record versions, bounded retries and backoff. A network timeout after server commit must not duplicate the record.
- [ ] Distinguish saved locally, syncing, synced, failed and conflict states; show last successful sync. Refresh on foreground and after acknowledged writes without promising instant background execution on mobile.
- [ ] Handle pagination/delta retrieval and tombstones so deletions are not resurrected by an old device.
- [ ] Reject stale writes after revocation; clear inaccessible cached records when discovered. Pending local writes cannot grant permissions or restore deleted records.
- [ ] Define conflict handling: concurrent clinical edits must be reconciled or surfaced, not silently overwritten by a device clock. Append-only observations remain attributed.
- [ ] Provide explicit retry/recovery controls and keep demo storage separate from live accounts.

**Evidence:** two simulated accounts/devices; offline edit/restart/reconnect, lost response, concurrent edit, revoked access and delete/reconnect tests. Validate the last-sync UI and duplicate-free replay.

## KOO-06 — Connect durable document capture to the existing upload API

**Priority:** P0 · **Dependencies:** KOO-03, KOO-04, KOO-05 · **Type:** integration / hardening

As a parent or caregiver, I want a multi-page report uploaded to the correct record even when connectivity is interrupted.

**Touchpoints:** `app/capture/`, `uploadService.ts`, `documentPipeline.ts`, `backend/src/routes/v1/documents.ts`, `ObjectStore.ts`.

**Acceptance criteria**

- [ ] Reuse capture, gallery and PDF selection; review/reorder/remove pages and confirm patient/date/category before upload. Make mobile/backend file and page limits consistent.
- [ ] Use authenticated create → presign → direct upload → complete APIs. Track server-issued IDs rather than treating locally generated IDs as cloud IDs.
- [ ] Persist progress and original bytes, renew expired URLs through authorized APIs, and resume/retry without duplicate records or pages. App closure must not lose the pending report.
- [ ] Validate content type from bytes, supported file structure, byte/page bounds and exact expected page set before processing. Reject duplicate/out-of-range page numbers and unexpected object replacement.
- [ ] Make upload completion and job dispatch recoverable across partial failures: a claimed idempotency key followed by queue failure must not leave the document permanently queued with no job. Use a recoverable dispatch/outbox design.
- [ ] Expose awaiting upload / uploading / queued / failed separately. Do not delete the local original before durable receipt is confirmed.
- [ ] Enforce grants for URL issuance and completion; avoid identifiers in object names, logs or error messages.

**Evidence:** real local-stack upload protocol tests with missing/duplicate pages, expired URL, interrupted PUT, duplicate completion, queue outage and account mismatch. No live patient files.

## KOO-07 — Process queued reports and persist validated AI summaries

**Priority:** P0 · **Dependencies:** KOO-03, KOO-06 · **Type:** new worker reusing existing pipeline

As a user, I want processing to finish after upload even when I close the app, with recoverable failures instead of a permanent spinner.

**Touchpoints:** `backend/src/services/queue/JobQueue.ts`, `DocumentProcessingOrchestrator.ts`, OCR/PDF/redaction/summarisation/validation services, processing records; add worker entrypoint.

**Acceptance criteria**

- [ ] Implement a queue consumer using the existing adapters and orchestrator. Read expected stored pages and persist stage, summary, version and failure metadata; wire mobile polling to `/v1` instead of the synchronous development endpoint.
- [ ] Use job leases/visibility handling, idempotent processing, bounded retries and a dead-letter/manual retry path. Crashes and duplicate delivery must not duplicate summaries or follow-ups.
- [ ] Recheck record existence, grant/consent validity and deletion state at execution and before result commit. Do not recreate a deleted record from an old job.
- [ ] Preserve PDF text extraction, page numbering, Tesseract, profile-aware redaction, leakage gate, schema and source checks. Do not send originals or known direct identifiers to the LLM. Redaction remains fallible and must not be called anonymisation.
- [ ] Expose low OCR confidence, unreadable pages and unsafe/invalid output as review-needed or failure, with original access. No guessed medication/dose or invented laboratory value fills a missing field.
- [ ] Verify Sarvam request/response compatibility against current provider documentation and then an authorized synthetic live call. Missing credentials in a live production mode must fail clearly; mock output is only for explicitly labeled demo/test configuration.
- [ ] Cache successful document/version results, bound payload/token/retry usage, record content-free latency/failure/cost metadata and clean temporary derived files on success/failure.
- [ ] Preserve the OCR provider interface. Textract remains a documented phase-2 option; do not replace Tesseract or add a phone OCR dependency without measured justification and an ADR.

**Evidence:** local-stack upload-to-persisted-summary test, worker restart, duplicate delivery, poisoned job/DLQ, provider timeout, leakage rejection, source mismatch and deletion race. Provider and AWS checks are separate evidence gates, not implied by mocks.

## KOO-08 — Review the original beside AI output and preserve corrections

**Priority:** P0 · **Dependencies:** KOO-01, KOO-05, KOO-07 · **Type:** extension

As a parent or caregiver, I want to check the report and correct an extraction without rewriting what the clinician originally provided.

**Touchpoints:** `app/document/[id]/index.tsx`, source/finding/medicine components, summary types and backend summary/review API.

**Acceptance criteria**

- [ ] Provide authorized viewing of every original image/PDF page from local protected storage or a short-lived download URL. A source reference opens the correct page and snippet when available.
- [ ] Clearly separate original, AI draft, human correction and user-reviewed status. Keep source document date distinct from upload date and detected date.
- [ ] Allow authorized correction of extracted dates, findings and medication text with actor/time/version history. Preserve the original and original model output; do not label human review as clinical validation.
- [ ] A new summary version or changed source invalidates previous review status appropriately; concurrent edits trigger version/conflict handling.
- [ ] Unclear values remain unknown with visible warnings; do not hide warnings on a low-confidence output after cosmetic edits.
- [ ] Extracted follow-ups/treatment instructions remain proposals. Creating a task or medicine schedule requires separate confirmation; review alone cannot prescribe, schedule or send notifications.

**Evidence:** page navigation, PDF multi-page source mapping, edit/version conflict, unauthorized correction, review invalidation and explicit follow-up confirmation tests; capture the reference-inspired native review flow.

## KOO-09 — Connect the main user's family overview

**Priority:** P1 · **Dependencies:** KOO-01, KOO-03, KOO-05, KOO-08 · **Type:** extension

As a caregiver, I want to know which parent needs my help and open the relevant record in one tap.

**Touchpoints:** caregiver dashboard, ParentCard, parent profile, vault selectors, new scoped family queries.

**Acceptance criteria**

- [ ] Populate the approved family cards, attention items and upcoming section using only authorized records. Compute counts and links for the correct parent/document.
- [ ] Keep overdue follow-ups visible and show review-needed documents as actionable administrative items, not automated clinical triage.
- [ ] Distinguish no data, not recorded, offline/stale, explicit missed event and completed event. Never equate a missing medicine confirmation with a missed dose.
- [ ] Reuse conditions, allergies, doctor details, documents and follow-up flows; preserve contributor attribution.
- [ ] Quick capture and task actions require explicit patient context. Family member selection does not change the signed-in identity.
- [ ] Revoked/removed parents disappear from sensitive counts, calendar details, search and drill-downs, not only their profile page.

**Evidence:** two-parent fixture scenarios with distinct records, revoked grants, empty state, stale data and overdue actions; user journey from Home to the exact original/review screen.

## KOO-10 — Give the parent a Today screen and confirmed medicine recording

**Priority:** P1 · **Dependencies:** KOO-01, KOO-03, KOO-05, KOO-08 · **Type:** new capability

As a parent, I want to see my next action and record whether I took a scheduled medicine using large, clear controls.

**Touchpoints:** parent Today/My health routes; new confirmed treatment and dose-event model/API; medicine source components and sync.

**Acceptance criteria**

- [ ] Show only the signed-in parent's self record, with confirmed medicine, next visit, capture and symptom shortcuts. No schedule means a useful no-treatment state, not a sample medicine.
- [ ] Introduce a confirmed schedule separate from AI medicine mentions. Require source/manual provenance, explicit confirmation, relevant start/end times and patient timezone; never infer a regimen from a generic medicine name.
- [ ] Define each dose occurrence and immutable event identity. Taken/Missed/undo records actor, occurrence time, recorded time and local-sync status. Repeated taps/retries cannot duplicate events.
- [ ] Only appropriately authorized actors can record events; a helper's entry is explicitly “recorded by helper”, not “confirmed by parent”.
- [ ] Handle schedule changes, overlapping edits, date boundaries, travel/timezone display and superseded occurrences. Undo retains an audit trail and does not change the prescription.
- [ ] Sync events to the caregiver after server acknowledgement. Explain that offline changes have not yet reached the helper.
- [ ] Never offer dose adjustment, double-dose advice or automatic escalation from an unrecorded dose. Default notification previews avoid medicine/condition detail.

**Evidence:** duplicate taps, offline replay, undo, changed schedule, expired schedule and timezone-boundary tests, plus parent-access and helper-attribution tests.

## KOO-11 — Record symptoms and prepare for a visit together

**Priority:** P1 · **Dependencies:** KOO-01, KOO-03, KOO-05, KOO-08 · **Type:** new / extension

As a parent or helper, I want observations and questions in one place for the next appointment.

**Touchpoints:** existing questions/source data in summaries, new observations/questions APIs and native visit preparation screens.

**Acceptance criteria**

- [ ] Add brief symptom/observation entry with user wording, occurrence time, impact, author and parent context. Do not derive a diagnosis or emergency classification from the entry.
- [ ] Add/edit/reorder user questions for a visit; distinguish user-authored questions from AI suggestions and retain provenance when a suggestion is accepted.
- [ ] Build a visit summary from selected reviewed documents, confirmed treatment, attributed observations and questions; display unresolved uncertainty and stale/offline data.
- [ ] Allow observations/questions to be corrected with version checks and sync, respecting read-only and revoked access.
- [ ] After-visit notes can create a proposed next step with source and assignee via KOO-12. Notes are not presented as a verified clinician document.
- [ ] Viewing/preparing a summary sends nothing to a clinician. Any later sharing/export uses explicit user action and authorization.

**Evidence:** two-person contributions to one visit, unrelated-parent isolation, conflict, offline save and source attribution; no automatic outbound communication.

## KOO-12 — Share next steps and use calendar reminders without duplicates

**Priority:** P1 · **Dependencies:** KOO-01, KOO-03, KOO-05, KOO-08 · **Type:** extension / backend integration

As a family member, I want to know who will do each follow-up and when it is due.

**Touchpoints:** follow-up screens/store/types, `calendarService.ts`, backend record methods; implement missing follow-up routes.

**Acceptance criteria**

- [ ] Implement persistent scoped follow-up CRUD. Extend existing statuses rather than losing scheduled/completed/missed/cancelled behavior.
- [ ] Require parent, title, provenance and explicit due date or “no date”; assignee must be a permitted record participant. Retain author/completer timestamps.
- [ ] Separate source recommendations from confirmed tasks; user confirms before creation. Completed tasks can be reopened without deleting history.
- [ ] Define who can edit/complete/reassign; preserve sync and optimistic-version checks. No cross-family assignment by guessed ID.
- [ ] Reuse the existing per-event calendar confirmation, show destination calendar and appointment timezone, and avoid duplicate events after retries. Explicitly handle update/cancel and permission denial.
- [ ] Track calendar mappings per user/device/calendar instead of sharing a single device event ID across all accounts. Minimize health information in calendar titles/notes by default and show the exact content before writing.
- [ ] Parent sees their relevant tasks; caregiver sees only permitted family tasks with truthful overdue/unsynced indicators.

**Evidence:** assigned-task lifecycle, confirmation gate, timezone conversion, device-specific mappings, offline duplicate prevention and revoked participant cases.

## KOO-13 — Make privacy choices, export and deletion work end to end

**Priority:** P0 · **Dependencies:** KOO-03–08, KOO-10–12 · **Type:** integration / missing backend operations

As the record owner or authorized manager, I want clear control over storage, optional AI processing, sharing and deletion.

**Touchpoints:** onboarding/privacy/delete screens, `accountService.ts`, backend account/record/object/queue services; add policy/consent records and export/deletion jobs.

**Acceptance criteria**

- [ ] Version the notices and record who agreed, when, for which record and purposes. Distinguish storage/service permission, optional AI processing and family sharing. A medical disclaimer is not privacy consent.
- [ ] Check AI permission when queuing, executing and committing results. Withdrawal stops future optional processing without silently removing unrelated service access; disclose limitations of requests already sent to a provider.
- [ ] Implement authenticated export with only permitted records, short-lived access and clear generation status; no emailed report or external transmission by default.
- [ ] Define helper account deletion versus deletion of a shared patient's record. Leaving a family cannot delete the parent's originals or other participants' records.
- [ ] Coordinate record deletion with objects, summaries, derived files, caches, outbox, pending jobs, versions and eventual backup expiry. Retries are safe; no resurrection from old jobs/sync.
- [ ] Publish a concrete retention/backups schedule and grievance/contact path. Do not promise instantaneous erasure from backups or downloaded copies when technically untrue.
- [ ] Document actual cloud/OCR/LLM locations, provider retention/training terms, subprocessors and applicable review gates; do not claim India-only processing merely from AWS_REGION or compliance merely from encryption/redaction.

**Evidence:** grant/consent withdrawal races, export isolation/expiry, deletion partial failure/retry, shared-record ownership and late worker result tests. Legal/provider review remains an explicit external gate, not a code-test assertion.

## KOO-14 — Prepare a controlled cloud environment and operational recovery

**Priority:** P0 · **Dependencies:** KOO-02–07, KOO-13 · **Type:** deployment readiness

As the operator, I want a reproducible, observable deployment with bounded spending and recoverable failures.

**Touchpoints:** existing `docs/architecture/phase-2.md`, ADR-003, stack config and service adapters; new infra/runbooks as required.

**Acceptance criteria**

- [ ] Reconcile existing CDK/SAM plans and select one implementation; keep Mumbai primary region, the existing storage/queue interfaces and a documented OCR runtime choice. No unrelated platform migration.
- [ ] Define private S3, required encryption/KMS permissions, DynamoDB backup/recovery, SQS/DLQ, identity, least-privilege service roles and HTTPS APIs in reproducible configuration.
- [ ] Keep the local identity issuer and development processing routes out of public production access; startup/config tests fail for unsafe combinations, mock live summaries or bundled credentials.
- [ ] Manage backend-only secrets and role-based credentials; separate dev/staging/production and prevent fixture seeding in live builds.
- [ ] Define content-free operational logs/metrics for upload, queue age, OCR/AI failure, latency and retry counts; add actionable alarms and per-environment budget controls.
- [ ] Record restore, rollback, DLQ replay, deletion recovery and credential rotation procedures; test with synthetic records in an authorized environment.
- [ ] Provide a reviewable resource/cost plan and deployment commands. Execute cloud creation, paid calls or production release only within actual user authorization; otherwise mark these checks blocked and continue local-verifiable work.

**Evidence:** infrastructure/config checks locally, then recorded authorized cloud smoke tests, denied cross-record access, original/summary persistence after app reinstall, restore drill and metering. Local emulators do not prove cloud IAM, residency or live service behavior.

## KOO-15 — Demonstrate both journeys and record the pilot release decision

**Priority:** P0 · **Dependencies:** KOO-00–14 · **Type:** acceptance

As the founder, I want a reviewable pilot build with honest evidence of what works for the parent and the caregiver.

**Acceptance criteria**

- [ ] Run the complete synthetic journey: independent accounts → invite/accept → parent report capture → durable upload → worker/OCR/AI → original-linked review → follow-up → caregiver sees the authorized result.
- [ ] Run the daily-care journey: confirmed schedule → parent Taken/Missed/undo → caregiver sees attribution → symptom and question → visit preparation → assigned next step → calendar confirmation.
- [ ] Run loss-of-connectivity/restart/reconnect, expired login, revoked sharing, provider outage, failed upload, unreadable document and deletion-with-pending-work scenarios.
- [ ] Verify approved design on compact and larger phones, scaled text, screen reader and intended platforms. Clearly distinguish device-tested functionality from web-only previews.
- [ ] Run repository verification commands for the final implementation; record failed/skipped tests and environments, not just counts. Do not mark acceptance complete with mocked-only cloud/AI evidence.
- [ ] Provide installation/testing instructions, synthetic fixtures, known limitations, rollback/recovery steps and a list of remaining external gates in PROGRESS.md and architecture progress.
- [ ] Separate “demo ready”, “synthetic cloud pilot ready” and “real-patient pilot approved”. Real data and production release require the existing repository's privacy/security/legal/provider/operational acceptance; founder approval cannot be inferred from a passing test suite.

**Evidence:** concise release checklist with links to changes, test output and screenshots; no identifiable medical reports. Mark only the readiness level actually supported.

## Explicitly outside this backlog

Autonomous diagnosis or treatment changes; hospital integrations/ABDM unless separately requested; billing; pharmacy ordering; autonomous monitoring agents; new cloud vendors or database rewrites; full multilingual rollout; automatic messages to clinicians/family. The existing broader roadmap may retain these as later work, but do not add them to satisfy these stories.
