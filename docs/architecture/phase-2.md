# Phase 2 — AWS India Cloud Platform and Full AI

## 1. Objective

Phase 2 converts the Phase 1 prototype into a production-style platform with:

- authenticated caregivers
- tenant isolation
- encrypted document storage
- direct mobile uploads
- asynchronous OCR and processing
- production PII redaction
- controlled Sarvam AI integration
- structured summaries
- cross-document health consolidation
- confirmed follow-ups and reminders
- export and deletion
- monitoring and failure recovery

Real patient data is permitted only after security, privacy, legal, provider-contract and operational acceptance.

## 2. Target architecture

Primary AWS region:

```text
ap-south-1
```

All AWS services should remain in-region unless a documented, reviewed and approved exception exists.

```text
┌─────────────────────────────────────────────────────────────────┐
│ Expo mobile application                                         │
│                                                                 │
│ Cognito authentication                                          │
│ Parent profiles                                                 │
│ Document capture                                                │
│ Direct upload                                                   │
│ Processing status                                               │
│ Summaries and health overview                                   │
│ Follow-ups and reminders                                        │
└───────────────────────────────┬─────────────────────────────────┘
                                │ Cognito token / HTTPS
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ Amazon API Gateway                                              │
│ JWT authorisation, throttling and request validation            │
└───────────────┬──────────────────────────────┬──────────────────┘
                │                              │
                ▼                              ▼
┌──────────────────────────┐      ┌───────────────────────────────┐
│ CRUD Lambda functions    │      │ Upload Lambda                 │
│                          │      │                               │
│ account                  │      │ create document               │
│ parents                  │      │ create short-lived URLs       │
│ documents                │      │ complete upload               │
│ summaries                │      │ enqueue processing            │
│ follow-ups               │      └───────────────┬───────────────┘
└──────────────┬───────────┘                      │
               │                                  ▼
               ▼                     ┌─────────────────────────────┐
┌──────────────────────────┐         │ S3 documents bucket         │
│ DynamoDB                 │         │                             │
│                          │         │ private                     │
│ tenant-scoped records    │         │ SSE-KMS                     │
│ processing metadata      │         │ blocked public access       │
│ summaries                │         │ lifecycle policies          │
│ overview                 │         └──────────────┬──────────────┘
│ audit metadata           │                        │
└──────────────────────────┘                        ▼
                                      ┌─────────────────────────────┐
                                      │ Processing SQS + DLQ        │
                                      │ idempotent jobs             │
                                      └──────────────┬──────────────┘
                                                     ▼
                                      ┌─────────────────────────────┐
                                      │ OCR starter / worker        │
                                      │                             │
                                      │ Amazon Textract             │
                                      │ page and geometry output    │
                                      └──────────────┬──────────────┘
                                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ Ayunetz document-processing worker                              │
│                                                                 │
│ retrieve OCR result                                             │
│ normalise by page                                               │
│ deterministic profile-aware redaction                           │
│ Indian identifier rules                                        │
│ optional supplementary entity detection                         │
│ independent leakage gate                                        │
│ stop or manual review if unsafe                                 │
└───────────────────────────────┬─────────────────────────────────┘
                                │ redacted text only
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ Sarvam AI                                                      │
│                                                                 │
│ structured extraction and summary                              │
│ strict schema                                                  │
│ no original file                                               │
│ no direct known identifiers                                    │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ Validation and persistence                                     │
│                                                                 │
│ JSON schema                                                    │
│ numeric/source consistency                                     │
│ medication/date checks                                         │
│ safety checks                                                   │
│ DynamoDB summary                                                │
│ parent overview refresh                                         │
└─────────────────────────────────────────────────────────────────┘
```

## 3. Core AWS resources

### Authentication

- Amazon Cognito user pool
- public mobile application client
- PKCE where applicable
- email verification
- password recovery
- refresh-token handling
- optional MFA after MVP
- API Gateway JWT authorisation

### Data

- DynamoDB table
- customer-managed KMS key
- point-in-time recovery
- backup policy
- tenant-scoped partition keys
- conditional writes
- idempotency records

### Documents

- private S3 document bucket
- customer-managed KMS encryption
- blocked public access
- bucket ownership controls
- versioning decision
- object lifecycle rules
- bucket policy requiring encryption
- short-lived presigned upload and download URLs

