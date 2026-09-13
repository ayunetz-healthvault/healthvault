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
 * The three records daily care produces, now that they reach the server.
 *
 * Most of these are about what the endpoints refuse. A note must not acquire a
 * severity; a medicine must not exist without somebody having confirmed it; a
 * dose event must not be editable, and a second tap on one tablet must not
 * become a second dose. Those are the properties that make this safe to share
 * between two people, and they are the ones a later change could quietly lose.
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
const NOW = '2026-09-09T10:00:00.000Z';

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

const post = async (accountId: string, path: string, payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: `/v1/patients/${PATIENT}${path}`,
    headers: await auth(accountId),
    payload,
  });

const observation = (patch: Record<string, unknown> = {}) => ({
  observationId: 'obs_local_1',
  text: 'A funny feeling in her chest after climbing the stairs',
  occurredAt: '2026-09-09T08:30:00.000Z',
  impact: 'moderately',
  recordedBy: 'acc_alice',
  recordedAt: NOW,
  ...patch,
});

const treatment = (patch: Record<string, unknown> = {}) => ({
  scheduleId: 'trt_local_1',
  name: 'Metformin',
  dosage: '500 mg',
  times: ['20:00', '08:00'],
  timezone: 'Asia/Kolkata',
  startDate: '2026-09-09',
  endDate: null,
  provenance: 'manual',
  confirmedBy: 'acc_alice',
  confirmedAt: NOW,
  ...patch,
});

const doseEvent = (patch: Record<string, unknown> = {}) => ({
  eventId: 'dse_local_1',
  scheduleId: 'trt_local_1',
  occurrenceKey: 'trt_local_1#2026-09-09#08:00',
  occurrenceAt: '2026-09-09T02:30:00.000Z',
  state: 'taken',
  recordedAt: NOW,
  recordedBy: 'acc_alice',
  recordedBySelf: true,
  undo: false,
  ...patch,
});

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

describe('writing down what somebody noticed', () => {
  it('stores the words exactly as they were written', async () => {
    const response = await post('acc_alice', '/observations', observation());

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      observation: {
        observationId: 'obs_local_1',
        text: 'A funny feeling in her chest after climbing the stairs',
        impact: 'moderately',
        version: 1,
      },
    });
  });

  /**
   * The refusal that matters most. There is no severity, no triage flag and no
   * clinical term anywhere in the stored record — a server that added one
   * would be practising medicine on the strength of a text box.
   */
  it('adds no severity, category or clinical term of its own', async () => {
    await post('acc_alice', '/observations', observation());

    const [stored] = await patients.listObservations(PATIENT);
    expect(Object.keys(stored ?? {}).sort()).toEqual([
      'impact',
      'observationId',
      'occurredAt',
      'parentId',
      'recordedAt',
      'recordedBy',
      'recordedBySelf',
      'text',
      'updatedAt',
      'version',
    ]);
  });

  it('refuses an impact it does not recognise rather than storing it', async () => {
    const response = await post('acc_alice', '/observations', observation({ impact: 'severe' }));

    expect(response.statusCode).toBe(400);
    expect(await patients.listObservations(PATIENT)).toEqual([]);
  });

  /** A retry of a request that committed returns the note, not a second one. */
  it('answers a retry with the note that exists', async () => {
    const first = await post('acc_alice', '/observations', observation());
    const retry = await post('acc_alice', '/observations', observation());

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(await patients.listObservations(PATIENT)).toHaveLength(1);
  });

  /**
   * "My mother says she felt dizzy" and "her daughter thinks she looked dizzy"
   * are different facts, and a client must not be able to claim the first.
   */
  it('takes “recorded by the patient” from the grant, never the body', async () => {
    await invite('acc_helper', 'contributor');

    await post('acc_helper', '/observations', observation({ recordedBySelf: true }));

    expect((await patients.listObservations(PATIENT))[0]).toMatchObject({
      recordedBySelf: false,
    });
  });

  it('lets a contributor write one and refuses a viewer', async () => {
    await invite('acc_helper', 'contributor');
    await invite('acc_watcher', 'viewer');

    expect(
      (await post('acc_helper', '/observations', observation({ observationId: 'obs_2' })))
        .statusCode,
    ).toBe(201);
    expect(
      (await post('acc_watcher', '/observations', observation({ observationId: 'obs_3' })))
        .statusCode,
    ).toBe(403);
  });
});

