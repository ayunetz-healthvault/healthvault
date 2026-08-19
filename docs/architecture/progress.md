# Delivery progress

A running record of which roadmap steps are done, what each one actually
changed, and what it deliberately left alone. Updated as part of finishing a
step — a step is not done until it has an entry here.

The plan documents ([phase-1.md](./phase-1.md), [phase-2.md](./phase-2.md)) are
the intent and do not change as work lands. This file is the record.

## Status at a glance

| Step    | Title                                     | State                            |
| ------- | ----------------------------------------- | -------------------------------- |
| P1-01   | Architecture contracts                    | Done — 2026-08-02                |
| P1-02   | Extend domain contracts                   | Done — 2026-08-02                |
| P1-03   | Backend project skeleton                  | Done — 2026-08-02                |
| P1-04   | Secure temporary upload handling          | Done — 2026-08-02                |
| P1-05   | OCR provider abstraction                  | Done — 2026-08-02                |
| P1-06   | Profile-aware deterministic PII redaction | Done — 2026-08-02                |
| P1-07   | Independent leakage gate                  | Done — 2026-08-02                |
| P1-08   | Summary provider and Sarvam integration   | Done — 2026-08-03                |
| P1-09   | Document-processing orchestrator          | Done — 2026-08-03                |
| P1-10   | Connect the Expo application              | Done — 2026-08-03                |
| P1-11   | Safety and traceability UI                | Done — 2026-08-03                |
| —       | Facility identity (ADR-002 decision)      | Done — 2026-08-04                |
| P1-12   | Phase 1 verification and exit review      | Run 2026-08-04 — 2 findings open |
| P1-13   | Close the exit-review findings            | Done — 2026-08-19                |
| P1-14   | Demonstration mode                        | Done — 2026-08-19                |
| ADR-003 | Local and cloud parity                    | Accepted — 2026-08-19            |
| P2-00   | The local stack, and the first two ports  | Done — 2026-08-19                |
| Phase 2 | Cloud platform                            | Building locally — see ADR-003   |

Phase 1 remains **synthetic data only**. No step below has changed that.

---

## P1-01 — Architecture contracts

**Done 2026-08-02** · commit `a740ae3`

Created the roadmap: [README.md](./README.md), [phase-1.md](./phase-1.md),
[phase-2.md](./phase-2.md), [ADR-001](./adr/001-ai-data-boundary.md),
[ADR-002](./adr/002-pii-redaction-strategy.md).

No application code was touched, which was the acceptance criterion.

---

## P1-02 — Extend domain contracts

**Done 2026-08-02**

### What changed

`src/types/domain.ts`

- `SourceReference` — `documentId`, 1-based `page`, optional `textSnippet`.
- `SummaryUncertainty` — a message plus the page it relates to, or `null` for
  document-wide.
- `RedactionCategory` — the twelve identifier classes from ADR-002.
- `PrivacyProcessingResult` — `redactionApplied`, `possiblePiiRemaining`,
  per-category counts, `pipelineVersion`.
- `ExplicitFollowUp` — a follow-up the document itself asks for, with a source
  and a confidence.
- `SummaryFinding` gained optional `unit` and `sources`.
- `MedicineMention` gained optional `duration` and `sources`.
- `DocumentSummary` gained optional `detectedDocumentDate`,
  `explicitFollowUps`, `uncertainties`, `privacy`, `pipelineVersion`.

`src/mocks/documents.ts`

- `sum_demo_hba1c` and `sum_demo_knee` now exercise the new fields end to end:
  units, page-level sources, snippets, explicit follow-ups (one with a real
  date, one with `null` because the document gives a course not a date),
  uncertainties, and privacy counts.
- `sum_demo_bp_rx` and `sum_demo_xray` were left completely untouched, on
  purpose, so the repository always contains proof that a pre-pipeline summary
  is still valid.

`src/mocks/documents.test.ts` — new suite, 9 tests.

### Decisions worth recording

**`redactedEntityCounts` is `Record<RedactionCategory, number>`, not
`Record<string, number>`.** phase-1.md suggested the looser type. The union is
closed because ADR-002 already defines `other` as the catch-all, so a new
identifier class has somewhere to go without a type change, and in exchange a
typo in a category name fails at compile time rather than showing a silent zero
in the privacy panel. If a future provider genuinely needs open-ended keys,
this is the line to revisit.

**`ExplicitFollowUp` is separate from `FollowUp`.** `FollowUp` is a record the
user owns and can complete or cancel. `ExplicitFollowUp` is a reading of a
document. Collapsing them would make it impossible for P1-11 to keep "what the
doctor wrote" visually distinct from "what the app suggests", which is a
safety requirement, not a presentation preference.

**`detectedDocumentDate` sits alongside `MedicalDocument.documentDate` rather
than overwriting it.** The user-entered date and the pipeline's reading can
disagree, and that disagreement is information.

**Every addition is optional.** No seeded record, stored summary or existing
test needed migrating.

### Tests added

`src/mocks/documents.test.ts` covers: summary/document/parent linkage both
ways; every source reference resolving to a real page of its own document;
abnormal findings carrying a page; uncertainty pages in range; explicit
follow-up dates valid or honestly `null`; privacy counts present, integer and
non-negative for all twelve categories; and a guard that no seeded patient
name, phone or city appears in any source snippet. The last one enforces
ADR-002's rule that snippets are cut from redacted text — as seed data grows,
that is exactly the kind of mistake that slips in unnoticed.

A backwards-compatibility test asserts that at least one seeded summary carries
none of the new fields, so nobody can quietly make them required.

### Verification

`npm run verify` — typecheck, lint and 247 tests across 18 suites, all passing
(238 across 17 before this step).

### Limitations

- These are contracts only. Nothing produces a `PrivacyProcessingResult` yet;
  the seeded values are illustrative, written by hand, and no redaction has
  actually run.
- No UI reads the new fields yet. That is P1-11.
- `sources` is optional on findings and medicines. P1-08's output validator,
  not the type system, will enforce that critical values carry one.
- Seed inconsistency left in place, not introduced here: `sum_demo_knee`
  describes a four-page discharge summary while `doc_demo_knee` holds one
  page, so its sources all point at page 1.

---

## P1-03 — Backend project skeleton

**Done 2026-08-02**

### What changed

New `backend/` package: Fastify app (`src/app.ts`), entry point (`src/server.ts`),
`GET /health`, typed environment (`src/config/env.ts`), TypeScript, ESLint and
Vitest configuration, `.env.example` and `backend/README.md`.

Root: `backend:install`, `backend:dev` and `backend:verify` scripts; `backend`
excluded from the Expo `tsconfig.json`, `eslint.config.js` and Metro's watch
tree; `backend/dist/` gitignored.

### Decisions worth recording

**A separate package, not a workspace.** The two share no dependency tree. The
Expo app is bundled into an APK and the backend runs on a server, and the whole
architecture rests on the model credential existing only on one side of that
line ([ADR-001](./adr/001-ai-data-boundary.md)). A shared `node_modules` is one
careless import away from erasing the distinction. Domain types are duplicated
across the boundary rather than shared, with the written API contract in
phase-1.md keeping them in step.

**An absent `SARVAM_API_KEY` selects the mock provider,** and a blank one counts
as absent. This came out of a failing test: `.env.example` ships the key blank,
so a copied file made the service refuse to boot. The safe configuration must
also be the effortless one, or it stops being the one people run.

**`/health` has a fixed shape.** It reports nothing about configuration or
whether a key is present. An unauthenticated endpoint that answers "is the AI
key set?" is a reconnaissance tool. A test builds the app _with_ a key
configured and asserts the response does not hint at it.

**`no-console` is an ESLint error in the backend,** not a style warning. A
debugging `console.log` is the most likely way a page of somebody's medical
record ends up in a log file.

### Tests added

11 tests: environment defaults and coercion, provider selection, frozen config,
`describeConfig` never serialising the key or the temp path, `/health` shape and
silence, and a 404 for unknown routes.

### Verification

`npm run backend:verify` green. `curl` against a running server returns the
documented body with status 200. Root `npm run verify` unaffected.

---

## P1-04 — Secure temporary upload handling

**Done 2026-08-02**

### What changed

- `src/services/upload/FileValidator.ts` — magic-byte detection, declared-type
  mismatch, size and page-count rules.
- `src/services/upload/TemporaryFileManager.ts` — random session directory at
  mode `0700`, random per-file names, idempotent non-throwing cleanup.