### Processing

- SQS processing queue
- SQS dead-letter queue
- Textract completion handling
- Lambda functions or container workers
- idempotent processing jobs
- bounded retries
- processing timeouts
- manual-review state

### Secrets

- AWS Secrets Manager
- Sarvam API key
- provider configuration
- secret rotation process
- least-privilege execution role

### Monitoring

- CloudWatch logs
- CloudWatch metrics
- alarms
- DLQ alarm
- processing-failure alarm
- latency alarm
- cost budget
- CloudTrail
- security findings as appropriate

## 4. Data model

Recommended single-table structure:

```text
PK=USER#<cognito-sub>
SK=PROFILE

PK=USER#<cognito-sub>
SK=PARENT#<parentId>

PK=USER#<cognito-sub>
SK=DOC#<parentId>#<documentId>

PK=USER#<cognito-sub>
SK=PROCESSING#<documentId>

PK=USER#<cognito-sub>
SK=SUMMARY#<documentId>

PK=USER#<cognito-sub>
SK=FUP#<dueDate>#<followUpId>

PK=USER#<cognito-sub>
SK=OVERVIEW#<parentId>

PK=USER#<cognito-sub>
SK=IDEMPOTENCY#<operation>#<key>

PK=USER#<cognito-sub>
SK=AUDIT#<timestamp>#<eventId>
```

Audit records contain metadata only. They must not contain OCR text, summary content, PII, secret values or presigned URLs.

## 5. S3 object model

Recommended structure:

```text
users/<sub>/parents/<parentId>/documents/<documentId>/original/<pageId>.<ext>
users/<sub>/parents/<parentId>/documents/<documentId>/derived/<artefact>
```

Derived processing artefacts should use a separate bucket or tightly controlled prefix with short retention.

Do not place patient names in object keys.

## 6. Production processing sequence

```text
1. Authenticated client creates document record.
2. Backend verifies ownership and document state.
3. Backend creates short-lived presigned upload target per page.
4. Client uploads pages directly to S3.
5. Client calls complete-upload endpoint.
6. Backend validates expected objects and enqueues one processing job.
7. Worker claims the job idempotently.
8. Worker starts or performs OCR.
9. OCR result is normalised by page.
10. Known and detected identifiers are redacted.
11. Independent leakage gate runs.
12. Unsafe documents fail or enter manual review.
13. Safe redacted text is sent to Sarvam.
14. Structured output is schema validated.
15. Critical values are checked against redacted OCR.
16. Summary and processing metadata are stored.
17. Parent health overview is invalidated or refreshed.
18. Client polls or receives a safe completion signal.
19. Temporary derived artefacts expire or are deleted.
```

# 7. Sequential implementation steps

---

## P2-01 — Infrastructure-as-code foundation

### Objective

Create deployable and destroyable AWS environments.

### Work

Create:

```text
infra/
  bin/
  lib/
    auth-stack.ts
    data-stack.ts
    api-stack.ts
    processing-stack.ts
    monitoring-stack.ts
  test/
```

Use AWS CDK or SAM consistently.

Environments:

```text
dev
staging
production
```

CI should use short-lived AWS role assumption rather than permanent access keys.

### Acceptance criteria

- development environment deploys
- development environment destroys cleanly
- environment names are explicit
- no account ID or secret is hard-coded
- infrastructure tests pass
- production deployment requires explicit approval

---

## P2-02 — Encryption and core data resources

### Objective

Create encrypted storage and database resources.

### Work

- customer-managed KMS key
- private S3 documents bucket
- optional processing bucket
- DynamoDB table
- point-in-time recovery
- lifecycle policies
- blocked public access
- bucket policies requiring encryption
- least-privilege access policies

### Recommended retention

- original documents: user-controlled according to product policy
- temporary OCR or normalised text: delete as soon as practical
- failed derived artefacts: short quarantine period only when operationally necessary
- logs: metadata only

### Acceptance criteria

- public access is blocked
- unencrypted writes are rejected
- only required roles can decrypt
- backups and recovery are documented
- no patient data appears in resource names

---

## P2-03 — Cognito authentication and API authorisation

### Objective

Replace mock sessions with production authentication while keeping mock mode for tests.

### Work

