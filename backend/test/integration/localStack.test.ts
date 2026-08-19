import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadStackConfig } from '../../src/config/stack.js';
import { createJobQueue, type ProcessingJob } from '../../src/services/queue/JobQueue.js';
import { initialiseLocalStack } from '../../src/services/localStack/initialise.js';
import { createObjectStore, pageKey } from '../../src/services/objects/ObjectStore.js';

/**
 * Runs against the containers in `backend/docker-compose.yml`.
 *
 * This is the suite ADR-003 is really about. It is written against the ports,
 * so on the day an AWS account exists the same file runs with
 * `AYUNETZ_STACK=aws` and the difference between "works locally" and "works on
 * AWS" is a test result rather than a discovery in production.
 *
 * Skipped, loudly, when the stack is not up — a developer without Docker should
 * see "skipped" rather than a wall of connection errors they have to decode.
 */
const config = loadStackConfig();

const stackIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${config.clients.objects.endpoint}/minio/health/live`, {
      signal: AbortSignal.timeout(1_500),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const up = await stackIsUp();

describe.skipIf(!up)('the local stack', () => {
  const store = createObjectStore(config);
  const queue = createJobQueue(config);

  // Unique per run, so a re-run is never confused by what the last one left.
  const ownerId = `owner_${Date.now().toString(36)}`;
  const documentId = 'doc_local_stack';
  const written: string[] = [];

  beforeAll(async () => {
    await initialiseLocalStack(config);
  });

  afterAll(async () => {
    await Promise.all(written.map((key) => store.delete(key)));
  });

  describe('object storage', () => {
    it('round-trips a page through the store', async () => {
      const key = pageKey({ ownerId, documentId, page: 1 });
      written.push(key);
      const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

      await store.put(key, bytes, 'application/pdf');

      expect(await store.exists(key)).toBe(true);
      expect(Array.from(await store.get(key))).toEqual(Array.from(bytes));
    });

    it('reports a missing object as absent rather than throwing', async () => {
      expect(await store.exists(pageKey({ ownerId, documentId, page: 99 }))).toBe(false);
    });

    it('deletes a page', async () => {
      const key = pageKey({ ownerId, documentId: 'doc_to_delete', page: 1 });
      await store.put(key, new Uint8Array([1, 2, 3]), 'image/jpeg');

      await store.delete(key);

      expect(await store.exists(key)).toBe(false);
    });

    it('groups every object under its owner, so erasure is a prefix', () => {
      const key = pageKey({ ownerId, documentId, page: 2 });
      expect(key.startsWith(`owners/${ownerId}/`)).toBe(true);
    });

    it('pads page numbers so a listing sorts in reading order', () => {
      const keys = [9, 10, 2].map((page) => pageKey({ ownerId, documentId, page }));
      expect([...keys].sort()).toEqual([
        pageKey({ ownerId, documentId, page: 2 }),
        pageKey({ ownerId, documentId, page: 9 }),
        pageKey({ ownerId, documentId, page: 10 }),
      ]);
    });
  });

  describe('presigned upload', () => {
    it('lets a client PUT a page without holding any credential', async () => {
      const key = pageKey({ ownerId, documentId, page: 3 });
      written.push(key);

      const presigned = await store.presignUpload({ ownerId, documentId, page: 3 }, 'image/jpeg');
      const body = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic

      const response = await fetch(presigned.url, {
        method: 'PUT',
        headers: presigned.headers,
        body,
      });

      expect(response.ok).toBe(true);
      expect(await store.exists(key)).toBe(true);
    });

    it('signs the content type, so a mislabelled upload is refused', async () => {
      const presigned = await store.presignUpload({ ownerId, documentId, page: 4 }, 'image/jpeg');

      const response = await fetch(presigned.url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: new Uint8Array([1]),
      });

      expect(response.ok).toBe(false);
    });

    it('signs one key only, so the URL cannot be pointed at another document', async () => {
      const presigned = await store.presignUpload({ ownerId, documentId, page: 5 }, 'image/jpeg');
      const elsewhere = presigned.url.replace(documentId, 'doc_someone_else');

      const response = await fetch(elsewhere, {
        method: 'PUT',
        headers: presigned.headers,
        body: new Uint8Array([1]),
      });

      expect(response.ok).toBe(false);
    });

    it('expires, and says by when', async () => {
      const presigned = await store.presignUpload({ ownerId, documentId, page: 6 }, 'image/jpeg');

      expect(presigned.expiresInSeconds).toBe(config.presignTtlSeconds);
      expect(presigned.expiresInSeconds).toBeLessThanOrEqual(3600);
      expect(presigned.url).toContain('X-Amz-Expires');
    });
  });

  describe('the processing queue', () => {
    const job: ProcessingJob = {
      ownerId,
      documentId,
      pageCount: 2,
      // Unique per run. The queue is shared with every other suite touching the
      // local stack — the `/v1` tests enqueue real jobs onto it — so a test that
      // assumed the next message was its own would fail whenever the files ran
      // together. It did, which is how this got written properly.
      attemptToken: `attempt_${ownerId}`,
    };

    /** Reads until it finds our message, acknowledging what it takes. */
    const receiveOwn = async (): Promise<boolean> => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const batch = await queue.receive(10);
        let found = false;

        for (const entry of batch) {
          // Everything taken is acknowledged, ours or not. This is a
          // development queue and leaving other suites' messages invisible for
          // the 180 s visibility timeout would be worse than draining them.
          await queue.acknowledge(entry.receipt);
          if (entry.job.attemptToken === job.attemptToken) found = true;
        }

        if (found) return true;
      }
      return false;
    };

    it('carries a job from sender to worker and acknowledges it', async () => {
      await queue.enqueue(job);

      expect(await receiveOwn()).toBe(true);

      // Acknowledged messages are not redelivered.
      const after = await queue.receive(10);
      for (const entry of after) await queue.acknowledge(entry.receipt);
      expect(after.map((entry) => entry.job.attemptToken)).not.toContain(job.attemptToken);
    });

    it('refuses to enqueue anything beyond identifiers', async () => {
      const leaky = { ...job, ocrText: 'HbA1c 8.1%, Lakshmi Iyer' } as ProcessingJob;

      await expect(queue.enqueue(leaky)).rejects.toThrow(/identifiers only/i);
    });
  });

  describe('configuration', () => {
    it('refuses to create infrastructure on AWS, where the CDK stack owns it', async () => {
      await expect(initialiseLocalStack({ ...config, name: 'aws' })).rejects.toThrow(/CDK stack/i);
    });

    it('defaults to the local stack, so nothing reaches a real account by accident', () => {
      expect(loadStackConfig({}).name).toBe('local');
    });

    it('drops the emulator endpoints and credentials when the stack is aws', () => {
      const aws = loadStackConfig({ AYUNETZ_STACK: 'aws' });

      for (const client of Object.values(aws.clients)) {
        expect(client.endpoint).toBeUndefined();
        expect(client.credentials).toBeUndefined();
      }
    });

    it('never logs a credential in the startup description', async () => {
      const { describeStack } = await import('../../src/config/stack.js');
      const described = JSON.stringify(describeStack(config));

      expect(described).not.toContain('ayunetzlocalsecret');
      expect(described.toLowerCase()).not.toContain('secret');
    });
  });
});

describe.skipIf(up)('the local stack (not running)', () => {
  it('is skipped — start it with: docker compose -f backend/docker-compose.yml up -d', () => {
    expect(up).toBe(false);
  });
});