describe('editing a note two people can see', () => {
  const patch = async (accountId: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'PATCH',
      url: `/v1/patients/${PATIENT}/observations/obs_local_1`,
      headers: await auth(accountId),
      payload,
    });

  beforeEach(async () => {
    await post('acc_alice', '/observations', observation());
  });

  it('records the change and moves the version on', async () => {
    const response = await patch('acc_alice', { text: 'Dizzy after the new tablet', version: 1 });

    expect(response.json()).toMatchObject({
      observation: { text: 'Dizzy after the new tablet', version: 2 },
    });
  });

  /**
   * Two family members editing the same note is not a rare case in a record
   * built for two family members. The second one is told, rather than the
   * first one's words disappearing.
   */
  it('refuses an edit made against a version somebody has already replaced', async () => {
    await patch('acc_alice', { text: 'First edit', version: 1 });

    const stale = await patch('acc_alice', { text: 'Second edit', version: 1 });

    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'observation_changed', details: { version: 2 } });
    expect((await patients.listObservations(PATIENT))[0]).toMatchObject({ text: 'First edit' });
  });

  it('does not let an edit reattribute the note', async () => {
    await patch('acc_alice', {
      text: 'Edited',
      version: 1,
      recordedBy: 'acc_someone_else',
      recordedBySelf: false,
    } as Record<string, unknown>);

    expect((await patients.listObservations(PATIENT))[0]).toMatchObject({
      recordedBy: 'acc_alice',
      recordedBySelf: true,
    });
  });
});

describe('a medicine somebody has confirmed', () => {
  it('is stored with its times in order and no end date', async () => {
    const response = await post('acc_alice', '/treatments', treatment());

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      treatment: {
        name: 'Metformin',
        times: ['08:00', '20:00'],
        supersededAt: null,
        confirmedBy: 'acc_alice',
      },
    });
  });

  /**
   * The line between a medicine and a photograph of a prescription. A schedule
   * with no confirmation is a reading of a document, and this endpoint has no
   * way to create one.
   */
  it('refuses a schedule that nobody confirmed', async () => {
    const unconfirmed: Record<string, unknown> = treatment();
    delete unconfirmed.confirmedBy;

    const response = await post('acc_alice', '/treatments', unconfirmed);

    expect(response.statusCode).toBe(400);
    expect(await patients.listSchedules(PATIENT)).toEqual([]);
  });

  it('refuses “twice a day” without times', async () => {
    expect((await post('acc_alice', '/treatments', treatment({ times: [] }))).statusCode).toBe(400);
  });

  it('refuses one read from a document that does not name the document', async () => {
    const response = await post(
      'acc_alice',
      '/treatments',
      treatment({ provenance: 'from_document' }),
    );

    expect(response.statusCode).toBe(400);
  });

  it('records who confirmed it in the audit trail', async () => {
    await post('acc_alice', '/treatments', treatment());

    expect((await patients.listAudit(PATIENT)).map((entry) => entry.action)).toContain(
      'treatment_confirmed',
    );
  });

  /**
   * A contributor may confirm one, and a viewer may not.
   *
   * That is `policy.ts`'s existing answer and it is the right one: a helper who
   * takes Amma to the clinic and comes back with a new prescription is exactly
   * the person who confirms it. A viewer writes nothing at all, which is what
   * read-only has to mean.
   */
  it('lets a contributor confirm one and refuses a viewer', async () => {
    await invite('acc_helper', 'contributor');
    await invite('acc_watcher', 'viewer');

    expect((await post('acc_helper', '/treatments', treatment())).statusCode).toBe(201);
    expect(
      (await post('acc_watcher', '/treatments', treatment({ scheduleId: 'trt_2' }))).statusCode,
    ).toBe(403);
  });

  describe('stopping one', () => {
    beforeEach(async () => {
      await post('acc_alice', '/treatments', treatment());
    });

    it('sets the end and keeps everything else readable', async () => {
      const response = await post('acc_alice', '/treatments/trt_local_1/supersede', {
        supersededAt: '2026-10-01T00:00:00.000Z',
      });

      expect(response.json()).toMatchObject({
        treatment: {
          supersededAt: '2026-10-01T00:00:00.000Z',
          name: 'Metformin',
          times: ['08:00', '20:00'],
        },
      });
    });

    /** A retry must not rewrite when somebody came off a medicine. */
    it('keeps the first stop date when asked twice', async () => {
      await post('acc_alice', '/treatments/trt_local_1/supersede', {
        supersededAt: '2026-10-01T00:00:00.000Z',
      });

      const again = await post('acc_alice', '/treatments/trt_local_1/supersede', {
        supersededAt: '2026-11-15T00:00:00.000Z',
      });

      expect(again.json()).toMatchObject({
        treatment: { supersededAt: '2026-10-01T00:00:00.000Z' },
      });
    });

    it('still returns it afterwards, because what she was taking is the record', async () => {
      await post('acc_alice', '/treatments/trt_local_1/supersede', {
        supersededAt: '2026-10-01T00:00:00.000Z',
      });

      const listed = await app.inject({
        method: 'GET',
        url: `/v1/patients/${PATIENT}/treatments`,
        headers: await auth('acc_alice'),
      });

      expect((listed.json() as { treatments: unknown[] }).treatments).toHaveLength(1);
    });
  });
});