- Cognito user pool
- mobile application client
- sign-up
- verification
- sign-in
- password recovery
- token refresh
- sign-out
- API Gateway JWT authorisation
- client-side secure token storage
- tenant ownership checks in every handler

### Acceptance criteria

- User A cannot read or modify User B's records
- expired token is rejected
- refresh path works
- logout removes local tokens
- mock auth remains available in test configuration

---

## P2-04 — DynamoDB data model and CRUD APIs

### Objective

Implement persistent account, parent, document and follow-up records.

### Work

Implement existing API contracts for:

- account
- parents
- documents
- follow-ups
- summary retrieval
- processing state

Use:

- conditional writes
- tenant-scoped keys
- pagination
- input validation
- idempotent creation where relevant

### Acceptance criteria

- authenticated CRUD works
- cross-tenant access fails
- invalid IDs fail safely
- pagination is tested
- deletion behaviour is defined
- no scans are used for primary user journeys

---

## P2-05 — Secure direct uploads

### Objective

Upload original document pages directly from the mobile app to encrypted S3.

### Endpoints

```text
POST /v1/documents
POST /v1/documents/{documentId}/uploads
POST /v1/documents/{documentId}/uploads/complete
```

### Enforce

- authenticated ownership
- expected object key
- content type
- size limit
- page count
- short expiration
- KMS encryption
- allowed document state
- one-time completion semantics

### Acceptance criteria

- mobile client holds no AWS credentials
- upload URLs expire
- one user cannot upload to another user's prefix
- complete upload validates expected pages
- duplicate completion is idempotent
- no presigned URL is logged

---

## P2-06 — Asynchronous processing and failure model

### Objective

Create a reliable idempotent processing pipeline.

### Work

- SQS processing queue
- DLQ
- job record
- idempotency key
- processing lease or lock
- bounded retry policy
- partial batch response
- timeout handling
- explicit failure categories
- retry endpoint

### States

```text
queued
processing
ready
failed_ocr
failed_privacy
failed_ai
failed_validation
manual_review_required
```

### Acceptance criteria

- duplicate messages do not create duplicate summaries
- poison messages reach DLQ
- successful messages are not retried with failed ones
- client receives a stable status
- retry does not overwrite a successful summary accidentally

---

## P2-07 — Amazon Textract integration

### Objective

Support production OCR for images and multi-page PDFs while preserving page sources.

### Work

- OCR provider abstraction retained
- add `AwsTextractOcrProvider`
- synchronous path for eligible small images if chosen
- asynchronous path for PDF and multi-page input
- persist Textract job ID
- handle completion
- paginate result retrieval
- preserve page number and block geometry
- use encrypted output location when configured
- delete or expire intermediate output

### Acceptance criteria

- JPG works
- PNG works
- multi-page PDF works
- page order is preserved
- unreadable-page behaviour is defined
- duplicate completion is idempotent
- OCR content does not enter logs

Before implementation, confirm current regional availability and quotas in the target AWS account.

---

## P2-08 — Production PII redaction

### Objective

Harden the Phase 1 redaction system for production.

### Layers

#### Layer 1 — Known profile values

- patient name
- aliases
- DOB
- phone
- city
- address when collected
- known patient or member IDs

#### Layer 2 — Deterministic Indian and general patterns

- Aadhaar
- PAN
- passport
- phone
- email
- postal address
- patient ID
- MRN
- registration number
- insurance/member identifier
- identifier-bearing URLs

#### Layer 3 — Supplementary entity detection

An in-region entity-detection service may be used as a second opinion after confirming:

- current regional availability
- supported languages
- contractual suitability
- false-negative and false-positive behaviour

It must never be the sole redaction layer.

### Acceptance criteria

- synthetic English reports pass
- Indian identifier formats are covered
- known-name matching survives case and spacing differences
- clinical values are preserved
- multilingual limitations are documented
- redaction version is recorded

---

## P2-09 — Privacy gate and manual review

### Objective

Handle uncertain documents without exposing them externally.

### Manual-review triggers

- low OCR confidence
- suspected PII remains
- redaction removes excessive clinical content
- page mapping is lost
- critical numeric inconsistency
- malformed document
- unsupported language or handwriting
- conflicting processing outputs

### Behaviour

- do not call Sarvam after privacy failure
- store only safe technical reason metadata
- allow retry after user uploads a clearer document
- manual review must not be silently performed by unapproved personnel

