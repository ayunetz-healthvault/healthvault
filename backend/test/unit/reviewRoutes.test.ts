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
 * Checking a summary against the original, and correcting it.
 *
 * The properties under test are the ones that keep three different things
 * apart: what the clinician wrote, what the model read, and what a person said
 * instead. Collapsing any two loses the ability to answer the question that
 * matters after a mistake — was the model wrong, or was the corrector?
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
  presignDownload: async ({ page }) => `https://objects.test.invalid/page-${page}?sig=abc`,
  put: async () => undefined,
  get: async () => new Uint8Array(),
  exists: async () => true,
  delete: async () => undefined,
  prefixFor: (patientId: string) => `patients/${patientId}/`,
  deletePrefix: async () => ({ objects: 0 }),
};

const PATIENT = 'pat_1';
const DOCUMENT = 'doc_1';

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

const seed = async (summaryPatch: Record<string, unknown> = {}): Promise<void> => {
  const now = '2026-09-08T10:00:00.000Z';
  await patients.putPatient({
    patientId: PATIENT,
    fullName: 'Meera Nair',
    relationship: 'mother',
    createdByAccountId: 'acc_alice',
    createdAt: now,
    updatedAt: now,
  });
  await patients.putDocument(PATIENT, {
    documentId: DOCUMENT,
    parentId: PATIENT,
    title: 'Blood test report',
    category: 'lab_report',
    documentDate: '2026-09-01',
    pageCount: 2,
    createdAt: now,
    updatedAt: now,
  });
  await patients.putSummary(PATIENT, {
    documentId: DOCUMENT,
    summary: { overview: 'Fasting blood sugar 142 mg/dL' },
    pipelineVersion: 'redaction-v1',
    createdAt: now,
    version: 1,
    ...summaryPatch,
  });
  await access.createSelfGrant(PATIENT, 'acc_alice');
};

const invite = async (accountId: string, role: 'contributor' | 'viewer'): Promise<void> => {
  const issued = await access.createInvitation({
    patientId: PATIENT,
    role,
    invitedBy: 'acc_alice',
    ttlSeconds: 3600,
  });
  await access.acceptInvitation(issued.token, accountId);
};

const correct = async (accountId: string, summaryVersion = 1) =>
  app.inject({
    method: 'POST',
    url: `/v1/patients/${PATIENT}/documents/${DOCUMENT}/corrections`,
    headers: await auth(accountId),
    payload: {
      field: 'findings.0.value',
      previousValue: '142 mg/dL',
      correctedValue: '124 mg/dL',
      summaryVersion,
    },
  });

const review = async (accountId: string, summaryVersion = 1) =>
  app.inject({
    method: 'POST',
    url: `/v1/patients/${PATIENT}/documents/${DOCUMENT}/review`,
    headers: await auth(accountId),
    payload: { summaryVersion },
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
  await seed();
});

afterAll(async () => {
  await app?.close();
});

