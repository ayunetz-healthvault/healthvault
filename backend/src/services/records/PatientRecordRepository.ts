import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';

import type { StackConfig } from '../../config/stack.js';
import {
  DOCUMENT_PREFIX,
  FOLLOW_UP_PREFIX,
  documentGsiSk,
  followUpGsiSk,
  patientAuditSk,
  patientDocumentSk,
  patientFollowUpSk,
  patientGsiPk,
  patientPk,
  patientProcessingSk,
  patientSummarySk,
  patientConsentSk,
  patientFollowUpIdSk,
  PATIENT_CONSENT_PREFIX,
  PATIENT_DELETION_SK,
  PATIENT_PROFILE_SK,
  type AccountId,
  type PatientId,
} from './keys.js';
import type {
  DocumentRecord,
  FollowUpRecord,
  ProcessingRecord,
  SummaryRecord,
} from './RecordRepository.js';
import type { ConsentRecord } from '../consent/policy.js';

/**
 * A patient's record, keyed by the patient rather than by whoever created it.
 *
 * ## The rule the shape of this file enforces
 *
 * **Every method takes a `patientId` first, and every key is built from it.**
 * Same discipline as `RecordRepository`, one level up: there is no way to reach
 * an item without naming whose record it is.
 *
 * What is deliberately *not* here is any notion of who is asking. This layer
 * cannot check a grant and must not appear to: a repository that took an
 * `accountId` alongside the `patientId` would look as though it were enforcing
 * something, and a caller would eventually rely on that. Authorisation happens
 * once, in the route, through `AccessRepository` and `policy.ts`, before any
 * method here is called.
 */

/** The record subject. Not an account, and not a login. */
export interface PatientRecord {
  readonly patientId: PatientId;
  readonly fullName: string;
  readonly relationship: string;
  readonly dateOfBirth?: string | undefined;
  readonly city?: string | undefined;
  /**
   * The account that created this record, kept for provenance only.
   *
   * It confers nothing. Access comes from a grant, and this field exists so
   * "where did this record come from" is answerable after the creator has been
   * revoked.
   */
  readonly createdByAccountId: AccountId;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Who did what to a record, and when.
 *
 * Metadata only. ADR-001's logging rule applies here with more force than it
 * does to a log line, because this outlives the request that wrote it and is
 * readable by everyone the record is shared with. No clinical text, no
 * document titles, no field values — the entity and the verb, nothing else.
 */
export interface AuditEntry {
  readonly eventId: string;
  readonly patientId: PatientId;
  readonly actorAccountId: AccountId;
  readonly action: string;
  /** e.g. `document`, `grant`, `follow_up`. */
  readonly entity: string;
  readonly entityId: string;
  readonly at: string;
}

/**
 * A record that is being erased, or has been.
 *
 * Durable, and never removed. The interesting cases are both about time
 * passing: an erasure whose process dies half way must not leave a record that
 * looks ordinary and is missing half its documents, and a write that was
 * already in flight when the erasure ran must not land *after* it finishes.
 *
 * The second is why `deleted` is a state rather than the absence of one. A
 * marker taken down at the end of the sweep would let a paused worker resume a
 * second later and write a summary into the partition it had just emptied,
 * with nothing left to say the record had ever been deleted. So the marker
 * stays as a tombstone: patient id, who asked, and when — no clinical content,
 * no name, nothing the erasure was meant to remove. It is the one row that
 * survives, and it is what makes the erasure permanent rather than merely
 * thorough.
 */
export interface DeletionMarker {
  readonly patientId: PatientId;
  /** Who asked. Kept so a resumed erasure can be attributed to its requester. */
  readonly requestedByAccountId: AccountId;
  readonly requestedAt: string;
  /** `deleting` while the sweep runs, `deleted` once it has finished. */
  readonly status: 'deleting' | 'deleted';
  readonly completedAt?: string | undefined;
}

/**
 * Thrown when a write is refused because the record is being erased, or was.
 *
 * A distinct type because the callers have to tell it apart from a failure
 * worth retrying: a worker that treated this as a transient error would keep
 * trying to write a summary into a deleted record until its attempt budget ran
 * out, and would record a failure against a record that no longer exists.
 */
export class RecordDeletedError extends Error {
  constructor(readonly patientId: PatientId) {
    super('This record is being deleted, so nothing more can be written to it.');
    this.name = 'RecordDeletedError';
  }
}

/** Thrown when a follow-up id has already been used in this record. */
export class FollowUpExistsError extends Error {
  constructor(readonly followUpId: string) {
    super('A follow-up with this id already exists.');
    this.name = 'FollowUpExistsError';
  }
}

export interface PatientRecordRepository {
  putPatient(patient: PatientRecord): Promise<void>;
  getPatient(patientId: PatientId): Promise<PatientRecord | null>;
  /**
   * Removes the profile row only.
   *
   * Deliberately narrow, and almost never what a caller wants: a record is a
   * partition full of documents, summaries, consent and audit, and deleting
   * the profile alone leaves all of it behind under a patient nobody can name.
   * `deleteEverythingFor` is the erasure path.
   */
  deletePatient(patientId: PatientId): Promise<void>;
  /**
   * Deletes every item in this record's partition, following every page.
   *
   * Returns what it removed, so the caller can report an erasure rather than
   * assert one. Objects in the store are *not* touched here — they are the
   * caller's to delete, because this port knows nothing about them.
   *
   * The deletion marker is the one item left behind: it is what fences writes
   * while this runs, so removing it is the caller's last act, after the objects
   * are gone too. A partition larger than one query page is followed to the
   * end — a single `Query` returns at most 1 MB, and stopping there would
   * report an erasure that deleted the first page of somebody's record and left
   * the rest.
   */
  deleteEverythingFor(patientId: PatientId): Promise<{ items: number }>;