- `src/routes/processDocument.ts` — `POST /dev/process-document`.
- `src/schemas/processDocument.ts` — field validation.
- `src/types/processing.ts` — stages, failure codes, `ProcessingError`.
- `src/app.ts` — multipart registration and a single error handler.

### Decisions worth recording

**The declared content type is treated as a claim, not evidence.** Format is
decided on the bytes; the declared type is used only to reject a mismatch,
because a JPEG announced as a PNG is a signal in itself.

**No uploaded filename is ever stored, echoed or logged.** Temporary paths are
random UUIDs. A filename on a medical scan is routinely an identifier —
`lakshmi-iyer-uhid-4471-dob-1955.jpg` is the fixture the tests use, and it must
appear in neither a response nor a log line.

**Only a `ProcessingError`'s own message reaches the client.** Every other error
becomes a fixed sentence. An image library or a file-system error will happily
quote a path or a fragment of what it was reading, and the error handler is the
last place that content could escape.

**Cleanup lives in `finally` and cannot throw.** A failure to delete must not
mask the error propagating through it, and must not stop the response. The
processor is injected, so cleanup-after-downstream-failure is directly testable
before an orchestrator exists.

**Pages are buffered in memory before being written.** Simpler, and bounded at
10 pages × 10 MB. Worth revisiting if the page limit ever rises — noted as a
limitation rather than pretended away.

### Tests added

45 tests. Validator: signature detection, MIME spoofing, PDF/GIF/TIFF/HEIC
rejection, empty and oversized files, truncated streams. Temp files: random
paths, `0700` mode, per-request isolation, deletion, idempotence, typed failure
when storage cannot be prepared. Route: accepted JPG and PNG, page ordering,
repeated fields, and refusal of every invalid case — each asserting the temp
directory is empty afterwards and the pipeline was never reached.

Cleanup is asserted after a typed failure, an unexpected crash, and a privacy
stop; and the request still succeeds when cleanup itself fails.

Three tests assert the logging policy directly, using a captured log stream at
`trace` level: no filename, field value, patient name or phone number appears,
and an unexpected error is logged by class only.

### Verification

`npm run backend:verify` — 56 tests.

### Limitations

- No authentication. The service is a development endpoint for synthetic
  documents; this is stated in `backend/README.md` and remains a Phase 1 exit
  blocker.
- Whole pages are held in memory during validation.

---

## P1-05 — OCR provider abstraction

**Done 2026-08-02**

### What changed

- `src/services/ocr/OcrProvider.ts` — interface, page/document result types,
  `tidyPageText`, `isUnreadable`, `meanConfidence`.
- `src/services/ocr/MockOcrProvider.ts` — caller-supplied text per page.
- `src/services/ocr/TesseractOcrProvider.ts` — tesseract.js, one worker per
  call, terminated in `finally`.
- `test/fixtures/synthetic/textImage.ts` — a 5×7 bitmap font and PNG renderer.

### Decisions worth recording

**An unreadable page stays in the result.** It keeps its page number and is
flagged, rather than being dropped or returned as empty text. A four-page
document where page three was too dark to read must be able to say so; silently
returning three pages would renumber everything after it and quietly break
source traceability.

**One bad page does not fail the document, but no readable page does.** A page
that throws is recorded as unreadable; a document where every page is unreadable
raises `ocr_failed`.

**Confidence below 30 counts as unread.** Deliberately low — a poor scan of a
real report still carries values worth showing with a warning, and the UI hedges
low confidence rather than the pipeline discarding it. This threshold answers
"was anything read at all", not "is this good enough".

**Fixtures are generated, never committed.** `textImage.ts` draws text with a
bitmap font, because committing a photograph of a document is exactly what
Phase 1 forbids.

### Tests added

21 tests. 14 unit tests cover text tidying, the unreadable rule, confidence
averaging and `MockOcrProvider`. 7 run **real Tesseract** against generated
images: text extraction, page separation, ordering, out-of-order input, blank
pages, all-blank failure and a missing file.

### Limitations, stated plainly

- **The OCR assertions are looser than they look.** The bitmap font's glyphs are
  blocky and Tesseract misreads some consistently — `B` as `E`, `P` as `F`, `8`
  as `=`, a zero as `@`. Digits and common words come through. The tests
  therefore assert on tokens Tesseract genuinely gets right plus the _contract_
  (ordering, numbering, unreadable marking, typed failure). Tightening them to
  exact strings would mean tuning the fixture font until Tesseract agreed with
  it, which measures the font, not the provider.
- **Real-document accuracy is untested and expected to be poor** on crooked
  phone photographs — phase-1.md § 8, and the app's open `TODO(capture)` note
  about edge detection is the other half of that problem.
- **The first run needs network.** tesseract.js downloads ~10 MB of language
  data. `SKIP_OCR_TESTS=1` skips that file.

---

## P1-06 — Profile-aware deterministic PII redaction

**Done 2026-08-02**

### What changed

- `src/services/redaction/piiPatterns.ts` — typed placeholders and four pattern
  groups.
- `src/services/redaction/nameMatcher.ts` — known-name variants and matching.
- `src/services/redaction/addressRedactor.ts` — labelled-region redaction.
- `src/services/redaction/RedactionService.ts` — the layered pipeline.
- `test/fixtures/synthetic/report.ts` — a synthetic lab report.

Pipeline order:

```text
embedding identifiers -> known values -> labelled regions
  -> typed patterns -> catch-all
```

### Decisions worth recording

**A layer was added that the ADR does not list.** Email addresses and URLs are
matched _before_ known values. A failing test forced it: the fixture's
`family.iyer@example.com` had the patient's surname redacted out of it first,
leaving `family.[PATIENT_NAME]@example.com` — no longer recognisable as an email,
so the domain and structure survived and the email counter read zero. Identifiers
that embed other identifiers have to be matched whole, first.

**Typed placeholders, not one anonymous marker.** `[AADHAAR]` rather than
`[REDACTED_IDENTIFIER]`, which is why the catch-all runs last. The model needs
the document's structure to survive redaction to make sense of what is left.

**No fuzzy name matching, and no bare-initial rule.** ADR-002 warns that
aggressive matching destroys clinical terms. Initials are only matched beside a
known surname (`L. Iyer`), never alone: `LI` is an abbreviation. Name tokens
under three characters are dropped entirely. A test asserts `Iron studies` is
untouched for a patient named `Ira Menon`.

**Clinical dates are preserved by construction.** There is no generic date
pattern at all — only DOB-_labelled_ values are removed. A redactor that eats
`Review Date` has deleted the follow-up this product exists for.

**The catch-all needs ten digits.** A six-figure platelet count and a four-digit
year both survive; an account number does not.

**Address consumption has a stopping rule.** A blank line, a clinical section
heading, or a new labelled field ends the block. Without one, `Address:` at the
top of a lab report swallows the results underneath it — this layer's main
documented risk.

### Tests added

78 tests, structured around ADR-002 § "Testing strategy": exact and
case-insensitive names, aliases, initials, reversed order, OCR line breaks,
titles; phone, email, Aadhaar, PAN, passport, patient ID, MRN, registration
number, insurance ID; single- and multi-line addresses; DOB labels; and a
preservation set covering report dates, test names, values, units, reference
ranges, medicines, dosages, frequencies and durations.

The whole synthetic report is asserted twice over: every value in
`MUST_NOT_SURVIVE` is gone, every value in `MUST_SURVIVE` remains, and the
result object never contains a removed value.

### Limitations

- Redaction has not been independently validated, and no evaluation set exists
  yet (ADR-002 § "Evaluation set"). Recall and false-positive rates are
  unmeasured.
- English only. Multilingual documents are untested.
- Clinician and facility names are only removed when they hit a name label or
  the known-city rule. ADR-002's default privacy-first position — remove
  individual clinician and facility names — is not yet fully implemented.
- Redacting a known city can clip a facility name (`Chennai Diagnostics`
  becomes `[ADDRESS] Diagnostics`). Acceptable under the ADR's default position,
  but worth a decision before Phase 2.
- **This is pseudonymisation, not anonymisation.** A rare condition or a
  distinctive sequence of dates can still identify a person.

---

## P1-07 — Independent leakage gate

**Done 2026-08-02**

### What changed

`src/services/redaction/leakageCheck.ts` — `checkForLeakage` returning
categories only, and `assertSafeToSend`, which throws `privacy_failed`.

### Decisions worth recording

**It is written from scratch, not by re-running the redactor.** ADR-002 requires
this and the reason is worth restating: a gate built from the redactor's own
rules can only confirm the redactor did what it does. It cannot catch a rule
that was never written. A test proves the point by feeding it a driving-licence
number, for which no redaction rule exists at all — the gate stops it.

