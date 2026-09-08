import type { FastifyInstance } from 'fastify';
import { createLocalJWKSet } from 'jose';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadIdentityConfig } from '../../src/config/identity.js';
import { loadStackConfig } from '../../src/config/stack.js';
import { CURRENT_NOTICE_VERSION } from '../../src/services/consent/policy.js';
import { createLocalIssuer } from '../../src/services/identity/localIssuer.js';
import { createTokenVerifier } from '../../src/services/identity/TokenVerifier.js';
import type { ObjectStore } from '../../src/services/objects/ObjectStore.js';
import { inMemoryAccessRepository, inMemoryPatientRepository } from '../helpers/inMemoryAccess.js';

/**
 * Getting data out, and getting it deleted.
 *
 * Both are per record, because a record is shared and each one has its own
 * answer about who may read it. The tests below are mostly about the two ways
 * that goes wrong: an export that hands over more than the caller could see on
 * screen, and a deletion that leaves something behind — bytes, grants, or a
 * record nobody can reach any more.
 */

const identity = loadIdentityConfig('local', 'ap-south-1', {
  AYUNETZ_IDENTITY_ISSUER: 'http://localhost:4000/local-identity',
  AYUNETZ_IDENTITY_AUDIENCE: 'ayunetz-local-app',
});

const issuer = createLocalIssuer(identity, 'local');
const verifier = createTokenVerifier(identity, createLocalJWKSet(await issuer.jwks()));

const silent = (): NodeJS.WritableStream =>
  ({ write: () => true }) as unknown as NodeJS.WritableStream;

const deleted: string[] = [];

const objects: ObjectStore = {
  keyFor: ({ patientId, documentId, page }) =>
    `patients/${patientId}/documents/${documentId}/pages/${String(page).padStart(3, '0')}`,
  presignUpload: async () => ({ key: 'k', url: 'u', expiresInSeconds: 900, headers: {} }),
  presignDownload: async ({ page }) => `https://objects.test.invalid/page-${page}?sig=abc`,
  put: async () => undefined,
  get: async () => new Uint8Array(),
  exists: async () => true,
  delete: vi.fn(async (key: string) => {
    deleted.push(key);
  }),
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
  patientId = PATIENT,
): Promise<void> => {
  const issued = await access.createInvitation({
    patientId,
    role,
    invitedBy: 'acc_alice',
    ttlSeconds: 3600,
  });
  await access.acceptInvitation(issued.token, accountId);
};

