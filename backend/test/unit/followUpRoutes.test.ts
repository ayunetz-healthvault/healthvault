import type { FastifyInstance } from 'fastify';
import { createLocalJWKSet } from 'jose';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadIdentityConfig } from '../../src/config/identity.js';
import { loadStackConfig } from '../../src/config/stack.js';
import { createLocalIssuer } from '../../src/services/identity/localIssuer.js';
import { createTokenVerifier } from '../../src/services/identity/TokenVerifier.js';
import type { ObjectStore } from '../../src/services/objects/ObjectStore.js';
import { inMemoryAccessRepository, inMemoryPatientRepository } from '../helpers/inMemoryAccess.js';

/**
 * The things a family has to do next, shared between the people doing them.
 *
 * Two properties carry most of these tests. Where a task came from can never be
 * rewritten — a suggestion accepted from a summary must not become
 * indistinguishable from one somebody typed. And a partial update changes only
 * what it names: marking a task done must not blank its title.
 */

const identity = loadIdentityConfig('local', 'ap-south-1', {
  AYUNETZ_IDENTITY_ISSUER: 'http://localhost:4000/local-identity',
  AYUNETZ_IDENTITY_AUDIENCE: 'ayunetz-local-app',
});

const issuer = createLocalIssuer(identity, 'local');
const verifier = createTokenVerifier(identity, createLocalJWKSet(await issuer.jwks()));

const silent = (): NodeJS.WritableStream =>
  ({ write: () => true }) as unknown as NodeJS.WritableStream;

const objects: ObjectStore = {
  keyFor: () => 'k',
  presignUpload: async () => ({ key: 'k', url: 'u', expiresInSeconds: 900, headers: {} }),
  presignDownload: async () => 'https://objects.test.invalid/page',
  put: async () => undefined,
  get: async () => new Uint8Array(),
  exists: async () => true,
  delete: async () => undefined,
  prefixFor: (patientId: string) => `patients/${patientId}/`,
  deletePrefix: async () => ({ objects: 0 }),
};

const PATIENT = 'pat_1';
const NOW = '2026-09-08T10:00:00.000Z';

let app: FastifyInstance;
let access: ReturnType<typeof inMemoryAccessRepository>;
let patients: ReturnType<typeof inMemoryPatientRepository>;

const tokens = new Map<string, string>();
const auth = async (accountId: string): Promise<Record<string, string>> => {
  const existing = tokens.get(accountId);
  const token =
    existing ?? (await issuer.issueFor({ ownerId: accountId, email: `${accountId}@x.invalid` }));
  tokens.set(accountId, token);
  return { authorization: `Bearer ${token}` };
};

const invite = async (
  accountId: string,
  role: 'manager' | 'contributor' | 'viewer',
): Promise<void> => {
  const issued = await access.createInvitation({
    patientId: PATIENT,
    role,
    invitedBy: 'acc_alice',
    ttlSeconds: 3600,
  });
  await access.acceptInvitation(issued.token, accountId);
};

const create = async (accountId: string, payload: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: `/v1/patients/${PATIENT}/follow-ups`,
    headers: await auth(accountId),
    payload: {
      title: 'Eye clinic',
      kind: 'doctor_visit',
      dueDate: '2026-10-01',
      ...payload,
    },
  });

const patch = async (accountId: string, followUpId: string, payload: Record<string, unknown>) =>
  app.inject({
    method: 'PATCH',
    url: `/v1/patients/${PATIENT}/follow-ups/${followUpId}`,
    headers: await auth(accountId),
    payload,
  });

const idOf = (response: { json: () => unknown }): string =>
  (response.json() as { followUp: { followUpId: string } }).followUp.followUpId;

beforeEach(async () => {
  access = inMemoryAccessRepository();
  patients = inMemoryPatientRepository();
  app = buildApp({
    stack: loadStackConfig(),
    identity,
    verifier,
    access,
    patients,
    objects,
    logStream: silent(),
  });
  await app.ready();

  await patients.putPatient({
    patientId: PATIENT,
    fullName: 'Meera Nair',
    relationship: 'mother',
    createdByAccountId: 'acc_alice',
    createdAt: NOW,
    updatedAt: NOW,
  });
  await access.createSelfGrant(PATIENT, 'acc_alice');
});