### Acceptance criteria

- unsafe requests never leave Ayunetz boundary
- no suspected text appears in response or logs
- retry state is clear
- review access is least-privilege and audited if manual review is later introduced

---

## P2-10 — Production Sarvam integration

### Objective

Call Sarvam only from the controlled worker with redacted text.

### Work

- store key in Secrets Manager
- retrieve using execution role
- cache secret safely where appropriate
- configure model and base URL
- strict JSON schema
- timeout
- retry policy
- circuit-breaker or failure-rate protection
- request-size control
- provider-level metrics without content
- contractual and retention review

### Send

- redacted page text
- pseudonymous document ID
- category
- page boundaries
- language hint
- safety prompt
- output schema

### Do not send

- original file
- object URL
- patient name
- account identity
- Cognito subject
- address or phone
- unredacted OCR
- secret or token

### Acceptance criteria

- captured test payload contains no known PII fixtures
- key never reaches mobile app
- key never appears in logs
- provider outage produces a typed retryable failure
- malformed response is rejected

---

## P2-11 — Output validation and medical-safety checks

### Objective

Prevent unsupported or fabricated content from becoming an accepted summary.

### Validate

- JSON schema
- supported enum values
- confidence range
- source-page references
- critical number exists in OCR
- unit exists in OCR
- reference range exists in OCR
- medication name exists in OCR
- dosage and frequency exist in OCR
- written follow-up date exists in OCR
- no unsupported diagnosis
- no medication-change recommendation
- no invented treatment recommendation

### Result classes

```text
accepted
accepted_with_uncertainties
manual_review_required
rejected
```

### Acceptance criteria

- hallucinated critical values are rejected or marked uncertain
- every accepted finding has a valid source page
- invalid doctor category is rejected
- summary cannot claim diagnostic certainty

---

## P2-12 — Summary persistence and mobile integration

### Objective

Complete the real cloud flow from upload to summary retrieval.

### Endpoints

```text
GET  /v1/documents/{documentId}/processing
POST /v1/documents/{documentId}/processing/retry
GET  /v1/documents/{documentId}/summary
```

### Mobile behaviour

- poll with bounded backoff
- stop polling on terminal state
- cache ready summary locally
- show offline read state
- show retryable and non-retryable errors
- never expose backend internals
- retain original-document access

### Acceptance criteria

- authenticated upload reaches ready
- app survives temporary network loss
- duplicate polling is harmless
- failed state is understandable
- local cache does not replace server source of truth

---

## P2-13 — Multi-document patient consolidation

### Objective

Create a source-linked health overview from structured summaries.

### Input

Use structured, validated summaries rather than original documents.

### Output

```ts
interface PatientHealthOverview {
  parentId: string;
  generatedAt: IsoDateTime;
  timeline: TimelineItem[];
  trends: HealthTrend[];
  medicinesMentioned: ConsolidatedMedicine[];
  pendingFollowUps: ConsolidatedFollowUp[];
  overdueFollowUps: ConsolidatedFollowUp[];
  conflictingInformation: ConflictItem[];
  involvedDoctorCategories: DoctorCategory[];
  questionsForNextVisit: string[];
  uncertainties: string[];
  sourceDocumentIds: string[];
}
```

### Consolidation rules

- every item links to source document and page
- do not merge conflicting medicine entries silently
- do not infer a diagnosis
- distinguish observed values from model interpretation
- preserve chronology
- incremental refresh after a new summary
- allow full rebuild

### Endpoints

```text
GET  /v1/parents/{parentId}/health-overview
POST /v1/parents/{parentId}/health-overview/refresh
```

### Acceptance criteria

- new document updates overview
- sources remain traceable
- contradictory information is visible
- no original document is sent externally for consolidation
- cross-tenant access fails

---

## P2-14 — Follow-up extraction and confirmation

### Objective

Convert explicit document instructions into user-confirmed follow-ups.

### Sources

- repeat test date
- review appointment
- medicine refill
- physiotherapy
- vaccination
- monitoring instruction

### Origin types

```text
document_explicit
app_suggested
manual
```

### Rules

- AI never creates a calendar event automatically
- user must confirm title, date, time and target calendar
- undated instructions remain suggestions, not scheduled events
- source document and page are retained
- generated suggestions are visually distinct from written instructions

### Acceptance criteria

