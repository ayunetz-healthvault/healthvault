import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import type { StackConfig } from '../../config/stack.js';
import {
  DOCUMENT_PREFIX,
  FOLLOW_UP_PREFIX,
  PARENT_PREFIX,
  accountGsiPk,
  documentGsiSk,
  followUpGsiSk,
  grantGsiSk,
  grantSk,
  ownerPk,
  patientDocumentSk,
  patientFollowUpSk,
  patientGsiPk,
  patientPk,
  patientProcessingSk,
  patientSummarySk,
  PATIENT_PROFILE_SK,
  type AccountId,
} from '../records/keys.js';

/**
 * Moves an owner-partitioned record into a patient partition — ADR-005.
 *
 * ## Additive, and reversible by doing nothing
 *
 * Nothing is deleted. Every source item under `USER#<ownerId>` is left exactly
 * where it is, and the new `PATIENT#<patientId>` items are written alongside.
 * Rollback is therefore "stop reading the new partitions", which needs no
 * second migration and cannot lose a document.
 *
 * The cost is a period of duplication. That is the right trade for medical
 * records: a migration that deletes as it goes has a window in which a crash
 * loses data, and there is no acceptable version of that here.
 *
 * ## Idempotent
 *
 * Re-running rewrites the same items with the same keys. The one thing that is
 * *not* rewritten is the grant, which is written conditionally — so a second
 * run cannot reset who was given management authority or when.
 *
 * ## What the caregiver gets, and does not get
 *
 * A `manager` grant, never `self`. The caregiver created a profile *about*
 * their parent; that is management authority, not being the subject of the
 * record. Making them `self` would let them delete their parent's medical
 * history and would leave no role for the parent to claim later.
 *
 * ## No auto-linking
 *
 * The migration does not look at names, phone numbers or email addresses to
 * guess that a migrated profile and some account are the same person. Matching
 * "Meera Nair" to an account with that name would silently hand somebody's
 * medical record to a stranger who shares it. A parent claims their own record
 * through an explicit, verified flow; until then the record simply has no
 * subject.
 */

export interface MigrationPlanEntry {
  readonly ownerId: AccountId;
  readonly patientId: string;
  readonly fullName: string;
  readonly documentCount: number;
  readonly followUpCount: number;
  readonly hasProcessing: number;
  readonly hasSummary: number;
  /** True when a patient partition for this id already exists. */
  readonly alreadyMigrated: boolean;
}

export interface MigrationReport {
  readonly planned: MigrationPlanEntry[];
  readonly itemsWritten: number;
  readonly grantsCreated: number;
  readonly applied: boolean;
  /** Anything that could not be migrated, with the reason. Never fatal. */
  readonly skipped: { readonly patientId: string; readonly reason: string }[];
}

interface StoredItem extends Record<string, unknown> {
  SK: string;
}