  /**
   * Marks a record as being erased, before anything is actually deleted.
   *
   * Every write path checks this. Without it, an upload that lands during the
   * sweep, or a worker finishing a job it started a minute earlier, writes rows
   * back into a partition that has just been emptied — and the erasure reports
   * success while the record quietly refills.
   *
   * Idempotent: asking twice keeps the first request's timestamp, because a
   * resumed deletion is the same deletion.
   */
  beginDeletion(marker: {
    patientId: PatientId;
    requestedByAccountId: AccountId;
    requestedAt: string;
  }): Promise<DeletionMarker>;
  /** The marker, or null for a record that has never been deleted. */
  getDeletion(patientId: PatientId): Promise<DeletionMarker | null>;
  /**
   * Turns the marker into a tombstone. The last step of an erasure.
   *
   * Not a removal. The tombstone is what refuses a write that was paused when
   * the sweep ran and resumed after it finished — the case a marker taken down
   * at the end cannot cover, and the one that resurrects a deleted record.
   */
  completeDeletion(patientId: PatientId, completedAt: string): Promise<void>;

  putDocument(patientId: PatientId, document: DocumentRecord): Promise<void>;
  getDocument(patientId: PatientId, documentId: string): Promise<DocumentRecord | null>;
  listDocuments(patientId: PatientId): Promise<DocumentRecord[]>;
  deleteDocument(patientId: PatientId, documentId: string): Promise<void>;

  putProcessing(patientId: PatientId, processing: ProcessingRecord): Promise<void>;
  getProcessing(patientId: PatientId, documentId: string): Promise<ProcessingRecord | null>;
  /**
   * Every document's processing state, in one query.
   *
   * So listing a record's documents can report what is actually happening to
   * each without a request per document. The alternative — asking per document
   * — is an N+1 walk that gets slower exactly as a record gets more useful.
   */
  listProcessing(patientId: PatientId): Promise<ProcessingRecord[]>;

  putSummary(patientId: PatientId, summary: SummaryRecord): Promise<void>;
  getSummary(patientId: PatientId, documentId: string): Promise<SummaryRecord | null>;
  /** Which documents have a summary, without fetching the summaries. */
  listSummaryIds(patientId: PatientId): Promise<string[]>;

