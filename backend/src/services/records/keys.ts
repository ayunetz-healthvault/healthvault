/**
 * The single-table key layout.
 *
 * Every key in this file is built from an `ownerId` that came from a **verified
 * token subject**, never from a request body or a path parameter. That is the
 * whole of tenant isolation in the query path: there is no function here that
 * can produce a key for a tenant the caller did not prove they are.
 *
 * ADR-003 is explicit that IAM cannot be tested locally, so isolation must also
 * be enforced where it *can* be tested — here — with IAM as defence in depth
 * rather than the only control.
 *
 * Layout follows § 4 of phase-2.md, with two deliberate divergences recorded
 * below.
 */

export type OwnerId = string;

/**
 * An account that signs in. The verified token subject, always.
 *
 * Distinct from {@link PatientId}: `AccountId` is who is asking, `PatientId` is
 * whose record it is. The original schema had only the first, which is why
 * "share my mother's record" had no answer short of handing over a whole
 * tenant. See ADR-005.
 */
export type AccountId = string;

/** The subject of a record. Stable, and independent of who can reach it. */
export type PatientId = string;

/** Partition key. One tenant per partition, so nothing crosses by accident. */
export const ownerPk = (ownerId: OwnerId): string => `USER#${ownerId}`;

export const PROFILE_SK = 'PROFILE';

export const parentSk = (parentId: string): string => `PARENT#${parentId}`;
export const PARENT_PREFIX = 'PARENT#';

/**
 * **Divergence 1 from § 4:** documents are keyed `DOC#<documentId>`, not
 * `DOC#<parentId>#<documentId>`.
 *
 * The plan's shape makes "list a parent's documents" a prefix query, but makes
 * "get this document" impossible without already knowing which parent it
 * belongs to — and `endpoints.ts` has `/v1/documents/{documentId}`, with no
 * parent in the path. It also means a mis-filed document cannot be moved to the
 * right parent without rewriting its key.
 *
 * Mis-filing is a real thing a tired caregiver does at 11pm. Re-filing is now
 * an attribute update; the parent listing moves to `GSI1`, which additionally
 * returns it already sorted by document date.
 */
export const documentSk = (documentId: string): string => `DOC#${documentId}`;
export const DOCUMENT_PREFIX = 'DOC#';

export const processingSk = (documentId: string): string => `PROCESSING#${documentId}`;
export const summarySk = (documentId: string): string => `SUMMARY#${documentId}`;

/**
 * Follow-ups sort by due date inside the partition, so "what is coming up" is a
 * range query rather than a fetch-everything-and-sort.
 *
 * The id is appended because two follow-ups can fall on the same date and a key
 * has to stay unique.
 */
export const followUpSk = (dueDate: string, followUpId: string): string =>
  `FUP#${dueDate}#${followUpId}`;
export const FOLLOW_UP_PREFIX = 'FUP#';

/**
 * Idempotency markers.
 *
 * A phone on a train retries. Without these, one upload becomes two documents
 * and one confirmation becomes two calendar events.
 */
export const idempotencySk = (operation: string, key: string): string =>
  `IDEMPOTENCY#${operation}#${key}`;

/**
 * Audit entries. Metadata only — § 4 and ADR-001 both say so, and this is a
 * durable store that outlives the request that wrote it.
 */
export const auditSk = (timestamp: string, eventId: string): string =>
  `AUDIT#${timestamp}#${eventId}`;

/**
 * `GSI1` — everything belonging to one parent, in date order.
 *
 * **Divergence 2 from § 4:** the plan has no secondary index. This one is
 * sparse: only items that belong to a parent set the attributes, so the index
 * holds documents and follow-ups and nothing else.
 *
 * The partition includes the owner as well as the parent. A parent id is a
 * generated identifier and not a secret, but a partition key that is guessable
 * across tenants is a bad shape to leave lying around for whoever adds the next
 * query.
 */
export const parentGsiPk = (ownerId: OwnerId, parentId: string): string =>
  `USER#${ownerId}#PARENT#${parentId}`;

