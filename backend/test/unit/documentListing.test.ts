import type { FastifyInstance } from 'fastify';
import { createLocalJWKSet } from 'jose';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadIdentityConfig } from '../../src/config/identity.js';
import { loadStackConfig } from '../../src/config/stack.js';
import { createLocalIssuer } from '../../src/services/identity/localIssuer.js';
import { createTokenVerifier } from '../../src/services/identity/TokenVerifier.js';
import type { ObjectStore } from '../../src/services/objects/ObjectStore.js';
import type { ProcessingStatus } from '../../src/services/records/RecordRepository.js';
import { inMemoryAccessRepository, inMemoryPatientRepository } from '../helpers/inMemoryAccess.js';

/**
 * What the document list tells a device that did not upload the document.
 *
 * It used to tell it only the metadata — title, category, date — and the mobile
 * app filled in the rest by assuming every document it had not uploaded itself
 * was finished. That assumption is gone, and it can only stay gone if the list
 * actually carries the processing state and whether a summary exists.
 *
 * The two fields are separate on purpose: a status of `ready` is the pipeline's
 * claim, and `hasSummary` is whether there is anything behind it. They disagree
 * only when something is wrong, which is exactly when a client needs to know.
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

const addDocument = async (
  documentId: string,
  processing: { status: ProcessingStatus; failureCode?: string } | null,
  withSummary = false,
): Promise<void> => {
  await patients.putDocument(PATIENT, {
    documentId,
    parentId: PATIENT,
    title: documentId,
    category: 'lab_report',
    documentDate: '2026-09-01',
    pageCount: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });

  if (processing !== null) {
    await patients.putProcessing(PATIENT, {
      documentId,
      status: processing.status,
      attempts: 1,
      ...(processing.failureCode === undefined ? {} : { failureCode: processing.failureCode }),
      updatedAt: NOW,
    });
  }

  if (withSummary) {
    await patients.putSummary(PATIENT, {
      documentId,
      summary: { overview: 'Stable.' },
      pipelineVersion: 'redaction-v1',
      createdAt: NOW,
    });
  }
};

const list = async (accountId: string) =>
  app.inject({
    method: 'GET',
    url: `/v1/patients/${PATIENT}/documents`,
    headers: await auth(accountId),
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

describe('listing documents', () => {
  it('reports each document’s processing state', async () => {
    await addDocument('doc_queued', { status: 'queued' });
    await addDocument('doc_working', { status: 'processing' });
    await addDocument('doc_failed', { status: 'failed', failureCode: 'ocr_failed' });

    const body = (await list('acc_alice')).json() as {
      documents: { documentId: string; processing: { status: string } | null }[];
    };

    const states = new Map(
      body.documents.map((document) => [document.documentId, document.processing?.status]),
    );

    expect(states.get('doc_queued')).toBe('queued');
    expect(states.get('doc_working')).toBe('processing');
    expect(states.get('doc_failed')).toBe('failed');
  });

  it('sends the failure code and never a message', async () => {
    await addDocument('doc_failed', { status: 'failed', failureCode: 'ocr_failed' });

    const body = (await list('acc_alice')).json() as {
      documents: { processing: Record<string, unknown> | null }[];
    };

    expect(body.documents[0]?.processing).toMatchObject({ failureCode: 'ocr_failed' });
    // Nothing that could carry text read off the page.
    expect(JSON.stringify(body)).not.toContain('message');
  });

  it('says whether a summary exists', async () => {
    await addDocument('doc_done', { status: 'ready' }, true);
    await addDocument('doc_manual', { status: 'manual_review' });

    const body = (await list('acc_alice')).json() as {
      documents: { documentId: string; hasSummary: boolean }[];
    };

    const summaries = new Map(
      body.documents.map((document) => [document.documentId, document.hasSummary]),
    );

    expect(summaries.get('doc_done')).toBe(true);
    expect(summaries.get('doc_manual')).toBe(false);
  });

  /**
   * A document created but never uploaded has no processing row at all. Null is
   * the honest answer; anything else would be the server making the same guess
   * the client used to make.
   */
  it('reports no state rather than inventing one', async () => {
    await addDocument('doc_new', null);

    const body = (await list('acc_alice')).json() as {
      documents: { processing: unknown; hasSummary: boolean }[];
    };

    expect(body.documents[0]?.processing).toBeNull();
    expect(body.documents[0]?.hasSummary).toBe(false);
  });

  it('is still refused to an account with no grant', async () => {
    await addDocument('doc_done', { status: 'ready' }, true);

    expect((await list('acc_stranger')).statusCode).toBe(404);
  });
});