describe('recording a dose', () => {
  beforeEach(async () => {
    await post('acc_alice', '/treatments', treatment());
  });

  it('records what somebody pressed', async () => {
    const response = await post('acc_alice', '/dose-events', doseEvent());

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      doseEvent: { state: 'taken', undo: false, supersedesEventId: null },
    });
  });

  /**
   * Two taps on one tablet. The occurrence key exists for this, and a second
   * row would make the record say a dose was taken twice.
   */
  it('makes one event out of the same tap twice', async () => {
    const first = await post('acc_alice', '/dose-events', doseEvent());
    const second = await post('acc_alice', '/dose-events', doseEvent());

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(await patients.listDoseEvents(PATIENT)).toHaveLength(1);
  });

  /**
   * Undo appends rather than deletes, and says it is an undo — "taken, then
   * corrected to missed" is a different statement from "taken, then undone".
   */
  it('keeps the original event when one is undone', async () => {
    await post('acc_alice', '/dose-events', doseEvent());

    await post(
      'acc_alice',
      '/dose-events',
      doseEvent({
        eventId: 'dse_local_2',
        state: 'missed',
        supersedesEventId: 'dse_local_1',
        undo: true,
      }),
    );

    const events = await patients.listDoseEvents(PATIENT);
    expect(events).toHaveLength(2);
    expect(events.find((entry) => entry.eventId === 'dse_local_1')).toMatchObject({
      state: 'taken',
    });
    expect(events.find((entry) => entry.eventId === 'dse_local_2')).toMatchObject({
      undo: true,
      supersedesEventId: 'dse_local_1',
    });
  });

  /** There is no way to change or remove one. That is the design. */
  it('offers no way to edit or delete an event', async () => {
    await post('acc_alice', '/dose-events', doseEvent());

    const patched = await app.inject({
      method: 'PATCH',
      url: `/v1/patients/${PATIENT}/dose-events/dse_local_1`,
      headers: await auth('acc_alice'),
      payload: { state: 'missed' },
    });
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/v1/patients/${PATIENT}/dose-events/dse_local_1`,
      headers: await auth('acc_alice'),
    });

    expect(patched.statusCode).toBe(404);
    expect(deleted.statusCode).toBe(404);
    expect(await patients.listDoseEvents(PATIENT)).toHaveLength(1);
  });

  it('refuses an event for a medicine this record does not have', async () => {
    const response = await post(
      'acc_alice',
      '/dose-events',
      doseEvent({ scheduleId: 'trt_not_here' }),
    );

    expect(response.statusCode).toBe(404);
    expect(await patients.listDoseEvents(PATIENT)).toEqual([]);
  });

  /** A helper recording a dose is reporting what they believe, and it says so. */
  it('marks a helper’s record as not the patient’s own', async () => {
    await invite('acc_helper', 'manager');

    await post('acc_helper', '/dose-events', doseEvent({ recordedBySelf: true }));

    expect((await patients.listDoseEvents(PATIENT))[0]).toMatchObject({ recordedBySelf: false });
  });

  it('accepts only what a person pressed', async () => {
    expect(
      (await post('acc_alice', '/dose-events', doseEvent({ state: 'probably_taken' }))).statusCode,
    ).toBe(400);
  });
});

describe('a record being erased', () => {
  beforeEach(async () => {
    await patients.beginDeletion({
      patientId: PATIENT,
      requestedByAccountId: 'acc_alice',
      requestedAt: NOW,
    });
  });

  it('takes no notes, no medicines and no doses', async () => {
    const note = await post('acc_alice', '/observations', observation());
    const medicine = await post('acc_alice', '/treatments', treatment());

    expect(note.statusCode).toBe(410);
    expect(medicine.statusCode).toBe(410);
    expect(await patients.listObservations(PATIENT)).toEqual([]);
    expect(await patients.listSchedules(PATIENT)).toEqual([]);
  });
});
