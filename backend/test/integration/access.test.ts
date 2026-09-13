import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadStackConfig } from '../../src/config/stack.js';
import { createAccessRepository } from '../../src/services/access/AccessRepository.js';
import { initialiseLocalStack } from '../../src/services/localStack/initialise.js';
import { migrateOwnerToPatientPartitions } from '../../src/services/migration/patientPartitions.js';
import { createPatientRecordRepository } from '../../src/services/records/PatientRecordRepository.js';
import { createRecordRepository } from '../../src/services/records/RecordRepository.js';

/**
 * The half of KOO-03 that only DynamoDB can prove.
 *
 * `test/unit/accessRoutes.test.ts` covers every route decision against an
 * in-memory store. What it cannot cover is the storage semantics those
 * decisions lean on: the conditional writes that make claiming an invitation
 * and revoking a grant atomic when two requests arrive together, and the
 * `GSI2` query that answers "which patients can this account reach".
 *
 * A fake cannot demonstrate those, because a fake is single-threaded and does
 * whatever it was written to do. These run against the real database or they
 * skip — they are never quietly satisfied by a stand-in.
 */
const stack = loadStackConfig();

const stackIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${stack.clients.objects.endpoint}/minio/health/live`, {
      signal: AbortSignal.timeout(1_500),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const up = await stackIsUp();

describe.skipIf(!up)('access control against DynamoDB', () => {
  const access = createAccessRepository(stack);
  const patients = createPatientRecordRepository(stack);

  const unique = (prefix: string): string =>
    `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    await initialiseLocalStack(stack);
  });

  afterAll(async () => {
    // Deliberately nothing. The local table is shared with other suites and
    // every id here is unique, so a wholesale clean-up would delete another
    // run's fixtures mid-flight.
  });

  it('gives a record exactly one subject, even when two accounts race', async () => {
    const patientId = unique('pat');

    const [first, second] = await Promise.all([
      access.createSelfGrant(patientId, unique('acc')),
      access.createSelfGrant(patientId, unique('acc')),
    ]);

    expect([first, second].filter((grant) => grant !== null)).toHaveLength(1);
  });

  it('lets exactly one of two simultaneous accepts spend an invitation', async () => {
    const patientId = unique('pat');
    const owner = unique('acc');
    await access.createSelfGrant(patientId, owner);

    const { token } = await access.createInvitation({
      patientId,
      role: 'contributor',
      invitedBy: owner,
      ttlSeconds: 3600,
    });

    const results = await Promise.all([
      access.acceptInvitation(token, unique('acc')),
      access.acceptInvitation(token, unique('acc')),
    ]);

    expect(results.filter((result) => result.outcome === 'accepted')).toHaveLength(1);
    expect(results.filter((result) => result.outcome === 'rejected')).toHaveLength(1);
  });

  it('does not rewrite the revocation record when revoked twice at once', async () => {
    const patientId = unique('pat');
    const owner = unique('acc');
    const helper = unique('acc');
    await access.createSelfGrant(patientId, owner);
    const { token } = await access.createInvitation({
      patientId,
      role: 'viewer',
      invitedBy: owner,
      ttlSeconds: 3600,
    });
    await access.acceptInvitation(token, helper);

    const results = await Promise.all([
      access.revokeGrant(patientId, helper, owner),
      access.revokeGrant(patientId, helper, 'someone-else'),
    ]);

    expect(results.filter((grant) => grant !== null)).toHaveLength(1);
    expect((await access.getGrant(patientId, helper))?.revokedBy).toBe(owner);
  });

  it('answers "which patients can this account reach" from the index', async () => {
    const accountId = unique('acc');
    const first = unique('pat');
    const second = unique('pat');
    const other = unique('pat');

    await access.createSelfGrant(first, accountId);
    await access.createManagerGrant(second, accountId);
    await access.createSelfGrant(other, unique('acc'));

    const reachable = (await access.listGrantsForAccount(accountId)).map(
      (grant) => grant.patientId,
    );

    expect(reachable.sort()).toEqual([first, second].sort());
    expect(reachable).not.toContain(other);
  });

  it('stores only a hash of an invitation token', async () => {
    const patientId = unique('pat');
    const owner = unique('acc');
    const { token } = await access.createInvitation({
      patientId,
      role: 'viewer',
      invitedBy: owner,
      ttlSeconds: 3600,
    });

    const secret = token.slice(token.indexOf('.') + 1);
    const stored = JSON.stringify(await access.listInvitationsForPatient(patientId));

    expect(stored).not.toContain(secret);
  });

  it('keeps one patient’s documents out of another patient’s partition', async () => {
    const first = unique('pat');
    const second = unique('pat');
    const now = new Date().toISOString();

    await patients.putDocument(first, {
      documentId: unique('doc'),
      parentId: first,
      title: 'Report',
      category: 'lab_report',
      documentDate: '2026-09-01',
      pageCount: 1,
      createdAt: now,
      updatedAt: now,
    });

    expect(await patients.listDocuments(second)).toEqual([]);
    expect(await patients.listDocuments(first)).toHaveLength(1);
  });
});

