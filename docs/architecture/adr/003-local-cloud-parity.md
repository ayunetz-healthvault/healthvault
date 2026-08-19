# ADR-003 — Local and Cloud Parity Through Ports and Drivers

- **Status:** Accepted for Phase 2 planning
- **Date:** 2026-08-19
- **Owners:** Ayunetz Health Vault
- **Decision type:** Delivery, infrastructure and testing architecture

## Context

Phase 2 as written in [phase-2.md](../phase-2.md) is an AWS platform: Cognito,
API Gateway, Lambda, DynamoDB, S3, SQS, Textract, KMS. None of it exists, and
there is no AWS account yet. The intended route to one is a managed-services
partner rather than a direct account.

Waiting for an account before starting Phase 2 would stall every step that has
nothing to do with a cloud provider — the data model, the upload protocol, the
asynchronous processing states, consolidation, export and deletion. Building
against AWS SDKs with no way to run them would produce code nobody has executed.

There is a third pressure. Phase 1 shipped with a global `useMocks` boolean that
replaced whole services with fakes. [P1-14](../progress.md) turned that into a
build-gated demonstration flavour, which the product needs. What it must not
become again is a stand-in for a backend during development, because a fake that
is easier to run than the real thing is the one the tests end up trusting.

## Decision

Every cloud dependency sits behind a **port** — an interface owned by this
codebase — with at least two **drivers**: one that runs locally with no cloud
account, and one that calls the real service.

The driver set is chosen **at process start, in the backend**, from a single
environment variable:

```text
AYUNETZ_STACK=local | aws
```

Per-port overrides exist for mixing (for example, real Textract against local
storage once an account is available), but the common case is one variable.

### The mobile application does not choose

The app knows a base URL and an auth issuer. It has no driver selection, no
per-service switch, and no knowledge of which stack is behind the API. This is
the correction to Phase 1's `useMocks`, which threaded a runtime branch through
six client services.

The one exception is the demonstration build, which is a product surface rather
than a backend mode: it is chosen at build time, it cannot reach any backend,
and it says so on screen. See [ADR-002](./002-pii-redaction-strategy.md) and
P1-14.

### Ports and their drivers