**The detectors are deliberately different in character,** not just separate
files. They are broader, and several would be unacceptable as redaction rules
because they would destroy clinical content. For a detector, over-sensitivity is
the right bias.

**But not unboundedly so — two false positives were found and fixed.** The first
draft flagged `Creatinine` (ten alphanumerics) as an identifier and
`150000-410000` (twelve digits and a dash) as a phone number. A gate that fires
on lab values and reference ranges gets switched off, and then protects nothing.
The identifier rule now requires a digit _and_ a letter; the phone rule takes
contiguous runs or real mobile groupings.

**Placeholders are stripped before the structural pass,** so `[PATIENT_ID]` is
not itself read as a long identifier.

**`assertSafeToSend` throws rather than returning a boolean.** A caller can
forget to check a return value, and the failure mode of forgetting here is
sending a patient's identifiers to a third party.

**The result carries categories and nothing else** — no suspected text, in the
response, the error details or the logs. A gate that reported "found phone
number 9840012345" would leak the value it exists to protect.

### Tests added

38 tests: known-value leaks (name, alias, phone with OCR spacing, patient ID,
city, date of birth); structural detection of identifiers the app never knew
about; a false-positive set over clinical text and placeholders; stability and
deduplication of categories; and assertions that no removed value appears
anywhere in the result.

A spy test proves an external provider is never called once the gate objects —
P1-07's stated acceptance criterion, in the form available before a provider
exists.

### Limitations

- The end-to-end version of "Sarvam is never called after a privacy failure"
  needs the orchestrator, and lands in P1-09.
- Detector thresholds are judgement, not measurement. The same evaluation set
  P1-06 needs would let false-negative and false-positive rates be quantified.
- Cleanup-after-privacy-failure is proven at the route level (P1-04); the
  orchestrator must preserve it.

---

## P1-08 — Summary provider and Sarvam integration

**Done 2026-08-03**

### What changed

- `src/schemas/summary.ts` — the zod output contract plus the JSON Schema sent
  to the provider.
- `src/services/summarisation/SummaryProvider.ts` — the interface, the input
  type, and `assertOnlyRedactedInput`.
- `src/services/summarisation/systemPrompt.ts` — the safety prompt and user
  message builder.
- `src/services/summarisation/MockSummaryProvider.ts`
- `src/services/summarisation/SarvamSummaryProvider.ts`
- `src/services/summarisation/pseudonym.ts`
- `src/services/summarisation/providerFactory.ts`

### Decisions worth recording

**The allowlist is enforced by the type, then re-checked at runtime.**
`RedactedDocumentInput` carries only what README.md § "data permitted in an
external AI request" allows. A provider cannot leak what it was never handed, so
the narrowness of that type is a control, not documentation.
`assertOnlyRedactedInput` re-checks anyway, because "the type says so" stops
being true the moment somebody widens the interface, and this is the one
boundary where that mistake is expensive. The mock enforces it too — a pipeline
bug that would leak on Sarvam also fails in mock mode.

**The provider gets a hashed document reference, not the vault's id.** The real
id is stored against a real user, and a provider's request logs are outside our
control. Sending it would create a durable join key between their logs and our
database.

**Model output is parsed, not cast.** It is untrusted input. A malformed or
off-schema reply is `validation_failed`, and the orchestrator refuses to call
the document `ready`. The only leniency is stripping a markdown code fence.

**Error details never quote the model or the provider.** Zod's issues include
the offending _value_, which here is the model's rendering of a medical record;
only field paths are reported. A non-retryable HTTP failure does not even read
the provider's response body — on a 400 it echoes the request, which is the
document text.

**Retries are narrow.** 429, 502, 503, 504 and network errors only, three
attempts, capped exponential backoff. A 400 or 401 is retried zero times:
repeating a malformed request just sends the document again, and repeating one
rejected for a bad key only burns rate limit.

**A bug the tests caught:** `MockSummaryProvider.createSummary` threw
synchronously from a `Promise`-returning method while the real provider
rejected. Callers using `.catch()` would have missed it. Both reject now.

### Tests added

49 tests: the input allowlist (including smuggled top-level and per-page
fields); pseudonymisation; ten assertions that the system prompt still carries
each safety rule; the mock's refusal to invent clinical content; provider
selection; what goes out on the wire (no identifier, low temperature, JSON mode,
key in the header and never the body); what comes back (valid, fenced,
malformed, off-schema, out-of-range confidence, empty); and failure handling
across every retryable and non-retryable status, backoff intervals, network
errors, and caller abort.

### Limitations

- **The Sarvam request shape is unverified.** Written to the OpenAI-compatible
  chat-completions shape their docs describe, driven in tests through an
  injected `fetch`. No key exists in this project, so it has never run against
  the live endpoint. The auth header form and `response_format` support both
  need confirming before Phase 1 exit.
- The system prompt is not a security control. A model can ignore any of it.
  What holds is upstream (nothing unredacted is sent) and downstream (schema and
  source validation).
- No token accounting or cost control. A ten-page document is sent as one
  request with no length budget.

---

## P1-09 — Document-processing orchestrator

**Done 2026-08-03**

### What changed

- `src/services/processing/DocumentProcessingOrchestrator.ts` — the pipeline.
- `src/services/processing/normaliseText.ts` — OCR text normalisation.
- `src/services/validation/SummaryValidator.ts` — schema validation.
- `src/services/validation/SourceConsistencyValidator.ts` — checks the summary
  against the text it claims to come from.
- `src/app.ts` — the real orchestrator replaces the P1-04 placeholder;
  `notImplementedProcessor` deleted.

```text
validate -> OCR -> normalise -> redact -> privacy gate
  -> summarise -> validate schema -> verify sources -> respond
```

### Decisions worth recording

**Three properties are structural, not incidental.** The gate sits between
redaction and the provider and _throws_, so there is no branch reaching the
provider without it having returned. The provider input is built from the
redaction output, never the OCR output — the unredacted text is not in scope at
that point in the function. And nothing is `ready` until it has been checked
against the source.

**Cleanup deliberately stays in the route.** It belongs in the `finally` that
wraps the whole orchestrator call. Putting it inside would leave files behind
whenever the orchestrator throws before reaching its own cleanup line — exactly
when it matters.

**Two kinds of validation failure, two responses.** A citation to page 7 of a
four-page report, or a finding with no source, means the model ignored the
contract: `validation_failed`, nothing shown. But a value that cannot be found
on the page it cites drops _that item_ and records an uncertainty. Failing the
whole document over one number would show the family nothing when the other nine
values were fine and the original scan is right there. We never display a number
we could not find, and we say something was removed.

**Snippets are re-checked through the leakage gate on the way out.** A snippet
is the one part of the output copied verbatim from text, so it is where a model
can reintroduce something the redactor removed. An offending snippet is
stripped; the page reference survives, which is what the family actually needs.

**Normalisation runs before redaction, for the redactor's benefit.** OCR renders
a hyphen as any of several dashes and a colon sometimes full-width; a pattern
anchored on `:` misses those, and a missed anchor is a missed identifier. It is
conservative — no reflowing, no collapsing runs of spaces, because column
alignment and line breaks are structure both the redactor and the model rely on.

### Tests added

42 tests. 23 orchestrator tests: the complete synthetic path, every stage
emitted in order, monotonic progress, unreadable-page reporting, what reaches
the provider (redacted text only, pseudonymous id, no patient profile), the
privacy gate blocking the provider entirely, structural rejection, value
dropping, snippet stripping, and failure and cancellation paths. 11
normalisation tests, including two that show _why_ it runs before redaction. 8
end-to-end tests through the real route: a page in, a validated summary out,
temp files gone on success, on privacy stop and on validation failure, nothing
sensitive in the logs, and no external call attempted in mock mode.

**The end-to-end version of P1-07's spy test now exists**: the route-level test
feeds an identifier with no redaction rule and asserts a 422, a category-only
body, and an empty temp directory.

### Verification

`npm run backend:verify` — 284 tests across 13 files. Root `npm run verify`
unchanged at 247.

### Limitations

- The app still talks to its own mocks. Connecting it is P1-10, so nothing here
  is reachable from the phone yet.
- Progress is reported through a callback the HTTP route does not expose. The
  request is synchronous and the client sees stages only after it returns; a
  polling or streaming endpoint is P1-10's problem.
- The source check is substring matching on digit runs and medicine names. It
  catches an invented value; it does not catch a real value attached to the
  wrong label.
