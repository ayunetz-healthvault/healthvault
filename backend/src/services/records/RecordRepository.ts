import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import type { StackConfig } from '../../config/stack.js';
import {
  DOCUMENT_PREFIX,
  FOLLOW_UP_PREFIX,
  GSI1_NAME,
  PARENT_PREFIX,
  documentGsiSk,
  documentSk,
  followUpGsiSk,
  followUpSk,
  idempotencySk,
  ownerPk,
  parentGsiPk,
  parentSk,
  processingSk,
  summarySk,
  type OwnerId,
} from './keys.js';
import { TTL_ATTRIBUTE } from './tableDefinition.js';

/**
 * Everything this service stores, behind one port.
 *
 * ## The rule the shape of this file enforces
 *
 * **Every method takes an `ownerId` as its first argument, and every key is
 * built from it.** There is no way to read or write an item without naming the
 * tenant, and the tenant is only ever the verified token subject. A missing
 * scope is a type error rather than a leak found in review.
 *
 * ADR-003 requires this: IAM cannot be exercised locally, so isolation must
 * also live where it can be tested, and it is tested — see
 * `test/integration/recordRepository.test.ts`, which asserts that one tenant's
 * identifiers return nothing for another.
 *
 * One implementation serves both stacks. DynamoDB Local is DynamoDB's own API,
 * so `local` and `aws` differ only in the endpoint and credentials carried by
 * `StackConfig`.
 */

