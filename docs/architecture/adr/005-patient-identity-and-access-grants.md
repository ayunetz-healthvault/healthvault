# ADR-005 — Patient Identity and Per-Record Access Grants

- **Status:** Accepted for KOO-03. Storage semantics unverified locally — see "Consequences".
- **Date:** 2026-09-08
- **Owners:** Ayunetz Health Vault
- **Decision type:** Data model, authorisation, migration
- **Relates to:** ADR-003 (ports and drivers), `keys.ts` divergences 1 and 2

## Context

The record layout keys everything by the account that created it:
`PK = USER#<ownerId>`, built only from a verified token subject. As tenant
isolation that is good — `keys.ts` cannot express a key for a tenant the caller
has not proved they are, and it is tested rather than assumed.

As a model of a family it does not work at all. A parent's profile exists
*inside* a caregiver's partition, so the record has no identity of its own and
no way to be reached except through that one account. There is no expressible
answer to "let my brother see Amma's reports" short of letting him read the
whole account — which means every other parent too, and everything added later.

The product requires the opposite: a parent with their own login and their own
record, who decides who may see it and can change their mind.

Two things must not be the fix, and both are the obvious ones:

- **Accepting an `ownerId` from the client.** Every isolation property in
  `keys.ts` comes from that value being a verified token subject.
- **Sharing a login.** Two people behind one account cannot be told apart, so
  nothing can be attributed and nothing can be withdrawn from one of them.

## Decision

### 1. A patient is a first-class thing, distinct from an account

`AccountId` is who is asking. `PatientId` is whose record it is. Clinical items
move from `USER#<ownerId>` to `PATIENT#<patientId>`.

`USER#` partitions stay, holding what genuinely belongs to an account: profile,
consent, device-specific calendar mappings.

### 2. Access is a grant, stored with the record

`PATIENT#<patientId> / GRANT#<accountId>`, co-located with the data rather than
in a separate table. The question asked before every request is "does this
account hold a grant on this patient", and putting the answer in the same
partition makes it one point read — not a cross-table lookup that could be
skipped, cached, or made to fail open.

`GSI2` (`ACCOUNT#<accountId>` → `PATIENT#<patientId>`) answers the reverse:
which patients an account can reach. That is the first query after sign-in and
the one that decides which experience renders.

### 3. Four roles, and one table of permissions

`self`, `manager`, `contributor`, `viewer` — enumerated in `policy.ts`, which is
pure and has no idea where anything is stored. Three properties are decisions
rather than defaults:

- **Only `self` may delete or transfer the record.** A caregiver who created a
  profile *about* their mother has management authority, not ownership of her
  medical history.
- **Only `self` and `manager` may change who has access.** A contributor cannot
  widen their own access or add another helper. That is the line between
  sharing a record and losing control of it.
- **A `viewer` writes nothing, notes included.** Read-only that quietly permits
  appending is not read-only.

`self` is not grantable by anybody. Being the subject of a record is a fact
about a person, not a permission somebody else can confer — without that rule a
manager could make an arbitrary account the patient. And no one can revoke the
`self` grant, including its holder: a record whose subject cannot reach it is
unreachable, and there is no recovery flow.

### 4. Invitations are single-use, expiring, and useless alone

Token shape `<patientId>.<secret>`, where the secret is 32 bytes from the
CSPRNG. **Only the SHA-256 of the secret is stored** — an invitation token is a
bearer credential for days, so a table dump containing them would be a set of
working keys to other people's medical records.

The patient id travels in the token so the token can find its own row by exact
key, with no scan and no second index whose only job is to look up a credential.
That is safe because the id is not what protects the record: the secret half is,
and a grant check runs on every read regardless.

Accepting requires **an authenticated account**. A leaked invitation is an offer,
not a key: on its own it reads nothing.

Acceptance burns the token first, conditionally, then writes the grant. Creating
the grant first would let two racing devices both succeed, and one invitation
would have produced two grants.

Every failure — wrong, spent, revoked, expired — returns the same answer.
Telling them apart turns the endpoint into a way to probe which invitations
exist.

### 5. Two refusals, deliberately different

- **No grant → 404**, byte-identical to a patient that does not exist. Anything
  else makes every id-taking endpoint a membership oracle.
- **A grant that does not permit the action → 403.** The caller can already see
  the record; pretending it is missing would only confuse them.

### 6. Migration is additive, and rollback is doing nothing

Source items under `USER#<ownerId>` are **never deleted**. New
`PATIENT#<patientId>` items are written alongside. Rollback is "stop reading the
new partitions" — no second migration, and no window in which a crash loses a
document. The cost is a period of duplication, which is the right trade here.

The parent id becomes the patient id unchanged. Every document, follow-up and
summary already references it, so re-keying would mean rewriting those
references and leaving anything missed pointing at nothing.

The caregiver receives `manager`, never `self`.

**No auto-linking.** The migration does not match names, phone numbers or email
addresses to guess that a migrated profile and some account are the same person.
Matching "Meera Nair" to an account with that name would hand somebody's medical
record to a stranger who shares it. Until a parent claims their record through
an explicit verified flow, the record simply has no subject — which is true, and
safe.

The script is a dry run unless `--apply`, and refuses to apply against the `aws`
stack without a second environment variable.

## What revocation does not do

Stated here because the UI must not imply otherwise:

- **A presigned URL already issued keeps working** until it expires. Bounded by
  the presign TTL (currently 900s), not by the revocation.
- **A copy already downloaded to a device stays on that device** until the app
  next reaches the server and is told the grant is gone. An offline phone cannot
  be told anything.
- **An export somebody already took cannot be recalled.** Nothing can do that.

Revocation is immediate for every *server* operation, which is what the tests
assert. The rest is a limitation to disclose, not to paper over.

## Consequences

**Routes are proven; storage semantics are not, in this session.**
`test/unit/accessRoutes.test.ts` drives every route decision against in-memory
repositories — 29 cases, mostly negative. Those prove `access.ts` and
`policy.ts`. They cannot prove the conditional writes underneath, because a
single-threaded fake does whatever it was written to do.
`test/integration/access.test.ts` covers exactly that — concurrent claims,
racing accepts, double revocation, the `GSI2` query, the migration end to end —
against real DynamoDB, and **skips when the local stack is unavailable, which it
is in the session that wrote this**. The Docker image registry is unreachable
here. Those tests are written and unrun.

**The `/v1/parents` and `/v1/documents` routes still use `USER#` partitions.**
They are unchanged and still correct for a single caregiver. Moving them onto
patient partitions and grant checks is the next slice; until then the two
layouts coexist, which is what "additive" buys.

**Two writes create a record.** The patient row is written before the grant, so
a crash between them leaves a record nobody can reach rather than a grant
pointing at nothing. The first is recoverable by an operator; the second is a
dangling permission.

**Sending an invitation is not this service's job.** The token is returned once,
to the inviter. Emailing or texting it to a real person is an external action,
and it is deliberately not wired up.