- no event is created without confirmation
- source is visible
- edit-before-save works
- duplicate follow-ups are detected or warned about

---

## P2-15 — Notifications and reminders

### Objective

Notify users without exposing health information on a lock screen.

### Events

- follow-up due soon
- follow-up overdue
- processing ready
- processing failed
- action required

### Privacy-safe default

Good:

```text
Ayunetz: A follow-up is due tomorrow.
```

Avoid:

```text
Your mother's diabetes blood test is overdue.
```

### Acceptance criteria

- notification content is generic by default
- user can disable notifications
- tapping notification requires app unlock when configured
- notification identifiers contain no medical details

---

## P2-16 — Data export and deletion

### Objective

Support user-controlled data portability and erasure.

### Export includes

- profile
- parent profiles
- document metadata
- original documents
- summaries
- health overview
- follow-ups
- privacy settings

### Deletion includes

- original objects
- derived artefacts
- summaries
- overview
- follow-ups
- account records
- active processing jobs
- notification registrations

### Work

- asynchronous deletion workflow
- status endpoint
- retryable deletion steps
- retention and backup caveats documented
- signed export download
- short export expiration

### Acceptance criteria

- test account exports successfully
- test account deletes successfully
- deleted user cannot authenticate
- object and record deletion are verified
- backup retention is accurately disclosed

---

## P2-17 — Monitoring, security and operations

### Objective

Operate the service without exposing medical content.

### Metrics

- upload success and failure
- OCR latency
- privacy failure rate
- AI latency and failure
- validation rejection rate
- queue depth
- DLQ count
- processing age
- API error rate
- cost

### Logs may contain

- request ID
- pseudonymous user or document ID where necessary
- stage
- duration
- error category
- retry count
- provider status code category

### Logs must not contain

- document bytes
- OCR text
- redacted text
- prompts
- AI response
- names
- addresses
- emails
- phone numbers
- tokens
- secrets
- S3 URLs
- presigned URLs

### Security controls

- least-privilege IAM
- CloudTrail
- dependency scanning
- secret scanning
- infrastructure policy tests
- API throttling
- WAF assessment
- budget alarms
- key rotation process
- incident-response runbook

### Acceptance criteria

- operators can diagnose stage failures without viewing document content
- DLQ alarm fires
- provider outage alarm fires
- no sensitive fixture appears in log test
- incident-response ownership is documented

---

## P2-18 — CI/CD and release readiness

### Objective

Create a controlled path from pull request to staged mobile release.

### Pipeline

```text
pull request
  -> frontend verification
  -> backend verification
  -> infrastructure tests
  -> secret scan
  -> dependency scan
  -> build
  -> deploy dev
  -> integration tests
  -> manual staging approval
  -> deploy staging
  -> synthetic acceptance test
```

Production requires explicit approval and change controls.

### Mobile path

- EAS development build
- Android internal testing
- staging backend
- synthetic acceptance testing
- privacy review
- security review
- limited pilot
- broader release only after pilot acceptance

### Acceptance criteria

- failed tests block deployment
- secrets are not stored in repository
- production deploy is not automatic from a normal branch push
- rollback procedure is tested
- release artefacts are traceable to commit SHA

## 8. Phase 2 exit criteria

Phase 2 is complete only when:

- users authenticate through Cognito
- tenant isolation is verified
- original documents are encrypted in the approved region
- upload uses short-lived presigned URLs
- image and PDF OCR work
- PII redaction runs before Sarvam
- privacy failures block the external request
- external payloads contain no known PII fixtures
- AI output is schema validated
- important values are source checked
- summaries display page traceability
- consolidated patient overview works
- follow-ups require user confirmation
- notifications are privacy safe
- export works
- deletion works
- monitoring and alarms work
- recovery and retry paths are tested
- secrets do not appear in client code or logs
- provider contractual terms are approved
- legal and privacy review is complete
- security review is complete
- pilot acceptance criteria are met

## 9. Items requiring confirmation before production

Before implementation or launch, reconfirm:

- current AWS regional service availability
- current AWS quotas
- Sarvam model names and API contract
- Sarvam data-retention terms
- Sarvam data-processing agreement
- applicable Indian privacy and health-data obligations
- whether any medical-device classification applies
- backup and deletion disclosures
- breach-notification process
- support access model
- manual-review policy