  /**
   * Creates a follow-up, or refuses because that id is already in use.
   *
   * Separate from `putFollowUp` because a create and an update need different
   * guarantees. Two retries of one create can both find nothing — a read
   * followed by a write is not an idempotency mechanism, it is a race with a
   * comfortable-looking window — and the loser used to overwrite the winner,
   * resetting a task somebody had already completed back to `scheduled`.
   *
   * The claim is a separate item keyed by the follow-up id alone, so it does
   * not move when the due date does; the row and the claim are written in one
   * transaction, and the second attempt loses at the claim rather than at the
   * row. Throws `FollowUpExistsError` when the id is taken, so the caller can
   * answer with the task that exists instead of a second copy of it.
   */
  createFollowUp(patientId: PatientId, followUp: FollowUpRecord): Promise<void>;
  /** Overwrites an existing follow-up in place. Never used to create one. */
  putFollowUp(patientId: PatientId, followUp: FollowUpRecord): Promise<void>;
  /**
   * Moves a follow-up to a new due date.
   *
   * The due date is part of the sort key, so a rescheduled appointment is a
   * different row: the old one has to go and the new one has to appear, and a
   * caller that did those as two writes could leave the family looking at the
   * same appointment on two different days. One transaction, so it is both or
   * neither — and the id claim is untouched, because this is the same task.
   */
  moveFollowUp(
    patientId: PatientId,
    previousDueDate: string,
    followUp: FollowUpRecord,
  ): Promise<void>;
  listFollowUps(patientId: PatientId): Promise<FollowUpRecord[]>;
  getFollowUp(patientId: PatientId, followUpId: string): Promise<FollowUpRecord | null>;
  /**
   * Removes a follow-up.
   *
   * Takes the due date as well as the id because the due date is part of the
   * sort key — that is what makes "everything due before Friday" one query.
   * The consequence is that changing a due date is a delete and a write, not an
   * update in place, and a caller that forgets leaves the old row behind.
   */
  deleteFollowUp(patientId: PatientId, dueDate: string, followUpId: string): Promise<void>;
  /**
   * Whether this follow-up id has ever been used, and whether it was deleted.
   *
   * The claim outlives the row on purpose: a delayed duplicate of a create
   * whose task has since been deleted must not put the appointment back.
   */
  followUpClaim(
    patientId: PatientId,
    followUpId: string,
  ): Promise<{ createdAt: string; deletedAt?: string | undefined } | null>;

  /**
   * Records one consent decision. Append-only.
   *
   * There is deliberately no `setConsent`. Overwriting the previous answer
   * would destroy the only evidence of what somebody agreed to before they
   * changed their mind — which is exactly the question asked when a record was
   * processed and should not have been.
   */
  appendConsent(consent: ConsentRecord): Promise<void>;
  /** Every decision ever recorded for this record, oldest first. */
  listConsent(patientId: PatientId): Promise<ConsentRecord[]>;