export interface ParentRecord {
  readonly parentId: string;
  readonly fullName: string;
  readonly relationship: string;
  readonly dateOfBirth?: string;
  readonly city?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DocumentRecord {
  readonly documentId: string;
  /** Mutable: a mis-filed document is re-filed by changing this. */
  readonly parentId: string;
  readonly title: string;
  readonly category: string;
  readonly documentDate: string;
  readonly pageCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ProcessingStatus =
  | 'awaiting_upload'
  | 'queued'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'manual_review';

export interface ProcessingRecord {
  readonly documentId: string;
  readonly status: ProcessingStatus;
  readonly attempts: number;
  /** Technical code only. Never the text that caused it — see ADR-001. */
  readonly failureCode?: string;
  readonly updatedAt: string;
}

export interface SummaryRecord {
  readonly documentId: string;
  readonly summary: unknown;
  readonly pipelineVersion: string;
  readonly createdAt: string;
}

export interface FollowUpRecord {
  readonly followUpId: string;
  readonly parentId: string;
  readonly title: string;
  readonly dueDate: string;
  readonly status: string;
  readonly origin: string;
  readonly createdAt: string;
}

export interface RecordRepository {
  putParent(ownerId: OwnerId, parent: ParentRecord): Promise<void>;
  getParent(ownerId: OwnerId, parentId: string): Promise<ParentRecord | null>;
  listParents(ownerId: OwnerId): Promise<ParentRecord[]>;
  deleteParent(ownerId: OwnerId, parentId: string): Promise<void>;

  putDocument(ownerId: OwnerId, document: DocumentRecord): Promise<void>;
  getDocument(ownerId: OwnerId, documentId: string): Promise<DocumentRecord | null>;
  listDocumentsForParent(ownerId: OwnerId, parentId: string): Promise<DocumentRecord[]>;
  deleteDocument(ownerId: OwnerId, documentId: string): Promise<void>;

  putProcessing(ownerId: OwnerId, processing: ProcessingRecord): Promise<void>;
  getProcessing(ownerId: OwnerId, documentId: string): Promise<ProcessingRecord | null>;

  putSummary(ownerId: OwnerId, summary: SummaryRecord): Promise<void>;
  getSummary(ownerId: OwnerId, documentId: string): Promise<SummaryRecord | null>;

  putFollowUp(ownerId: OwnerId, followUp: FollowUpRecord): Promise<void>;
  listFollowUpsDueBefore(ownerId: OwnerId, dueDate: string): Promise<FollowUpRecord[]>;
  listFollowUpsForParent(ownerId: OwnerId, parentId: string): Promise<FollowUpRecord[]>;

  /**
   * Claims an operation key, returning false if it was already claimed.
   *
   * A phone on a train retries. Without this, one upload becomes two documents.
   */
  claimIdempotencyKey(
    ownerId: OwnerId,
    operation: string,
    key: string,
    ttlSeconds?: number,
  ): Promise<boolean>;
}

/** Strips the keys before handing an item back. Callers deal in records. */
const withoutKeys = <T>(item: Record<string, unknown> | undefined): T | null => {
  if (item === undefined) return null;
  const { PK, SK, GSI1PK, GSI1SK, ...rest } = item;
  void PK;
  void SK;
  void GSI1PK;
  void GSI1SK;
  return rest as T;
};

const IDEMPOTENCY_DEFAULT_TTL_SECONDS = 24 * 60 * 60;

export const createRecordRepository = (config: StackConfig): RecordRepository => {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient(config.clients.records), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const TableName = config.recordsTable;

  /** Every query in this file goes through here, so none can forget the scope. */
  const queryOwned = async <T>(
    ownerId: OwnerId,
    skPrefix: string,
    extra: { limit?: number } = {},
  ): Promise<T[]> => {
    const response = await client.send(
      new QueryCommand({
        TableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': ownerPk(ownerId), ':prefix': skPrefix },
        ...(extra.limit === undefined ? {} : { Limit: extra.limit }),
      }),
    );

    return (response.Items ?? []).map((item) => withoutKeys<T>(item)!);
  };

  const getOwned = async <T>(ownerId: OwnerId, sk: string): Promise<T | null> => {
    const response = await client.send(
      new GetCommand({ TableName, Key: { PK: ownerPk(ownerId), SK: sk } }),
    );
    return withoutKeys<T>(response.Item);
  };

  const putOwned = async (
    ownerId: OwnerId,
    sk: string,
    body: Record<string, unknown>,
  ): Promise<void> => {
    await client.send(
      new PutCommand({ TableName, Item: { PK: ownerPk(ownerId), SK: sk, ...body } }),
    );
  };

  return {
    // --- Parents ------------------------------------------------------------
    async putParent(ownerId, parent) {
      await putOwned(ownerId, parentSk(parent.parentId), { ...parent });
    },

    getParent: (ownerId, parentId) => getOwned<ParentRecord>(ownerId, parentSk(parentId)),

    listParents: (ownerId) => queryOwned<ParentRecord>(ownerId, PARENT_PREFIX),

    async deleteParent(ownerId, parentId) {
      // Only the parent row. Their documents, summaries and follow-ups are
      // removed by the caller, which is where the audit entry belongs — a
      // cascade hidden in here would delete medical records without a trace of
      // who asked for it.
      await client.send(
        new DeleteCommand({ TableName, Key: { PK: ownerPk(ownerId), SK: parentSk(parentId) } }),
      );
    },

    // --- Documents ----------------------------------------------------------
    async putDocument(ownerId, document) {
      await putOwned(ownerId, documentSk(document.documentId), {
        ...document,
        GSI1PK: parentGsiPk(ownerId, document.parentId),
        GSI1SK: documentGsiSk(document.documentDate, document.documentId),
      });
    },

    getDocument: (ownerId, documentId) => getOwned<DocumentRecord>(ownerId, documentSk(documentId)),

    async listDocumentsForParent(ownerId, parentId) {
      const response = await client.send(
        new QueryCommand({
          TableName,
          IndexName: GSI1_NAME,
          KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
          ExpressionAttributeValues: {
            ':pk': parentGsiPk(ownerId, parentId),
            ':prefix': DOCUMENT_PREFIX,
          },
          // Newest first, which is how the app lists them.
          ScanIndexForward: false,
        }),
      );

      return (response.Items ?? []).map((item) => withoutKeys<DocumentRecord>(item)!);
    },

    async deleteDocument(ownerId, documentId) {
      await client.send(
        new DeleteCommand({ TableName, Key: { PK: ownerPk(ownerId), SK: documentSk(documentId) } }),
      );
    },

    // --- Processing ---------------------------------------------------------
    async putProcessing(ownerId, processing) {
      await putOwned(ownerId, processingSk(processing.documentId), { ...processing });
    },

    getProcessing: (ownerId, documentId) =>
      getOwned<ProcessingRecord>(ownerId, processingSk(documentId)),

    // --- Summaries ----------------------------------------------------------
    async putSummary(ownerId, summary) {
      await putOwned(ownerId, summarySk(summary.documentId), { ...summary });
    },

    getSummary: (ownerId, documentId) => getOwned<SummaryRecord>(ownerId, summarySk(documentId)),

    // --- Follow-ups ---------------------------------------------------------
    async putFollowUp(ownerId, followUp) {
      await putOwned(ownerId, followUpSk(followUp.dueDate, followUp.followUpId), {
        ...followUp,
        GSI1PK: parentGsiPk(ownerId, followUp.parentId),
        GSI1SK: followUpGsiSk(followUp.dueDate, followUp.followUpId),
      });
    },

    async listFollowUpsDueBefore(ownerId, dueDate) {
      // The sort key starts with the due date, so "what is overdue" is a range
      // read rather than a fetch-everything-and-filter.
      const response = await client.send(
        new QueryCommand({
          TableName,
          KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
          ExpressionAttributeValues: {
            ':pk': ownerPk(ownerId),
            ':from': FOLLOW_UP_PREFIX,
            ':to': `${FOLLOW_UP_PREFIX}${dueDate}#￿`,
          },
        }),
      );

      return (response.Items ?? []).map((item) => withoutKeys<FollowUpRecord>(item)!);
    },

    async listFollowUpsForParent(ownerId, parentId) {
      const response = await client.send(
        new QueryCommand({
          TableName,
          IndexName: GSI1_NAME,
          KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
          ExpressionAttributeValues: {
            ':pk': parentGsiPk(ownerId, parentId),
            ':prefix': FOLLOW_UP_PREFIX,
          },
        }),
      );

      return (response.Items ?? []).map((item) => withoutKeys<FollowUpRecord>(item)!);
    },

    // --- Idempotency --------------------------------------------------------
    async claimIdempotencyKey(ownerId, operation, key, ttlSeconds) {
      const expiresAt =
        Math.floor(Date.now() / 1000) + (ttlSeconds ?? IDEMPOTENCY_DEFAULT_TTL_SECONDS);

      try {
        await client.send(
          new UpdateCommand({
            TableName,
            Key: { PK: ownerPk(ownerId), SK: idempotencySk(operation, key) },
            // The claim and the check are one atomic operation. Doing this as a
            // read then a write would let two retries of the same upload both
            // see "not claimed" and both proceed.
            ConditionExpression: 'attribute_not_exists(PK)',
            UpdateExpression: 'SET claimedAt = :now, #ttl = :expiresAt',
            ExpressionAttributeNames: { '#ttl': TTL_ATTRIBUTE },
            ExpressionAttributeValues: {
              ':now': new Date().toISOString(),
              ':expiresAt': expiresAt,
            },
          }),
        );
        return true;
      } catch (error) {
        if ((error as Error).name === 'ConditionalCheckFailedException') return false;
        throw error;
      }
    },
  };
};