- `instructions` are not source-checked at all. The model is told to transcribe
  them, and nothing verifies that it did.
- No cross-page reasoning, no cost or token budget, and no persistence — the
  summary is returned and forgotten.

---

## P1-10 — Connect the Expo application

**Done 2026-08-03**

### What changed

- `src/config/env.ts` — `isBackendEnabled` now accepts `http://` for loopback
  and private-LAN hosts while `EXPO_PUBLIC_ENV=local`.
- `src/services/processing/types.ts` — the backend contract mirrored on the
  client, plus `DocumentProcessingError`.
- `src/services/processing/devProcessingClient.ts` — the multipart request.
- `src/services/processing/summaryMapper.ts` — backend reply to
  `DocumentSummary`.
- `src/services/processing/documentPipeline.ts` — the single entry point the
  screen calls, branching mock versus backend.
- `app/document/[id]/processing.tsx` — calls the pipeline; handles a privacy
  stop distinctly.
- `.env.example` — how to point the app at the Phase 1 backend.

### Decisions worth recording

**A narrow `http://` exception, with tests as the fence.** The Phase 1 backend
is reached at `http://localhost:4000` from a simulator or `http://192.168.x.x`
from a phone, and neither is https. Rather than drop the check, plaintext is
allowed only for loopback and RFC-1918 hosts _and_ only while
`EXPO_PUBLIC_ENV=local`. Both conditions must hold. Eighteen tests pin it,
including that `http://localhost.evil.com` and `http://172.32.0.1` are refused —
the second because `172.32` sits just outside the private range and a naive
prefix check would have let it through.

**One `runDocumentPipeline` call, not a branch in the screen.** The mock and
production paths upload then poll; the dev backend does everything in one
request. That difference is real and it belongs in the service layer. The README
rule — screens never call a network API directly — still holds.

**The parent profile is required on the backend path, and the app refuses
without it.** The patient's name is the redactor's strongest signal, and it
cannot remove a name it was never told. Sending a document with no ground truth
would quietly downgrade redaction to pattern matching alone, which ADR-002
explicitly rules out.

**The backend gets the patient's real details; an external model never does.**
Name, date of birth, phone and city all go up. That is the point — they are what
gets removed. The boundary being defended is the one further out, and the two
should not be confused.

**Upload progress is coarse and honest.** `fetch` reports no upload progress, so
the client reports 5% then 100% rather than animating a fake curve. A smooth bar
that means nothing tells a caregiver on hotel wifi that something is happening
when it may have stalled. Real byte progress needs `expo-file-system`'s upload
task, which is the existing `TODO(backend)` on `uploadService`.

**A privacy stop offers no retry.** Retrying produces the same refusal. The
screen offers "Open the original document" instead, and titles the failure
"Stopped to protect privacy" rather than "Could not finish" — the pipeline
worked exactly as designed.

**The reply is parsed, not trusted.** An unauthenticated dev server on a laptop
is not a hardened source. Unknown doctor categories and follow-up kinds fall
back rather than crashing a screen; confidences are clamped; sources citing
page 0 are dropped; a missing summary is a typed failure.

### Tests added

52 tests. 18 on `isBackendEnabled` alone, covering every host form that must be
allowed and refused. 16 on the mapper, including a **payload captured verbatim
from a live backend run** — the two packages share no code by design, so a real
reply the mapper must keep accepting is the only thing preventing silent drift.
11 on the client (fields sent, no hand-set `Content-Type`, progress, and every
failure path). 9 on the pipeline (mock default, no network in mock mode, stage
parity between paths, refusal without a parent, privacy stop propagation).

### Verification

`npm run verify` — 307 tests across 23 suites. The field contract was also
checked against a running backend: every field the client sends is accepted, and
the reply's shape matches the mapper's expectations exactly.

### Limitations

- **No authentication.** The dev endpoint is unauthenticated and the app sends
  no token to it. Fine for a controlled development environment with synthetic
  data; a Phase 1 exit blocker.
- **The request is synchronous.** Stages are reported around the call rather
  than during it, so the status screen shows them in order but not in real time.
  A polling endpoint would fix this and is not built.
- **No offline queue.** A failed request is retried by the user, not by the app.
- **The production path is still unimplemented** — `uploadService` still throws
  for a real S3 PUT. This step connected the _development_ backend only.

---

## P1-11 — Safety and traceability UI

**Done 2026-08-03**

### What changed

- `src/components/documents/SourceBadge.tsx` — new.
- `FindingRow` and `MedicineRow` — show the source page; medicines show
  duration.
- `app/document/[id]/index.tsx` — an uncertainties callout, a separate section
  for follow-ups the document asks for, re-attributed questions, and a privacy
  line in the provenance footer.

### Decisions worth recording

**Three kinds of statement, three visual homes.** "Instructions in the document"
is transcribed. "What the document asks for next" is a reading of it. "Questions
to ask" is generated by Ayunetz — and its subtitle now says so outright:
_written by Ayunetz from this document — nobody has asked these yet_. A
generated question sitting under a doctor's instructions reads as something the
doctor said, and that is the specific confusion P1-11 exists to prevent.

**Uncertainties appear above the findings, not below them.** A page that could
not be read changes how much weight everything else deserves. Putting it after
the results would mean the reader forms a view first and learns it was partial
second.

**No source means no badge.** Every summary written before the pipeline existed
has no sources, including all four seeded demo summaries. Rendering "unknown
page" everywhere would train people to ignore the field, so absence is silent.

**Low confidence is never colour alone.** It gets a titled callout with a
sentence, matching the existing rule that every severity and status carries an
icon and a written label.

**The privacy footer reports counts, never values.** "3 personal details removed
before this document was summarised (redaction-v1)". Someone handing over their
parent's records is owed a plain statement of what the app did with them, and
the pipeline version makes an old summary traceable to the rules that produced
it.

### Tests added

8 tests: the badge's page rendering, multi-page and duplicate handling, its
silence without sources, and its screen-reader label; plus two on `FindingRow`
covering the badge appearing and staying absent for a pre-pipeline summary.

### Limitations

- **The source badge is not tappable.** It names the page but does not jump to
  it — a page viewer exists, but wiring deep links into it was beyond this step.
  That is the obvious next improvement and it is what would make traceability
  genuinely usable rather than merely honest.
- Instructions carry no source badge; the backend does not source-check them
  either (noted under P1-09).
- The uncertainties callout concatenates messages into one block. Fine for the
  two or three a document produces; it would need a list for more.
- None of this is exercised by a screen-level test. The components are covered;
  the assembled summary screen is not.

---

## Follow-up fixes — postcode leak and PDF support

**Done 2026-08-03.** Both came out of testing the pipeline against real files
rather than generated fixtures, which is worth noting on its own: the synthetic
bitmap-font images used through P1-05 to P1-09 were both harder for OCR than a
real page _and_ less revealing about redaction.

### The postcode leak

Running a real rendered lab report through the pipeline produced this in the
text bound for the summariser:

```text
[ADDRESS] 600004
```

The city was removed by the known-value rule, the PIN code was not. A postcode
plus a rare condition is a genuine re-identification signal, and both the
redactor and the gate had missed it.

**Why it was not simply a missing rule.** `245000` on the same page is a
platelet count and matches a six-digit postcode exactly. A blanket rule would
have deleted clinical values — the precise false positive ADR-002 warns this
layer is prone to, and the reason the bare-six-digit check was left out of the
leakage gate in P1-07 in the first place.

**The fix is context-bound.** `redactPostalCodes` removes a six-digit number
only on, or within three non-blank lines of, a line already identified as an
address, stopping at any clinical heading. The gate got a separate and
deliberately different check: it looks at a single line, and it runs _before_
placeholders are stripped, because there the `[ADDRESS]` placeholder is the
evidence. The two can disagree, which is the point of the gate existing.

Verified on the original failing document: `[ADDRESS] [ADDRESS]`, with
`Platelet count 245000` and every reference range still intact.

### PDF support

Previously refused outright — while the app's file picker happily let a user
choose one, and one of the four seeded demo documents _is_ a PDF.

**Two routes through, by document type.** A lab report emailed to a family is
usually a text PDF, where the characters are really in the file; rasterising
that and running OCR over it would throw away a perfect copy and replace it with
a guess. So a page with a usable text layer is read directly and skips OCR
entirely. A scanned PDF is a picture in a wrapper, so it is rendered and OCR'd
like a photograph. Nothing downstream can tell which route a page took.