  appendAudit(entry: AuditEntry): Promise<void>;
  listAudit(patientId: PatientId, limit?: number): Promise<AuditEntry[]>;
}

const stripKeys = <T>(item: Record<string, unknown> | undefined): T | null => {
  if (item === undefined) return null;
  const { PK, SK, GSI1PK, GSI1SK, ...rest } = item;
  void PK;
  void SK;
  void GSI1PK;
  void GSI1SK;
  return rest as T;
};

export const createPatientRecordRepository = (config: StackConfig): PatientRecordRepository => {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient(config.clients.records), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const TableName = config.recordsTable;

  /**
   * Whether this record has been marked for erasure, as a condition on a write.
   *
   * The deletion marker lives in the same partition as everything it guards,
   * which is what makes this expressible: DynamoDB will not condition a write
   * on another item, but a transaction will, and a transaction is atomic across
   * the two. So every write below is "put this row, provided that row does not
   * exist" — evaluated at commit time, not when the handler last looked.
   *
   * The version this replaces read the marker and then wrote, which is a race
   * with a comfortable-looking window: the erasure could complete in the gap,
   * and the summary landed in a partition that had just been emptied.
   */
  const notDeleted = (patientId: PatientId) => ({
    ConditionCheck: {
      TableName,
      Key: { PK: patientPk(patientId), SK: PATIENT_DELETION_SK },
      ConditionExpression: 'attribute_not_exists(SK)',
    },
  });

  /**
   * Turns a cancelled transaction into the reason it was cancelled.
   *
   * `TransactionCanceledException` carries one reason per item in the order
   * they were sent, so the first item — always the deletion check — tells us
   * whether the record was being erased or whether something else failed.
   */
  const cancellation = (error: unknown): string[] =>
    (
      (error as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? []
    ).map((reason) => reason.Code ?? '');

  const guarded = async (
    patientId: PatientId,
    items: Record<string, unknown>[],
  ): Promise<void> => {
    try {
      await client.send(
        new TransactWriteCommand({ TransactItems: [notDeleted(patientId), ...items] }),
      );
    } catch (error) {
      // The deletion check is always the first item, so its reason is the
      // first one back. Nothing else here carries a condition.
      if (cancellation(error)[0] === 'ConditionalCheckFailed') {
        throw new RecordDeletedError(patientId);
      }
      throw error;
    }
  };

  const put = async (
    patientId: PatientId,
    SK: string,
    body: Record<string, unknown>,
  ): Promise<void> => {
    await guarded(patientId, [
      { Put: { TableName, Item: { PK: patientPk(patientId), SK, ...body } } },
    ]);
  };

  /** A write that must not be refused by the tombstone: the marker itself. */
  const putUnguarded = async (
    patientId: PatientId,
    SK: string,
    body: Record<string, unknown>,
  ): Promise<void> => {
    await client.send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName, Item: { PK: patientPk(patientId), SK, ...body } } },
        ],
      }),
    );
  };

  const get = async <T>(patientId: PatientId, SK: string): Promise<T | null> => {
    const response = await client.send(
      new GetCommand({ TableName, Key: { PK: patientPk(patientId), SK } }),
    );
    return stripKeys<T>(response.Item);
  };

  /**
   * Every matching item, across as many pages as it takes.
   *
   * A `Query` returns at most 1 MB and a `LastEvaluatedKey`, and a caller that
   * ignores the key gets a silent truncation rather than an error — a record
   * with enough documents would simply stop listing some of them, and no test
   * with a handful of rows would ever notice.
   *
   * The `limit` case is different and is honoured exactly: a caller asking for
   * the last fifty audit entries wants fifty, so paging stops as soon as it has
   * them.
   */
  const queryPrefix = async <T>(
    patientId: PatientId,
    prefix: string,
    options: { limit?: number; descending?: boolean } = {},
  ): Promise<T[]> => {
    const collected: T[] = [];
    let startKey: Record<string, unknown> | undefined;

    do {
      const remaining =
        options.limit === undefined ? undefined : options.limit - collected.length;

      const response = await client.send(
        new QueryCommand({
          TableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: { ':pk': patientPk(patientId), ':prefix': prefix },
          ...(remaining === undefined ? {} : { Limit: remaining }),
          ...(options.descending === true ? { ScanIndexForward: false } : {}),
          ...(startKey === undefined ? {} : { ExclusiveStartKey: startKey }),
        }),
      );

      for (const item of response.Items ?? []) {
        const record = stripKeys<T>(item);
        if (record !== null) collected.push(record);
      }

      startKey = response.LastEvaluatedKey;
      if (options.limit !== undefined && collected.length >= options.limit) break;
    } while (startKey !== undefined);

    return collected;
  };

  return {
    putPatient: (patient) => put(patient.patientId, PATIENT_PROFILE_SK, { ...patient }),
    getPatient: (patientId) => get<PatientRecord>(patientId, PATIENT_PROFILE_SK),

    async deletePatient(patientId) {
      await client.send(
        new DeleteCommand({ TableName, Key: { PK: patientPk(patientId), SK: PATIENT_PROFILE_SK } }),
      );
    },

    /**
     * Every row under this patient, deleted one at a time, to the last page.
     *
     * Not a batch: `BatchWriteItem` caps at 25 and partially succeeds, which
     * for an erasure means reporting a deletion that half happened. Slower and
     * answerable beats faster and unprovable.
     *
     * The pagination is the same argument. One `Query` returns a page, and a
     * partition holding a few hundred documents, their summaries and an audit
     * trail spans several — so the loop follows `LastEvaluatedKey` until there
     * is nothing left, and re-queries from the start afterwards rather than
     * trusting that a single sweep saw rows written while it ran.
     *
     * The deletion marker survives: it is what stops anything writing into the
     * partition while this runs, and it is the caller's to remove once the
     * objects are gone too. That is also what makes this resumable — a sweep
     * that dies half way leaves the fence standing, and running it again
     * finishes the job.
     */
    async deleteEverythingFor(patientId) {
      let deleted = 0;

      // Two passes at most: the second exists to catch a row written by a
      // request that was already in flight when the marker went up.
      for (let sweep = 0; sweep < 2; sweep += 1) {
        let startKey: Record<string, unknown> | undefined;
        let deletedThisSweep = 0;

        do {
          const response = await client.send(
            new QueryCommand({
              TableName,
              KeyConditionExpression: 'PK = :pk',
              ExpressionAttributeValues: { ':pk': patientPk(patientId) },
              ProjectionExpression: 'PK, SK',
              ...(startKey === undefined ? {} : { ExclusiveStartKey: startKey }),
            }),
          );

          for (const item of response.Items ?? []) {
            if (item.SK === PATIENT_DELETION_SK) continue;
            await client.send(
              new DeleteCommand({
                TableName,
                Key: { PK: item.PK as string, SK: item.SK as string },
              }),
            );
            deletedThisSweep += 1;
          }

          startKey = response.LastEvaluatedKey;
        } while (startKey !== undefined);

        deleted += deletedThisSweep;
        if (deletedThisSweep === 0) break;
      }

      return { items: deleted };
    },

    /**
     * The fence, written before anything is deleted.
     *
     * Keeping the first request's timestamp matters: a resumed erasure is the
     * same erasure, and moving the requested-at each time would make "this
     * record has been half-deleted since Tuesday" unanswerable. A record that
     * is already a tombstone stays one — a second deletion of a deleted record
     * must not reopen it for writes.
     */
    async beginDeletion(marker) {
      const existing = await get<DeletionMarker>(marker.patientId, PATIENT_DELETION_SK);
      if (existing !== null) return existing;

      const started: DeletionMarker = { ...marker, status: 'deleting' };
      await putUnguarded(marker.patientId, PATIENT_DELETION_SK, { ...started });
      return started;
    },

    getDeletion: (patientId) => get<DeletionMarker>(patientId, PATIENT_DELETION_SK),

    async completeDeletion(patientId, completedAt) {
      const existing = await get<DeletionMarker>(patientId, PATIENT_DELETION_SK);
      if (existing === null) return;

      await putUnguarded(patientId, PATIENT_DELETION_SK, {
        ...existing,
        status: 'deleted',
        completedAt,
      });
    },

    async putDocument(patientId, document) {
      await put(patientId, patientDocumentSk(document.documentId), {
        ...document,
        // Sparse index: documents in document-date order within the patient.
        GSI1PK: patientGsiPk(patientId),
        GSI1SK: documentGsiSk(document.documentDate, document.documentId),
      });
    },

    getDocument: (patientId, documentId) =>
      get<DocumentRecord>(patientId, patientDocumentSk(documentId)),

    listDocuments: (patientId) => queryPrefix<DocumentRecord>(patientId, DOCUMENT_PREFIX),

    async deleteDocument(patientId, documentId) {
      await client.send(
        new DeleteCommand({
          TableName,
          Key: { PK: patientPk(patientId), SK: patientDocumentSk(documentId) },
        }),
      );
    },

    putProcessing: (patientId, processing) =>
      put(patientId, patientProcessingSk(processing.documentId), { ...processing }),
    getProcessing: (patientId, documentId) =>
      get<ProcessingRecord>(patientId, patientProcessingSk(documentId)),

    listProcessing: (patientId) => queryPrefix<ProcessingRecord>(patientId, 'PROCESSING#'),

    putSummary: (patientId, summary) =>
      put(patientId, patientSummarySk(summary.documentId), { ...summary }),
    getSummary: (patientId, documentId) =>
      get<SummaryRecord>(patientId, patientSummarySk(documentId)),

    async listSummaryIds(patientId) {
      const summaries = await queryPrefix<SummaryRecord>(patientId, 'SUMMARY#');
      return summaries.map((summary) => summary.documentId);
    },

    /**
     * The row and its claim, in one transaction.
     *
     * The claim carries the condition, so the second of two overlapping
     * creates is refused at commit rather than being allowed to overwrite the
     * first. It is keyed by the follow-up id alone: the row's own key contains
     * the due date, which a later edit moves, so a claim on the row would stop
     * being a claim on the task the moment somebody changed the date.
     */
    async createFollowUp(patientId, followUp) {
      try {
        await client.send(
          new TransactWriteCommand({
            TransactItems: [
              notDeleted(patientId),
              {
                Put: {
                  TableName,
                  Item: {
                    PK: patientPk(patientId),
                    SK: patientFollowUpIdSk(followUp.followUpId),
                    followUpId: followUp.followUpId,
                    createdAt: followUp.createdAt,
                  },
                  ConditionExpression: 'attribute_not_exists(SK)',
                },
              },
              {
                Put: {
                  TableName,
                  Item: {
                    PK: patientPk(patientId),
                    SK: patientFollowUpSk(followUp.dueDate, followUp.followUpId),
                    ...followUp,
                    GSI1PK: patientGsiPk(patientId),
                    GSI1SK: followUpGsiSk(followUp.dueDate, followUp.followUpId),
                  },
                },
              },
            ],
          }),
        );
      } catch (error) {
        const reasons = cancellation(error);
        if (reasons[0] === 'ConditionalCheckFailed') throw new RecordDeletedError(patientId);
        if (reasons[1] === 'ConditionalCheckFailed') {
          throw new FollowUpExistsError(followUp.followUpId);
        }
        throw error;
      }
    },

    async putFollowUp(patientId, followUp) {
      await put(patientId, patientFollowUpSk(followUp.dueDate, followUp.followUpId), {
        ...followUp,
        GSI1PK: patientGsiPk(patientId),
        GSI1SK: followUpGsiSk(followUp.dueDate, followUp.followUpId),
      });
    },

    async moveFollowUp(patientId, previousDueDate, followUp) {
      await guarded(patientId, [
        {
          Delete: {
            TableName,
            Key: {
              PK: patientPk(patientId),
              SK: patientFollowUpSk(previousDueDate, followUp.followUpId),
            },
          },
        },
        {
          Put: {
            TableName,
            Item: {
              PK: patientPk(patientId),
              SK: patientFollowUpSk(followUp.dueDate, followUp.followUpId),
              ...followUp,
              GSI1PK: patientGsiPk(patientId),
              GSI1SK: followUpGsiSk(followUp.dueDate, followUp.followUpId),
            },
          },
        },
      ]);
    },

    async followUpClaim(patientId, followUpId) {
      return get<{ createdAt: string; deletedAt?: string }>(
        patientId,
        patientFollowUpIdSk(followUpId),
      );
    },

    listFollowUps: (patientId) => queryPrefix<FollowUpRecord>(patientId, FOLLOW_UP_PREFIX),

    async getFollowUp(patientId, followUpId) {
      const followUps = await queryPrefix<FollowUpRecord>(patientId, FOLLOW_UP_PREFIX);
      return followUps.find((followUp) => followUp.followUpId === followUpId) ?? null;
    },

    /**
     * Removes the row and keeps the claim, marked deleted.
     *
     * The claim is what a delayed duplicate of the original create hits. If it
     * went with the row, that duplicate would find the id free and put a
     * deleted appointment back on everybody's phone.
     */
    async deleteFollowUp(patientId, dueDate, followUpId) {
      const claim = await get<{ createdAt: string }>(patientId, patientFollowUpIdSk(followUpId));

      await client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName,
                Key: { PK: patientPk(patientId), SK: patientFollowUpSk(dueDate, followUpId) },
              },
            },
            {
              Put: {
                TableName,
                Item: {
                  PK: patientPk(patientId),
                  SK: patientFollowUpIdSk(followUpId),
                  followUpId,
                  createdAt: claim?.createdAt ?? new Date().toISOString(),
                  deletedAt: new Date().toISOString(),
                },
              },
            },
          ],
        }),
      );
    },

    appendConsent: (consent) =>
      put(consent.patientId, patientConsentSk(consent.purpose, consent.decidedAt), { ...consent }),

    // Oldest first, which is what `permits` and `needsReconsent` expect: they
    // read the history and take the last answer for each purpose.
    listConsent: (patientId) => queryPrefix<ConsentRecord>(patientId, PATIENT_CONSENT_PREFIX),

    appendAudit: (entry) => put(entry.patientId, patientAuditSk(entry.at, entry.eventId), { ...entry }),

    // Newest first: "what just changed" is the question, not "what changed in
    // 2024". `ScanIndexForward: false` on a timestamp-prefixed sort key.
    listAudit: (patientId, limit = 50) =>
      queryPrefix<AuditEntry>(patientId, 'AUDIT#', { limit, descending: true }),
  };
};
