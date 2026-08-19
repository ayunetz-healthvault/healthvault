import { beforeAll, describe, expect, it } from 'vitest';

import { loadStackConfig } from '../../src/config/stack.js';
import {
  createRecordRepository,
  type DocumentRecord,
  type FollowUpRecord,
  type ParentRecord,
} from '../../src/services/records/RecordRepository.js';
import { initialiseLocalStack } from '../../src/services/localStack/initialise.js';
import { ensureTable, tableDefinition } from '../../src/services/records/tableDefinition.js';

/**
 * Runs against DynamoDB Local — the real DynamoDB API, so key schemas,
 * conditional writes, index queries and sort ordering behave as they will on
 * AWS. Skips loudly when the stack is not up.
 *
 * The tenant-isolation block is the one that matters. ADR-003 records that IAM
 * cannot be exercised locally, so isolation has to be enforced in the query path
 * as well and asserted here rather than left to review.
 */
const config = loadStackConfig();

const stackIsUp = async (): Promise<boolean> => {
  try {
    await fetch(config.clients.records.endpoint!, { signal: AbortSignal.timeout(1_500) });
    return true;
  } catch {
    return false;
  }
};

const up = await stackIsUp();

const isoNow = (): string => new Date().toISOString();

const parent = (parentId: string, overrides: Partial<ParentRecord> = {}): ParentRecord => ({
  parentId,
  fullName: 'Lakshmi Iyer',
  relationship: 'mother',
  dateOfBirth: '1955-04-18',
  city: 'Chennai',
  createdAt: isoNow(),
  updatedAt: isoNow(),
  ...overrides,
});

const document = (
  documentId: string,
  parentId: string,
  overrides: Partial<DocumentRecord> = {},
): DocumentRecord => ({
  documentId,
  parentId,
  title: 'Diabetes panel',
  category: 'lab_report',
  documentDate: '2026-03-14',
  pageCount: 2,
  createdAt: isoNow(),
  updatedAt: isoNow(),
  ...overrides,
});

const followUp = (
  followUpId: string,
  parentId: string,
  dueDate: string,
  overrides: Partial<FollowUpRecord> = {},
): FollowUpRecord => ({
  followUpId,
  parentId,
  title: 'Review diabetes panel',
  dueDate,
  status: 'scheduled',
  origin: 'user',
  createdAt: isoNow(),
  ...overrides,
});

