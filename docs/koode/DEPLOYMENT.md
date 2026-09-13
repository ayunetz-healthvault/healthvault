# Deployment and operations

Written for KOO-14. **Nothing here has been executed.** There is no AWS
account, no credential and no authorisation to create paid resources in the
session that wrote this, so every cloud step is a reviewable plan and a set of
commands — not a record of something that ran.

What *is* implemented and tested is the configuration safety net: the service
refuses to start in combinations that would look healthy while being wrong.

## Reconciling the two plans

`docs/architecture/phase-2.md` discusses CDK; ADR-003 discusses ports and
drivers and leaves the infrastructure tool open. **Choose CDK**, for one
reason: `tableDefinition.ts` already expresses the table, its two indexes and
its TTL as code the tests run against. CDK can consume that shape directly;
SAM would mean maintaining the same schema twice in two languages, and the
copy that drifts is always the one nobody runs.

Unchanged by that choice: Mumbai (`ap-south-1`) primary, the existing
storage/queue/record interfaces, and Tesseract as the OCR runtime. Textract
stays a documented option in phase-2 — a provider change needs measured
justification and its own ADR, not a deployment.

## What has to exist

| Resource | Requirement |
| --- | --- |
| S3 bucket | Private, block all public access, SSE-KMS with a customer-managed key, versioning on, TLS-only bucket policy |
| KMS key | Separate key for documents. Service roles get `Encrypt`/`Decrypt`/`GenerateDataKey` and nothing else |
| DynamoDB | One table, `GSI1` and `GSI2` as `tableDefinition.ts` declares, PITR on, TTL on `expiresAt` |
| SQS | Processing queue plus a dead-letter queue; visibility timeout above the pipeline's 120s budget |
| Cognito | User pool, **public** app client with no secret, `ALLOW_USER_PASSWORD_AUTH`, email alias with verification, `name` and `locale` writable (ADR-004) |
| API | HTTPS only, JWT authorizer against the pool |
| Roles | API role: read/write the table, presign objects, send to the queue. Worker role: read the table, read objects, receive/delete from the queue. Neither can create infrastructure |

The service refuses to create its own table (`ensureTable` throws on `aws`). A
service that can create tables has permissions it should not have.

## Configuration that must not ship

Enforced at startup by `productionSafety.ts`, and tested:

| Combination | Why it is refused |
| --- | --- |
| `NODE_ENV=production` with no `SARVAM_API_KEY` | The provider factory falls back to a mock, which returns plausible medical-looking text. The failure is not an error — it is a confident fabricated summary of somebody's blood test |
| `NODE_ENV=production` with `AYUNETZ_STACK=local` | Points production at endpoint overrides meant for containers on a laptop |
| `NODE_ENV=production` with `LOG_LEVEL=debug` or `trace` | Where a future contributor's temporary log line ends up, in a service handling pages of medical records |

Three separate guards already stop the development identity issuer existing
outside the local stack (`app.ts` checks the stack, `createLocalIssuer` refuses
on `aws`, `localIdentityRoutes` refuses again). It mints a valid token for any
subject asked for, so the thing being prevented is unauthenticated access to
every family's records.

`/dev/process-document` is a Phase 1 development route. It must not be exposed
in production; the mobile client no longer uses it.

## Secrets

Backend only. `SARVAM_API_KEY` in Secrets Manager, read by the service role at
start. Nothing sensitive goes in an `EXPO_PUBLIC_*` variable — those are
compiled into the app bundle and ship to every device, which `.env.example`
already says.

The Cognito app client has **no secret**, and `assertNoClientSecret()` throws if
one is configured. A secret in a mobile bundle is not a secret.

## Environments

`dev`, `staging`, `production`, each its own stack, table, bucket and pool. No
shared table: a staging test that writes to a production partition is one
environment variable away otherwise.

Fixture seeding cannot reach a live build. `seedDemoData` refuses unless
`isDemoBuild()`, which is compiled in at build time and cannot be turned on from
inside the app.

## What to watch

Content-free, all of it. Identifiers, codes, counts and durations — never page
text, summary content or filenames.

| Signal | Alarm when |
| --- | --- |
| Queue age (oldest message) | > 15 minutes — the worker is down or wedged |
| DLQ depth | > 0 — something is failing repeatedly and nobody has looked |
| Worker failures by code | `ai_failed` or `validation_failed` rising — a provider or schema change |
| `manual_review` rate | Rising — OCR quality has dropped, or documents changed shape |
| Presign failures | Any sustained rate — object store or credential problem |
| Auth 503s | Any — the identity provider is unreachable, which is not a 401 |
| Provider latency and spend | Per environment budget, with a hard cap |

The worker already emits exactly these as JSON lines (`WorkerEvent`); wiring
them to CloudWatch metrics is a deployment step, not a code change.

## Runbooks

**The worker is behind.** Check DLQ depth first. If it is zero the worker is
down — restart it; jobs are redelivered by the queue and processing is
idempotent, so nothing is lost or duplicated. If the DLQ has messages, read
their failure codes off the processing records rather than the messages
themselves.

**Replaying the dead-letter queue.** Fix the cause first. Then move messages
back to the main queue. Safe to replay: the worker checks whether the document
is already `ready` before doing anything, and rechecks the record, the grants
and consent at execution and again before writing.

**A poisoned document.** One that fails every attempt. It is already marked
`manual_review` or `failed` with a code, and the user can see the original.
Do not retry it by hand without knowing why it failed — each attempt costs an
OCR run and possibly a paid provider call.

**Restoring records.** DynamoDB PITR to a new table, verify, then switch the
service over. Never restore over a live table.

**Restoring documents.** Object versioning. Deleted pages have a delete marker;
removing it restores them. Note the interaction: if a record deletion was
intentional, restoring a backup can bring back documents somebody asked to have
removed. Check what was deleted and why before restoring anything.

**Rotating the provider key.** New key in Secrets Manager, restart the workers.
The API does not hold it.

**Rotating a Cognito signing key.** Handled by the JWKS fetch; the verifier
caches and refetches. A rotation during a request produces a 503, not a 401 —
the distinction matters, because 401 would send every user to sign in again and
that would not work either.

## Cost

Not estimable without a usage figure, and inventing one would be worse than
saying so. The variables: DynamoDB is on-demand (the access pattern is a
caregiver opening an app a few times a day, which provisioned capacity is bad
at), S3 is dominated by document volume, and the provider is per-token and the
only line that scales with *content* rather than with users. A per-environment
budget with an alarm is the control; a spreadsheet of guesses is not.

## What is blocked

Every item below needs an AWS account and authorisation this session does not
have. None is complete, and none should be recorded as complete.

- [ ] CDK stack written and deployed to a dev environment
- [ ] Cognito pool created and a synthetic-account sign-in verified end to end
- [ ] Upload → worker → summary run against real S3, DynamoDB and SQS
- [ ] IAM policies verified by *denial* — a role that should not read a bucket, proven not to
- [ ] Residency verified by something other than a configuration value
- [ ] Restore drill: PITR restore and object-version restore, both timed
- [ ] DLQ replay exercised with a real failure
- [ ] Alarms firing against real metrics
- [ ] Budget and cost figures from actual usage