**MuPDF compiled to WebAssembly.** PDF parsers are a classic source of
memory-safety bugs, and this one runs on files a user was sent by someone else.
WASM keeps that parsing inside a sandbox rather than in a native library with
access to the process, and it needs no native build step.

**Page numbering is flattened.** Three photos, or one four-page PDF, or two
photos with a PDF between them all become one numbered sequence. The ten-page
limit applies to the flattened count, and a PDF's page count is checked _before_
any page is rendered so a 400-page file is refused in milliseconds.

`workingDirectory` was added to the processing request so rendered pages land in
the same per-request directory the route already deletes in its `finally`.

### Tests

12 added. Five drive a **real PDF generated at test time** (`cupsfilter`, macOS
only, skipped elsewhere): text extracted exactly, page limits enforced before
rendering, a corrupt PDF refused, and images and PDF pages flattened into one
sequence. Seven cover the postcode rule, including that a platelet count and a
reference range survive on a page that also has an address.

Four existing tests changed meaning and were updated rather than deleted: a PDF
is no longer refused for its format, but a PDF _declared as_ an image is still
refused for the mismatch.

### Limitations

- Text-layer extraction trusts the PDF. A file whose text layer disagrees with
  its visible content would be summarised from the text, and nothing compares
  the two.
- `cupsfilter` is macOS-only, so the PDF tests skip on Linux CI. A committed
  fixture would fix that but means committing a binary document.
- Postcode detection is Indian-format only (six digits, no leading zero).
- The rendered-page scale is fixed at 2×. A dense scan might want more.

---

## Bug fix — the processing screen cancelled its own upload

**Done 2026-08-03.** Reported from the browser preview: picking a PDF and
starting the upload produced _"Could not finish — Upload cancelled."_ at 0%.

### What was actually wrong

Nothing in the services. The pipeline, the upload mock, the PDF work — all
correct. The fault was in how `app/document/[id]/processing.tsx` wired them
together, and it needed the screen rendered to see it:

1. `run()` starts and immediately calls `updateDocumentStatus(id, 'uploading')`.
2. `updateDocumentStatus` builds a **new** document object, as an immutable
   store should.
3. The screen derives `document` from that store, so `document` changes
   identity, so the `run` callback that depends on it is recreated.
4. The effect that started the pipeline listed `run` in its dependencies — and
   its cleanup called `abortRef.current?.abort()`.
5. React ran that cleanup on the dependency change. The upload was aborted by
   the effect that had just started it, a few hundred milliseconds earlier.

The `startedRef` guard stopped the pipeline being _restarted_, which is why the
original author's comment says the store updating mid-run was accounted for. It
was — but only for restarts, not for the cleanup.

This predates the Phase 1 work; the same shape is in the original MVP commit.

### The fix

The abort now lives in its own effect with no dependencies, so its cleanup runs
only on unmount — when the screen is genuinely left.

### Test

`app/document/processing.test.tsx` — the first screen-level test in the project,
and it had to be, because every unit involved was already passing. It renders
the screen against a seeded vault, and before the fix it reproduced the reported
string exactly: `"Could not finish. Upload cancelled."`

`jest.config.js` now includes `app/**/*.test.tsx`.

### Worth noting

Three rounds of this now — the postcode leak, PDF rejection, and this — have all
been found by _running the thing_, not by tests. The suites were green through
every one of them. That is a comment on what the suites cover, not an argument
against them: unit tests were what made each fix quick and safe once the problem
was visible.

---

## Screen walk — driving the app rather than the tests

**Done 2026-08-04.** A deliberate pass through the app in the browser preview,
prompted by three bugs in a row that the suites had been green through.

### Found and fixed

**1. "Add to my calendar" hung forever.** Tapping it left a spinner running with
no error and no way out but Cancel. `expo-calendar`'s
`requestCalendarPermissionsAsync` never settles on web — it neither resolves nor
rejects — and the service awaited it with no platform check and no timeout.

The same call sits behind the calendar toggle in Settings, so that hung too.

Three things were wrong, and all three are now fixed:

- No platform guard. `calendarService` now reports `unavailable` on any platform
  without a calendar, before touching the device.
- Only `createEventAsync` was inside a `try/catch`. Looking up permission and
  finding the default calendar are device calls too; a throw in either escaped
  as an unhandled rejection and stranded the caller. The whole sequence is
  guarded now.
- No timeout anywhere. A 45-second cap means a native call that never answers
  surfaces as a failure rather than an indefinite spinner.

**2. A dangling 45-second timer**, introduced by that very timeout and caught by
Jest's "did not exit one second after the test run" warning. `Promise.race` left
the loser pending after every successful call. Cleared in `finally` now. Worth
recording as the fix creating the next bug — and the test runner, not a person,
noticing.

**3. An informational notice rendered as a red error.** The new `unavailable`
outcome was given an `info` tone, but the follow-up screen mapped tones through
`notice.tone === 'success' ? 'success' : 'danger'`, so anything not a success
came out red. TypeScript could not catch it: the ternary is total. Found by
reading the file rather than by running it.

**4. "2 summarys"** on the account-deletion screen — the one screen that lists
what is about to be erased, so sloppy copy there reads as a sloppy product.
`pluralise` appended a bare `s`. It now handles consonant-then-`y`, so
"summaries" and "categories" are right by default while "days" is untouched.

### Verified working

Disclaimer gate (Continue genuinely does nothing until ticked); auth validation;
parent form validation including a rejected future date of birth and a computed
age; follow-up time format, and past dates correctly allowed and shown as
overdue; the calendar's two-gate consent, including honest wording when the
standing setting is off; PIN mismatch, save, and lock-method update.

**The cascade delete is exactly right.** Deleting a parent took 3→2 parents,
4→2 documents, 4→2 summaries, 7→4 follow-ups, with zero orphaned records of any
kind — checked against persisted state, not the UI.

### Noted, deliberately not changed

- **Type-to-confirm accepts lowercase `delete`.** The code says
  `confirmText.trim().toUpperCase() === 'DELETE'`, so the leniency is a choice,
  not an oversight. Worth a product decision rather than a silent change.
- The persisted key is named `ayunetz.v1.parents` but holds the whole vault —
  documents, summaries and follow-ups included. Misleading, no user impact.
- A parent card reads "1 follow-up upcoming" for an item that is overdue.

### Not covered

Capture, scan and page review need a real file attached, which the browser
automation cannot do; the lock screen needs biometrics. Those remain the largest
untested screens.

---

## Redaction against a real report

**Done 2026-08-04.** A genuine (fictional) outpatient PDF supplied for testing —
a full consultation letter with a header block, vitals, labs, assessment, plan
and clinician sign-off. The first document put through the pipeline that nobody
here wrote.

It found more than every synthetic fixture combined.

### The finding that matters most

**Real PDFs put the label and the value on separate lines.** A two-column
"Patient name | Rohan Mehta" header flattens to:

```text
Patient name
Rohan Mehta
```

No colon anywhere. Every same-line rule missed it, and `NAME_LABELS` required a
mandatory `[:.-]` separator, so **the patient's name survived redaction
completely.** It was only removed at all because the app already knew it from
the parent profile.

That is the case that will not hold in practice: a second patient on a shared
report, a next-of-kin, a spouse listed as emergency contact, or simply a name
spelled differently on the document than in the profile. Any of those and the
name goes to the model.

Fixed with a bare-label pass — a label alone on its line takes the following
line as its value — covering names, addresses and clinicians.

### Also found

- **A landline in an unusual grouping survived.** `+91 80 4000 1122` is ten
  digits split 2-4-4; the 5+5 mobile rule never saw it. Both the redactor and
  the gate missed it, so the gate called a document safe with a phone number
  still in it. A rule anchored on the literal country code with any grouping now
  catches it.
- **The gate could not see hyphenated identifiers.** `KMC-DEMO-445566`, a
  clinician's registration number: `\b` stops at each hyphen, so no run was ever
  long enough for the alphanumeric rule to notice.
- **A report ID was mislabelled `[AADHAAR]`.** `DEMO-2026-0814-0042` contains a
  4-4-4 digit run. Removing it is right; calling it an Aadhaar number is not —
  the typed placeholder exists to tell the model what kind of thing went.
- **Document identifiers were not removed at all** — report id, laboratory
  accession. They are lookup keys back to the record. Once the gate could see
  them it refused the document, correctly but uselessly, so the redactor now
  removes them and the deadlock is gone.
- **Clinician names and registrations were not removed.** ADR-002 already
  states the default privacy-first position — remove individual clinician names,
  keep the speciality — and it simply was not implemented. It is now.

