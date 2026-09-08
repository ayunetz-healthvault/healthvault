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
import type { JobQueue, ProcessingJob } from '../../src/services/queue/JobQueue.js';
import { inMemoryAccessRepository, inMemoryPatientRepository } from '../helpers/inMemoryAccess.js';

/**
 * The way back for a document nobody was allowed to read.
 *
 * A report that reached the worker without AI-processing consent ends at
 * `manual_review` with `ai_not_permitted`, and the worker will not pick it up
 * again — deliberately, because "no summary yet" and "no summary, by decision"
 * must not look the same on a screen. But consent is not a one-way door, and
 * before this endpoint existed the only way to get the summary you had just
 * agreed to was to delete the report and photograph it again.
 *
 * What this is careful about: the decision to send somebody's document to a
 * provider is a consent decision, so it takes `manage_consent` and refuses when
 * the answer is still no.
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
  keyFor: ({ patientId, documentId, page }) =>
    `patients/${patientId}/documents/${documentId}/pages/${String(page).padStart(3, '0')}`,
  presignUpload: async () => ({ key: 'k', url: 'u', expiresInSeconds: 900, headers: {} }),
  presignDownload: async () => 'https://objects.test.invalid/page',
  put: async () => undefined,
  get: async () => new Uint8Array(),
  exists: async () => true,
  delete: async () => undefined,
};

const PATIENT = 'pat_1';
const DOCUMENT = 'doc_1';
const NOW = '2026-09-08T10:00:00.000Z';

let app: FastifyInstance;
let access: ReturnType<typeof inMemoryAccessRepository>;
let patients: ReturnType<typeof inMemoryPatientRepository>;
let enqueued: ProcessingJob[];

const queue: JobQueue = {
  enqueue: async (job) => {
    enqueued.push(job);
  },
  receive: async () => [],
  acknowledge: async () => undefined,
};

const tokens = new Map<string, string>();
const auth = async (accountId: string): Promise<Record<string, string>> => {
  const existing = tokens.get(accountId);
  const token =
    existing ?? (await issuer.issueFor({ ownerId: accountId, email: `${accountId}@x.invalid` }));
  tokens.set(accountId, token);
  return { authorization: `Bearer ${token}` };
};

const invite = async (accountId: string, role: 'manager' | 'contributor'): Promise<void> => {
  const issued = await access.createInvitation({
    patientId: PATIENT,
    role,
    invitedBy: 'acc_alice',
    ttlSeconds: 3600,
  });
  await access.acceptInvitation(issued.token, accountId);
};

const agree = async (granted: boolean): Promise<void> => {
  await patients.appendConsent({
    patientId: PATIENT,
    purpose: 'ai_processing',
    granted,
    decidedBy: 'acc_alice',
    decidedAt: '2026-09-08T11:00:00.000Z',
    noticeVersion: CURRENT_NOTICE_VERSION,
    onBehalfOfPatient: false,
  });
};

const resume = async (accountId: string) =>
  app.inject({
    method: 'POST',
    url: `/v1/patients/${PATIENT}/documents/${DOCUMENT}/processing/resume`,
    headers: await auth(accountId),
  });

beforeEach(async () => {
  access = inMemoryAccessRepository();
  patients = inMemoryPatientRepository();
  enqueued = [];
  app = buildApp({
    stack: loadStackConfig(),
    identity,
    verifier,
    access,
    patients,
    objects,
    queue,
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
  await patients.putDocument(PATIENT, {
    documentId: DOCUMENT,
    parentId: PATIENT,
    title: 'Kidney panel',
    category: 'lab_report',
    documentDate: '2026-09-01',
    pageCount: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  // Where the worker leaves a document nobody had agreed to have summarised.
  await patients.putProcessing(PATIENT, {
    documentId: DOCUMENT,
    status: 'manual_review',
    attempts: 1,
    failureCode: 'ai_not_permitted',
    updatedAt: NOW,
  });
  await access.createSelfGrant(PATIENT, 'acc_alice');
});

afterAll(async () => {
  await app?.close();
});

describe('asking again once consent is given', () => {
  it('queues the document and says so', async () => {
    await agree(true);

    const response = await resume('acc_alice');

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ processing: { status: 'queued' } });
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ patientId: PATIENT, documentId: DOCUMENT });
  });

  /**
   * From zero. The attempt budget exists to stop a document that keeps failing
   * from costing an OCR run every time; a new decision is not another attempt
   * at the same failure.
   */
  it('starts the attempt count again', async () => {
    await agree(true);

    await resume('acc_alice');

    expect(await patients.getProcessing(PATIENT, DOCUMENT)).toMatchObject({ attempts: 0 });
  });

  it('records who asked', async () => {
    await agree(true);

    await resume('acc_alice');

    expect((await patients.listAudit(PATIENT)).map((entry) => entry.action)).toContain(
      'processing_resumed',
    );
  });
});

describe('asking again when the answer is still no', () => {
  it('refuses rather than queueing a job the worker would discard', async () => {
    const response = await resume('acc_alice');

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'ai_not_permitted' });
    expect(enqueued).toEqual([]);
  });

  it('refuses after consent was withdrawn again', async () => {
    await agree(true);
    await patients.appendConsent({
      patientId: PATIENT,
      purpose: 'ai_processing',
      granted: false,
      decidedBy: 'acc_alice',
      decidedAt: '2026-09-08T12:00:00.000Z',
      noticeVersion: CURRENT_NOTICE_VERSION,
      onBehalfOfPatient: false,
    });

    expect((await resume('acc_alice')).statusCode).toBe(409);
  });
});

describe('who may ask', () => {
  it('lets a manager, who may answer consent questions', async () => {
    await agree(true);
    await invite('acc_helper', 'manager');

    expect((await resume('acc_helper')).statusCode).toBe(202);
  });

  /**
   * A contributor may add documents to a record. Deciding that those documents
   * may be sent to a language model is a different power, and this is that
   * decision being acted on.
   */
  it('refuses a contributor', async () => {
    await agree(true);
    await invite('acc_helper', 'contributor');

    expect((await resume('acc_helper')).statusCode).toBe(403);
    expect(enqueued).toEqual([]);
  });
});

describe('documents that are not waiting on a decision', () => {
  it('refuses one that failed OCR, rather than paying for the same failure again', async () => {
    await agree(true);
    await patients.putProcessing(PATIENT, {
      documentId: DOCUMENT,
      status: 'manual_review',
      attempts: 3,
      failureCode: 'ocr_failed',
      updatedAt: NOW,
    });

    const response = await resume('acc_alice');

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'not_waiting_on_consent' });
    expect(enqueued).toEqual([]);
  });

  it('refuses one that already has its summary', async () => {
    await agree(true);
    await patients.putProcessing(PATIENT, {
      documentId: DOCUMENT,
      status: 'ready',
      attempts: 1,
      updatedAt: NOW,
    });

    expect((await resume('acc_alice')).statusCode).toBe(409);
  });

  it('is a 404 for a document that does not exist', async () => {
    await agree(true);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/patients/${PATIENT}/documents/doc_missing/processing/resume`,
      headers: await auth('acc_alice'),
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('a record being erased', () => {
  it('cannot be resumed into', async () => {
    await agree(true);
    await patients.beginDeletion({
      patientId: PATIENT,
      requestedByAccountId: 'acc_alice',
      requestedAt: NOW,
    });

    expect((await resume('acc_alice')).statusCode).toBe(410);
    expect(enqueued).toEqual([]);
  });
});
