import type { FastifyInstance } from 'fastify';
import { createLocalJWKSet } from 'jose';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadIdentityConfig } from '../../src/config/identity.js';
import { loadStackConfig } from '../../src/config/stack.js';
import { CURRENT_NOTICE_VERSION } from '../../src/services/consent/policy.js';
import { createLocalIssuer } from '../../src/services/identity/localIssuer.js';
import { createTokenVerifier } from '../../src/services/identity/TokenVerifier.js';
import type { ObjectStore } from '../../src/services/objects/ObjectStore.js';
import { inMemoryAccessRepository, inMemoryPatientRepository } from '../helpers/inMemoryAccess.js';

/**
 * Recording what somebody agreed to, and being able to prove it later.
 *
 * The model was already here and already tested. What was missing was the
 * parts that make it consent rather than a type: somewhere to store a
 * decision, a way to make one, and a rule about who may make it for whom.
 *
 * Every test below is about a claim the record has to be able to answer after
 * the fact — not about the HTTP shape.
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
  presignDownload: async () => 'https://objects.test.invalid/page?sig=abc',
  put: async () => undefined,
  get: async () => new Uint8Array(),
  exists: async () => true,
  delete: async () => undefined,
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

const decide = async (
  accountId: string,
  purpose: string,
  granted: boolean,
  noticeVersion = CURRENT_NOTICE_VERSION,
) =>
  app.inject({
    method: 'POST',
    url: `/v1/patients/${PATIENT}/consent`,
    headers: await auth(accountId),
    payload: { purpose, granted, noticeVersion },
  });

const read = async (accountId: string) =>
  app.inject({
    method: 'GET',
    url: `/v1/patients/${PATIENT}/consent`,
    headers: await auth(accountId),
  });

type ConsentView = {
  consent: {
    purpose: string;
    granted: boolean;
    needsReconsent: boolean;
    onBehalfOfPatient: boolean;
    decidedBy: string | null;
  }[];
};

const forPurpose = (body: ConsentView, purpose: string) =>
  body.consent.find((entry) => entry.purpose === purpose);

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

describe('what a record has agreed to', () => {
  /**
   * The default, and the one that matters most: nothing has been decided, so
   * nothing is permitted. A missing row must never read as agreement.
   */
  it('permits nothing before anybody has answered', async () => {
    const body = (await read('acc_alice')).json() as ConsentView;

    expect(body.consent.every((entry) => entry.granted === false)).toBe(true);
    expect(body.consent.every((entry) => entry.needsReconsent === true)).toBe(true);
  });

  it('keeps the three purposes separate', async () => {
    await decide('acc_alice', 'storage', true);

    const body = (await read('acc_alice')).json() as ConsentView;

    expect(forPurpose(body, 'storage')?.granted).toBe(true);
    // Agreeing to be a customer is not agreeing to be summarised.
    expect(forPurpose(body, 'ai_processing')?.granted).toBe(false);
    expect(forPurpose(body, 'family_sharing')?.granted).toBe(false);
  });

  it('records who decided, and stops asking once they have', async () => {
    await decide('acc_alice', 'ai_processing', true);

    const entry = forPurpose((await read('acc_alice')).json() as ConsentView, 'ai_processing');

    expect(entry).toMatchObject({ granted: true, needsReconsent: false, decidedBy: 'acc_alice' });
  });

  it('says what withdrawing would actually do', async () => {
    const body = (await read('acc_alice')).json() as {
      consent: { purpose: string; withdrawalEffect: string }[];
    };

    expect(body.consent.find((entry) => entry.purpose === 'ai_processing')?.withdrawalEffect)
      .toContain('cannot be recalled');
  });
});

