# Claude implementation prompt

Use the following as the implementation brief for this repository. The short launcher points here so this full prompt can be versioned with the stories.

---

You are implementing Koode, the family health application in `ayunetz-healthvault/healthvault`. The founder approved the visual direction in `docs/koode/design-reference/index.html` and wants both a main caregiver experience and an individual parent's own experience. Implement the backlog in `docs/koode/STORIES.md`, extending the existing application rather than rebuilding it.

## First actions

1. Inspect the working tree and current repository instructions, including AGENTS.md/CLAUDE.md if present. Preserve unrelated changes and use the repository's normal workflow.
2. Read `docs/koode/README.md`, `BASELINE.md`, `DESIGN.md`, `STORIES.md` and `PROGRESS.md`.
3. Read the applicable existing `docs/architecture/` plans, ADRs and recent progress, plus the actual source for the next story. Resolve stale comments against implementation. The supplied source baseline is commit `ecb38d284bacc7989aa7fe20470fa6582dc60a90`; do not assume it is still HEAD.
4. Open the local HTML reference using an available local preview/browser. Its private hosted URL may not be accessible. Read the CSS and interactions too. Treat it as a visual/task-flow reference, not production code, an identity system, a medical source or a requirement to use a WebView.
5. Complete KOO-00, then implement the remaining stories in dependency order. Start the first native visual slice early; its synthetic preview is useful while real integrations are being completed.

## Product outcome

- Caregiver: a clear family overview, parent-specific attention items, records, appointment preparation and assigned follow-ups.
- Parent: a simpler Today screen, their own health record, large controls for confirmed medicine occurrences, document capture, symptom notes and upcoming visits.
- Both: separately authenticated identities, explicit per-parent access, attributed changes and truthful offline/sync status.
- Match the approved palette, layout hierarchy, spacing and approachable language. Preserve the existing document capture, findings/medicine display, source references, parent details, follow-ups and calendar confirmation.

## Architecture boundaries

Keep Expo/React Native, current backend separation, S3-compatible storage, DynamoDB and the SQS-compatible queue. Reuse the existing OCR/PDF/redaction/leakage/summary/source-validation pipeline. The current app has mock mobile auth, unencrypted AsyncStorage records, incomplete mobile `/v1` wiring and no processing worker; verify these findings before implementing them.

Do not introduce PostgreSQL, replace OCR with phone ML Kit, rewrite the app, broadly upgrade dependencies or replace the backend solely for preference. Document a concrete requirement and an ADR if an existing approach cannot meet the acceptance criteria. The existing Phase 2 Textract plan is a provider option to reconcile, not proof of a working integration.

Parent profiles currently live in caregiver-owned partitions. Implement a deliberate patient/record identity and access-grant model with a safe migration. Never solve family sharing by accepting an arbitrary ownerId, sharing login credentials or changing a client-side role flag.

Use protected persistent storage for both local records and original files, with account-scoped state. Keep the original document, extracted draft, model output and human corrections distinct. Require explicit confirmation before AI-proposed follow-ups or treatment instructions become actionable records. Missing medicine confirmation is not evidence a dose was missed.

## Execution contract

- Use stable KOO IDs. Break oversized stories into bounded child tasks and make reviewable commits per coherent slice. Do not silently reduce scope.
- Before each story, identify which existing pieces can be reused and what acceptance criteria remain unsatisfied. An already implemented criterion needs evidence, not redundant replacement code.
- Implement working flows rather than new placeholders. Synthetic fixtures are appropriate for the design slice and tests; production must not silently substitute them for failed auth or AI.
- Proceed autonomously on local implementation and routine reversible choices. Do not ask for permission after every story. Ask only where a material product ambiguity, external access requirement or actual permission boundary prevents progress.
- If a cloud account, provider credential, device or approval is missing, finish all locally verifiable work, document the exact blocked criterion, and continue independent stories. Do not mark the blocked gate as passed.
- Keep `docs/koode/PROGRESS.md` current with status, decisions, changed files, tests actually run and evidence/limitations. Update the existing architecture progress when implementation changes its status; retain history.
- On session/context limits, leave a precise checkpoint and next step so another run can continue without restarting.

## Verification

Use the existing scripts from package.json: `npm run verify` for the app and `npm run backend:verify` for backend verification. The local stack uses `npm run stack:up`; do not reset/delete existing local data casually. Inspect current scripts before running them.

During development, run focused tests that prove behavior and access boundaries; run the relevant full verification gate before handing off a finished slice. Record any baseline failures and skipped infrastructure tests. Do not call unavailable tests passed or copy historical test counts as your own results.

Prioritize cross-account denial, per-parent grants/revocation, encrypted migration and account switching, offline replay, upload interruption, idempotent queue dispatch/worker retries, source-linked review, consent/deletion races, calendar duplication/timezones and low-confidence OCR handling. For changed UI, compare native screens with the supplied reference on small/large phones and enlarged text, and provide screenshots or explain which platform could not be tested.

A redaction check is not proof of anonymisation, a source consistency check is not clinical validation, and local emulators are not proof of AWS IAM/residency or a successful live provider integration.

## External actions and real data

This brief authorizes implementation of the requested backlog within the actual permissions of your session. It does not authorize spending money, provisioning paid cloud resources, sending invitations/messages to real people, force-pushing or releasing to production. Honor any later explicit founder authorization without repeatedly asking for it.

Use synthetic health data for development and validation. Never commit patient reports or credentials, put LLM keys in EXPO_PUBLIC variables, or log clinical content. Honor the repository's existing real-patient/privacy/security/provider/legal/operational acceptance gates. Complete reviewable configuration and runbooks before requesting an external action; approvals should concern concrete changes.

## Handoff after each substantial slice

Report completed story IDs, the user-visible behavior delivered, evidence actually collected, remaining blockers and the next story. Link the relevant commits/screenshots. Distinguish demo-ready, synthetic-cloud-pilot-ready and real-patient-approved. Do not describe unfinished integration as complete simply because the screen renders.

Begin now with KOO-00 and the earliest executable implementation slice. Do not stop after producing another plan.