### Result

With the patient known: **no identifier survives, no clinical value is lost,**
and the gate passes. Names, address, date of birth, email, both phone numbers,
patient id, report id, lab accession, clinician name and registration all gone;
every lab value, reference range, vital sign, dose, duration, follow-up interval
and clinical date intact.

With the patient _unknown_ — the app told nothing — one item still leaks: the
emergency contact's surname, whose label is split across two lines
(`Emergency` / `contact`). Not fixed; noted below.

### Tests

13 added, all from patterns this document exposed, using synthetic text rather
than the file itself — the sample is not committed.

### Still open

- A label split across two lines (`Emergency` / `contact`) is not recognised.
- The **clinic's** own street address and name survive; only the patient's
  address is handled. ADR-002's default position also covers facility names.
- The patient's age (`38 years`) survives alongside a redacted date of birth.
  Defensible — age is clinically useful and weakly identifying — but it is a
  choice worth making explicitly.
- All of this remains one document. It is a far better test than a synthetic
  fixture and it is still not an evaluation set.

---

## Three more real documents

**Done 2026-08-04.** A photographed handwritten prescription, a discharge
summary and a laboratory report — three layouts, two of them American, one of
them handwriting. Supplied for testing after the first PDF proved how much a
real document finds.

### The one that matters

**A handwritten prescription was read at 57% confidence, accepted, and would
have been summarised.** The "unreadable" floor is 30, so nothing objected. What
the pipeline actually had in hand was:

```text
Tab Amlodipine dy          (5 mg — dose gone)
Teds Mozvastatin ey        (Tab Atorvastatin 10 mg)
lop Pontopragole ag        (Cap Pantoprazole 40 mg)
```

Real medicines, mangled names, doses destroyed — and the patient's name, age
and date never read at all. A summary built on that would have been as
confidently presented as one built on a clean scan, because **the model cannot
know its input was garbled. It only sees the text.** The pipeline knows.

Below 75% OCR confidence a summary now carries a capped confidence and an
uncertainty saying the document was hard to read and every name and dose must be
checked against the original. Nothing is dropped — the family still has the
paper — but the output stops presenting itself as reliable.

This is the single most dangerous thing found in the whole of Phase 1. The
product exists to tell a family what medicines to take.

### Also fixed

- **Every phone rule was Indian.** Two of three documents carried North American
  numbers — `+1 (555) 123-4567`, `(217) 555-0198`. Neither the redactor nor the
  gate saw them.
- **Clinician names sat in three different places** across three documents: a
  letterhead, a labelled table cell, a signature block. Only one had a label
  above it. Matching the _title_ — `Dr. <Name>` — catches all three and stops at
  the name, so `, MBBS, MD` and `, Internal Medicine` survive. ADR-002: remove
  the individual, keep the speciality.
- **A laboratory accreditation number** (`CLIA ID: 14D1234567`) was not removed.
- **A globe icon OCR'd as `@`**, turning `Commitment. @ www.hospital.org` into
  something the gate read as an email address and refused the document over.
  Every hospital letterhead has a website; a gate that blocks all of them gets
  switched off.

### Result across all three

Patient name, patient id, hospital number, date of birth, clinician names,
phone numbers and accreditation numbers: **all removed, on all three
documents.** Every clinical value preserved — the full lab table, all
medications, doses, durations and follow-up intervals. The gate passes all
three.

13 regression tests added, from synthetic text rather than the files.

### Still open, and now demonstrated twice

**Clinic street addresses survive** — `125 Riverbend Drive`,
`123 Green Valley Road`. The gate does not catch them either, so they reach the
model with no warning. ADR-002's default position covers facility information,
and it remains unimplemented. This is now the largest known gap and it is a
product decision, not a bug: removing facility names changes what a summary can
say. It should be decided rather than drifted into.

Also unchanged: handwriting is not usable with Tesseract. Hedging the output is
mitigation, not a fix. A handwriting-capable OCR is a Phase 2 question.

---

## Facility identity — the decision ADR-002 was waiting for

**Done 2026-08-04.** The largest known gap from the real-document rounds, closed.

ADR-002 § "Names of clinicians and facilities" listed four options and required
one to be chosen before production. It was chosen in plainer terms than the ADR
offered:

> The content of the report is what goes to Sarvam. Not where it was created,
> and not who created it.

That is the ADR's own default position plus two things its list did not name —
the facility's **address** and its **website**.

### What now goes

- **Facility names**, in Title Case or ALL CAPS: `Sunrise Multispeciality
Hospital`, `METROPOLIS LABORATORIES`, `St. Mary's Clinic`.
- **Street addresses**, with or without a house number, including the trailing
  city, state and postal code: `125 Riverbend Drive, Springfield, IL 62704` and
  `123 Green Valley Road, Chennai 600004` — the two that survived on real
  documents — plus post office boxes.
- **Letterhead websites**: `www.sunrisehospital.org`. This one was not in the
  plan. It surfaced running a full synthetic letterhead through the pipeline
  after the name and address rules were in, and it walked past every layer
  because it is neither a name, an address, nor an `https://` URL. A domain
  names a hospital as precisely as its letterhead does.

### What deliberately stays

Speciality, department and document type, as the ADR requires: `Department of
Cardiology`, `Laboratory Report`, `Discharge Summary`, and the `, MBBS, MD,
Internal Medicine` that trails a redacted clinician name.

### The false positives that shaped the rules

Every facility rule requires a **capitalised proper noun immediately in front of
the keyword**. Without that, `admitted to hospital` and `Laboratory Report` both
disappear, and the second is the document type the ADR says to keep.

Four street types that belong in any address list are missing on purpose,
because each is also a clinical term:

| Excluded | Why                      |
| -------- | ------------------------ |
| `Block`  | left bundle branch block |
| `Circle` | circle of Willis         |
| `Cross`  | cross-matching           |
| `St`     | ST-segment elevation     |

Losing a rare address form is recoverable. Deleting a cardiology finding is not.
`Lab` is excluded for the same reason — `Sample sent to Central Lab` is a
sentence real reports write.

### Ordering

Facility matching runs **before** the known-value layer, for the reason emails
do. `Chennai Diagnostics` with `Chennai` as the known city used to come out as
`[ADDRESS] Diagnostics` — a clipped name rather than a removed one. That was
recorded as a limitation under P1-06; it is now a regression test.

### The gate

`possible_facility` added, with facility nouns and street types written out
longhand rather than generated, so a bug in the redactor's pattern builder
cannot silently be a bug in both. The postcode-in-address rule now also accepts
five-digit US ZIPs — two of the four real documents were American and neither
postal code was recognised.

One earlier test changed meaning. The globe-icon case asserted that
`Commitment. @ www.example-hospital.org` passes the gate untouched; a letterhead
website is now something the redactor removes, so the raw line no longer passes.
The regression it actually guards — a stray `@` read as an email address — is
asserted directly, and the pipeline-level property is asserted separately.

### Result

40 tests added. Backend 369 passing, app 331. On a full synthetic letterhead the
name, address, phone, website, patient name, MRN and clinician name are all
removed and the gate passes; the lab table, medications and ECG findings come
through untouched.

`redaction-v1` → `redaction-v2`. Summaries produced under v1 were processed by
rules that let facility identity through, which is what the stored version makes
answerable.

### Still open

Unchanged by this step: handwriting is not usable with Tesseract, and there is
still no evaluation set — the tests are written from synthetic text, not from
the real documents.

`Sector 5`-style addresses, where the number follows the street type, are not
matched. Neither is a facility name with no keyword in it at all — a clinic
called simply `Ayushman` is invisible to a rule anchored on `Hospital`.

---

## P1-12 — Phase 1 verification and exit review

**Run 2026-08-04.** Every item on the checklist was executed. Two findings stop
this being a clean pass; both are recorded below rather than quietly fixed.

### Verification results

| Check                       | Result                                        |
| --------------------------- | --------------------------------------------- |
| Frontend test suite         | 331 passing, 24 suites                        |
| Backend unit tests          | passing                                       |
| Backend integration tests   | passing (373 total, 14 files)                 |
| OCR fixture test            | passing                                       |
| Redaction tests             | passing                                       |
| Leakage tests               | passing                                       |
| Malformed model output      | covered — `rejects malformed JSON`            |
| Provider timeout            | covered — gap found and closed, see below     |
| Transient retry             | covered                                       |
| Temporary-file cleanup      | covered, and confirmed against a live server  |
| Secret scan                 | clean — manual, no scanner configured         |
| Log-content review          | clean, asserted by test and confirmed live    |
| End-to-end synthetic report | passing                                       |
| Browser demo regression     | **failed, then fixed** — see finding 1        |
| Mobile request-path         | passing against a live backend over real HTTP |
| `git diff --check`          | clean                                         |