afterAll(async () => {
  await app?.close();
});

describe('creating a follow-up', () => {
  it('records it as scheduled, with no calendar event', async () => {
    const response = await create('acc_alice');

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      followUp: { status: 'scheduled', origin: 'manual', calendarEventId: null },
    });
  });

  it('keeps the time of day when there is one', async () => {
    const response = await create('acc_alice', { dueTime: '10:30' });

    expect(response.json()).toMatchObject({ followUp: { dueTime: '10:30' } });
  });

  it('refuses a due date that is not a date', async () => {
    expect((await create('acc_alice', { dueDate: 'next Tuesday' })).statusCode).toBe(400);
  });

  /**
   * A task that claims to come from a report has to name the report. Without
   * it nobody can check the instruction against the original, which is the
   * whole reason for recording where it came from.
   */
  it('refuses a document origin with no document', async () => {
    expect((await create('acc_alice', { origin: 'document' })).statusCode).toBe(400);
  });

  it('accepts one that names its document', async () => {
    const response = await create('acc_alice', {
      origin: 'document',
      sourceDocumentId: 'doc_1',
    });

    expect(response.json()).toMatchObject({
      followUp: { origin: 'document', sourceDocumentId: 'doc_1' },
    });
  });
});

describe('changing one', () => {
  it('marks it done without touching anything else', async () => {
    const id = idOf(await create('acc_alice'));

    const response = await patch('acc_alice', id, { status: 'completed' });

    expect(response.json()).toMatchObject({
      followUp: { status: 'completed', title: 'Eye clinic', dueDate: '2026-10-01' },
    });
  });

  /**
   * The due date is part of the storage key, so moving a date has to remove the
   * old row. A duplicate here would show the family the same appointment twice,
   * on two different days.
   */
  it('leaves no copy behind when the date moves', async () => {
    const id = idOf(await create('acc_alice'));

    await patch('acc_alice', id, { dueDate: '2026-11-15' });

    const listed = await patients.listFollowUps(PATIENT);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.dueDate).toBe('2026-11-15');
  });

  it('refuses to relabel where a task came from', async () => {
    const id = idOf(
      await create('acc_alice', { origin: 'document', sourceDocumentId: 'doc_1' }),
    );

    const response = await patch('acc_alice', id, {
      origin: 'manual',
      sourceDocumentId: null,
    });

    expect(response.json()).toMatchObject({
      followUp: { origin: 'document', sourceDocumentId: 'doc_1' },
    });
  });

  /**
   * Recorded, and nothing more. The server storing an event id does not mean a
   * calendar was written to, and never means another device may write to its
   * own — each one asks its owner first.
   */
  it('stores a calendar event id when a device confirms one', async () => {
    const id = idOf(await create('acc_alice'));

    const response = await patch('acc_alice', id, { calendarEventId: 'evt_1' });

    expect(response.json()).toMatchObject({ followUp: { calendarEventId: 'evt_1' } });
  });

  it('lets a device forget its calendar event', async () => {
    const id = idOf(await create('acc_alice'));
    await patch('acc_alice', id, { calendarEventId: 'evt_1' });

    const response = await patch('acc_alice', id, { calendarEventId: null });

    expect(response.json()).toMatchObject({ followUp: { calendarEventId: null } });
  });

  it('says so when there is no such follow-up', async () => {
    expect((await patch('acc_alice', 'fup_nope', { status: 'completed' })).statusCode).toBe(404);
  });
});

