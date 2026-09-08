import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadIdentityConfig } from '../../src/config/identity.js';
import { loadStackConfig } from '../../src/config/stack.js';
import { createAccessRepository } from '../../src/services/access/AccessRepository.js';
import { initialiseLocalStack } from '../../src/services/localStack/initialise.js';
import { createObjectStore } from '../../src/services/objects/ObjectStore.js';
import { createJobQueue } from '../../src/services/queue/JobQueue.js';
import { createPatientRecordRepository } from '../../src/services/records/PatientRecordRepository.js';

/**
 * The `/v1` API against the running local stack.
 *
 * Everything below goes through the real ports — a real object store, a real
 * queue, real DynamoDB semantics — with a real token. This is the first point
 * at which the ports are exercised together as the thing the app will actually
 * talk to.
 *
 * Rewritten for ADR-005: every route now names the patient, and a grant is
 * checked before anything is read, written or signed.
 */
const stack = loadStackConfig();
const identity = loadIdentityConfig('local', stack.region, {
  AYUNETZ_IDENTITY_ISSUER: 'http://localhost:4000/local-identity',
});

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

const silent = (): NodeJS.WritableStream =>
  ({ write: () => true }) as unknown as NodeJS.WritableStream;

describe.skipIf(!up)('the /v1 API', () => {
  let app: FastifyInstance;
  let aliceToken: string;
  let bobToken: string;

  const objects = createObjectStore(stack);

  const buildTestApp = (): FastifyInstance =>
    buildApp({
      stack,
      identity,
      access: createAccessRepository(stack),
      patients: createPatientRecordRepository(stack),
      objects,
      queue: createJobQueue(stack),
      logStream: silent(),
    });

  beforeAll(async () => {
    await initialiseLocalStack(stack);
    app = buildTestApp();
    await app.ready();

    const run = Date.now().toString(36);
    aliceToken = await token(`acc_alice_${run}`);
    bobToken = await token(`acc_bob_${run}`);
  });

  afterAll(async () => {
    await app.close();
  });

  const token = async (ownerId: string): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/local-identity/token',
      payload: { ownerId },
    });
    return (JSON.parse(response.body) as { token: string }).token;
  };

  const as = (bearer: string) => ({ authorization: `Bearer ${bearer}` });

  const createPatient = async (
    bearer: string,
    subject: 'me' | 'someone_else' = 'someone_else',
    fullName = 'Lakshmi Iyer',
  ): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/patients',
      headers: as(bearer),
      payload: { fullName, relationship: 'mother', city: 'Chennai', subject },
    });
    return (JSON.parse(response.body) as { patient: { patientId: string } }).patient.patientId;
  };

  const createDocument = async (
    bearer: string,
    patientId: string,
    pageCount = 1,
  ): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/patients/${patientId}/documents`,
      headers: as(bearer),
      payload: {
        title: 'Diabetes panel',
        category: 'lab_report',
        documentDate: '2026-03-14',
        pageCount,
      },
    });
    return (JSON.parse(response.body) as { document: { documentId: string } }).document.documentId;
  };

  interface Upload {
    page: number;
    key: string;
    url: string;
    headers: Record<string, string>;
  }

  const presign = async (
    bearer: string,
    patientId: string,
    documentId: string,
    pageCount: number,
  ): Promise<Upload[]> => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/patients/${patientId}/documents/${documentId}/uploads`,
      headers: as(bearer),
      payload: {
        pages: Array.from({ length: pageCount }, (_, index) => ({
          page: index + 1,
          contentType: 'image/jpeg' as const,
        })),
      },
    });
    expect(response.statusCode).toBe(200);
    return (JSON.parse(response.body) as { uploads: Upload[] }).uploads;
  };

  const putPage = async (upload: Upload): Promise<void> => {
    const response = await fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers,
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    });
    expect(response.ok).toBe(true);
  };

  /**
   * The check that catches the easiest possible mistake.
   *
   * Forgetting a `preHandler` looks exactly like working code, and what it
   * exposes is one family's medical records to anyone who can guess a URL. The
   * app refuses to boot in that case; this proves every route that exists right
   * now is covered, rather than trusting the guard was wired correctly.
   */
  describe('every /v1 route', () => {
    const routes: { method: string; url: string }[] = [];

    beforeAll(async () => {
      const collector = buildTestApp();
      collector.addHook('onRoute', (route) => {
        if (!route.url.startsWith('/v1')) return;
        const methods = Array.isArray(route.method) ? route.method : [route.method];
        for (const method of methods) {
          if (method !== 'HEAD') routes.push({ method, url: route.url });
        }
      });
      await collector.ready();
      await collector.close();
    });

    it('is registered, and there are several', () => {
      expect(routes.length).toBeGreaterThanOrEqual(12);
    });

    it('refuses a request with no token', async () => {
      const answered = await Promise.all(
        routes.map(async ({ method, url }) => {
          const response = await app.inject({
            method: method as 'GET',
            // Any id will do: authentication runs before the handler sees it.
            url: url.replace(/:[A-Za-z]+/g, 'anything'),
            payload: {},
          });
          return { method, url, statusCode: response.statusCode };
        }),
      );

      expect(answered.filter((entry) => entry.statusCode !== 401)).toEqual([]);
    });
  });

  /**
   * The guard itself, rather than its effect.
   *
   * Everything above assumes the app refuses to boot when a `/v1` route has no
   * authentication. This is that assumption tested: without it, the suite above
   * would only be proving that the routes which *do* have a preHandler have one.
   */
  describe('the boot-time guard', () => {
    const buildWith = async (register: (app: FastifyInstance) => void): Promise<Error | null> => {
      const candidate = buildTestApp();

      try {
        // The guard is installed synchronously, so an offending route throws
        // here rather than at `ready()`. Both are caught: what matters is that
        // the process does not come up serving it.
        register(candidate);
        await candidate.ready();
        await candidate.close();
        return null;
      } catch (error) {
        return error as Error;
      }
    };

    it('refuses to start when a /v1 route has no authentication', async () => {
      const error = await buildWith((candidate) => {
        candidate.get('/v1/oops', async () => ({ leaked: true }));
      });

      expect(error?.message).toMatch(/no authentication/i);
      expect(error?.message).toContain('/v1/oops');
    });

    it('refuses a /v1 route whose preHandler is something else entirely', async () => {
      const error = await buildWith((candidate) => {
        candidate.get(
          '/v1/oops',
          { preHandler: async () => undefined },
          async () => ({ leaked: true }),
        );
      });

      expect(error?.message).toMatch(/no authentication/i);
    });

    it('accepts a /v1 route that declares it', async () => {
      const error = await buildWith((candidate) => {
        candidate.get('/v1/fine', { preHandler: candidate.authenticate }, async () => ({
          ok: true,
        }));
      });

      expect(error).toBeNull();
    });

    it('leaves routes outside /v1 alone', async () => {
      const error = await buildWith((candidate) => {
        candidate.get('/not-v1/open', async () => ({ ok: true }));
      });

      expect(error).toBeNull();
    });
  });

  describe('patients', () => {
    it('creates one and reads it back', async () => {
      const patientId = await createPatient(aliceToken);

      const response = await app.inject({
        method: 'GET',
        url: `/v1/patients/${patientId}`,
        headers: as(aliceToken),
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        patient: { fullName: 'Lakshmi Iyer' },
        role: 'manager',
      });
    });

    it('gives the creator the self grant when the record is their own', async () => {
      const patientId = await createPatient(aliceToken, 'me', 'Alice Herself');

      const response = await app.inject({
        method: 'GET',
        url: `/v1/patients/${patientId}`,
        headers: as(aliceToken),
      });

      expect(JSON.parse(response.body)).toMatchObject({ role: 'self' });
    });

    /**
     * Nothing a client sends can decide whose record this is. The grant is
     * written from the verified token subject, and only from that.
     */
    it('ignores an account the client tries to supply', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/patients',
        headers: as(aliceToken),
        payload: {
          fullName: 'Planted',
          relationship: 'mother',
          subject: 'someone_else',
          // None of these are read.
          accountId: 'acc_somebody_else',
          ownerId: 'acc_somebody_else',
          PK: 'PATIENT#planted',
        },
      });

      expect(response.statusCode).toBe(201);

      const bobsList = await app.inject({
        method: 'GET',
        url: '/v1/patients',
        headers: as(bobToken),
      });
      const names = (
        JSON.parse(bobsList.body) as { patients: { patient: { fullName: string } }[] }
      ).patients.map((entry) => entry.patient.fullName);
      expect(names).not.toContain('Planted');
    });

    it('rejects a draft with no name', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/patients',
        headers: as(aliceToken),
        payload: { relationship: 'mother', subject: 'me' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('the upload flow', () => {
    it('carries a document from record to queued job', async () => {
      const patientId = await createPatient(aliceToken);
      const documentId = await createDocument(aliceToken, patientId, 2);

      // Awaiting upload until the pages are actually there.
      const before = await app.inject({
        method: 'GET',
        url: `/v1/patients/${patientId}/documents/${documentId}/processing`,
        headers: as(aliceToken),
      });
      expect(JSON.parse(before.body)).toMatchObject({ processing: { status: 'awaiting_upload' } });

      for (const upload of await presign(aliceToken, patientId, documentId, 2)) {
        await putPage(upload);
      }

      const completed = await app.inject({
        method: 'POST',
        url: `/v1/patients/${patientId}/documents/${documentId}/uploads/complete`,
        headers: as(aliceToken),
      });

      expect(completed.statusCode).toBe(202);
      expect(JSON.parse(completed.body)).toMatchObject({
        processing: { status: 'queued' },
        alreadyQueued: false,
      });
    });

    /**
     * A client saying "done" with a page missing would otherwise queue a job
     * that reads an incomplete document and produces a summary missing whatever
     * was on that page — a silent wrong answer about a medical record, which is
     * worse than a failed upload.
     */
    it('refuses to queue a document whose pages did not all arrive', async () => {
      const patientId = await createPatient(aliceToken);
      const documentId = await createDocument(aliceToken, patientId, 3);

      const uploads = await presign(aliceToken, patientId, documentId, 3);
      for (const upload of uploads.slice(0, 2)) await putPage(upload);

      const completed = await app.inject({
        method: 'POST',
        url: `/v1/patients/${patientId}/documents/${documentId}/uploads/complete`,
        headers: as(aliceToken),
      });

      expect(completed.statusCode).toBe(409);
      expect(JSON.parse(completed.body)).toMatchObject({
        code: 'upload_incomplete',
        details: { missingPages: [3] },
      });
    });

    it('does not queue the same document twice when the phone retries', async () => {
      const patientId = await createPatient(aliceToken);
      const documentId = await createDocument(aliceToken, patientId, 1);

      for (const upload of await presign(aliceToken, patientId, documentId, 1)) {
        await putPage(upload);
      }

      const url = `/v1/patients/${patientId}/documents/${documentId}/uploads/complete`;
      const first = await app.inject({ method: 'POST', url, headers: as(aliceToken) });
      const second = await app.inject({ method: 'POST', url, headers: as(aliceToken) });

      expect(first.statusCode).toBe(202);
      expect(JSON.parse(first.body)).toMatchObject({ alreadyQueued: false });
      expect(second.statusCode).toBe(200);
      expect(JSON.parse(second.body)).toMatchObject({ alreadyQueued: true });
    });

    it('refuses a page count that does not match the document', async () => {
      const patientId = await createPatient(aliceToken);
      const documentId = await createDocument(aliceToken, patientId, 2);

      const response = await app.inject({
        method: 'POST',
        url: `/v1/patients/${patientId}/documents/${documentId}/uploads`,
        headers: as(aliceToken),
        payload: { pages: [{ page: 1, contentType: 'image/jpeg' }] },
      });

      expect(response.statusCode).toBe(400);
    });

    it('refuses a content type the pipeline cannot read', async () => {
      const patientId = await createPatient(aliceToken);
      const documentId = await createDocument(aliceToken, patientId, 1);

      const response = await app.inject({
        method: 'POST',
        url: `/v1/patients/${patientId}/documents/${documentId}/uploads`,
        headers: as(aliceToken),
        payload: { pages: [{ page: 1, contentType: 'application/zip' }] },
      });

      expect(response.statusCode).toBe(400);
    });

    it('files the document under the patient, not under whoever uploaded it', async () => {
      const patientId = await createPatient(aliceToken);
      const documentId = await createDocument(aliceToken, patientId, 1);

      const [upload] = await presign(aliceToken, patientId, documentId, 1);

      // The object key is the record's, so revoking a helper moves no bytes and
      // deleting the record is one prefix.
      expect(upload?.key).toContain(`patients/${patientId}/`);
      expect(upload?.key).not.toContain('owners/');
    });
  });

  describe('one caller reaching for another’s records', () => {
    it('cannot read a record it holds no grant on', async () => {
      const patientId = await createPatient(aliceToken);

      const response = await app.inject({
        method: 'GET',
        url: `/v1/patients/${patientId}`,
        headers: as(bobToken),
      });

      expect(response.statusCode).toBe(404);
    });

    it('says the same thing for a record that does not exist at all', async () => {
      const patientId = await createPatient(aliceToken);

      const real = await app.inject({
        method: 'GET',
        url: `/v1/patients/${patientId}`,
        headers: as(bobToken),
      });
      const invented = await app.inject({
        method: 'GET',
        url: '/v1/patients/pat_does-not-exist',
        headers: as(bobToken),
      });

      expect(real.statusCode).toBe(invented.statusCode);
      expect(real.body).toBe(invented.body);
    });

    it('cannot list another account’s documents', async () => {
      const patientId = await createPatient(aliceToken);
      await createDocument(aliceToken, patientId);

      const response = await app.inject({
        method: 'GET',
        url: `/v1/patients/${patientId}/documents`,
        headers: as(bobToken),
      });

      expect(response.statusCode).toBe(404);
    });

    it('cannot delete another account’s document', async () => {
      const patientId = await createPatient(aliceToken);
      const documentId = await createDocument(aliceToken, patientId);

      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/patients/${patientId}/documents/${documentId}`,
        headers: as(bobToken),
      });

      expect(response.statusCode).toBe(404);
    });

    /**
     * The one that matters most in this file. A presigned URL outlives the
     * request that issued it, so signing one for a caller with no grant hands
     * them a working credential regardless of what the response body said.
     */
    it('cannot presign an upload into another account’s document', async () => {
      const patientId = await createPatient(aliceToken);
      const documentId = await createDocument(aliceToken, patientId);

      const response = await app.inject({
        method: 'POST',
        url: `/v1/patients/${patientId}/documents/${documentId}/uploads`,
        headers: as(bobToken),
        payload: { pages: [{ page: 1, contentType: 'image/jpeg' }] },
      });

      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain('http');
    });

    it('cannot file a document against a record it does not hold', async () => {
      const patientId = await createPatient(aliceToken);

      const response = await app.inject({
        method: 'POST',
        url: `/v1/patients/${patientId}/documents`,
        headers: as(bobToken),
        payload: {
          title: 'Planted',
          category: 'lab_report',
          documentDate: '2026-03-14',
          pageCount: 1,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('a read-only helper', () => {
    const inviteAndAccept = async (
      patientId: string,
      role: 'contributor' | 'viewer',
    ): Promise<void> => {
      const invitation = await app.inject({
        method: 'POST',
        url: `/v1/patients/${patientId}/invitations`,
        headers: as(aliceToken),
        payload: { role },
      });
      expect(invitation.statusCode).toBe(201);

      const accepted = await app.inject({
        method: 'POST',
        url: '/v1/invitations/accept',
        headers: as(bobToken),
        payload: { token: (JSON.parse(invitation.body) as { token: string }).token },
      });
      expect(accepted.statusCode).toBe(200);
    };

    it('can read the record but cannot add a document to it', async () => {
      const patientId = await createPatient(aliceToken);
      await inviteAndAccept(patientId, 'viewer');

      const read = await app.inject({
        method: 'GET',
        url: `/v1/patients/${patientId}`,
        headers: as(bobToken),
      });
      expect(read.statusCode).toBe(200);

      const write = await app.inject({
        method: 'POST',
        url: `/v1/patients/${patientId}/documents`,
        headers: as(bobToken),
        payload: {
          title: 'Planted',
          category: 'lab_report',
          documentDate: '2026-03-14',
          pageCount: 1,
        },
      });
      // 403 rather than 404: bob can see this record, so what he may not do is
      // the honest answer.
      expect(write.statusCode).toBe(403);
    });

    it('can add a document as a contributor, but not delete one', async () => {
      const patientId = await createPatient(aliceToken);
      await inviteAndAccept(patientId, 'contributor');

      const documentId = await createDocument(bobToken, patientId);
      expect(documentId).toBeTruthy();

      const removal = await app.inject({
        method: 'DELETE',
        url: `/v1/patients/${patientId}/documents/${documentId}`,
        headers: as(bobToken),
      });
      expect(removal.statusCode).toBe(403);
    });

    it('loses access the moment the grant is revoked', async () => {
      const patientId = await createPatient(aliceToken);
      await inviteAndAccept(patientId, 'contributor');

      const bobAccount = (
        JSON.parse(
          (
            await app.inject({
              method: 'GET',
              url: `/v1/patients/${patientId}/grants`,
              headers: as(aliceToken),
            })
          ).body,
        ) as { grants: { accountId: string; role: string }[] }
      ).grants.find((grant) => grant.role === 'contributor')?.accountId;

      const removal = await app.inject({
        method: 'DELETE',
        url: `/v1/patients/${patientId}/grants/${bobAccount}`,
        headers: as(aliceToken),
      });
      expect(removal.statusCode).toBe(204);

      const after = await app.inject({
        method: 'GET',
        url: `/v1/patients/${patientId}`,
        // The same token as before: revocation must not depend on the client
        // discarding anything.
        headers: as(bobToken),
      });
      expect(after.statusCode).toBe(404);
    });
  });
});