const seedRecord = async (patientId: string, fullName: string): Promise<void> => {
  await patients.putPatient({
    patientId,
    fullName,
    relationship: 'mother',
    createdByAccountId: 'acc_alice',
    createdAt: NOW,
    updatedAt: NOW,
  });
  await patients.putDocument(patientId, {
    documentId: 'doc_1',
    parentId: patientId,
    title: 'Blood test report',
    category: 'lab_report',
    documentDate: '2026-09-01',
    pageCount: 2,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await patients.putProcessing(patientId, {
    documentId: 'doc_1',
    status: 'ready',
    attempts: 1,
    updatedAt: NOW,
  });
  await patients.putSummary(patientId, {
    documentId: 'doc_1',
    summary: { overview: 'Stable.' },
    pipelineVersion: 'redaction-v1',
    createdAt: NOW,
    corrections: [
      {
        correctionId: 'cor_1',
        field: 'findings.0.value',
        previousValue: '142',
        correctedValue: '124',
        correctedBy: 'acc_alice',
        correctedAt: NOW,
        summaryVersion: 1,
      },
    ],
  });
  await patients.appendConsent({
    patientId,
    purpose: 'ai_processing',
    granted: true,
    decidedBy: 'acc_alice',
    decidedAt: NOW,
    noticeVersion: CURRENT_NOTICE_VERSION,
    onBehalfOfPatient: false,
  });
};

const exportRecord = async (accountId: string, patientId = PATIENT) =>
  app.inject({
    method: 'GET',
    url: `/v1/patients/${patientId}/export`,
    headers: await auth(accountId),
  });

const deleteRecord = async (accountId: string, confirmName: string, patientId = PATIENT) =>
  app.inject({
    method: 'DELETE',
    url: `/v1/patients/${patientId}`,
    headers: await auth(accountId),
    payload: { confirmName },
  });

beforeEach(async () => {
  deleted.length = 0;
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

  await seedRecord(PATIENT, 'Meera Nair');
  await access.createSelfGrant(PATIENT, 'acc_alice');
});

afterAll(async () => {
  await app?.close();
});

describe('exporting one record', () => {
  it('includes the documents, summaries, consent and audit', async () => {
    const body = (await exportRecord('acc_alice')).json() as {
      record: {
        documents: unknown[];
        summaries: unknown[];
        consent: unknown[];
        audit: unknown[];
      };
    };

    expect(body.record.documents).toHaveLength(1);
    expect(body.record.summaries).toHaveLength(1);
    expect(body.record.consent).toHaveLength(1);
    expect(body.record.audit.length).toBeGreaterThan(0);
  });

  /**
   * A correction is part of the record. An export with the model's output and
   * none of what people said about it is a misleading account of what this
   * record actually contains.
   */
  it('includes what people corrected, not only what the model produced', async () => {
    const body = (await exportRecord('acc_alice')).json() as {
      record: { summaries: { corrections?: { correctedValue: string }[] }[] };
    };

    expect(body.record.summaries[0]?.corrections?.[0]?.correctedValue).toBe('124');
  });

  it('says what access it was produced under', async () => {
    await invite('acc_watcher', 'viewer');

    const body = (await exportRecord('acc_watcher')).json() as { exportedUnderRole: string };

    expect(body.exportedUnderRole).toBe('viewer');
  });

  /** A URL that expires must say so, not be discovered stale a week later. */
  it('says the page links expire', async () => {
    const body = (await exportRecord('acc_alice')).json() as {
      record: { pages: unknown[]; pageUrlsExpireInSeconds: number };
    };

    expect(body.record.pages).toHaveLength(2);
    expect(body.record.pageUrlsExpireInSeconds).toBeGreaterThan(0);
  });

  it('records that the export happened', async () => {
    await exportRecord('acc_alice');

    expect((await patients.listAudit(PATIENT)).map((entry) => entry.action)).toContain(
      'record_exported',
    );
  });

  it('tells a stranger nothing, including whether the record exists', async () => {
    expect((await exportRecord('acc_stranger')).statusCode).toBe(404);
  });
});

describe('exporting everything an account can reach', () => {
  /**
   * The property that makes this safe: the export is assembled record by
   * record through the same grant check, so it can never contain a record the
   * account could not open on screen.
   */
  it('contains exactly the records the account holds a grant on', async () => {
    await seedRecord('pat_2', 'Ravi Nair');
    await access.createSelfGrant('pat_2', 'acc_bob');
    await invite('acc_helper', 'viewer');

    const body = (
      await app.inject({
        method: 'POST',
        url: '/v1/account/export-request',
        headers: await auth('acc_helper'),
      })
    ).json() as { records: { patientId: string; role: string }[] };

    expect(body.records.map((entry) => entry.patientId)).toEqual([PATIENT]);
    expect(body.records[0]?.role).toBe('viewer');
  });

  it('is empty for an account with no records', async () => {
    const body = (
      await app.inject({
        method: 'POST',
        url: '/v1/account/export-request',
        headers: await auth('acc_nobody'),
      })
    ).json() as { records: unknown[] };

    expect(body.records).toEqual([]);
  });
});

describe('deleting a record', () => {
  it('removes every row and every page', async () => {
    const response = await deleteRecord('acc_alice', 'Meera Nair');

    expect(response.statusCode).toBe(200);
    expect(await patients.getPatient(PATIENT)).toBeNull();
    expect(await patients.listDocuments(PATIENT)).toEqual([]);
    expect(await patients.getSummary(PATIENT, 'doc_1')).toBeNull();
    // Both pages, by key, before the rows that name them were removed.
    expect(deleted).toHaveLength(2);
  });

  it('revokes everybody’s access, so nobody holds a key to nothing', async () => {
    await invite('acc_helper', 'manager');

    await deleteRecord('acc_alice', 'Meera Nair');

    expect((await access.getGrant(PATIENT, 'acc_helper'))?.status).toBe('revoked');
  });

  /** Copies on other phones go when those phones next connect, and it says so. */
  it('does not claim the data is gone from other devices', async () => {
    const body = (await deleteRecord('acc_alice', 'Meera Nair')).json() as { note: string };

    expect(body.note).toMatch(/next time each device connects/i);
  });

  /**
   * The one irreversible action in the app. A mis-tap is the likeliest way
   * somebody loses a parent's entire history, so the name has to be typed.
   */
  it('refuses when the typed name does not match', async () => {
    const response = await deleteRecord('acc_alice', 'Meena Nair');

    expect(response.statusCode).toBe(400);
    expect(await patients.getPatient(PATIENT)).not.toBeNull();
  });

  /**
   * A manager runs a record; they do not own the person it describes, and the
   * caregiver who created a profile does not get to erase a medical history.
   */
  it('refuses a manager', async () => {
    await invite('acc_helper', 'manager');

    expect((await deleteRecord('acc_helper', 'Meera Nair')).statusCode).toBe(403);
    expect(await patients.getPatient(PATIENT)).not.toBeNull();
  });

  it('refuses a contributor and a viewer', async () => {
    await invite('acc_helper', 'contributor');
    await invite('acc_watcher', 'viewer');

    expect((await deleteRecord('acc_helper', 'Meera Nair')).statusCode).toBe(403);
    expect((await deleteRecord('acc_watcher', 'Meera Nair')).statusCode).toBe(403);
  });
});

describe('deleting an account', () => {
  const requestDeletion = async (accountId: string) =>
    app.inject({
      method: 'POST',
      url: '/v1/account/deletion-request',
      headers: await auth(accountId),
    });

  /**
   * Refusing is the right answer. Revoking silently would leave a record with
   * nobody who can reach it — including nobody who can delete it — and deleting
   * it unasked would destroy somebody's medical history on the strength of a
   * different request.
   */
  it('refuses when a record would be left with nobody', async () => {
    const response = await requestDeletion('acc_alice');

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'records_would_be_stranded',
      details: { patientIds: [PATIENT] },
    });
  });

  it('names the records, so they can be handed over first', async () => {
    const body = (await requestDeletion('acc_alice')).json() as {
      details: { patientIds: string[] };
    };

    expect(body.details.patientIds).toEqual([PATIENT]);
  });

  it('removes a helper’s access without touching the record', async () => {
    await invite('acc_helper', 'contributor');

    const response = await requestDeletion('acc_helper');

    expect(response.statusCode).toBe(200);
    expect((await access.getGrant(PATIENT, 'acc_helper'))?.status).toBe('revoked');
    expect(await patients.getPatient(PATIENT)).not.toBeNull();
  });

  /**
   * The sign-in itself belongs to the identity provider. Claiming to have
   * deleted it would be a promise this service cannot keep.
   */
  it('does not claim to have deleted the sign-in', async () => {
    await invite('acc_helper', 'contributor');

    const body = (await requestDeletion('acc_helper')).json() as { note: string };

    expect(body.note).toMatch(/identity provider/i);
  });

  it('leaves a trail on each record it left', async () => {
    await invite('acc_helper', 'contributor');
    await requestDeletion('acc_helper');

    expect((await patients.listAudit(PATIENT)).map((entry) => entry.action)).toContain(
      'access_removed_on_account_deletion',
    );
  });
});