describe('who may do what', () => {
  it('lets a contributor add and complete a task', async () => {
    await invite('acc_helper', 'contributor');

    const response = await create('acc_helper');
    expect(response.statusCode).toBe(201);
    expect((await patch('acc_helper', idOf(response), { status: 'completed' })).statusCode).toBe(200);
  });

  /** Read-only means read-only, including tasks. */
  it('refuses a viewer', async () => {
    await invite('acc_watcher', 'viewer');

    expect((await create('acc_watcher')).statusCode).toBe(403);
  });

  it('lets a viewer read the list', async () => {
    await invite('acc_watcher', 'viewer');
    await create('acc_alice');

    const response = await app.inject({
      method: 'GET',
      url: `/v1/patients/${PATIENT}/follow-ups`,
      headers: await auth('acc_watcher'),
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as { followUps: unknown[] }).followUps).toHaveLength(1);
  });

  it('tells a stranger nothing, including whether the record exists', async () => {
    expect((await create('acc_stranger')).statusCode).toBe(404);
  });
});

describe('removing one', () => {
  it('deletes it and leaves an audit entry', async () => {
    const id = idOf(await create('acc_alice'));

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/patients/${PATIENT}/follow-ups/${id}`,
      headers: await auth('acc_alice'),
    });

    expect(response.statusCode).toBe(204);
    expect(await patients.listFollowUps(PATIENT)).toEqual([]);
    expect((await patients.listAudit(PATIENT)).map((entry) => entry.action)).toContain(
      'follow_up_deleted',
    );
  });
});

/**
 * The identity a follow-up keeps from the moment somebody types it.
 *
 * The bug these describe: the app wrote a task locally with its own id, posted
 * it, and the server minted a different one. The app went on holding an id the
 * server had never heard of, so the next edit — marking the appointment done —
 * was a 404 against a task that plainly existed. And a request that committed
 * but lost its response on the way back created a second appointment on retry,
 * because nothing tied the two attempts together.
 */
describe('the id the device generated', () => {
  it('is the id the record keeps', async () => {
    const response = await create('acc_alice', { followUpId: 'fup_local_1' });

    expect(response.statusCode).toBe(201);
    expect(idOf(response)).toBe('fup_local_1');
  });

  it('answers a retry with the task that already exists, not a second one', async () => {
    const first = await create('acc_alice', { followUpId: 'fup_local_1' });
    // The same request again: the phone never saw the first response.
    const retry = await create('acc_alice', { followUpId: 'fup_local_1' });

    expect(first.statusCode).toBe(201);
    // 200, not 201: nothing was created this time, and a caller can tell.
    expect(retry.statusCode).toBe(200);
    expect(idOf(retry)).toBe('fup_local_1');
    expect(await patients.listFollowUps(PATIENT)).toHaveLength(1);
  });

  it('does not audit a retry as a second creation', async () => {
    await create('acc_alice', { followUpId: 'fup_local_1' });
    await create('acc_alice', { followUpId: 'fup_local_1' });

    const created = (await patients.listAudit(PATIENT)).filter(
      (entry) => entry.action === 'follow_up_created',
    );
    expect(created).toHaveLength(1);
  });

  /**
   * The whole journey the review asked for: create, lose the response, retry,
   * edit, delete. One task throughout, and no 404 at any point.
   */
  it('survives create → timeout → retry → edit → delete as one task', async () => {
    await create('acc_alice', { followUpId: 'fup_local_1' });
    await create('acc_alice', { followUpId: 'fup_local_1' });

    const edited = await patch('acc_alice', 'fup_local_1', { status: 'completed' });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ followUp: { status: 'completed' } });

    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/patients/${PATIENT}/follow-ups/fup_local_1`,
      headers: await auth('acc_alice'),
    });

    expect(removed.statusCode).toBe(204);
    expect(await patients.listFollowUps(PATIENT)).toEqual([]);
  });

  /**
   * A retry that arrives after the date was changed gets the task as it stands.
   * Returning the original draft would tell the phone its edit had been undone.
   */
  it('answers a late retry with the current version of the task', async () => {
    await create('acc_alice', { followUpId: 'fup_local_1' });
    await patch('acc_alice', 'fup_local_1', { dueDate: '2026-11-02' });

    const retry = await create('acc_alice', { followUpId: 'fup_local_1' });

    expect(retry.json()).toMatchObject({ followUp: { dueDate: '2026-11-02' } });
    expect(await patients.listFollowUps(PATIENT)).toHaveLength(1);
  });

  /** The value becomes part of a sort key, so it cannot contain one. */
  it('refuses an id that could forge a key', async () => {
    expect((await create('acc_alice', { followUpId: 'fup#1' })).statusCode).toBe(400);
  });

  /** An older client that sends no id still works, and gets one. */
  it('still mints an id for a client that does not send one', async () => {
    const response = await create('acc_alice');

    expect(response.statusCode).toBe(201);
    expect(idOf(response)).toMatch(/^fup_/);
  });
});