| Port           | Local driver                       | AWS driver           | Fidelity |
| -------------- | ---------------------------------- | -------------------- | -------- |
| Object store   | MinIO (S3 protocol, presigned PUT) | S3 + SSE-KMS         | High     |
| Repository     | DynamoDB Local                     | DynamoDB             | High     |
| Queue          | ElasticMQ                          | SQS + DLQ            | High     |
| Identity       | Local JWT issuer with JWKS         | Cognito user pool    | Medium   |
| Request host   | Fastify                            | API Gateway + Lambda | Medium   |
| OCR            | Tesseract (Phase 1's provider)     | Textract             | **Low**  |
| Key management | Local key                          | KMS                  | **Low**  |
| Metrics        | Structured logs                    | CloudWatch           | Low      |

Handlers are written as framework-free functions. The Fastify host and a Lambda
host both adapt to the same functions rather than owning logic, so the request
host is a thin edge on both sides.

**Identity uses a local JWT issuer, not an emulated Cognito.** Cognito emulation
is a paid tier of the available emulators and buys little: what has to be proven
is that the API rejects a token that is not ours and scopes every query by
subject. Verification is JWKS-based on both sides, so only the issuer URL and
the key source differ.

### Integration tests target ports, not drivers

The Phase 2 integration suite is written once against the port interfaces and
run against both driver sets. Locally it runs against the containers on every
commit. On the day an AWS account exists, the same suite points at real services
and the difference between "works locally" and "works on AWS" becomes a test
result rather than a discovery in production.

## What this does not prove

Recording this list is the main reason this ADR exists. A local stack invites
the belief that Phase 2 is finished when it is only wired, and every item below
must be covered by the Phase 2 exit gate rather than assumed to have passed.

**IAM and infrastructure-level tenant isolation.** Local emulators do not
meaningfully enforce IAM. Any isolation resting on IAM conditions is untested
until it runs on AWS. Tenancy must therefore also be enforced in the query path,
in application code, where it can be tested — with IAM as defence in depth
rather than the only control.

**Textract accuracy, geometry and page semantics.** The adapter can be written
and fixture-tested; whether real Textract output survives the redaction rules is
unknown until it runs. Phase 1 found that redaction failures only surfaced
against real documents, and there is no reason to expect otherwise here.

**Cognito's actual flows** — hosted UI, SRP, email OTP delivery, password
policy, account recovery, token lifetimes and refresh behaviour.

**KMS key policies, grants and rotation**; S3 bucket policies, Block Public
Access, and lifecycle transitions.

**Region residency in `ap-south-1`** — which is the specific claim the app makes
to users about where their family's records live, and the one thing a local
stack can say nothing about.

**Operational behaviour** — throttling, WAF, alarms, DLQ redrive under load,
cost, and latency at any real scale.

**Emulator drift.** DynamoDB Local's TTL does not expire on schedule, S3
emulators differ on multipart and presign edge cases, and validation is looser
in several places. The first run against real AWS will find things.

## Managed-services partner

If the AWS account is administered by a partner, that partner has access to the
environment holding families' medical records, and is a data processor under the
DPDP Act. Before production data exists this requires a processor agreement,
scoped and time-limited access rather than standing administrator rights,
break-glass procedure, and audit logging of partner activity. This is a Phase 2
work item that the original plan does not contain.

## Cost decisions taken here

These are architecture decisions rather than budget estimates, because each one
is a code path.

**OCR uses `DetectDocumentText`, never `AnalyzeDocument`.** Extraction is done
by the summary provider from plain text, so form and table analysis is never
needed. The rates differ by roughly thirty times per page.

**Lambda stays out of a VPC** unless a requirement forces it, using gateway and
interface endpoints for private access. A NAT gateway costs more per month than
the entire rest of the projected bill at pilot scale.

**HTTP API rather than REST API** on API Gateway.

**CloudWatch log groups get an explicit retention.** The default is to keep logs
forever, which quietly becomes a leading line item.

**S3 lifecycle rules are set when the bucket is created.** Original scans are
the only cost that grows monotonically, and they are cold within days of being
summarised.

## Consequences

### Positive

- Phase 2 proceeds without an AWS account, and without writing unrunnable code.
- The integration suite is portable to real AWS on day one.
- The provider decision stays reversible: if an Indian cloud is chosen later for
  residency reasons, the ports stay and a third driver set is written.
- Local development needs no cloud credentials, so no developer machine holds a
  key that can reach production data.
- The demonstration build stops doubling as a development backend.

### Negative

- Two driver sets per port is more code than one, and the local set is code that
  never ships.
- A green local suite can be mistaken for readiness. The "what this does not
  prove" list above exists to make that harder, but it is a documentation
  control, not a technical one.
- Docker becomes a prerequisite for backend development.
- The AWS drivers accumulate untested code until an account exists. They should
  be written thinly, with logic in the port-agnostic layer.

## Alternatives considered

### Wait for an AWS account

Rejected. It blocks the majority of Phase 2 on a commercial decision, and
produces a large volume of code whose first execution is against production
infrastructure.

### LocalStack for everything

Rejected in favour of per-service open-source emulators. LocalStack's free tier
does not cover the identity service, and a single emulator for every service
concentrates the risk of emulator-specific behaviour. DynamoDB Local, MinIO and
ElasticMQ are each closer to the service they stand in for.

### Build against AWS SDKs only, and test with SDK-level mocks

Rejected. Mocking the SDK tests that the code calls the SDK, not that the
resulting system works. It would not have caught a wrong key schema, a broken
presign flow, or a queue message that is never acknowledged.

### Postgres instead of DynamoDB, for a portable data layer

Not selected now, but recorded because it becomes the right answer immediately
if the platform moves off AWS. The repository port is the seam that decision
would move through, which is an argument for keeping that port narrow.

## Enforcement

Automated tests must verify:

- the same integration suite passes against both driver sets
- no driver is selected from mobile-side configuration
- a demonstration build cannot reach any backend
- every query in the repository driver is scoped by tenant, asserted by test
  rather than by review
- no AWS credential is required to run the local stack or its test suite
