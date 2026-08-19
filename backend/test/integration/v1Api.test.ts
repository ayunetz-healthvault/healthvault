import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadIdentityConfig } from '../../src/config/identity.js';
import { loadStackConfig } from '../../src/config/stack.js';
import { initialiseLocalStack } from '../../src/services/localStack/initialise.js';
import { createObjectStore } from '../../src/services/objects/ObjectStore.js';
import { createJobQueue } from '../../src/services/queue/JobQueue.js';
import { createRecordRepository } from '../../src/services/records/RecordRepository.js';

/**
 * The `/v1` API against the running local stack.
 *
 * Everything below goes through the real ports — a real object store, a real
 * queue, real DynamoDB semantics — with a real token. This is the first point
 * at which the four ports are exercised together as the thing the app will
 * actually talk to.
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

  beforeAll(async () => {
    await initialiseLocalStack(stack);

    app = buildApp({
      stack,
      identity,
      repository: createRecordRepository(stack),
      objects,
      queue: createJobQueue(stack),
      logStream: silent(),
    });
    await app.ready();

    const run = Date.now().toString(36);
    aliceToken = await token(`owner_alice_${run}`);
    bobToken = await token(`owner_bob_${run}`);
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

  const createParent = async (bearer: string, fullName = 'Lakshmi Iyer'): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/parents',
      headers: as(bearer),
      payload: { fullName, relationship: 'mother', city: 'Chennai' },
    });
    return (JSON.parse(response.body) as { parent: { parentId: string } }).parent.parentId;
  };

  const createDocument = async (
    bearer: string,
    parentId: string,
    pageCount = 1,
  ): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/documents',
      headers: as(bearer),
      payload: {
        parentId,
        title: 'Diabetes panel',
        category: 'lab_report',
        documentDate: '2026-03-14',
        pageCount,
      },
    });
    return (JSON.parse(response.body) as { document: { documentId: string } }).document.documentId;
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
      const collector = buildApp({
        stack,
        identity,
        repository: createRecordRepository(stack),
        objects,
        queue: createJobQueue(stack),
        logStream: silent(),
      });
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
      expect(routes.length).toBeGreaterThanOrEqual(9);
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
    const buildWith = async (
      register: (app: FastifyInstance) => void,
    ): Promise<Error | null> => {
      const candidate = buildApp({
        stack,
        identity,
        repository: createRecordRepository(stack),
        objects,
        queue: createJobQueue(stack),
        logStream: silent(),
      });

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
        candidate.get('/v1/fine', { preHandler: candidate.authenticate }, async () => ({ ok: true }));
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

  describe('parents', () => {
    it('creates one and reads it back', async () => {
      const parentId = await createParent(aliceToken);

      const response = await app.inject({
        method: 'GET',
        url: `/v1/parents/${parentId}`,
        headers: as(aliceToken),
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({ parent: { fullName: 'Lakshmi Iyer' } });
    });

    it('ignores an owner the client tries to supply', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/parents',
        headers: as(aliceToken),
        payload: {
          fullName: 'Planted',
          relationship: 'mother',
          // None of these are read. The owner comes from the token.
          ownerId: 'owner_somebody_else',
          PK: 'USER#owner_somebody_else',
        },
      });

      expect(response.statusCode).toBe(201);

      const bobsList = await app.inject({
        method: 'GET',
        url: '/v1/parents',
        headers: as(bobToken),
      });
      const names = (JSON.parse(bobsList.body) as { parents: { fullName: string }[] }).parents.map(
        (parent) => parent.fullName,
      );
      expect(names).not.toContain('Planted');
    });

    it('patches without blanking fields that were not sent', async () => {
      const parentId = await createParent(aliceToken);

      await app.inject({
        method: 'PATCH',
        url: `/v1/parents/${parentId}`,
        headers: as(aliceToken),
        payload: { city: 'Madurai' },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/v1/parents/${parentId}`,
        headers: as(aliceToken),
      });
      expect(JSON.parse(response.body)).toMatchObject({
        parent: { city: 'Madurai', fullName: 'Lakshmi Iyer', relationship: 'mother' },
      });
    });

    it('refuses to delete somebody who still has documents', async () => {
      const parentId = await createParent(aliceToken);
      await createDocument(aliceToken, parentId);

      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/parents/${parentId}`,
        headers: as(aliceToken),
      });

      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body)).toMatchObject({ code: 'parent_has_documents' });
    });

    it('rejects a draft with no name', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/parents',
        headers: as(aliceToken),
        payload: { relationship: 'mother' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('the upload flow', () => {
    it('carries a document from record to queued job', async () => {
      const parentId = await createParent(aliceToken);
      const documentId = await createDocument(aliceToken, parentId, 2);

      // Awaiting upload until the pages are actually there.
      const before = await app.inject({
        method: 'GET',
        url: `/v1/documents/${documentId}/processing`,
        headers: as(aliceToken),
      });
      expect(JSON.parse(before.body)).toMatchObject({ processing: { status: 'awaiting_upload' } });

      const presigned = await app.inject({
        method: 'POST',
        url: `/v1/documents/${documentId}/uploads`,
        headers: as(aliceToken),
        payload: {
          pages: [
            { page: 1, contentType: 'image/jpeg' },
            { page: 2, contentType: 'image/jpeg' },
          ],
        },
      });
      expect(presigned.statusCode).toBe(200);

      const { uploads } = JSON.parse(presigned.body) as {
        uploads: { page: number; url: string; headers: Record<string, string> }[];
      };

      for (const upload of uploads) {
        const put = await fetch(upload.url, {
          method: 'PUT',
          headers: upload.headers,
          body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
        });
        expect(put.ok).toBe(true);
      }

      const completed = await app.inject({
        method: 'POST',
        url: `/v1/documents/${documentId}/uploads/complete`,
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
      const parentId = await createParent(aliceToken);
      const documentId = await createDocument(aliceToken, parentId, 3);

      const presigned = await app.inject({
        method: 'POST',
        url: `/v1/documents/${documentId}/uploads`,
        headers: as(aliceToken),
        payload: {
          pages: [1, 2, 3].map((page) => ({ page, contentType: 'image/jpeg' as const })),
        },
      });
      const { uploads } = JSON.parse(presigned.body) as {
        uploads: { page: number; url: string; headers: Record<string, string> }[];
      };

      // Only the first two.
      for (const upload of uploads.slice(0, 2)) {
        await fetch(upload.url, {
          method: 'PUT',
          headers: upload.headers,
          body: new Uint8Array([1]),
        });
      }

      const completed = await app.inject({
        method: 'POST',
        url: `/v1/documents/${documentId}/uploads/complete`,
        headers: as(aliceToken),
      });

      expect(completed.statusCode).toBe(409);
      expect(JSON.parse(completed.body)).toMatchObject({
        code: 'upload_incomplete',
        details: { missingPages: [3] },
      });
    });

    it('does not queue the same document twice when the phone retries', async () => {
      const parentId = await createParent(aliceToken);
      const documentId = await createDocument(aliceToken, parentId, 1);

      const presigned = await app.inject({
        method: 'POST',
        url: `/v1/documents/${documentId}/uploads`,
        headers: as(aliceToken),
        payload: { pages: [{ page: 1, contentType: 'image/jpeg' }] },
      });
      const { uploads } = JSON.parse(presigned.body) as {
        uploads: { url: string; headers: Record<string, string> }[];
      };
      await fetch(uploads[0]!.url, {
        method: 'PUT',
        headers: uploads[0]!.headers,
        body: new Uint8Array([1]),
      });

      const complete = () =>
        app.inject({
          method: 'POST',
          url: `/v1/documents/${documentId}/uploads/complete`,
          headers: as(aliceToken),
        });

      const first = await complete();
      const second = await complete();

      expect(first.statusCode).toBe(202);
      expect(JSON.parse(first.body)).toMatchObject({ alreadyQueued: false });
      expect(second.statusCode).toBe(200);
      expect(JSON.parse(second.body)).toMatchObject({ alreadyQueued: true });
    });

    it('refuses a page count that does not match the document', async () => {
      const parentId = await createParent(aliceToken);
      const documentId = await createDocument(aliceToken, parentId, 2);

      const response = await app.inject({
        method: 'POST',
        url: `/v1/documents/${documentId}/uploads`,
        headers: as(aliceToken),
        payload: { pages: [{ page: 1, contentType: 'image/jpeg' }] },
      });

      expect(response.statusCode).toBe(400);
    });

    it('refuses a content type the pipeline cannot read', async () => {
      const parentId = await createParent(aliceToken);
      const documentId = await createDocument(aliceToken, parentId, 1);

      const response = await app.inject({
        method: 'POST',
        url: `/v1/documents/${documentId}/uploads`,
        headers: as(aliceToken),
        payload: { pages: [{ page: 1, contentType: 'application/zip' }] },
      });

      expect(response.statusCode).toBe(400);
    });

    it('refuses to file a document against a parent that is not the caller’s', async () => {
      const bobsParent = await createParent(bobToken, 'Bob’s Mother');

      const response = await app.inject({
        method: 'POST',
        url: '/v1/documents',
        headers: as(aliceToken),
        payload: {
          parentId: bobsParent,
          title: 'Planted',
          category: 'lab_report',
          documentDate: '2026-03-14',
          pageCount: 1,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('one caller reaching for another’s records', () => {
    let aliceParent: string;
    let aliceDocument: string;

    beforeAll(async () => {
      aliceParent = await createParent(aliceToken);
      aliceDocument = await createDocument(aliceToken, aliceParent);
    });

    it.each([
      ['a parent', () => `/v1/parents/${aliceParent}`],
      ['a document', () => `/v1/documents/${aliceDocument}`],
      ['processing state', () => `/v1/documents/${aliceDocument}/processing`],
      ['a summary', () => `/v1/documents/${aliceDocument}/summary`],
    ])('answers 404 for %s belonging to somebody else', async (_label, url) => {
      const response = await app.inject({ method: 'GET', url: url(), headers: as(bobToken) });

      expect(response.statusCode).toBe(404);
    });

    it('says the same thing for a record that does not exist at all', async () => {
      const missing = await app.inject({
        method: 'GET',
        url: '/v1/documents/doc_does_not_exist',
        headers: as(bobToken),
      });
      const someoneElses = await app.inject({
        method: 'GET',
        url: `/v1/documents/${aliceDocument}`,
        headers: as(bobToken),
      });

      // Identical, on purpose. A different answer would turn any endpoint
      // taking an id into a way to test whether that id exists in somebody
      // else's records.
      expect(someoneElses.statusCode).toBe(missing.statusCode);
      expect(someoneElses.body).toBe(missing.body);
    });

    it('cannot delete another caller’s document', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/documents/${aliceDocument}`,
        headers: as(bobToken),
      });

      expect(response.statusCode).toBe(404);

      const stillThere = await app.inject({
        method: 'GET',
        url: `/v1/documents/${aliceDocument}`,
        headers: as(aliceToken),
      });
      expect(stillThere.statusCode).toBe(200);
    });

    it('cannot presign an upload into another caller’s document', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/documents/${aliceDocument}/uploads`,
        headers: as(bobToken),
        payload: { pages: [{ page: 1, contentType: 'image/jpeg' }] },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});

describe.skipIf(up)('the /v1 API (stack not running)', () => {
  it('is skipped — start it with: npm run stack:up', () => {
    expect(up).toBe(false);
  });
});