export const migrateOwnerToPatientPartitions = async (
  config: StackConfig,
  options: { ownerIds: AccountId[]; apply: boolean },
): Promise<MigrationReport> => {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient(config.clients.records), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const TableName = config.recordsTable;

  const planned: MigrationPlanEntry[] = [];
  const skipped: { patientId: string; reason: string }[] = [];
  let itemsWritten = 0;
  let grantsCreated = 0;

  const readPartition = async (ownerId: AccountId): Promise<StoredItem[]> => {
    const items: StoredItem[] = [];
    let cursor: Record<string, unknown> | undefined;

    do {
      const response = await client.send(
        new QueryCommand({
          TableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': ownerPk(ownerId) },
          ...(cursor === undefined ? {} : { ExclusiveStartKey: cursor }),
        }),
      );
      items.push(...((response.Items ?? []) as StoredItem[]));
      cursor = response.LastEvaluatedKey;
    } while (cursor !== undefined);

    return items;
  };

  const writeItem = async (patientId: string, SK: string, body: Record<string, unknown>) => {
    const { PK, SK: _sk, GSI1PK, GSI1SK, ...rest } = body;
    void PK;
    void _sk;
    void GSI1PK;
    void GSI1SK;
    await client.send(
      new PutCommand({ TableName, Item: { PK: patientPk(patientId), SK, ...rest } }),
    );
    itemsWritten += 1;
  };

  for (const ownerId of options.ownerIds) {
    const items = await readPartition(ownerId);
    const parents = items.filter((item) => item.SK.startsWith(PARENT_PREFIX));

    for (const parent of parents) {
      /**
       * The parent id becomes the patient id, unchanged.
       *
       * Every document, follow-up and summary already references it, so
       * re-keying would mean rewriting those references and leaving anything
       * missed pointing at nothing. Keeping the identifier makes the migration
       * a change of partition rather than a change of identity.
       */
      const patientId = String(parent.parentId ?? parent.SK.slice(PARENT_PREFIX.length));
      const fullName = String(parent.fullName ?? '');

      if (patientId.length === 0) {
        skipped.push({ patientId: '(unknown)', reason: 'parent item carries no id' });
        continue;
      }

      const existing = await client.send(
        new QueryCommand({
          TableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': patientPk(patientId) },
          Limit: 1,
        }),
      );
      const alreadyMigrated = (existing.Items ?? []).length > 0;

      const owned = <T extends StoredItem>(list: T[]): T[] =>
        list.filter((item) => String(item.parentId ?? '') === patientId);

      const documents = owned(items.filter((item) => item.SK.startsWith(DOCUMENT_PREFIX)));
      const followUps = owned(items.filter((item) => item.SK.startsWith(FOLLOW_UP_PREFIX)));
      const documentIds = new Set(documents.map((doc) => String(doc.documentId)));
      const processing = items.filter(
        (item) => item.SK.startsWith('PROCESSING#') && documentIds.has(String(item.documentId)),
      );
      const summaries = items.filter(
        (item) => item.SK.startsWith('SUMMARY#') && documentIds.has(String(item.documentId)),
      );

      planned.push({
        ownerId,
        patientId,
        fullName,
        documentCount: documents.length,
        followUpCount: followUps.length,
        hasProcessing: processing.length,
        hasSummary: summaries.length,
        alreadyMigrated,
      });

      if (!options.apply) continue;

      const now = new Date().toISOString();

      await writeItem(patientId, PATIENT_PROFILE_SK, {
        ...parent,
        patientId,
        createdByAccountId: ownerId,
        createdAt: String(parent.createdAt ?? now),
        updatedAt: String(parent.updatedAt ?? now),
      });

      for (const document of documents) {
        await writeItem(patientId, patientDocumentSk(String(document.documentId)), {
          ...document,
          GSI1PK: patientGsiPk(patientId),
          GSI1SK: documentGsiSk(String(document.documentDate), String(document.documentId)),
        });
      }
      for (const record of processing) {
        await writeItem(patientId, patientProcessingSk(String(record.documentId)), record);
      }
      for (const summary of summaries) {
        await writeItem(patientId, patientSummarySk(String(summary.documentId)), summary);
      }
      for (const followUp of followUps) {
        await writeItem(
          patientId,
          patientFollowUpSk(String(followUp.dueDate), String(followUp.followUpId)),
          {
            ...followUp,
            GSI1PK: patientGsiPk(patientId),
            GSI1SK: followUpGsiSk(String(followUp.dueDate), String(followUp.followUpId)),
          },
        );
      }

      /**
       * The grant, written conditionally so a re-run cannot reset it.
       *
       * `manager`, never `self` — see the note at the top of this file.
       */
      try {
        await client.send(
          new PutCommand({
            TableName,
            Item: {
              PK: patientPk(patientId),
              SK: grantSk(ownerId),
              GSI2PK: accountGsiPk(ownerId),
              GSI2SK: grantGsiSk(patientId),
              patientId,
              accountId: ownerId,
              role: 'manager',
              status: 'active',
              grantedBy: ownerId,
              grantedAt: now,
            },
            ConditionExpression: 'attribute_not_exists(PK)',
          }),
        );
        grantsCreated += 1;
      } catch (error) {
        if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
      }
    }
  }

  return { planned, itemsWritten, grantsCreated, applied: options.apply, skipped };
};