### Finding 1 — the app did not start at all

`app/document/processing.test.tsx` crashed the entire application on load with
`expect is not defined`.

Expo Router turns **every** `.tsx` under `app/` into a route. Its context regex
excludes only `+api`, `+middleware`, `+html` and `+native-intent`; there is no
exclusion for test files. So the test was bundled and executed as a screen.

Nothing in the test suite could have caught this — the file passed as a test
while breaking the app that contained it. It took loading the app in a browser,
which is the entire argument for keeping that step on the checklist.

Fixed by moving the file to `__tests__/app/document/`, mirroring the route path,
with `jest.config.js` pointing there and carrying a comment explaining why
screen tests may never live under `app/`.

### Finding 2 — a privacy claim the build does not honour

The disclaimer screen tells the user:

> Documents are encrypted and stored in the Mumbai (ap-south-1) region.

In Phase 1 that is **not true**. There is no cloud storage; documents are held
locally and processed by a backend running on a developer machine or in
Codespaces. § 8 of phase-1.md requires the operational limitations to stay
visible in documentation _and demos_, and this is the opposite — a specific,
confident, incorrect statement about where a family's medical records live.

Left unchanged deliberately: it is product copy, and the fix is a product
decision about what to say instead. **It should be corrected before this build
is shown to anyone outside the team.**

The neighbouring limitation is handled well and is the model to follow — the
sign-in screen says plainly that authentication is not connected to a server.

### Also found, not blocking

- **`EXPO_PUBLIC_API_TIMEOUT_MS` is read into config and never applied.** No
  timeout is set on the processing request in `devProcessingClient`, so the app
  waits indefinitely on a backend that stops answering, while the backend
  itself can legitimately take three attempts of sixty seconds on the Sarvam
  call alone. This is the same shape as the calendar hang fixed during the
  screen walk: a call that never returns strands the UI.
- **Provider timeout reports `ai_failed`, not `processing_timeout`.** Correct as
  it stands — `processing_timeout` carries the message "Processing was
  cancelled", which is true when the caller walks away and misleading when the
  provider goes quiet — but only the caller-abort branch had a test. Two added,
  including one asserting total time is bounded by attempts × timeout rather
  than by the socket.
- **Document rows are not exposed to the accessibility tree.** They are
  reachable by touch but carry no role or label, so a screen reader cannot find
  them. Not a Phase 1 exit criterion; worth a look before real users.

### Exit criteria

Met: OCR extracts page-aware text; known PII is redacted; likely remaining PII
blocks the AI call; only redacted text reaches the provider; output conforms to
the shared schema; important values retain page sources; confidence and
uncertainties display; temporary files are always deleted; logs contain no
medical text or PII; mock mode works; all tests pass.

Confirmed by driving the running application, not only by test: the summary
screen shows per-page source badges on every finding and medicine, an
uncertainty banner, `confidence 88%`, and `8 personal details removed before
this document was summarised (redaction-v2)`.

A live request over real HTTP, using the field names the app actually sends,
returned `redaction-v2` with `facility: 1` and `patientName: 1` — the facility
rules firing on genuine OCR output rather than a fixture. OCR confidence came
back at 48, and the low-confidence hedging engaged as designed.

**Not met: "no real patient data has been used."** Four real documents — a lab
report, a photographed handwritten prescription, a discharge summary and a
laboratory report — were used to find redaction failures. They were never
committed, and every regression test derived from them is written from
synthetic text. But the criterion as written is not satisfied, and recording it
as passed would be false. The honest statement is that Phase 1 committed only
synthetic data and tested against a small number of real documents supplied for
that purpose.

### Recommendation

Phase 1 is functionally complete and the privacy pipeline does what it claims.
Two things should happen before it is demonstrated outside the team: correct the
storage claim on the disclaimer screen, and put a timeout on the processing
request. Neither is large. The Phase 2 gate should also record the real-document
question above rather than inherit a criterion that was not met.

---

## P1-13 — Closing the two exit-review findings

**Done 2026-08-19**

P1-12 left two things that had to be fixed before this build could be shown to
anyone outside the team. Both are now closed.

### Finding 2 — the storage claim

The disclaimer told users their documents were "encrypted and stored in the
Mumbai (ap-south-1) region" in a build with no cloud storage. Reviewing it
turned up **two more places making the same claim** that P1-12 had not caught:
the privacy settings screen and the settings tab's storage row.

Rather than rewrite three strings — which is how they drifted apart in the first
place — the description now comes from one module,
[`src/config/dataResidency.ts`](../../src/config/dataResidency.ts), which
classifies the running build into a tier and returns copy for it:

| Tier            | When                                   | What it says                                                 |
| --------------- | -------------------------------------- | ------------------------------------------------------------ |
| `on-device`     | no backend reachable                   | documents stay on the phone, nothing is uploaded             |
| `local-backend` | a development server on a private host | pages go to a dev server and are deleted after being read    |
| `cloud`         | an `https://` platform URL             | the region, KMS and residency claim — the only tier that may |

Non-cloud tiers also set `isPrototype`, which puts a "This is a test build"
callout above the description on the privacy screen. § 8 of phase-1.md requires
operational limitations to stay visible in demos, not only in documentation;
this is that requirement implemented rather than remembered.

The rule is now testable, and tested: `dataResidency.test.ts` asserts that no
non-cloud tier can mention `ap-south-1`, `Mumbai`, `AWS`, `KMS`, or the phrase
"encrypted stored", and that the cloud tier follows `EXPO_PUBLIC_AWS_REGION`
rather than hard-coding a region. A future edit that reintroduces the claim
fails the suite instead of shipping.

### Finding 3 — the processing request had no timeout

`EXPO_PUBLIC_API_TIMEOUT_MS` was applied by `apiRequest` all along; the gap was
that `devProcessingClient` builds its own multipart `fetch` and passed **no
signal at all**. A backend that accepted the upload and went quiet left the
processing screen spinning with no exit but force-quitting the app.

**Applying the existing 20 s timeout would have been the wrong fix.** The
orchestrator budgets itself 120 s, inside which the summary provider may spend
three attempts of 60 s, so a CRUD-sized deadline would have failed documents
that were still being processed correctly — trading a hang for a false failure.
So processing got its own budget: `EXPO_PUBLIC_PROCESSING_TIMEOUT_MS`, default
180 s, with a test asserting it stays above the backend's own 120 s.

The deadline composes with the caller's signal by hand rather than through
`AbortSignal.any`, which is not available on every runtime this app ships to.
Which of the two fired is tracked, because they mean opposite things to the
person holding the phone:

- **they left the screen** — `processing_timeout`, "Processing was cancelled",
  not retryable. Not a failure.
- **the server went quiet** — `processing_timeout`, "The processing service did
  not reply in time", retryable.

The body is read while the deadline is still live. A server that sends headers
and then stalls would otherwise hang on `response.json()` — the same stranded
screen one step further along, and exactly the kind of gap the original fix
would have left open.

### Tests added

22 new tests (331 → 353, 24 → 25 suites). `dataResidency.test.ts` covers tier
resolution and the claims each tier is permitted to make. The deadline suite
covers: a signal always reaching `fetch`; a silent server failing rather than
hanging; the wording distinguishing a timeout from a cancel; the client budget
exceeding the backend's; a cancel during a live request still reading as a
cancel; the timer being cleared on both success and failure; and a stalled body
timing out.

### Verification

`npm run verify` — typecheck, lint, 353 tests across 25 suites, all passing.
Backend unchanged: 373 tests across 14 files.

Confirmed by driving the running app, since that is what caught finding 1: the
disclaimer reads "Documents stay on this phone and are not uploaded anywhere",
the settings row reads "This device only", and the privacy screen shows the
test-build callout above the on-device description.

### Also fixed

`.claude/launch.json` pinned the Expo web server to port 19006. Port 8081 is
taken by Docker on this machine, and `expo start` then asks an interactive
question that a non-interactive launch cannot answer, so the preview failed to
start at all.

### Noted, not changed

`read_page` returns an empty accessibility tree for the running web app while
the screen renders normally, which is likely the same root cause as P1-12's note
that document rows are not exposed to assistive technology. `DocumentCard`
passes a label and hint through `Card`, which sets `accessibilityRole="button"`,
so the components look correct and the problem is more likely in how
react-native-web projects them. Worth a proper accessibility pass before real
users; not a Phase 1 exit criterion.

