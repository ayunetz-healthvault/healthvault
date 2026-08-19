# Ayunetz Health Vault — Architecture Roadmap

## Purpose

This directory defines the approved implementation architecture for Ayunetz Health Vault.

The product helps caregivers organise a family member's medical documents, understand what a document says in plain language, and track follow-up actions. It is not a diagnostic or treatment system.

[progress.md](./progress.md) records which steps are complete and what each one
changed. It is the answer to "where are we?" — this file and the phase
documents state the intent and do not change as work lands.

The architecture is divided into two delivery phases:

| Phase                   | Objective                                                                                                                                | Runtime                                                         | Permitted data                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [Phase 1](./phase-1.md) | Prove the complete privacy-first document-processing flow and connect it to the existing Expo application                                | GitHub Codespaces or another controlled development environment | Synthetic documents only                                                 |
| [Phase 2](./phase-2.md) | Build the authenticated, encrypted and asynchronous cloud platform with document storage, OCR, AI summaries, consolidation and reminders | AWS India region plus an approved external AI provider          | Real data only after security, privacy, legal and operational acceptance |

## Existing application

The current repository already contains an Expo and React Native mobile MVP with:

- onboarding and medical disclaimer
- parent profiles
- camera, gallery and file selection
- document review and mock upload
- mock document processing
- mock summaries
- follow-ups and calendar integration
- biometric and PIN lock
- backend-shaped service interfaces
- mock-versus-backend configuration

The roadmap must extend these abstractions rather than replace the application.

Relevant existing areas include:

```text
app/
src/services/api/
src/services/upload/
src/services/ai/
src/services/storage/
src/state/
src/types/
src/config/
```

## Non-negotiable architecture principles

1. The mobile application never calls Sarvam AI or another LLM directly.
2. Model credentials exist only in backend secret storage.
3. No model credential may use an `EXPO_PUBLIC_*` environment variable.
4. OCR is completed before an external LLM request.
5. Personally identifying information is redacted before text is sent to Sarvam.
6. A second independent leakage check runs after redaction.
7. If the leakage check fails, the Sarvam request is not made.
8. Privacy and safety checks fail closed.
9. Original documents remain the source of truth.
10. AI output is informational and must be reviewed against the original document.
11. The system does not diagnose, prescribe, or recommend changing medication.
12. Important extracted values retain document and page traceability.
13. Logs contain technical metadata only.
14. Logs must never contain document bytes, OCR text, redacted text, prompts, model responses, names, addresses, access tokens, secret values or presigned URLs.
15. Temporary processing artefacts are deleted after success and failure.
16. A demonstration build is available for showing the product, is chosen at
    build time, and can never reach a backend. It is not a test double — tests
    run against ports, not against it. See [ADR-003](./adr/003-local-cloud-parity.md).
17. Phase 1 uses synthetic medical documents only.
18. Real medical data is not permitted until Phase 2 exit controls are approved.

## Shared processing model

```text
Document capture
  -> validate file type and size
  -> create document record
  -> upload or temporarily receive pages
  -> OCR page by page
  -> normalise OCR output
  -> redact known and detected identifiers
  -> run independent leakage detection
  -> stop if privacy gate fails
  -> send only redacted text to the AI provider
  -> validate structured AI output
  -> verify important values against source text
  -> persist summary and processing metadata
  -> display result with confidence and page sources
```

## Trust boundaries

```text
┌───────────────────────────────────────────────────────────────────┐
│ User-controlled device                                            │
│                                                                   │
│ Expo application                                                  │
│ Original image/PDF before upload                                  │
│ Local encrypted secrets and cache                                 │
└───────────────────────────────┬───────────────────────────────────┘
                                │ authenticated HTTPS
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│ Ayunetz-controlled processing boundary                            │
│                                                                   │
│ API, storage, OCR, redaction, leakage gate, validation            │
│ Original document and unredacted OCR text remain here             │
└───────────────────────────────┬───────────────────────────────────┘
                                │ redacted text only
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│ Approved external AI provider                                     │
│                                                                   │
│ Receives no original file, user identity or known direct PII      │
│ Returns schema-constrained informational output                   │
└───────────────────────────────────────────────────────────────────┘
```

## Data permitted in an external AI request

Allowed:

- redacted text
- pseudonymous document ID
- document category
- page boundaries
- language hint
- JSON schema
- summarisation and safety instructions

Prohibited:

- original image or PDF
- patient name or aliases
- postal address
- phone number
- email address
- date of birth when used as an identifier
- Aadhaar, PAN, passport or insurance identifiers
- hospital patient or registration identifiers
- caregiver account identity
- Cognito subject
- S3 object URL
- presigned URL
- access token
- API key
- unredacted OCR text

## Pseudonymisation warning

The pipeline performs pseudonymisation, not guaranteed irreversible anonymisation.

Removing names and addresses does not eliminate all re-identification risk. Rare conditions, distinctive dates, facility names and unusual combinations of events may still identify a person. This residual risk must be assessed before real health data is sent to any external provider.

## Source traceability

Every critical summary item should be traceable to the source:

```ts
interface SourceReference {
  documentId: string;
  page: number;
  textSnippet?: string;
}
```

Source snippets must be short, redacted and optional. They must not reintroduce PII.

Critical items include:

- abnormal or important test values
- medication name
- dosage
- frequency
- written follow-up instruction
- written appointment or repeat-test date
- document-level conclusion

## Processing states

The application-level status remains compatible with the current domain model:

```text
draft
uploading
uploaded
processing
ready
failed
```

The processing pipeline should additionally expose a stage:

```text
queued
validating
reading_pages
normalising_text
redacting_pii
privacy_check
extracting_values
writing_summary
validating_summary
done
failed
manual_review_required
```

Recommended failure categories:

```text
invalid_file
upload_failed
ocr_failed
privacy_failed
ai_failed
validation_failed
processing_timeout
manual_review_required
unknown
```

## Sequential agent-delivery rule

Each numbered step in the phase documents is a separate Claude agent task.

For every step, the agent must:

1. Inspect the relevant existing files.
2. Restate the exact scope before editing.
3. Identify dependencies on earlier steps.
4. Modify only files required by the current step.
5. Preserve current mock and demo behaviour unless the step explicitly changes it.
6. Add or update automated tests.
7. Run all relevant verification commands.
8. Review `git diff`.
9. Search the diff for secrets and accidental document content.
10. Report:

- files created
- files modified
- design decisions
- tests added
- commands run
- limitations
- security and privacy implications

11. Stop for review.
12. Do not start the next numbered step automatically.
13. Do not commit or push unless explicitly instructed.

## Definition of done for any step

A step is complete only when:

- its acceptance criteria are met
- existing behaviour is not unintentionally broken
- tests pass
- no secrets are introduced
- no real patient data is used
- documentation is updated where required
- the step has an entry in [progress.md](./progress.md) recording what changed,
  the decisions taken, the tests added, the verification run and the honest
  limitations
- the agent has reported limitations honestly

## Architecture decision records

- [ADR-001 — AI data boundary](./adr/001-ai-data-boundary.md)
- [ADR-002 — PII redaction and leakage strategy](./adr/002-pii-redaction-strategy.md)
- [ADR-003 — Local and cloud parity through ports and drivers](./adr/003-local-cloud-parity.md)