/** Sorts by the date on the document, which is how the app lists them. */
export const documentGsiSk = (documentDate: string, documentId: string): string =>
  `DOC#${documentDate}#${documentId}`;

export const followUpGsiSk = (dueDate: string, followUpId: string): string =>
  `FUP#${dueDate}#${followUpId}`;

export const GSI1_NAME = 'GSI1';


// ---------------------------------------------------------------------------
// Patient partitions, grants and invitations — ADR-005
//
// **Divergence 3 from § 4, and the largest.** Clinical items move out of the
// caregiver's `USER#` partition into a partition belonging to the *patient*.
//
// The old layout could not express shared access at all: every item was keyed
// by the account that created it, so the only way to let a second person read a
// parent's documents was to let them read that whole account. Keying by patient
// makes access a separate question, answered by a grant, and makes it possible
// to revoke one person without moving any data.
//
// `USER#` partitions are not removed. They keep account-level state — profile,
// consent, device mappings — which genuinely does belong to the account.
// ---------------------------------------------------------------------------

/** The partition holding one patient's record. */
export const patientPk = (patientId: PatientId): string => `PATIENT#${patientId}`;

/** The patient's own profile item. */
export const PATIENT_PROFILE_SK = 'PROFILE';

/**
 * One account's access to this patient, inside the patient's own partition.
 *
 * Deliberately co-located with the record rather than kept in a separate table.
 * The check that runs before every request is "does this account hold a grant
 * on this patient", and putting the answer in the same partition as the data
 * makes that one point read rather than a cross-table lookup that could be
 * skipped, cached or fail open.
 */
export const grantSk = (accountId: AccountId): string => `GRANT#${accountId}`;
export const GRANT_PREFIX = 'GRANT#';

/**
 * An outstanding invitation, keyed by a **hash** of the token.
 *
 * The token itself is never stored. An invitation token is a bearer credential
 * for a few days; a database dump containing them would be a set of working
 * keys to other people's medical records. Storing only the hash means a leak of
 * the table cannot be replayed.
 */
export const invitationSk = (tokenHash: string): string => `INVITE#${tokenHash}`;
export const INVITATION_PREFIX = 'INVITE#';

/**
 * `GSI2` — every patient one account can reach.
 *
 * The reverse of `grantSk`: that answers "who can see this patient", this
 * answers "which patients can I see", which is the first query the app makes
 * after sign-in. Sparse — only grant items carry these attributes.
 */
export const accountGsiPk = (accountId: AccountId): string => `ACCOUNT#${accountId}`;
export const grantGsiSk = (patientId: PatientId): string => `PATIENT#${patientId}`;
export const GSI2_NAME = 'GSI2';

/**
 * Clinical items inside a patient partition.
 *
 * Same sort-key shapes as the owner-partitioned versions above, so the queries
 * and the index behaviour carry over unchanged; only the partition moves.
 */
export const patientDocumentSk = (documentId: string): string => `DOC#${documentId}`;
export const patientProcessingSk = (documentId: string): string => `PROCESSING#${documentId}`;
export const patientSummarySk = (documentId: string): string => `SUMMARY#${documentId}`;
export const patientFollowUpSk = (dueDate: string, followUpId: string): string =>
  `FUP#${dueDate}#${followUpId}`;

/**
 * `GSI1`, for a patient partition: documents in document-date order.
 *
 * The owner is no longer part of the index partition, because the record no
 * longer belongs to one. A patient id is a generated identifier and not a
 * secret, and it is never the only thing standing between a caller and the
 * data — a grant check runs first, on every path.
 */
export const patientGsiPk = (patientId: PatientId): string => `PATIENT#${patientId}`;

/**
 * Audit entries, in the patient's partition rather than the actor's.
 *
 * "Who changed my record" is a question the patient asks, so the answer lives
 * with the record. Metadata only — ADR-001's logging rule applies here with
 * more force, because this outlives the request that wrote it.
 */
export const patientAuditSk = (timestamp: string, eventId: string): string =>
  `AUDIT#${timestamp}#${eventId}`;
export const PATIENT_AUDIT_PREFIX = 'AUDIT#';