describe('reading the original', () => {
  it('offers a URL for every page', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/patients/${PATIENT}/documents/${DOCUMENT}/pages`,
      headers: await auth('acc_alice'),
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as { pages: { page: number }[] }).pages.map((p) => p.page)).toEqual([
      1, 2,
    ]);
  });

  /**
   * A signed URL is a bearer token that keeps working after the grant behind it
   * is withdrawn, so reading gets minutes rather than the fifteen an upload
   * needs over a bad connection.
   */
  it('makes the URL short-lived', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/patients/${PATIENT}/documents/${DOCUMENT}/pages`,
      headers: await auth('acc_alice'),
    });

    const [first] = (response.json() as { pages: { expiresInSeconds: number }[] }).pages;
    expect(first?.expiresInSeconds).toBeLessThanOrEqual(600);
  });

  it('gives nothing to an account with no grant', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/patients/${PATIENT}/documents/${DOCUMENT}/pages`,
      headers: await auth('acc_mallory'),
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('http');
  });

  it('lets a read-only helper look at the original', async () => {
    await invite('acc_bob', 'viewer');

    const response = await app.inject({
      method: 'GET',
      url: `/v1/patients/${PATIENT}/documents/${DOCUMENT}/pages`,
      headers: await auth('acc_bob'),
    });

    expect(response.statusCode).toBe(200);
  });
});

describe('correcting a summary', () => {
  it('appends the correction and leaves the model’s output alone', async () => {
    const response = await correct('acc_alice');

    expect(response.statusCode).toBe(201);
    const summary = await patients.getSummary(PATIENT, DOCUMENT);
    expect(summary?.summary).toEqual({ overview: 'Fasting blood sugar 142 mg/dL' });
    expect(summary?.corrections).toHaveLength(1);
  });

  it('records who corrected it, when, and what it said before', async () => {
    await correct('acc_alice');

    const [correction] = (await patients.getSummary(PATIENT, DOCUMENT))?.corrections ?? [];
    expect(correction).toMatchObject({
      correctedBy: 'acc_alice',
      previousValue: '142 mg/dL',
      correctedValue: '124 mg/dL',
      summaryVersion: 1,
    });
    expect(correction?.correctedAt).toBeTruthy();
  });

  /** Changing your mind is another entry, not an edit. */
  it('keeps every correction, never rewriting an earlier one', async () => {
    await correct('acc_alice');
    await correct('acc_alice');

    expect((await patients.getSummary(PATIENT, DOCUMENT))?.corrections).toHaveLength(2);
  });

  /**
   * A correction typed against version 1 must not land on a version 2 the
   * corrector never saw — the pipeline may have re-read the page and produced
   * entirely different text.
   */
  it('refuses a correction made against an older version', async () => {
    const summary = await patients.getSummary(PATIENT, DOCUMENT);
    await patients.putSummary(PATIENT, { ...summary!, version: 2 });

    const response = await correct('acc_alice', 1);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'summary_changed' });
  });

  it('lets a contributor correct, and refuses a read-only helper', async () => {
    await invite('acc_bob', 'contributor');
    await invite('acc_carol', 'viewer');

    expect((await correct('acc_bob')).statusCode).toBe(201);
    expect((await correct('acc_carol')).statusCode).toBe(403);
  });

  it('refuses an account with no grant, without saying the document exists', async () => {
    const response = await correct('acc_mallory');

    expect(response.statusCode).toBe(404);
  });

  /** A corrected value is clinical text and has no business in an audit row. */
  it('audits the field that changed, never the value', async () => {
    await correct('acc_alice');

    const entries = await patients.listAudit(PATIENT);
    const serialised = JSON.stringify(entries);
    expect(serialised).toContain('findings.0.value');
    expect(serialised).not.toContain('124 mg/dL');
    expect(serialised).not.toContain('142 mg/dL');
  });
});

describe('marking a summary checked', () => {
  it('records who checked it and which version', async () => {
    const response = await review('acc_alice');

    expect(response.statusCode).toBe(200);
    expect(await patients.getSummary(PATIENT, DOCUMENT)).toMatchObject({
      reviewedBy: 'acc_alice',
      reviewedVersion: 1,
    });
  });

  /**
   * "Checked against the original" is not "a clinician says this is right", and
   * a field name is exactly the kind of thing that reaches a UI label unchanged.
   */
  it('never calls the result verified or approved', async () => {
    const response = await review('acc_alice');

    const body = response.body.toLowerCase();
    expect(body).not.toContain('verified');
    expect(body).not.toContain('approved');
    expect(body).not.toContain('confirmed');
  });

  it('refuses a review of a version that is no longer current', async () => {
    const summary = await patients.getSummary(PATIENT, DOCUMENT);
    await patients.putSummary(PATIENT, { ...summary!, version: 3 });

    expect((await review('acc_alice', 1)).statusCode).toBe(409);
  });

  /**
   * A re-run producing new text leaves the record visibly unchecked rather than
   * carrying a tick earned on something else.
   */
  it('leaves a newer version unreviewed', async () => {
    await review('acc_alice', 1);
    const reviewed = await patients.getSummary(PATIENT, DOCUMENT);

    await patients.putSummary(PATIENT, { ...reviewed!, version: 2 });
    const current = await patients.getSummary(PATIENT, DOCUMENT);

    expect(current?.reviewedVersion).toBe(1);
    expect(current?.version).toBe(2);
  });

  it('refuses a read-only helper', async () => {
    await invite('acc_bob', 'viewer');

    expect((await review('acc_bob')).statusCode).toBe(403);
  });
});