describe('changing your mind', () => {
  it('takes the most recent answer', async () => {
    await decide('acc_alice', 'ai_processing', true);
    await decide('acc_alice', 'ai_processing', false);

    expect(forPurpose((await read('acc_alice')).json() as ConsentView, 'ai_processing')?.granted)
      .toBe(false);
  });

  /**
   * The property the whole design rests on. After a withdrawal, "did they ever
   * agree, and when?" still has an answer — otherwise nobody can review what
   * was processed while the agreement stood.
   */
  it('keeps the earlier decision in the history', async () => {
    await decide('acc_alice', 'ai_processing', true);
    await decide('acc_alice', 'ai_processing', false);

    const body = (
      await app.inject({
        method: 'GET',
        url: `/v1/patients/${PATIENT}/consent/history`,
        headers: await auth('acc_alice'),
      })
    ).json() as { history: { purpose: string; granted: boolean }[] };

    const ai = body.history.filter((record) => record.purpose === 'ai_processing');
    expect(ai.map((record) => record.granted)).toEqual([true, false]);
  });
});

describe('who may decide', () => {
  it('lets a manager answer for somebody who does not use the app', async () => {
    await invite('acc_manager', 'manager');

    expect((await decide('acc_manager', 'ai_processing', true)).statusCode).toBe(201);
  });

  /**
   * And says so. A caregiver agreeing on a parent's behalf is a different fact
   * from the parent agreeing, and the record has to be able to tell them apart.
   */
  it('marks a manager’s answer as given on the patient’s behalf', async () => {
    await invite('acc_manager', 'manager');
    await decide('acc_manager', 'ai_processing', true);

    expect(forPurpose((await read('acc_alice')).json() as ConsentView, 'ai_processing'))
      .toMatchObject({ onBehalfOfPatient: true, decidedBy: 'acc_manager' });
  });

  it('does not mark the record’s own answer that way', async () => {
    await decide('acc_alice', 'ai_processing', true);

    expect(
      forPurpose((await read('acc_alice')).json() as ConsentView, 'ai_processing')
        ?.onBehalfOfPatient,
    ).toBe(false);
  });

  /**
   * Uploading documents to a record is not the same power as agreeing that
   * those documents may be sent to a provider.
   */
  it('refuses a contributor', async () => {
    await invite('acc_helper', 'contributor');

    expect((await decide('acc_helper', 'ai_processing', true)).statusCode).toBe(403);
  });

  it('refuses a viewer', async () => {
    await invite('acc_watcher', 'viewer');

    expect((await decide('acc_watcher', 'ai_processing', true)).statusCode).toBe(403);
  });

  /** A viewer may still see what has been agreed — it is their record too. */
  it('lets a viewer read the current position', async () => {
    await invite('acc_watcher', 'viewer');

    expect((await read('acc_watcher')).statusCode).toBe(200);
  });

  it('tells a stranger nothing, including whether the record exists', async () => {
    expect((await read('acc_stranger')).statusCode).toBe(404);
    expect((await decide('acc_stranger', 'ai_processing', true)).statusCode).toBe(404);
  });
});

describe('the version somebody actually read', () => {
  it('stores the notice version with the decision', async () => {
    await decide('acc_alice', 'storage', true);

    const body = (
      await app.inject({
        method: 'GET',
        url: `/v1/patients/${PATIENT}/consent/history`,
        headers: await auth('acc_alice'),
      })
    ).json() as { history: { noticeVersion: string }[] };

    expect(body.history[0]?.noticeVersion).toBe(CURRENT_NOTICE_VERSION);
  });

  /**
   * A client showing yesterday's wording cannot record agreement to today's.
   * Refusing is the only answer that keeps the stored version meaningful.
   */
  it('refuses a decision made against wording that has since changed', async () => {
    const response = await decide('acc_alice', 'ai_processing', true, '2020-01-01.1');

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ noticeVersion: CURRENT_NOTICE_VERSION });
  });

  it('records nothing when the notice was stale', async () => {
    await decide('acc_alice', 'ai_processing', true, '2020-01-01.1');

    expect(await patients.listConsent(PATIENT)).toEqual([]);
  });
});

describe('the trail this leaves', () => {
  it('audits a decision without recording what the notice said', async () => {
    await decide('acc_alice', 'ai_processing', true);
    await decide('acc_alice', 'ai_processing', false);

    const entries = await patients.listAudit(PATIENT);
    const actions = entries.map((entry) => entry.action);

    expect(actions).toContain('consent_granted');
    expect(actions).toContain('consent_withdrawn');
    // Metadata only: the purpose, the verb, the actor. No wording, no content.
    expect(JSON.stringify(entries)).not.toContain('provider');
  });
});
