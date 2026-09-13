# Retention, deletion and where data actually goes

Written for KOO-13. Everything below describes the system **as implemented on
this branch**, and says so where a claim would otherwise be aspirational. It is
not a privacy notice and it is not legal review — both are separate gates, still
open, and listed at the end.

## What is stored, and where

| Data | Where it lives | Encrypted by |
| --- | --- | --- |
| Documents (original pages) | Object store, `patients/<patientId>/documents/<documentId>/pages/NNN` | Store-side encryption (SSE-KMS on AWS; MinIO's own at rest locally) |
| Records, summaries, grants, audit | DynamoDB single table, `PATIENT#<patientId>` partitions | DynamoDB encryption at rest |
| Records cached on the phone | AsyncStorage, `ayunetz.<accountId>.v2.*` | XChaCha20-Poly1305, per-account key in the device keychain (ADR-006) |
| Pending originals on the phone | App document directory, `ayunetz-originals/<accountId>/` | Platform file protection only — **not** the record key (ADR-006 § 5) |
| Tokens and vault keys | iOS Keychain / Android Keystore | Platform |
| Queue messages | SQS-compatible queue | Identifiers only, never content (`JobQueue.assertNoPayload`) |

## What leaves the boundary

One thing: **redacted text**, sent to the summarisation provider, and only when
`ai_processing` consent permits it.

- Original images and PDFs are never sent. Only text extracted from them.
- Text passes the redactor and an independent leakage gate first (ADR-002).
  **Redaction is risk reduction, not anonymisation** — this is stated in
  ADR-002 and repeated here because it is the claim most likely to be
  overstated.
- The check runs three times: when the job is queued, before the provider call,
  and again before the result is written. The third cannot undo a call already
  made; that limit is in `describeWithdrawal` and shown to the user.

## Retention

| Item | Kept for | Removed by |
| --- | --- | --- |
| Documents and summaries | Until deleted by an authorised person | Explicit deletion. Nothing clinical has a TTL — a record expiring quietly is the wrong failure mode |
| Idempotency markers | 24 hours | DynamoDB TTL |
| Invitations | Expiry + 7 days | DynamoDB TTL. The token was never stored, only its hash |
| Audit entries | Life of the record | Deleted with the record |
| Revoked grants | Life of the record | Kept deliberately: "who had access and when it was withdrawn" is the question an audit answers |
| Phone cache | Until sign-out, wipe, or the record becomes unreachable | `forgetAccountLocally`, or the next sync discovering the record is gone |
| Pending originals | Until upload is confirmed, or explicit discard | Never on a timer — the page nobody uploaded is the page nobody has |

**DynamoDB TTL deletes within 48 hours of the timestamp, not at it**, and
DynamoDB Local does not delete at all. Nothing depends on the sweep: expiry is
compared in code, and the TTL is tidy-up.

## Deleting

Two different things that are easy to confuse.

**Leaving a family** removes one account's grant. It deletes nothing. The
record, its documents and its summaries belong to the patient and stay. This is
enforced by `policy.ts`: only the `self` role holds
`transfer_or_delete_record`, so a manager cannot delete the person's history on
their way out.

**Deleting a record** removes the patient's own data. Order matters: pages
first, then the record, because pages with no record are orphans nothing will
ever clean up. Retrying is safe.

What deletion cannot reach, and the UI says so rather than implying otherwise:

- **A copy already on somebody's device**, until that device next connects.
- **A presigned URL already issued**, until it expires (900s upload, 300s read).
- **An export somebody already took.** Nothing can recall that.
- **Backups**, until they age out on their own schedule.

## Backups

- **Server:** DynamoDB point-in-time recovery and object-store versioning are
  KOO-14 configuration and are **not provisioned** — there is no cloud account.
  Recorded as a requirement, not as a fact.
- **Phone:** the originals directory is marked for exclusion from cloud backup.
  **This is unverified on a device.** Whether iCloud and Android auto-backup
  honour it needs checking on real hardware; ADR-006 says the same.

## Consent

Three separate agreements, recorded independently with the version of the
notice the person actually read:

| Purpose | What it permits | Withdrawing it |
| --- | --- | --- |
| `storage` | Holding the record at all | Is a deletion request, and the UI treats it as one |
| `ai_processing` | Sending redacted text to the provider | Stops future summaries; keeps everything else |
| `family_sharing` | Letting named accounts reach the record | Removes existing access too |

**A medical disclaimer is not consent.** Accepting "this app does not give
medical advice" is a safety notice; it is tracked separately and is not one of
these.

A missing answer is **not** permission, for any purpose. A record created before
consent was asked for is not processed on the strength of a row that does not
exist.

## Where processing happens

- **Configured** for `ap-south-1` (Mumbai) — `AWS_REGION` and `stack.ts`.
- **Not verified.** A region in a configuration file is a setting, not a
  guarantee about residency, and `dataResidency.ts` already refuses to claim
  otherwise. No AWS account exists.
- **The summarisation provider's location, retention and training terms are not
  established.** `SarvamSummaryProvider` says its real behaviour is unverified.
  Until a provider agreement is reviewed, no claim about where text goes or how
  long it is kept can be made.

## Contact and grievance

Not implemented. A grievance route is required by the DPDP Act and needs a named
person and a published address — a product decision, not a code change. It is on
the open list below rather than stubbed with a placeholder address.

## Open gates

None of these is closed by this branch, and none should be described as closed.

- [ ] Privacy notice drafted and legally reviewed
- [ ] Provider agreement reviewed: location, retention, training on customer data
- [ ] Data-processing agreement with any subprocessor
- [ ] Grievance officer named, address published, response times set
- [ ] Backup and restore drill in an authorised cloud environment
- [ ] Device verification of keychain backing and backup exclusion
- [ ] Residency verified by something other than a configuration value
