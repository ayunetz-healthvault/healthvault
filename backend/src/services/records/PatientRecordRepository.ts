import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
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

export interface PatientRecordRepository {
  putPatient(patient: PatientRecord): Promise<void>;
  getPatient(patientId: PatientId): Promise<PatientRecord | null>;
  deletePatient(patientId: PatientId): Promise<void>;

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

  putFollowUp(patientId: PatientId, followUp: FollowUpRecord): Promise<void>;
  listFollowUps(patientId: PatientId): Promise<FollowUpRecord[]>;

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

  const put = async (
    patientId: PatientId,
    SK: string,
    body: Record<string, unknown>,
  ): Promise<void> => {
    await client.send(new PutCommand({ TableName, Item: { PK: patientPk(patientId), SK, ...body } }));
  };

  const get = async <T>(patientId: PatientId, SK: string): Promise<T | null> => {
    const response = await client.send(
      new GetCommand({ TableName, Key: { PK: patientPk(patientId), SK } }),
    );
    return stripKeys<T>(response.Item);
  };

  const queryPrefix = async <T>(
    patientId: PatientId,
    prefix: string,
    options: { limit?: number; descending?: boolean } = {},
  ): Promise<T[]> => {
    const response = await client.send(
      new QueryCommand({
        TableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': patientPk(patientId), ':prefix': prefix },
        ...(options.limit === undefined ? {} : { Limit: options.limit }),
        ...(options.descending === true ? { ScanIndexForward: false } : {}),
      }),
    );
    return (response.Items ?? []).flatMap((item) => {
      const record = stripKeys<T>(item);
      return record === null ? [] : [record];
    });
  };

  return {
    putPatient: (patient) => put(patient.patientId, PATIENT_PROFILE_SK, { ...patient }),
    getPatient: (patientId) => get<PatientRecord>(patientId, PATIENT_PROFILE_SK),

    async deletePatient(patientId) {
      await client.send(
        new DeleteCommand({ TableName, Key: { PK: patientPk(patientId), SK: PATIENT_PROFILE_SK } }),
      );
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

    async putFollowUp(patientId, followUp) {
      await put(patientId, patientFollowUpSk(followUp.dueDate, followUp.followUpId), {
        ...followUp,
        GSI1PK: patientGsiPk(patientId),
        GSI1SK: followUpGsiSk(followUp.dueDate, followUp.followUpId),
      });
    },

    listFollowUps: (patientId) => queryPrefix<FollowUpRecord>(patientId, FOLLOW_UP_PREFIX),

    appendAudit: (entry) => put(entry.patientId, patientAuditSk(entry.at, entry.eventId), { ...entry }),

    // Newest first: "what just changed" is the question, not "what changed in
    // 2024". `ScanIndexForward: false` on a timestamp-prefixed sort key.
    listAudit: (patientId, limit = 50) =>
      queryPrefix<AuditEntry>(patientId, 'AUDIT#', { limit, descending: true }),
  };
};