describe.skipIf(!up)('the ADR-005 migration', () => {
  const records = createRecordRepository(stack);
  const access = createAccessRepository(stack);
  const patients = createPatientRecordRepository(stack);

  const unique = (prefix: string): string =>
    `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    await initialiseLocalStack(stack);
  });

  /** One caregiver, one parent, one document and one follow-up. */
  const seed = async (): Promise<{ ownerId: string; parentId: string; documentId: string }> => {
    const ownerId = unique('acc');
    const parentId = unique('pat');
    const documentId = unique('doc');
    const now = new Date().toISOString();

    await records.putParent(ownerId, {
      parentId,
      fullName: 'Meera Nair',
      relationship: 'mother',
      createdAt: now,
      updatedAt: now,
    });
    await records.putDocument(ownerId, {
      documentId,
      parentId,
      title: 'Blood test report',
      category: 'lab_report',
      documentDate: '2026-08-01',
      pageCount: 2,
      createdAt: now,
      updatedAt: now,
    });
    await records.putFollowUp(ownerId, {
      followUpId: unique('fup'),
      parentId,
      title: 'Repeat test',
      dueDate: '2026-12-01',
      status: 'scheduled',
      origin: 'user',
      createdAt: now,
    });

    return { ownerId, parentId, documentId };
  };

  it('writes nothing on a dry run', async () => {
    const { ownerId, parentId } = await seed();

    const report = await migrateOwnerToPatientPartitions(stack, {
      ownerIds: [ownerId],
      apply: false,
    });

    expect(report.applied).toBe(false);
    expect(report.itemsWritten).toBe(0);
    expect(report.planned).toEqual([
      expect.objectContaining({ patientId: parentId, documentCount: 1, followUpCount: 1 }),
    ]);
    expect(await patients.getPatient(parentId)).toBeNull();
  });

  it('moves the record into a patient partition, documents included', async () => {
    const { ownerId, parentId, documentId } = await seed();

    await migrateOwnerToPatientPartitions(stack, { ownerIds: [ownerId], apply: true });

    expect(await patients.getPatient(parentId)).toMatchObject({ fullName: 'Meera Nair' });
    expect(await patients.getDocument(parentId, documentId)).toMatchObject({ pageCount: 2 });
    expect(await patients.listFollowUps(parentId)).toHaveLength(1);
  });

  /** Rollback is "stop reading the new partitions", which requires this. */
  it('leaves every source item exactly where it was', async () => {
    const { ownerId, parentId, documentId } = await seed();

    await migrateOwnerToPatientPartitions(stack, { ownerIds: [ownerId], apply: true });

    expect(await records.getParent(ownerId, parentId)).not.toBeNull();
    expect(await records.getDocument(ownerId, documentId)).not.toBeNull();
  });

  /**
   * The caregiver created a profile *about* their parent. That is management
   * authority, not being the subject — and `self` would let them delete their
   * parent's medical history and leave no role for the parent to claim.
   */
  it('gives the caregiver management authority, never the self role', async () => {
    const { ownerId, parentId } = await seed();

    await migrateOwnerToPatientPartitions(stack, { ownerIds: [ownerId], apply: true });

    const grant = await access.getGrant(parentId, ownerId);
    expect(grant).toMatchObject({ role: 'manager', status: 'active' });

    const all = await access.listGrantsForPatient(parentId);
    expect(all.some((entry) => entry.role === 'self')).toBe(false);
  });

  it('can be run twice without changing who was granted what, or when', async () => {
    const { ownerId, parentId } = await seed();

    await migrateOwnerToPatientPartitions(stack, { ownerIds: [ownerId], apply: true });
    const first = await access.getGrant(parentId, ownerId);

    const second = await migrateOwnerToPatientPartitions(stack, {
      ownerIds: [ownerId],
      apply: true,
    });

    expect(second.grantsCreated).toBe(0);
    expect(await access.getGrant(parentId, ownerId)).toEqual(first);
  });

  it('leaves no document behind and creates no orphan', async () => {
    const { ownerId, parentId } = await seed();

    await migrateOwnerToPatientPartitions(stack, { ownerIds: [ownerId], apply: true });

    const before = await records.listDocumentsForParent(ownerId, parentId);
    const after = await patients.listDocuments(parentId);

    expect(after.map((doc) => doc.documentId).sort()).toEqual(
      before.map((doc) => doc.documentId).sort(),
    );
  });
});
