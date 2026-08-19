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
