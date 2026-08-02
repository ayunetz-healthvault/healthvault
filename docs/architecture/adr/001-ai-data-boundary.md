# ADR-001 — AI Data Boundary

- **Status:** Accepted for architecture planning
- **Date:** 2026-08-02
- **Owners:** Ayunetz Health Vault
- **Decision type:** Privacy, security and integration architecture

## Context

Ayunetz Health Vault processes medical documents that may contain:

- patient names
- addresses
- phone numbers
- dates of birth
- government identifiers
- hospital identifiers
- insurance identifiers
- medical findings
- medication information
- follow-up instructions

The mobile application needs AI-generated plain-language summaries, but placing an external model API key in a mobile application would expose the credential. Sending original document images to an external model would also transmit direct identifiers before Ayunetz could remove them.

A strict boundary is required between:

1. the user device
2. the Ayunetz-controlled processing environment
3. the external AI provider

## Decision

The mobile application will never call Sarvam AI or another LLM directly.

All external AI requests will be created by an Ayunetz-controlled backend after OCR, redaction and privacy validation.

The processing order is mandatory:

```text
original document
  -> Ayunetz-controlled OCR
  -> Ayunetz-controlled PII redaction
  -> independent leakage check
  -> external AI request containing redacted text only
  -> schema and source validation
```

If the leakage check fails, the external AI request is not made.

## Permitted external payload

The external provider may receive:

- pseudonymous document ID
- document category
- redacted page text
- page boundaries
- language hint
- structured output schema
- summarisation instructions
- medical-safety instructions

## Prohibited external payload

The external provider must not receive:

- original image
- original PDF
- S3 object location
- presigned URL
- patient name
- caregiver name
- address
- phone number
- email address
- direct government identifier
- patient, hospital or insurance identifier
- Cognito subject
- account email
- access token
- secret value
- unredacted OCR text

## Credential handling

The Sarvam API key:

- exists only in backend secret storage
- is read using a least-privilege execution identity
- is never written to logs
- is never returned by an API
- is never placed in an `EXPO_PUBLIC_*` variable
- is never committed to the repository
- is rotated through an operational process

Phase 1 may use a Codespaces secret for synthetic testing. Phase 2 uses AWS Secrets Manager or an approved equivalent.

## Original document storage

### Phase 1

Original synthetic pages may be stored temporarily during processing and are deleted in a `finally` block after success or failure.

### Phase 2

Original pages are stored in a private, encrypted Ayunetz-controlled object store. Temporary derived artefacts use short retention and are deleted or expired after processing.

## Logging decision

Logs must contain technical metadata only.

Allowed examples:

```text
requestId
documentId
processingStage
durationMs
providerStatusCategory
retryCount
errorCategory
```

Prohibited examples:

```text
document text
redacted text
prompt
model response
name
address
phone
email
token
secret
object URL
presigned URL
```

## Pseudonymisation limitation

The external payload is pseudonymised, not guaranteed anonymous.

Medical context can remain identifying even after direct identifiers are removed. Residual re-identification risk must be reviewed before real patient data is sent externally.

## Consequences

### Positive

- model credentials are not exposed in the app
- direct identifiers are removed before external processing
- privacy failures stop processing
- model providers can be changed behind an interface
- external payloads are testable
- the mobile application remains simpler

### Negative

- backend infrastructure is required
- OCR and redaction add latency and cost
- false-positive redaction may remove clinical information
- false-negative redaction remains a risk
- difficult handwriting may require manual review or user rescan
- provider contractual diligence is still required

## Alternatives considered

### Direct Sarvam call from mobile

Rejected because:

- API key would be extractable
- request policy could be bypassed
- original documents could leave the device before redaction
- central validation and auditing would be weak

### Send original document to a vision model

Rejected for the approved privacy-first path because direct identifiers would be transmitted before Ayunetz-controlled redaction.

This option could be reconsidered only after explicit legal, contractual, privacy and product approval.

### Fully local on-device OCR and model

Not selected for the MVP because of device variability, performance, model size, update complexity and limited operational control. Local components may be evaluated later.

## Enforcement

Automated tests must verify:

- no external AI request occurs after leakage failure
- no AI key is available through client configuration
- external request fixtures contain no known PII test values
- logs do not contain synthetic sensitive fixtures
- temporary files are deleted after success and failure