describe.skipIf(!up)('the record repository', () => {
  const repository = createRecordRepository(config);

  // Unique per run, so re-runs never see each other's rows.
  const run = Date.now().toString(36);
  const alice = `owner_alice_${run}`;
  const bob = `owner_bob_${run}`;

  beforeAll(async () => {
    await initialiseLocalStack(config);
  });

  describe('parents', () => {
    it('stores and reads one back', async () => {
      await repository.putParent(alice, parent('parent_1'));

      const stored = await repository.getParent(alice, 'parent_1');
      expect(stored?.fullName).toBe('Lakshmi Iyer');
      expect(stored?.parentId).toBe('parent_1');
    });

    it('does not hand back the storage keys', async () => {
      await repository.putParent(alice, parent('parent_keys'));

      const stored = (await repository.getParent(alice, 'parent_keys')) as unknown as Record<
        string,
        unknown
      >;
      expect(stored).not.toHaveProperty('PK');
      expect(stored).not.toHaveProperty('SK');
    });

    it('returns null for one that does not exist', async () => {
      expect(await repository.getParent(alice, 'parent_missing')).toBeNull();
    });

    it('lists them', async () => {
      await repository.putParent(alice, parent('parent_2', { fullName: 'Ramesh Iyer' }));

      const ids = (await repository.listParents(alice)).map((entry) => entry.parentId);
      expect(ids).toContain('parent_1');
      expect(ids).toContain('parent_2');
    });

    it('deletes one', async () => {
      await repository.putParent(alice, parent('parent_gone'));
      await repository.deleteParent(alice, 'parent_gone');

      expect(await repository.getParent(alice, 'parent_gone')).toBeNull();
    });
  });

  describe('documents', () => {
    it('is fetchable by id alone, with no parent in the path', async () => {
      await repository.putDocument(alice, document('doc_1', 'parent_1'));

      const stored = await repository.getDocument(alice, 'doc_1');
      expect(stored?.title).toBe('Diabetes panel');
    });

    it('lists a parent’s documents newest first', async () => {
      await repository.putDocument(
        alice,
        document('doc_old', 'parent_1', { documentDate: '2025-01-01' }),
      );
      await repository.putDocument(
        alice,
        document('doc_new', 'parent_1', { documentDate: '2026-06-01' }),
      );

      const dates = (await repository.listDocumentsForParent(alice, 'parent_1')).map(
        (entry) => entry.documentDate,
      );

      expect(dates).toEqual([...dates].sort().reverse());
      expect(dates[0]).toBe('2026-06-01');
    });

    it('keeps one parent’s documents out of another’s list', async () => {
      await repository.putDocument(alice, document('doc_other_parent', 'parent_2'));

      const ids = (await repository.listDocumentsForParent(alice, 'parent_1')).map(
        (entry) => entry.documentId,
      );
      expect(ids).not.toContain('doc_other_parent');
    });

    /**
     * The reason documents are keyed by id rather than by parent-and-id. A
     * caregiver adding a report to the wrong parent at 11pm is a real thing, and
     * with the plan's original key this would have meant rewriting the row.
     */
    it('re-files a mis-filed document without touching its id', async () => {
      await repository.putDocument(alice, document('doc_misfiled', 'parent_1'));
      const stored = await repository.getDocument(alice, 'doc_misfiled');

      await repository.putDocument(alice, { ...stored!, parentId: 'parent_2' });

      const fromOld = (await repository.listDocumentsForParent(alice, 'parent_1')).map(
        (entry) => entry.documentId,
      );
      const fromNew = (await repository.listDocumentsForParent(alice, 'parent_2')).map(
        (entry) => entry.documentId,
      );

      expect(fromOld).not.toContain('doc_misfiled');
      expect(fromNew).toContain('doc_misfiled');
      expect((await repository.getDocument(alice, 'doc_misfiled'))?.documentId).toBe('doc_misfiled');
    });
  });

  describe('processing state and summaries', () => {
    it('records processing status against a document', async () => {
      await repository.putProcessing(alice, {
        documentId: 'doc_1',
        status: 'queued',
        attempts: 0,
        updatedAt: isoNow(),
      });

      expect((await repository.getProcessing(alice, 'doc_1'))?.status).toBe('queued');
    });

    it('carries a failure code without the text that caused it', async () => {
      await repository.putProcessing(alice, {
        documentId: 'doc_failed',
        status: 'failed',
        attempts: 3,
        failureCode: 'privacy_failed',
        updatedAt: isoNow(),
      });

      const stored = await repository.getProcessing(alice, 'doc_failed');
      expect(stored?.failureCode).toBe('privacy_failed');
      expect(JSON.stringify(stored)).not.toMatch(/Lakshmi|Iyer|HbA1c/);
    });

    it('stores a summary against its document', async () => {
      await repository.putSummary(alice, {
        documentId: 'doc_1',
        summary: { overview: 'A diabetes panel.' },
        pipelineVersion: 'redaction-v2',
        createdAt: isoNow(),
      });

      expect((await repository.getSummary(alice, 'doc_1'))?.pipelineVersion).toBe('redaction-v2');
    });
  });

  describe('follow-ups', () => {
    it('reads what is due before a date as a range, in date order', async () => {
      await repository.putFollowUp(alice, followUp('fup_past', 'parent_1', '2026-01-10'));
      await repository.putFollowUp(alice, followUp('fup_soon', 'parent_1', '2026-02-20'));
      await repository.putFollowUp(alice, followUp('fup_later', 'parent_1', '2027-12-31'));

      const due = await repository.listFollowUpsDueBefore(alice, '2026-06-01');
      const ids = due.map((entry) => entry.followUpId);

      expect(ids).toContain('fup_past');
      expect(ids).toContain('fup_soon');
      expect(ids).not.toContain('fup_later');
      expect(due.map((entry) => entry.dueDate)).toEqual(
        [...due.map((entry) => entry.dueDate)].sort(),
      );
    });

    it('scopes them to one parent', async () => {
      await repository.putFollowUp(alice, followUp('fup_other', 'parent_2', '2026-03-03'));

      const ids = (await repository.listFollowUpsForParent(alice, 'parent_1')).map(
        (entry) => entry.followUpId,
      );
      expect(ids).not.toContain('fup_other');
    });
  });

  describe('idempotency', () => {
    it('lets the first claim through and refuses the second', async () => {
      const key = `upload_${run}`;

      expect(await repository.claimIdempotencyKey(alice, 'create_document', key)).toBe(true);
      expect(await repository.claimIdempotencyKey(alice, 'create_document', key)).toBe(false);
    });

    it('claims are per tenant, so two accounts can use the same key', async () => {
      const key = `shared_key_${run}`;

      expect(await repository.claimIdempotencyKey(alice, 'create_document', key)).toBe(true);
      expect(await repository.claimIdempotencyKey(bob, 'create_document', key)).toBe(true);
    });

    it('claims are per operation', async () => {
      const key = `per_operation_${run}`;

      expect(await repository.claimIdempotencyKey(alice, 'create_document', key)).toBe(true);
      expect(await repository.claimIdempotencyKey(alice, 'confirm_follow_up', key)).toBe(true);
    });

    it('holds under concurrent retries, so one upload cannot become two', async () => {
      const key = `race_${run}`;

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          repository.claimIdempotencyKey(alice, 'create_document', key),
        ),
      );

      expect(results.filter(Boolean)).toHaveLength(1);
    });
  });

  /**
   * The block that has to hold. Every identifier below is real and belongs to
   * Alice; Bob asks for all of them by name and must get nothing.
   */
  describe('tenant isolation', () => {
    beforeAll(async () => {
      await repository.putParent(bob, parent('parent_bob', { fullName: 'Someone Else' }));
    });

    it('refuses another tenant’s parent, by exact id', async () => {
      expect(await repository.getParent(bob, 'parent_1')).toBeNull();
    });

    it('refuses another tenant’s document, by exact id', async () => {
      expect(await repository.getDocument(bob, 'doc_1')).toBeNull();
    });

    it('refuses another tenant’s summary, by exact id', async () => {
      expect(await repository.getSummary(bob, 'doc_1')).toBeNull();
    });

    it('refuses another tenant’s processing state, by exact id', async () => {
      expect(await repository.getProcessing(bob, 'doc_1')).toBeNull();
    });

    it('lists only its own parents', async () => {
      const names = (await repository.listParents(bob)).map((entry) => entry.fullName);
      expect(names).toEqual(['Someone Else']);
    });

    it('returns nothing for another tenant’s parent id on the index', async () => {
      expect(await repository.listDocumentsForParent(bob, 'parent_1')).toEqual([]);
      expect(await repository.listFollowUpsForParent(bob, 'parent_1')).toEqual([]);
    });

    it('sees none of another tenant’s follow-ups in its own date range', async () => {
      expect(await repository.listFollowUpsDueBefore(bob, '2030-01-01')).toEqual([]);
    });

    it('cannot be made to cross tenants by deleting', async () => {
      await repository.deleteParent(bob, 'parent_1');
      await repository.deleteDocument(bob, 'doc_1');

      expect(await repository.getParent(alice, 'parent_1')).not.toBeNull();
      expect(await repository.getDocument(alice, 'doc_1')).not.toBeNull();
    });
  });

  describe('the table definition', () => {
    it('bills on demand, matching how a caregiver actually uses the app', () => {
      expect(tableDefinition('t').BillingMode).toBe('PAY_PER_REQUEST');
    });

    it('refuses to create a table on AWS, where the CDK stack owns that', async () => {
      await expect(ensureTable({ ...config, name: 'aws' })).rejects.toThrow(/CDK stack/i);
    });
  });
});

describe.skipIf(up)('the record repository (stack not running)', () => {
  it('is skipped — start it with: npm run stack:up', () => {
    expect(up).toBe(false);
  });
});