### Still open from P1-12

The exit criterion "no real patient data has been used" remains not met, for the
reasons recorded there. It is inherited by the Phase 2 gate rather than closed
here.

---

## P1-14 — Demonstration mode

**Done 2026-08-19**

Phase 2 planning raised whether the app still needed its mock layer once a local
stack existed. The answer turned out to be yes, but not as mocks: there is a
real need to show this app to an investor, a hospital or a family with no
Docker, no network and no backend. That is a product feature and now looks like
one.

### The bug this found

`seedDemoData()` ran on **every** first launch, gated only on the vault being
empty — not on the build being a demonstration. The first real caregiver to
install a live build would have opened the app to two parents they had never
met, carrying invented medicines and doses.

Fictional records are the entire point of a demo and a safety problem anywhere
else: a person can act on a dose that was written to fill a screenshot. The
seed now refuses outright in a live build, and two tests hold that line.

### What changed

`EXPO_PUBLIC_USE_MOCKS` became `EXPO_PUBLIC_DEMO`, which is not a rename. The
old flag meant "use fake services"; the new one names a build flavour with three
properties that make it safe to hand to a stranger:

1. **Chosen at build time.** A production bundle has `EXPO_PUBLIC_DEMO=false`
   compiled in and cannot be talked into demo mode by a setting, a deep link or
   a support call. The default follows the environment — a local checkout is a
   demo unless it opts out, everything else is live unless it opts in — so a
   fresh clone stays demoable with no setup and no release becomes a demo by
   accident.
2. **No demo build can reach a server.** `isBackendEnabled` returns false
   unconditionally for a demo build. Somebody will photograph a real
   prescription during a demonstration; this is what makes that safe, rather
   than trusting that the API URL was left blank.
3. **The app says so.** A badge on the dashboard above the fold, a `demo` tier
   in `dataResidency` stating the records are fictional, and
   `0.1.0 · local · demonstration build` on the version row.

Also added: a **Start a fresh demonstration** action in settings, which puts the
fictional records back for the next audience and refuses to run in a live build,
where it would be data loss.

`eas.json` gained a `demo` profile (internal APK, blank API URL) and `preview`
was corrected — it had `EXPO_PUBLIC_USE_MOCKS=true`, so every internal preview
build was a demo in everything but name.

### Decisions worth recording

**Three runtime modes were kept, deliberately.** The Phase 2 discussion argued
for collapsing to local and cloud, because a third implementation of the same
contract is where behaviour drifts. Demo mode survives that argument only
because it is now build-gated, visibly labelled, and cannot reach a backend —
and because the alternative is having nothing to show a hospital. It is a
product surface, not a test double, and should not be used as one.

**The demo tier does not promise records are "never sold".** Every other tier
does. The promise is vacuous when the records are invented, and a test asserts
the distinction rather than leaving it to whoever edits the copy next.

### Tests added

18 new tests (353 → 371). `isDemoBuild` across every environment; a demo build
refusing both a cloud and a local backend URL; the seed refusing to populate a
live vault and the reset refusing to wipe one; and the demo tier's copy stating
that records are fictional and that anything the audience adds stays on the
device.

### Verification

`npm run verify` — typecheck, lint, 371 tests across 25 suites, all passing.

Confirmed in the running app: the badge reads "Demonstration — these records are
fictional" above the fold on the dashboard, settings shows the Demonstration
section with the reset action, the version row reads "0.1.0 · local ·
demonstration build", and the storage row reads "Demonstration build — fictional
records".

### Limitations

- The live-build seeding refusal is covered by test, not by a browser walk. It
  needs a second dev server on a different environment, which is worth doing
  once the local stack lands.
- Demo capture still produces an illustrative summary on-device. That is honest
  — the privacy copy says so — but the demo therefore cannot show the real
  redaction pipeline. Showing that needs the local backend and the `development`
  profile.

---

## ADR-003 and P2-00 — the local stack, and the first two ports

**Done 2026-08-19**

Phase 2 was gated on an AWS account that does not exist. Most of it is not
really about a cloud provider — the data model, the upload protocol, the
processing states — so it should not have been waiting.
[ADR-003](./adr/003-local-cloud-parity.md) records the decision: every cloud
dependency behind a port, drivers chosen in the backend from
`AYUNETZ_STACK=local|aws`, and an integration suite written against the ports so
it becomes the AWS acceptance test on the day there is an account.

[phase-2.md § 10](./phase-2.md) records what that means step by step, and what
the exit gate must now check on real AWS rather than assume.

### The thing the ADR got wrong, in a useful direction

ADR-003 describes "a local driver and an AWS driver" per port, and lists "code
that never ships" as a cost. Building it showed that for object storage, records
and the queue there is only **one** driver. MinIO speaks S3, DynamoDB Local is
DynamoDB's API, ElasticMQ speaks SQS — so the same AWS SDK client serves both
stacks, differing only in endpoint and credentials. Identity is the same story:
a local issuer and a Cognito pool are both JWKS endpoints.

So the local path exercises the code that ships rather than a parallel
implementation of it, and the predicted cost largely does not exist. OCR remains
the exception and the only port needing a genuinely separate implementation,
because Textract has no local equivalent. This is recorded in `config/stack.ts`
rather than by rewriting the ADR, since the ADR is the decision as taken.

### What changed

`backend/docker-compose.yml` — MinIO, DynamoDB Local and ElasticMQ, health
checked, on ports 19090–19094. Non-default on purpose: medical records are not
worth mixing up with whatever else is on `9000`. `npm run stack:up` waits for
all three to report healthy.

`backend/local/elasticmq.conf` — the processing queue and its dead-letter queue,
with a 180 s visibility timeout (longer than the orchestrator's own 120 s
budget, so a slow worker does not have its message handed to a second one) and
redrive after three attempts.

`backend/src/config/stack.ts` — stack resolution. Defaults to `local`, so a
checkout with nothing configured cannot reach a real account.

`backend/src/services/objects/ObjectStore.ts` — presigned PUT, and the object
key layout. Keys are owner-first (`owners/<id>/documents/<id>/pages/001`) so
erasure is a prefix operation rather than a scan, and carry no name, date of
birth or device filename, because a bucket listing is metadata and metadata
about medical records leaks.

`backend/src/services/queue/JobQueue.ts` — enqueue, long-polling receive,
acknowledge. A job carries identifiers only, enforced at runtime: a queue is
durable, visible in a console, and often the first thing exported when someone
debugs a backlog, so ADR-001's logging rule applies to it for the same reasons.

### The finding

A test asserting that a presigned URL refuses a mislabelled upload **failed**.
The content type was being sent but not signed — SigV4 covers only `host` by
default — so the URL accepted a body of any type.

Fixed by naming `content-type` in `signableHeaders` rather than by weakening the
test. It is defence in depth, not the primary control: the pipeline still
decides format on the file's bytes, because a client that mislabels a PDF is a
bug and a client that lies about it is an attacker.

Worth noting this was found by running against a container, not by review. It is
also the first thing to re-check on real AWS, since it is exactly the shape of
detail an emulator can differ on.

### Tests added

15 in `test/integration/localStack.test.ts` (373 → 388), against the running
containers: object round-trip, absence reported rather than thrown, deletion,
owner-prefixed keys, page numbers padded so a listing sorts in reading order,
presigned upload succeeding without any credential, a mislabelled upload
refused, a URL repointed at another document refused, expiry present and
bounded, a job surviving enqueue → receive → acknowledge without redelivery, a
job carrying OCR text refused, `local` as the default stack, endpoints and
credentials dropped under `aws`, and no credential in the startup log line.

The suite skips — loudly, printing the command to start the stack — when the
containers are not running, so a developer without Docker sees "skipped" rather
than a wall of connection errors.

### Verification

`npm run backend:verify` — 387 passing, 1 skipped, 15 files. Confirmed both
ways: with the stack up (14 stack tests run) and with a container stopped (they
skip and the suite stays green). Frontend untouched at 371.

### Limitations

- Repository and identity ports are not built yet. The records container is
  running and unused.
- No AWS driver has ever been executed. That is the point of the arrangement,
  but it means the `aws` path is unproven code until an account exists.
- The local stack proves wiring, not AWS behaviour. IAM, KMS policies, bucket
  policies, Cognito's flows, Textract's output and `ap-south-1` residency are
  untested by construction — the list is in ADR-003 and the § 10 exit criteria.