/**
 * An appointment nobody kept.
 *
 * The app has always had this status; the server refused it, so the one fact
 * the other person most needed to see — that Thursday's clinic was missed —
 * was saved on one phone and rejected on its way to everybody else's.
 */
describe('a missed appointment', () => {
  it('is a status the shared record accepts', async () => {
    const id = idOf(await create('acc_alice'));

    const response = await patch('acc_alice', id, { status: 'missed' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ followUp: { status: 'missed' } });
  });
});

/**
 * Two attempts at one create, overlapping.
 *
 * The stable id fixed the identity and the ordinary sequential replay; it did
 * not fix this. Both attempts could read "no such follow-up" and both could
 * write, because a read followed by a write is not an idempotency mechanism —
 * it is a race with a comfortable-looking window. The loser wrote last, so a
 * delayed first attempt would overwrite the task the retry had created and
 * somebody had already completed, putting it back to `scheduled` and losing
 * their tick.
 *
 * The claim is what closes it: one item per follow-up id, written with a
 * condition, in the same transaction as the row.
 */
describe('two creates racing for the same id', () => {
  it('lets exactly one of them create the task', async () => {
    const [first, second] = await Promise.all([
      create('acc_alice', { followUpId: 'fup_local_1' }),
      create('acc_alice', { followUpId: 'fup_local_1' }),
    ]);

    const codes = [first.statusCode, second.statusCode].sort();
    expect(codes).toEqual([200, 201]);
    expect(await patients.listFollowUps(PATIENT)).toHaveLength(1);
  });

  /**
   * The scenario the review asked for by name: the first create is delayed
   * until after the retry has created the task and somebody has completed it.
   * The completion must survive.
   */
  it('does not let a delayed first attempt undo a completion', async () => {
    // The retry wins the race and the task is completed.
    await create('acc_alice', { followUpId: 'fup_local_1' });
    await patch('acc_alice', 'fup_local_1', { status: 'completed' });

    // The original attempt finally arrives, carrying the same draft as before.
    const late = await create('acc_alice', { followUpId: 'fup_local_1' });

    expect(late.statusCode).toBe(200);
    expect(late.json()).toMatchObject({ followUp: { status: 'completed' } });

    const stored = await patients.listFollowUps(PATIENT);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ status: 'completed' });
  });

  /** Rescheduling is not deleting: the claim survives a moved due date. */
  it('still recognises the id after the task has been rescheduled', async () => {
    await create('acc_alice', { followUpId: 'fup_local_1' });
    await patch('acc_alice', 'fup_local_1', { dueDate: '2026-11-02' });

    const late = await create('acc_alice', { followUpId: 'fup_local_1' });

    expect(late.statusCode).toBe(200);
    expect(late.json()).toMatchObject({ followUp: { dueDate: '2026-11-02' } });
    expect(await patients.listFollowUps(PATIENT)).toHaveLength(1);
  });

  /**
   * And a delayed create whose task has since been deleted does not put the
   * appointment back — which is why the claim outlives the row.
   */
  it('refuses to resurrect a task that was deleted', async () => {
    await create('acc_alice', { followUpId: 'fup_local_1' });
    await app.inject({
      method: 'DELETE',
      url: `/v1/patients/${PATIENT}/follow-ups/fup_local_1`,
      headers: await auth('acc_alice'),
    });

    const late = await create('acc_alice', { followUpId: 'fup_local_1' });

    expect(late.statusCode).toBe(410);
    expect(late.json()).toMatchObject({ code: 'follow_up_deleted' });
    expect(await patients.listFollowUps(PATIENT)).toEqual([]);
  });
});
